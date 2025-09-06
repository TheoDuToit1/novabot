  // Determine current bot name from preview/SDK/active bot/local defaults
  function getBotName(){
    try{
      if (window.__previewBot && window.__previewBot.name) return String(window.__previewBot.name).trim();
    }catch{}
    try{
      if (window.__sdkBot && window.__sdkBot.name) return String(window.__sdkBot.name).trim();
    }catch{}
    try{
      const activeId = localStorage.getItem('nova_active_bot_id') || '';
      if (activeId){
        const bots = JSON.parse(localStorage.getItem('nova_bots_v1')||'[]');
        const bot = bots.find(b=> b && b.id === activeId);
        if (bot && bot.name) return bot.name;
      }
    }catch{}
    return 'Nova';
  }

  // Retrieve active bot configuration (preview > SDK > local active)
  function getActiveBot(){
    try{ if (window.__previewBot && window.__previewBot.name) return window.__previewBot; }catch{}
    try{ if (window.__sdkBot && window.__sdkBot.name) return window.__sdkBot; }catch{}
    try{
      const activeId = localStorage.getItem('nova_active_bot_id') || '';
      const bots = JSON.parse(localStorage.getItem('nova_bots_v1')||'[]');
      const bot = bots.find(b=> b && b.id === activeId);
      if (bot) return bot;
      return bots[0] || {};
    }catch{ return {}; }
  }

  // KB parsing + inverted index (tokenless)
  const __KB = { hash:'', entries:[], index:new Map(), built:false };
  const norm = (s)=> String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
  const toks = (s)=> norm(s).split(/[^a-z0-9]+/).filter(w=> w && w.length>=2);
  const hashStr = (s)=>{ let h=0; for(let i=0;i<s.length;i++){ h=(h*31 + s.charCodeAt(i))|0; } return String(h>>>0); };

  function parseKB(raw){
    const text = String(raw||'').trim();
    if (!text) return [];
    const entries = [];
    // Pattern A: Markdown sections
    const mdBlocks = text.split(/\n(?=##\s)/);
    mdBlocks.forEach(block=>{
      if (!/^##\s/.test(block)) return;
      const lines = block.split(/\n/);
      const q = lines[0].replace(/^##\s*/, '').trim();
      let answer = '';
      let keywords = [];
      let synLine = '';
      for (let i=1;i<lines.length;i++){
        const L = lines[i].trim(); if (!L) continue;
        if (/^answer\s*:/i.test(L)) { answer = L.replace(/^answer\s*:/i,'').trim(); continue; }
        if (/^keywords\s*:/i.test(L)) { const v = L.replace(/^keywords\s*:/i,'').trim(); keywords = v.split(/,\s*/).filter(Boolean); continue; }
        if (/^synonyms\s*:/i.test(L)) { synLine = L.replace(/^synonyms\s*:/i,'').trim(); continue; }
      }
      const synonyms = parseSynonyms(synLine);
      if (q || answer){ entries.push({ q, answer, keywords, synonyms }); }
    });
    // Pattern B: Q/A blocks separated by ---
    text.split(/\n-{3,,}\n|\n---\n/).forEach(block=>{
      const mQ = block.match(/\bQ:\s*(.+)/i);
      const mA = block.match(/\bA:\s*(.+)/i);
      const mK = block.match(/\bK:\s*(.+)/i);
      const mS = block.match(/\bS:\s*(.+)/i);
      if (mQ || mA){
        const q = (mQ?.[1]||'').trim();
        const answer = (mA?.[1]||'').trim();
        const keywords = (mK?.[1]||'').split(/,\s*/).filter(Boolean);
        const synonyms = parseSynonyms(mS?.[1]||'');
        entries.push({ q, answer, keywords, synonyms });
      }
    });
    // Fallback: nothing matched -> single paragraph entry
    if (!entries.length){
      entries.push({ q:'', answer:text.slice(0,400), keywords:[], synonyms:{} });
    }
    return entries;
  }

  function parseSynonyms(line){
    const map = {};
    const parts = String(line||'').split(/,\s*/).filter(Boolean);
    for (const p of parts){
      const [a,b] = p.split(/\s*=\s*/);
      if (a && b){ map[norm(a)] = norm(b); }
    }
    return map;
  }

  function buildKBIndex(){
    try{
      const kb = String(getActiveBot()?.knowledgeBase||'');
      const h = hashStr(kb);
      if (__KB.built && __KB.hash === h) return;
      __KB.hash = h;
      __KB.entries = parseKB(kb);
      __KB.index = new Map();
      // index by tokens from question, answer, keywords, and synonyms
      __KB.entries.forEach((e, i)=>{
        const bag = new Set([...toks(e.q), ...toks(e.answer), ...(e.keywords||[]).map(norm), ...Object.keys(e.synonyms||{})]);
        for (const t of bag){
          if (!__KB.index.has(t)) __KB.index.set(t, new Set());
          __KB.index.get(t).add(i);
        }
      });
      __KB.built = true;
    }catch{ __KB.built = false; }
  }

  // Listen to dashboard preview updates and rebuild KB index
  try{
    window.addEventListener('nova:preview-bot', (e)=>{ try{ window.__previewBot = e.detail||null; buildKBIndex(); }catch{} });
  }catch{}

  function isFAQQuery(q){
    return /\bf(aq|requently\s*asked\s*questions)s?\b/i.test(String(q||''));
  }

  function listFAQTitles(limit=5){
    try{
      buildKBIndex();
      const titles = __KB.entries.map(e=> e.q).filter(Boolean).slice(0, limit);
      if (!titles.length) return '';
      return conciseReply(titles.map(t=> `• ${t}`).join('\n'));
    }catch{ return ''; }
  }

  function answerFromKB(query){
    try{
      buildKBIndex();
      const qText = String(query||'');
      if (isFAQQuery(qText)){
        const list = listFAQTitles(6);
        if (list) return list;
      }
      const qTokens = toks(qText);
      const expanded = new Set(qTokens);
      // expand tokens via any synonym mapping
      for (const e of __KB.entries){
        for (const t of qTokens){
          const repl = e.synonyms?.[t];
          if (repl) expanded.add(repl);
        }
      }
      const scores = new Map();
      const bump = (i, s)=> scores.set(i, (scores.get(i)||0) + s);
      for (const t of expanded){
        const ids = __KB.index.get(t); if (!ids) continue;
        ids.forEach(i=> bump(i, 2)); // base token match
      }
      // keyword exact matches stronger
      __KB.entries.forEach((e,i)=>{
        for (const k of (e.keywords||[])){
          if (expanded.has(norm(k))) bump(i, 3);
        }
      });
      // question heading bonus if substring match
      __KB.entries.forEach((e,i)=>{ if (norm(e.q).includes(norm(qText))) bump(i, 2); });
      let bestId = -1, best = -1;
      scores.forEach((s,i)=>{ if (s>best){ best=s; bestId=i; } });
      if (bestId>=0){
        const a = (__KB.entries[bestId].answer||__KB.entries[bestId].q||'').trim();
        return conciseReply(a);
      }
      return '';
    }catch{ return ''; }
  }

  function getFallbackMessage(){
    try{
      const bot = getActiveBot();
      return String(bot?.fallbackMessage||'').trim();
    }catch{ return ''; }
  }

  // Limit verbose AI replies to ~1–2 sentences and 280 chars
  function conciseReply(text){
    try{
      let t = String(text||'').trim();
      if (!t) return t;
      // If bullets exist, keep first two bullet lines
      const bulletLines = t.split(/\n/).filter(l=> /^\s*[-*•]/.test(l));
      if (bulletLines.length){
        t = bulletLines.slice(0,2).join('\n');
      } else {
        // Take first 2 sentences
        const parts = t.split(/(?<=[.!?])\s+/).slice(0,2);
        t = parts.join(' ');
      }
      if (t.length > 280){ t = t.slice(0,277).replace(/[\s,.!?]+$/,'') + '…'; }
      return t;
    }catch{ return String(text||''); }
  }

  // AI service: call backend Groq proxy
  async function sendToGroq(message){
    try{
      const hinted = (typeof document!=='undefined' && document.querySelector) ? (document.querySelector('meta[name="novabot-api"]')?.getAttribute('content') || '') : '';
      // Default to same-origin ('') so that on Vercel both frontend and backend share a domain.
      const apiBase = (window.NOVABOT_API_BASE || hinted || '').replace(/\/$/, '');
      // Prepend brevity hint for the backend (safe if ignored)
      const prompt = `Please respond in at most 2 short sentences.\n\n${message}`;
      const res = await fetch(apiBase + '/v1/chat/groq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt, botName: getBotName(), style: 'concise' })
      });
      if (!res.ok){
        const t = await res.text().catch(()=>'' );
        console.error('[sendToGroq] proxy error', res.status, t);
        return "⚠️ Sorry, I couldn't connect to the AI right now.";
      }
      const data = await res.json();
      const txt = (data && data.reply) ? conciseReply(data.reply) : '';
      return txt || "⚠️ Sorry, I couldn't connect to the AI right now.";
    }catch(e){
      return "⚠️ Sorry, I couldn't connect to the AI right now.";
    }
  }
  // Back-compat alias requested: askGroq(message)
  // Security: Only call the backend proxy; do not call Groq directly from the browser.
  async function askGroq(message){
    try{
      return await sendToGroq(message);
    }catch(err){
      console.error('[askGroq] proxy error', err);
      return "⚠️ Sorry, I couldn't connect to the AI right now.";
    }
  }
// Shared helpers and demo cart
(function(){
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  // Year
  const y = $('#year'); if (y) y.textContent = new Date().getFullYear();

  // Reveal on scroll
  const io = new IntersectionObserver((entries)=>{
    for(const e of entries){ if(e.isIntersecting){ e.target.classList.add('is-visible'); io.unobserve(e.target);} }
  }, { threshold:.12 });
  $$('[data-reveal]').forEach(el=>io.observe(el));

  // Insurance-only: stop executing all legacy e-commerce logic below (cart, products, product page, checkout)
  const INSURANCE_ONLY = true;
  if (INSURANCE_ONLY) return;

  // Cart (localStorage)
  const CART_KEY = 'demo_cart_v1';
  const readCart = () => { try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch { return {}; } };
  const writeCart = (cart) => localStorage.setItem(CART_KEY, JSON.stringify(cart));
  const getCount = (cart) => Object.values(cart).reduce((s,n)=>s+n,0);
  // Special price overrides (per product)
  const SP_KEY = 'demo_special_prices_v1';
  const readSpecials = () => { try { return JSON.parse(localStorage.getItem(SP_KEY)) || {}; } catch { return {}; } };
  const writeSpecials = (m) => localStorage.setItem(SP_KEY, JSON.stringify(m));
  const setSpecialPrice = (id, price) => { const m = readSpecials(); m[id] = price; writeSpecials(m); };
  const clearSpecialPrice = (id) => { const m = readSpecials(); delete m[id]; writeSpecials(m); };
  const getSpecialPrice = (id) => { const m = readSpecials(); return m[id]; };
  const getSubtotal = (cart) => Object.entries(cart).reduce((sum,[id,qty])=>{
    const p = DEMO_PRODUCTS.find(x=>x.id===id);
    const sp = getSpecialPrice(id);
    const unit = typeof sp === 'number' ? sp : (p ? p.price : 0);
    return sum + unit * qty;
  },0);
  const updateCartBadge = () => { const el = $('#cartCount'); if(!el) return; el.textContent = getCount(readCart()); };
  updateCartBadge();

  const addToCart = (id, qty=1) => { const cart = readCart(); cart[id] = (cart[id]||0)+qty; writeCart(cart); updateCartBadge(); animateAdd(); };
  const setQty = (id, qty) => { const cart = readCart(); if(qty<=0) delete cart[id]; else cart[id]=qty; writeCart(cart); updateCartBadge(); };
  const removeFromCart = (id) => setQty(id,0);
  window.DEMO_CART = { addToCart, setQty, removeFromCart, readCart, getSubtotal };
  // Expose specials API for other modules (chatbot)
  window.DEMO_SPECIALS = {
    get: getSpecialPrice,
    set: setSpecialPrice,
    clear: clearSpecialPrice
  };

  function animateAdd(){
    const badge = $('#cartCount'); if(!badge) return;
    badge.animate([
      { transform:'scale(1)', offset:0 },
      { transform:'scale(1.2)', offset:.3 },
      { transform:'scale(1)', offset:1 }
    ], { duration:300, easing:'cubic-bezier(.2,.8,.2,1)' });
  }

  // Upsell helpers
  function getCurrentCarouselProduct(){
    try {
      const ctx = getCtx() || {};
      const ids = Array.isArray(ctx.lastSuggestionIds) ? ctx.lastSuggestionIds : [];
      const idx = Math.max(0, Math.min(parseInt(ctx.currentIndex||0,10)||0, Math.max(0, ids.length-1)));
      const id = ids[idx];
      return DEMO_PRODUCTS.find(p=>p.id===id) || null;
    } catch { return null; }
  }
  function upsellCandidatesForProduct(p){
    if (!p) return [];
    // Simple rule: suggest same-category items excluding the product, cheapest first
    let list = DEMO_PRODUCTS.filter(x=> x.category===p.category && x.id!==p.id);
    if (!list.length) list = DEMO_PRODUCTS.filter(x=> x.id!==p.id);
    list.sort((a,b)=> a.price - b.price);
    return list.slice(0, Math.min(3, list.length));
  }
  function renderUpsellForProduct(p){
    // Disabled in insurance-only mode
    try { if (typeof INSURANCE_MODE !== 'undefined' && INSURANCE_MODE) return; } catch{}
    const cands = upsellCandidatesForProduct(p);
    if (!cands.length) return;
    const intro = `You might also like these ${p.category} add‑ons:`;
    message('bot', intro); save('bot', intro);
    renderCarousel(cands, { start:0, remember:true });
    setQuickReplies(['More like this','View cart','No thanks']);
  }

  // (moved renderCarousel into chatbot IIFE)

  // Render product cards
  function productCard(p){
    return `
      <article class="card" data-reveal>
        <a href="product.html?id=${p.id}"><img src="${p.img}" alt="${p.name}"></a>
        <div class="body">
          <div class="title">${p.name}</div>
          <div class="meta"><span class="muted">${(p.brand||p.category)}${p.brand? ' · '+p.category:''}</span><span class="price">$${p.price.toFixed(2)}</span></div>
          <div class="actions" style="margin-top:10px">
            <a class="btn btn-ghost" href="product.html?id=${p.id}">Details</a>
            <button class="btn btn-primary" data-add="${p.id}">Add to Cart</button>
          </div>
        </div>
      </article>`;
  }

  // Index: featured grid
  const featuredGrid = $('#featuredGrid');
  if (featuredGrid) {
    const featured = DEMO_PRODUCTS.slice(0,4);
    featuredGrid.innerHTML = featured.map(productCard).join('');
    // Observe newly added reveal elements
    $$('[data-reveal]', featuredGrid).forEach(el=>io.observe(el));
  }

  // Products: grid with filters/sort
  const productsGrid = $('#productsGrid');
  if (productsGrid) {
    const params = new URLSearchParams(location.search);
    const preCat = params.get('category') || '';
    const categoryFilter = $('#categoryFilter');
    const sortSelect = $('#sortSelect');
    if (categoryFilter) categoryFilter.value = preCat;

    const render = () => {
      let list = [...DEMO_PRODUCTS];
      const cat = categoryFilter.value.trim();
      if (cat) list = list.filter(p=>p.category===cat);
      const sort = sortSelect.value;
      if (sort==='price-asc') list.sort((a,b)=>a.price-b.price);
      if (sort==='price-desc') list.sort((a,b)=>b.price-a.price);
      if (sort==='name-asc') list.sort((a,b)=>a.name.localeCompare(b.name));
      productsGrid.innerHTML = list.map(productCard).join('');
      // Observe newly added reveal elements
      $$('[data-reveal]', productsGrid).forEach(el=>io.observe(el));
    };

    categoryFilter?.addEventListener('change', render);
    sortSelect?.addEventListener('change', render);
    render();
  }

  // Product page
  const productRoot = $('#productRoot');
  if (productRoot) {
    const id = new URLSearchParams(location.search).get('id');
    const p = DEMO_PRODUCTS.find(x=>x.id===id) || DEMO_PRODUCTS[0];
    const policy = {
      provider: p.provider || 'Nova Mutual',
      rating: (typeof p.rating==='number' ? p.rating.toFixed(1) : ''),
      coverageLimit: (typeof p.coverageLimit==='number' ? `$${p.coverageLimit.toLocaleString()}` : ''),
      monthlyPremium: (typeof p.monthlyPremium==='number' ? `$${Number(p.monthlyPremium).toFixed(2)}` : `$${p.price.toFixed(2)}`),
      termMonths: p.termMonths || 12,
      deductible: (typeof p.deductible==='number' ? `$${Number(p.deductible).toFixed(0)}` : '$250'),
      benefits: Array.isArray(p.benefits) ? p.benefits : [],
      exclusions: Array.isArray(p.exclusions) ? p.exclusions : [],
      eligibility: Array.isArray(p.eligibility) ? p.eligibility : [],
      claimProcess: p.claimProcess || 'Online form'
    };
    const list = (arr)=> arr && arr.length ? `<ul style="margin:6px 0 0 18px">${arr.map(x=>`<li>${x}</li>`).join('')}</ul>` : '<div class="muted">—</div>';
    productRoot.innerHTML = `
      <div class="product" data-reveal>
        <div>
          <img src="${p.img}" alt="${p.name}">
        </div>
        <div>
          <a class="muted" href="products.html">← Back to Shop</a>
          <h1>${p.name}</h1>
          ${p.brand? `<div class="muted" style="margin:4px 0">Brand: <strong>${p.brand}</strong> · <span>${p.category}</span></div>` : ''}
          <div class="price">$${p.price.toFixed(2)}</div>
          <p class="desc">${p.desc}</p>
          <div class="actions" style="margin-bottom:14px">
            <button class="btn btn-primary" data-add="${p.id}">Add to Cart</button>
            <a class="btn btn-ghost" href="cart.html">Go to Cart</a>
          </div>
          <div class="policy" style="display:grid;gap:12px;padding:12px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.04)">
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
              <div><div class="muted">Provider</div><div><strong>${policy.provider}</strong></div></div>
              <div><div class="muted">Customer rating</div><div><strong>${policy.rating || '4.5'}</strong> ⭐</div></div>
              <div><div class="muted">Coverage limit</div><div><strong>${policy.coverageLimit || '$25,000'}</strong></div></div>
              <div><div class="muted">Monthly premium</div><div><strong>${policy.monthlyPremium}</strong></div></div>
              <div><div class="muted">Term</div><div><strong>${policy.termMonths} months</strong></div></div>
              <div><div class="muted">Deductible</div><div><strong>${policy.deductible}</strong></div></div>
            </div>
            <div>
              <h3 style="margin:6px 0 4px">Included benefits</h3>
              ${list(policy.benefits)}
            </div>
            <div>
              <h3 style="margin:6px 0 4px">Exclusions</h3>
              ${list(policy.exclusions)}
            </div>
            <div>
              <h3 style="margin:6px 0 4px">Eligibility</h3>
              ${list(policy.eligibility)}
            </div>
            <div>
              <h3 style="margin:6px 0 4px">How claims work</h3>
              <div>${policy.claimProcess}</div>
            </div>
          </div>
        </div>
      </div>`;
    // Observe newly added reveal elements
    $$('[data-reveal]', productRoot).forEach(el=>io.observe(el));
  }

  // Cart page
  const cartRoot = $('#cartRoot');
  if (cartRoot) {
    const renderCart = () => {
      const cart = readCart();
      const ids = Object.keys(cart);
      if (!ids.length) {
        cartRoot.innerHTML = '<p class="muted">Your cart is empty.</p>';
        return;
      }
      const items = ids.map(id=>{
        const p = DEMO_PRODUCTS.find(x=>x.id===id); if(!p) return '';
        const qty = cart[id];
        const sp = getSpecialPrice(id);
        const unit = typeof sp==='number' ? sp : p.price;
        const priceHtml = typeof sp==='number' ? `$${unit.toFixed(2)} <span class="muted" style="text-decoration:line-through;opacity:.7">$${p.price.toFixed(2)}</span>` : `$${p.price.toFixed(2)}`;
        return `<div class="cart-item">
          <img src="${p.img}" alt="${p.name}" style="width:88px;height:66px;object-fit:cover">
          <div>
            <div class="title">${p.name}</div>
            <div class="muted">${priceHtml} · ${(p.brand||p.category)}${p.brand? ' · '+p.category:''}</div>
          </div>
          <div class="qty">
            <button class="btn btn-ghost" data-dec="${p.id}">−</button>
            <span>${qty}</span>
            <button class="btn btn-ghost" data-inc="${p.id}">+</button>
          </div>
          <button class="btn btn-ghost" data-remove="${p.id}">Remove</button>
        </div>`;
      }).join('');
      const subtotal = getSubtotal(cart);
      cartRoot.innerHTML = items + `
        <div class="cart-summary">
          <strong>Subtotal</strong>
          <strong>$${subtotal.toFixed(2)}</strong>
        </div>`;
    };

    cartRoot.addEventListener('click', (e)=>{
      const t = e.target.closest('[data-inc],[data-dec],[data-remove]');
      if(!t) return;
      const cart = readCart();
      const id = t.dataset.inc || t.dataset.dec || t.dataset.remove;
      if (t.dataset.inc){ setQty(id, (cart[id]||0)+1); }
      if (t.dataset.dec){ setQty(id, (cart[id]||0)-1); }
      if (t.dataset.remove){ setQty(id,0); }
      renderCart();
    });

    renderCart();
  }

  // Checkout summary
  const checkoutSummary = $('#checkoutSummary');
  if (checkoutSummary) {
    const cart = readCart();
    const ids = Object.keys(cart);
    if (!ids.length) {
      checkoutSummary.innerHTML = '<p class="muted">Your cart is empty.</p>';
    } else {
      const lines = ids.map(id=>{
        const p = DEMO_PRODUCTS.find(x=>x.id===id); if(!p) return '';
        const qty = cart[id];
        const sp = getSpecialPrice(id);
        const unit = typeof sp==='number' ? sp : p.price;
        return `<div style="display:flex;justify-content:space-between"><span>${p.name} × ${qty}</span><span>$${(unit*qty).toFixed(2)}</span></div>`;
      }).join('');
      checkoutSummary.innerHTML = lines + `<hr style="border:0;border-top:1px solid rgba(255,255,255,.12);margin:10px 0" />
        <div style="display:flex;justify-content:space-between"><strong>Total</strong><strong>$${getSubtotal(cart).toFixed(2)}</strong></div>`;
    }
  }

  // Global: add-to-cart buttons
  // Offer state (global, shared with chatbot)
  window.CB_OFFER = window.CB_OFFER || { current: null }; // { id, qty, price }

  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    // Site-wide add buttons (outside chatbot): add directly
    addToCart(btn.dataset.add, 1);
  });

  // Fallback: handle special-offer buttons globally
  document.addEventListener('click', (e)=>{
    const offerBtn = e.target.closest('[data-offer]');
    if (!offerBtn) return;
    if (!window.CB_OFFER || !window.CB_OFFER.current) return;
    const take = offerBtn.getAttribute('data-offer');
    const { id, qty, price } = window.CB_OFFER.current;
    const p = (typeof DEMO_PRODUCTS!=='undefined') ? DEMO_PRODUCTS.find(x=>x.id===id) : null;
    if (take==='accept'){
      try { window.DEMO_SPECIALS && window.DEMO_SPECIALS.set && window.DEMO_SPECIALS.set(id, price); } catch{}
      window.DEMO_CART.addToCart(id, qty||1);
      const msg = `Added ${p? p.name : 'item'} to your cart at special price $${price.toFixed(2)}. 🎉`;
      try { message && message('bot', msg); save && save('bot', msg); } catch{}
    } else {
      try { window.DEMO_SPECIALS && window.DEMO_SPECIALS.clear && window.DEMO_SPECIALS.clear(id); } catch{}
      window.DEMO_CART.addToCart(id, qty||1);
      const msg = `Added ${p? p.name : 'item'} to your cart at regular price.`;
      try { message && message('bot', msg); save && save('bot', msg); } catch{}
    }
    window.CB_OFFER.current = null;
  });
})();

  // Chatbot widget (demo)
  (function(){
  const CHAT_KEY = 'demo_chat_v1';
  const OPEN_KEY = 'nova_open_v1';
  const loadChat = () => { try { return JSON.parse(localStorage.getItem(CHAT_KEY)) || []; } catch { return []; } };
  const saveChat = (msgs) => localStorage.setItem(CHAT_KEY, JSON.stringify(msgs));
  // Append a message to history (used throughout)
  function save(role, text){
    try{
      const msgs = loadChat();
      msgs.push({ role: String(role||'bot'), text: String(text||''), ts: Date.now() });
      saveChat(msgs);
    }catch{}
  }

  // Mark that the intro message has been shown so we don't duplicate it
  function markIntroSeen(){
    try { localStorage.setItem('nova_intro_seen', '1'); } catch {}
  }

  // Enqueue a bot message and resolve when it's likely rendered (after typing delay)
  function enqueueBot(html, opts={}){
    return new Promise((resolve)=>{
      try{
        const plain = String(html||'').replace(/<[^>]+>/g,'');
        const ms = opts.instant ? 0 : Math.min(1500, 300 + Math.max(0, Math.round(plain.length * 18)));
        // message() itself handles typing indicator based on opts
        message('bot', html, opts);
        setTimeout(()=>{ resolve(true); }, ms + 20);
      }catch{
        try{ message('bot', String(html||''), opts||{}); }catch{}
        resolve(false);
      }
    });
  }

  // Create DOM
  const toggle = document.createElement('button');
  toggle.className = 'chatbot-toggle';
  toggle.setAttribute('aria-label','Open chat');
  toggle.innerHTML = '<span>💬</span><span class="dot" aria-hidden="true"></span>';

  const panel = document.createElement('div');
  panel.className = 'chatbot-panel';
  panel.id = 'chatbotPanel';
  panel.innerHTML = `
    <div class="chatbot-header">
      <div class="left">
        <div class="bot-avatar" aria-hidden="true">N</div>
        <div>
          <div class="title">Nova</div>
          <div class="subtitle">Online · Demo assistant</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;position:relative">
        <button class="btn-ghost" id="cbReset" title="Reset conversation" aria-label="Reset conversation">↺</button>
        <button class="chatbot-close" aria-label="Close chat">✕</button>
      </div>
    </div>
    <div class="chatbot-body" id="cbBody" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Chat messages"></div>
    <div class="chatbot-input">
      <input id="cbInput" type="text" placeholder="Speak or type… Try: “show car coverage”" aria-label="Message" />
      <button class="btn-mic" id="cbMic" title="Hold to talk" aria-label="Hold to talk">🎙️</button>
      <button class="btn btn-primary" id="cbSend" aria-label="Send message">➤</button>
    </div>
    <div class="chatbot-qr" id="cbQR" aria-label="Quick replies" style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px"></div>`;

  document.body.appendChild(toggle);
  document.body.appendChild(panel);
  try { toggle.setAttribute('aria-controls','chatbotPanel'); toggle.setAttribute('aria-expanded','false'); } catch{}

  const body = panel.querySelector('#cbBody');
  const input = panel.querySelector('#cbInput');
  const sendBtn = panel.querySelector('#cbSend');
  const micBtn = panel.querySelector('#cbMic');
  const closeBtn = panel.querySelector('.chatbot-close');
  const qr = panel.querySelector('#cbQR');
  const resetBtn = panel.querySelector('#cbReset');
  // settings UI removed

  // Accessibility: quick replies toolbar semantics
  try { qr.setAttribute('role','toolbar'); qr.setAttribute('aria-label','Quick replies'); } catch{}

  // Focus trap for the chatbot panel when open
  const FOCUSABLE_SEL = 'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let __trapHandler = null;
  function setupFocusTrap(){
    if (__trapHandler) return;
    __trapHandler = function(e){
      if (e.key !== 'Tab') return;
      if (!panel.classList.contains('is-open')) return;
      const focusables = Array.from(panel.querySelectorAll(FOCUSABLE_SEL))
        .filter(el=> el.tabIndex !== -1 && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed'));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length-1];
      const active = document.activeElement;
      if (e.shiftKey){
        if (active === first || !panel.contains(active)) { e.preventDefault(); last.focus(); }
      } else {
        if (active === last || !panel.contains(active)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', __trapHandler, true);
  }
  function teardownFocusTrap(){
    if (!__trapHandler) return;
    document.removeEventListener('keydown', __trapHandler, true);
    __trapHandler = null;
  }

  // Helper: apply theme and config to widget
  function applyBotConfig(bot){
    if (!bot) return;
    // Features
    window.BOT_FEATURES = { ...{ promos:true, upsell:true, recommendations:true, voiceInput:false, voiceOutput:false, smallTalk:true }, ...(bot.features||{}) };
    // Back-compat: if legacy 'voice' present and new flags not provided, mirror into both
    try {
      const f = bot.features||{};
      const hasLegacy = Object.prototype.hasOwnProperty.call(f, 'voice');
      const hasIn = Object.prototype.hasOwnProperty.call(f, 'voiceInput');
      const hasOut = Object.prototype.hasOwnProperty.call(f, 'voiceOutput');
      if (hasLegacy && !hasIn && !hasOut){
        window.BOT_FEATURES.voiceInput = !!f.voice;
        window.BOT_FEATURES.voiceOutput = !!f.voice;
      }
    } catch{}
    try { updateMicAvailability(); } catch{}
    // Theme variables scoped to chatbot only to avoid leaking to site
    try {
      const primary = bot.widget?.primary;
      const accent = bot.widget?.accent;
      if (primary) {
        panel.style.setProperty('--accent-2', primary);
        toggle.style.setProperty('--accent-2', primary);
      }
      if (accent) {
        panel.style.setProperty('--accent', accent);
        toggle.style.setProperty('--accent', accent);
      }
    } catch{}
    if (bot.widget?.radius){
      try {
        panel.style.setProperty('--radius', bot.widget.radius + 'px');
        toggle.style.setProperty('--radius', bot.widget.radius + 'px');
      } catch{}
    }
    // Inject/update style tag for header/panel/bubbles
    try {
      const sid = 'cbThemeStyles';
      let style = document.getElementById(sid);
      if (!style){ style = document.createElement('style'); style.id = sid; document.head.appendChild(style); }
      const headerBg = bot.widget?.headerBg || '';
      const headerText = bot.widget?.headerText || '';
      const panelBg = bot.widget?.panelBg || '';
      const bubbleBot = bot.widget?.bubbleBot || '';
      const bubbleUser = bot.widget?.bubbleUser || '';
      // Build base theme CSS
      let css = `/* Applied by NovaBot */
        .chatbot-header{ ${headerBg?`background:${headerBg} !important;`:''} ${headerText?`color:${headerText} !important;`:''} }
        .chatbot-header .subtitle{ ${headerText?`color:${headerText}CC !important;`:''} }
        .chatbot-panel{ ${panelBg?`background:${panelBg} !important;`:''} ${bot.widget?.radius?`border-radius:${bot.widget.radius}px !important;`:''} }
        .chatbot-panel .msg.bot{ ${bubbleBot?`background:${bubbleBot} !important; border-color:${bubbleBot}40 !important; color:#fff;`:''} }
        .chatbot-panel .msg.user{ ${bubbleUser?`background:${bubbleUser} !important; border-color:transparent !important; color:#061225;`:''} ${bot.widget?.radius?`border-radius:${bot.widget.radius}px !important;`:''} }
      `;
      // Override per-message avatar next to bot text using configured avatar
      try {
        const av = bot.widget?.avatar || '';
        if (av) {
          if (/^https?:\/\//.test(av)){
            // Image avatar
            css += `
              .chatbot-panel .msg.bot::before{
                content:'' !important;
                background:transparent !important;
                background-image:url('${av}') !important;
                background-size:cover !important;
                background-position:center !important;
                color:transparent !important;
                border: none !important;
              }
            `;
          } else {
            // Emoji or single-character avatar
            const safe = String(av).replace(/\\/g,'\\\\').replace(/'/g,"\\'").slice(0,2);
            css += `
              .chatbot-panel .msg.bot::before{
                content:'${safe}' !important;
                background:transparent !important;
                color:#061225 !important;
              }
            `;
          }
        } else if (bot.name) {
          const initial = String(bot.name).trim().charAt(0).toUpperCase() || 'N';
          const safeInit = initial.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
          css += `
            .chatbot-panel .msg.bot::before{
              content:'${safeInit}' !important;
            }
          `;
        }
      } catch{}
      style.textContent = css;
    } catch{}
    // Position
    const pos = (bot.widget?.position||'bottom-right');
    toggle.style.left = toggle.style.right = toggle.style.top = toggle.style.bottom = '';
    panel.style.left = panel.style.right = panel.style.top = panel.style.bottom = '';
    if (pos==='bottom-right'){ toggle.style.right='18px'; toggle.style.bottom='18px'; panel.style.right='18px'; panel.style.bottom='74px'; }
    if (pos==='bottom-left'){ toggle.style.left='18px'; toggle.style.bottom='18px'; panel.style.left='18px'; panel.style.bottom='74px'; }
    if (pos==='top-right'){ toggle.style.right='18px'; toggle.style.top='18px'; panel.style.right='18px'; panel.style.top='74px'; }
    if (pos==='top-left'){ toggle.style.left='18px'; toggle.style.top='18px'; panel.style.left='18px'; panel.style.top='74px'; }
    // Header title reflect bot name
    try { const ttl = panel.querySelector('.chatbot-header .title'); if (ttl && bot.name) ttl.textContent = bot.name; } catch{}
    // Avatar (emoji or URL)
    try {
      const av = panel.querySelector('.bot-avatar');
      const val = bot.widget?.avatar || '';
      if (av){
        av.style.background = '';
        av.style.backgroundImage = '';
        av.style.color = '';
        av.textContent = '';
        if (/^https?:\/\//.test(val)){
          av.style.backgroundImage = `url('${val}')`;
          av.style.backgroundSize = 'cover';
          av.style.backgroundPosition = 'center';
          av.setAttribute('aria-label','Bot avatar');
        } else if (val){
          av.textContent = val;
          av.style.background = 'transparent';
        } else {
          av.textContent = (bot.name||'N').charAt(0).toUpperCase();
          av.style.background = 'linear-gradient(135deg,var(--accent-2),var(--accent))';
          av.style.color = '#031225';
        }
      }
    } catch{}
  }

  // Apply active bot configuration (from Dashboard)
  (function applyActiveBot(){
    try{
      const bots = JSON.parse(localStorage.getItem('nova_bots_v1')||'[]');
      const activeId = localStorage.getItem('nova_active_bot_id')||'';
      const bot = bots.find(b=>b.id===activeId) || null;
      if (!bot) { window.BOT_FEATURES = { promos:true, upsell:true, recommendations:true, voiceInput:false, voiceOutput:false, smallTalk:true }; try { updateMicAvailability(); } catch{} return; }
      // If firstMessage changed for this active bot, clear intro + chat so new message can show
      try {
        const k = 'nova_last_first_msg_' + bot.id;
        const prev = localStorage.getItem(k)||'';
        const cur = String(bot.firstMessage||'');
        if (cur && cur !== prev){
          try { localStorage.removeItem('nova_intro_seen'); } catch{}
          try { localStorage.removeItem('demo_chat_v1'); } catch{}
          localStorage.setItem(k, cur);
        }
      } catch{}
      applyBotConfig(bot);
      // Remove preview badge if any (normal mode)
      try { const pb = panel.querySelector('#cbPreviewBadge'); if (pb) pb.remove(); } catch{}
    } catch{
      window.BOT_FEATURES = { promos:true, upsell:true, recommendations:true, voiceInput:false, voiceOutput:false, smallTalk:true };
      try { updateMicAvailability(); } catch{}
    }
  })();

  // Live preview support: listen for dashboard preview event
  window.addEventListener('nova:preview-bot', (ev)=>{
    try{
      const bot = ev.detail || {};
      const isPreview = bot.__preview !== false; // default to true unless explicitly false
      // store/clear for open() to use per-open behavior in preview mode
      try { window.__previewBot = isPreview ? bot : null; } catch{}
      applyBotConfig(bot);
      if (isPreview){
        // Show preview badge
        try {
          let badge = panel.querySelector('#cbPreviewBadge');
          if (!badge){
            const sub = panel.querySelector('.chatbot-header .subtitle') || panel.querySelector('.chatbot-header');
            badge = document.createElement('span');
            badge.id = 'cbPreviewBadge';
            badge.textContent = 'Preview';
            badge.style.cssText = 'margin-left:8px;padding:2px 6px;border:1px solid rgba(255,255,255,.2);border-radius:999px;font-size:11px;opacity:.85;';
            if (sub) sub.appendChild(badge);
          }
        } catch{}
        // For preview, reflect the new firstMessage immediately in the UI without touching saved history
        try {
          const fm = (bot.firstMessage||'').trim();
          if (fm){
            // Clear visible messages only
            while (body && body.firstChild) body.removeChild(body.firstChild);
            try { clearQuickReplies(); } catch{}
            // Render first message (do not call save here)
            message('bot', fm);
          }
        } catch{}
      } else {
        // Ensure preview badge is removed and preview state cleared
        try { const pb = panel.querySelector('#cbPreviewBadge'); if (pb) pb.remove(); } catch{}
        // If SDK/public page applies a bot with a new firstMessage, reset intro so it shows on next open
        try {
          const id = bot && bot.id ? bot.id : 'sdk_active';
          const k = 'nova_last_first_msg_' + id;
          const prev = localStorage.getItem(k)||'';
          const cur = String(bot.firstMessage||'');
          if (cur && cur !== prev){
            try { localStorage.removeItem('nova_intro_seen'); } catch{}
            try { localStorage.removeItem('demo_chat_v1'); } catch{}
            localStorage.setItem(k, cur);
          }
        } catch{}
      }
    } catch{}
  });

  function open(){
  panel.classList.add('is-open');
  try { toggle.setAttribute('aria-expanded','true'); } catch{}
  try { localStorage.setItem(OPEN_KEY, '1'); } catch{}
  try {
    // If preview mode: always show current preview bot's firstMessage on each open
    const fm = (window.__previewBot && window.__previewBot.firstMessage) ? String(window.__previewBot.firstMessage).trim() : '';
    if (window.__previewBot && fm){
      while (body && body.firstChild) body.removeChild(body.firstChild);
      try { clearQuickReplies(); } catch{}
      message('bot', fm);
      return;
    }
    // If SDK provided a bot with firstMessage, show it on first open with empty UI
    const sdm = (window.__sdkBot && window.__sdkBot.firstMessage) ? String(window.__sdkBot.firstMessage).trim() : '';
    if (sdm){
      const hasMsgsNow = !!body.querySelector('.msg');
      if (!hasMsgsNow){
        while (body && body.firstChild) body.removeChild(body.firstChild);
        try { clearQuickReplies(); } catch{}
        if (!window.__novaIntroSent){ window.__novaIntroSent = true; }
        message('bot', sdm, { instant:true });
        return;
      }
    }
    // If there are no user messages yet and a custom firstMessage is available, swap it in regardless of previous bot-only history
    try {
      const raw = loadChat();
      const hasHistory = Array.isArray(raw) && raw.length > 0;
      // Determine desired first message (preview > SDK > active > first saved bot)
      let desired = '';
      if (window.__previewBot && window.__previewBot.firstMessage){ desired = String(window.__previewBot.firstMessage).trim(); }
      if (!desired && window.__sdkBot && window.__sdkBot.firstMessage){ desired = String(window.__sdkBot.firstMessage).trim(); }
      if (!desired){
        const bots = JSON.parse(localStorage.getItem('nova_bots_v1')||'[]');
        let activeId = localStorage.getItem('nova_active_bot_id')||'';
        let bot = bots.find(b=>b.id===activeId) || { name:'Nova' };
        if (!bot && bots.length){ bot = bots[0]; try { localStorage.setItem('nova_active_bot_id', bot.id); } catch{} }
        if (bot && bot.firstMessage) desired = String(bot.firstMessage).trim();
      }
      const hasUser = hasHistory && raw.some(m=> m && m.role === 'user');
      if (desired && !hasUser){
        try { localStorage.removeItem('demo_chat_v1'); } catch{}
        while (body && body.firstChild) body.removeChild(body.firstChild);
        try { clearQuickReplies(); } catch{}
        if (!window.__novaIntroSent){ window.__novaIntroSent = true; }
        message('bot', desired, { instant:true });
        save('bot', desired);
        markIntroSeen();
        input?.focus();
        return;
      }
    } catch{}

    let hasMsgs = !!body.querySelector('.msg');
    if (!hasMsgs) { renderSavedHistory(true); }
    // After history render, if still empty and a pending intro exists, flush it now
    hasMsgs = !!body.querySelector('.msg');
    if (!hasMsgs && window.__novaIntroPending && !window.__novaIntroSent){
      try {
        const intro = String(window.__novaIntroPending);
        window.__novaIntroPending = '';
        window.__novaIntroSent = true;
        try { typing(true); } catch{}
        setTimeout(()=>{
          try { typing(false); } catch{}
          message('bot', intro, { instant:true });
          save('bot', intro);
          markIntroSeen();
        }, 600);
        return;
      } catch{}
    }
    // Final guarantee: if still empty shortly after, force-post intro now (only if not already sent)
    setTimeout(()=>{
      try {
        if (window.__novaIntroSent) return;
        const none = !body.querySelector('.msg');
        if (!none) return;
        // Determine desired first message (preview > SDK > active > default)
        let intro = '';
        try { if (window.__previewBot?.firstMessage) intro = String(window.__previewBot.firstMessage).trim(); } catch{}
        try { if (!intro && window.__sdkBot?.firstMessage) intro = String(window.__sdkBot.firstMessage).trim(); } catch{}
        if (!intro){
          try {
            const bots = JSON.parse(localStorage.getItem('nova_bots_v1')||'[]');
            let activeId = localStorage.getItem('nova_active_bot_id')||'';
            let bot = bots.find(b=>b.id===activeId) || (bots.length?bots[0]:null);
            if (bot && bot.id && !activeId) { try { localStorage.setItem('nova_active_bot_id', bot.id); } catch{} }
            if (bot && bot.firstMessage) intro = String(bot.firstMessage).trim();
          } catch{}
        }
        if (!intro){
          intro = INSURANCE_MODE
            ? `Hi! I'm Nova, your insurance assistant. I can help you build a custom policy. Try selecting a module or ask me a question!`
            : `Hi! I'm Nova, your demo shop assistant. I can recommend products, show promos, or help you check out.`;
        }
        window.__novaIntroSent = true;
        try { typing(true); } catch{}
        setTimeout(()=>{
          try { typing(false); } catch{}
          message('bot', intro, { instant:true });
          save('bot', intro);
          markIntroSeen();
        }, 600);
      } catch{}
    }, 120);
    // E-commerce carousel restoration disabled in insurance-only mode
  } catch{  }
  input?.focus();
  setupFocusTrap();
}
  function close(){ 
    panel.classList.remove('is-open'); 
    try { localStorage.setItem(OPEN_KEY, '0'); } catch{}
    try { toggle.setAttribute('aria-expanded','false'); toggle.focus(); } catch{}
  };
  // Update expanded state and return focus to toggle for accessibility
  const origClose = close;
  close = function(){
    panel.classList.remove('is-open');
    try { localStorage.setItem(OPEN_KEY, '0'); } catch{}
    try { toggle.setAttribute('aria-expanded','false'); toggle.focus(); } catch{}
    teardownFocusTrap();
  };
  toggle.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  // Allow ESC to close when open
  try { document.addEventListener('keydown', (e)=>{ if (e.key==='Escape' && panel.classList.contains('is-open')) close(); }); } catch{}

  // Guard to prevent reset spamming leading to duplicate intros
  let __novaResetBusy = false;
  const RESET_COOLDOWN_MS = 700;

  function resetConversation(){
    if (__novaResetBusy) { return; }
    __novaResetBusy = true;
    try { if (resetBtn) { resetBtn.disabled = true; resetBtn.setAttribute('aria-disabled','true'); } } catch {}
    // Stop any ongoing speech and listening
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
    try {
      if (rec && recognizing) { rec.stop(); }
      recognizing = false;
      micBtn.classList.remove('active');
      micBtn.setAttribute('aria-pressed','false');
    } catch {}
    // Clear storage: chat history, context, intro flag, and learned data
    try { localStorage.removeItem(CHAT_KEY); } catch {}
    try { localStorage.removeItem(CTX_KEY); } catch {}
    try { localStorage.removeItem('nova_learn_v1'); } catch {}
    try { localStorage.removeItem(INTRO_FLAG); } catch {}
    try { if (typeof window.name === 'string') { window.name = (window.name||'').replace(INTRO_FLAG,''); } } catch {}
    // Clear UI
    const typingEl = document.getElementById('cbTyping'); if (typingEl) typingEl.remove();
    body.innerHTML='';
    clearQuickReplies();

    // Allow intro to show once again after a manual reset
    try { window.__novaIntroRendered = false; window.__novaIntroSent = false; } catch{}

    // If the panel is open, immediately render history/intro now
    try { if (panel.classList.contains('is-open')) renderSavedHistory(true); } catch{}

    // Insurance-first routing
    const text = '';
    if (INSURANCE_MODE){
      // Sanitizers for noisy chat inputs (e.g., "to cart", timestamps)
      const stripNoise = (s)=>{
        let x = String(s||'');
        x = x.replace(/\bto\s+cart\b/i, ''); // remove leftover ecom phrasing
        x = x.replace(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/ig, ''); // strip times like 04:12 PM
        // Fix concatenated verbs like 'addHospital' or 'removeAccident'
        x = x.replace(/\b(add|include)(?=[A-Z])/g, '$1 ');
        x = x.replace(/\b(remove|delete|takeout|take\s*out)(?=[A-Z])/g, '$1 ');
        x = x.replace(/\s{2,}/g,' ').trim();
        return x;
      };
      const cleaned = stripNoise(text);
      const cleanedLower = cleaned.toLowerCase();
      // Quick navigation intents (insurance pages)
      const navMatch = cleanedLower.match(/\b(?:go to|open|take me to|show(?: me)?)\s+(home|policy|your policy|checkout|about|contact)\b/);
      if (navMatch){
        const dest = navMatch[1];
        const go = async (url, say)=>{ const msg = say || 'Right away! Opening that for you…'; await enqueueBot(msg); setTimeout(()=>{ location.href = url; }, 500); };
        if (/home/.test(dest)) return go('index.html', 'Taking you home 🏠');
        if (/(policy|your policy)/.test(dest)) return go('cart.html', 'Opening your policy 📄');
        if (/checkout/.test(dest)) return go('checkout.html', 'Let’s finalize your policy 💳');
        if (/about/.test(dest)) return go('about.html', 'About us ℹ️');
        if (/contact/.test(dest)) return go('contact.html', 'Contact options 📬');
      }

      // Core insurance intents
      const wantBuild = /(build (my )?policy|start|browse (coverage|modules)|show (coverage|modules))/i.test(cleanedLower);
      if (wantBuild){
        try {
          const el = document.getElementById('insCategories');
          if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
          else if (window.NovaInsurance?.scrollToCategory) window.NovaInsurance.scrollToCategory('All');
        } catch {}
        setQuickReplies(['Recommendations','View policy','Checkout']);
        return;
      }

      if (/(view (my )?policy|your policy|policy summary)/.test(cleanedLower)){
        message('bot','Opening your policy.'); save('bot','navigate_policy');
        setTimeout(()=> location.href='cart.html', 500);
        return;
      }
      if (/(checkout|finalize|purchase|enroll)/.test(cleanedLower)){
        message('bot','Taking you to checkout.'); save('bot','navigate_checkout');
        setTimeout(()=> location.href='checkout.html', 500);
        return;
      }

      // Generic recommendations intent (no category provided): show in-chat form
      const wantsRecs = /\b(recommendations?|suggestions?)\b/.test(cleanedLower);
      const hasCatWord = /\b(auto|car|home|travel|health|life)\b/.test(cleanedLower);
      if (wantsRecs && !hasCatWord){
        renderRecForm();
        return;
      }

      // Small-talk / acknowledgements: avoid Groq fallback on simple acks
      if (/(\b(thx|thanks|thank\s*u|thank\s*you|ty|appreciate( it)?|perfect|great|awesome|cool|got it|sounds good|okay|ok|okie|nice|cheers)\b|[👍🙏])/i.test(cleaned)){
        const ack = 'You’re welcome! Anything else I can help with?';
        message('bot', ack);
        save('bot', ack);
        setQuickReplies(['Build policy','Recommendations','View policy']);
        return;
      }

      // Recommend by category e.g., "recommend travel"
      const recMatch = cleanedLower.match(/\b(recommend|suggest)(?:\s+some|\s+me)?\s+(auto|car|home|travel|health|life)\b/);
      if (recMatch){
        const catMap = { auto:'Auto', car:'Auto', home:'Home', travel:'Travel', health:'Health', life:'Life' };
        const cat = catMap[recMatch[2]] || 'Travel';
        try {
          window.NovaInsurance?.scrollToCategory?.(cat);
          const evt = new CustomEvent('nova:recommend', { detail: { category: cat } });
          document.dispatchEvent(evt);
        } catch {}
        message('bot', `Here are some ${cat} coverage ideas.`); save('bot','recommendations');
        setQuickReplies(['View policy','Checkout','Build policy']);
        return;
      }

      // Create/build a package with a list of modules
      const pkgMatch = cleanedLower.match(/\b(create|build)\s+(?:my\s+)?(?:policy|package).*?(?:with|including)\s+(.+)$/);
      if (pkgMatch){
        // Split by commas and 'and'
        const raw = cleaned.slice(cleanedLower.indexOf(pkgMatch[2]), cleaned.length);
        const parts = raw.split(/\s*,\s*|\s+and\s+/i).map(s=> s.replace(/\b(module|coverage|cover)\b/ig,'').trim()).filter(Boolean);
        const added = (window.NovaInsurance?.createPackage?.(parts) || []);
        if (added === true){
          message('bot', `Opening the builder to add your selections: <b>${parts.join(', ')}</b>...`);
          setQuickReplies(['View policy','Checkout']);
          return;
        }
        if (Array.isArray(added) && added.length){
          const names = added.map(it=> it.name).join(', ');
          message('bot', `Created a starter package with: <b>${names}</b>.`);
          save('bot','package_created');
          // Upsell: recommend more from the first item's category
          try{
            const first = added[0];
            if (first){
              window.NovaInsurance?.scrollToCategory?.(first.cat);
              const evt = new CustomEvent('nova:recommend', { detail: { category: first.cat } });
              document.dispatchEvent(evt);
            }
          }catch{}
          setQuickReplies(['View policy','Checkout','Add more']);
        } else {
          message('bot','I couldn’t match those modules. Try names from the homepage cards.');
          save('bot','package_failed');
        }
        return;
      }

      // Add multiple modules to package e.g., "add A, B and C to package"
      const addToPkg = cleaned.match(/\b(add|include)\s+(.+?)\s+to\s+(?:package|policy)\b/i);
      if (addToPkg){
        const raw = addToPkg[2];
        const parts = raw.split(/\s*,\s*|\s+and\s+|\s*&\s*|\s*\+\s*/i).map(s=> s.replace(/\b(module|coverage|cover)\b/ig,'').trim()).filter(Boolean);
        const added = (window.NovaInsurance?.createPackage?.(parts) || []);
        if (added === true){
          message('bot', `Opening the builder to add: <b>${parts.join(', ')}</b>...`);
          setQuickReplies(['View policy','Checkout']);
          return;
        }
        if (Array.isArray(added) && added.length){
          const names = added.map(it=> it.name).join(', ');
          message('bot', `Added to your package: <b>${names}</b>.`);
          save('bot','package_add');
          try{
            const first = added[0];
            if (first){
              window.NovaInsurance?.scrollToCategory?.(first.cat);
              const evt = new CustomEvent('nova:recommend', { detail: { category: first.cat } });
              document.dispatchEvent(evt);
            }
          }catch{}
          setQuickReplies(['View policy','Checkout','Add more']);
        } else {
          message('bot','I couldn’t match those modules. Try names from the homepage cards.');
          save('bot','package_add_failed');
        }
        return;
      }

      // Add module by name (e.g., "add roadside assistance")
      const addMod = cleanedLower.match(/\b(add|include)\s+([^,.!\n]+?)(?:\s+(?:module|coverage|cover))?$/);
      if (addMod){
        const name = (addMod[2]||'').trim();
        let it = null; try { it = window.NovaInsurance?.addByName?.(name); } catch {}
        if (it === true){
          message('bot', `Opening the builder to add “${name}”...`);
          setQuickReplies(['View policy','Checkout']);
          return;
        }
        if (it){
          message('bot', `Added “${it.name}” to your policy.`);
          // Upsell: show more from same category
          try{
            window.NovaInsurance?.scrollToCategory?.(it.cat);
            const evt = new CustomEvent('nova:recommend', { detail: { category: it.cat } });
            document.dispatchEvent(evt);
          }catch{}
          save('bot','policy_add_one');
          setQuickReplies(['Recommendations','View policy','Checkout']);
          return;
        }
        save('bot','policy_add');
        setQuickReplies(['View policy','Checkout','Recommendations']);
        return;
      }
      // Remove multiple from package/cart e.g., "remove A and B from package"
      const remMulti = cleaned.match(/\b(remove|delete|take\s*out)\s+(.+?)\s+from\s+(?:package|policy|cart)\b/i);
      if (remMulti){
        const raw = remMulti[2];
        const parts = raw.split(/\s*,\s*|\s+and\s+|\s*&\s*|\s*\+\s*/i).map(s=> s.replace(/\b(module|coverage|cover)\b/ig,'').trim()).filter(Boolean);
        let removed = 0;
        parts.forEach(n=>{ try{ if (window.NovaInsurance?.removeByName?.(n)) removed++; }catch{} });
        if (removed>0){
          message('bot', `Removed ${removed} item${removed>1?'s':''} from your package.`);
          save('bot','package_remove_multi');
          setQuickReplies(['View policy','Checkout','Build policy']);
          return;
        }
        message('bot','I couldn’t match those module names to remove.');
        save('bot','package_remove_failed');
        return;
      }

      // Remove module by name
      const remMod = cleanedLower.match(/\b(remove|delete|take out)\s+([^,.!\n]+?)(?:\s+(?:module|coverage|cover))?$/);
      if (remMod && remMod[2]){
        const name = remMod[2].trim();
        try {
          const ok = window.NovaInsurance?.removeByName?.(name);
          if (ok === true){
            message('bot', `Opening the builder to remove “${name}”...`);
          } else {
            message('bot', `Removed “${name}” from your policy (if present).`);
          }
        } catch {}
        save('bot','policy_remove');
        setQuickReplies(['View policy','Checkout','Recommendations']);
        return;
      }

      // Fallback to AI assistant in insurance persona (guarded)
      (async ()=>{
        try{
          // Do not call Groq for empty input or when generic recs/form applies
          const isEmpty = !cleanedLower.trim();
          const isGenericRecs = /\b(recommendations?|suggestions?)\b/.test(cleanedLower) && !/\b(auto|car|home|travel|health|life)\b/.test(cleanedLower);
          const formVisible = !!panel.querySelector('#recForm') || !!window.__novaRecFormVisible;
          if (isEmpty || isGenericRecs || formVisible){
            if (isGenericRecs && typeof renderRecForm === 'function') renderRecForm();
            return;
          }
          // 1) Try Knowledge Base
          const kbAns = answerFromKB(text);
          if (kbAns){
            message('bot', kbAns);
            save('bot', kbAns);
            setQuickReplies(['Build policy','Recommendations','View policy']);
            return;
          }
          // 2) Groq
          typing(true);
          const ai = await askGroq(text);
          typing(false);
          let out = ai;
          if (!out || /^⚠️/.test(out)){
            const fb = getFallbackMessage();
            if (fb) out = fb;
          }
          message('bot', out);
          save('bot', out);
          setQuickReplies(['Build policy','Recommendations','View policy']);
        }catch{
          typing(false);
          const msg = "⚠️ Sorry, I couldn't connect to the AI right now.";
          message('bot', msg); save('bot', msg);
          setQuickReplies(['Build policy','View policy','Checkout']);
        }
      })();
      return;
    }

  // Route through modules first; if handled, stop here
  try {
    const modRes = ModuleRegistry.run(text, {}); if (modRes.handled) return; } catch{}

  // Small-talk intents (feature-gated)
  try {
    const feats = window.BOT_FEATURES || {};
    if (feats.smallTalk !== false){
      if (/(what'?s your name|who are you)\b/.test(lower)){
        const bots = JSON.parse(localStorage.getItem('nova_bots_v1')||'[]');
        const activeId = localStorage.getItem('nova_active_bot_id')||'';
        const bot = bots.find(b=>b.id===activeId) || { name:'Nova' };
        const msg = `I’m <strong>${bot.name||'Nova'}</strong>, your insurance assistant.`;
        message('bot', msg); save('bot', msg); setQuickReplies(['Build policy','Recommendations','Help']); return;
      }
      if (/(how old are you)\b/.test(lower)){
        const msg = 'I was just launched recently—still fresh and learning every day!';
        message('bot', msg); save('bot', msg); setQuickReplies(['What can you do?','Build policy']); return;
      }
      if (/(what can you do|what do you do|capabilities)\b/.test(lower)){
        const msg = 'I can help you explore coverage, recommend modules, manage your policy, and guide you to checkout. Try the buttons below.';
        message('bot', msg); save('bot', msg); setQuickReplies(['Build policy','View policy','Recommendations']); return;
      }
      if (/(how are you|how’s it going|hows it going)\b/.test(lower)){
        const msg = 'Doing great and ready to help! How can I assist you today?';
        message('bot', msg); save('bot', msg); setQuickReplies(['Recommendations','Build policy','Help']); return;
      }
      if (/(thank you|thanks|ty)\b/.test(lower)){
        const msg = 'You’re welcome!';
        message('bot', msg); save('bot', msg); setQuickReplies(['View policy','Checkout','Help']); return;
      }
    }
  } catch {}

    // Fresh intro after reset: prefer custom firstMessage
    input.value='';
    let intro = '';
    try {
      if (window.__previewBot && window.__previewBot.firstMessage){
        intro = String(window.__previewBot.firstMessage).trim();
      } else {
        const bots = JSON.parse(localStorage.getItem('nova_bots_v1')||'[]');
        const activeId = localStorage.getItem('nova_active_bot_id')||'';
        let bot = bots.find(b=>b.id===activeId) || null;
        if (!bot && bots.length){ bot = bots[0]; try { localStorage.setItem('nova_active_bot_id', bot.id); } catch{} }
        if (bot && bot.firstMessage) intro = String(bot.firstMessage).trim();
      }
    } catch{}
    if (!intro){
      intro = "Hi! I'm Nova, your demo insurance assistant. Try: 'show car coverage', 'recommend travel modules', or tap Build policy.";
    }
    // Avoid duplicating the intro if it is already the last visible message due to rapid clicks
    try {
      const msgs = Array.from(body.querySelectorAll('.msg'));
      const last = msgs.length ? msgs[msgs.length-1] : null;
      const alreadyHasIntro = last && last.innerHTML && last.innerHTML.indexOf(intro.slice(0, 20)) !== -1;
      if (!alreadyHasIntro) { message('bot', intro); save('bot', intro); markIntroSeen(); }
    } catch { message('bot', intro); save('bot', intro); markIntroSeen(); }

    // Cooldown to prevent spamming
    setTimeout(()=>{
      __novaResetBusy = false;
      try { if (resetBtn) { resetBtn.disabled = false; resetBtn.removeAttribute('aria-disabled'); } } catch {}
    }, RESET_COOLDOWN_MS);
  }

  // (removed duplicate respond here — unified into main respond below)

  resetBtn && resetBtn.addEventListener('click', resetConversation);

  // Settings: preferences (emojis, tone, TTS)
  const SETTINGS_KEY = 'nova_settings_v1';
  const getSettings = ()=>{ try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; } };
  const setSettings = (s)=> localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  const getDefaultSettings = ()=>({ useEmojis:true, humanTone:true, speakBack:true });

  // Force insurance-first mode (disables e-commerce flows)
  const INSURANCE_MODE = true;
  try {
    // disable ecom-specific modules if present
    window.BOT_FEATURES = { ...window.BOT_FEATURES, promos:false, upsell:false };
  } catch {}

  // settings UI removed

  // settings UI removed

  // If an IDE/browser preview overlay exists in bottom-right, nudge left
  try {
    if (document.getElementById('windsurf-browser-preview-root')){
      toggle.style.right = '88px';
      panel.style.right = '88px';
    }
  } catch(_){}

  // Restore open state across page navigations (defer to avoid double-intro)
  try {
    if (localStorage.getItem(OPEN_KEY) === '1') {
      setTimeout(()=>{ open(); }, 50);
    }
  } catch{}

  // Render helpers
  function scrollBottom(){ body.scrollTop = body.scrollHeight; }
  // TTS voice selection (prefer female English voices)
  let preferredVoice = null;
  const VOICE_KEY = 'nova_voice_name_v1';
  const femaleVoiceHints = [
    'google uk english female', 'google us english', 'google english',
    'microsoft aria', 'microsoft jessa', 'microsoft zira',
    'samantha', 'jenny', 'zoe', 'sara', 'natalie', 'olivia', 'emma', 'ava', 'female'
  ];
  function pickFemaleVoice(){
    try{
      const voices = window.speechSynthesis?.getVoices?.() || [];
      if (!voices.length) return null;
      // Use saved voice if available
      const saved = localStorage.getItem(VOICE_KEY);
      if (saved){
        const match = voices.find(v=> (v.name||'') === saved);
        if (match) return match;
      }
      // Try exact/preferred names first
      const nameLower = (n)=> (n||'').toLowerCase();
      for (const hint of femaleVoiceHints){
        const exact = voices.find(v=> nameLower(v.name).includes(hint));
        if (exact) return exact;
      }
      // Fallback: best English voice
      return voices.find(v=> nameLower(v.lang).startsWith('en')) || voices[0] || null;
    }catch{ return null; }
  }
  function initVoices(){
    if (!('speechSynthesis' in window)) return;
    // voices may load async, set handler first (no UI)
    window.speechSynthesis.onvoiceschanged = ()=>{ preferredVoice = pickFemaleVoice(); };
    // trigger population
    try { window.speechSynthesis.getVoices(); } catch{}
    preferredVoice = pickFemaleVoice();
  }
  initVoices();

  function speak(text){
    try{
      if (!('speechSynthesis' in window)) return;
      const utter = new SpeechSynthesisUtterance(String(text).slice(0,260));
      utter.rate = 0.95; utter.pitch = 1.2; utter.volume = 1;
      if (!preferredVoice) preferredVoice = pickFemaleVoice();
      if (preferredVoice) utter.voice = preferredVoice;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    }catch{ /* noop */ }
  }

  function fmtTime(d){ try{ return new Date(d||Date.now()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});}catch{ return ''; } }
  function message(role, html, opts={}){
    const renderNow = ()=>{
      const el = document.createElement('div');
      el.className = 'msg ' + (role==='bot'?'bot':'user');
      const time = `<span class="muted" style="font-size:10px;opacity:.7;margin-${role==='bot'?'left':'right'}:6px">${fmtTime()}</span>`;
      // Apply settings: emoji stripping and tone normalization for bot messages
      let outHtml = html;
      try{
        const s = { ...getDefaultSettings(), ...getSettings() };
        if (role==='bot'){
          if (!s.humanTone){
            outHtml = outHtml
              .replace(/Hey there!/gi,'Hello.')
              .replace(/Got it ?[—-]?/gi,'')
              .replace(/No worries[.!]?/gi,'')
              .replace(/I got you[.!]?/gi,'');
          }
          if (!s.useEmojis){ outHtml = outHtml.replace(/[\p{Emoji_Presentation}\p{Emoji}\u200d]+/gu,''); }
        }
      } catch {}
      el.innerHTML = (outHtml || html) + ' ' + time;
      body.appendChild(el);
      scrollBottom();
      if (role==='bot') {
        const s = { ...getDefaultSettings(), ...getSettings() };
        const feats = window.BOT_FEATURES || {};
        const allowSpeak = !!s.speakBack && !opts.silent && !!feats.voiceOutput;
        // speak plain text without timestamps or muted metadata
        let spoken = '';
        try {
          const tmp = document.createElement('div');
          tmp.innerHTML = html; // original, without appended time
          tmp.querySelectorAll('.muted').forEach(n=> n.remove());
          spoken = (tmp.textContent || '').trim();
        } catch { spoken = (el.textContent || '').trim(); }
        if (allowSpeak) speak(spoken);
      }
    };

    // Typing indicator for bot messages (skip for silent or instant)
    if (role==='bot' && !opts.silent && !opts.instant){
      try {
        typing(true);
        const plain = html.replace(/<[^>]+>/g,'');
        const ms = Math.min(1500, 300 + Math.max(0, Math.round(plain.length * 18)));
        setTimeout(()=>{ typing(false); renderNow(); }, ms);
      } catch { renderNow(); }
    } else {
      renderNow();
    }
  }
  function typing(on){
    if (on){
      const t = document.createElement('div');
      t.className = 'msg bot'; t.id = 'cbTyping';
      t.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
      body.appendChild(t); scrollBottom();
    } else {
      const t = document.getElementById('cbTyping');
      t && t.remove();
    }
  }

  // Horizontal carousel with images (chatbot scope) — single card view with arrows
  function renderCarousel(list, opts={ start:0, remember:true }){
    const { start=0, remember=true } = opts;
    const idx = Math.max(0, Math.min(start, Math.max(0, list.length-1)));
    const p = list[idx]; if (!p) return;
    // Remove any previous carousel blocks to avoid stacking
    try { Array.from(body.querySelectorAll('.p-carousel')).forEach(n=>n.remove()); } catch {}
    const wrap = document.createElement('div');
    wrap.className = 'p-carousel';
    wrap.setAttribute('role','region');
    wrap.setAttribute('aria-label','Product suggestions');
    wrap.style = 'padding:6px 2px 2px;';
    // Card
    const card = document.createElement('div');
    card.style = 'width:100%; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.08); border-radius:12px; overflow:hidden; display:flex; flex-direction:column';
    card.innerHTML = `
      <a href="product.html?id=${p.id}" style="display:block"><img src="${p.img}" alt="${p.name}" style="width:100%; height:132px; object-fit:cover"></a>
      <div style="padding:10px; display:grid; gap:6px">
        <strong style="font-size:1rem; line-height:1.2">${p.name}</strong>
        <span class="muted">$${p.price.toFixed(2)} · ${(p.brand||p.category)}${p.brand? ' · '+p.category:''}</span>
        <div style="display:flex; gap:6px; margin-top:2px">
          <a class="btn btn-ghost" href="product.html?id=${p.id}">View</a>
          <button class="btn btn-primary" data-add="${p.id}">Add</button>
        </div>
      </div>`;
    wrap.appendChild(card);
    // Nav
    if (list.length > 1){
      const nav = document.createElement('div');
      nav.style = 'display:flex;justify-content:space-between;align-items:center;margin-top:6px';
      const prevIdx = Math.max(0, idx-1);
      const nextIdx = Math.min(list.length-1, idx+1);
      nav.innerHTML = `
        <button class="btn" data-action="prev-suggestions" data-next="${prevIdx}" ${idx===0?'disabled':''} aria-label="Previous">◀</button>
        <span class="muted" style="font-size:12px">${idx+1} / ${list.length}</span>
        <button class="btn" data-action="next-suggestions" data-next="${nextIdx}" ${idx>=list.length-1?'disabled':''} aria-label="Next">▶</button>`;
      wrap.appendChild(nav);
    }
    body.appendChild(wrap); scrollBottom();
    if (remember){
      const ctx = { ...getCtx(), lastSuggestionIds: list.map(x=>x.id), nextIndex: Math.min(idx+1, list.length-1), currentIndex: idx };
      setCtx(ctx);
      try {
        // Cache full objects as well so navigation works for dashboard products
        const byId = {};
        list.forEach(x=>{ if (x && x.id) byId[x.id] = x; });
        window.__novaLastSuggestions = { list: list.slice(), byId };
      } catch{}
    }
  }

  function renderSuggestions(list, opts={ start:0, remember:true }){
    const { start=0, remember=true } = opts;
    const slice = list.slice(start, start+3);
    const wrap = document.createElement('div');
    wrap.className = 'p-suggest';
    slice.forEach(p=>{
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `
        <div class="meta"><strong>${p.name}</strong><span class="muted">$${p.price.toFixed(2)} · ${(p.brand||p.category)}${p.brand? ' · '+p.category:''}</span></div>
        <div style="display:flex;gap:6px">
          <a class="btn btn-ghost" href="product.html?id=${p.id}">View</a>
          <button class="btn btn-primary" data-add="${p.id}">Add</button>
        </div>`;
      wrap.appendChild(row);
    });
    if (start+3 < list.length){
      const nextBar = document.createElement('div');
      nextBar.style = 'display:flex;justify-content:center;margin-top:6px';
      nextBar.innerHTML = `<button class="btn" data-action="next-suggestions" data-next="${start+3}">Next ▶</button>`;
      wrap.appendChild(nextBar);
    }
    body.appendChild(wrap); scrollBottom();
    if (remember){
      const ctx = { ...getCtx(), lastSuggestionIds: list.map(p=>p.id), nextIndex: Math.min(start+3, list.length) };
      setCtx(ctx);
    }
  }

  function setQuickReplies(list){
    if (!qr) return;
    qr.innerHTML = '';
    list.forEach((lbl, i)=>{
      const b = document.createElement('button');
      b.className = 'btn btn-ghost' + (i===0 ? ' primary' : ''); b.setAttribute('data-qr', lbl);
      b.textContent = lbl;
      // Roving tabindex for keyboard navigation
      b.setAttribute('tabindex', i===0 ? '0' : '-1');
      b.setAttribute('role','button');
      qr.appendChild(b);
    });
    // After render, ensure first chip is focused only if focus is already within toolbar
    try {
      if (panel.classList.contains('is-open') && qr.contains(document.activeElement)){
        const first = qr.querySelector('[data-qr]'); if (first) first.focus();
      }
    } catch{}
  }
  function clearQuickReplies(){ if(qr) qr.innerHTML=''; }

  // Render a lightweight in-chat recommendations form (category + situation)
  function renderRecForm(){
    // Global, re-entrant guard to avoid duplicate renders in the same tick
    try {
      if (!window.__novaRecFormVisible) window.__novaRecFormVisible = false;
      if (!window.__novaRecFormRendering) window.__novaRecFormRendering = false;
    } catch {}
    // If a recommendations form is already present in DOM, or a render is in-flight, focus it and skip re-render
    try {
      const existing = panel.querySelector('#recForm');
      if (existing || window.__novaRecFormVisible || window.__novaRecFormRendering) {
        try { (existing || panel.querySelector('#recForm'))?.querySelector('select[name="category"]').focus(); } catch{}
        return;
      }
    } catch{}
    try { window.__novaRecFormRendering = true; } catch{}
    const html = `
      <div class="cb-card" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px" role="group" aria-label="Recommendations form">
        <form id="recForm" aria-label="Recommendations">
          <fieldset style="border:none;margin:0;padding:0">
            <legend style="font-weight:600;margin-bottom:8px">Tell me a bit so I can tailor suggestions</legend>
            <label style="display:block;margin-bottom:6px">What do you want to cover?
              <select name="category" aria-label="Coverage category" required style="width:100%;margin-top:4px">
                <option value="">Select a category…</option>
                <option>Auto</option>
                <option>Home</option>
                <option>Travel</option>
                <option>Health</option>
                <option>Life</option>
              </select>
            </label>
            <label style="display:block;margin:8px 0 6px">Your situation
              <select name="situation" aria-label="Your situation" style="width:100%;margin-top:4px">
                <option value="">Prefer not to say</option>
                <option>Homeowner</option>
                <option>Renter</option>
                <option>Young adult</option>
                <option>Family</option>
                <option>Retired</option>
              </select>
            </label>
            <label style="display:block;margin:8px 0 6px">Priority
              <select name="priority" aria-label="Priority" style="width:100%;margin-top:4px">
                <option value="Balanced">Balanced</option>
                <option value="Budget">Budget</option>
                <option value="Coverage">Coverage</option>
              </select>
            </label>
          </fieldset>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn btn-primary" type="submit">Show recommendations</button>
            <button class="btn" type="button" id="recCancel">Cancel</button>
          </div>
        </form>
      </div>`;
    message('bot', html); save('bot', 'recommend_form');
    // Move focus to the first control after render
    try {
      setTimeout(()=>{
        try { window.__novaRecFormRendering = false; window.__novaRecFormVisible = true; } catch{}
        const sel = panel.querySelector('#recForm select[name="category"]'); sel && sel.focus();
      }, 30);
    } catch{}
    clearQuickReplies();
  }

  // Quick replies -> insurance actions
  try {
    qr.addEventListener('click', (e)=>{
      const btn = e.target && e.target.closest('[data-qr]');
      if (!btn) return;
      // Make clicked chip the active one in roving tabindex
      try { Array.from(qr.querySelectorAll('[data-qr]')).forEach(el=> el.setAttribute('tabindex','-1')); btn.setAttribute('tabindex','0'); btn.focus(); } catch{}
      const label = String(btn.getAttribute('data-qr')||'').toLowerCase();
      // Normalize
      const isBuild = /build policy|build|start/i.test(label);
      const isView = /view policy|policy/i.test(label) && !/build/.test(label);
      const isCheckout = /checkout|place order|buy/i.test(label);
      const isRecs = /recommend|recommendations|suggest/i.test(label);
      if (isBuild){
        const el = document.getElementById('insCategories');
        if (el) { el.scrollIntoView({ behavior:'smooth', block:'start' }); }
        else if (window.NovaInsurance && window.NovaInsurance.scrollToCategory){ try{ window.NovaInsurance.scrollToCategory('All'); }catch{} }
        return;
      }
      if (isView){ message('bot','Opening your policy.'); save('bot','navigate_policy'); setTimeout(()=>{ window.location.href = 'cart.html'; }, 500); return; }
      if (isCheckout){ message('bot','Taking you to checkout.'); save('bot','navigate_checkout'); setTimeout(()=>{ window.location.href = 'checkout.html'; }, 500); return; }
      if (isRecs){
        // Open form to capture preferences
        renderRecForm();
        return;
      }
      // Direct category quick replies (e.g., 'Auto', 'Home', etc.)
      const catMap = { auto:'Auto', home:'Home', travel:'Travel', health:'Health', life:'Life', car:'Auto' };
      const lower = label.trim();
      if (catMap[lower]){
        const cat = catMap[lower];
        try {
          window.NovaInsurance?.scrollToCategory?.(cat);
          const evt = new CustomEvent('nova:recommend', { detail: { category: cat } });
          document.dispatchEvent(evt);
        } catch{}
        setQuickReplies(['View policy','Checkout','Build policy']);
        return;
      }
    });
    // Handle recommendations form submit and cancel
    body.addEventListener('submit', (e)=>{
      const form = e.target && e.target.closest('#recForm');
      if (!form) return;
      e.preventDefault();
      const fd = new FormData(form);
      const category = String((fd.get('category')||'').toString()||'').trim();
      const situation = String((fd.get('situation')||'').toString()||'').trim();
      const priority = String((fd.get('priority')||'').toString()||'').trim();
      if (!category){
        try { const sel = form.querySelector('select[name="category"]'); sel && sel.focus(); } catch{}
        return;
      }
      // Persist lightweight profile
      try { localStorage.setItem('nova_rec_profile_v1', JSON.stringify({ category, situation, priority, ts: Date.now() })); } catch{}
      // Tailored confirmation and category navigation
      // 1) Explicit success acknowledgment per spec — show INSIDE the form card
      const ack = 'Form filled in';
      try {
        const card = form.closest('.cb-card');
        if (card) {
          card.innerHTML = `<div style="padding:10px 6px;font-weight:600">${ack}</div>`;
        } else {
          // Fallback to normal bubble if card missing
          message('bot', ack);
        }
      } catch { message('bot', ack); }
      try { save('bot', 'recommend_form_filled'); } catch{}
      try {
        window.NovaInsurance?.scrollToCategory?.(category);
        const evt = new CustomEvent('nova:recommend', { detail: { category } });
        document.dispatchEvent(evt);
      } catch{}
      try {
        const products = (typeof getBotProducts === 'function') ? getBotProducts() : (Array.isArray(DEMO_PRODUCTS)? DEMO_PRODUCTS : []);
        const map = { auto:'gadgets', car:'gadgets', travel:'gadgets', health:'home', life:'home', home:'home' };
        const key = String(category||'').toLowerCase();
        const targetCat = map[key] || '';
        let list = Array.isArray(products) ? products : [];
        if (targetCat) {
          list = list.filter(p => String(p.category||'').toLowerCase().includes(targetCat));
        }
        if (!list.length && Array.isArray(DEMO_PRODUCTS)) {
          // Fallback to a generic small sample if mapping yields nothing
          list = DEMO_PRODUCTS.slice(0, 6);
        }
        // Limit to a small set for carousel
        list = list.slice(0, 6);
        if (typeof renderCarousel === 'function' && list.length) {
          renderCarousel(list, { start: 0, remember: true });
        }
      } catch{}
      setQuickReplies(['Next ▶','View policy','Checkout']);
      // Remove form card and clear visibility flag after a short delay so the user sees the ack
      try { window.__novaRecFormVisible = false; } catch{}
      try {
        const card = form.closest('.cb-card');
        if (card) {
          setTimeout(()=>{ try { card.remove(); } catch{} }, 700);
        }
      } catch{}
    });
    body.addEventListener('click', (e)=>{
      const btn = e.target && e.target.closest('#recCancel');
      if (!btn) return;
      // Close the form and show category quick replies again
      const card = btn.closest('.cb-card'); if (card) card.remove();
      try { window.__novaRecFormVisible = false; } catch{}
      setQuickReplies(['Auto','Home','Travel','Health','Life']);
      input && input.focus();
    });
    // Keyboard navigation for quick replies: Left/Right/Home/End + Enter/Space to activate
    let __qrKbSetup = false;
    if (!__qrKbSetup){
      qr.addEventListener('keydown', (e)=>{
        const chips = Array.from(qr.querySelectorAll('[data-qr]'));
        if (!chips.length) return;
        const current = document.activeElement && chips.includes(document.activeElement) ? document.activeElement : null;
        const idx = current ? chips.indexOf(current) : -1;
        const move = (to)=>{
          chips.forEach(el=> el.setAttribute('tabindex','-1'));
          to.setAttribute('tabindex','0');
          to.focus();
        };
        switch(e.key){
          case 'ArrowRight':
          case 'Right':
            if (idx>-1){ e.preventDefault(); move(chips[(idx+1)%chips.length]); }
            break;
          case 'ArrowLeft':
          case 'Left':
            if (idx>-1){ e.preventDefault(); move(chips[(idx-1+chips.length)%chips.length]); }
            break;
          case 'Home':
            e.preventDefault(); move(chips[0]);
            break;
          case 'End':
            e.preventDefault(); move(chips[chips.length-1]);
            break;
          case 'Enter':
          case ' ':
            if (current){ e.preventDefault(); current.click(); }
            break;
        }
      });
      __qrKbSetup = true;
    }
  } catch {}

  // Catalog helpers for inventory-aware answers (offline, from DEMO_PRODUCTS)
  const unique = (arr)=> Array.from(new Set(arr));
  const listCategories = ()=> unique(DEMO_PRODUCTS.map(p=>p.category)).sort();
  const listBrands = ()=> unique(DEMO_PRODUCTS.map(p=>p.brand).filter(Boolean)).sort();
  function priceRange(){
    const prices = DEMO_PRODUCTS.map(p=>p.price).filter(x=>typeof x==='number');
    const min = Math.min(...prices), max = Math.max(...prices);
    return { min, max };
  };
  const sampleProducts = (n=3)=> DEMO_PRODUCTS.slice(0, n).map(p=>`${p.brand? p.brand+' ' : ''}${p.name}`).join(', ');
  const catalogSummary = ()=>{
    const cats = listCategories();
    const brands = listBrands();
    const {min,max} = priceRange();
    const sample = sampleProducts(3);
    return `We currently carry ${DEMO_PRODUCTS.length} products across ${cats.length} categories (${cats.join(', ')}). Top brands include ${brands.slice(0,6).join(', ')}. Prices range from $${min.toFixed(2)} to $${max.toFixed(2)}. For example: ${sample}.`;
  };

  // Get products from active bot configuration (dashboard) or fall back to demo catalog
  function getBotProducts(){
    try{
      const bot = getActiveBot() || {};
      const arr = Array.isArray(bot.products) ? bot.products : [];
      if (arr.length){
        // Normalize to a minimal structure used by chat renderer
        return arr.map((x, i)=>({
          id: String(x.id||`bot_${i}`),
          name: String(x.title||x.name||`Item ${i+1}`),
          desc: String(x.description||x.desc||''),
          img: String(x.image||x.img||''),
          price: Number(x.price||0),
          category: String(x.category||'')
        }));
      }
    }catch{}
    // Fallback: map DEMO_PRODUCTS to same shape
    try{
      return DEMO_PRODUCTS.map(p=>({ id:p.id, name:p.name, desc:p.desc||'', img:p.img, price:p.price, category:p.category||'', brand:p.brand||'' }));
    }catch{ return []; }
  }

  // Render a simple horizontal carousel of products inside chat
  function renderProductsInChat(list, heading='Here are some products'){
    const items = (list||[]).slice(0, 12).map(p=>{
      const img = p.img || 'assets/img/placeholder.png';
      const price = (typeof p.price==='number' && !isNaN(p.price)) ? `$${p.price.toFixed(2)}` : '';
      return `
        <div role="listitem" style="min-width:190px;max-width:190px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px">
          <div style="height:120px;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:8px;background:rgba(0,0,0,.25)">
            <img src="${img}" alt="${p.name}" style="max-width:100%;max-height:100%" loading="lazy">
          </div>
          <div style="font-weight:600;line-height:1.2">${p.name}</div>
          ${price? `<div style="opacity:.9">${price}</div>`:''}
        </div>`;
    }).join('');
    const rowId = `row_${Math.random().toString(36).slice(2,8)}`;
    const html = `
      <div role="region" aria-label="Products" style="display:flex;flex-direction:column;gap:8px">
        <div style="font-weight:600">${heading}</div>
        <div id="${rowId}" role="list" style="display:flex;gap:12px;overflow-x:auto;padding-bottom:6px">${items}</div>
      </div>`;
    message('bot', html);
    save('bot', html);
  }

  function findProductByQuery(s){
    const q = s.toLowerCase().trim();
    // id exact
    const byId = DEMO_PRODUCTS.find(p=> p.id.toLowerCase()===q);
    if (byId) return byId;
    // best contains score by name
    const words = q.split(/\s+/).filter(Boolean);
    let best = null; let score = -1;
    for (const p of DEMO_PRODUCTS){
      const name = p.name.toLowerCase();
      let sc = 0; words.forEach(w=>{ if (name.includes(w)) sc++; });
      if (sc>score){ score=sc; best=p; }
    }
    return best && score>0 ? best : null;
  }

  async function respond(q){
    const text = q.trim(); if (!text) return;
    let lower = text.toLowerCase();
    // Normalize smart quotes and punctuation to improve intent matching
    try {
      lower = lower
        .replace(/[’‘]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/\u00A0/g, ' ') // non-breaking space
        .replace(/\s+/g, ' ')    // collapse spaces
        .trim();
    } catch {}
    clearQuickReplies();

    // Insurance-only mode: handle intents here and return before commerce logic
    if (INSURANCE_MODE){
      const stripNoise = (s)=>{
        let x = String(s||'');
        x = x.replace(/\bto\s+cart\b/i, '');
        x = x.replace(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/ig, '');
        x = x.replace(/\b(add|include)(?=[A-Z])/g, '$1 ');
        x = x.replace(/\b(remove|delete|takeout|take\s*out)(?=[A-Z])/g, '$1 ');
        x = x.replace(/\s{2,}/g,' ').trim();
        return x;
      };
      const cleaned = stripNoise(text);
      const t = cleaned.toLowerCase();

      // Navigation (support a few typos and common phrases like "contact us" or "product page")
      const navMatch = t.match(/\b(?:go to|open|take me to|show(?: me)?)\s+(home|policy|your policy|checkout|about|conta?ct(?:\s+us)?|products?|product\s+page)\b/);
      if (navMatch){
        const dest = navMatch[1];
        const go = (url, say)=>{ const msg = say || 'Right away! Opening that for you…'; message('bot', msg); save('bot', msg); setTimeout(()=>{ location.href = url; }, 500); };
        if (/home/.test(dest)) return go('index.html', 'Taking you home 🏠');
        if (/(policy|your policy)/.test(dest)) return go('cart.html', 'Opening your policy 📄');
        if (/checkout/.test(dest)) return go('checkout.html', 'Let’s finalize your policy 💳');
        if (/about/.test(dest)) return go('about.html', 'About us ℹ️');
        if (/conta?ct/.test(dest)) return go('contact.html', 'Contact options 📬');
        // In insurance mode, "products" maps to the policy builder section
        if (/^products?$/.test(dest) || /product\s+page/.test(dest)){
          try {
            const el = document.getElementById('insCategories');
            if (el){ el.scrollIntoView({ behavior:'smooth', block:'start' }); }
          } catch {}
          message('bot', 'Scrolling to the builder for you.');
          save('bot', 'navigate_builder');
          return;
        }
      }

      // Build/browse
      if (/(build (my )?policy|start|browse (coverage|modules)|show (coverage|modules)|products?|product\s+page)/i.test(t)){
        try {
          const el = document.getElementById('insCategories');
          if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
          else if (window.NovaInsurance?.scrollToCategory) window.NovaInsurance.scrollToCategory('All');
        } catch {}
        // If the user used generic 'product' or 'products', also show an in-chat carousel
        if (/\bproducts?\b/.test(t)){
          try{
            const products = (typeof getBotProducts === 'function') ? getBotProducts() : (Array.isArray(DEMO_PRODUCTS)? DEMO_PRODUCTS : []);
            let list = Array.isArray(products) ? products.slice(0, 6) : [];
            if (!list.length && Array.isArray(DEMO_PRODUCTS)) list = DEMO_PRODUCTS.slice(0, 6);
            if (list.length && typeof renderCarousel === 'function'){
              const intro = 'Here are some policy options:';
              message('bot', intro); save('bot', intro);
              renderCarousel(list, { start: 0, remember: true });
              setQuickReplies(['Next ▶','View policy','Checkout']);
            }
          } catch{}
        } else {
          setQuickReplies(['Recommendations','View policy','Checkout']);
        }
        return;
      }

      if (/(view (my )?policy|your policy|policy summary)/.test(t)){
        await enqueueBot('Opening your policy.'); save('bot','navigate_policy');
        setTimeout(()=> location.href='cart.html', 500);
        return;
      }
      if (/(checkout|finalize|purchase|enroll)/.test(t)){
        await enqueueBot('Taking you to checkout.'); save('bot','navigate_checkout');
        setTimeout(()=> location.href='checkout.html', 500);
        return;
      }

      // Recommendations
      // If user asks for recommendations without a specific category, show the in-chat form
      const wantsRecs = /\b(recommendations?|suggestions?)\b/.test(t);
      const hasRecCat = /\b(auto|car|home|travel|health|life)\b/.test(t);
      if (wantsRecs && !hasRecCat){
        try { console.debug('[Nova] Intercepted generic "recommendations" in insurance mode → showing form'); } catch{}
        if (typeof renderRecForm === 'function'){
          renderRecForm();
        } else {
          // Safe fallback if form helper is unavailable
          const msg = 'I can tailor suggestions. Which coverage are you interested in? You can tell me your situation and priority too.';
          message('bot', msg); save('bot', 'recommendations_clarify');
          setQuickReplies(['Auto','Home','Travel','Health','Life']);
        }
        return;
      }
      // If the user mentions "policies" or "policy", show a product carousel directly
      if (/\bpolic(?:y|ies)\b/.test(t)){
        try{
          const products = (typeof getBotProducts === 'function') ? getBotProducts() : (Array.isArray(DEMO_PRODUCTS)? DEMO_PRODUCTS : []);
          let list = Array.isArray(products) ? products.slice(0, 6) : [];
          if (!list.length && Array.isArray(DEMO_PRODUCTS)) list = DEMO_PRODUCTS.slice(0, 6);
          const intro = 'Here are some policy options you can explore:';
          message('bot', intro); save('bot', intro);
          if (typeof renderCarousel === 'function' && list.length){ renderCarousel(list, { start:0, remember:true }); }
          setQuickReplies(['Next ▶','View policy','Checkout']);
        }catch{}
        return;
      }
      const recMatch = t.match(/\b(recommend|suggest)(?:\s+some|\s+me)?\s+(auto|car|home|travel|health|life)\b/);
      if (recMatch){
        const catMap = { auto:'Auto', car:'Auto', home:'Home', travel:'Travel', health:'Health', life:'Life' };
        const cat = catMap[recMatch[2]] || 'Travel';
        try {
          window.NovaInsurance?.scrollToCategory?.(cat);
          const evt = new CustomEvent('nova:recommend', { detail: { category: cat } });
          document.dispatchEvent(evt);
        } catch {}
        message('bot', `Here are some ${cat} coverage ideas.`);
        save('bot','recommendations');
        setQuickReplies(['View policy','Checkout','Build policy']);
        return;
      }

      // Create/build package
      const pkgMatch = t.match(/\b(create|build)\s+(?:my\s+)?(?:policy|package).*?(?:with|including)\s+(.+)$/);
      if (pkgMatch){
        const items = pkgMatch[2].split(/,|\band\b/).map(s=>s.trim()).filter(Boolean);
        if (items.length){
          try {
            const res = window.NovaInsurance?.createPackage?.(items);
            if (res === true){
              const msg = 'Opening the builder to add your selected coverages…';
              await enqueueBot(msg); save('bot', msg);
            } else {
              const list = window.NovaInsurance?.list?.() || [];
              const total = list.reduce((a,b)=> a + Number(b.price||0), 0);
              const msg = `Added your selected coverages to the policy. Total premium: $${total.toFixed(2)}/month.`;
              await enqueueBot(msg); save('bot', msg);
            }
          } catch{}
        }
        setQuickReplies(['View policy','Checkout','Recommendations']);
        return;
      }

      // Add/remove modules
      const addMatch = t.match(/\b(add|include|put)\b\s+(.+?)\s+(?:to|into|in)?\s*(?:package|policy|plan)?\b/);
      const removeMatch = t.match(/\b(remove|delete|take\s*out|exclude)\b\s+(.+?)\s+(?:from)?\s*(?:package|policy|plan)?\b/);
      const handleList = async (names, op)=>{
        const arr = names.split(/,|\band\b/).map(s=>s.trim()).filter(Boolean);
        if (!arr.length) return false;
        let queued = false;
        for (const n of arr){
          try {
            const ok = op==='add' ? window.NovaInsurance?.addByName?.(n) : window.NovaInsurance?.removeByName?.(n);
            if (ok === true) queued = true;
          } catch{}
        }
        if (queued){
          const msg = op==='add' ? 'Opening the builder to add your selection…' : 'Opening the builder to update your policy…';
          await enqueueBot(msg); save('bot', msg);
        } else {
          const list = window.NovaInsurance?.list?.() || [];
          const total = list.reduce((a,b)=> a + Number(b.price||0), 0);
          const msg = op==='add'
            ? `Added to your policy. Total premium: $${total.toFixed(2)}/month.`
            : `Updated your policy. Total premium: $${total.toFixed(2)}/month.`;
          await enqueueBot(msg); save('bot', msg);
        }
        setQuickReplies(['View policy','Checkout','Recommendations']);
        return true;
      };
      if (addMatch){ if (await handleList(addMatch[2], 'add')) return; }
      if (removeMatch){ if (await handleList(removeMatch[2], 'remove')) return; }

      // Fallback
      try{
        // Final guard: if this is effectively a generic recs request or the form is visible, avoid Groq
        try {
          const isGenericRecs = /\b(recommendations?|suggestions?)\b/.test(t) && !/\b(auto|car|home|travel|health|life)\b/.test(t);
          const formVisible = !!panel.querySelector('#recForm') || !!window.__novaRecFormVisible;
          if (isGenericRecs || formVisible){
            if (typeof renderRecForm === 'function') renderRecForm();
            return;
          }
        } catch{}
        // KB first
        const kbAns = answerFromKB(text);
        if (kbAns){
          await enqueueBot(kbAns);
          save('bot', kbAns);
          setQuickReplies(['Build policy','Recommendations','View policy']);
          return;
        }
        try { console.debug('[Nova] Insurance fallback → sending to Groq:', text); } catch{}
        typing(true);
        const ai = await askGroq(text);
        typing(false);
        let out = ai;
        if (!out || /^⚠️/.test(out)){
          const fb = getFallbackMessage();
          if (fb) out = fb;
        }
        await enqueueBot(out);
        save('bot', out);
        setQuickReplies(['Build policy','Recommendations','View policy']);
      }catch{
        typing(false);
        await enqueueBot("Oops, I’m having trouble thinking right now. Can you try again in a moment?");
      }
      return;
    }

    // Router: product vs general chat (Groq) — run BEFORE small-talk / shopping logic
    // Consider typical commerce intents as product queries so AI doesn't trigger unnecessarily
    const isProductQuery = /\b(show|cheap|find|buy|purchase|add|remove|cart|checkout|product|products?|price|under|below|less than)\b/.test(lower)
      || /\b\d+\b/.test(lower)
      || hasApprox('show',1) || hasApprox('cart',1) || hasApprox('cheap',1) || hasApprox('add',1);
    if (!isProductQuery){
      (async ()=>{
        try{
          // KB first
          const kbAns = answerFromKB(text);
          if (kbAns){
            typing(false);
            message('bot', kbAns);
            save('bot', kbAns);
            setQuickReplies(['Browse products','Help','View cart']);
            return;
          }
          typing(true);
          const ai = await askGroq(text);
          typing(false);
          let out = ai;
          if (!out || /^⚠️/.test(out)){
            const fb = getFallbackMessage();
            if (fb) out = fb;
          }
          message('bot', out);
          save('bot', out);
          setQuickReplies(['Browse products','Help','View cart']);
        }catch{
          typing(false);
          const msg = "⚠️ Sorry, I couldn't connect to the AI right now.";
          message('bot', msg); save('bot', msg);
        }
      })();
      return;
    }

    // Sentiment cues
    const isFrustrated = /(not working|don'?t work|broken|angry|upset|frustrated|annoyed|wtf|why isn'?t)/.test(lower);
    const isConfused = /(confused|don'?t understand|lost|help me|stuck)/.test(lower);

    // Simple fuzzy helpers (for short keywords)
    const dl = (a,b)=>{ const m=a.length, n=b.length; const d=Array.from({length:m+1},()=>Array(n+1).fill(0)); for(let i=0;i<=m;i++) d[i][0]=i; for(let j=0;j<=n;j++) d[0][j]=j; for(let i=1;i<=m;i++){ for(let j=1;j<=n;j++){ const cost = a[i-1]===b[j-1]?0:1; d[i][j]=Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+cost); if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1]) d[i][j]=Math.min(d[i][j], d[i-2][j-2]+1); } } return d[m][n]; };
    const hasApprox = (word, max=1)=>{ return lower.split(/[^a-z0-9]+/).some(tok=> tok && dl(tok, word)<=max ); };
    // Determine mode: small talk vs shopping (mixed allowed)
    const shoppingCue = /(buy|purchase|product|under|below|less than|price|cart|checkout|add|remove|show|find)/.test(lower)
      || /\b\d+\b/.test(lower)
      || hasApprox('show',1) || hasApprox('cart',1) || hasApprox('cheap',1) || hasApprox('add',1);
    // Greetings / thanks / help
    const hasGreeting = /\b(hi|hello|hey|yo|sup)\b/.test(lower);
    const askHowAreYou = /\b(how (are|r) (you|u))\b/.test(lower);
    if (hasGreeting && !shoppingCue){
      typing(true); setTimeout(()=>{ typing(false); message('bot', "Hey there! I can help you browse items, manage your cart, or find deals. What's on your mind?"); save('bot','greet'); }, 400); return;
    }
    if (askHowAreYou){ typing(true); setTimeout(()=>{ typing(false); message('bot', "I'm great, thanks for asking! How about you? 😊"); save('bot','small_talk'); }, 380); return; }
    if (/\b(thanks|thank you|cheers)\b/.test(lower)){
      typing(true); setTimeout(()=>{ typing(false); message('bot', 'You got it! Anything else I can find for you?'); save('bot','thanks'); }, 400); return;
    }
    if (/\b(help|what can you do|how (do|to))\b/.test(lower)){
      lastIntent='help';
      typing(true); setTimeout(()=>{ typing(false); message('bot', 'Sure—here’s what I can do: find items by category or price, navigate pages, and manage your cart. Try: “tech under 50” or “add 2 blue mug to cart”.'); setQuickReplies(['Show gadgets','Cheap items','View cart']); save('bot','help'); }, 450); return;
    }

    // ---- Product browsing intents (bot-config-driven) ----
    const products = getBotProducts();
    const wantsShowProducts = /\b(show|browse|view)\s+(my\s+)?products?\b/.test(lower) || /^products?$/.test(lower);
    const priceCap = lower.match(/\b(under|below|less than)\s*\$?(\d{1,5})(?:\b|\s)/);
    const catWord = detectCategory(lower);
    if (wantsShowProducts){
      const list = products.length ? products : [];
      if (!list.length){ const msg='I don\'t have any products configured yet.'; message('bot', msg); save('bot', msg); setQuickReplies(['Help','Contact']); return; }
      renderProductsInChat(list, 'Here are our products');
      setQuickReplies(['Cheap items','View cart','Help']);
      return;
    }
    if (priceCap){
      const cap = Number(priceCap[2]);
      const list = (products||[]).filter(p=> typeof p.price==='number' && p.price<=cap);
      if (list.length){ renderProductsInChat(list, `Items under $${cap}`); setQuickReplies(['View cart','Show products']); return; }
    }
    if (/(show|find|browse)\b/.test(lower) && catWord){
      const list = (products||[]).filter(p=> (p.category||'').toLowerCase()===catWord);
      if (list.length){ renderProductsInChat(list, `Here are some ${catWord} items`); setQuickReplies(['View cart','Cheap items']); return; }
    }

    // Category synonyms
    const LEARN_KEY = 'nova_learn_v1';
    const learn = ()=>{ try{ return JSON.parse(localStorage.getItem(LEARN_KEY)) || { synonyms:{apparel:[],home:[],gadgets:[]}, faq:[] }; } catch{ return { synonyms:{apparel:[],home:[],gadgets:[]}, faq:[] }; } };
    const saveLearn = (obj)=> localStorage.setItem(LEARN_KEY, JSON.stringify(obj));
    const learned = learn();
    const catMap = {
      apparel: ['apparel','clothes','clothing','shirt','tee','t-shirt','hoodie','wear','outfit'],
      home: ['home','decor','house','mug','plant','kitchen'],
      gadgets: ['gadget','gadgets','tech','device','electronics','gear']
    };
    // merge learned synonyms
    try{
      for (const k of Object.keys(learned.synonyms||{})){
        const arr = learned.synonyms[k]||[];
        if (Array.isArray(arr)) catMap[k] = Array.from(new Set([...(catMap[k]||[]), ...arr]));
      }
    }catch{}
    const detectCategory = (s)=>{
      for (const [cat, list] of Object.entries(catMap)){
        if (list.some(w=> s.includes(w))) return cat;
      }
      return null;
    };

    // Brand extraction (from catalog)
    const knownBrands = Array.from(new Set(DEMO_PRODUCTS.map(p=> (p.brand||'').toLowerCase()).filter(Boolean)));
    const detectBrand = (s)=>{
      // direct include or token match, allowing possessive
      for (const b of knownBrands){
        if (!b) continue;
        if (s.includes(b)) return b;
        const re = new RegExp(`\\b${b.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')}(?:'s)?\\b`, 'i');
        if (re.test(s)) return b;
      }
      return null;
    };

    // Price parsing
    const parsePrice = (s)=>{
      const between = s.match(/(?:between|from)\s*\$?(\d+(?:\.\d{1,2})?)\s*(?:and|to|-)\s*\$?(\d+(?:\.\d{1,2})?)/);
      if (between){ return { min: parseFloat(between[1]), max: parseFloat(between[2]) }; }
      const under = s.match(/(?:under|below|less than)\s*\$?(\d+(?:\.\d{1,2})?)/);
      if (under){ return { max: parseFloat(under[1]) }; }
      const over = s.match(/(?:over|above|more than)\s*\$?(\d+(?:\.\d{1,2})?)/);
      if (over){ return { min: parseFloat(over[1]) }; }
      // plain number like "under 30?" already caught; else none
      return null;
    };

    // Context
    ctx = { ...getDefaultCtx(), ...getCtx() };
    const cat = detectCategory(lower) || ctx.lastCategory || null;
    const brand = detectBrand(lower) || ctx.lastBrand || null;
    const range = parsePrice(lower) || ctx.lastRange || null;
    // Dynamic mode tracking
    if (shoppingCue || cat || range || brand){ ctx.mode = 'shopping'; } else { ctx.mode = 'chat'; }

    // Quick navigation intents
    // Use non-capturing groups so the destination is consistently at index 1
    const navMatch = lower.match(/\b(?:go to|open|take me to|show(?: me)?)\s+(home|products?|new arrivals|top products|cart|checkout|about|contact)\b/);
    if (navMatch){
      const dest = navMatch[1];
      const go = (url, say)=>{ const msg = say || 'Right away! Opening that for you…'; message('bot', msg); save('bot', msg); setTimeout(()=>{ location.href = url; }, 500); };
      lastIntent='navigate';
      if (/home/.test(dest)) return go('index.html', 'Taking you home 🏠');
      if (/products?/.test(dest)) return go('products.html', 'Here come the products 🛍️');
      if (/(new arrivals|top products)/.test(dest)) return go('products.html?sort=name-asc', 'Showing our latest picks ✨');
      if (/cart/.test(dest)) return go('cart.html', 'Opening your cart 🧺');
      if (/checkout/.test(dest)) return go('checkout.html', 'Let’s get you checked out 💳');
      if (/about/.test(dest)) return go('about.html', 'About us, coming up ℹ️');
      if (/contact/.test(dest)) return go('contact.html', 'Contact options on the way 📬');
    }

    // Promo codes intent
    if (/(promo|promos|promotion|coupon|coupons|discount|discounts|code|codes)\b/.test(lower)){
      lastIntent='promos';
      if (window.BOT_FEATURES && window.BOT_FEATURES.promos === false){
        const msg = 'Promos are currently unavailable.';
        message('bot', msg); save('bot', msg); setQuickReplies(['Browse products','Help']);
      } else {
        renderPromos();
      }
      return;
    }

    // Upsell: ask for similar items or more like current suggestion
    if (/(more like this|similar|recommend more|show more like this)\b/.test(lower)){
      lastIntent='upsell_more_like_this';
      if (window.BOT_FEATURES && window.BOT_FEATURES.upsell === false){
        const msg = 'Upsell suggestions are currently disabled.';
        message('bot', msg); save('bot', msg); setQuickReplies(['Browse products','Help']);
      } else {
        const base = getCurrentCarouselProduct() || DEMO_PRODUCTS[0];
        renderUpsellForProduct(base);
      }
      return;
    }
    if (/\b(no thanks|nope|not now)\b/.test(lower)){
      lastIntent='decline_upsell';
      const msg = 'No problem. I’m here if you need anything else!';
      message('bot', msg); save('bot', msg);
      setQuickReplies(['View cart','Checkout','Help']);
      return;
    }

    // Cart intents
    if (/\b(clear (my )?cart|empty cart)\b/.test(lower)){
      lastIntent='cart_clear';
      const cart = window.DEMO_CART.readCart();
      Object.keys(cart).forEach(id=> window.DEMO_CART.setQty(id,0));
      const clearedMsg = isFrustrated? 'Done. I cleared your cart for a fresh start.' : 'Your cart is now empty. Want me to suggest something to add?';
      message('bot', clearedMsg); save('bot', clearedMsg);
      setQuickReplies(['Show gadgets','View products','Help']);
      return;
    }
    // View cart (robust match, handles typos like "wahts in my cart" and basket synonyms)
    const cartViewRe = /(what.?s|whats|wahts|wats)\s+(in\s+)?(my\s+)?(cart|basket)\b|\b(view|show|open)\s+(my\s+)?(cart|basket)\b|\b(cart|basket)\s+please\b|^(cart|basket)$/;
    if (cartViewRe.test(lower)){
      lastIntent='cart_view';
      renderCartSummary();
      return;
    }
    if (/\b(check ?out|proceed to checkout)\b/.test(lower)){
      lastIntent='checkout';
      const msg = 'Sure! Taking you to checkout.';
      message('bot', msg); save('bot', msg);
      setTimeout(()=> location.href='checkout.html', 500); return;
    }
    if (/\b(what'?s in (my )?cart|view cart|show (my )?cart|cart status)\b/.test(lower)){
      lastIntent='cart_view';
      renderCartSummary(); save('bot','cart_summary');
      return;
    }
    const addMatch = lower.match(/\b(add|put)\s+(\d+)\s*x\s*(.+?)\s*(?:to|into)?\s*cart\b|\b(add|put)\s+(.+?)\s*(?:to|into)?\s*cart\b/);
    if (addMatch){
      const qty = parseInt(addMatch[2]||'1',10) || 1;
      const name = (addMatch[3]||addMatch[5]||'').trim();
      const p = findProductByQuery(name);
      if (p){
        if (window.BOT_FEATURES && window.BOT_FEATURES.upsell === false){
          // Skip offer; add directly
          try { window.DEMO_CART.addToCart(p.id, qty); } catch {}
          const msg = `Added ${qty} × ${p.name} to your cart.`;
          message('bot', msg); save('bot', msg); setQuickReplies(['View cart','Checkout','Keep shopping']);
        } else {
          lastIntent='cart_add_offer';
          window.CB_OFFER = window.CB_OFFER || { current:null };
          window.CB_OFFER.current = { id: p.id, qty, price: 1.00 };
          const offer = `Before I add <strong>${p.name}</strong> × ${qty} to your cart, would you like it for a special price of <strong>$${window.CB_OFFER.current.price.toFixed(2)}</strong>?`;
          const actions = `<div style="display:flex;gap:8px;margin-top:6px"><button class="btn btn-primary" data-offer="accept">Yes, add at $${window.CB_OFFER.current.price.toFixed(2)}</button><button class="btn btn-ghost" data-offer="decline">No, regular price</button></div>`;
          const html = `<div>${offer}${actions}</div>`;
          message('bot', html); save('bot', html);
        }
      } else {
        lastIntent='cart_add_failed';
        const msg = `I couldn’t find that item. Try a more specific name or browse products.`;
        message('bot', msg); save('bot', msg);
      }
      return;
    }

    // Textual acceptance of a pending offer
    if (window.CB_OFFER && window.CB_OFFER.current){
      const { id, qty, price } = window.CB_OFFER.current;
      const p = DEMO_PRODUCTS.find(x=>x.id===id);
      if (/(yes|yep|sure|ok|okay|do it|add it|go ahead)\b/.test(lower)){
        try { window.DEMO_SPECIALS?.set?.(id, price); } catch{}
        window.DEMO_CART.addToCart(id, qty||1);
        const msg = `Added ${qty||1} × ${p? p.name : 'item'} at special price $${price.toFixed(2)}. 🎉`;
        message('bot', msg); save('bot', msg);
      } else {
        window.DEMO_CART.addToCart(id, qty||1);
        const msg = `Added ${qty||1} × ${p? p.name : 'item'} at regular price.`;
        message('bot', msg); save('bot', msg);
      }
      window.CB_OFFER.current = null;
      try{ if (p && (!window.BOT_FEATURES || window.BOT_FEATURES.upsell !== false)) renderUpsellForProduct(p); }catch{}
      setQuickReplies(['View cart','Checkout','Keep shopping']);
      try { e.stopPropagation(); } catch {}
      return;
    }
    const removeMatch = lower.match(/\b(remove|delete|take out)\s+(\d+)?\s*(.+?)\s*(?:from)?\s*cart\b/);
    if (removeMatch){
      const qty = parseInt(removeMatch[2]||'0',10);
      const name = (removeMatch[3]||'').trim();
      const p = findProductByQuery(name);
      if (p){
        lastIntent='cart_remove';
        if (qty>0){
          const cart = window.DEMO_CART.readCart();
          window.DEMO_CART.setQty(p.id, Math.max(0, (cart[p.id]||0)-qty));
        } else {
          window.DEMO_CART.setQty(p.id, 0);
        }
        { const msg = `Removed ${qty>0? qty+' × ' : ''}${p.name} from your cart.`; message('bot', msg); save('bot', msg); }
      } else {
        lastIntent='cart_remove_failed';
        { const msg = "I couldn't find that item in your cart."; message('bot', msg); save('bot', msg); }
      }
      return;
    }

    // Answer from KB if applicable
    const kb = kbAnswer(lower);
    if (kb){ typing(true); setTimeout(()=>{ typing(false); message('bot', kb); save('bot','kb'); }, 420); return; }

    // If user gave price but no category, clarify
    if (ctx.mode==='shopping' && range && !detectCategory(lower) && !ctx.lastCategory){
      ctx.lastRange = range; setCtx(ctx); lastIntent = 'clarify_category';
      const labelPrice = range ? (range.min && range.max ? `between $${range.min} and $${range.max}` : (range.max ? `under $${range.max}` : `above $${range.min}`)) : '';
      message('bot', `Got it! I can help you find products ${labelPrice}. Are you looking for gadgets, apparel, or home?`);
      setQuickReplies(['Gadgets','Apparel','Home']);
      save('bot','clarify');
      return;
    }

    // Build candidate list (bias by preferences when unspecified)
    let list = [...DEMO_PRODUCTS];
    if (cat) list = list.filter(p=>p.category===cat);
    if (brand) list = list.filter(p=> (p.brand||'').toLowerCase()===brand);
    if (range){
      if (range.min!=null) list = list.filter(p=>p.price >= range.min);
      if (range.max!=null) list = list.filter(p=>p.price <= range.max);
    }
    // Preference biasing
    if (!cat){
      const fav = getFavCategory();
      if (fav){ list.sort((a,b)=> (b.category===fav) - (a.category===fav)); }
    }
    if (!range){
      const typical = getTypicalBudget();
      if (typical!=null){ list.sort((a,b)=> Math.abs(a.price-typical)-Math.abs(b.price-typical)); }
    }

    // Cheap/expensive keywords
    if (!range && /\b(cheap|cheapest|low|budget)\b/.test(lower)) list.sort((a,b)=>a.price-b.price);
    if (!range && /\b(expensive|premium|high)\b/.test(lower)) list.sort((a,b)=>b.price-a.price);

    // Update context if user specified new signals
    const detectedCat = detectCategory(lower);
    const detectedBrand = detectBrand(lower);
    const detectedRange = parsePrice(lower);
    if (detectedCat) ctx.lastCategory = detectedCat;
    if (detectedBrand) ctx.lastBrand = detectedBrand;
    if (detectedRange) ctx.lastRange = detectedRange;
    ctx.lastIntent = lastIntent || ctx.lastIntent;
    setCtx(ctx);
    // Update preferences based on new signals
    if (detectedCat || detectedRange){ updatePrefs({ category: detectedCat, range: detectedRange }); }

    typing(true);
    setTimeout(async ()=>{
      typing(false);
      if (list.length){
        const labelCat = brand ? (brand.charAt(0).toUpperCase()+brand.slice(1)) : (cat ? cat : 'popular');
        const labelPrice = range ? (range.min && range.max ? ` between $${range.min} and $${range.max}` : (range.max ? ` under $${range.max}` : ` above $${range.min}`)) : '';
        lastIntent='suggest_products';
        const introVariants = [
          `Sure! Here are some ${labelCat}${labelPrice} picks:`,
          `Got it — these ${labelCat}${labelPrice} options look great:`,
          `I found a few ${labelCat}${labelPrice} ideas you might like:`
        ];
        { const msg = (isFrustrated? 'No worries, let me try a different angle. ' : isConfused? 'Let me walk you through a few options. ' : '') + introVariants[Math.floor(Math.random()*introVariants.length)]; message('bot', msg); save('bot', msg); }
        renderCarousel(list, { start:0, remember:true });
        setQuickReplies(['Next ▶','View cart','Checkout']);
      } else {
        lastIntent='no_results';
        // Defer to AI assistant when our product logic finds no matches
        try{
          typing(true);
          const ai = await sendToGroq(text);
          typing(false);
          message('bot', ai);
          save('bot', ai);
          setQuickReplies(['Browse products','Help','View cart']);
        }catch{
          typing(false);
          const msg = "⚠️ Sorry, I couldn't connect to the AI right now.";
          message('bot', msg); save('bot', msg);
          setQuickReplies(['Show gadgets','Show apparel','Cheap items']);
        }
        // learning: capture last unknown phrase tokens as potential synonyms
        try{
          const unk = (learned.unknown||[]);
          unk.push(text.slice(0,120));
          learned.unknown = unk.slice(-25);
          saveLearn(learned);
        }catch{}
      }
      save('bot','suggested');
    }, 550);
  }

  function send(){
    const val = input.value.trim(); if (!val) return;
    message('user', val);
    save('user', val);
    input.value='';
    respond(val);
  }
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); send(); }});

  // Voice input (Web Speech API)
  let rec; let recognizing = false; let partialTranscript = '';
  let stickyListening = false; // stays true while user wants to keep mic on
  function updateMicAvailability(){
    try{
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const voiceEnabled = !!(window.BOT_FEATURES && window.BOT_FEATURES.voiceInput);
      const supported = !!SR;
      if (!supported){ micBtn.disabled = true; micBtn.title = 'Voice not supported on this browser'; return; }
      if (!voiceEnabled){ micBtn.disabled = true; micBtn.title = 'Voice input is disabled for this bot'; return; }
      micBtn.disabled = false; micBtn.title = '';
    } catch{ micBtn.disabled = true; }
  }
  try {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
      rec.onstart = () => { recognizing = true; micBtn.classList.add('active'); micBtn.setAttribute('aria-pressed','true'); input.placeholder = 'Listening…'; try{ localStorage.setItem('nova_mic_ok','1'); }catch{} };
      rec.onend = () => {
        recognizing = false;
        if (stickyListening){
          // Chrome often ends on brief silence; keep listening until user stops
          try { rec.start(); return; } catch {}
        }
        micBtn.classList.remove('active'); micBtn.setAttribute('aria-pressed','false'); input.placeholder = 'Speak or type…';
        const t = (input.value || partialTranscript || '').trim();
        if (t){ input.value = t; send(); }
        partialTranscript = '';
      };
      rec.onerror = (e) => {
        if (e && (e.error === 'no-speech' || e.error === 'audio-capture')){
          // keep trying while user wants to listen
          if (stickyListening){ try { rec.start(); return; } catch{} }
        }
        recognizing = false; micBtn.classList.remove('active'); micBtn.setAttribute('aria-pressed','false'); input.placeholder = 'Speak or type…';
        if (e && e.error === 'not-allowed') { const msg = 'Microphone permission blocked. Please allow mic access to talk to me.'; message('bot', msg); save('bot', msg); }
      };
      rec.onresult = (ev) => {
        let finalText = '';
        let interim = '';
        for (let i=ev.resultIndex; i<ev.results.length; i++){
          const r = ev.results[i];
          if (r.isFinal) finalText += r[0].transcript + ' ';
          else interim += r[0].transcript + ' ';
        }
        partialTranscript = (finalText || interim).trim();
        if (interim) input.value = interim.trim();
        if (finalText) input.value = finalText.trim();
      };
    } else {
      micBtn.disabled = true; micBtn.title = 'Voice not supported on this browser';
    }
  } catch{ micBtn.disabled = true; }

  // Ensure mic reflects current feature/support after SR init
  try { updateMicAvailability(); } catch{}

  // Do NOT proactively call getUserMedia to avoid permission prompts on every page load.
  // We only start recognition on explicit user gesture (click/press) below.

  // Click toggles start/stop (single modality to avoid mousedown/mouseup conflicts)
  micBtn.addEventListener('click', ()=>{
    if (!rec || micBtn.disabled) return;
    if (!recognizing) {
      stickyListening = true; partialTranscript = '';
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch{}
      try { rec.start(); } catch {}
    } else {
      stickyListening = false;
      try { rec.stop(); } catch {}
    }
  });

  // Helper: load and render saved chat history
  function renderSavedHistory(silent=true){
    try { console.debug('[Nova] Loading chat history from localStorage'); } catch{}
    const rawHistory = loadChat();
    const history = rawHistory.filter(m => !(m.role==='bot' && /^[a-z_]+$/.test(String(m.text))));
    if (history.length){
      history.forEach(m=> message(m.role, m.text, m.role==='bot'?{silent:!!silent}:{}) );
    } else {
      let first = '';
      try {
        if (window.__sdkBot && window.__sdkBot.firstMessage){
          first = String(window.__sdkBot.firstMessage);
        } else {
          const bots = JSON.parse(localStorage.getItem('nova_bots_v1')||'[]');
          let activeId = localStorage.getItem('nova_active_bot_id')||'';
          let bot = bots.find(b=>b.id===activeId) || null;
          if (!bot && bots.length){
            bot = bots[0];
            // Persist as active so future opens are consistent
            try { localStorage.setItem('nova_active_bot_id', bot.id); } catch{}
          }
          if (bot && bot.firstMessage) first = String(bot.firstMessage);
        }
      } catch{}
      if (!first){
        first = INSURANCE_MODE
          ? `Hi! I'm Nova, your insurance assistant. I can help you build a custom policy. Try selecting a module or ask me a question!`
          : `Hi! I'm Nova, your demo shop assistant. I can recommend products, show promos, or help you check out.`;
      }
      // Send intro only when panel is open; otherwise queue it as pending
      if (!window.__novaIntroRendered && !window.__novaIntroSent){
        window.__novaIntroRendered = true;
        if (panel.classList.contains('is-open')){
          window.__novaIntroSent = true;
          // Show typing indicator briefly before intro
          try { typing(true); } catch{}
          setTimeout(()=>{
            try { typing(false); } catch{}
            message('bot', first, { instant:true });
            save('bot', first);
            markIntroSeen();
          }, 600);
        } else {
          // queue until open
          try { window.__novaIntroPending = first; } catch{}
        }
      }
    }
  }

  // Initial render: replay entire history silently (no TTS), no repeat intro
  renderSavedHistory(true);
  // Safety: if no messages appear within 1s (e.g., due to heavy rendering or late config), re-attempt intro
  try {
    setTimeout(()=>{
      try {
        // Only retry when panel is open and no intro was sent
        if (!panel.classList.contains('is-open')) return;
        const hasMsgs = !!body.querySelector('.msg');
        if (!hasMsgs && !window.__novaIntroSent){
          window.__novaIntroRendered = false;
          renderSavedHistory(true);
        }
      } catch{}
    }, 1000);
  } catch{}
  // Auto-open the chat panel once per session (non-intrusive)
  try {
    const AKEY = 'nova_auto_opened_session';
    const already = sessionStorage.getItem(AKEY) === '1';
    const isOpen = panel.classList.contains('is-open');
    if (!already && !isOpen){
      setTimeout(()=>{ try { open(); sessionStorage.setItem(AKEY,'1'); } catch{} }, 1200);
    }
  } catch{}
  
  // Idle nudge after 15–20s of no interaction while panel open
  let __idleTimer = null;
  function scheduleIdle(){
    try { if (__idleTimer) clearTimeout(__idleTimer); } catch{}
    const delay = 15000 + Math.floor(Math.random()*5000);
    __idleTimer = setTimeout(()=>{
      try {
        const NKEY = 'nova_idle_nudged';
        // Nudge at most once per session
        if (sessionStorage.getItem(NKEY) === '1') return;
        const msg = "Need help picking a policy? I can suggest essential modules based on your profile.";
        message('bot', msg); save('bot', msg);
        sessionStorage.setItem(NKEY, '1');
        setQuickReplies(['Add recommended module','Show health options','Finalize policy']);
      } catch{}
    }, delay);
  }
  function resetIdle(){ scheduleIdle(); }
  // Start idle timer when panel opens
  try { panel.addEventListener('transitionend', (e)=>{ if (panel.classList.contains('is-open')) scheduleIdle(); }); } catch{}
  // Reset on interactions
  try { input.addEventListener('keydown', resetIdle); } catch{}
  try { document.addEventListener('click', resetIdle, { capture:true }); } catch{}
  // Reset on scroll interactions (page and chat panel)
  try { window.addEventListener('scroll', resetIdle, { passive:true, capture:true }); } catch{}
  try { document.addEventListener('scroll', resetIdle, { passive:true, capture:true }); } catch{}
  try { panel.addEventListener('scroll', resetIdle, { passive:true }); } catch{}
  try { body.addEventListener('scroll', resetIdle, { passive:true }); } catch{}
  // Also restore any saved product suggestions carousel from context
  function restoreCarouselFromCtx(){
    try {
      const ctx = getCtx() || {};
      const ids = Array.isArray(ctx.lastSuggestionIds) ? ctx.lastSuggestionIds : [];
      if (!ids.length) return;
      const list = ids.map(id=> DEMO_PRODUCTS.find(p=>p.id===id)).filter(Boolean);
      if (!list.length) return;
      const start = Math.max(0, Math.min(parseInt(ctx.currentIndex||0,10)||0, list.length-1));
      renderCarousel(list, { start, remember:true });
    } catch{}
  }
  if (!INSURANCE_MODE) restoreCarouselFromCtx();

  // Public embed shim: allow external sites to call NovaBot.init({...})
  try {
    if (!window.NovaBot) {
      window.NovaBot = {
        available: true,
        init: function(config){
          try { console.debug('[Nova] NovaBot.init called'); } catch{}
          const bot = config || {};
          // Store as SDK bot so intro uses this message on empty history
          try { window.__sdkBot = bot; } catch{}
          // Apply theme/features to the existing widget
          try { applyBotConfig(bot); } catch{}
          // If firstMessage changed, clear intro flag and chat so the new intro will show
          try {
            const k = 'nova_last_first_msg_sdk';
            const prev = localStorage.getItem(k)||'';
            const cur = String(bot.firstMessage||'');
            if (cur && cur !== prev){
              try { localStorage.removeItem('nova_intro_seen'); } catch{}
              try { localStorage.removeItem('demo_chat_v1'); } catch{}
              localStorage.setItem(k, cur);
            }
          } catch{}
          // If panel is already open and no messages yet, render the SDK firstMessage immediately
          try {
            const sdm = (bot && bot.firstMessage) ? String(bot.firstMessage).trim() : '';
            const isOpen = panel.classList.contains('is-open');
            const hasMsgs = !!body.querySelector('.msg');
            if (sdm && isOpen && !hasMsgs){
              while (body && body.firstChild) body.removeChild(body.firstChild);
              try { clearQuickReplies(); } catch{}
              message('bot', sdm);
            }
          } catch{}
          // Optionally auto-open if requested
          try {
            if (bot.autoOpen) { open(); }
          } catch{}
          return true;
        }
      };
    } else {
      // If some other script defined it, mark available
      try { window.NovaBot.available = true; } catch{}
    }
  } catch {}

  body.addEventListener('click', (e)=>{
    const t = e.target;
    const chip = t.closest('[data-chip]');
    if (chip){
      const c = chip.dataset.chip;
      message('user', c);
      save('user', c);
      respond(c);
      return;
    }
    // Handle special offer buttons within chatbot so we can call message/save
    const offerBtn = t.closest('[data-offer]');
    if (offerBtn && window.CB_OFFER && window.CB_OFFER.current){
      const take = offerBtn.getAttribute('data-offer');
      const { id, qty, price } = window.CB_OFFER.current;
      const p = DEMO_PRODUCTS.find(x=>x.id===id);
      if (take === 'accept'){
        try { window.DEMO_SPECIALS?.set?.(id, price); } catch{}
        window.DEMO_CART.addToCart(id, qty||1);
        const msg = `Added ${qty||1} × ${p? p.name : 'item'} at special price $${price.toFixed(2)}. 🎉`;
        message('bot', msg); save('bot', msg);
      } else {
        try { window.DEMO_SPECIALS?.clear?.(id); } catch{}
        window.DEMO_CART.addToCart(id, qty||1);
        const msg = `Added ${qty||1} × ${p? p.name : 'item'} at regular price.`;
        message('bot', msg); save('bot', msg);
      }
      window.CB_OFFER.current = null;
      try{ if (p) renderUpsellForProduct(p); }catch{}
      setQuickReplies(['View cart','Checkout','Keep shopping']);
      try { e.stopPropagation(); } catch {}
      return;
    }
    const addBtn = t.closest('[data-add]');
    if (addBtn){
      const id = addBtn.dataset.add;
      const p = DEMO_PRODUCTS.find(x=>x.id===id);
      if (window.BOT_FEATURES && window.BOT_FEATURES.upsell === false){
        // Direct add, no offer
        window.DEMO_CART.addToCart(id, 1);
        const msg = `Added ${p? p.name : 'item'} to your cart.`;
        message('bot', msg); save('bot', msg); setQuickReplies(['View cart','Checkout','Keep shopping']);
        return;
      } else {
        window.CB_OFFER.current = { id, qty:1, price:1.00 };
        const offer = `Before I add <strong>${p? p.name : 'this item'}</strong> to your cart, would you like it for a special price of <strong>$${window.CB_OFFER.current.price.toFixed(2)}</strong>?`;
        const actions = `<div style=\"display:flex;gap:8px;margin-top:6px\"><button class=\"btn btn-primary\" data-offer=\"accept\">Yes, add at $${window.CB_OFFER.current.price.toFixed(2)}</button><button class=\"btn btn-ghost\" data-offer=\"decline\">No, regular price</button></div>`;
        const html = `<div>${offer}${actions}</div>`;
        message('bot', html); save('bot', html);
        return;
      }
    }
    const act = t.closest('[data-action]');
    if (act){
      const a = act.dataset.action;
      if (a==='next-suggestions' || a==='prev-suggestions'){
        const ctx = getCtx();
        const next = parseInt(act.dataset.next||String(ctx.nextIndex||0),10) || 0;
        const ids = Array.isArray(ctx.lastSuggestionIds) ? ctx.lastSuggestionIds : [];
        let list = [];
        try {
          // Prefer resolving from the last suggestions cache (supports dashboard-provided products)
          const cache = window.__novaLastSuggestions || {};
          const byId = cache.byId || {};
          list = ids.map(id=> byId[id]).filter(Boolean);
          // Fallback to DEMO_PRODUCTS resolution if needed
          if (!list.length && typeof DEMO_PRODUCTS !== 'undefined'){
            list = ids.map(id=> DEMO_PRODUCTS.find(p=>p.id===id)).filter(Boolean);
          }
          // Final fallback to the cached full list
          if (!list.length && Array.isArray(cache.list)) list = cache.list.slice();
        } catch {}
        if (list.length){
          renderCarousel(list, { start: next, remember:true });
        }
        try { e.preventDefault(); e.stopPropagation(); } catch{}
        return;
      }
      if (a==='open-cart') { const msg='Opening your cart.'; message('bot', msg); save('bot', msg); setTimeout(()=>{ location.href='cart.html'; }, 500); }
      if (a==='checkout') { const msg='Taking you to checkout.'; message('bot', msg); save('bot', msg); setTimeout(()=>{ location.href='checkout.html'; }, 500); }
      if (a==='clear-cart') {
        const cart = window.DEMO_CART.readCart(); Object.keys(cart).forEach(id=> window.DEMO_CART.setQty(id,0));
        { const msg = 'Cart cleared.'; message('bot', msg); save('bot', msg); }
      }
    }

    // Flow launcher buttons
    const flowBtn = t.closest('[data-flow]');
    if (flowBtn){
      const flow = flowBtn.getAttribute('data-flow');
      try {
        if (flow==='promos') { window.NOVA?.trigger && window.NOVA.trigger('promos_show'); return; }
        if (flow==='recommendations') { window.NOVA?.trigger && window.NOVA.trigger('recommendations'); return; }
        if (flow==='browse') { window.NOVA?.trigger && window.NOVA.trigger('browse_products'); return; }
        if (flow==='checkout') { window.NOVA?.trigger && window.NOVA.trigger('checkout_flow'); return; }
      } catch{}
    }
  });

  // Quick reply clicks
  qr && qr.addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-qr]');
    if (!btn) return;
    const val = btn.getAttribute('data-qr')||btn.textContent||'';
    if (!val) return;
    message('user', val); save('user', val); respond(val);
  });

  // Handle a generic "Show all" phrase
  // Keep lightweight to avoid interfering with other intents
  function isShowAll(s){ return /^(show\s+all|see\s+all|browse\s+all)$/i.test(s.trim()); }

  // Simulation Mode: run scripted conversations and collect simple learnings
  window.NOVA_SIM = {
    scenarios: [
      ['hi','show gadgets under 50','add 1 blue mug to cart','what\'s in my cart','checkout'],
      ['i\'m confused','help','take me to products','cheap items','add 2 hoodie to cart','view cart'],
      ['take me to contact','what is this site','go to home','show me top products'],
      ['remove 1 mug from cart','clear my cart','tech above 70']
    ],
    run(delay=600){
      const results = [];
      let si = 0; let ui = 0;
      const next = ()=>{
        if (si >= this.scenarios.length) { console.log('Simulation complete', results); return; }
        const convo = this.scenarios[si];
        if (ui >= convo.length){ si++; ui=0; setTimeout(next, delay); return; }
        const u = convo[ui++];
        message('user', u, {silent:true}); save('user', u);
        const before = performance.now();
        respond(u);
        const dur = Math.round(performance.now()-before);
        results.push({ scenario: si, utterance: u, intent: (lastIntent||'unknown'), dur });
        setTimeout(next, delay);
      };
      next();
      return true;
    }
  };
})();

