// Insurance Netflix-style interactions
// - Handles add/remove of sub-policies (modules)
// - Sticky sidebar list + live total
// - Persists to localStorage
// - Exposes small API for Nova bot to recommend/scroll/add

(function(){
  const LS_KEY = 'policyItems:v1';
  const Q_KEY = 'nova:queue:v1';
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

  const psEl = $('#policySidebar');

  const itemsEl = $('#psItems');
  const totalEl = $('#psTotal');
  const finalizeBtn = $('#psFinalize');

  // Render dynamic catalog rows/cards if INS_CATALOG is present
  const nfMain = document.querySelector('.nf-main');
  function slugify(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }
  function renderCatalog(){
    if (!nfMain) return;
    const cat = (window.INS_CATALOG || []);
    if (!Array.isArray(cat) || !cat.length) return;
    // Clear existing static rows to avoid duplicates
    try { nfMain.innerHTML = ''; } catch{}
    for (const group of cat){
      const rowId = `row-${slugify(group.name||'cat')}`;
      const row = document.createElement('div');
      row.className = 'nf-row';
      row.id = rowId;
      row.innerHTML = `<div class="nf-row-head"><h2>${group.name}</h2></div><div class="nf-scroller"></div>`;
      const scroller = row.querySelector('.nf-scroller');
      (group.items||[]).forEach(it => {
        const art = document.createElement('article');
        art.className = 'nf-card';
        art.setAttribute('data-name', it.name);
        art.setAttribute('data-price', String(it.price||0));
        art.setAttribute('data-cat', group.name);
        const img = it.img || `https://placehold.co/480x270?text=${encodeURIComponent(it.name)}`;
        const desc = it.desc || `${group.name} coverage: ${it.name}`;
        const price = Number(it.price||0).toFixed(2);
        art.innerHTML = `
          <div class="thumb" style="background-image:url('${img}')"></div>
          <div class="meta">
            <h3>${it.name}</h3>
            <p>${desc}</p>
            <div class="actions"><button class="btn btn-primary policy-add">Add $${price}/mo</button></div>
          </div>`;
        scroller.appendChild(art);
      });
      nfMain.appendChild(row);
    }
  }

  // Load state
  let items = load();

  function load(){
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
    catch { return []; }
  }
  function save(){
    localStorage.setItem(LS_KEY, JSON.stringify(items));
  }

  function money(n){ return `$${Number(n).toFixed(2)}`; }

  // note: slugify moved above for shared use

  function upsertItem(it){
    const idx = items.findIndex(x => x.id === it.id);
    if (idx === -1) items.push(it);
    else items[idx] = it;
    save();
    render();
  }
  function removeItem(id){
    items = items.filter(x => x.id !== id);
    save();
    render();
  }

  function render(){
    // list
    itemsEl.innerHTML = '';
    if (!items.length){
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'No modules added yet.';
      itemsEl.appendChild(empty);
    } else {
      for (const it of items){
        const row = document.createElement('div');
        row.className = 'ps-item';
        row.innerHTML = `
          <div>
            <div class="name">${it.name}</div>
            <div class="cat">${it.cat}</div>
          </div>
          <div style="display:grid;gap:6px;justify-items:end">
            <div class="price">${money(it.price)}</div>
            <button class="remove" data-id="${it.id}">Remove</button>
          </div>
        `;
        itemsEl.appendChild(row);
      }
    }
    // total
    const total = items.reduce((a,b) => a + Number(b.price||0), 0);
    totalEl.textContent = money(total);

    // bind removes
    $$('.ps-item .remove', itemsEl).forEach(btn => btn.addEventListener('click', (e)=>{
      const id = e.currentTarget.getAttribute('data-id');
      removeItem(id);
    }));
  }

  // Delegated binding for dynamically rendered Add buttons
  document.addEventListener('click', (e)=>{
    const btn = e.target && (e.target.closest && e.target.closest('.policy-add'));
    if (!btn) return;
    const card = btn.closest('.nf-card');
    if (!card) return;
    const name = card.getAttribute('data-name');
    const cat = card.getAttribute('data-cat');
    const price = parseFloat(card.getAttribute('data-price')) || 0;
    const id = slugify(`${cat}-${name}`);
    upsertItem({ id, name, cat, price });
  });

  // Finalize
  if (finalizeBtn){
    finalizeBtn.addEventListener('click', ()=>{
      try { localStorage.setItem('policy:checkout', JSON.stringify({ items, total: items.reduce((a,b)=>a+b.price,0) })); } catch {}
      window.location.href = 'checkout.html';
    });
  }

  // Scroll from CTA
  $('#startBuilding')?.addEventListener('click', (e)=>{
    e.preventDefault();
    $('#insCategories')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Helpers for non-home pages: queue actions then navigate to home
  function enqueue(action){
    try{
      const q = JSON.parse(localStorage.getItem(Q_KEY)||'[]');
      q.push(action);
      localStorage.setItem(Q_KEY, JSON.stringify(q));
    }catch{}
  }
  function goHome(){
    try {
      if (!/index\.html$/i.test(location.pathname)){
        // Wait 500ms so the bot can say something before navigating
        setTimeout(()=>{ location.href = 'index.html#build'; }, 500);
      }
    } catch{}
    return true;
  }

  // Small API for the bot to interact
  const api = {
    addByName(name){
      const want = String(name||'').trim(); if (!want) return false;
      // If sidebar not present (non-home), queue and redirect
      if (!psEl){ enqueue({ t:'add', name: want }); return goHome(); }
      // exact, case-insensitive, then partial includes
      let card = $(`.nf-card[data-name="${CSS.escape(want)}"]`);
      if (!card){
        const cards = $$('.nf-card');
        const lower = want.toLowerCase();
        card = cards.find(c=> (c.getAttribute('data-name')||'').toLowerCase() === lower)
            || cards.find(c=> (c.getAttribute('data-name')||'').toLowerCase().includes(lower));
      }
      if (!card) return false;
      const nameNorm = card.getAttribute('data-name') || want;
      const cat = card.getAttribute('data-cat');
      const price = parseFloat(card.getAttribute('data-price')) || 0;
      const id = slugify(`${cat}-${nameNorm}`);
      const it = { id, name: nameNorm, cat, price };
      upsertItem(it);
      // brief visual ping
      card.style.outline = '2px solid var(--accent-2)';
      setTimeout(()=> card.style.outline = '', 900);
      // expose last added for assistants
      try { window.NI_LAST_ADDED = it; } catch{}
      return it;
    },
    removeByName(name){
      const want = String(name||'').trim(); if (!want) return false;
      if (!psEl){ enqueue({ t:'remove', name: want }); return goHome(); }
      // try strict then fuzzy to compute id
      let card = $(`.nf-card[data-name="${CSS.escape(want)}"]`);
      if (!card){
        const cards = $$('.nf-card');
        const lower = want.toLowerCase();
        card = cards.find(c=> (c.getAttribute('data-name')||'').toLowerCase() === lower)
            || cards.find(c=> (c.getAttribute('data-name')||'').toLowerCase().includes(lower));
      }
      if (card){
        const cat = card.getAttribute('data-cat');
        const nameNorm = card.getAttribute('data-name') || want;
        const id = slugify(`${cat}-${nameNorm}`);
        removeItem(id);
        return true;
      }
      // Fallback: try removing any item whose name includes the fragment
      const lower = want.toLowerCase();
      const hit = items.find(x=> (x.name||'').toLowerCase().includes(lower));
      if (hit){ removeItem(hit.id); return true; }
      return false;
    },
    createPackage(names){
      const added = [];
      const list = Array.isArray(names)? names : [];
      if (!psEl){ enqueue({ t:'batch', names: list }); return goHome(); }
      list.forEach(n=>{ const it = api.addByName(n); if (it) added.push(it); });
      return added;
    },
    scrollToCategory(cat){
      if (!psEl){ enqueue({ t:'scroll', cat }); return goHome(); }
      const el = document.getElementById(`row-${slugify(cat)}`);
      if (!el) return false;
      el.scrollIntoView({ behavior:'smooth', block:'start' });
      return true;
    },
    list(){
      // Read from storage so it works on any page
      try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return items.slice(); }
    }
  };
  window.NovaInsurance = api;

  // Optional: listen to custom events, e.g., from the bot UI
  // document.dispatchEvent(new CustomEvent('nova:recommend', { detail: { category: 'Travel', names: ['Lost Luggage'] } }))
  document.addEventListener('nova:recommend', (e)=>{
    const { category, names } = e.detail || {};
    if (category) api.scrollToCategory(category);
    if (Array.isArray(names)) names.forEach(n => api.addByName(n));
  });

  // If on home, process any queued actions created on other pages
  if (psEl){
    try{
      const q = JSON.parse(localStorage.getItem(Q_KEY)||'[]');
      if (Array.isArray(q) && q.length){
        // process sequentially
        q.forEach(act=>{
          if (!act || !act.t) return;
          if (act.t==='add' && act.name) api.addByName(act.name);
          if (act.t==='remove' && act.name) api.removeByName(act.name);
          if (act.t==='batch' && Array.isArray(act.names)) api.createPackage(act.names);
          if (act.t==='scroll' && act.cat) api.scrollToCategory(act.cat);
        });
        localStorage.removeItem(Q_KEY);
      }
    }catch{}
  }

  // Initial paint
  // First, render catalog if available, then sidebar state
  try { renderCatalog(); } catch{}
  if (psEl) render();
})();
