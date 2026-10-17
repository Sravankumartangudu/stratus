// formula.js — formula fields, the way Salesforce writes them:
//   Amount * Probability / 100        IF(Priority = "High", "🔥", "")        TODAY() - CloseDate
//   Account.Industry & " · " & BillingCity        CASE(Rating, "Hot", 3, "Warm", 2, 1)
// A tiny parser and interpreter — no eval — so a formula can only read the record and call the
// functions below. Date minus date gives days; date plus a number gives a date.

const Formula = (() => {
  const cache = new Map();
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const rest = src.slice(i);
      let m;
      if ((m = rest.match(/^\s+/))) { i += m[0].length; continue; }
      if ((m = rest.match(/^\d+(\.\d+)?/))) { out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
      if (rest[0] === '"' || rest[0] === "'") {
        const q = rest[0];
        let j = 1, s = '';
        while (j < rest.length && rest[j] !== q) { if (rest[j] === '\\' && j + 1 < rest.length) j++; s += rest[j]; j++; }
        if (j >= rest.length) throw new Error('A text value is missing its closing quote.');
        out.push({ t: 'str', v: s }); i += j + 1; continue;
      }
      if ((m = rest.match(/^[A-Za-z_$][\w.]*/))) { out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      if ((m = rest.match(/^(<=|>=|<>|!=|==|&&|\|\||[-+*/&=<>(),!])/))) { out.push({ t: 'op', v: m[0] }); i += m[0].length; continue; }
      throw new Error(`Unexpected "${rest[0]}" in the formula.`);
    }
    return out;
  }

  function parse(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (...ops) => peek() && peek().t === 'op' && ops.includes(peek().v);
    const isWord = (...w) => peek() && peek().t === 'id' && w.includes(peek().v.toUpperCase());
    const expect = (v) => { if (!isOp(v)) throw new Error(`Expected "${v}" in the formula.`); p++; };
    const bin = (next, test) => () => {
      let a = next();
      while (test()) { const op = toks[p++].v.toUpperCase(); a = { t: 'bin', op, a, b: next() }; }
      return a;
    };
    const primary = () => {
      const k = toks[p++];
      if (!k) throw new Error('The formula ends too soon.');
      if (k.t === 'num' || k.t === 'str') return { t: 'lit', v: k.v };
      if (k.t === 'op' && k.v === '(') { const e = or(); expect(')'); return e; }
      if (k.t === 'op' && (k.v === '-' || k.v === '!')) return { t: 'un', op: k.v, a: primary() };
      if (k.t === 'id') {
        const up = k.v.toUpperCase();
        if (up === 'TRUE') return { t: 'lit', v: true };
        if (up === 'FALSE') return { t: 'lit', v: false };
        if (up === 'NULL') return { t: 'lit', v: null };
        if (isOp('(')) {
          p++;
          const args = [];
          if (!isOp(')')) { do { args.push(or()); } while (isOp(',') && ++p); }
          expect(')');
          if (!FN[up]) throw new Error(`There's no ${up}() function.`);
          return { t: 'call', fn: up, args };
        }
        return { t: 'field', v: k.v };
      }
      throw new Error(`Unexpected "${k.v}" in the formula.`);
    };
    const mul = bin(primary, () => isOp('*', '/'));
    const addE = bin(mul, () => isOp('+', '-', '&'));
    const cmp = bin(addE, () => isOp('=', '==', '!=', '<>', '<', '>', '<=', '>='));
    const and = bin(cmp, () => isOp('&&') || isWord('AND'));
    const or = bin(and, () => isOp('||') || isWord('OR'));
    const tree = or();
    if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}" in the formula.`);
    return tree;
  }

  const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
  const FN = {
    IF: null, CASE: null, AND: null, OR: null, // evaluated lazily below
    NOT: (a) => !a,
    ISBLANK: (a) => a == null || a === '',
    BLANKVALUE: (a, b) => (a == null || a === '' ? b : a),
    TODAY: () => today(),
    NOW: () => new Date().toISOString(),
    ROUND: (a, d) => { const k = 10 ** num(d); return Math.round(num(a) * k) / k; },
    ABS: (a) => Math.abs(num(a)),
    MAX: (...a) => Math.max(...a.map(num)),
    MIN: (...a) => Math.min(...a.map(num)),
    LEN: (a) => String(a == null ? '' : a).length,
    UPPER: (a) => String(a == null ? '' : a).toUpperCase(),
    LOWER: (a) => String(a == null ? '' : a).toLowerCase(),
    TEXT: (a) => (a == null ? '' : String(a)),
    VALUE: (a) => num(a),
    CONTAINS: (a, b) => String(a == null ? '' : a).toLowerCase().includes(String(b == null ? '' : b).toLowerCase()),
    BEGINS: (a, b) => String(a == null ? '' : a).toLowerCase().startsWith(String(b == null ? '' : b).toLowerCase()),
    ADDDAYS: (d, n) => (d ? addDays(d, num(n)) : null),
    DATEVALUE: (d) => (d ? String(d).slice(0, 10) : null),
    YEAR: (d) => (d ? Number(String(d).slice(0, 4)) : null),
    MONTH: (d) => (d ? Number(String(d).slice(5, 7)) : null),
  };

  function run(node, rec, obj) {
    switch (node.t) {
      case 'lit': return node.v;
      case 'field': return rec ? DB.path(rec, node.v) : null;
      case 'un': { const a = run(node.a, rec, obj); return node.op === '-' ? -num(a) : !a; }
      case 'call': {
        const a = node.args;
        if (node.fn === 'IF') return run(a[0], rec, obj) ? run(a[1], rec, obj) : (a[2] ? run(a[2], rec, obj) : null);
        if (node.fn === 'AND') return a.every((x) => run(x, rec, obj));
        if (node.fn === 'OR') return a.some((x) => run(x, rec, obj));
        if (node.fn === 'CASE') {
          const v = run(a[0], rec, obj);
          for (let i = 1; i + 1 < a.length; i += 2) if (run(a[i], rec, obj) == v) return run(a[i + 1], rec, obj); // eslint-disable-line eqeqeq
          return a.length % 2 === 0 ? run(a[a.length - 1], rec, obj) : null;
        }
        return FN[node.fn](...a.map((x) => run(x, rec, obj)));
      }
      case 'bin': {
        const x = run(node.a, rec, obj), y = run(node.b, rec, obj);
        switch (node.op) {
          case '+':
            if (isDate(x) && !isDate(y)) return addDays(x, num(y));
            if (typeof x === 'string' && !isDate(x) && isNaN(x)) return x + (y == null ? '' : y);
            return num(x) + num(y);
          case '-': return isDate(x) && isDate(y) ? daysBetween(y, x) : isDate(x) ? addDays(x, -num(y)) : num(x) - num(y);
          case '*': return num(x) * num(y);
          case '/': return num(y) === 0 ? null : num(x) / num(y);
          case '&': return `${x == null ? '' : x}${y == null ? '' : y}`;
          case '=': case '==': return x == y; // eslint-disable-line eqeqeq
          case '!=': case '<>': return x != y; // eslint-disable-line eqeqeq
          case '<': return cmpv(x, y) < 0;
          case '>': return cmpv(x, y) > 0;
          case '<=': return cmpv(x, y) <= 0;
          case '>=': return cmpv(x, y) >= 0;
          case '&&': case 'AND': return !!(x && y);
          case '||': case 'OR': return !!(x || y);
        }
      }
    }
    return null;
  }
  const cmpv = (x, y) => (typeof x === 'number' || typeof y === 'number' ? num(x) - num(y) : String(x == null ? '' : x).localeCompare(String(y == null ? '' : y)));

  function compile(expr) {
    if (!cache.has(expr)) cache.set(expr, parse(String(expr || '')));
    return cache.get(expr);
  }

  return {
    // Value of `expr` for `rec`; errors come back as null so one bad formula never breaks a page.
    evaluate(expr, rec, obj) { try { return run(compile(expr), rec, obj); } catch (_) { return null; } },
    // For Setup: does it parse, and what does it give on a sample record?
    check(expr, obj) {
      try {
        const tree = compile(expr);
        const sample = DB.all(obj)[0];
        return { ok: true, sample: sample ? run(tree, sample, obj) : null, sampleId: sample && sample.Id };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    functions: Object.keys(FN),
  };
})();
