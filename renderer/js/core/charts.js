// charts.js — the charts reports, dashboards, Tableau and Pulse draw with. Plain SVG, sized by viewBox
// so they fill whatever card they're in; colours read CSS variables so light and dark both work.
//   Charts.draw('bar', [{label, value}], { format: fmt.short, onClick: (d) => … })
// Types: bar, hbar, line, area, donut, funnel, gauge, stacked (needs { keys, series }), spark.

const Charts = (() => {
  const PALETTE = ['#1b96ff', '#04844b', '#f59e0b', '#9050e9', '#e5484d', '#0ea5a4', '#ec4899', '#64748b', '#84cc16', '#f97316', '#3b82f6', '#a855f7'];
  const color = (i) => PALETTE[i % PALETTE.length];
  const tip = (d, f) => svg('title', null, `${d.label}: ${f(d.value)}`);
  const ellipsis = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
  const nice = (max) => {
    if (max <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(max));
    const m = max / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  };
  const shortNum = (v) => {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return String(Math.round(v * 100) / 100);
  };
  const box = (W, H, kids, cls) => svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart ' + (cls || ''), preserveAspectRatio: 'xMidYMid meet' }, kids);
  const grid = (W, H, L, T, B, max, axisFmt) => {
    const out = [];
    for (let i = 0; i <= 4; i++) {
      const y = T + (H - T - B) * (1 - i / 4);
      out.push(svg('line', { x1: L, x2: W - 8, y1: y, y2: y, class: 'grid' }));
      out.push(svg('text', { x: L - 6, y: y + 4, 'text-anchor': 'end', class: 'axis' }, axisFmt((max * i) / 4)));
    }
    return out;
  };
  const click = (o, d) => (o.onClick ? { onclick: () => o.onClick(d), style: { cursor: 'pointer' } } : {});

  function bar(data, o) {
    const W = o.width || 520, H = o.height || 260, L = 48, T = 12, B = 46;
    const max = nice(Math.max(...data.map((d) => d.value), 0));
    const bw = (W - L - 8) / Math.max(1, data.length);
    return box(W, H, [
      grid(W, H, L, T, B, max, o.axis || shortNum),
      data.map((d, i) => {
        const h0 = ((H - T - B) * d.value) / max;
        const x = L + i * bw + bw * 0.14, y = H - B - h0;
        return svg('g', click(o, d),
          svg('rect', { x, y, width: bw * 0.72, height: Math.max(0, h0), rx: 3, fill: d.color || color(o.single ? 0 : i), class: 'bar' }, tip(d, o.format)),
          bw > 34 ? svg('text', { x: x + bw * 0.36, y: y - 4, 'text-anchor': 'middle', class: 'val' }, o.format(d.value)) : null,
          svg('text', { x: x + bw * 0.36, y: H - B + 15, 'text-anchor': 'middle', class: 'lbl' }, ellipsis(d.label, Math.max(4, Math.floor(bw / 6.5)))));
      }),
    ]);
  }

  function hbar(data, o) {
    const rows = data.slice(0, o.max || 14);
    const W = 520, row = 26, L = 150, H = Math.max(80, rows.length * row + 16);
    const max = Math.max(...rows.map((d) => d.value), 0) || 1;
    return box(W, H, rows.map((d, i) => {
      const w = ((W - L - 70) * d.value) / max, y = 8 + i * row;
      return svg('g', click(o, d),
        svg('text', { x: L - 8, y: y + 15, 'text-anchor': 'end', class: 'lbl' }, ellipsis(d.label, 22)),
        svg('rect', { x: L, y: y + 3, width: Math.max(2, w), height: row - 9, rx: 3, fill: d.color || color(o.single ? 0 : i), class: 'bar' }, tip(d, o.format)),
        svg('text', { x: L + w + 6, y: y + 15, class: 'val' }, o.format(d.value)));
    }));
  }

  function line(data, o, area) {
    const W = o.width || 520, H = o.height || 240, L = 48, T = 14, B = 40;
    const max = nice(Math.max(...data.map((d) => d.value), 0));
    const n = Math.max(1, data.length - 1);
    const X = (i) => L + ((W - L - 16) * i) / n, Y = (v) => T + (H - T - B) * (1 - v / max);
    const pts = data.map((d, i) => `${X(i)},${Y(d.value)}`).join(' ');
    const every = Math.ceil(data.length / 10);
    return box(W, H, [
      grid(W, H, L, T, B, max, o.axis || shortNum),
      area || o.area ? svg('polygon', { points: `${X(0)},${H - B} ${pts} ${X(data.length - 1)},${H - B}`, class: 'area', fill: o.color || color(0) }) : null,
      svg('polyline', { points: pts, fill: 'none', stroke: o.color || color(0), 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
      o.goal ? svg('line', { x1: L, x2: W - 16, y1: Y(o.goal), y2: Y(o.goal), class: 'goal' }) : null,
      data.map((d, i) => svg('g', click(o, d),
        svg('circle', { cx: X(i), cy: Y(d.value), r: 3.5, fill: o.color || color(0), class: 'dot' }, tip(d, o.format)),
        i % every === 0 ? svg('text', { x: X(i), y: H - B + 16, 'text-anchor': 'middle', class: 'lbl' }, ellipsis(d.label, 9)) : null)),
    ]);
  }

  function donut(data, o) {
    const W = 520, H = o.height || 240, cx = 120, cy = H / 2, R = Math.min(100, H / 2 - 10), r = R * 0.6;
    const total = sum(data, (d) => d.value) || 1;
    let a0 = -Math.PI / 2;
    const arcs = data.map((d, i) => {
      const a1 = a0 + (2 * Math.PI * d.value) / total;
      const big = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rad, a) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
      const full = d.value / total > 0.9999;
      const dPath = full
        ? `M ${cx - R} ${cy} A ${R} ${R} 0 1 1 ${cx + R} ${cy} A ${R} ${R} 0 1 1 ${cx - R} ${cy} M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy}`
        : `M ${p(R, a0)} A ${R} ${R} 0 ${big} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${big} 0 ${p(r, a0)} Z`;
      a0 = a1;
      return svg('path', Object.assign({ d: dPath, fill: d.color || color(i), class: 'slice', 'fill-rule': 'evenodd' }, click(o, d)), tip(d, o.format));
    });
    const legend = data.slice(0, 9).map((d, i) => svg('g', click(o, d),
      svg('rect', { x: 262, y: 22 + i * 22, width: 11, height: 11, rx: 2, fill: d.color || color(i) }),
      svg('text', { x: 280, y: 32 + i * 22, class: 'lbl' }, ellipsis(d.label, 22)),
      svg('text', { x: 510, y: 32 + i * 22, 'text-anchor': 'end', class: 'val' }, `${o.format(d.value)} · ${Math.round((d.value / total) * 100)}%`)));
    return box(W, H, [arcs, svg('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', class: 'big' }, o.format(total)),
      svg('text', { x: cx, y: cy + 16, 'text-anchor': 'middle', class: 'axis' }, o.totalLabel || 'Total'), legend]);
  }

  function funnel(data, o) {
    const W = 520, row = 34, H = data.length * row + 10;
    const max = Math.max(...data.map((d) => d.value), 0) || 1;
    return box(W, H, data.map((d, i) => {
      const w = Math.max(40, (360 * d.value) / max), x = 180 - w / 2 + 70, y = 5 + i * row;
      return svg('g', click(o, d),
        svg('rect', { x, y, width: w, height: row - 6, rx: 4, fill: d.color || color(i), class: 'bar' }, tip(d, o.format)),
        svg('text', { x: 250, y: y + 19, 'text-anchor': 'middle', class: 'inbar' }, o.format(d.value)),
        svg('text', { x: 440, y: y + 19, class: 'lbl' }, ellipsis(d.label, 16)));
    }));
  }

  // gauge: one value against a goal (data = [{label, value}], o.goal, o.max).
  function gauge(data, o) {
    const v = data[0] ? data[0].value : 0;
    const max = o.max || o.goal * 1.25 || nice(v);
    const W = 300, H = 170, cx = 150, cy = 140, R = 110;
    const f = clamp(v / max, 0, 1);
    const a = Math.PI * (1 - f);
    const p = (ang, rad = R) => `${cx + rad * Math.cos(ang)},${cy - rad * Math.sin(ang)}`;
    const col = o.goal ? (v >= o.goal ? '#04844b' : v >= o.goal * 0.7 ? '#f59e0b' : '#e5484d') : color(0);
    return box(W, H, [
      svg('path', { d: `M ${p(Math.PI)} A ${R} ${R} 0 0 1 ${p(0)}`, class: 'track', fill: 'none', 'stroke-width': 22 }),
      svg('path', { d: `M ${p(Math.PI)} A ${R} ${R} 0 0 1 ${p(a)}`, stroke: col, fill: 'none', 'stroke-width': 22, 'stroke-linecap': 'round' }),
      o.goal ? svg('line', { x1: cx + (R - 16) * Math.cos(Math.PI * (1 - o.goal / max)), y1: cy - (R - 16) * Math.sin(Math.PI * (1 - o.goal / max)), x2: cx + (R + 16) * Math.cos(Math.PI * (1 - o.goal / max)), y2: cy - (R + 16) * Math.sin(Math.PI * (1 - o.goal / max)), class: 'goal' }) : null,
      svg('text', { x: cx, y: cy - 18, 'text-anchor': 'middle', class: 'big' }, o.format(v)),
      o.goal ? svg('text', { x: cx, y: cy + 2, 'text-anchor': 'middle', class: 'axis' }, `Goal ${o.format(o.goal)} · ${Math.round((v / o.goal) * 100)}%`) : null,
    ], 'gauge');
  }

  // stacked: { keys: ['Prospecting', …], series: [{ label, values: { key: n } }] } — a bar per key, a colour per series.
  function stacked(spec, o) {
    const { keys, series } = spec;
    const W = o.width || 520, H = o.height || 270, L = 48, T = 12, B = 66;
    const totals = keys.map((k) => sum(series, (s) => s.values[k] || 0));
    const max = nice(Math.max(...totals, 0));
    const bw = (W - L - 8) / Math.max(1, keys.length);
    const bars = keys.map((k, i) => {
      let y = H - B;
      return series.map((s, j) => {
        const v = s.values[k] || 0;
        const h0 = ((H - T - B) * v) / max;
        y -= h0;
        return v ? svg('rect', Object.assign({ x: L + i * bw + bw * 0.14, y, width: bw * 0.72, height: h0, fill: color(j), class: 'bar' }, click(o, { label: k, series: s.label, value: v })), svg('title', null, `${k} · ${s.label}: ${o.format(v)}`)) : null;
      });
    });
    const labels = keys.map((k, i) => svg('text', { x: L + i * bw + bw * 0.5, y: H - B + 15, 'text-anchor': 'middle', class: 'lbl' }, ellipsis(k, Math.max(4, Math.floor(bw / 6.5)))));
    let lx = L;
    const legend = series.slice(0, 8).map((s, j) => {
      const g = svg('g', null, svg('rect', { x: lx, y: H - 24, width: 10, height: 10, rx: 2, fill: color(j) }), svg('text', { x: lx + 14, y: H - 15, class: 'lbl' }, ellipsis(s.label, 14)));
      lx += 22 + Math.min(14, s.label.length) * 6.2;
      return g;
    });
    return box(W, H, [grid(W, H, L, T, B, max, o.axis || shortNum), bars, labels, legend]);
  }

  // spark: a tiny trend line for KPI tiles.
  function spark(data, o) {
    const W = 120, H = 34;
    const vals = data.map((d) => d.value);
    const max = Math.max(...vals, 0), min = Math.min(...vals, 0);
    const span = max - min || 1;
    const pts = vals.map((v, i) => `${(W * i) / Math.max(1, vals.length - 1)},${H - 3 - ((H - 6) * (v - min)) / span}`).join(' ');
    return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart spark', preserveAspectRatio: 'none' },
      svg('polyline', { points: pts, fill: 'none', stroke: o.color || color(0), 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
  }

  const TYPES = { bar, hbar, line, area: (d, o) => line(d, o, true), donut, pie: donut, funnel, gauge, stacked, spark };

  // draw(type, data, opts) → an <svg> (or an empty-state note when there's nothing to plot).
  function draw(type, data, opts = {}) {
    const o = Object.assign({ format: (v) => fmt.num(v) }, opts);
    const fn = TYPES[type] || bar;
    const empty = type === 'stacked' ? !(data && data.keys && data.keys.length) : !(data && data.length);
    if (empty) return h('div.chart-empty', 'No data to chart');
    return fn(data, o);
  }

  // From a DB.runReport result → chart data (top groups, with the rest folded into "Other").
  function fromReport(res, type, limit = 12) {
    if (type === 'stacked' && res.keys2) {
      const series = res.keys2.map((k2) => ({ label: k2, values: Object.fromEntries(res.groups.map((g) => [g.key, sum((g.sub || []).filter((s) => s.key === k2), (s) => s.value)])) }));
      return { keys: res.groups.map((g) => g.key), series };
    }
    const ordered = ['line', 'area'].includes(type);
    let g = res.groups.map((x) => ({ label: x.key, value: x.value, key: x.key }));
    if (!ordered && g.length > limit) {
      const rest = g.slice(limit - 1);
      g = g.slice(0, limit - 1).concat([{ label: 'Other', value: sum(rest, (x) => x.value), key: null }]);
    }
    return g;
  }

  // A value formatter for a report's aggregate (money for currency sums, plain numbers otherwise).
  function formatterFor(meta, agg) {
    if (!agg || agg.fn === 'count' || !agg.field) return (v) => fmt.num(v);
    const f = meta && meta.field[agg.field];
    if (f && (f.type === 'currency' || (f.type === 'formula' && f.format === 'currency') || f.type === 'rollup')) return agg.fn === 'avg' ? (v) => fmt.money(v) : (v) => fmt.short(v);
    if (f && f.type === 'percent') return (v) => fmt.pct(v);
    return (v) => fmt.num(v);
  }

  return { draw, fromReport, formatterFor, color, PALETTE, types: Object.keys(TYPES) };
})();
