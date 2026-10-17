// commerce.js — the Commerce app's own screens:
//   Pages.storefront          the shop: product grid, cart drawer, checkout → Order, ✨ shopping assistant, chat widget (agent ag2)
//   Pages['commerce-insights'] revenue, products, buyers, call-outs, ✨ merchandising ideas, ✨ product descriptions
// The cart lives in DB.org().cart as [{ productId, qty }]. Everything works with AI off; AI only drafts.

(() => {
  const FAMILY_ICON = { Solar: '☀️', Battery: '🔋', 'EV Charging': '🔌', 'Smart Home': '🏠', Software: '💻', Services: '🛠️', Accessories: '🧰' };
  const head = (ctx, title, ...btns) => h('header.pagehead', h('span.objicon', { style: { background: ctx.app.color } }, '🛍️'),
    h('div', h('div.eyebrow', ctx.app.name), h('h1', title)), h('div.grow'), ...btns);
  const famClass = (f) => 'fam-' + String(f || 'x').toLowerCase().replace(/[^a-z]+/g, '');
  const products = () => DB.all('Product2').filter((p) => p.IsActive !== false);
  const stars = (r) => (r ? '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r)) : '');
  const monthLabel = (ym) => new Date(ym + '-15T12:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  const orderTotal = (o) => (o.TotalAmount != null ? o.TotalAmount : sum(DB.all('OrderItem').filter((i) => i.OrderId === o.Id), (i) => i.TotalPrice));

  // ---------- cart ----------

  const cart = () => { const o = DB.org(); if (!Array.isArray(o.cart)) o.cart = []; return o.cart; };
  const stockOf = (p) => (p.Stock == null ? Infinity : p.Stock);
  const lines = () => cart().map((l) => ({ l, p: DB.get(l.productId) })).filter((x) => x.p);
  const cartTotal = () => sum(lines(), (x) => x.l.qty * (x.p.ListPrice || 0));
  const cartCount = () => sum(lines(), (x) => x.l.qty);
  function addToCart(p, qty = 1) {
    const c = cart();
    const have = c.find((l) => l.productId === p.Id);
    const next = (have ? have.qty : 0) + qty;
    if (next > stockOf(p)) { UI.toast(`Only ${p.Stock} of ${p.Name} in stock`, 'err'); return false; }
    if (have) have.qty = next; else c.push({ productId: p.Id, qty });
    DB.save();
    return true;
  }
  function setQty(p, qty) {
    const c = cart();
    const i = c.findIndex((l) => l.productId === p.Id);
    if (i < 0) return;
    if (qty <= 0) c.splice(i, 1);
    else if (qty > stockOf(p)) { UI.toast(`Only ${p.Stock} of ${p.Name} in stock`, 'err'); return; }
    else c[i].qty = qty;
    DB.save();
  }

  // ---------- storefront state (module level, so redraws and navigation keep the chat and cart UI) ----------

  const S = { cat: 'All', q: '', sort: 'featured', buyerId: null, drawer: false, ai: null, chatOpen: false, chat: [], chatBusy: false, draw: {} };
  const shoppers = () => DB.all('Contact').filter((c) => c.Title === 'Shopper');
  const buyer = () => (S.buyerId && DB.get(S.buyerId)) || shoppers()[0] || DB.all('Contact')[0];

  // Keyword search with a few synonyms. The fallback when AI is off.
  const SYN = { panel: ['solar'], panels: ['solar'], sun: ['solar'], roof: ['solar'], power: ['battery', 'solar'], backup: ['battery'], storage: ['battery'], car: ['ev charging'], ev: ['ev charging'], charger: ['ev charging'], thermostat: ['smart home'], smart: ['smart home'], app: ['software'], monitor: ['software', 'smart home'], install: ['services'], installation: ['services'], cable: ['accessories'], mount: ['accessories'] };
  function keywordSearch(q, list) {
    const toks = String(q).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
    if (!toks.length) return list;
    const scored = list.map((p) => {
      const hay = `${p.Name} ${p.Family} ${p.Description || ''} ${p.ProductCode || ''}`.toLowerCase();
      let s = 0;
      for (const t of toks) {
        if (hay.includes(t)) s += p.Name.toLowerCase().includes(t) ? 3 : 1;
        for (const f of SYN[t] || []) if (String(p.Family).toLowerCase() === f) s += 2;
      }
      return { p, s };
    });
    return scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.p);
  }
  function visible() {
    let list = products();
    if (S.cat !== 'All') list = list.filter((p) => p.Family === S.cat);
    if (S.ai && S.ai.ids) list = S.ai.ids.map((id) => list.find((p) => p.Id === id)).filter(Boolean);
    else if (S.q.trim()) list = keywordSearch(S.q, list);
    else if (S.sort === 'price-asc') list = list.slice().sort((a, b) => a.ListPrice - b.ListPrice);
    else if (S.sort === 'price-desc') list = list.slice().sort((a, b) => b.ListPrice - a.ListPrice);
    else if (S.sort === 'rating') list = list.slice().sort((a, b) => (b.Rating || 0) - (a.Rating || 0));
    return list;
  }

  const img = (p, big) => h(`div.sf-img.${famClass(p.Family)}${big ? '.big' : ''}`, h('span', p.Image || FAMILY_ICON[p.Family] || '📦'));
  const stockBadge = (p) => p.Stock == null ? null : p.Stock === 0 ? h('span.sf-stock.out', 'Out of stock') : p.Stock <= 20 ? h('span.sf-stock.low', `Only ${p.Stock} left`) : null;

  function productModal(p) {
    let qty = 1;
    const qtyEl = h('span.sf-qty-n', '1');
    const body = h('div.sf-detail', img(p, true),
      h('div.sf-detail-b', h('div.muted', p.Family), h('h2', p.Name), h('div.sf-rate', stars(p.Rating), p.Rating ? h('small.muted', ` ${p.Rating}`) : null),
        h('div.sf-price.big', fmt.money(p.ListPrice)), h('p', p.Description || 'No description yet.'), h('small.muted', `SKU ${p.ProductCode || '—'}`), stockBadge(p),
        h('div.row', h('div.sf-qty', h('button', { onclick: () => { qty = Math.max(1, qty - 1); qtyEl.textContent = qty; } }, '−'), qtyEl, h('button', { onclick: () => { qty = Math.min(qty + 1, stockOf(p)); qtyEl.textContent = qty; } }, '+')))));
    const m = UI.modal({ title: p.Name, body, actions: [{ label: p.Stock === 0 ? 'Out of stock' : 'Add to cart', primary: true, run: () => { if (p.Stock === 0) return false; if (addToCart(p, qty)) { UI.toast(`${qty} × ${p.Name} added`, 'ok', { label: 'View cart', run: () => { S.drawer = true; S.draw.all(); } }); S.draw.all(); } else return false; } }] });
    return m;
  }

  function card(p) {
    const inCart = (cart().find((l) => l.productId === p.Id) || {}).qty;
    return h('div.sf-card', { onclick: () => productModal(p) }, img(p), h('div.sf-card-b', h('div.sf-fam', p.Family), h('b.sf-name', p.Name),
      h('div.sf-rate', stars(p.Rating), p.Rating ? h('small.muted', ` ${p.Rating}`) : null), stockBadge(p),
      h('div.sf-card-f', h('span.sf-price', fmt.money(p.ListPrice)), h('button.btn.sm.primary', { disabled: p.Stock === 0, onclick: (e) => { e.stopPropagation(); if (addToCart(p)) { UI.toast(`${p.Name} added`, 'ok'); S.draw.all(); } } }, inCart ? `Add (${inCart})` : 'Add'))));
  }

  // ---------- ✨ shopping assistant ----------

  async function askAssistant(q) {
    if (!q.trim()) { S.ai = null; S.draw.grid(); return; }
    if (!Einstein.ready()) { S.ai = { q, fallback: true }; S.draw.grid(); return; }
    S.ai = { q, loading: true }; S.draw.grid();
    try {
      const cat = products().map((p) => `${p.Id} | ${p.Name} | ${p.Family} | ${fmt.money(p.ListPrice)} | ${(p.Description || '').slice(0, 90)}`).join('\n');
      const r = await Einstein.ask({ task: 'storefront-search', prompt: `A shopper at Brightwave Energy's online store says: "${q}".\nPick up to 6 products from this catalog that fit best, best first. Use only the ids listed. Then say in one friendly sentence why.\n\n${cat}`,
        schema: Einstein.S.obj({ ids: Einstein.S.arr(Einstein.S.str('product id'), 'best matches first'), answer: Einstein.S.str('one friendly sentence') }) });
      const valid = (r.ids || []).filter((id) => products().some((p) => p.Id === id));
      S.ai = { q, ids: valid, answer: r.answer, meta: r.meta, empty: !valid.length };
    } catch (e) { S.ai = { q, fallback: true, error: e.message, setup: !!e.setup }; }
    S.draw.grid();
  }

  // ---------- checkout ----------

  function checkout() {
    const ls = lines();
    if (!ls.length) { UI.toast('Your cart is empty', 'err'); return; }
    const b0 = buyer();
    const st = { acct: b0 ? b0.AccountId : null, contact: b0 ? b0.Id : null, city: (b0 && b0.MailingCity) || '' };
    const accts = DB.all('Account').filter((a) => DB.all('Contact').some((c) => c.AccountId === a.Id));
    const ct = h('select');
    const city = h('input', { value: st.city, placeholder: 'City', oninput: (e) => { st.city = e.target.value; } });
    const fillContacts = () => {
      const cs = DB.all('Contact').filter((c) => c.AccountId === st.acct);
      if (!cs.find((c) => c.Id === st.contact)) st.contact = cs[0] && cs[0].Id;
      ct.replaceChildren(...cs.map((c) => h('option', { value: c.Id, selected: c.Id === st.contact }, `${DB.name(c.Id)}${c.Title ? ' · ' + c.Title : ''}`)));
      const c = DB.get(st.contact); st.city = (c && c.MailingCity) || st.city; city.value = st.city;
    };
    ct.onchange = (e) => { st.contact = e.target.value; const c = DB.get(st.contact); if (c && c.MailingCity) { st.city = c.MailingCity; city.value = st.city; } };
    const acct = h('select', { onchange: (e) => { st.acct = e.target.value; fillContacts(); } }, accts.map((a) => h('option', { value: a.Id, selected: a.Id === st.acct }, a.Name)));
    fillContacts();
    const body = h('div.sf-checkout',
      h('div.sf-co-lines', ls.map((x) => h('div.sf-co-line', img(x.p), h('div.grow', h('b', x.p.Name), h('small.muted', `${x.l.qty} × ${fmt.money(x.p.ListPrice)}`)), h('b', fmt.money(x.l.qty * x.p.ListPrice)))),
        h('div.sf-co-total', h('span', 'Total'), h('b', fmt.money(cartTotal())))),
      h('div.form-grid', h('label', 'Account', acct), h('label', 'Buyer', ct), h('label', 'Ship to city', city)),
      h('small.muted', 'This creates an Order and its Order Products in the CRM, shown on the buyer’s account.'));
    UI.modal({ title: 'Checkout', body, actions: [{ label: `Place order · ${fmt.money(cartTotal())}`, primary: true, run: () => {
      if (!st.acct || !st.contact) { UI.toast('Pick an account and buyer', 'err'); return false; }
      const fresh = lines();
      const short = fresh.find((x) => x.l.qty > stockOf(x.p));
      if (short) { UI.toast(`${short.p.Name}: only ${short.p.Stock} in stock`, 'err'); return false; }
      let order;
      try {
        order = DB.insert('Order', { AccountId: st.acct, BillToContactId: st.contact, Status: 'Activated', Channel: 'Storefront', EffectiveDate: today(), ShippingCity: st.city });
        for (const x of fresh) {
          DB.insert('OrderItem', { OrderId: order.Id, Product2Id: x.p.Id, Quantity: x.l.qty, UnitPrice: x.p.ListPrice });
          if (x.p.Stock != null) DB.update(x.p.Id, { Stock: Math.max(0, x.p.Stock - x.l.qty) });
        }
      } catch (e) { UI.toast(e.message, 'err'); return false; }
      const items = fresh.map((x) => ({ name: x.p.Name, qty: x.l.qty, img: x.p.Image, price: x.p.ListPrice }));
      const total = fresh.reduce((n, x) => n + x.l.qty * x.p.ListPrice, 0);
      DB.org().cart = []; DB.save();
      S.drawer = false; S.buyerId = st.contact;
      setTimeout(() => { S.draw.all(); confirmation(DB.get(order.Id) || order, items, total); }, 0);
    } }] });
  }

  function confirmation(order, items, total) {
    UI.modal({ title: 'Order placed', body: h('div.sf-done', h('div.sf-done-ic', '🎉'), h('h2', 'Thank you!'),
      h('p', 'Order ', h('a.reclink', { href: '#/r/' + order.Id, onclick: () => document.querySelector('.modal-back') && document.querySelector('.modal-back').remove() }, String(order.OrderNumber || order.Id)), ` is confirmed for ${DB.name(order.AccountId)}.`),
      h('div.sf-co-lines', items.map((i) => h('div.sf-co-line', h('span.sf-co-em', i.img || '📦'), h('div.grow', `${i.qty} × ${i.name}`), h('b', fmt.money(i.qty * i.price)))), h('div.sf-co-total', h('span', 'Total'), h('b', fmt.money(total))))),
      actions: [{ label: 'Open order', primary: true, run: () => Shell.go('#/r/' + order.Id) }, { label: 'Keep shopping' }] });
  }

  // ---------- chat widget (Agentforce customer agent ag2) ----------

  function chatReply(text) {
    // Rule-based fallback when AI is off: order status, stock, shipping, or a product suggestion.
    const t = text.toLowerCase();
    const b = buyer();
    const mine = DB.all('Order').filter((o) => o.BillToContactId === (b && b.Id) || (b && o.AccountId === b.AccountId && b.Title === 'Shopper')).sort((a, c) => String(c.EffectiveDate).localeCompare(String(a.EffectiveDate)));
    if (/order|track|where|deliver|ship/.test(t)) {
      const num = (t.match(/\d{4,6}/) || [])[0];
      const o = (num && DB.all('Order').find((x) => String(x.OrderNumber).includes(num))) || mine[0];
      if (o) return `Order ${o.OrderNumber} (${fmt.date(o.EffectiveDate)}) is ${String(o.Status).toLowerCase()}${o.TrackingNumber ? ', tracking ' + o.TrackingNumber : ''}. Total ${fmt.money(orderTotal(o))}.`;
      return 'I could not find an order for you yet. Place one and I can track it.';
    }
    if (/return|refund/.test(t)) return 'You can return unused items within 30 days. Tell us the order number and we will send a prepaid label.';
    const found = keywordSearch(text, products()).slice(0, 3);
    if (found.length) return `Here is what I would look at: ${found.map((p) => `${p.Name} (${fmt.money(p.ListPrice)}${p.Stock === 0 ? ', out of stock' : ''})`).join('; ')}.`;
    return 'I can help with products, order status and returns. What would you like to know?';
  }
  async function sendChat(text) {
    text = text.trim();
    if (!text || S.chatBusy) return;
    S.chat.push({ role: 'user', text });
    S.chatBusy = true; S.draw.chat();
    const b = buyer();
    try {
      if (!Einstein.ready()) throw Object.assign(new Error('offline'), { setup: true });
      const r = await Agentforce.run(text, { agentId: 'ag2', msgs: S.chat, context: { text: `The shopper is ${b ? DB.name(b.Id) : 'a guest'} at ${b && b.AccountId ? DB.name(b.AccountId) : 'the online store'}${b ? ` (contact id ${b.Id})` : ''}. Today is ${today()}.` } });
      S.chat.push({ role: 'agent', text: r.text, ai: true });
    } catch (e) {
      S.chat.push({ role: 'agent', text: chatReply(text), rule: true });
    }
    S.chatBusy = false; S.draw.chat();
  }

  // ---------- the page ----------

  Pages.storefront = {
    title: 'Storefront', icon: '🛍️', live: false,
    render: (ctx) => {
      const root = h('div.page.sf-page');
      const hero = h('div.sf-hero');
      const tools = h('div.sf-tools');
      const grid = h('div.sf-grid');
      const note = h('div.sf-note');
      const drawer = h('div.sf-drawer-host');
      const chat = h('div.sf-chat-host');
      const search = h('input.sf-search', { placeholder: 'Search, or describe what you need…', value: S.q, oninput: (e) => { S.q = e.target.value; S.ai = null; drawGrid(); },
        onkeydown: (e) => { if (e.key === 'Enter') askAssistant(S.q); } });

      const drawHero = () => {
        const b = buyer();
        hero.replaceChildren(h('div.sf-hero-t', h('div.sf-hero-k', '☀️ Spring energy sale'), h('h2', 'Power your home with the sun'), h('p', 'Solar, storage and smart-home gear, installed by people who live here.')),
          h('div.sf-hero-a', h('label.sf-who', 'Shopping as', h('select', { onchange: (e) => { S.buyerId = e.target.value; drawHero(); drawChat(); } },
            shoppers().slice(0, 40).map((c) => h('option', { value: c.Id, selected: b && c.Id === b.Id }, DB.name(c.Id))))),
            h('button.btn.primary', { onclick: () => { S.drawer = true; drawAll(); } }, `🛒 Cart (${cartCount()}) · ${fmt.money(cartTotal())}`)));
      };
      const drawTools = () => {
        const fams = ['All'].concat(uniq(products().map((p) => p.Family)));
        tools.replaceChildren(search, h('button.btn.ai', { onclick: () => askAssistant(S.q) }, '✨ Ask'),
          h('div.chips', fams.map((f) => h('button.chip' + (S.cat === f ? '.on' : ''), { onclick: () => { S.cat = f; drawTools(); drawGrid(); } }, f === 'All' ? 'All' : `${FAMILY_ICON[f] || ''} ${f}`))),
          h('select', { onchange: (e) => { S.sort = e.target.value; drawGrid(); } }, [['featured', 'Featured'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'], ['rating', 'Top rated']].map(([v, l]) => h('option', { value: v, selected: v === S.sort }, l))));
      };
      const drawGrid = () => {
        const list = visible();
        const a = S.ai;
        note.replaceChildren(...[
          a && a.loading ? UI.spinner(`${Einstein.word()} is browsing the catalog…`) : null,
          a && a.answer ? h('div.sf-ai', h('span.ai-badge', '✨'), h('div', h('b', a.answer), h('div.ai-foot', Einstein.footnote(a.meta)), h('button.link', { onclick: () => { S.ai = null; S.q = ''; search.value = ''; drawGrid(); } }, 'Clear'))) : null,
          a && a.fallback && !a.loading ? h('div.sf-ai.plain', h('span', '🔎'), h('div', a.error && !a.setup ? h('div.ai-err', '⚠️ ', a.error) : null, `Showing keyword matches for “${a.q}”. ${Einstein.ready() ? '' : 'Turn on AI in Settings for natural-language search.'}`)) : null,
          a && a.empty ? h('div.sf-ai.plain', 'No products matched that. Try different words.') : null,
        ].filter(Boolean));
        const kw = a && a.fallback ? keywordSearch(a.q, S.cat === 'All' ? products() : products().filter((p) => p.Family === S.cat)) : list;
        const show = a && a.fallback ? kw : list;
        grid.replaceChildren(...(show.length ? show.map(card) : [h('div.sf-empty', UI.empty('🛍️', 'Nothing here', 'Try another category or search.'))]));
      };
      const drawDrawer = () => {
        if (!S.drawer) { drawer.replaceChildren(); return; }
        const ls = lines();
        const close = () => { S.drawer = false; drawDrawer(); };
        drawer.replaceChildren(h('div.sf-scrim', { onclick: close }), h('aside.sf-drawer',
          h('div.sf-drawer-h', h('b', `Your cart (${cartCount()})`), h('div.grow'), h('button.iconbtn', { onclick: close }, '×')),
          h('div.sf-drawer-b', ls.length ? ls.map((x) => h('div.sf-line', img(x.p), h('div.grow', h('b', x.p.Name), h('small.muted', fmt.money(x.p.ListPrice)),
            h('div.sf-qty', h('button', { onclick: () => { setQty(x.p, x.l.qty - 1); drawAll(); } }, '−'), h('span.sf-qty-n', x.l.qty), h('button', { onclick: () => { setQty(x.p, x.l.qty + 1); drawAll(); } }, '+'))),
            h('div.sf-line-r', h('b', fmt.money(x.l.qty * x.p.ListPrice)), h('button.link', { onclick: () => { setQty(x.p, 0); drawAll(); } }, 'Remove')))) : [UI.empty('🛒', 'Your cart is empty', 'Add something from the shop.')]),
          h('div.sf-drawer-f', h('div.sf-co-total', h('span', 'Subtotal'), h('b', fmt.money(cartTotal()))), h('button.btn.primary', { disabled: !ls.length, onclick: checkout }, 'Checkout'))));
      };
      const drawChat = () => {
        const b = buyer();
        if (!S.chatOpen) { chat.replaceChildren(h('button.sf-chat-fab', { onclick: () => { S.chatOpen = true; drawChat(); } }, '💬 Chat with us')); return; }
        const list = h('div.msgs.sf-msgs', { dataset: { scroll: 'sf-chat' } }, S.chat.length ? S.chat.map((m) => m.role === 'user'
          ? h('div.msg.user', h('div.bubble', m.text))
          : h('div.msg.agent', h('span.avatar.bot', '🎧'), h('div.bubble', m.text, m.rule ? h('small.sf-rule', ' · automatic reply') : null)))
          : [h('div.sf-chat-hi', h('b', `Hi ${b ? b.FirstName : 'there'}, I'm the Brightwave helper.`), h('div.muted', 'Ask about products, an order, or returns.'))],
          S.chatBusy ? h('div.msg.agent', h('span.avatar.bot', '🎧'), h('div.bubble', h('span.typing', h('i'), h('i'), h('i')))) : null);
        const inp = h('input', { placeholder: 'Type a message…', onkeydown: (e) => { if (e.key === 'Enter') { const v = e.target.value; e.target.value = ''; sendChat(v); } } });
        chat.replaceChildren(h('div.sf-chat', h('div.sf-chat-h', h('b', '💬 Brightwave support'), h('div.grow'), h('button.iconbtn', { title: 'New chat', onclick: () => { S.chat = []; drawChat(); } }, '↺'), h('button.iconbtn', { onclick: () => { S.chatOpen = false; drawChat(); } }, '×')),
          list, h('div.sf-chat-f', inp, h('button.btn.primary.sm', { onclick: () => { const v = inp.value; inp.value = ''; sendChat(v); } }, 'Send'))));
        list.scrollTop = list.scrollHeight;
        if (!S.chatBusy) setTimeout(() => inp.isConnected && S.chatOpen && inp.focus(), 0);
      };
      const drawAll = () => { drawHero(); drawGrid(); drawDrawer(); };
      S.draw = { all: drawAll, grid: drawGrid, chat: drawChat };
      drawHero(); drawTools(); drawGrid(); drawDrawer(); drawChat();
      root.append(head(ctx, 'Storefront', h('a.btn', { href: '#/app/commerce/commerce-insights' }, '📊 Insights'), h('a.btn', { href: Shell.objUrl('Order') }, 'Orders')), hero, tools, note, grid, drawer, chat);
      return root;
    },
  };

  // ---------- Commerce insights ----------

  const ins = { merch: null, descP: null, desc: null };

  function commerceData() {
    const orders = DB.all('Order').filter((o) => o.Status !== 'Canceled');
    const itemsBy = groupBy(DB.all('OrderItem'), (i) => i.OrderId);
    const rows = orders.map((o) => ({ o, items: itemsBy[o.Id] || [], total: orderTotal(o) || 0, month: String(o.EffectiveDate).slice(0, 7), key: o.BillToContactId || o.AccountId }));
    return rows;
  }

  function insights(rows) {
    const out = [];
    const t = today();
    const last = rows.filter((r) => daysBetween(r.o.EffectiveDate, t) <= 30 && daysBetween(r.o.EffectiveDate, t) >= 0);
    const prev = rows.filter((r) => daysBetween(r.o.EffectiveDate, t) > 30 && daysBetween(r.o.EffectiveDate, t) <= 60);
    const a = sum(last, (r) => r.total), b = sum(prev, (r) => r.total);
    if (b > 0) {
      const ch = ((a - b) / b) * 100;
      if (ch <= -15) out.push({ icon: '📉', tone: 'bad', text: `Revenue is down ${fmt.pct(-ch)} vs the previous 30 days`, sub: `${fmt.short(a)} vs ${fmt.short(b)}.` });
      else if (ch >= 15) out.push({ icon: '📈', tone: 'ok', text: `Revenue is up ${fmt.pct(ch)} vs the previous 30 days`, sub: `${fmt.short(a)} vs ${fmt.short(b)}.` });
    }
    const sold = {};
    for (const r of rows) if (daysBetween(r.o.EffectiveDate, t) <= 60) for (const i of r.items) sold[i.Product2Id] = (sold[i.Product2Id] || 0) + i.Quantity;
    const ps = products();
    const risky = ps.filter((p) => p.Stock != null && p.Stock <= 20 && (sold[p.Id] || 0) >= 3).sort((x, y) => (sold[y.Id] || 0) - (sold[x.Id] || 0));
    if (risky.length) out.push({ icon: '📦', tone: 'warn', text: `${risky[0].Name} is selling fast with ${risky[0].Stock} left${risky.length > 1 ? ` (+${risky.length - 1} more low-stock sellers)` : ''}`, sub: 'Reorder before it runs out.', go: '#/r/' + risky[0].Id });
    const oos = ps.filter((p) => p.Stock === 0);
    if (oos.length) out.push({ icon: '🚫', tone: 'bad', text: `${oos.length} active product${oos.length > 1 ? 's are' : ' is'} out of stock`, sub: oos.slice(0, 3).map((p) => p.Name).join(', ') + (oos.length > 3 ? '…' : ''), go: Shell.objUrl('Product2') });
    const never = ps.filter((p) => !sold[p.Id] && p.Family !== 'Services');
    if (never.length) out.push({ icon: '🐌', tone: 'warn', text: `${never.length} products had no sales in 60 days`, sub: never.slice(0, 3).map((p) => p.Name).join(', ') + (never.length > 3 ? '…' : '') });
    const weak = ps.filter((p) => p.Rating && p.Rating < 4.1 && (sold[p.Id] || 0) > 0).sort((x, y) => x.Rating - y.Rating)[0];
    if (weak) out.push({ icon: '⭐', tone: 'warn', text: `${weak.Name} is rated ${weak.Rating} yet still sells`, sub: 'Check reviews and support cases for this product.', go: '#/r/' + weak.Id });
    const big = last.slice().sort((x, y) => y.total - x.total)[0];
    const avg = last.length ? a / last.length : 0;
    if (big && avg && big.total > avg * 3) out.push({ icon: '🐋', tone: 'info', text: `One order (${big.o.OrderNumber}) is ${x1(big.total / avg)}× the usual size`, sub: `${fmt.money(big.total)} for ${DB.name(big.o.AccountId)}.`, go: '#/r/' + big.o.Id });
    return out;
  }
  const x1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

  Pages['commerce-insights'] = {
    title: 'Commerce insights', icon: '📊',
    render: (ctx) => {
      const rows = commerceData();
      const total = sum(rows, (r) => r.total);
      const aov = rows.length ? total / rows.length : 0;
      const byBuyer = groupBy(rows, (r) => r.key);
      const buyers = Object.entries(byBuyer);
      const repeat = buyers.length ? buyers.filter(([, v]) => v.length > 1).length / buyers.length : 0;
      const byMonth = groupBy(rows, (r) => r.month);
      const months = Object.keys(byMonth).sort().slice(-8);
      const famRev = {}, prodRev = {};
      for (const r of rows) for (const i of r.items) {
        const p = DB.get(i.Product2Id); if (!p) continue;
        famRev[p.Family || 'Other'] = (famRev[p.Family || 'Other'] || 0) + (i.TotalPrice || 0);
        prodRev[p.Id] = (prodRev[p.Id] || 0) + (i.TotalPrice || 0);
      }
      const topProd = Object.entries(prodRev).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([id, v]) => ({ label: DB.name(id), value: Math.round(v), key: id }));
      const topBuyers = buyers.map(([k, v]) => ({ k, n: v.length, rev: sum(v, (r) => r.total) })).sort((x, y) => y.rev - x.rev).slice(0, 8);
      const notes = insights(rows);
      const storefront = rows.filter((r) => r.o.Channel === 'Storefront');

      return h('div.page.ci-page',
        head(ctx, 'Commerce insights', h('a.btn', { href: '#/app/commerce/storefront' }, '🛍️ Storefront'), h('a.btn.primary', { href: Shell.objUrl('Order') }, 'All orders')),
        h('div.kpis',
          UI.stat('Revenue', fmt.short(total), `${fmt.num(rows.length)} orders`, 'var(--accent)'),
          UI.stat('Average order value', fmt.money(aov), `${fmt.short(sum(storefront, (r) => r.total))} from the storefront`, 'var(--ai)'),
          UI.stat('Repeat purchase rate', fmt.pct(repeat * 100), `${buyers.filter(([, v]) => v.length > 1).length} of ${buyers.length} buyers ordered again`, 'var(--ok)'),
          UI.stat('Units sold', fmt.num(sum(rows, (r) => sum(r.items, (i) => i.Quantity))), `${uniq(Object.keys(prodRev)).length} products`, 'var(--warn)')),
        h('div.ci-top', UI.card('Worth knowing', notes.length ? h('div.mk-calls', notes.map((n) => h(n.go ? 'a.mk-call.' + n.tone : 'div.mk-call.' + n.tone, n.go ? { href: n.go } : null, h('span.mk-call-ic', n.icon), h('div', h('b', n.text), n.sub ? h('small', n.sub) : null)))) : h('p.muted', 'Nothing unusual right now.'), { icon: '💡', count: notes.length }),
          merchCard(rows, prodRev)),
        h('div.homegrid.ci-charts',
          UI.card('Revenue by month', Charts.draw('line', months.map((m) => ({ label: monthLabel(m), value: Math.round(sum(byMonth[m], (r) => r.total)) })), { format: fmt.short }), { icon: '📈' }),
          UI.card('Revenue by product family', Charts.draw('donut', Object.entries(famRev).sort((x, y) => y[1] - x[1]).map(([l, v]) => ({ label: l, value: Math.round(v) })), { format: fmt.short, totalLabel: 'Revenue' }), { icon: '🧩' }),
          UI.card('Top products', Charts.draw('hbar', topProd, { format: fmt.short, onClick: (d) => Shell.go('#/r/' + d.key), single: true }), { icon: '🏆' }),
          UI.card('Top buyers', h('div.tablewrap', h('table.grid.compact', h('thead', h('tr', h('th', 'Buyer'), h('th.num', 'Orders'), h('th.num', 'Revenue'))),
            h('tbody', topBuyers.map((b) => h('tr', h('td', h('a.reclink', { href: '#/r/' + b.k }, DB.name(b.k))), h('td.num', b.n), h('td.num', fmt.short(b.rev))))))), { icon: '👑' })),
        descCard());
    },
  };

  // ✨ Merchandising: bundles, promotions, low performers. Ideas only; nothing is changed.
  function merchCard(rows, prodRev) {
    const body = h('div.ci-merch');
    const draw = () => {
      const m = ins.merch;
      body.replaceChildren(
        h('p.muted', `Ask ${Einstein.word()} for bundle, promotion and clean-up ideas based on what sells together.`),
        h('div.row', h('button.btn.ai', { disabled: m && m.loading, onclick: async () => {
          if (!Einstein.ready()) { ins.merch = { error: Einstein.state().problem, setup: true }; draw(); return; }
          ins.merch = { loading: true }; draw();
          try {
            const pairs = {};
            for (const r of rows) { const ids = uniq(r.items.map((i) => i.Product2Id)); for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const k = [ids[i], ids[j]].sort().join('|'); pairs[k] = (pairs[k] || 0) + 1; } }
            const top = Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k.split('|').map((id) => DB.name(id)).join(' + ')}: ${n} orders`).join('\n');
            const sellers = products().map((p) => `${p.Name} (${p.Family}, ${fmt.money(p.ListPrice)}, stock ${p.Stock == null ? 'n/a' : p.Stock}, rating ${p.Rating || '–'}): ${fmt.short(prodRev[p.Id] || 0)} revenue`).join('\n');
            const r = await Einstein.ask({ task: 'merchandising', prompt: `You advise the Brightwave Energy online store. Give 4 to 6 concrete merchandising recommendations: bundles of products bought together, promotions for slow or overstocked items, and what to do about low performers. Use only products named below.\n\nBought together:\n${top || 'none yet'}\n\nProducts:\n${sellers}`,
              schema: Einstein.S.obj({ ideas: Einstein.S.arr(Einstein.S.obj({ kind: Einstein.S.oneOf(['Bundle', 'Promotion', 'Low performer']), title: Einstein.S.str('short title'), detail: Einstein.S.str('one or two sentences, with the products named') })) }) });
            ins.merch = { result: r };
          } catch (e) { ins.merch = { error: e.message, setup: !!e.setup }; }
          draw();
        } }, '✨ Merchandising ideas'), m && m.loading ? UI.spinner(`${Einstein.word()} is analysing sales…`) : null),
        m && m.error ? h('div.ai-err', '⚠️ ', m.error) : null, m && m.setup ? Einstein.setupNote(m.error) : null,
        m && m.result ? h('div.ci-ideas', (m.result.ideas || []).map((i) => h('div.ci-idea', UI.badge(i.kind, i.kind === 'Bundle' ? '#0b72d9' : i.kind === 'Promotion' ? '#2e844a' : '#c27a00'), h('b', i.title), h('div', i.detail))),
          h('div.ai-foot', Einstein.footnote(m.result.meta))) : null);
    };
    draw();
    return UI.card('Merchandising recommendations', body, { icon: '✨', className: 'ai-card' });
  }

  // ✨ Product description: pick a product, get a draft, edit it, and click to save into Product2.Description.
  function descCard() {
    const body = h('div.ci-desc');
    const draw = () => {
      const ps = products();
      if (!ins.descP || !DB.get(ins.descP)) ins.descP = ps[0] && ps[0].Id;
      const p = DB.get(ins.descP);
      const d = ins.desc;
      const ta = h('textarea', { rows: 4, oninput: (e) => { d.text = e.target.value; } }, d && d.text ? d.text : '');
      body.replaceChildren(
        h('div.row', h('label.ci-pick', 'Product', h('select', { onchange: (e) => { ins.descP = e.target.value; ins.desc = null; draw(); } }, ps.map((x) => h('option', { value: x.Id, selected: x.Id === ins.descP }, x.Name)))),
          h('button.btn.ai', { disabled: d && d.loading, onclick: async () => {
            if (!p) return;
            if (!Einstein.ready()) { ins.desc = { error: Einstein.state().problem, setup: true }; draw(); return; }
            ins.desc = { loading: true }; draw();
            try {
              const r = await Einstein.ask({ task: 'product-description', prompt: `Write a 2-sentence storefront description for ${p.Name} (${p.Family}, ${fmt.money(p.ListPrice)}, product code ${p.ProductCode || 'n/a'}). Friendly and concrete, no hype words, no invented specifications.\nCurrent description: ${p.Description || 'none'}`,
                schema: Einstein.S.obj({ description: Einstein.S.str('the description') }) });
              ins.desc = { text: r.description, meta: r.meta, for: p.Id };
            } catch (e) { ins.desc = { error: e.message, setup: !!e.setup }; }
            draw();
          } }, '✨ Write description')),
        p ? h('div.ci-current', h('small.muted', 'Current description'), h('div', p.Description || h('span.muted', 'None'))) : null,
        d && d.loading ? UI.spinner(`${Einstein.word()} is writing…`) : null,
        d && d.error ? h('div.ai-err', '⚠️ ', d.error) : null, d && d.setup ? Einstein.setupNote(d.error) : null,
        d && d.text != null ? h('div.ci-draft', ta, h('div.ai-row', Einstein.footnote(d.meta), h('div.grow'), h('button.btn.sm.ghost', { onclick: () => { ins.desc = null; draw(); } }, 'Discard'),
          h('button.btn.primary.sm', { onclick: () => {
            try { DB.update(d.for, { Description: d.text }); ins.desc = null; UI.toast(`Description saved to ${DB.name(d.for)}`, 'ok', { label: 'Open', run: () => Shell.go('#/r/' + d.for) }); draw(); } catch (e) { UI.toast(e.message, 'err'); }
          } }, 'Save to product'))) : null);
    };
    draw();
    return UI.card('Write a product description', body, { icon: '✨', className: 'ai-card' });
  }
})();