// Chatbot Workflows API (public): expose simple preset flows runnable from any page
// This attaches AFTER the chatbot IIFE so it can call into its internals via a small bridge.
(function(){
  // Attempt to bind to internal functions by dispatching custom events that the chatbot listens to,
  // but since we are in the same bundle and scope, provide a minimal bridge via DOM events.
  // We will leverage the window to send a custom event with the utterance, and inside chatbot code we listen.
  // Add a single-time listener registration guard
  if (!window.NOVA) window.NOVA = {};

  // Ensure an event channel exists
  const EVT = 'nova-run-utterance';
  try {
    if (!window.__novaWorkflowListener) {
      window.__novaWorkflowListener = true;
      document.addEventListener(EVT, (e)=>{
        try{
          const txt = (e && e.detail && e.detail.text) ? String(e.detail.text) : '';
          const silent = !!(e && e.detail && e.detail.silent);
          // Find chatbot globals in closure via DOM hooks
          const input = document.querySelector('#cbInput');
          if (!txt) return;
          // Inject as if user typed & sent
          const ev = new CustomEvent(''); // placeholder to satisfy older browsers
          try{ ev && void 0; }catch{}
          // Fallback to direct functions if present on window (optional future exposure)
          try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch{}
          // Render message and respond if chatbot has been initialized (elements exist)
          const body = document.querySelector('#cbBody');
          if (body){
            // message/save/respond are scoped inside the IIFE; use the input+send path
            const sendBtn = document.querySelector('#cbSend');
            if (input){ input.value = txt; }
            if (sendBtn){ sendBtn.click(); }
          }
        }catch{}
      });
    }
  } catch{}

  // Define some default workflows
  const defaultWorkflows = {
    shopping_quick_deals: {
      title: 'Shopping: Quick Deals',
      steps: ['cheap items','show gadgets','add 1 blue mug to cart','what\'s in my cart']
    },
    checkout_flow: {
      title: 'Checkout Flow',
      steps: ['what\'s in my cart','checkout']
    },
    browse_products: {
      title: 'Browse Products',
      steps: ['take me to products','show me top products']
    },
    help_and_contact: {
      title: 'Help & Contact',
      steps: ['help','take me to contact']
    },
    promos_show: {
      title: 'Show Promo Codes',
      steps: ['promos']
    },
    recommendations: {
      title: 'Recommendations',
      steps: ['show me top products']
    },
    upsell_more: {
      title: 'Upsell: More Like This',
      steps: ['more like this']
    }
  };

  // Merge with any user-extended workflows
  window.NOVA.workflows = { ...(window.NOVA.workflows||{}), ...defaultWorkflows };

  // Helper to open chatbot panel if available
  function openPanel(){
    try{
      const toggle = document.querySelector('#chatbotToggle');
      const panel = document.querySelector('#chatbotPanel');
      if (panel && !panel.classList.contains('is-open')){
        // simulate click to ensure proper focus and state
        if (toggle) toggle.click(); else panel.classList.add('is-open');
      }
    }catch{}
  }

  // Run a named workflow (sequential: wait for a bot reply to settle before next)
  window.NOVA.trigger = function(name, opts={}){
    const wf = window.NOVA.workflows[name];
    if (!wf) { try{ console.warn('[Nova] Unknown workflow:', name); }catch{} return false; }
    const steps = Array.isArray(wf.steps) ? wf.steps.slice() : [];
    if (!steps.length) return false;
    openPanel();

    const settleMs = Math.max(250, Math.min(1500, opts.settleMs||550));

    function countMsgs(){
      try { const body = document.querySelector('#cbBody'); return body ? body.querySelectorAll('.msg').length : 0; } catch { return 0; }
    }

    function sendAndWait(text){
      return new Promise((resolve)=>{
        const startCount = countMsgs();
        // send utterance
        try { document.dispatchEvent(new CustomEvent(EVT, { detail:{ text } })); } catch{}

        const body = document.querySelector('#cbBody');
        if (!body){ resolve(); return; }

        let lastChange = Date.now();
        let lastCount = startCount;
        const observer = new MutationObserver(()=>{
          const c = countMsgs();
          if (c !== lastCount){ lastCount = c; lastChange = Date.now(); }
        });
        observer.observe(body, { childList:true, subtree:true });

        const tick = ()=>{
          // wait until at least one new message arrived and quiet period elapsed
          const hasNew = lastCount > startCount;
          const quiet = Date.now() - lastChange >= settleMs;
          if (hasNew && quiet){ observer.disconnect(); resolve(); return; }
          setTimeout(tick, 120);
        };
        setTimeout(tick, 180);
      });
    }

    (async ()=>{
      for (const step of steps){
        await sendAndWait(step);
      }
    })();
    return true;
  };
})();
