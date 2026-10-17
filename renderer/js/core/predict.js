// predict.js — Einstein's predictive side: lead scores, opportunity win scores, case escalation risk,
// account health and text sentiment. These are small, explainable models over the org's own data, so
// they work with no AI provider at all. Every score comes with the reasons that moved it, like
// Einstein's "top factors". The generative side (writing, summarising, acting) is einstein.js.

const Predict = (() => {
  const TOP_INDUSTRIES = ['Technology', 'Energy', 'Manufacturing', 'Hospitality', 'Education', 'Healthcare', 'Government'];
  const pack = (base, factors) => {
    const score = clamp(Math.round(base + sum(factors, (f) => f[0])), 1, 99);
    const reasons = factors.filter((f) => f[0]).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).map(([d, why]) => `${d > 0 ? '+' : '−'}${Math.abs(Math.round(d))} ${why}`);
    return { score, reasons };
  };
  const recentActivity = (id, days) => DB.activity(id).filter((a) => (a.ActivityDate || a.StartDateTime || a.MessageDate || a.CreatedDate || '').slice(0, 10) >= addDays(today(), -days)).length;

  function lead(l) {
    const f = [];
    const title = String(l.Title || '');
    if (/chief|vp|vice president|head|director|owner|founder|president/i.test(title)) f.push([18, `Senior title (${title})`]);
    else if (/manager|lead/i.test(title)) f.push([9, `Manager title (${title})`]);
    if (TOP_INDUSTRIES.includes(l.Industry)) f.push([10, `Industry fits best customers (${l.Industry})`]);
    const emp = Number(l.NumberOfEmployees) || 0;
    if (emp >= 1000) f.push([14, `${fmt.num(emp)} employees`]); else if (emp >= 200) f.push([8, `${fmt.num(emp)} employees`]); else if (emp && emp < 20) f.push([-8, 'Very small company']);
    if ((Number(l.AnnualRevenue) || 0) >= 50e6) f.push([8, `Revenue ${fmt.short(l.AnnualRevenue)}`]);
    if (['Partner Referral', 'Webinar', 'Trade Show'].includes(l.LeadSource)) f.push([9, `High-intent source (${l.LeadSource})`]);
    if (l.Rating === 'Hot') f.push([12, 'Rated Hot']); else if (l.Rating === 'Cold') f.push([-10, 'Rated Cold']);
    if (!l.Email) f.push([-12, 'No email address']);
    if (l.Id) {
      const touches = DB.all('CampaignMember').filter((m) => m.LeadId === l.Id && ['Clicked', 'Responded', 'Registered', 'Attended'].includes(m.Status)).length;
      if (touches) f.push([6 * Math.min(touches, 3), `Engaged with ${touches} campaign${touches > 1 ? 's' : ''}`]);
      const acts = recentActivity(l.Id, 30);
      if (acts) f.push([4 * Math.min(acts, 3), `${acts} activit${acts > 1 ? 'ies' : 'y'} in 30 days`]);
    }
    if (l.Status === 'Working - Contacted') f.push([5, 'In conversation']);
    return pack(35, f);
  }

  function win(o) {
    const f = [];
    if (o.StageName === 'Closed Won') return { score: 99, reasons: ['Won'] };
    if (o.StageName === 'Closed Lost') return { score: 1, reasons: ['Lost'] };
    // Stage sets the baseline but leaves room for the factors to move it either way.
    const base = 12 + 0.55 * (STAGE_PROB[o.StageName] != null ? STAGE_PROB[o.StageName] : 20);
    const acct = o.AccountId && DB.get(o.AccountId);
    if (acct && String(acct.Type || '').startsWith('Customer')) f.push([10, 'Existing customer']);
    if (acct && acct.Rating === 'Hot') f.push([5, 'Hot account']);
    if (o.CloseDate && o.CloseDate < today()) f.push([-18, `Close date passed ${fmt.ago(o.CloseDate + 'T12:00:00')}`]);
    if (!o.NextStep) f.push([-6, 'No next step']);
    if (o.Competitor && o.Competitor !== 'None') f.push([-7, `Competing with ${o.Competitor}`]);
    if (o.Id) {
      const acts = recentActivity(o.Id, 14);
      if (acts) f.push([4 * Math.min(acts, 3), `${acts} recent activit${acts > 1 ? 'ies' : 'y'}`]); else f.push([-8, 'Nothing logged in 14 days']);
      if (o.ContactId) f.push([4, 'Has a primary contact']);
    }
    if (o.Type === 'Existing Business - Renewal') f.push([10, 'Renewal']);
    return pack(base, f);
  }

  function sentiment(text) {
    const t = String(text || '').toLowerCase();
    if (!t.trim()) return 'Neutral';
    const angry = (t.match(/unacceptable|furious|ridiculous|worst|cancel|lawyer|refund now|terrible|never again|third time|still broken/g) || []).length;
    const frus = (t.match(/frustrat|annoy|disappoint|again|still|waiting|no response|asap|urgent|not working|broken|down|can't|cannot/g) || []).length;
    const pos = (t.match(/thanks|thank you|great|love|appreciate|awesome|perfect|resolved|works now/g) || []).length;
    if (angry >= 1 && angry + frus >= 2) return 'Angry';
    if (frus >= 2 || angry) return 'Frustrated';
    if (pos > frus) return 'Positive';
    return 'Neutral';
  }

  function caseRisk(c) {
    if (c.Status === 'Closed') return { score: 1, reasons: ['Closed'] };
    const f = [];
    const pr = { Critical: 30, High: 18, Medium: 6, Low: 0 }[c.Priority] || 0;
    if (pr) f.push([pr, `${c.Priority} priority`]);
    const s = c.Sentiment || sentiment(c.Description);
    if (s === 'Angry') f.push([22, 'Customer sounds angry']); else if (s === 'Frustrated') f.push([12, 'Customer sounds frustrated']);
    if (c.SlaDue) {
      const left = (new Date(c.SlaDue) - Date.now()) / 3600000;
      if (left < 0) f.push([20, 'SLA already missed']); else if (left < 8) f.push([12, `SLA due in ${Math.max(1, Math.round(left))}h`]);
    }
    const age = daysBetween(c.CreatedDate || today(), today());
    if (age > 7) f.push([Math.min(15, age), `Open ${age} days`]);
    const acct = c.AccountId && DB.get(c.AccountId);
    if (acct && ['Platinum', 'Gold'].includes(acct.SLA)) f.push([8, `${acct.SLA} account`]);
    if (c.Id) {
      const theirs = DB.all('CaseComment').filter((x) => x.ParentId === c.Id && x.FromCustomer).length;
      if (theirs >= 3) f.push([8, `${theirs} customer follow-ups`]);
    }
    if (c.Status === 'Escalated') f.push([25, 'Already escalated']);
    return pack(10, f);
  }

  function health(a) {
    const f = [];
    const cases = DB.all('Case').filter((c) => c.AccountId === a.Id);
    const open = cases.filter((c) => c.Status !== 'Closed');
    const hot = open.filter((c) => ['High', 'Critical'].includes(c.Priority));
    if (hot.length) f.push([-9 * Math.min(hot.length, 4), `${hot.length} open high-priority case${hot.length > 1 ? 's' : ''}`]);
    else if (open.length > 3) f.push([-8, `${open.length} open cases`]);
    const csat = cases.map((c) => Number(c.CSAT)).filter(Boolean);
    if (csat.length) { const avg = sum(csat) / csat.length; f.push([Math.round((avg - 3.5) * 10), `CSAT averages ${avg.toFixed(1)}`]); }
    const orders = DB.all('Order').filter((o) => o.AccountId === a.Id && o.Status !== 'Canceled');
    const recent = orders.filter((o) => o.EffectiveDate >= addDays(today(), -90));
    if (recent.length) f.push([Math.min(12, 4 * recent.length), `${recent.length} order${recent.length > 1 ? 's' : ''} in 90 days`]);
    else if (String(a.Type || '').startsWith('Customer')) f.push([-10, 'No orders in 90 days']);
    const won = DB.all('Opportunity').filter((o) => o.AccountId === a.Id && o.StageName === 'Closed Won' && o.CloseDate >= addDays(today(), -365));
    if (won.length) f.push([6, `${won.length} win${won.length > 1 ? 's' : ''} this year`]);
    const acts = recentActivity(a.Id, 30);
    if (acts) f.push([Math.min(10, acts * 2), `${acts} touches in 30 days`]); else f.push([-6, 'No touches in 30 days']);
    return pack(70, f);
  }

  return { lead, win, sentiment, caseRisk, health };
})();
