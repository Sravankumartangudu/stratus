// datacloud.js — Data Cloud: one profile per person, built from everything the org knows.
//
//   Pages.profiles  Customer 360: a person's contact, matching leads, account, orders, cases, campaigns and
//                   web/email/app events on one timeline, with lifetime value, engagement and churn risk
//   Pages.streams   the data streams feeding Data Cloud: counts, freshness, field mapping, "Refresh now"
//   Pages.identity  match rules → duplicate clusters across Contacts, Leads and outside records, merge with undo
//   Pages.insights  calculated insights (value by tier, industry…) and the segment builder
//
// Scores here are rule-based (they need no AI). ✨ writes the summary, the offer, the match explanation,
// the field mapping and the segment rules — it only drafts; the user clicks to apply.
// Small amounts of state (rules on/off, merges, links) live in org.prefs.dc so they survive restarts.

const DataCloud = (() => {
  const store = () => {
    const p = DB.org().prefs || (DB.org().prefs = {});
    const d = p.dc || (p.dc = {});
    return Object.assign(d, { rules: d.rules || {}, links: d.links || {}, merges: d.merges || [], notMatch: d.notMatch || [], extra: d.extra || [], activations: d.activations || [] });
  };
  const lc = (s) => String(s == null ? '' : s).trim().toLowerCase();
  const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);
  const nowIso = () => new Date().toISOString();
  const money = (n) => fmt.money(n);
  const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  // ---------- Customer 360: one calculated row per person ----------

  const WEST = ['San Francisco', 'Sacramento', 'Oakland', 'Fremont', 'Berkeley', 'Stockton', 'San Jose', 'Modesto', 'Walnut Creek', 'Santa Rosa', 'Palo Alto', 'San Mateo', 'Hayward', 'Mountain View', 'Napa', 'Sunnyvale', 'Seattle', 'Phoenix', 'Denver', 'Portland', 'Los Angeles', 'San Diego'];
  const CENTRAL = ['Chicago', 'Austin', 'Dallas', 'Houston', 'Minneapolis'];
  const regionOf = (city, country) => {
    if (country && !/united states|usa|^us$/i.test(country)) return 'International';
    if (WEST.includes(city)) return 'West';
    if (CENTRAL.includes(city)) return 'Central';
    return city ? 'East' : 'Unknown';
  };
  const EVENT_W = { 'Web visit': 2, 'Product view': 1, 'Email open': 2, 'Email click': 4, 'App login': 3, 'Cart abandoned': 3, 'Support chat': 2 };
  const EVENT_ICON = { 'Web visit': '🌐', 'Product view': '👀', 'Email open': '📬', 'Email click': '🖱️', 'App login': '📱', 'Cart abandoned': '🛒', 'Support chat': '💬' };
  const bandOf = (n) => (n >= 60 ? 'High' : n >= 35 ? 'Medium' : 'Low');

  let cache = null;
  let idCache = null;
  DB.on(() => { cache = null; idCache = null; });

  function profiles() {
    if (cache) return cache;
    const org = DB.org();
    const day = today();
    const evBy = groupBy(org.events, (e) => e.contactId);
    const ordBy = groupBy(DB.all('Order').filter((o) => o.Status !== 'Canceled'), (o) => o.BillToContactId);
    const caseBy = groupBy(DB.all('Case'), (c) => c.ContactId);
    const wonBy = groupBy(DB.all('Opportunity').filter((o) => o.StageName === 'Closed Won'), (o) => o.ContactId);
    const memBy = groupBy(DB.all('CampaignMember').filter((m) => m.ContactId), (m) => m.ContactId);
    const health = {};
    cache = DB.all('Contact').map((c) => {
      const acct = c.AccountId ? DB.get(c.AccountId) : null;
      const consumer = !!acct && /\(B2C\)/.test(acct.Name);
      if (acct && health[acct.Id] == null) health[acct.Id] = Predict.health(acct).score;
      const orders = ordBy[c.Id] || [];
      const won = wonBy[c.Id] || [];
      const cases = caseBy[c.Id] || [];
      const events = evBy[c.Id] || [];
      const openCases = cases.filter((x) => x.Status !== 'Closed');
      const maxRisk = openCases.reduce((m, x) => Math.max(m, Predict.caseRisk(x).score), 0);
      const lastOrder = orders.map((o) => o.EffectiveDate).sort().pop() || null;
      const lastOrderDays = lastOrder ? daysBetween(lastOrder, day) : null;
      const ago = (e) => daysBetween(String(e.at).slice(0, 10), day);
      let raw = 0;
      for (const e of events) raw += (EVENT_W[e.type] || 1) * Math.pow(0.5, ago(e) / 21);
      const engagement = Math.round(100 * (1 - Math.exp(-raw / 10)));
      const count = (t, days) => events.filter((e) => e.type === t && ago(e) <= days).length;
      const lastTouch = events.length ? Math.min(...events.map(ago)) : null;
      const hs = acct ? health[acct.Id] : 60;
      const reasons = [];
      let churn = 25;
      if (hs < 60) { churn += (60 - hs) * 0.6; reasons.push(`Account health is ${hs}`); } else if (hs >= 80) { churn -= 8; reasons.push(`Healthy account (${hs})`); }
      if (maxRisk >= 40) { churn += Math.round(maxRisk * 0.3); reasons.push(`An open case with risk ${maxRisk}`); }
      if (engagement < 15) { churn += 12; reasons.push('Little recent engagement'); } else if (engagement >= 60) { churn -= 10; reasons.push('Highly engaged lately'); }
      if (lastOrderDays != null && lastOrderDays > 90) { churn += 10; reasons.push(`No order in ${lastOrderDays} days`); }
      if (c.HasOptedOutOfEmail) { churn += 6; reasons.push('Opted out of email'); }
      churn = clamp(Math.round(churn), 1, 99);
      const tier = consumer ? 'Consumer' : acct ? (acct.SLA || (acct.Type === 'Prospect' ? 'Prospect' : 'Standard')) : 'No account';
      return {
        id: c.Id, name: c.Name, rec: c, acct, acctName: acct ? acct.Name : '', title: c.Title || '', email: c.Email || '', phone: c.Phone || c.MobilePhone || '', city: c.MailingCity || '',
        region: regionOf(c.MailingCity, c.MailingCountry), consumer, homeowner: consumer, tier, industry: acct && acct.Industry ? acct.Industry : 'None', leadSource: c.LeadSource || 'Unknown',
        orders, won, cases, events, members: memBy[c.Id] || [],
        ltv: Math.round(sum(orders, (o) => o.TotalAmount) + sum(won, (o) => o.Amount)), orderCount: orders.length, bought: orders.length + won.length > 0, lastOrderDays,
        engagement, opens: count('Email open', 60), clicks: count('Email click', 60), visits: count('Web visit', 60) + count('Product view', 60), logins: count('App login', 60),
        abandoned: count('Cart abandoned', 7), abandoned30: count('Cart abandoned', 30), eventCount: events.length, lastTouch,
        openCases: openCases.length, caseRisk: maxRisk, health: hs, churn, churnBand: bandOf(churn), churnReasons: reasons, optOut: !!c.HasOptedOutOfEmail,
      };
    });
    return cache;
  }

  // Attributes a segment can filter on (unified-profile segments). kind: num, pick, bool, text.
  const ATTRS = [
    { name: 'ltv', label: 'Lifetime value ($)', kind: 'num' },
    { name: 'orderCount', label: 'Orders placed', kind: 'num' },
    { name: 'bought', label: 'Has purchased', kind: 'bool' },
    { name: 'lastOrderDays', label: 'Days since last order', kind: 'num' },
    { name: 'engagement', label: 'Engagement score', kind: 'num' },
    { name: 'opens', label: 'Email opens (60 days)', kind: 'num' },
    { name: 'clicks', label: 'Email clicks (60 days)', kind: 'num' },
    { name: 'visits', label: 'Web visits (60 days)', kind: 'num' },
    { name: 'abandoned', label: 'Carts abandoned (7 days)', kind: 'num' },
    { name: 'churn', label: 'Churn risk', kind: 'num' },
    { name: 'openCases', label: 'Open cases', kind: 'num' },
    { name: 'health', label: 'Account health', kind: 'num' },
    { name: 'homeowner', label: 'Homeowner (online shopper)', kind: 'bool' },
    { name: 'optOut', label: 'Opted out of email', kind: 'bool' },
    { name: 'region', label: 'Region', kind: 'pick', options: ['West', 'Central', 'East', 'International'] },
    { name: 'tier', label: 'Account tier', kind: 'pick', options: ['Platinum', 'Gold', 'Silver', 'Bronze', 'Consumer', 'Prospect', 'Standard'] },
    { name: 'industry', label: 'Industry', kind: 'pick', options: ['None', ...(typeof INDUSTRIES !== 'undefined' ? INDUSTRIES : [])] },
    { name: 'leadSource', label: 'Lead source', kind: 'pick', options: typeof SOURCES !== 'undefined' ? SOURCES : [] },
    { name: 'city', label: 'City', kind: 'text' },
    { name: 'title', label: 'Job title', kind: 'text' },
  ];
  const attrOf = (n) => ATTRS.find((a) => a.name === n);
  const OPS_BY_KIND = {
    num: [['gt', 'is more than'], ['ge', 'is at least'], ['lt', 'is less than'], ['le', 'is at most'], ['eq', 'equals']],
    pick: [['eq', 'is'], ['ne', 'is not']],
    bool: [['eq', 'is']],
    text: [['contains', 'contains'], ['eq', 'equals']],
  };
  const OP_WORD = { gt: '>', ge: '≥', lt: '<', le: '≤', eq: '=', ne: '≠', contains: 'contains', in: 'in', notin: 'not in' };
  function passes(row, [f, op, v]) {
    const x = row[f];
    const n = Number;
    switch (op) {
      case 'eq': return typeof x === 'boolean' ? x === (v === true || /^(true|yes)$/i.test(String(v))) : lc(x) === lc(v);
      case 'ne': return lc(x) !== lc(v);
      case 'gt': return x != null && n(x) > n(v);
      case 'ge': return x != null && n(x) >= n(v);
      case 'lt': return x != null && n(x) < n(v);
      case 'le': return x != null && n(x) <= n(v);
      case 'contains': return lc(x).includes(lc(v));
      case 'in': return [].concat(v).some((w) => lc(w) === lc(x));
      case 'notin': return ![].concat(v).some((w) => lc(w) === lc(x));
      default: return true;
    }
  }
  const unifiedRows = (filters) => profiles().filter((r) => (filters || []).every((f) => passes(r, f)));
  const ruleText = (f) => { const a = attrOf(f[0]); return `${a ? a.label : f[0]} ${OP_WORD[f[1]] || f[1]} ${typeof f[2] === 'boolean' ? (f[2] ? 'Yes' : 'No') : Array.isArray(f[2]) ? f[2].join(', ') : f[2]}`; };

  // People in a Segment record, whichever object it was built on.
  function segmentIds(seg) {
    const filters = (seg.Criteria && seg.Criteria.filters) || [];
    try {
      if (seg.Source === 'Unified Profile') return unifiedRows(filters).map((r) => r.id);
      return DB.query(seg.Source === 'Lead' ? 'Lead' : 'Contact', { filters }).map((r) => r.Id);
    } catch (e) { return []; }
  }

  // ---------- identity resolution ----------

  const lev = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  const ratio = (a, b) => (!a || !b ? 0 : a === b ? 1 : 1 - lev(a, b) / Math.max(a.length, b.length));
  const parseName = (n) => {
    const t = lc(n).replace(/[^a-z\s.'-]/g, '').split(/\s+/).filter(Boolean);
    return t.length < 2 ? { first: t[0] || '', last: '' } : { first: t[0].replace(/\./g, ''), last: t[t.length - 1] };
  };
  function nameSim(a, b) {
    const A = parseName(a.name), B = parseName(b.name);
    if (!A.last || !B.last) return 0;
    const last = ratio(A.last, B.last);
    const initial = (A.first.length === 1 || B.first.length === 1) && A.first[0] === B.first[0];
    const first = A.first === B.first ? 1 : initial ? 0.85 : A.first[0] === B.first[0] ? ratio(A.first, B.first) * 0.9 : ratio(A.first, B.first) * 0.5;
    return 0.35 * first + 0.65 * last;
  }
  const sharePhone = (a, b) => a.phones.some((p) => p && b.phones.includes(p));
  const emailConflict = (a, b) => a.email && b.email && a.email !== b.email;

  const RULES = [
    { id: 'email', label: 'Exact email', desc: 'The same email address, ignoring capital letters.',
      test: (a, b) => (a.email && a.email === b.email ? { c: 100, why: `same email (${a.email})` } : null) },
    { id: 'phone', label: 'Phone + similar name', desc: 'The same phone number and a name that looks alike (an initial counts).',
      test: (a, b) => {
        if (!sharePhone(a, b)) return null;
        const s = nameSim(a, b);
        if (s >= 0.6) return { c: Math.round(78 + s * 20) - (emailConflict(a, b) ? 6 : 0), why: `same phone number, names ${Math.round(s * 100)}% alike` };
        return !a.name || !b.name ? { c: 76, why: 'same phone number (one record has no name)' } : null;
      } },
    { id: 'name', label: 'Fuzzy name + city', desc: 'Names that are almost the same, in the same city.',
      test: (a, b) => {
        const s = nameSim(a, b);
        if (s < 0.9 || !a.city || a.city !== b.city) return null;
        return { c: Math.round(40 + s * 45) - (emailConflict(a, b) ? 8 : 0), why: `names ${Math.round(s * 100)}% alike, both in ${a.city}` };
      } },
    { id: 'company', label: 'Name + company', desc: 'A lead and a contact with the same last name, first initial and company.',
      test: (a, b) => {
        if (!a.company || lc(a.company) !== lc(b.company)) return null;
        const s = nameSim(a, b);
        return s >= 0.85 ? { c: Math.round(66 + s * 24) - (emailConflict(a, b) ? 8 : 0), why: `names ${Math.round(s * 100)}% alike at ${a.company}` } : null;
      } },
  ];
  const ruleOn = (id) => store().rules[id] !== false;
  const MIN_CONF = 70;

  function records() {
    const st = store();
    const mergedLeads = new Set(st.merges.filter((m) => !m.undone).map((m) => m.leadId));
    const out = [];
    for (const c of DB.all('Contact')) {
      const a = c.AccountId ? DB.get(c.AccountId) : null;
      out.push({ key: 'C' + c.Id, type: 'Contact', id: c.Id, name: c.Name, email: lc(c.Email), phones: [digits(c.Phone), digits(c.MobilePhone)].filter(Boolean), city: c.MailingCity || '', company: a ? a.Name : '', sys: 'Stratus CRM', rec: c });
    }
    for (const l of DB.all('Lead')) {
      if (l.Status === 'Closed - Converted' && !mergedLeads.has(l.Id)) continue;
      out.push({ key: 'L' + l.Id, type: 'Lead', id: l.Id, name: l.Name, email: lc(l.Email), phones: [digits(l.Phone)].filter(Boolean), city: l.City || '', company: l.Company || '', sys: 'Stratus CRM', rec: l });
    }
    for (const s of DB.org().sources) {
      out.push({ key: 'S' + s.id, type: 'Source', id: s.id, name: s.name || '', email: lc(s.email), phones: [digits(s.phone)].filter(Boolean), city: '', company: '', sys: s.source, rec: s });
    }
    return out;
  }

  function resolve() {
    if (idCache) return idCache;
    const st = store();
    const recs = records();
    const byKey = Object.fromEntries(recs.map((r) => [r.key, r]));
    const parent = {};
    const find = (k) => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
    for (const r of recs) parent[r.key] = r.key;
    const edges = [];
    const skip = new Set(st.notMatch);
    const edge = (a, b, c, why, rules, forced) => { edges.push({ a: a.key, b: b.key, c, why, rules, forced }); parent[find(a.key)] = find(b.key); };
    for (let i = 0; i < recs.length; i++) {
      for (let j = i + 1; j < recs.length; j++) {
        const a = recs[i], b = recs[j];
        if (skip.has(a.key + '|' + b.key) || skip.has(b.key + '|' + a.key)) continue;
        if (!(a.email && a.email === b.email) && !sharePhone(a, b) && !(a.name && b.name && lc(a.name)[0] === lc(b.name)[0] && parseName(a.name).last[0] === parseName(b.name).last[0])) continue;
        let best = null;
        const hit = [];
        for (const rule of RULES) {
          if (!ruleOn(rule.id)) continue;
          const t = rule.test(a, b);
          if (t && t.c >= MIN_CONF) { hit.push(rule); if (!best || t.c > best.c) best = t; }
        }
        if (best) edge(a, b, best.c, best.why, hit.map((x) => x.id), false);
      }
    }
    // What the user already decided: merged leads and linked outside records.
    for (const m of st.merges) if (!m.undone && byKey['L' + m.leadId] && byKey['C' + m.contactId]) edge(byKey['L' + m.leadId], byKey['C' + m.contactId], 100, 'merged by you', [], true);
    for (const [sid, cid] of Object.entries(st.links)) if (byKey['S' + sid] && byKey['C' + cid]) edge(byKey['S' + sid], byKey['C' + cid], 100, 'linked by you', [], true);
    const groups = groupBy(recs, (r) => find(r.key));
    const clusters = Object.values(groups).map((members) => {
      const keys = new Set(members.map((m) => m.key));
      const es = edges.filter((e) => keys.has(e.a));
      const order = { Contact: 0, Lead: 1, Source: 2 };
      members.sort((x, y) => order[x.type] - order[y.type] || x.name.localeCompare(y.name));
      return { id: members[0].key, members, edges: es, conf: es.length ? Math.min(...es.map((e) => e.c)) : 100, pending: es.some((e) => !e.forced), survivor: members[0] };
    });
    const dupes = clusters.filter((c) => c.members.length > 1).sort((a, b) => Number(b.pending) - Number(a.pending) || b.conf - a.conf || b.members.length - a.members.length);
    idCache = { recs, clusters, dupes, byKey, stats: { records: recs.length, profiles: clusters.length, rate: recs.length ? Math.round((1 - clusters.length / recs.length) * 1000) / 10 : 0 } };
    return idCache;
  }

  // The "golden record": the best value for each field across the cluster.
  function golden(cl) {
    const pick = (f) => { const m = cl.members.find((x) => x[f]); return m ? m[f] : ''; };
    const phone = cl.members.flatMap((m) => m.phones)[0];
    const lead = cl.members.find((m) => m.type === 'Lead');
    return { name: pick('name'), email: (cl.members.find((m) => m.type !== 'Source' && m.rec.Email) || {}).rec ? (cl.members.find((m) => m.type !== 'Source' && m.rec.Email)).rec.Email : pick('email'), phone: phone ? fmtPhone(phone) : '', company: pick('company'), city: pick('city'),
      systems: uniq(cl.members.map((m) => m.sys)), score: lead ? lead.rec.Score : null };
  }
  const fmtPhone = (d) => (d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d);

  // Merge a lead into a contact: the lead is marked converted to that contact and its tasks and campaign
  // memberships move over. Everything needed to undo it is kept.
  function mergeLead(leadId, contactId) {
    const lead = DB.get(leadId), con = DB.get(contactId);
    if (!lead || !con) throw new Error('One of the records is gone.');
    const snap = { Status: lead.Status, ConvertedAccountId: lead.ConvertedAccountId || null, ConvertedContactId: lead.ConvertedContactId || null, ConvertedOpportunityId: lead.ConvertedOpportunityId || null };
    const tasks = DB.all('Task').filter((t) => t.WhoId === leadId).map((t) => t.Id);
    const members = DB.all('CampaignMember').filter((m) => m.LeadId === leadId && !m.ContactId).map((m) => m.Id);
    for (const id of tasks) DB.update(id, { WhoId: contactId }, { raw: true });
    for (const id of members) DB.update(id, { ContactId: contactId }, { raw: true });
    const st = store();
    const entry = { id: DB.uid('mg'), leadId, contactId, snap, tasks, members, at: nowIso() };
    st.merges.push(entry);
    DB.update(leadId, { Status: 'Closed - Converted', ConvertedContactId: contactId, ConvertedAccountId: con.AccountId || null });
    return entry;
  }
  function undoMerge(entry) {
    for (const id of entry.tasks) if (DB.get(id)) DB.update(id, { WhoId: entry.leadId }, { raw: true });
    for (const id of entry.members) if (DB.get(id)) DB.update(id, { ContactId: null }, { raw: true });
    entry.undone = true;
    if (DB.get(entry.leadId)) DB.update(entry.leadId, entry.snap);
    else DB.save();
  }

  // ---------- Customer 360 page ----------

  const pst = { q: '', filter: 'all', showAll: false };
  const FILTERS = [['all', 'Everyone'], ['shoppers', 'Shoppers'], ['accounts', 'Business'], ['risk', 'At risk']];
  const filterRows = (rows) => {
    const q = lc(pst.q);
    return rows.filter((r) => (pst.filter === 'all' || (pst.filter === 'shoppers' && r.consumer) || (pst.filter === 'accounts' && !r.consumer) || (pst.filter === 'risk' && r.churn >= 60))
      && (!q || lc(r.name + ' ' + r.email + ' ' + r.acctName + ' ' + r.title + ' ' + r.city).includes(q)));
  };
  const tone = (n, bad = true) => (bad ? (n >= 60 ? 'var(--bad)' : n >= 35 ? 'var(--warn)' : 'var(--ok)') : (n >= 60 ? 'var(--ok)' : n >= 30 ? 'var(--warn)' : 'var(--bad)'));

  function timeline(p) {
    const items = [];
    for (const o of p.orders) items.push({ at: o.EffectiveDate + 'T12:00:00', kind: 'Orders', icon: '🛒', title: `Order ${o.OrderNumber}`, text: `${money(o.TotalAmount)} · ${o.Status}${o.Channel ? ' · ' + o.Channel : ''}`, id: o.Id });
    for (const o of p.won) items.push({ at: o.CloseDate + 'T12:00:00', kind: 'Orders', icon: '👑', title: `Won: ${o.Name}`, text: money(o.Amount), id: o.Id });
    for (const c of p.cases) items.push({ at: c.CreatedDate, kind: 'Cases', icon: '💼', title: `Case ${c.CaseNumber}`, text: `${c.Subject} · ${c.Priority} · ${c.Status}`, id: c.Id });
    for (const e of p.events) items.push({ at: e.at, kind: 'Engagement', icon: EVENT_ICON[e.type] || '•', title: e.type, text: `${e.channel} · ${e.detail}${e.value ? ' · ' + money(e.value) : ''}` });
    for (const m of p.members) items.push({ at: m.CreatedDate, kind: 'Campaigns', icon: '📣', title: DB.name(m.CampaignId) || 'Campaign', text: `Campaign member · ${m.Status}`, id: m.CampaignId });
    const leadIds = leadsOf(p).map((l) => l.id);
    for (const a of [...DB.activity(p.id), ...leadIds.flatMap((id) => DB.activity(id))]) {
      const obj = DB.objectOf(a.Id);
      const at = a.MessageDate || a.StartDateTime || (a.ActivityDate ? a.ActivityDate + 'T12:00:00' : a.CreatedDate);
      items.push({ at, kind: obj === 'EmailMessage' ? 'Emails' : 'Activity', icon: obj === 'EmailMessage' ? '✉️' : obj === 'Event' ? '📅' : '✅', title: a.Subject, text: obj === 'EmailMessage' ? (a.Incoming ? 'Received' : 'Sent') + (a.TextBody ? ' · ' + a.TextBody.slice(0, 90) : '') : (a.Status || ''), id: a.Id });
    }
    return items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }
  // Other records the identity rules tie to this person (leads, app and POS profiles).
  function leadsOf(p) {
    const cl = resolve().clusters.find((c) => c.members.some((m) => m.key === 'C' + p.id));
    return cl ? cl.members.filter((m) => m.type === 'Lead') : [];
  }
  const linkedOf = (p) => { const cl = resolve().clusters.find((c) => c.members.some((m) => m.key === 'C' + p.id)); return cl ? cl.members.filter((m) => m.key !== 'C' + p.id) : []; };

  const FAMILY_NEXT = { Solar: ['Battery', 'Smart Home', 'EV Charging'], Battery: ['EV Charging', 'Smart Home'], 'EV Charging': ['Smart Home', 'Battery'], 'Smart Home': ['Battery', 'Solar'], Software: ['Services'], Services: ['Software', 'Accessories'], Accessories: ['Battery'] };
  const PAGE_FAMILY = { '/battery': 'Battery', '/solar-calculator': 'Solar', '/shop/thermostat': 'Smart Home', '/ev-charging': 'EV Charging', '/shop/chargedock-home': 'EV Charging' };
  // Rule-based next best offer: what they looked at, what they own, what usually comes next.
  function nextOffer(p) {
    const owned = new Set();
    const fam = {};
    const orderIds = new Set(p.orders.map((o) => o.Id));
    for (const i of DB.all('OrderItem').filter((x) => orderIds.has(x.OrderId))) { owned.add(i.Product2Id); const pr = DB.get(i.Product2Id); if (pr) fam[pr.Family] = (fam[pr.Family] || 0) + 1; }
    const interest = {};
    for (const e of p.events) { const f = PAGE_FAMILY[e.detail]; if (f) interest[f] = (interest[f] || 0) + 1; }
    const score = {};
    for (const f of Object.keys(fam)) (FAMILY_NEXT[f] || []).forEach((n, i) => { score[n] = (score[n] || 0) + 3 - i; });
    for (const [f, n] of Object.entries(interest)) score[f] = (score[f] || 0) + n * 2;
    if (!Object.keys(score).length) score[p.consumer ? 'Solar' : 'Software'] = 1;
    const products = DB.all('Product2').filter((x) => x.IsActive !== false && !owned.has(x.Id) && x.Stock !== 0);
    const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
    for (const [f] of ranked) {
      const pick = products.filter((x) => x.Family === f && (p.consumer ? x.ListPrice < 20000 : true)).sort((a, b) => (b.Rating || 0) - (a.Rating || 0))[0];
      if (!pick) continue;
      const why = [];
      if (interest[f]) why.push(`looked at ${f.toLowerCase()} pages ${interest[f]} time${interest[f] > 1 ? 's' : ''}`);
      const bought = Object.keys(fam).find((b) => (FAMILY_NEXT[b] || []).includes(f));
      if (bought) why.push(`already owns ${bought.toLowerCase()}, and ${f.toLowerCase()} is the usual next step`);
      if (!why.length) why.push('a popular first purchase');
      const channel = p.optOut ? 'Phone or in-app' : p.opens > 0 ? 'Email' : p.logins > 0 ? 'In-app message' : p.consumer ? 'Web retargeting' : 'Account manager call';
      return { product: pick, reason: `${p.name.split(' ')[0]} ${why.join(' and ')}.`, channel };
    }
    return null;
  }

  function personFacts(p) {
    const lines = [
      `Person: ${p.name} [[${p.id}]], ${p.title || 'no title'} at ${p.acctName || 'no account'}, ${p.city || 'unknown city'} (${p.region}). Tier: ${p.tier}.`,
      `Lifetime value ${money(p.ltv)} from ${p.orderCount} order${p.orderCount === 1 ? '' : 's'}${p.lastOrderDays != null ? `, last order ${p.lastOrderDays} days ago` : ''}.`,
      `Engagement score ${p.engagement}/100 (60 days: ${p.opens} email opens, ${p.clicks} clicks, ${p.visits} web visits, ${p.logins} app logins, ${p.abandoned30} abandoned carts).`,
      `Churn risk ${p.churn}/100 (${p.churnBand}). Reasons: ${p.churnReasons.join('; ') || 'none notable'}.`,
      `Open cases: ${p.openCases}${p.caseRisk ? ` (highest risk ${p.caseRisk})` : ''}. Email opt-out: ${p.optOut ? 'yes' : 'no'}.`,
    ];
    const cs = p.cases.slice(0, 4).map((c) => `- Case ${c.CaseNumber}: ${c.Subject} (${c.Status})`);
    if (cs.length) lines.push('Cases:\n' + cs.join('\n'));
    const cm = p.members.slice(0, 5).map((m) => `- ${DB.name(m.CampaignId)}: ${m.Status}`);
    if (cm.length) lines.push('Campaigns:\n' + cm.join('\n'));
    return lines.join('\n');
  }

  function profileView(p, ctx) {
    const linked = linkedOf(p);
    const segs = DB.all('Segment').filter((s) => segmentIds(s).includes(p.id));
    const items = timeline(p);
    const kinds = ['All', ...uniq(items.map((i) => i.kind))];
    const ts = pst.tl || (pst.tl = { kind: 'All', all: false });
    const tlBox = h('div.dc-timeline');
    const drawTl = () => {
      const list = items.filter((i) => ts.kind === 'All' || i.kind === ts.kind);
      const shown = ts.all ? list : list.slice(0, 14);
      tlBox.replaceChildren(shown.length ? shown.map((i) => h('div.dc-tl', h('span.dc-tl-ic', i.icon), h('div.dc-tl-body',
        h('div', i.id ? h('a.reclink', { href: '#/r/' + i.id }, i.title) : h('b', i.title), h('span.dc-tl-kind', i.kind)), h('small', i.text)), h('small.dc-tl-when', fmt.ago(i.at))))
        : h('p.muted', 'Nothing on the timeline yet.'),
      list.length > 14 ? h('button.link', { onclick: () => { ts.all = !ts.all; drawTl(); } }, ts.all ? 'Show less' : `Show all ${list.length}`) : null);
    };
    drawTl();
    const kindBar = h('div.chips', kinds.map((k) => h(`button.chip${ts.kind === k ? '.on' : ''}`, { onclick: (e) => { ts.kind = k; drawTl(); $$('.chip', e.currentTarget.parentNode).forEach((c) => c.classList.toggle('on', c.textContent === k)); } }, k)));
    const mix = Object.entries(groupBy(p.events, (e) => e.type)).map(([k, v]) => ({ label: k, value: v.length })).sort((a, b) => b.value - a.value);
    const offer = nextOffer(p);
    const offerBox = offer ? h('div.dc-offer', h('span.dc-offer-ic', DB.get(offer.product.Id).Image || '🎁'),
      h('div.grow', h('b', offer.product.Name), h('small', ` ${money(offer.product.ListPrice)} · ${offer.product.Family}`), h('div', offer.reason), h('small.muted', `Best channel: ${offer.channel}`))) : h('p.muted', 'No offer fits right now.');
    const makeTask = (name, why) => h('button.btn.sm', { onclick: () => {
      const t = DB.insert('Task', { Subject: `Offer ${name} to ${p.name}`, Type: 'Follow Up', Status: 'Not Started', Priority: 'Normal', ActivityDate: addDays(today(), 2), WhoId: p.id, Description: why || '' });
      UI.toast('Follow-up task created', 'ok', { label: 'Open', run: () => Shell.go('#/r/' + t.Id) });
    } }, '+ Follow-up task');
    return h('div.dc-profile',
      h('section.card.dc-id', h('div.card-body',
        UI.avatar(p.name, 56),
        h('div.grow', h('h2', p.name, ' ', UI.badge(p.tier, 'var(--accent)')),
          h('div.muted', [p.title, p.acct ? h('a.reclink', { href: '#/r/' + p.acct.Id }, p.acctName) : null].filter(Boolean).map((x, i) => (i ? [' at ', x] : x))),
          h('div.dc-facts', [p.email && `✉️ ${p.email}`, p.phone && `📞 ${p.phone}`, p.city && `📍 ${p.city} · ${p.region}`].filter(Boolean).map((t) => h('span', t))),
          h('div.dc-sources', h('small.muted', 'Unified from '), h('span.chip', { title: 'Contact record' }, '📇 Stratus CRM'), linked.map((m) => h('span.chip', { title: `${m.name || 'Unnamed'} ${m.email || ''}` }, (m.type === 'Lead' ? '⭐ Lead' : m.type === 'Source' ? '🔗 ' + m.sys : '📇 Contact'))),
            events(p).length ? h('span.chip', '🌐 Web & mobile events') : null)),
        h('div.btnrow', h('a.btn', { href: '#/r/' + p.id }, 'Open contact'), h('button.btn', { onclick: () => Shell.go('#/app/datacloud/identity') }, 'Identity matches')))),
      h('div.kpis',
        UI.stat('Lifetime value', money(p.ltv), `${p.orderCount} order${p.orderCount === 1 ? '' : 's'}${p.won.length ? ` + ${p.won.length} won deal${p.won.length > 1 ? 's' : ''}` : ''}`, 'var(--ok)'),
        UI.stat('Engagement score', `${p.engagement}/100`, p.lastTouch != null ? `last activity ${p.lastTouch === 0 ? 'today' : p.lastTouch + 'd ago'}` : 'no activity yet', tone(p.engagement, false)),
        UI.stat('Churn risk', `${p.churn}/100`, `${p.churnBand}${p.churnReasons[0] ? ' · ' + p.churnReasons[0] : ''}`, tone(p.churn)),
        UI.stat('Open cases', String(p.openCases), p.caseRisk ? `highest risk ${p.caseRisk}` : 'none at risk', p.openCases ? 'var(--warn)' : 'var(--ok)'),
        UI.stat('Account health', String(p.health), p.acctName || '—', tone(p.health, false))),
      h('div.dc-cols',
        UI.card('Timeline', h('div', kindBar, tlBox), { icon: '🕒', count: items.length }),
        h('div.dc-side',
          Einstein.card({ key: 'dc-sum:' + p.id, title: 'Profile summary', label: 'Summarize this person', icon: '✨', intro: 'A short read on who this is and what to do next, from everything on this page.',
            ask: () => ({ task: 'datacloud-profile-summary', prompt: `Write a short summary (3-4 sentences) of this customer for a rep about to contact them, then up to 3 next steps.\n\n${personFacts(p)}`,
              schema: Einstein.S.obj({ summary: Einstein.S.str('3-4 sentences'), nextSteps: Einstein.S.arr(Einstein.S.str('one short action'), 'up to 3') }) }),
            render: (r) => h('div', md(r.summary), h('ul', (r.nextSteps || []).map((x) => h('li', x)))) }),
          Einstein.card({ key: 'dc-nbo:' + p.id, title: 'Next best offer', label: `Ask ${Einstein.word()} for an offer`, icon: '🎁', intro: h('div', offerBox, h('small.muted', 'Rule-based from browsing and purchases.'), h('div.btnrow', offer ? makeTask(offer.product.Name, offer.reason) : null)),
            ask: () => ({ task: 'datacloud-next-offer', prompt: `Recommend ONE product from this catalog for the customer, with the reason from their data and the best channel.\n\nCatalog (use these names exactly):\n${DB.all('Product2').filter((x) => x.IsActive !== false).map((x) => `- ${x.Name} (${x.Family}, ${money(x.ListPrice)})`).join('\n')}\n\nAlready bought: ${[...new Set(p.orders.flatMap((o) => DB.all('OrderItem').filter((i) => i.OrderId === o.Id).map((i) => DB.name(i.Product2Id))))].join(', ') || 'nothing'}\n\n${personFacts(p)}\nRecent engagement: ${p.events.slice(0, 10).map((e) => `${e.type} ${e.detail}`).join('; ') || 'none'}`,
              schema: Einstein.S.obj({ product: Einstein.S.str('exact product name from the catalog'), reason: Einstein.S.str('one or two sentences using the customer data'), channel: Einstein.S.str('best channel to reach them'), message: Einstein.S.str('a one-line pitch') }) }),
            render: (r) => {
              const pr = DB.all('Product2').find((x) => lc(x.Name) === lc(r.product));
              return h('div.dc-offer', h('span.dc-offer-ic', pr ? pr.Image || '🎁' : '🎁'), h('div.grow', h('b', r.product), pr ? h('small', ` ${money(pr.ListPrice)} · ${pr.Family}`) : h('small.err', ' (not in the catalog)'), h('div', r.reason), r.message ? h('div.dc-pitch', `“${r.message}”`) : null, h('small.muted', `Best channel: ${r.channel}`)));
            },
            actions: (r) => [makeTask(r.product, r.reason)] }),
          UI.card('Why this churn score', h('ul.plain', p.churnReasons.length ? p.churnReasons.map((x) => h('li', x)) : [h('li.muted', 'Nothing unusual.')]), { icon: '📉' }),
          UI.card('Engagement mix', mix.length ? Charts.draw('hbar', mix, { single: true, height: 150 }) : h('p.muted', 'No events yet.'), { icon: '📊' }),
          UI.card('Segments', segs.length ? h('div.chips', segs.map((s) => h('a.chip', { href: '#/r/' + s.Id }, '🎯 ' + s.Name))) : h('p.muted', 'Not in any segment yet.'), { icon: '🎯', count: segs.length }))));
  }
  const events = (p) => p.events;

  Pages.profiles = { title: 'Profiles', icon: '🧬', render: (ctx) => {
    const rows = profiles();
    const ranked = rows.slice().sort((a, b) => b.engagement - a.engagement || b.ltv - a.ltv);
    const sel = rows.find((r) => r.id === ctx.params.id) || ranked[0];
    const listBox = h('div.dc-plist', { dataset: { scroll: 'dc-plist' } });
    const count = h('small.muted');
    const drawList = () => {
      const list = filterRows(ranked);
      count.textContent = `${list.length} of ${rows.length} people`;
      listBox.replaceChildren(list.slice(0, 60).map((r) => h(`button.dc-person${sel && r.id === sel.id ? '.on' : ''}`, { onclick: () => ctx.set({ id: r.id }) },
        UI.avatar(r.name, 30), h('div.grow', h('div.dc-pname', r.name), h('small', r.acctName || r.city || '')),
        h('span.score.sm', { style: { '--s': tone(r.engagement, false) }, title: 'Engagement score' }, r.engagement))), list.length > 60 ? h('small.muted.pad', `Showing 60. Search to narrow down.`) : null,
      list.length ? null : h('p.muted.pad', 'No one matches.'));
    };
    const search = h('input', { type: 'search', placeholder: 'Search by name, email, account…', value: pst.q, oninput: debounce((e) => { pst.q = e.target.value; drawList(); }, 120) });
    const chips = h('div.chips', FILTERS.map(([k, l]) => h(`button.chip${pst.filter === k ? '.on' : ''}`, { onclick: (e) => { pst.filter = k; $$('.chip', e.currentTarget.parentNode).forEach((c) => c.classList.toggle('on', c.textContent === l)); drawList(); } }, l)));
    drawList();
    return h('div.page.dc-page',
      h('header.pagehead', h('span.objicon', { style: { background: ctx.app.color } }, '🧬'),
        h('div', h('div.eyebrow', ctx.app.name), h('h1', 'Customer 360')), h('div.grow'),
        h('small.muted', `${rows.length} customers · ${fmt.num(resolve().stats.profiles)} unified profiles in all, counting leads and outside records`),
        h('a.btn', { href: '#/app/datacloud/identity' }, 'Identity resolution')),
      h('div.dc-split',
        h('aside.dc-rail', h('div.dc-rail-head', search, chips, count), listBox),
        sel ? profileView(sel, ctx) : UI.empty('🧬', 'No profiles yet', 'Add contacts and Data Cloud builds a profile for each.')));
  } };

  // ---------- data streams ----------

  const CANON = {
    sources: [['FullName', 'Full name'], ['Email', 'Email'], ['Phone', 'Phone'], ['DeviceType', 'Device type'], ['LoyaltyId', 'Loyalty ID'], ['SourceSystem', 'Source system']],
    events: [['EventType', 'Event type'], ['Channel', 'Channel'], ['OccurredAt', 'Occurred at'], ['Detail', 'Page or campaign'], ['Value', 'Cart value'], ['IndividualId', 'Individual ID']],
  };
  // Source-system field names for each stream's object; target null = not mapped yet.
  const SRC = {
    Contact: [['contact_id', 'Id'], ['first_name', 'FirstName'], ['last_name', 'LastName'], ['email_addr', 'Email'], ['phone_no', 'Phone'], ['job_title', 'Title'], ['account_ref', 'AccountId'], ['mail_city', 'MailingCity'], ['lead_src', 'LeadSource'], ['mobile_no', null], ['birth_date', null], ['dept_name', null], ['loyalty_tier', null]],
    Order: [['order_id', 'Id'], ['order_no', 'OrderNumber'], ['customer_ref', 'BillToContactId'], ['account_ref', 'AccountId'], ['status', 'Status'], ['sales_channel', 'Channel'], ['order_date', 'EffectiveDate'], ['promo_code', null], ['ship_city', null], ['tracking_no', null]],
    Case: [['case_id', 'Id'], ['case_no', 'CaseNumber'], ['subject', 'Subject'], ['status', 'Status'], ['priority', 'Priority'], ['contact_ref', 'ContactId'], ['origin_channel', null], ['csat_score', null], ['product_ref', null]],
    events: [['event_type', 'EventType'], ['channel', 'Channel'], ['ts', 'OccurredAt'], ['page_or_campaign', 'Detail'], ['cart_value', null], ['visitor_id', null], ['utm_source', null]],
    sources: [['full_name', 'FullName'], ['email', 'Email'], ['phone', 'Phone'], ['device', null], ['loyalty_no', null], ['store_id', null]],
  };
  const srcRows = (s) => {
    const list = s.object === 'sources' ? DB.org().sources.filter((x) => x.source === (s.source === 'POS (via MuleSoft)' ? 'In-store POS' : s.source)) : s.object === 'events' ? DB.org().events : DB.all(s.object);
    return list;
  };
  function streamTargets(s) {
    if (CANON[s.object]) return CANON[s.object].map(([n, l]) => ({ name: n, label: l, type: 'text' }));
    const m = DB.meta(s.object);
    return m ? m.fields.filter((f) => !f.system && !f.hidden && f.type !== 'json').map((f) => ({ name: f.name, label: f.label || f.name, type: f.type })) : [];
  }
  function streamMap(s) {
    const base = Object.fromEntries((SRC[s.object] || []).map(([a, b]) => [a, b]));
    return Object.assign(base, s.map || {});
  }
  const SAMPLE_JUNK = { loyalty_tier: ['Gold', 'Silver', 'Basic'], mobile_no: ['(415) 555-0117', '(510) 555-0134'], birth_date: ['1984-03-12', '1991-11-02'], dept_name: ['Operations', 'Finance'], promo_code: ['SUNNY10', 'BATTERY200'], ship_city: ['Oakland', 'Reno'], tracking_no: ['1Z88A2', '1Z91C7'], origin_channel: ['web_form', 'phone'], csat_score: ['4', '5'], product_ref: ['VC-10', 'SP-400'], cart_value: ['249', '649'], visitor_id: ['v_8a21', 'v_77c0'], utm_source: ['newsletter', 'search'], device: ['iPhone', 'Android'], loyalty_no: ['BW20417', 'BW88123'], store_id: ['S-12', 'S-04'] };
  function sampleRows(s, n = 6) {
    const rows = srcRows(s).slice(0, n);
    const map = streamMap(s);
    const fields = (SRC[s.object] || []).map(([a]) => a);
    const cell = (r, a, i) => {
      const t = (SRC[s.object] || []).find((x) => x[0] === a)[1];
      if (s.object === 'events') { const k = { EventType: 'type', Channel: 'channel', OccurredAt: 'at', Detail: 'detail' }[t]; if (k) return String(r[k] == null ? '' : r[k]).slice(0, 19).replace('T', ' '); }
      else if (s.object === 'sources') { const k = { FullName: 'name', Email: 'email', Phone: 'phone' }[t]; if (k) return r[k] == null ? '' : r[k]; if (a === 'device') return r.device || ''; if (a === 'loyalty_no') return r.loyalty || ''; }
      else if (t) { const v = r[t]; const f = DB.meta(s.object).field[t]; return f && f.type === 'lookup' ? DB.name(v) || '' : v == null ? '' : String(v).slice(0, 40); }
      const j = SAMPLE_JUNK[a]; return j ? j[i % j.length] : '';
    };
    return { fields, map, rows: rows.map((r, i) => fields.map((a) => cell(r, a, i))) };
  }
  const CADENCE_MIN = { 'Real time': 2, 'Every 15 min': 15, 'Every hour': 60, Daily: 1440 };
  // Streams get their counts, history and last refresh the first time they're opened; they're kept in the org.
  function streamState(s) {
    if (s.history) return s;
    const R = rng(s.id.split('').reduce((n, c) => n * 31 + c.charCodeAt(0), 7));
    const base = srcRows(s).length;
    s.ingested = base;
    s.history = Array.from({ length: 14 }, (_, i) => Math.max(1, Math.round((base / 14) * (0.55 + R() * 0.9) * (0.7 + i * 0.03))));
    s.lastRefresh = new Date(Date.now() - R.int(1, Math.max(2, CADENCE_MIN[s.refresh] || 60)) * 60000).toISOString();
    s.lastAdded = s.history[13];
    DB.save();
    return s;
  }
  const statusColor = (st) => (st === 'Active' ? 'var(--ok)' : st === 'Syncing' ? 'var(--accent)' : 'var(--warn)');
  const catIcon = { Profile: '👤', Engagement: '⚡' };
  const srcIcon = (s) => ({ 'Stratus CRM': '🏢', Commerce: '🛒', 'Web/Mobile SDK': '🌐', 'Mobile App': '📱', 'POS (via MuleSoft)': '🏬' }[s] || '🗄️');

  const busy = new Set();
  async function refreshStream(s, done) {
    if (busy.has(s.id)) return;
    busy.add(s.id);
    streamState(s);
    s.status = 'Syncing';
    done && done();
    await sleep(900 + Math.random() * 500);
    const added = Math.max(1, Math.round(s.ingested * (0.004 + Math.random() * 0.02)));
    s.ingested += added;
    s.lastAdded = added;
    s.history = s.history.slice(1).concat([added]);
    s.lastRefresh = nowIso();
    s.status = 'Active';
    busy.delete(s.id);
    DB.save();
    done && done();
    Shell.render();
  }

  // Rule-based mapping guess: words in the source name vs words in the field name and label.
  const STEM = { addr: 'address', no: 'number', num: 'number', tel: 'phone', mobile: 'mobile', dept: 'department', src: 'source', ref: 'id', birth: 'birthdate', date: 'date', ts: 'time' };
  const words = (s) => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => STEM[w] || w);
  function guessMapping(s, srcFields) {
    const targets = streamTargets(s);
    const used = new Set(Object.values(streamMap(s)).filter(Boolean));
    const out = [];
    for (const a of srcFields) {
      const wa = words(a);
      let best = null;
      for (const t of targets) {
        if (used.has(t.name)) continue;
        const wt = new Set([...words(t.name), ...words(t.label)]);
        const hit = wa.filter((w) => wt.has(w)).length;
        const sc = hit / Math.max(wa.length, 1) + (wt.has(wa.join('')) ? 0.5 : 0);
        if (sc >= 0.5 && (!best || sc > best.sc)) best = { sc, t };
      }
      if (best) { used.add(best.t.name); out.push({ source: a, target: best.t.name, reason: `“${a}” reads like ${best.t.label}` }); }
    }
    return out;
  }

  const sst = {};
  function streamDetail(s, ctx) {
    streamState(s);
    const map = streamMap(s);
    const targets = streamTargets(s);
    const sample = sampleRows(s);
    const unmapped = sample.fields.filter((a) => !map[a]);
    const sug = sst[s.id] || (sst[s.id] = { list: null, note: '' });
    const setMap = (a, t) => { DB.cfg.update('streams', s.id, { map: Object.assign({}, s.map || {}, { [a]: t || '' }) }); };
    const sugBox = h('div.dc-sug');
    const drawSug = () => {
      sugBox.replaceChildren(sug.list ? h('div.ai-card.dc-sugcard', h('div.row', h('b', sug.ai ? `✨ ${Einstein.word()} suggests` : 'Suggested mapping (rules)'), h('div.grow'),
        sug.list.length ? h('button.btn.sm.primary', { onclick: () => { DB.cfg.update('streams', s.id, { map: Object.assign({}, s.map || {}, Object.fromEntries(sug.list.map((x) => [x.source, x.target]))) }); UI.toast(`Mapped ${sug.list.length} field${sug.list.length > 1 ? 's' : ''}`); sug.list = null; } }, `Apply all (${sug.list.length})`) : null,
        h('button.btn.sm.ghost', { onclick: () => { sug.list = null; drawSug(); } }, 'Dismiss')),
      sug.list.length ? h('ul.plain', sug.list.map((x) => h('li', h('code', x.source), ' → ', h('b', (targets.find((t) => t.name === x.target) || {}).label || x.target), h('small.muted', ` · ${x.reason}`)))) : h('p.muted', 'Nothing in the unmapped fields lines up with a Stratus field.'),
      sug.meta ? Einstein.footnote(sug.meta) : h('div.ai-foot', 'Rule-based. Turn on AI in Settings for smarter guesses.')) : null);
    };
    drawSug();
    const suggest = h('button.btn.ai', { disabled: !unmapped.length, onclick: async (e) => {
      const b = e.currentTarget;
      if (!Einstein.ready()) { sug.list = guessMapping(s, unmapped); sug.ai = false; sug.meta = null; drawSug(); return; }
      b.disabled = true; b.replaceChildren(h('span.spinner.sm'), ` ${Einstein.word()}…`);
      try {
        const ex = Object.fromEntries(sample.fields.map((a, i) => [a, sample.rows[0] ? sample.rows[0][i] : '']));
        const r = await Einstein.ask({ task: 'datacloud-suggest-mapping', prompt: `Map these unmapped source fields from the "${s.name}" stream (${s.source}) to Stratus fields. Only map when it really fits; leave target empty otherwise.\n\nUnmapped source fields with a sample value:\n${unmapped.map((a) => `- ${a}: ${ex[a] || '(empty)'}`).join('\n')}\n\nStratus fields (name: label, type):\n${targets.filter((t) => !Object.values(map).includes(t.name)).map((t) => `- ${t.name}: ${t.label}, ${t.type}`).join('\n')}`,
          schema: Einstein.S.obj({ mappings: Einstein.S.arr(Einstein.S.obj({ source: Einstein.S.str('source field'), target: Einstein.S.str('Stratus field name, or empty'), reason: Einstein.S.str('short reason') })) }) });
        sug.list = (r.mappings || []).filter((x) => unmapped.includes(x.source) && targets.some((t) => t.name === x.target));
        sug.ai = true; sug.meta = r.meta;
      } catch (err) { UI.toast(err.message, 'err', err.setup ? { label: 'Settings', run: () => { location.hash = '#/settings'; } } : null); }
      drawSug(); b.disabled = false; b.replaceChildren('✨ Suggest mapping');
    } }, '✨ Suggest mapping');
    const hist = s.history.map((v, i) => ({ label: i === 13 ? 'Latest' : `-${13 - i}`, value: v }));
    return h('div.page.dc-page',
      h('header.pagehead', h('button.iconbtn', { onclick: () => ctx.set({ id: null }), title: 'Back to all streams' }, '←'),
        h('span.objicon', { style: { background: ctx.app.color } }, srcIcon(s.source)),
        h('div', h('div.eyebrow', `Data stream · ${s.category}`), h('h1', s.name), h('div.muted', `${s.source} → ${s.object === 'events' ? 'Engagement events' : s.object === 'sources' ? 'Individuals' : DB.meta(s.object).plural}`)),
        h('div.grow'), UI.badge(s.status, statusColor(s.status)),
        h('button.btn.primary', { disabled: busy.has(s.id), onclick: () => refreshStream(s, () => Shell.render()) }, busy.has(s.id) ? 'Refreshing…' : '↻ Refresh now')),
      h('div.kpis', UI.stat('Records ingested', fmt.num(s.ingested), `+${fmt.num(s.lastAdded)} last run`, 'var(--ok)'), UI.stat('Last refresh', fmt.ago(s.lastRefresh), fmt.datetime(s.lastRefresh)),
        UI.stat('Schedule', s.refresh, s.category), UI.stat('Fields mapped', `${sample.fields.length - unmapped.length}/${sample.fields.length}`, unmapped.length ? `${unmapped.length} still to map` : 'complete', unmapped.length ? 'var(--warn)' : 'var(--ok)')),
      h('div.dc-cols.even',
        UI.card('Field mapping', h('div', sugBox, h('div.tablewrap', h('table.grid.compact', h('thead', h('tr', h('th', 'Source field'), h('th', 'Sample'), h('th', ''), h('th', 'Stratus field'))),
          h('tbody', sample.fields.map((a, i) => h('tr', h('td', h('code', a)), h('td.muted', sample.rows[0] ? sample.rows[0][i] : ''), h('td', '→'),
            h('td', h('select', { class: map[a] ? '' : 'dc-unmapped', onchange: (e) => setMap(a, e.target.value) }, h('option', { value: '' }, '— not mapped —'),
              targets.map((t) => h('option', { value: t.name, selected: map[a] === t.name }, t.label))))))))), unmapped.length ? h('div.btnrow', suggest) : null),
          { icon: '🔀', count: sample.fields.length }),
        h('div.dc-side', UI.card('Records per refresh', Charts.draw('bar', hist, { single: true, height: 190 }), { icon: '📈' }),
          UI.card('Sample rows', h('div.tablewrap', h('table.grid.compact', h('thead', h('tr', sample.fields.map((a) => h('th', a)))),
            h('tbody', sample.rows.map((r) => h('tr', r.map((v) => h('td', v == null ? '' : String(v))))))), ), { icon: '🔎' }))));
  }

  Pages.streams = { title: 'Data Streams', icon: '🌊', render: (ctx) => {
    const list = DB.org().streams;
    const open = list.find((s) => s.id === ctx.params.id);
    if (open) return streamDetail(open, ctx);
    list.forEach(streamState);
    const total = sum(list, (s) => s.ingested);
    const latest = list.map((s) => s.lastRefresh).sort().pop();
    return h('div.page.dc-page',
      h('header.pagehead', h('span.objicon', { style: { background: ctx.app.color } }, '🌊'), h('div', h('div.eyebrow', ctx.app.name), h('h1', 'Data Streams')), h('div.grow'),
        h('button.btn', { onclick: () => list.forEach((s) => refreshStream(s, () => Shell.render())) }, '↻ Refresh all')),
      h('div.kpis', UI.stat('Streams', String(list.length), `${list.filter((s) => s.status === 'Active').length} active`), UI.stat('Records ingested', fmt.num(total), 'across all streams', 'var(--ok)'),
        UI.stat('Latest refresh', latest ? fmt.ago(latest) : '—'), UI.stat('Unified profiles', fmt.num(resolve().stats.profiles), `from ${fmt.num(resolve().stats.records)} source records`, 'var(--accent)')),
      list.length ? h('div.dc-streams', list.map((s) => h('button.card.dc-stream', { onclick: () => ctx.set({ id: s.id }) },
        h('div.row', h('span.dc-stream-ic', srcIcon(s.source)), h('div.grow', h('b', s.name), h('div.muted', `${s.source} · ${s.category}`)), UI.badge(s.status, statusColor(s.status))),
        h('div.dc-stream-n', fmt.num(s.ingested), h('small', ' records')),
        Charts.draw('spark', s.history.map((v) => ({ value: v })), { color: Charts.color(0) }),
        h('div.row', h('small.muted', `↻ ${fmt.ago(s.lastRefresh)} · ${s.refresh}`), h('div.grow'),
          h('span.btn.sm', { onclick: (e) => { e.stopPropagation(); refreshStream(s, () => Shell.render()); } }, busy.has(s.id) ? 'Refreshing…' : 'Refresh now'))))) : UI.empty('🌊', 'No data streams', 'Connect a source to start ingesting.'));
  } };

  // ---------- identity resolution ----------

  const ist = { open: null };
  const TYPE_ICON = { Contact: '📇', Lead: '⭐', Source: '🔗' };
  function addSampleDuplicates() {
    const st = store();
    const pool = DB.all('Contact').filter((c) => c.Email && c.Phone && c.AccountId && !/B2C/.test(DB.name(c.AccountId)) && !st.extra.some((id) => DB.get(id) && DB.get(id).LastName === c.LastName));
    const a = pool[3] || pool[0], b = pool[9] || pool[1];
    if (!a || !b) { UI.toast('No contacts to copy from', 'err'); return; }
    const mk = (c, over) => DB.insert('Lead', Object.assign({ FirstName: c.FirstName, LastName: c.LastName, Company: DB.name(c.AccountId), Title: c.Title, Status: 'Open - Not Contacted', LeadSource: 'Web', City: c.MailingCity, Country: c.MailingCountry, Description: 'Sample duplicate added from Identity resolution.' }, over));
    const l1 = mk(a, { Email: a.Email.toUpperCase(), Phone: a.Phone });
    const l2 = mk(b, { FirstName: b.FirstName[0] + '.', Email: '', Phone: b.Phone, Title: '' });
    st.extra.push(l1.Id, l2.Id);
    DB.save();
    UI.toast('Added 2 sample duplicate leads. They show up as clusters below.');
  }

  function clusterCard(cl, ctx) {
    const g = golden(cl);
    const con = cl.members.find((m) => m.type === 'Contact');
    const st = store();
    const open = ist.open === cl.id;
    const explain = Einstein.button('Explain this match', () => ({ task: 'datacloud-explain-match', prompt: `Explain why these records were grouped as one person, and how sure we should be. Mention anything that argues against a match.\n\n${cl.members.map((m, i) => `Record ${i + 1} (${m.type}, ${m.sys}): name ${m.name || '(none)'}, email ${m.email || '(none)'}, phone ${m.phones[0] || '(none)'}, company ${m.company || '(none)'}, city ${m.city || '(none)'}`).join('\n')}\n\nRules that fired: ${cl.edges.map((e) => e.why).join('; ')}. Rule confidence: ${cl.conf}%.`,
      schema: Einstein.S.obj({ verdict: Einstein.S.oneOf(['same person', 'probably the same person', 'unsure'], 'verdict'), explanation: Einstein.S.str('2-4 sentences'), doubts: Einstein.S.arr(Einstein.S.str('a reason this might be wrong'), 'may be empty') }) }),
      (r) => UI.modal({ title: 'Why these match', body: h('div', h('p', UI.badge(r.verdict, r.verdict === 'same person' ? 'var(--ok)' : r.verdict === 'unsure' ? 'var(--warn)' : 'var(--accent)')), md(r.explanation), (r.doubts || []).length ? h('div', h('h4', 'Doubts'), h('ul', r.doubts.map((x) => h('li', x)))) : null, Einstein.footnote(r.meta)), actions: [{ label: 'Close', run: () => {} }] }), 'sm');
    const act = (m) => {
      const merged = st.merges.find((x) => x.leadId === m.id && !x.undone);
      const linked = m.type === 'Source' && st.links[m.id];
      if (merged) return h('div.row', UI.badge('merged', 'var(--ok)'), h('button.link', { onclick: () => { undoMerge(merged); UI.toast('Merge undone'); } }, 'Undo'));
      if (linked) return h('div.row', UI.badge('linked', 'var(--ok)'), h('button.link', { onclick: () => { delete st.links[m.id]; idCache = null; DB.save(); Shell.render(); } }, 'Unlink'));
      const out = [];
      if (m.type === 'Lead' && con) out.push(h('button.btn.sm.primary', { onclick: () => {
        const e = mergeLead(m.id, con.id);
        UI.toast(`Merged ${m.name} into ${con.name}`, 'ok', { label: 'Undo', run: () => { undoMerge(e); UI.toast('Merge undone'); } });
      } }, 'Merge into contact'));
      if (m.type === 'Source' && con) out.push(h('button.btn.sm.primary', { onclick: () => { st.links[m.id] = con.id; idCache = null; DB.save(); UI.toast(`Linked to ${con.name}`); Shell.render(); } }, 'Link to profile'));
      if (m.type !== 'Contact' || cl.members.filter((x) => x.type === 'Contact').length > 1) out.push(h('button.btn.sm.ghost', { onclick: () => {
        for (const o of cl.members) if (o.key !== m.key) st.notMatch.push(m.key + '|' + o.key);
        idCache = null; DB.save(); UI.toast('Marked as not a match', 'ok', { label: 'Undo', run: () => { st.notMatch = st.notMatch.filter((k) => !k.includes(m.key)); idCache = null; DB.save(); Shell.render(); } }); Shell.render();
      } }, 'Not a match'));
      return h('div.row', out);
    };
    return h('div.card.dc-cluster', h('div.card-body',
      h('div.row', h('button.iconbtn.sm', { onclick: () => { ist.open = open ? null : cl.id; Shell.render(); } }, open ? '▾' : '▸'), UI.avatar(g.name || '?', 30),
        h('div.grow', h('b', g.name || 'Unnamed'), h('small.muted', ` ${cl.members.length} records · ${g.systems.join(', ')}`)),
        h('div.dc-conf', { title: 'Lowest rule confidence in the cluster' }, h('div.dc-conf-bar', h('i', { style: { width: cl.conf + '%', background: tone(100 - cl.conf) } })), h('small', `${cl.conf}% match`)),
        cl.pending ? null : UI.badge('resolved', 'var(--ok)'), explain),
      h('div.dc-members', cl.members.map((m) => h('div.dc-member',
        h('span.dc-m-type', TYPE_ICON[m.type]), h('div.dc-m-main', h('div', m.type === 'Source' ? h('b', m.name || '(no name)') : h('a.reclink', { href: '#/r/' + m.id }, m.name || '(no name)'), h('small.muted', ` ${m.type === 'Source' ? m.sys : m.type}${m.company ? ' · ' + m.company : ''}`)),
          h('small', [m.email || '—', m.phones[0] ? fmtPhone(m.phones[0]) : null, m.city || null].filter(Boolean).join(' · '))), act(m)))),
      open ? h('div.dc-golden', h('h4', 'Unified profile preview'),
        h('div.dc-golden-grid', [['Name', g.name], ['Email', g.email], ['Phone', g.phone], ['Company', g.company], ['City', g.city], ['Systems', g.systems.join(', ')]].map(([k, v]) => h('div', h('small.muted', k), h('div', v || '—')))),
        h('h4', 'Why they match'), h('ul.plain', cl.edges.map((e) => h('li', h('b', e.c + '%'), ' ' + e.why, e.rules.length ? h('small.muted', ` · ${e.rules.map((r) => RULES.find((x) => x.id === r).label).join(', ')}`) : null)))) : null));
  }

  Pages.identity = { title: 'Identity Resolution', icon: '🔗', render: (ctx) => {
    const r = resolve();
    const st = store();
    const byType = { Contacts: r.recs.filter((x) => x.type === 'Contact').length, Leads: r.recs.filter((x) => x.type === 'Lead').length, 'Outside records': r.recs.filter((x) => x.type === 'Source').length };
    const pending = r.dupes.filter((c) => c.pending);
    const done = r.dupes.filter((c) => !c.pending);
    return h('div.page.dc-page',
      h('header.pagehead', h('span.objicon', { style: { background: ctx.app.color } }, '🔗'), h('div', h('div.eyebrow', ctx.app.name), h('h1', 'Identity Resolution')), h('div.grow'),
        h('button.btn', { title: 'Adds two leads that copy existing contacts, to try the merge', onclick: () => { addSampleDuplicates(); idCache = null; Shell.render(); } }, '＋ Add sample duplicates'),
        h('button.btn.primary', { onclick: () => { idCache = null; Shell.render(); UI.toast(`Ran ${RULES.filter((x) => ruleOn(x.id)).length} rules over ${r.recs.length} records`); } }, '▶ Run rules')),
      h('div.kpis', UI.stat('Source records', fmt.num(r.stats.records), `${byType.Contacts} contacts · ${byType.Leads} leads · ${byType['Outside records']} outside`), UI.stat('Unified profiles', fmt.num(r.stats.profiles), 'one per person', 'var(--accent)'),
        UI.stat('Consolidation rate', r.stats.rate + '%', `${r.stats.records - r.stats.profiles} records folded in`, 'var(--ok)'), UI.stat('To review', String(pending.length), `${done.length} already resolved`, pending.length ? 'var(--warn)' : 'var(--ok)')),
      h('div.dc-cols.even',
        UI.card('Match rules', h('div', RULES.map((rule) => h('div.dc-rule', h('div.grow', h('b', rule.label), h('small', rule.desc)),
          h('label.switch', h('input', { type: 'checkbox', checked: ruleOn(rule.id), onchange: (e) => { st.rules[rule.id] = e.target.checked; idCache = null; DB.save(); Shell.render(); } }), h('span.slider')))),
          h('small.muted', `A pair needs at least ${MIN_CONF}% confidence to join a cluster.`)), { icon: '⚙️' }),
        UI.card('Records → profiles', Charts.draw('hbar', [...Object.entries(byType).map(([label, value]) => ({ label, value })), { label: 'Unified profiles', value: r.stats.profiles, color: 'var(--ok)' }], { single: true, height: 150 }), { icon: '📉' })),
      h('section', h('h3.dc-sec', 'Duplicate clusters ', h('span.count', pending.length)),
        pending.length ? h('div.dc-clusters', pending.map((c) => clusterCard(c, ctx))) : UI.empty('✅', 'No duplicates waiting', `The ${RULES.filter((x) => ruleOn(x.id)).length} active rules found nothing new. Add sample duplicates to try a merge.`)),
      done.length || st.merges.some((m) => !m.undone) ? h('section', h('h3.dc-sec', 'Resolved ', h('span.count', done.length)), h('div.dc-clusters', done.map((c) => clusterCard(c, ctx)))) : null);
  } };

  // ---------- insights and segments ----------

  const METRICS = { ltv: { label: 'Lifetime value', f: money }, engagement: { label: 'Engagement score', f: (v) => fmt.num(v) }, churn: { label: 'Churn risk', f: (v) => fmt.num(v) }, orderCount: { label: 'Orders per person', f: (v) => fmt.num(v) },
    opens: { label: 'Email opens (60 days)', f: (v) => fmt.num(v) }, health: { label: 'Account health', f: (v) => fmt.num(v) }, count: { label: 'Profiles', f: (v) => fmt.num(v) } };
  const DIMS = { tier: 'Account tier', industry: 'Industry', region: 'Region', leadSource: 'Lead source', churnBand: 'Churn band' };
  const FNS = { avg: 'Average', sum: 'Total', count: 'Count' };
  const DEFAULT_INSIGHTS = [
    { name: 'Lifetime value by account tier', description: 'Average spend per person, grouped by the tier of their account.', metric: 'ltv', by: 'tier', fn: 'avg', chart: 'bar' },
    { name: 'Engagement by industry', description: 'How active people are across web, email and app, by industry.', metric: 'engagement', by: 'industry', fn: 'avg', chart: 'hbar' },
    { name: 'Churn risk by region', description: 'Average rule-based churn risk in each region.', metric: 'churn', by: 'region', fn: 'avg', chart: 'bar' },
    { name: 'Profiles by lead source', description: 'Where unified profiles first came from.', metric: 'count', by: 'leadSource', fn: 'count', chart: 'donut' },
  ];
  function insightData(def) {
    const rows = profiles();
    const val = (arr) => {
      if (def.fn === 'count' || def.metric === 'count') return arr.length;
      const t = sum(arr, (r) => r[def.metric]);
      return def.fn === 'sum' ? Math.round(t) : arr.length ? Math.round((t / arr.length) * 10) / 10 : 0;
    };
    const groups = Object.entries(groupBy(rows, (r) => r[def.by] || 'Unknown')).map(([label, arr]) => ({ label, value: val(arr), n: arr.length, key: label })).sort((a, b) => b.value - a.value);
    return { total: val(rows), groups, f: (METRICS[def.metric] || METRICS.count).f };
  }
  function ensureInsights() {
    const org = DB.org();
    if (!org.insights.length) { for (const d of DEFAULT_INSIGHTS) org.insights.push(Object.assign({ id: DB.uid('in'), builtin: true, createdAt: nowIso() }, d)); DB.save(); }
    return org.insights;
  }

  // Segment builder state lives outside the page so a redraw never loses the draft.
  const sb = { name: '', source: 'Unified Profile', rules: [], words: '', note: '', meta: null };
  const SEG_SOURCES = ['Unified Profile', 'Contact', 'Lead'];
  function catalog(source) {
    if (source === 'Unified Profile') return ATTRS;
    const obj = source === 'Lead' ? 'Lead' : 'Contact';
    return Filters.fields(obj).filter((f) => !['lookup', 'textarea'].includes(f.type) || f.name.includes('.')).filter((f) => !f.system).map((f) => ({
      name: f.name, label: f.label, kind: ['number', 'currency', 'percent'].includes(f.type) ? 'num' : f.type === 'checkbox' ? 'bool' : f.type === 'picklist' ? 'pick' : ['date', 'datetime'].includes(f.type) ? 'date' : 'text', options: f.options, f }));
  }
  const kindOps = (k) => (k === 'date' ? [['gt', 'is after'], ['lt', 'is before']] : OPS_BY_KIND[k] || OPS_BY_KIND.text);
  function populationOf(source, rules) {
    try {
      if (source === 'Unified Profile') return unifiedRows(rules).length;
      return DB.query(source, { filters: rules }).length;
    } catch (e) { return 0; }
  }
  function defaultRule(source) {
    const c = catalog(source)[0];
    return [c.name, kindOps(c.kind)[0][0], c.kind === 'bool' ? true : c.kind === 'pick' ? (c.options || [''])[0] : c.kind === 'num' ? 0 : ''];
  }
  function coerceRule(source, rule) {
    const c = catalog(source).find((x) => x.name === rule[0]);
    if (!c) return null;
    let [f, op, v] = rule;
    if (c.kind === 'num') v = Number(String(v).replace(/[$,%\s]/g, '')) || 0;
    else if (c.kind === 'bool') v = v === true || /^(true|yes)$/i.test(String(v));
    else if (c.kind === 'pick' && c.options) v = c.options.find((o) => lc(o) === lc(v)) || v;
    else if (c.f) v = Filters.coerce(c.f, op, v);
    if (!kindOps(c.kind).some((o) => o[0] === op)) op = kindOps(c.kind)[0][0];
    return [f, op, v];
  }

  // Keyword fallback for "segment from words" when no AI is on.
  function wordsToRules(text) {
    const t = lc(text);
    const rules = [];
    const add = (r) => { if (!rules.some((x) => x[0] === r[0] && x[1] === r[1])) rules.push(r); };
    for (const [re, region] of [[/\bwest\b/, 'West'], [/\bcentral\b|\bmidwest\b/, 'Central'], [/\beast\b/, 'East'], [/international|overseas|\buk\b|canada/, 'International']]) if (t.match(re)) add(['region', 'eq', region]);
    if (t.match(/homeowner|home owner|shopper|consumer/)) add(['homeowner', 'eq', true]);
    if (t.match(/(haven'?t|have not|never|not) (yet )?(bought|purchased|ordered)|non[- ]?buyer|hasn'?t bought/)) add(['bought', 'eq', false]);
    else if (t.match(/\b(bought|purchased|customers?)\b/)) add(['bought', 'eq', true]);
    if (t.match(/open(ed)? (an? )?email|email open|opened/)) add(['opens', 'gt', 0]);
    if (t.match(/click/)) add(['clicks', 'gt', 0]);
    if (t.match(/abandon/)) add(['abandoned', 'gt', 0]);
    if (t.match(/high[- ]value|big spender|top customer/)) add(['ltv', 'gt', 5000]);
    if (t.match(/churn|at[- ]risk|slipping/)) add(['churn', 'ge', 60]);
    if (t.match(/highly engaged|very engaged|engaged/)) add(['engagement', 'ge', 50]);
    if (t.match(/platinum|gold|silver|bronze/)) add(['tier', 'eq', (t.match(/platinum|gold|silver|bronze/)[0])[0].toUpperCase() + t.match(/platinum|gold|silver|bronze/)[0].slice(1)]);
    return rules;
  }

  function ruleEditor(redraw) {
    const box = h('div.dc-rules');
    const pop = h('div.dc-pop');
    const total = () => (sb.source === 'Unified Profile' ? profiles().length : DB.all(sb.source).length);
    const updatePop = () => {
      const valid = sb.rules.map((r) => coerceRule(sb.source, r)).filter(Boolean);
      const n = populationOf(sb.source, valid);
      pop.replaceChildren(h('div.dc-pop-n', fmt.num(n)), h('div', h('b', sb.source === 'Lead' ? 'leads' : sb.source === 'Contact' ? 'contacts' : 'unified profiles'), h('small.muted', ` match · ${pctOf(n, total())}% of ${fmt.num(total())}`)),
        h('div.dc-pop-bar', h('i', { style: { width: pctOf(n, total()) + '%' } })));
    };
    const draw = () => {
      const cat = catalog(sb.source);
      box.replaceChildren(sb.rules.length ? sb.rules.map((rule, i) => {
        const c = cat.find((x) => x.name === rule[0]) || cat[0];
        const ops = kindOps(c.kind);
        const val = c.kind === 'bool' ? h('select', { onchange: (e) => { rule[2] = e.target.value === 'yes'; updatePop(); } }, h('option', { value: 'yes', selected: rule[2] === true }, 'Yes'), h('option', { value: 'no', selected: rule[2] === false }, 'No'))
          : c.kind === 'pick' && c.options ? h('select', { onchange: (e) => { rule[2] = e.target.value; updatePop(); } }, c.options.map((o) => h('option', { selected: lc(o) === lc(rule[2]) }, o)))
          : h('input', { type: c.kind === 'num' ? 'number' : c.kind === 'date' ? 'date' : 'text', value: rule[2] == null ? '' : rule[2], oninput: (e) => { rule[2] = e.target.value; updatePop(); } });
        return h('div.dc-rule-row', i ? h('small.muted', 'and') : h('small.muted', 'where'),
          h('select', { onchange: (e) => { const n = cat.find((x) => x.name === e.target.value); sb.rules[i] = [n.name, kindOps(n.kind)[0][0], n.kind === 'bool' ? true : n.kind === 'pick' ? (n.options || [''])[0] : n.kind === 'num' ? 0 : '']; draw(); } }, cat.map((a) => h('option', { value: a.name, selected: a.name === c.name }, a.label))),
          h('select', { onchange: (e) => { rule[1] = e.target.value; updatePop(); } }, ops.map(([o, l]) => h('option', { value: o, selected: o === rule[1] }, l))), val,
          h('button.iconbtn.sm', { title: 'Remove', onclick: () => { sb.rules.splice(i, 1); draw(); } }, '×'));
      }) : h('p.muted', 'No rules yet, so everyone is included. Add a rule or describe the segment in words.'),
      h('button.btn.sm', { onclick: () => { sb.rules.push(defaultRule(sb.source)); draw(); } }, '+ Add rule'));
      updatePop();
    };
    draw();
    return { box, pop, redraw: draw };
  }

  function segmentBuilder(ctx) {
    const ed = ruleEditor();
    const name = h('input', { placeholder: 'Segment name', value: sb.name, oninput: (e) => { sb.name = e.target.value; } });
    const srcSel = h('select', { onchange: (e) => { sb.source = e.target.value; sb.rules = []; ed.redraw(); } }, SEG_SOURCES.map((s) => h('option', { selected: s === sb.source }, s)));
    const noteBox = h('div.dc-note');
    const showNote = () => noteBox.replaceChildren(sb.note ? h('div.ai-card.dc-sugcard', h('div', md(sb.note)), sb.meta ? Einstein.footnote(sb.meta) : h('div.ai-foot', 'Keyword rules, since AI is off. Review before saving.')) : null);
    showNote();
    const words = h('input', { placeholder: 'e.g. homeowners in the west who opened an email but haven’t bought', value: sb.words, oninput: (e) => { sb.words = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') go.click(); } });
    const go = h('button.btn.ai', { onclick: async () => {
      if (!sb.words.trim()) { words.focus(); return; }
      go.disabled = true; go.replaceChildren(h('span.spinner.sm'), ' Thinking…');
      try {
        if (Einstein.ready()) {
          const cat = ATTRS.map((a) => `${a.name}: ${a.label} (${a.kind}${a.options ? ': ' + a.options.join('|') : ''})`).join('\n');
          const r = await Einstein.ask({ task: 'datacloud-segment-from-words', system: 'You turn a description of an audience into segment rules over unified customer profiles. Use only the attributes listed. Numbers are plain numbers. For yes/no attributes use true or false.',
            prompt: `Description: ${sb.words}\n\nAttributes:\n${cat}\n\nOperators: gt, ge, lt, le, eq, ne, contains. "Opened an email" means opens > 0. "Haven't bought" means bought = false. "Homeowners" means homeowner = true. Regions: West, Central, East, International.`,
            schema: Einstein.S.obj({ name: Einstein.S.str('short segment name'), rules: Einstein.S.arr(Einstein.S.obj({ field: Einstein.S.str('attribute name'), op: Einstein.S.str('operator'), value: Einstein.S.str('value') })), explain: Einstein.S.str('one sentence on how you read the request') }) });
          const rules = (r.rules || []).map((x) => attrOf(x.field) ? coerceRule('Unified Profile', [x.field, x.op, x.value]) : null).filter(Boolean);
          if (!rules.length) throw new Error(`${Einstein.word()} couldn't turn that into rules. Try rewording it.`);
          sb.source = 'Unified Profile'; srcSel.value = sb.source; sb.rules = rules; if (!sb.name) { sb.name = r.name || ''; name.value = sb.name; }
          sb.note = `**Review these rules.** ${r.explain || ''}`; sb.meta = r.meta;
        } else {
          const rules = wordsToRules(sb.words);
          if (!rules.length) throw new Error('No keywords I know in that. Add rules by hand, or turn on AI in Settings.');
          sb.source = 'Unified Profile'; srcSel.value = sb.source; sb.rules = rules; sb.note = `Read ${rules.length} rule${rules.length > 1 ? 's' : ''} from the keywords. Check them below.`; sb.meta = null;
        }
        ed.redraw(); showNote();
      } catch (e) { UI.toast(e.message, 'err', e.setup ? { label: 'Settings', run: () => { location.hash = '#/settings'; } } : null); }
      go.disabled = false; go.replaceChildren('✨ Build rules');
    } }, '✨ Build rules');
    const save = () => {
      const valid = sb.rules.map((r) => coerceRule(sb.source, r)).filter(Boolean);
      if (!sb.name.trim()) { UI.toast('Name the segment first', 'err'); name.focus(); return; }
      const seg = DB.insert('Segment', { Name: sb.name.trim(), Source: sb.source, Criteria: { filters: valid, words: sb.words || null }, Population: populationOf(sb.source, valid), LastRefreshed: nowIso(), Description: sb.words ? `Built from: “${sb.words}”` : valid.map(ruleText).join(' and ') });
      UI.toast(`Saved “${seg.Name}” with ${fmt.num(seg.Population)} people`, 'ok', { label: 'Open', run: () => Shell.go('#/r/' + seg.Id) });
      Object.assign(sb, { name: '', rules: [], words: '', note: '', meta: null });
    };
    return UI.card('Segment builder', h('div.dc-builder',
      h('div.aibar', h('span.aibar-ic', '✨'), words, go),
      noteBox,
      h('div.row', name, h('label.row', h('small.muted', 'Built on'), srcSel)),
      ed.box, ed.pop,
      h('div.btnrow', h('button.btn.primary', { onclick: save }, 'Save as segment'), h('button.btn', { onclick: () => { Object.assign(sb, { name: '', rules: [], words: '', note: '', meta: null }); Shell.render(); } }, 'Clear'))), { icon: '🧩' });
  }

  function activate(seg) {
    const js = DB.all('Journey');
    const sel = h('select', h('option', { value: '' }, '＋ Create a new journey'), js.map((j) => h('option', { value: j.Id, selected: j.SegmentId === seg.Id }, `${j.Name} (${j.Status})`)));
    UI.modal({ title: `Send “${seg.Name}” to a Marketing journey`, body: h('div.form', h('p', `${fmt.num(seg.Population != null ? seg.Population : segmentIds(seg).length)} people will enter the journey when it runs.`), h('label', 'Journey', sel), h('small.muted', 'This sets the journey’s entry segment. Nothing is sent from here.')),
      actions: [{ label: 'Cancel', run: () => {} }, { label: 'Send to journey', primary: true, run: () => {
        let j = js.find((x) => x.Id === sel.value);
        if (j) DB.update(j.Id, { SegmentId: seg.Id }); else j = DB.insert('Journey', { Name: `${seg.Name} journey`, Status: 'Draft', SegmentId: seg.Id, Goal: 'Engage this segment' });
        store().activations.push({ segmentId: seg.Id, journeyId: j.Id, at: nowIso() });
        DB.save();
        UI.toast(`“${seg.Name}” is the entry segment of ${j.Name}`, 'ok', { label: 'Open journey', run: () => Shell.go('#/r/' + j.Id) });
      } }] });
  }

  function insightCard(def, ctx) {
    const d = insightData(def);
    const m = METRICS[def.metric] || METRICS.count;
    return h('section.card.dc-insight',
      h('header.card-head', h('span.card-ic', '📐'), h('h3', def.name), h('div.grow'), h('small.muted', `${FNS[def.fn] || def.fn} of ${m.label.toLowerCase()} by ${(DIMS[def.by] || def.by).toLowerCase()}`),
        h('button.iconbtn.sm', { title: 'Delete insight', onclick: async () => { if (await UI.confirm(`Delete “${def.name}”?`, 'The definition goes away; no data changes.')) DB.cfg.remove('insights', def.id); } }, '×')),
      h('div.card-body', h('div.dc-insight-top', h('div.dc-insight-n', d.f(d.total)), h('small.muted', def.description || '')),
        Charts.draw(def.chart || 'bar', d.groups.slice(0, 10), { format: d.f, single: def.chart !== 'donut', height: 210, onClick: (g) => { sb.source = 'Unified Profile'; sb.rules = [[def.by === 'churnBand' ? 'churn' : def.by, def.by === 'churnBand' ? 'ge' : 'eq', def.by === 'churnBand' ? ({ High: 60, Medium: 35, Low: 0 }[g.label]) : g.label]]; sb.name = `${g.label} · ${DIMS[def.by] || def.by}`; ctx.set({ tab: 'segments' }); } }),
        h('small.muted', 'Click a bar to start a segment from it.')));
  }
  function newInsight() {
    const f = { name: '', metric: 'ltv', by: 'tier', fn: 'avg', chart: 'bar' };
    const sel = (key, opts) => h('select', { onchange: (e) => { f[key] = e.target.value; } }, opts.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l)));
    UI.modal({ title: 'New calculated insight', body: h('div.form', h('label', 'Name', h('input', { placeholder: 'e.g. Orders per person by region', oninput: (e) => { f.name = e.target.value; } })),
      h('div.row2', h('label', 'Measure', sel('metric', Object.entries(METRICS).map(([k, v]) => [k, v.label]))), h('label', 'Calculation', sel('fn', Object.entries(FNS)))),
      h('div.row2', h('label', 'Group by', sel('by', Object.entries(DIMS))), h('label', 'Chart', sel('chart', [['bar', 'Bar'], ['hbar', 'Horizontal bar'], ['donut', 'Donut'], ['line', 'Line']])))),
      actions: [{ label: 'Cancel', run: () => {} }, { label: 'Add insight', primary: true, run: () => {
        if (!f.name.trim()) { UI.toast('Give it a name', 'err'); return false; }
        DB.cfg.add('insights', Object.assign({}, f, { name: f.name.trim(), description: 'Custom insight.' }));
      } }] });
  }

  function segmentList() {
    const segs = DB.all('Segment');
    return UI.card('Saved segments', segs.length ? h('div.tablewrap', h('table.grid.compact', h('thead', h('tr', ['Segment', 'Built on', 'People now', 'Rules', ''].map((x) => h('th', x)))),
      h('tbody', segs.map((s) => {
        const n = segmentIds(s).length;
        const filters = (s.Criteria && s.Criteria.filters) || [];
        return h('tr', h('td', h('a.reclink', { href: '#/r/' + s.Id }, s.Name)), h('td', s.Source), h('td.num', h('b', fmt.num(n)), s.Population != null && s.Population !== n ? h('small.muted', ` (saved ${fmt.num(s.Population)})`) : null),
          h('td', h('small', filters.length ? filters.map(s.Source === 'Unified Profile' ? ruleText : (f) => Filters.text(s.Source === 'Lead' ? 'Lead' : 'Contact', f)).join(' and ') : 'Everyone')),
          h('td.act', h('div.row', h('button.btn.sm', { onclick: () => { DB.update(s.Id, { Population: n, LastRefreshed: nowIso() }); UI.toast('Population refreshed'); } }, '↻'), h('button.btn.sm', { onclick: () => activate(s) }, 'Send to journey'))));
      })))) : h('p.muted', 'No segments yet.'), { icon: '🎯', count: segs.length });
  }

  Pages.insights = { title: 'Insights & Segments', icon: '📐', render: (ctx) => {
    const tab = ctx.params.tab === 'segments' ? 'segments' : 'insights';
    const defs = ensureInsights();
    return h('div.page.dc-page',
      h('header.pagehead', h('span.objicon', { style: { background: ctx.app.color } }, '📐'), h('div', h('div.eyebrow', ctx.app.name), h('h1', 'Insights & Segments')), h('div.grow'),
        h('div.seg', [['insights', 'Calculated insights'], ['segments', 'Segments']].map(([k, l]) => h(`button${tab === k ? '.on' : ''}`, { onclick: () => ctx.set({ tab: k }) }, l))),
        tab === 'insights' ? h('button.btn', { onclick: newInsight }, '＋ New insight') : null),
      tab === 'insights'
        ? h('div', h('div.kpis', UI.stat('Profiles', fmt.num(profiles().length)), UI.stat('Average lifetime value', money(sum(profiles(), (r) => r.ltv) / Math.max(1, profiles().length)), 'per person', 'var(--ok)'),
          UI.stat('High churn risk', String(profiles().filter((r) => r.churn >= 60).length), 'people at 60+', 'var(--bad)'), UI.stat('Highly engaged', String(profiles().filter((r) => r.engagement >= 50).length), 'score 50+', 'var(--accent)')),
          h('div.dc-insights', defs.map((d) => insightCard(d, ctx))))
        : h('div.dc-cols.even', segmentBuilder(ctx), segmentList()));
  } };

  return { profiles, resolve, segmentIds, unifiedRows, passes, wordsToRules, mergeLead, undoMerge, nextOffer, guessMapping, insightData, RULES, ATTRS };
})();
