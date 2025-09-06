// Render policy selections on Policy and Checkout pages
(function(){
  const LS_KEY = 'policyItems:v1';
  const $ = (s, r=document) => r.querySelector(s);

  function loadPolicy(){
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
  }
  function money(n){ return `$${Number(n||0).toFixed(2)}`; }

  function renderInto(el){
    if (!el) return;
    const items = loadPolicy();
    if (!Array.isArray(items) || !items.length){
      el.innerHTML = '<p class="muted">No modules selected yet.</p>';
      return;
    }
    const lines = items.map(it => `
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin:6px 0">
        <div>
          <div style="font-weight:600">${it.name}</div>
          <div class="muted" style="font-size:12px">${it.cat}</div>
        </div>
        <div>${money(it.price)}</div>
      </div>
    `).join('');
    const total = items.reduce((a,b)=> a + Number(b.price||0), 0);
    el.innerHTML = lines + `
      <hr style="border:0;border-top:1px solid rgba(255,255,255,.12);margin:10px 0" />
      <div style="display:flex;justify-content:space-between"><strong>Total (monthly)</strong><strong>${money(total)}</strong></div>
    `;
  }

  function init(){
    renderInto($('#policySummary'));
    renderInto($('#checkoutSummary'));
  }

  // Re-render when storage changes (another tab) or after short delay when returning
  window.addEventListener('storage', (e)=>{ if (e.key===LS_KEY) init(); });
  document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) setTimeout(init, 50); });

  // Initial
  init();
})();
