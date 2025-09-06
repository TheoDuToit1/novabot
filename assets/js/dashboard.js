/*
    // Integrations modal open
    const btnInt = document.getElementById('btnIntegrations');
    if (btnInt){
      btnInt.addEventListener('click', ()=>{
        try{
          const overlay = document.getElementById('supModal');
          if (!overlay) return;
          // hydrate fields from current bot in case user edited form before opening
          const bot = currentForm();
          try{
            const s = bot.integrations?.supabase || {};
            const supUrl = document.getElementById('supUrl'); if (supUrl) supUrl.value = s.url||'';
            const supServiceKey = document.getElementById('supServiceKey'); if (supServiceKey) supServiceKey.value = s.serviceKey||'';
            const supAnonKey = document.getElementById('supAnonKey'); if (supAnonKey) supAnonKey.value = s.anonKey||'';
          }catch{}
          const status = document.getElementById('supStatus'); if (status) status.textContent = '';
          overlay.style.display = 'flex';
          overlay.setAttribute('aria-hidden','false');
        }catch{}
      });
    }
    // Integrations modal actions
    (function(){
      const overlay = document.getElementById('supModal');
      if (!overlay) return;
      const btnCancel = document.getElementById('supCancel');
      const btnSave = document.getElementById('supSave');
      const btnTest = document.getElementById('supTest');
      const status = document.getElementById('supStatus');
      const close = ()=>{ try{ overlay.style.display='none'; overlay.setAttribute('aria-hidden','true'); }catch{} };
      btnCancel?.addEventListener('click', close);
      // Save merges into current bot and persists
      btnSave?.addEventListener('click', async ()=>{
        try{
          const form = currentForm();
          // Save immediately (update or create)
          await saveBot();
          renderEmbed(form);
          close();
          try{ toast('Saved Supabase settings.'); }catch{}
        }catch(e){ console.error(e); try{ alert('Failed to save settings'); }catch{} }
      });
      // Test connection: ping /auth/v1/health, and if key present, try a lightweight authenticated call
      btnTest?.addEventListener('click', async ()=>{
        try{
          const url = document.getElementById('supUrl')?.value?.trim();
          const serviceKey = document.getElementById('supServiceKey')?.value?.trim();
          const anonKey = document.getElementById('supAnonKey')?.value?.trim();
          if (!url){ if (status) status.textContent = 'Enter a Supabase URL.'; return; }
          if (status){ status.textContent = 'Testing...'; }
          let ok = false; let authOk = null;
          // Health check (no auth required)
          try{
            const res = await fetch(url.replace(/\/$/,'') + '/auth/v1/health', { method:'GET' });
            ok = res.ok;
          }catch{}
          // Auth check using provided key if any
          const key = serviceKey || anonKey || '';
          if (key){
            try{
              const res2 = await fetch(url.replace(/\/$/,'') + '/rest/v1/', {
                method:'GET',
                headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
              });
            // List tables/columns via pg_meta (service key required)
            btnList?.addEventListener('click', async ()=>{
              const statusEl = document.getElementById('supStatus');
              const out = document.getElementById('supMeta');
              const set = (t)=>{ if (statusEl) statusEl.textContent = t; };
              const show = (t)=>{ if (out) out.textContent = t; };
              try{
                let url = document.getElementById('supUrl')?.value?.trim()||'';
                let key = document.getElementById('supServiceKey')?.value?.trim()||'';
                if (!url){ set('Enter a Supabase URL.'); return; }
                if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
                try{ const u = new URL(url); url = u.origin; }catch{ set('Invalid URL.'); return; }
                if (!key){ set('Service role key required for pg_meta.'); return; }
                set('Listing tables...'); show('Loading...');
                const base = url.replace(/\/$/,'');
                const headers = { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Accept-Profile': 'pg_meta' };
        // Backend fallback (no SQL on Supabase needed): uses NovaBot backend to introspect 'public'
        const backendList = async ()=>{
          const apiBase = (window.NOVABOT_API_BASE || '').replace(/\/$/, '');
          const adminKey = window.NOVABOT_ADMIN_KEY || '';
          if (!apiBase || !adminKey) throw new Error('Backend base or admin key missing');
          const url = apiBase + '/v1/introspect/public';
          console.log('[backend] GET introspect/public:', url);
          const res = await fetch(url, { headers: { 'x-admin-key': adminKey }});
          if (!res.ok){ let txt=''; try{ txt = await res.text(); }catch{} throw new Error(`Backend introspect failed (${res.status}). ${txt||''}`); }
          const data = await res.json();
          const rows = Array.isArray(data?.rows) ? data.rows : [];
          const tableSet = new Map();
          rows.forEach(r=>{ const k = `${r.schema}.${r.table}`; if (!tableSet.has(k)) tableSet.set(k, { schema: r.schema, name: r.table }); });
          const tables = Array.from(tableSet.values());
          const cols = rows.map(r=>({ schema: r.schema, table: r.table, name: r.column, format: r.data_type, is_nullable: (r.is_nullable===true || r.is_nullable==='YES' || r.is_nullable==='YES'), position: r.position }));
          return { tables, cols };
        };
                console.log('[pg_meta] base:', base);
                // Try public schema first
                let tUrl = base + '/rest/v1/tables?select=schema,name&schema=eq.public';
                let cUrl = base + '/rest/v1/columns?select=schema,table,name,format,is_nullable,position&schema=eq.public';
                console.log('[pg_meta] GET tables (public):', tUrl);
                let tRes = await fetch(tUrl, { headers });
                console.log('[pg_meta] tables(public) status:', tRes.status);
                if (!tRes.ok){
                  try{ const txt = await tRes.text(); console.warn('[pg_meta] tables(public) body:', txt); }catch{}
                  set(`Failed to fetch tables (${tRes.status})`); show(''); return;
                }
                let tables = await tRes.json();
                console.log('[pg_meta] tables(public) count:', Array.isArray(tables)?tables.length:'n/a');
                console.log('[pg_meta] GET columns (public):', cUrl);
                let cRes = await fetch(cUrl, { headers });
                console.log('[pg_meta] columns(public) status:', cRes.status);
                if (!cRes.ok){ try{ const txt = await cRes.text(); console.warn('[pg_meta] columns(public) body:', txt); }catch{} set(`Fetched tables, but failed to fetch columns (${cRes.status})`); }
                let cols = cRes.ok ? await cRes.json() : [];
                if (Array.isArray(cols)) console.log('[pg_meta] columns(public) count:', cols.length);
                // If no tables in public, retry without schema filter (list all schemas)
                if (Array.isArray(tables) && tables.length === 0){
                  set('No tables in public. Checking all schemas...');
                  tUrl = base + '/rest/v1/tables?select=schema,name';
                  cUrl = base + '/rest/v1/columns?select=schema,table,name,format,is_nullable,position';
                  console.log('[pg_meta] GET tables (all):', tUrl);
                  tRes = await fetch(tUrl, { headers });
                  console.log('[pg_meta] tables(all) status:', tRes.status);
                  if (tRes.ok){ tables = await tRes.json(); console.log('[pg_meta] tables(all) count:', Array.isArray(tables)?tables.length:'n/a'); }
                  console.log('[pg_meta] GET columns (all):', cUrl);
                  cRes = await fetch(cUrl, { headers });
                  console.log('[pg_meta] columns(all) status:', cRes.status);
                  if (cRes.ok){ cols = await cRes.json(); if (Array.isArray(cols)) console.log('[pg_meta] columns(all) count:', cols.length); }
                }
                // Group columns by table
                const byTable = {};
                cols.forEach(col=>{ const key = `${col.schema||'public'}.${col.table||col.table_name||'unknown'}`; (byTable[key] ||= []).push(col); });
                // Render compact text
                let buf = '';
                tables.forEach(t=>{
                  const tname = t.name || t.table || t.table_name;
                  const schema = t.schema || 'public';
                  const fq = `${schema}.${tname}`;
                  buf += `Table: ${fq}\n`;
                  const list = byTable[fq]||[];
                  list.sort((a,b)=> (a.position||a.ordinal_position||0) - (b.position||b.ordinal_position||0));
                  list.forEach(c=>{
                    const cname = c.name || c.column_name;
                    const typ = c.data_type || c.format || 'unknown';
                    const nul = (c.is_nullable===true || c.is_nullable==='YES') ? 'NULL' : 'NOT NULL';
                    buf += `  - ${cname} ${typ} ${nul}\n`;
                  });
                  if (!list.length) buf += '  (no columns found)\n';
                  buf += '\n';
                });
                if (!tables.length) {
                  buf = 'No tables found. If you used an anon key, pg_meta is restricted. Use the service_role key or create tables first.';
                  console.warn('[pg_meta] No tables returned. Check project URL, service key, and pg_meta exposure.');
                }
                show(buf);
                set('Listed tables.');
              }catch(e){ console.error(e); set('List failed: ' + (e?.message||'Unknown error')); }
            });
              authOk = res2.ok;
            }catch{ authOk = false; }
          }
          if (status){
            if (ok && (authOk===true || authOk===null)) status.textContent = 'Connection looks good.';
            else if (ok && authOk===false) status.textContent = 'Server reachable but API key may be invalid or lacks permissions.';
            else status.textContent = 'Could not reach Supabase. Check URL.';
          }
        }catch(e){ console.error(e); if (status) status.textContent = 'Test failed.'; }
      });
    })();
*/
(function(){
  const KEY = 'nova_bots_v1';
  const API_BASE = (window.NOVABOT_API_BASE || 'http://localhost:5050');
  const ADMIN_KEY = (window.NOVABOT_ADMIN_KEY || 'dev-admin-key');
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  // UI helpers for live preview and filters
  function setSwatch(id, val){ try{ const sw = $(id); if (sw) sw.style.background = val; }catch{}}
  function setText(id, val){ try{ const el = $(id); if (el) el.textContent = val; }catch{}}
  function updateMiniPreview(){
    try{
      const name = $('#fName')?.value || 'NovaBot';
      const avatar = $('#fAvatar')?.value || 'N';
      const primary = $('#fPrimary')?.value || '#60a5fa';
      const accent = $('#fAccent')?.value || '#6ee7b7';
      const headerBg = $('#fHeaderBg')?.value || '#111827';
      const headerText = $('#fHeaderText')?.value || '#ffffff';
      const bubbleBot = $('#fBubbleBot')?.value || '#1f2937';
      const bubbleUser = $('#fBubbleUser')?.value || '#2563eb';
      const panelBg = $('#fPanelBg')?.value || '#0b0f1a';
      const radius = parseInt($('#fRadius')?.value||'14',10) || 14;

      const lp = $('#livePreview');
      const lpHead = $('#lpHead');
      const lpAvatar = $('#lpAvatar');
      const lpTitle = $('#lpTitle');
      const lpBody = $('#lpBody');
      const lpBotBubble = $('#lpBotBubble');
      const lpUserBubble = $('#lpUserBubble');
      if (!lp) return;

      // Container and header styles
      lp.style.borderRadius = radius + 'px';
      lp.style.background = panelBg;
      lp.style.borderColor = 'rgba(255,255,255,.08)';
      lpHead.style.background = headerBg;
      lpHead.style.color = headerText;
      lpTitle.textContent = name || 'NovaBot';

      // Avatar
      lpAvatar.style.borderRadius = '50%';
      lpAvatar.style.background = 'rgba(255,255,255,.1)';
      if (/^https?:\/\//i.test(avatar)){
        lpAvatar.style.backgroundImage = `url(${avatar})`;
        lpAvatar.style.backgroundSize = 'cover';
        lpAvatar.style.backgroundPosition = 'center';
        lpAvatar.textContent = '';
      } else {
        lpAvatar.style.backgroundImage = 'none';
        lpAvatar.textContent = (avatar || 'N').slice(0,2);
      }

      // Bubbles
      lpBotBubble.style.background = bubbleBot;
      lpBotBubble.style.color = '#e8ecf1';
      lpBotBubble.style.borderRadius = Math.max(10, radius - 2) + 'px';
      lpUserBubble.style.background = primary;
      lpUserBubble.style.color = '#061225';
      lpUserBubble.style.borderRadius = Math.max(10, radius - 2) + 'px';

      // Update swatches and code labels
      setSwatch('#swPrimary', primary); setText('#valPrimary', primary);
      setSwatch('#swAccent', accent); setText('#valAccent', accent);
      setSwatch('#swHeaderBg', headerBg); setText('#valHeaderBg', headerBg);
      setSwatch('#swHeaderText', headerText); setText('#valHeaderText', headerText);
      setSwatch('#swBubbleBot', bubbleBot); setText('#valBubbleBot', bubbleBot);
      setSwatch('#swBubbleUser', bubbleUser); setText('#valBubbleUser', bubbleUser);
      setSwatch('#swPanelBg', panelBg); setText('#valPanelBg', panelBg);
    }catch{}
  }
  // Delete confirmation modal (hoisted to top-level)
  function openDeleteModal(bot, onConfirm){
    try{
      const overlay = document.getElementById('delModal');
      if (!overlay){
        if (confirm(`Delete ${bot?.name||'this bot'}?`)) onConfirm?.();
        return;
      }
      const nameEl = document.getElementById('delBotName');
      if (nameEl) nameEl.textContent = bot?.name || 'this bot';
      overlay.style.display = 'flex';
      overlay.setAttribute('aria-hidden','false');
      const btnCancel = document.getElementById('delCancel');
      const btnConfirm = document.getElementById('delConfirm');
      const cleanup = ()=>{
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden','true');
        btnCancel?.removeEventListener('click', onCancel);
        btnConfirm?.removeEventListener('click', onOk);
      };
      const onCancel = ()=> cleanup();
      const onOk = async ()=>{ try{ await onConfirm?.(); } finally { cleanup(); } };
      btnCancel?.addEventListener('click', onCancel, { once:true });
      btnConfirm?.addEventListener('click', onOk, { once:true });
    }catch{}
  }
  // Legacy local loader (fallback only)
  const loadLocal = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const ACTIVE_KEY = 'nova_active_bot_id';
  const loadActiveId = () => { try { return localStorage.getItem(ACTIVE_KEY)||''; } catch { return ''; } };
  const saveActiveId = (id) => { try { localStorage.setItem(ACTIVE_KEY, id||''); } catch {} };
  const saveLocal = (bots) => localStorage.setItem(KEY, JSON.stringify(bots||[]));
  let botsCache = [];
  let currentEditingId = '';
  const COLLAPSE_KEY = 'nova_dash_collapse_v1';
  function loadCollapseMap(){ try{ return JSON.parse(localStorage.getItem(COLLAPSE_KEY)||'{}'); }catch{ return {}; } }
  function saveCollapseMap(m){ try{ localStorage.setItem(COLLAPSE_KEY, JSON.stringify(m||{})); }catch{} }

  function initCollapsibles(){
    const map = loadCollapseMap();
    $$('.panel.stack').forEach((panel, idx)=>{
      // Skip the top-level editor pane so its #editorOverlay remains a direct child
      if (panel.id === 'editorPane') return;
      if (panel.__collapsibleInit) return;
      panel.__collapsibleInit = true;
      panel.classList.add('collapsible');
      // Use existing head if present (so we don't duplicate and we preserve custom buttons)
      let head = panel.querySelector(':scope > .collapsible-head');
      let titleEl = head ? head.querySelector('h3, strong') : panel.querySelector('h3, strong');
      if (!titleEl){ return; }
      if (!head){
        head = document.createElement('div');
        head.className = 'collapsible-head';
        // Move title into head (keep semantics)
        head.appendChild(titleEl);
        // Insert head at top
        panel.insertBefore(head, panel.firstChild);
      }
      // Build body wrapper with the rest (except head)
      const body = document.createElement('div');
      body.className = 'collapsible-body';
      // Gather siblings after head and move into body
      let n = head.nextSibling;
      const toMove = [];
      while(n){ const next = n.nextSibling; toMove.push(n); n = next; }
      toMove.forEach(x=> body.appendChild(x));
      panel.appendChild(body);

      // Toggle button
      let btn = head.querySelector(':scope > .collapse-btn');
      if (!btn){
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'collapse-btn';
        btn.setAttribute('aria-label', 'Toggle section');
        btn.innerHTML = '<span class="chev">▾</span>';
        head.appendChild(btn);
      }

      // Key for persistence
      const key = (titleEl.textContent || 'section_'+idx).trim().toLowerCase();
      panel.setAttribute('data-collapsible-key', key);

      // Prepare height for animation
      const setExpanded = (yes)=>{
        if (yes){
          panel.classList.remove('is-collapsed');
          body.style.maxHeight = body.scrollHeight + 'px';
          body.style.opacity = '1';
          btn.setAttribute('aria-expanded','true');
        } else {
          panel.classList.add('is-collapsed');
          body.style.maxHeight = '0px';
          body.style.opacity = '0';
          btn.setAttribute('aria-expanded','false');
        }
      };
      // Initial state
      const collapsed = map[key] === true || map[key] === 'true';
      setExpanded(!collapsed);
      // Recompute height on resize
      window.addEventListener('resize', ()=>{ if (!panel.classList.contains('is-collapsed')) body.style.maxHeight = body.scrollHeight + 'px'; });
      // Toggle on click
      btn.addEventListener('click', ()=>{
        const nowCollapsed = !panel.classList.contains('is-collapsed');
        setExpanded(nowCollapsed ? false : true);
        const m = loadCollapseMap(); m[key] = nowCollapsed; saveCollapseMap(m);
      });
    });
  }
  function updateEditorDisabled(){
    try{
      const pane = document.getElementById('editorPane');
      if (!pane) return;
      if (currentEditingId) pane.classList.remove('disabled');
      else pane.classList.add('disabled');
    }catch{}
  }
  // Theme presets
  const THEME_PRESETS = {
    blue:      { primary:'#60a5fa', accent:'#6ee7b7', headerBg:'#111827', headerText:'#ffffff', bubbleBot:'#1f2937', bubbleUser:'#2563eb', panelBg:'#0b0f1a', radius:14 },
    purple:    { primary:'#a78bfa', accent:'#f0abfc', headerBg:'#211833', headerText:'#ffffff', bubbleBot:'#2a1f3d', bubbleUser:'#7c3aed', panelBg:'#0d0a12', radius:16 },
    green:     { primary:'#34d399', accent:'#86efac', headerBg:'#0e2019', headerText:'#eafff5', bubbleBot:'#123227', bubbleUser:'#059669', panelBg:'#071a14', radius:14 },
    sunset:    { primary:'#fb923c', accent:'#facc15', headerBg:'#2a1410', headerText:'#fff3e6', bubbleBot:'#3b241c', bubbleUser:'#ea580c', panelBg:'#140b08', radius:14 },
    charcoal:  { primary:'#94a3b8', accent:'#cbd5e1', headerBg:'#0f172a', headerText:'#e2e8f0', bubbleBot:'#111827', bubbleUser:'#334155', panelBg:'#0b1220', radius:14 },
  };
  const USER_PRESETS_KEY = 'nova_user_presets_v1';
  const BOT_PRESET_MAP_KEY = 'nova_bot_preset_map_v1';
  function loadUserPresets(){ try { return JSON.parse(localStorage.getItem(USER_PRESETS_KEY)||'[]'); } catch { return []; } }
  function saveUserPresets(list){ try { localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(list||[])); } catch {} }
  function loadBotPresetMap(){ try { return JSON.parse(localStorage.getItem(BOT_PRESET_MAP_KEY)||'{}'); } catch { return {}; } }
  function saveBotPresetMap(map){ try { localStorage.setItem(BOT_PRESET_MAP_KEY, JSON.stringify(map||{})); } catch {} }
  function getAllPresets(){
    const user = loadUserPresets();
    const dict = { ...THEME_PRESETS };
    user.forEach(p=>{ dict['user:'+p.id] = p.values; });
    return dict;
  }
  function applyPreset(name){
    const p = getAllPresets()[name]; if (!p) return;
    if ($('#fPrimary')) $('#fPrimary').value = p.primary;
    if ($('#fAccent')) $('#fAccent').value = p.accent;
    if ($('#fHeaderBg')) $('#fHeaderBg').value = p.headerBg;
    if ($('#fHeaderText')) $('#fHeaderText').value = p.headerText;
    if ($('#fBubbleBot')) $('#fBubbleBot').value = p.bubbleBot;
    if ($('#fBubbleUser')) $('#fBubbleUser').value = p.bubbleUser;
    if ($('#fPanelBg')) $('#fPanelBg').value = p.panelBg;
    if ($('#fRadius')) $('#fRadius').value = p.radius;
  }
  function getThemeVals(){
    return {
      primary: $('#fPrimary')?.value||'', accent: $('#fAccent')?.value||'', headerBg: $('#fHeaderBg')?.value||'', headerText: $('#fHeaderText')?.value||'',
      bubbleBot: $('#fBubbleBot')?.value||'', bubbleUser: $('#fBubbleUser')?.value||'', panelBg: $('#fPanelBg')?.value||'', radius: parseInt($('#fRadius')?.value||'14',10)||14
    };
  }
  function detectPreset(){
    const cur = getThemeVals();
    const all = getAllPresets();
    for (const [k, v] of Object.entries(all)){
      let match = true;
      for (const key of Object.keys(v)){
        if (String(cur[key]).toLowerCase() !== String(v[key]).toLowerCase()) { match = false; break; }
      }
      if (match) return k;
    }
    return 'custom';
  }
  function ensurePresetOptions(){
    const sel = $('#themePreset'); if (!sel) return;
    // remove existing user: options
    $$('option', sel).forEach(opt=>{ if (opt.value.startsWith('user:')) opt.remove(); });
    // append user presets
    const user = loadUserPresets();
    user.forEach(p=>{
      const opt = document.createElement('option');
      opt.value = 'user:'+p.id;
      opt.textContent = p.name + ' (Custom)';
      sel.appendChild(opt);
    });
  }
  function renderPresetGallery(){
    const el = $('#presetGallery'); if (!el) return;
    const order = ['blue','purple','green','sunset','charcoal'];
    const user = loadUserPresets();
    const itemHtml = (key, name, v, removable=false)=>{
      const hdr = v.headerBg; const btxt = v.headerText; const bot = v.bubbleBot; const userb = v.primary;
      return `<button class="preset-tile" data-key="${key}" title="${name}" style="display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:#0b0f1a;">
        <div style="height:22px;border-radius:8px;background:${hdr};color:${btxt};display:flex;align-items:center;justify-content:center;font-size:10px;">${name}</div>
        <div style="display:flex;gap:6px;align-items:flex-end;">
          <div style="flex:1;height:24px;border-radius:10px;background:${bot};"></div>
          <div style="flex:1;height:20px;border-radius:10px;background:${userb};"></div>
        </div>
      </button>`;
    };
    const builtin = order.map(k=> itemHtml(k, k.charAt(0).toUpperCase()+k.slice(1), THEME_PRESETS[k]) ).join('');
    const customs = user.map(p=> itemHtml('user:'+p.id, p.name, p.values, true)).join('');
    el.innerHTML = builtin + customs;
  }

  // Backend API helpers
  async function apiListBots(){
    const res = await fetch(`${API_BASE}/v1/bots`, { headers: { 'x-admin-key': ADMIN_KEY } });
    if (!res.ok) throw new Error('Failed to list bots');
    const data = await res.json();
    return data.bots || [];
  }
  async function apiCreateBot(bot){
    const res = await fetch(`${API_BASE}/v1/bots`, { 
      method:'POST', 
      headers: { 
        'x-admin-key': ADMIN_KEY, 
        'content-type':'application/json' 
      }, 
      body: JSON.stringify(bot) 
    });
    if (!res.ok) throw new Error('Failed to create bot');
    const data = await res.json();
    return data.bot;
  }
  async function apiUpdateBot(id, bot){
    const res = await fetch(`${API_BASE}/v1/bots/${encodeURIComponent(id)}`, { 
      method:'PUT', 
      headers: { 
        'x-admin-key': ADMIN_KEY, 
        'content-type':'application/json' 
      }, 
      body: JSON.stringify(bot) 
    });
    if (!res.ok) throw new Error('Failed to update bot');
    const data = await res.json();
    return data.bot;
  }
  async function apiDeleteBot(id){
    const res = await fetch(`${API_BASE}/v1/bots/${encodeURIComponent(id)}`, { method:'DELETE', headers: { 'x-admin-key': ADMIN_KEY } });
    if (!res.ok) throw new Error('Failed to delete bot');
    return true;
  }

  function genKey(){
    // simple key: 4-4-4-4-12
    const seg = (n)=> Array.from(crypto.getRandomValues(new Uint8Array(n))).map(b=>('0'+b.toString(16)).slice(-2)).join('').slice(0,n);
    return `${seg(4)}-${seg(4)}-${seg(4)}-${seg(4)}-${seg(12)}`.toUpperCase();
  }

  function currentForm(){
    return {
      id: ($('#fKey').dataset.id)||'',
      name: $('#fName').value.trim(),
      origin: $('#fOrigin').value.trim(),
      apiKey: $('#fKey').value.trim(),
      widget: {
        position: $('#fPos').value,
        primary: $('#fPrimary').value,
        accent: $('#fAccent').value,
        headerBg: $('#fHeaderBg')?.value || '',
        headerText: $('#fHeaderText')?.value || '',
        bubbleBot: $('#fBubbleBot')?.value || '',
        bubbleUser: $('#fBubbleUser')?.value || '',
        panelBg: $('#fPanelBg')?.value || '',
        radius: parseInt($('#fRadius')?.value||'14',10) || 14,
        avatar: $('#fAvatar').value.trim()
      },
      features: {
        promos: $('#featPromos').checked,
        upsell: $('#featUpsell').checked,
        recommendations: $('#featReco').checked,
        voiceInput: $('#featVoiceInput').checked,
        voiceOutput: $('#featVoiceOutput').checked,
        smallTalk: $('#featSmallTalk').checked
      },
      integrations: {
        supabase: (function(){
          try{
            const url = document.getElementById('supUrl')?.value?.trim()||'';
            const serviceKey = document.getElementById('supServiceKey')?.value?.trim()||'';
            const anonKey = document.getElementById('supAnonKey')?.value?.trim()||'';
            return { url, serviceKey, anonKey };
          } catch { return { url:'', serviceKey:'', anonKey:'' }; }
        })()
      },
      firstMessage: ($('#fFirstMsg')?.value||'').trim(),
      knowledgeBase: ($('#fKB')?.value||'').trim(),
      fallbackMessage: ($('#fFallback')?.value||'').trim(),
      products: getProductsFromUI()
    };
  }

  function setForm(bot){
    currentEditingId = bot.id || '';
    $('#fKey').dataset.id = bot.id||'';
    $('#fName').value = bot.name||'';
    $('#fOrigin').value = bot.origin||'';
    $('#fKey').value = bot.apiKey||'';
    $('#fPos').value = bot.widget?.position||'bottom-right';
    $('#fPrimary').value = bot.widget?.primary||'#60a5fa';
    $('#fAccent').value = bot.widget?.accent||'#6ee7b7';
    if ($('#fHeaderBg')) $('#fHeaderBg').value = bot.widget?.headerBg || '#111827';
    if ($('#fHeaderText')) $('#fHeaderText').value = bot.widget?.headerText || '#ffffff';
    if ($('#fBubbleBot')) $('#fBubbleBot').value = bot.widget?.bubbleBot || '#1f2937';
    if ($('#fBubbleUser')) $('#fBubbleUser').value = bot.widget?.bubbleUser || '#2563eb';
    if ($('#fPanelBg')) $('#fPanelBg').value = bot.widget?.panelBg || '#0b0f1a';
    if ($('#fRadius')) $('#fRadius').value = bot.widget?.radius || 14;
    $('#fAvatar').value = bot.widget?.avatar||'';
    $('#featPromos').checked = !!bot.features?.promos;
    $('#featUpsell').checked = !!bot.features?.upsell;
    $('#featReco').checked = !!bot.features?.recommendations;
    // Back-compat: if legacy 'voice' exists and new flags are missing, mirror into both
    (function(){
      try{
        const f = bot.features||{};
        const hasLegacy = Object.prototype.hasOwnProperty.call(f, 'voice');
        const inVal = Object.prototype.hasOwnProperty.call(f, 'voiceInput') ? !!f.voiceInput : (hasLegacy ? !!f.voice : false);
        const outVal = Object.prototype.hasOwnProperty.call(f, 'voiceOutput') ? !!f.voiceOutput : (hasLegacy ? !!f.voice : false);
        const vin = document.getElementById('featVoiceInput'); if (vin) vin.checked = inVal;
        const vout = document.getElementById('featVoiceOutput'); if (vout) vout.checked = outVal;
      } catch{}
    })();
    $('#featSmallTalk').checked = bot.features?.smallTalk!==false;
    if ($('#fFirstMsg')) $('#fFirstMsg').value = bot.firstMessage || '';
    if ($('#fKB')) $('#fKB').value = bot.knowledgeBase || '';
    if ($('#fFallback')) $('#fFallback').value = bot.fallbackMessage || '';
    // Products UI
    try{ renderProductsList(Array.isArray(bot.products)?bot.products:[]); }catch{}
    // Integrations: Supabase
    try{
      const s = bot.integrations?.supabase || {};
      const supUrl = document.getElementById('supUrl'); if (supUrl) supUrl.value = s.url||'';
      const supServiceKey = document.getElementById('supServiceKey'); if (supServiceKey) supServiceKey.value = s.serviceKey||'';
      const supAnonKey = document.getElementById('supAnonKey'); if (supAnonKey) supAnonKey.value = s.anonKey||'';
    } catch{}
    renderEmbed(bot);
    updateMiniPreview();
    // Preset selector: use persisted map if available, else detect
    try {
      ensurePresetOptions(); renderPresetGallery();
      const map = loadBotPresetMap();
      const sel = $('#themePreset');
      let preset = map[currentEditingId] || detectPreset();
      // if preset key is user:* but missing, fallback to detect
      const all = getAllPresets();
      if (preset && preset!=='custom' && !all[preset]) preset = detectPreset();
      if (sel) sel.value = preset;
      if (preset && preset!=='custom') applyPreset(preset);
    } catch{}
    // Update initial swatches/labels from the newly set form
    try{
      setSwatch('#swPrimary', $('#fPrimary')?.value||''); setText('#valPrimary', $('#fPrimary')?.value||'');
      setSwatch('#swAccent', $('#fAccent')?.value||''); setText('#valAccent', $('#fAccent')?.value||'');
      setSwatch('#swHeaderBg', $('#fHeaderBg')?.value||''); setText('#valHeaderBg', $('#fHeaderBg')?.value||'');
      setSwatch('#swHeaderText', $('#fHeaderText')?.value||''); setText('#valHeaderText', $('#fHeaderText')?.value||'');
      setSwatch('#swBubbleBot', $('#fBubbleBot')?.value||''); setText('#valBubbleBot', $('#fBubbleBot')?.value||'');
      setSwatch('#swBubbleUser', $('#fBubbleUser')?.value||''); setText('#valBubbleUser', $('#fBubbleUser')?.value||'');
      setSwatch('#swPanelBg', $('#fPanelBg')?.value||''); setText('#valPanelBg', $('#fPanelBg')?.value||'');
    }catch{}
    // Toggle disabled overlay state after form is populated
    updateEditorDisabled();
  }

  function blankForm(){
    setForm({ id:'', name:'', origin:'', apiKey:'', widget:{ position:'bottom-right', primary:'#60a5fa', accent:'#6ee7b7', avatar:'' }, features:{ promos:true, upsell:true, recommendations:true, voiceInput:false, voiceOutput:false, smallTalk:true } });
  }

  function filteredAndSorted(bots){
    const q = ($('#botSearch')?.value||'').toLowerCase();
    const sort = $('#botSort')?.value || 'active';
    const activeId = loadActiveId();
    let arr = bots.filter(b=>{
      if (!q) return true;
      return String(b.name||'').toLowerCase().includes(q) || String(b.origin||'').toLowerCase().includes(q);
    });
    if (sort==='name-asc') arr.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
    else if (sort==='name-desc') arr.sort((a,b)=>String(b.name||'').localeCompare(String(a.name||'')));
    else if (sort==='active') arr.sort((a,b)=> (b.id===activeId) - (a.id===activeId) || String(a.name||'').localeCompare(String(b.name||'')) );
    return arr;
  }

  async function listBots(){
    try {
      const apiBots = await apiListBots();
      if (Array.isArray(apiBots) && apiBots.length){
        // Merge API bots with local to preserve client-only fields like knowledgeBase/fallbackMessage
        const local = loadLocal();
        const byId = new Map(local.map(b=>[b.id, b]));
        botsCache = apiBots.map(b=>{
          const l = byId.get(b.id) || {};
          const kb = (b.knowledgeBase && b.knowledgeBase.length) ? b.knowledgeBase : (l.knowledgeBase||'');
          const fb = (b.fallbackMessage && b.fallbackMessage.length) ? b.fallbackMessage : (l.fallbackMessage||'');
          const products = Array.isArray(b.products) ? b.products : (Array.isArray(l.products)? l.products : []);
          return { ...b, knowledgeBase: kb, fallbackMessage: fb, products };
        });
        saveLocal(botsCache);
      } else {
        // Do NOT overwrite local with empty remote result
        botsCache = loadLocal();
      }
    } catch {
      botsCache = loadLocal();
    }
    const activeId = loadActiveId();
    const el = $('#list');
    const bots = filteredAndSorted(botsCache);
    if (!bots.length){
      el.innerHTML = `
        <div class="item">
          <div class="muted">No bots found.</div>
          <div class="actions">
            <button class="Btn" data-act="create-new" title="Create a new bot">
              <svg viewBox="0 0 512 512" class="svgIcon" height="1em" aria-hidden="true"><path d="M256 112c13.3 0 24 10.7 24 24V232H376c13.3 0 24 10.7 24 24s-10.7 24-24 24H280V400c0 13.3-10.7 24-24 24s-24-10.7-24-24V280H136c-13.3 0-24-10.7-24-24s10.7-24 24-24h96V136c0-13.3 10.7-24 24-24z"></path></svg>
              <p class="text">Create bot</p>
              <span class="effect"></span>
            </button>
          </div>
        </div>`;
      return;
    }
    el.innerHTML = bots.map(b=>{
      const isActive = b.id === activeId;
      const badge = isActive ? ' <span class="badge active" title="Active">Active</span>' : '';
      const setBtn = isActive ? '' : `<button class="btn btn-primary" data-act="set-active" data-id="${b.id}">Set Active</button>`;
      return `<div class="item">
        <div class="head"><strong>${escapeHtml(b.name||'Untitled')}</strong>${badge}</div>
        <div class="mini">Origin: ${escapeHtml(b.origin||'-')}</div>
        <div class="mini">API Key: <span class="kbd">${escapeHtml((b.apiKey||'').slice(0,8))}…</span></div>
        <div class="actions">
          ${setBtn}
          <button class="editBtn" data-act="edit" data-id="${b.id}" title="Edit">
            <svg height="1em" viewBox="0 0 512 512">
              <path d="M410.3 231l11.3-11.3-33.9-33.9-62.1-62.1L291.7 89.8l-11.3 11.3-22.6 22.6L58.6 322.9c-10.4 10.4-18 23.3-22.2 37.4L1 480.7c-2.5 8.4-.2 17.5 6.1 23.7s15.3 8.5 23.7 6.1l120.3-35.4c14.1-4.2 27-11.8 37.4-22.2L387.7 253.7 410.3 231zM160 399.4l-9.1 22.7c-4 3.1-8.5 5.4-13.3 6.9L59.4 452l23-78.1c1.4-4.9 3.8-9.4 6.9-13.3l22.7-9.1v32c0 8.8 7.2 16 16 16h32zM362.7 18.7L348.3 33.2 325.7 55.8 314.3 67.1l33.9 33.9 62.1 62.1 33.9 33.9 11.3-11.3 22.6-22.6 14.5-14.5c25-25 25-65.5 0-90.5L453.3 18.7c-25-25-65.5-25-90.5 0zm-47.4 168l-144 144c-6.2 6.2-16.4 6.2-22.6 0s-6.2-16.4 0-22.6l144-144c6.2-6.2 16.4-6.2 22.6 0s6.2 16.4 0 22.6z"></path>
            </svg>
          </button>
          <button class="copy" data-act="copy-key" data-id="${b.id}" title="Copy API Key">
            <span class="tooltip" data-text-initial="Copy API Key" data-text-end="Copied!"></span>
            <span>
              <svg class="clipboard" xml:space="preserve" style="enable-background:new 0 0 512 512" viewBox="0 0 6.35 6.35" height="20" width="20" xmlns="http://www.w3.org/2000/svg">
                <g>
                  <path fill="currentColor" d="M2.43.265c-.3 0-.548.236-.573.53h-.328a.74.74 0 0 0-.735.734v3.822a.74.74 0 0 0 .735.734H4.82a.74.74 0 0 0 .735-.734V1.529a.74.74 0 0 0-.735-.735h-.328a.58.58 0 0 0-.573-.53zm0 .529h1.49c.032 0 .049.017.049.049v.431c0 .032-.017.049-.049.049H2.43c-.032 0-.05-.017-.05-.049V.843c0-.032.018-.05.05-.05zm-.901.53h.328c.026.292.274.528.573.528h1.49a.58.58 0 0 0 .573-.529h.328a.2.2 0 0 1 .206.206v3.822a.2.2 0 0 1-.206.205H1.53a.2.2 0 0 1-.206-.205V1.529a.2.2 0 0 1 .206-.206z"></path>
                </g>
              </svg>
              <svg class="checkmark" xml:space="preserve" style="enable-background:new 0 0 512 512" viewBox="0 0 24 24" height="18" width="18" xmlns="http://www.w3.org/2000/svg">
                <g>
                  <path fill="currentColor" d="M9.707 19.121a.997.997 0 0 1-1.414 0l-5.646-5.647a1.5 1.5 0 0 1 0-2.121l.707-.707a1.5 1.5 0 0 1 2.121 0L9 14.171l9.525-9.525a1.5 1.5 0 0 1 2.121 0l.707.707a1.5 1.5 0 0 1 0 2.121z"></path>
                </g>
              </svg>
            </span>
          </button>
          <button class="copy" data-act="copy-embed" data-id="${b.id}" title="Copy Embed Code">
            <span class="tooltip" data-text-initial="Copy Embed" data-text-end="Copied!"></span>
            <span>
              <svg class="clipboard" xml:space="preserve" style="enable-background:new 0 0 512 512" viewBox="0 0 6.35 6.35" height="20" width="20" xmlns="http://www.w3.org/2000/svg">
                <g>
                  <path fill="currentColor" d="M2.43.265c-.3 0-.548.236-.573.53h-.328a.74.74 0 0 0-.735.734v3.822a.74.74 0 0 0 .735.734H4.82a.74.74 0 0 0 .735-.734V1.529a.74.74 0 0 0-.735-.735h-.328a.58.58 0 0 0-.573-.53zm0 .529h1.49c.032 0 .049.017.049.049v.431c0 .032-.017.049-.049.049H2.43c-.032 0-.05-.017-.05-.049V.843c0-.032.018-.05.05-.05zm-.901.53h.328c.026.292.274.528.573.528h1.49a.58.58 0 0 0 .573-.529h.328a.2.2 0 0 1 .206.206v3.822a.2.2 0 0 1-.206.205H1.53a.2.2 0 0 1-.206-.205V1.529a.2.2 0 0 1 .206-.206z"></path>
                </g>
              </svg>
              <svg class="checkmark" xml:space="preserve" style="enable-background:new 0 0 512 512" viewBox="0 0 24 24" height="18" width="18" xmlns="http://www.w3.org/2000/svg">
                <g>
                  <path fill="currentColor" d="M9.707 19.121a.997.997 0 0 1-1.414 0l-5.646-5.647a1.5 1.5 0 0 1 0-2.121l.707-.707a1.5 1.5 0 0 1 2.121 0L9 14.171l9.525-9.525a1.5 1.5 0 0 1 2.121 0l.707.707a1.5 1.5 0 0 1 0 2.121z"></path>
                </g>
              </svg>
            </span>
          </button>
          <button class="bin-button" data-act="delete" data-id="${b.id}" title="Delete">
            <svg class="bin-top" viewBox="0 0 39 7" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line y1="5" x2="39" y2="5" stroke="white" stroke-width="4"></line>
              <line x1="12" y1="1.5" x2="26.0357" y2="1.5" stroke="white" stroke-width="3"></line>
            </svg>
            <svg class="bin-bottom" viewBox="0 0 33 39" fill="none" xmlns="http://www.w3.org/2000/svg">
              <mask id="path-1-inside-1_8_19" fill="white">
                <path d="M0 0H33V35C33 37.2091 31.2091 39 29 39H4C1.79086 39 0 37.2091 0 35V0Z"></path>
              </mask>
              <path d="M0 0H33H0ZM37 35C37 39.4183 33.4183 43 29 43H4C-0.418278 43 -4 39.4183 -4 35H4H29H37ZM4 43C-0.418278 43 -4 39.4183 -4 35V0H4V35V43ZM37 0V35C37 39.4183 33.4183 43 29 43V35V0H37Z" fill="white" mask="url(#path-1-inside-1_8_19)"></path>
              <path d="M12 6L12 29" stroke="white" stroke-width="4"></path>
              <path d="M21 6V29" stroke="white" stroke-width="4"></path>
            </svg>
          </button>
        </div>
      </div>`;
    }).join('');
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"]+/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]||c));
  }

  // Products helpers -------------------------------------------------------
  function renderProductsList(list){
    try{
      const wrap = document.getElementById('productsList'); if (!wrap) return;
      const items = Array.isArray(list) ? list : [];
      const row = (p, idx)=>{
        const img = escapeHtml(p.image||'');
        const title = escapeHtml(p.title||'');
        const desc = escapeHtml(p.description||'');
        const price = escapeHtml(p.price||'');
        return `<div class="prod-row item" data-idx="${idx}" style="display:grid; gap:8px; grid-template-columns: 1.2fr 1fr 2fr 0.7fr auto; align-items:end;">
  <label style="margin:0"><span>Image URL</span><input class="prod-image" type="url" placeholder="https://.../image.jpg" value="${img}"></label>
  <label style="margin:0"><span>Title</span><input class="prod-title" type="text" placeholder="e.g., Smartwatch X" value="${title}"></label>
  <label style="margin:0"><span>Description</span><input class="prod-desc" type="text" placeholder="Short description" value="${desc}"></label>
  <label style="margin:0"><span>Price</span><input class="prod-price" type="text" placeholder="99.00" value="${price}"></label>
  <div class="actions" style="justify-content:flex-start">
    <button type="button" class="btn" data-act="del-prod">Delete</button>
  </div>
</div>`;
      };
      wrap.innerHTML = items.map(row).join('');
    }catch{}
  }
  function getProductsFromUI(){
    const wrap = document.getElementById('productsList'); if (!wrap) return [];
    return Array.from(wrap.querySelectorAll('.prod-row')).map(r=>{
      return {
        image: r.querySelector('.prod-image')?.value?.trim()||'',
        title: r.querySelector('.prod-title')?.value?.trim()||'',
        description: r.querySelector('.prod-desc')?.value?.trim()||'',
        price: r.querySelector('.prod-price')?.value?.trim()||''
      };
    }).filter(p=> p.image || p.title || p.description || p.price);
  }
  function parseCSV(text){
    // Minimal CSV parser supporting quotes and commas
    const rows = [];
    let i=0, cur='', inQ=false, row=[];
    const pushCell = ()=>{ row.push(cur); cur=''; };
    const pushRow = ()=>{ rows.push(row); row=[]; };
    for (; i<text.length; i++){
      const ch = text[i];
      if (inQ){
        if (ch==='"'){
          if (text[i+1]==='"'){ cur+='"'; i++; }
          else { inQ=false; }
        } else cur+=ch;
      } else {
        if (ch==='"') inQ=true;
        else if (ch===',') pushCell();
        else if (ch==='\n'){ pushCell(); pushRow(); }
        else if (ch==='\r') {/* ignore */}
        else cur+=ch;
      }
    }
    // flush
    pushCell(); if (row.length>1 || row[0]!=='' ) pushRow();
    return rows.filter(r=> r.some(c=> String(c).trim().length));
  }
  function rowsToProducts(rows){
    if (!rows || !rows.length) return [];
    // Detect header
    const header = rows[0].map(x=> String(x).trim().toLowerCase());
    const hasHeader = ['image','title','description','price'].some(x=> header.includes(x));
    const start = hasHeader ? 1 : 0;
    const idx = {
      image: hasHeader ? header.indexOf('image') : 0,
      title: hasHeader ? header.indexOf('title') : 1,
      description: hasHeader ? header.indexOf('description') : 2,
      price: hasHeader ? header.indexOf('price') : 3
    };
    return rows.slice(start).map(r=>({
      image: (idx.image>=0 && r[idx.image]!=null) ? String(r[idx.image]).trim() : '',
      title: (idx.title>=0 && r[idx.title]!=null) ? String(r[idx.title]).trim() : '',
      description: (idx.description>=0 && r[idx.description]!=null) ? String(r[idx.description]).trim() : '',
      price: (idx.price>=0 && r[idx.price]!=null) ? String(r[idx.price]).trim() : ''
    })).filter(p=> p.image || p.title || p.description || p.price);
  }
  function toSheetsCsvUrl(url){
    try{
      const u = new URL(url);
      if (/^docs\.google\.com$/i.test(u.hostname) && u.pathname.includes('/spreadsheets/')){
        // try to extract id and gid
        const m = u.pathname.match(/\/d\/([^\/]+)/);
        const id = m ? m[1] : '';
        const gid = u.searchParams.get('gid') || '0';
        if (id) return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${encodeURIComponent(gid)}`;
      }
      return url; // return as-is
    }catch{ return url; }
  }

  function renderEmbed(bot){
    const cfg = {
      apiKey: bot.apiKey || 'YOUR_API_KEY',
      siteOrigin: bot.origin || 'https://example.com',
      widget: bot.widget||{},
      features: bot.features||{},
      integrations: bot.integrations||{},
      firstMessage: bot.firstMessage||'',
      knowledgeBase: bot.knowledgeBase||'',
      fallbackMessage: bot.fallbackMessage||'',
      products: Array.isArray(bot.products) ? bot.products : []
    };
    const snippet = `<!-- NovaBot Embed -->\n<script src="https://cdn.example.com/novabot@1/bot.js" data-api-key="${escapeHtml(cfg.apiKey)}" defer></script>\n<script>\nwindow.addEventListener('DOMContentLoaded', function(){\n  if (window.NovaBot && NovaBot.init){\n    NovaBot.init({\n      apiKey: '${escapeHtml(cfg.apiKey)}',\n      siteOrigin: '${escapeHtml(cfg.siteOrigin)}',\n      widget: ${JSON.stringify(cfg.widget)},\n      features: ${JSON.stringify(cfg.features)},\n      integrations: ${JSON.stringify(cfg.integrations)},\n      firstMessage: ${JSON.stringify(cfg.firstMessage)},\n      knowledgeBase: ${JSON.stringify(cfg.knowledgeBase)},\n      fallbackMessage: ${JSON.stringify(cfg.fallbackMessage)},\n      products: ${JSON.stringify(cfg.products)}\n     });\n  }\n});\n</script>`;
    $('#embedCode').textContent = snippet;
  }

  async function saveBot(){
    const form = currentForm();
    if (!form.name || !form.origin || !form.apiKey){ alert('Please fill name, origin, and API key.'); return; }
    try{
      let saved;
      if (form.id){ saved = await apiUpdateBot(form.id, form); }
      else { saved = await apiCreateBot(form); }
      // Backend may omit client-only fields: preserve from form
      const merged = { ...saved, knowledgeBase: form.knowledgeBase, fallbackMessage: form.fallbackMessage, products: Array.isArray(form.products)?form.products:[] };
      setForm(merged);
      // Persist locally too so list works even if backend returns empty later
      try{
        const local = loadLocal();
        const idx = local.findIndex(x=>x.id===merged.id);
        if (idx>=0) local[idx] = merged; else local.push(merged);
        saveLocal(local);
      } catch{}
      try { saveActiveId(merged.id); } catch {}
      // Clear search to avoid filtering out the new bot
      try { const s = $('#botSearch'); if (s) s.value = ''; } catch{}
      await listBots();
      try { toast('Saved bot.'); } catch { alert('Saved bot.'); }
    }catch(e){
      console.error(e);
      try { toast('Offline: saved locally.'); } catch { alert('Failed to save via backend. Saved locally.'); }
      // fallback local
      const bots = loadLocal();
      let id = form.id || Math.random().toString(36).slice(2);
      const bot = { ...form, id };
      const idx = bots.findIndex(x=>x.id===id);
      if (idx>=0) bots[idx] = bot; else bots.push(bot);
      saveLocal(bots);
      setForm(bot);
      try { saveActiveId(bot.id); } catch {}
      listBots();
    }
  }

  function copy(text){
    try{ navigator.clipboard.writeText(text); alert('Copied!'); }catch{ /* fallback */ const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); alert('Copied!'); }
  }

  function hookEvents(){
    $('#btnGen').addEventListener('click', ()=>{ $('#fKey').value = genKey(); });
    $('#btnSave').addEventListener('click', saveBot);
    function isPreviewActive(){
      return !!document.querySelector('#cbPreviewBadge');
    }
    function updateTogglePreviewUI(){
      const btn = $('#btnTogglePreview');
      if (!btn) return;
      const active = isPreviewActive();
      const label = active ? 'Close Preview' : 'Preview Widget';
      // If using the Uiverse Btn, update only the inner text node
      const txt = btn.querySelector('.text');
      if (txt) txt.textContent = label; else btn.textContent = label;
      btn.title = active ? 'Close preview and revert to active bot' : 'Preview the widget with current settings';
    }
    function toast(msg){
      try{
        let d = document.getElementById('dashToast');
        if (d) d.remove();
        d = document.createElement('div');
        d.id = 'dashToast';
        d.textContent = msg;
        d.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.15);z-index:99999;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.35)';
        document.body.appendChild(d);
        setTimeout(()=>{ d.style.transition='opacity .25s ease'; d.style.opacity='0'; setTimeout(()=>d.remove(), 300); }, 1200);
      } catch{}
    }
    function previewNow(){
      const cfg = currentForm();
      cfg.__preview = true;
      renderEmbed(cfg);
      try { window.dispatchEvent(new CustomEvent('nova:preview-bot', { detail: cfg })); } catch{}
      updateTogglePreviewUI();
    }
    $('#fName').addEventListener('input', ()=> { renderEmbed(currentForm()); previewNow(); updateMiniPreview(); });
    $('#fOrigin').addEventListener('input', ()=> { renderEmbed(currentForm()); });
    $('#fPos').addEventListener('change', ()=> { renderEmbed(currentForm()); previewNow(); updateMiniPreview(); });
    $('#fPrimary').addEventListener('input', ()=> { renderEmbed(currentForm()); previewNow(); updateMiniPreview(); });
    $('#fAccent').addEventListener('input', ()=> { renderEmbed(currentForm()); previewNow(); updateMiniPreview(); });
    $('#fAvatar').addEventListener('input', ()=> { renderEmbed(currentForm()); updateMiniPreview(); });
    // Extended theme inputs
    ;['#fHeaderBg','#fHeaderText','#fBubbleBot','#fBubbleUser','#fPanelBg','#fRadius','#fFirstMsg','#fPrimary','#fAccent','#fKB','#fFallback','#prodSheetsUrl'].forEach(sel=>{
      const el = $(sel); if (!el) return;
      el.addEventListener('input', ()=> { renderEmbed(currentForm()); previewNow(); updateMiniPreview(); markCustomIfNeeded(); });
      el.addEventListener('change', ()=> { renderEmbed(currentForm()); previewNow(); updateMiniPreview(); markCustomIfNeeded(); });
    });
    $$('#featPromos, #featUpsell, #featReco, #featVoiceInput, #featVoiceOutput, #featSmallTalk').forEach(el=>{
      el.addEventListener('change', ()=> { renderEmbed(currentForm()); previewNow(); });
    });
    // Theme preset change -> apply preset, persist mapping, re-render and preview
    const themeSel = $('#themePreset');
    if (themeSel){
      themeSel.addEventListener('change', ()=>{
        const val = themeSel.value;
        if (val && val !== 'custom'){
          applyPreset(val);
          renderEmbed(currentForm()); previewNow(); updateMiniPreview();
          const map = loadBotPresetMap(); if (currentEditingId) { map[currentEditingId] = val; saveBotPresetMap(map); }
        } else {
          const map = loadBotPresetMap(); if (currentEditingId) { map[currentEditingId] = 'custom'; saveBotPresetMap(map); }
        }
      });
    }
    function markCustomIfNeeded(){ try { const sel = $('#themePreset'); if (!sel) return; const v = detectPreset(); sel.value = v; const map = loadBotPresetMap(); if (currentEditingId) { map[currentEditingId] = v; saveBotPresetMap(map); } } catch{} }
    // Save-as-Preset
    const btnSavePreset = $('#btnSavePreset');
    if (btnSavePreset){
      btnSavePreset.addEventListener('click', ()=>{
        const name = prompt('Name for this preset?');
        if (!name) return;
        const values = getThemeVals();
        const list = loadUserPresets();
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
        list.push({ id, name: String(name).slice(0,40), values });
        saveUserPresets(list);
        ensurePresetOptions(); renderPresetGallery();
        const key = 'user:'+id; const sel = $('#themePreset'); if (sel){ sel.value = key; }
        const map = loadBotPresetMap(); if (currentEditingId) { map[currentEditingId] = key; saveBotPresetMap(map); }
        renderEmbed(currentForm()); previewNow(); updateMiniPreview();
      });
    }
    // Click in preset gallery
    const gal = $('#presetGallery');
    if (gal){
      gal.addEventListener('click', (e)=>{
        const btn = e.target.closest('.preset-tile'); if (!btn) return;
        const key = btn.getAttribute('data-key'); if (!key) return;
        const sel = $('#themePreset'); if (sel) sel.value = key;
        applyPreset(key);
        const map = loadBotPresetMap(); if (currentEditingId) { map[currentEditingId] = key; saveBotPresetMap(map); }
        renderEmbed(currentForm()); previewNow(); updateMiniPreview();
      });
    }
    $('#btnCopy').addEventListener('click', ()=> copy($('#embedCode').textContent));
    // Products: add/remove and imports
    const prodWrap = document.getElementById('productsList');
    const btnAdd = document.getElementById('btnAddProduct');
    if (btnAdd){
      btnAdd.addEventListener('click', ()=>{
        const cur = getProductsFromUI();
        cur.push({ image:'', title:'', description:'', price:'' });
        renderProductsList(cur);
        renderEmbed(currentForm());
      });
    }
    if (prodWrap){
      prodWrap.addEventListener('click', (e)=>{
        const btn = e.target.closest('[data-act="del-prod"]'); if (!btn) return;
        const row = btn.closest('.prod-row'); if (!row) return;
        row.remove();
        renderEmbed(currentForm());
      });
      prodWrap.addEventListener('input', (e)=>{
        if (e.target.matches('.prod-image, .prod-title, .prod-desc, .prod-price')){
          renderEmbed(currentForm());
        }
      });
    }
    const fileIn = document.getElementById('prodCsvFile');
    if (fileIn){
      fileIn.addEventListener('change', async ()=>{
        const f = fileIn.files && fileIn.files[0]; if (!f) return;
        try{
          const txt = await f.text();
          const rows = parseCSV(txt);
          const prods = rowsToProducts(rows);
          const cur = getProductsFromUI();
          renderProductsList(cur.concat(prods));
          renderEmbed(currentForm());
        }catch(e){ console.error(e); alert('Failed to parse CSV'); }
        fileIn.value = '';
      });
    }
    const btnImportSheets = document.getElementById('btnImportSheets');
    if (btnImportSheets){
      btnImportSheets.addEventListener('click', async ()=>{
        try{
          const urlRaw = document.getElementById('prodSheetsUrl')?.value?.trim();
          if (!urlRaw){ alert('Paste a Google Sheets or CSV URL'); return; }
          const url = toSheetsCsvUrl(urlRaw);
          const res = await fetch(url);
          if (!res.ok){ alert('Failed to fetch CSV'); return; }
          const txt = await res.text();
          const rows = parseCSV(txt);
          const prods = rowsToProducts(rows);
          const cur = getProductsFromUI();
          renderProductsList(cur.concat(prods));
          renderEmbed(currentForm());
        }catch(e){ console.error(e); alert('Import failed'); }
      });
    }
    // Toggle Preview button: open/close preview
    const btnToggle = $('#btnTogglePreview');
    if (btnToggle){
      btnToggle.addEventListener('click', ()=>{
        if (!isPreviewActive()){
          // Start preview and open widget
          previewNow();
          const t = document.querySelector('.chatbot-toggle');
          if (t) t.click();
        } else {
          // Close preview and restore active bot
          try {
            const panel = document.querySelector('.chatbot-panel');
            if (panel && panel.classList.contains('is-open')){
              const closeBtn = panel.querySelector('.chatbot-close');
              if (closeBtn) closeBtn.click();
            }
            const badge = document.querySelector('#cbPreviewBadge');
            if (badge) badge.remove();
            const bots = JSON.parse(localStorage.getItem('nova_bots_v1')||'[]');
            const activeId = localStorage.getItem('nova_active_bot_id')||'';
            const bot = bots.find(b=>b.id===activeId);
            if (bot){
              const restore = { ...bot, __preview:false };
              window.dispatchEvent(new CustomEvent('nova:preview-bot', { detail: restore }));
            }
            updateTogglePreviewUI();
            toast('Preview closed — restored active bot');
          } catch{}
        }
      });
    }
    // Bots list actions
    $('#list').addEventListener('click', async (e)=>{
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const id = btn.dataset.id; const act = btn.dataset.act;
      // Find from current rendered list cache (local fallback)
      const bots = botsCache.length ? botsCache : loadLocal();
      const bot = bots.find(x=>x.id===id);
      if (act==='set-active'){ saveActiveId(id); await listBots(); alert('Set active bot.'); return; }
      if (act==='create-new'){
        blankForm();
        try{ $('#fKey').value = genKey(); }catch{}
        // Enable editor for new bot
        try{ currentEditingId = 'new'; updateEditorDisabled(); }catch{}
        try{ $('#fKey').dataset.id=''; }catch{}
        try{ $('#fName')?.focus(); }catch{}
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (act==='edit'){ if (bot) setForm(bot); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      if (act==='copy-key'){ if (bot) copy(bot.apiKey); return; }
      if (act==='copy-embed'){ if (bot) { renderEmbed(bot); copy($('#embedCode').textContent); } return; }
      if (act==='delete'){
        return openDeleteModal(bot, async ()=>{
          try {
            // If deleting active, clear it
            try { if (loadActiveId() === id) saveActiveId(''); } catch{}
            await apiDeleteBot(id);
            blankForm();
            await listBots();
          }
          catch(e){
            // fallback local remove and ensure active cleared
            const rest = bots.filter(x=>x.id!==id);
            saveLocal(rest);
            try { if (loadActiveId() === id) saveActiveId(''); } catch{}
            blankForm();
            await listBots();
          }
        });
      }
    });

    // Search and sort controls
    const bs = $('#botSearch'); if (bs) bs.addEventListener('input', ()=> listBots());
    const bsort = $('#botSort'); if (bsort) bsort.addEventListener('change', ()=> listBots());
    // Integrations modal open
    const btnInt = document.getElementById('btnIntegrations');
    if (btnInt){
      btnInt.addEventListener('click', ()=>{
        try{
          const overlay = document.getElementById('supModal');
          if (!overlay) return;
          const bot = currentForm();
          try{
            const s = bot.integrations?.supabase || {};
            const supUrl = document.getElementById('supUrl'); if (supUrl) supUrl.value = s.url||'';
            const supServiceKey = document.getElementById('supServiceKey'); if (supServiceKey) supServiceKey.value = s.serviceKey||'';
            const supAnonKey = document.getElementById('supAnonKey'); if (supAnonKey) supAnonKey.value = s.anonKey||'';
          }catch{}
          const status = document.getElementById('supStatus'); if (status) status.textContent = '';
          overlay.style.display = 'flex';
          overlay.setAttribute('aria-hidden','false');

          // Lazily bind modal buttons once, now that the modal exists in DOM
          if (!overlay.__bound){
            overlay.__bound = true;
            const btnCancel = document.getElementById('supCancel');
            const btnSave = document.getElementById('supSave');
            const btnTest = document.getElementById('supTest');
            const btnList = document.getElementById('supList');
            const close = ()=>{ try{ overlay.style.display='none'; overlay.setAttribute('aria-hidden','true'); }catch{} };
            btnCancel?.addEventListener('click', close);
            btnSave?.addEventListener('click', async ()=>{
              try{
                await saveBot();
                close();
                try{ toast('Saved Supabase settings.'); }catch{}
              }catch(e){ console.error(e); try{ alert('Failed to save settings'); }catch{} }
            });
            btnTest?.addEventListener('click', async ()=>{
              const statusEl = document.getElementById('supStatus');
              const set = (t)=>{ if (statusEl) statusEl.textContent = t; };
              try{
                let url = document.getElementById('supUrl')?.value?.trim()||'';
                const serviceKey = document.getElementById('supServiceKey')?.value?.trim();
                const anonKey = document.getElementById('supAnonKey')?.value?.trim();
                if (!url){ set('Enter a Supabase URL. Example: https://YOUR-PROJECT.supabase.co'); return; }
                // Normalize URL (prepend https if missing)
                if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
                try{ const u = new URL(url); url = u.origin; }catch{ set('Invalid URL. Use https://YOUR-PROJECT.supabase.co'); return; }
                set('Testing...');
                let ok = false; let authOk = null; let healthStatus = 0; let authStatus = 0;
                const key = serviceKey || anonKey || '';
                // Health check (send auth headers if provided; treat 200/204/401/403 as reachable)
                try{
                  const res = await fetch(url.replace(/\/$/,'') + '/auth/v1/health', {
                    method:'GET',
                    headers: key ? { 'apikey': key, 'Authorization': 'Bearer ' + key } : undefined
                  });
                  healthStatus = res.status;
                  ok = res.ok || res.status === 401 || res.status === 403 || res.status === 204;
                }catch(err){ console.warn('Health check error', err); }
                // Auth check using provided key if any
                if (key){
                  try{
                    const res2 = await fetch(url.replace(/\/$/,'') + '/rest/v1/', {
                      method:'GET',
                      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
                    });
                    authStatus = res2.status;
                    authOk = res2.ok;
                  }catch(err){ console.warn('Auth check error', err); authOk = false; }
                }
                if (ok && (authOk===true || authOk===null)){
                  set('Connection looks good. ' + (healthStatus?`(health ${healthStatus})`:''));
                } else if (ok && authOk===false){
                  set(`Server reachable (health ${healthStatus}) but API key failed (status ${authStatus}). Check key/permissions (RLS).`);
                } else {
                  const loc = (location && location.protocol==='file:') ? ' You are viewing from file:// which may block requests; open via http://localhost instead.' : '';
                  set(`Could not reach Supabase (health status ${healthStatus||'n/a'}). Check URL, project availability, and CORS.${loc}`);
                }
              }catch(e){ console.error(e); set('Test failed: ' + (e?.message||'Unknown error')); }
            });
          }
        }catch{}
      });
    }
    // Fallback: also bind Supabase buttons even if modal wasn't opened via the Integrations button
    try{
      const overlay = document.getElementById('supModal');
      if (overlay && !overlay.__bound){
        const btnTest = document.getElementById('supTest');
        const btnList = document.getElementById('supList');
        const btnSave = document.getElementById('supSave');
        const btnCancel = document.getElementById('supCancel');
        const close = ()=>{ try{ overlay.style.display='none'; overlay.setAttribute('aria-hidden','true'); }catch{} };
        if (btnCancel && !btnCancel.__bound){ btnCancel.__bound = true; btnCancel.addEventListener('click', close); }
        if (btnSave && !btnSave.__bound){ btnSave.__bound = true; btnSave.addEventListener('click', async ()=>{ try{ await saveBot(); close(); }catch(e){ console.error(e); } }); }
        if (btnTest && !btnTest.__bound){
          btnTest.__bound = true;
          btnTest.addEventListener('click', async ()=>{
            const statusEl = document.getElementById('supStatus');
            const set = (t)=>{ if (statusEl) statusEl.textContent = t; };
            try{
              let url = document.getElementById('supUrl')?.value?.trim()||'';
              const serviceKey = document.getElementById('supServiceKey')?.value?.trim();
              const anonKey = document.getElementById('supAnonKey')?.value?.trim();
              if (!url){ set('Enter a Supabase URL. Example: https://YOUR-PROJECT.supabase.co'); return; }
              if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
              try{ const u = new URL(url); url = u.origin; }catch{ set('Invalid URL. Use https://YOUR-PROJECT.supabase.co'); return; }
              set('Testing...');
              let ok = false; let authOk = null; let healthStatus = 0; let authStatus = 0;
              const key = serviceKey || anonKey || '';
              try{
                const res = await fetch(url.replace(/\/$/,'') + '/auth/v1/health', { method:'GET', headers: key ? { 'apikey': key, 'Authorization': 'Bearer ' + key } : undefined });
                healthStatus = res.status;
                ok = res.ok || res.status === 401 || res.status === 403 || res.status === 204;
              }catch(err){ console.warn('Health check error', err); }
              if (key){
                try{
                  const res2 = await fetch(url.replace(/\/$/,'') + '/rest/v1/', { method:'GET', headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } });
                  authStatus = res2.status; authOk = res2.ok;
                }catch(err){ console.warn('Auth check error', err); authOk = false; }
              }
              if (ok && (authOk===true || authOk===null)) set('Connection looks good. ' + (healthStatus?`(health ${healthStatus})`:''));
              else if (ok && authOk===false) set(`Server reachable (health ${healthStatus}) but API key failed (status ${authStatus}). Check key/permissions (RLS).`);
              else set(`Could not reach Supabase (health status ${healthStatus||'n/a'}). Check URL, project availability, and CORS.`);
            }catch(e){ console.error(e); set('Test failed: ' + (e?.message||'Unknown error')); }
          });
        }
        if (btnList && !btnList.__bound){
          btnList.__bound = true;
          btnList.addEventListener('click', async ()=>{
            const statusEl = document.getElementById('supStatus');
            const out = document.getElementById('supMeta');
            const set = (t)=>{ if (statusEl) statusEl.textContent = t; };
            const show = (t)=>{ if (out) out.textContent = t; };
            try{
              let url = document.getElementById('supUrl')?.value?.trim()||'';
              let key = document.getElementById('supServiceKey')?.value?.trim()||'';
              if (!url){ set('Enter a Supabase URL.'); return; }
              if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
              try{ const u = new URL(url); url = u.origin; }catch{ set('Invalid URL.'); return; }
              if (!key){ set('Service role key required for pg_meta.'); return; }
              set('Listing tables...'); show('Loading...');
              const base = url.replace(/\/$/,'');
              const headers = { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Accept-Profile': 'pg_meta' };
              console.log('[pg_meta] base:', base);
              let tUrl = base + '/rest/v1/tables?select=schema,name&schema=eq.public';
              let cUrl = base + '/rest/v1/columns?select=schema,table,name,format,is_nullable,position&schema=eq.public';
              console.log('[pg_meta] GET tables (public):', tUrl);
              let tRes = await fetch(tUrl, { headers });
              console.log('[pg_meta] tables(public) status:', tRes.status);
              if (!tRes.ok){
          try{
            const txt = await tRes.text();
            console.warn('[pg_meta] tables(public) body:', txt);
            if (tRes.status === 406 && /schema must be one of/.test(txt)){
              set('Supabase REST does not expose pg_meta in this project. In Studio: Settings → API → Exposed Schemas → add "pg_meta". Then retry.');
            } else {
              set(`Failed to fetch tables (${tRes.status})`);
            }
          }catch{}
          show('');
          return;
        }
              let tables = await tRes.json();
              console.log('[pg_meta] tables(public) count:', Array.isArray(tables)?tables.length:'n/a');
              console.log('[pg_meta] GET columns (public):', cUrl);
              let cRes = await fetch(cUrl, { headers });
              console.log('[pg_meta] columns(public) status:', cRes.status);
              if (!cRes.ok){ try{ const txt = await cRes.text(); console.warn('[pg_meta] columns(public) body:', txt); }catch{} set(`Fetched tables, but failed to fetch columns (${cRes.status})`); }
              let cols = cRes.ok ? await cRes.json() : [];
              if (Array.isArray(cols)) console.log('[pg_meta] columns(public) count:', cols.length);
              if (Array.isArray(tables) && tables.length === 0){
                set('No tables in public. Checking all schemas...');
                tUrl = base + '/rest/v1/tables?select=schema,name';
                cUrl = base + '/rest/v1/columns?select=schema,table,name,format,is_nullable,position';
                console.log('[pg_meta] GET tables (all):', tUrl);
                tRes = await fetch(tUrl, { headers });
                console.log('[pg_meta] tables(all) status:', tRes.status);
                if (tRes.ok){ tables = await tRes.json(); console.log('[pg_meta] tables(all) count:', Array.isArray(tables)?tables.length:'n/a'); }
                console.log('[pg_meta] GET columns (all):', cUrl);
                cRes = await fetch(cUrl, { headers });
                console.log('[pg_meta] columns(all) status:', cRes.status);
                if (cRes.ok){ cols = await cRes.json(); if (Array.isArray(cols)) console.log('[pg_meta] columns(all) count:', cols.length); }
              }
              const byTable = {};
              cols.forEach(col=>{ const key = `${col.schema||'public'}.${col.table||col.table_name||'unknown'}`; (byTable[key] ||= []).push(col); });
              let buf = '';
              tables.forEach(t=>{
                const tname = t.name || t.table || t.table_name;
                const schema = t.schema || 'public';
                const fq = `${schema}.${tname}`;
                buf += `Table: ${fq}\n`;
                const list = byTable[fq]||[];
                list.sort((a,b)=> (a.position||a.ordinal_position||0) - (b.position||b.ordinal_position||0));
                list.forEach(c=>{
                  const cname = c.name || c.column_name;
                  const typ = c.data_type || c.format || 'unknown';
                  const nul = (c.is_nullable===true || c.is_nullable==='YES') ? 'NULL' : 'NOT NULL';
                  buf += `  - ${cname} ${typ} ${nul}\n`;
                });
                if (!list.length) buf += '  (no columns found)\n';
                buf += '\n';
              });
              if (!tables.length) { buf = 'No tables found. If you used an anon key, pg_meta is restricted. Use the service_role key or create tables first.'; console.warn('[pg_meta] No tables returned.'); }
              show(buf);
              set('Listed tables.');
            }catch(e){ console.error(e); set('List failed: ' + (e?.message||'Unknown error')); }
          });
        }
      }
    }catch{}
  }

  // init after DOM is ready to ensure elements exist
  const __nvStart = ()=>{
    try{ blankForm(); }catch(e){ console.warn('init blankForm error', e); }
    try{ listBots(); }catch(e){ console.warn('init listBots error', e); }
    try{ hookEvents(); }catch(e){ console.warn('init hookEvents error', e); }
    try { updateEditorDisabled(); } catch{}
    try { updateTogglePreviewUI(); } catch{}
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __nvStart); else __nvStart();

  // Safety net: delegated click handlers for Supabase modal buttons
  document.addEventListener('click', async (evt)=>{
    const t = evt.target;
    const is = (id)=> t && (t.id===id || (t.closest && t.closest('#'+id)));
    // Test Connection delegated
    if (is('supTest')){
      const statusEl = document.getElementById('supStatus');
      const set = (tx)=>{ if (statusEl) statusEl.textContent = tx; };
      try{
        let url = document.getElementById('supUrl')?.value?.trim()||'';
        const serviceKey = document.getElementById('supServiceKey')?.value?.trim();
        const anonKey = document.getElementById('supAnonKey')?.value?.trim();
        if (!url){ set('Enter a Supabase URL. Example: https://YOUR-PROJECT.supabase.co'); return; }
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        try{ const u = new URL(url); url = u.origin; }catch{ set('Invalid URL. Use https://YOUR-PROJECT.supabase.co'); return; }
        set('Testing...');
        let ok = false; let authOk = null; let healthStatus = 0; let authStatus = 0;
        const key = serviceKey || anonKey || '';
        try{
          const res = await fetch(url.replace(/\/$/,'') + '/auth/v1/health', { method:'GET', headers: key ? { 'apikey': key, 'Authorization': 'Bearer ' + key } : undefined });
          healthStatus = res.status;
          ok = res.ok || res.status === 401 || res.status === 403 || res.status === 204;
        }catch(err){ console.warn('Health check error', err); }
        if (key){
          try{
            const res2 = await fetch(url.replace(/\/$/,'') + '/rest/v1/', { method:'GET', headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } });
            authStatus = res2.status; authOk = res2.ok;
          }catch(err){ console.warn('Auth check error', err); authOk = false; }
        }
        if (ok && (authOk===true || authOk===null)) set('Connection looks good. ' + (healthStatus?`(health ${healthStatus})`:''));
        else if (ok && authOk===false) set(`Server reachable (health ${healthStatus}) but API key failed (status ${authStatus}). Check key/permissions (RLS).`);
        else set(`Could not reach Supabase (health status ${healthStatus||'n/a'}). Check URL, project availability, and CORS.`);
      }catch(e){ console.error(e); set('Test failed: ' + (e?.message||'Unknown error')); }
      return;
    }
    // List Tables delegated
    if (is('supList')){
      const statusEl = document.getElementById('supStatus');
      const out = document.getElementById('supMeta');
      const set = (tx)=>{ if (statusEl) statusEl.textContent = tx; };
      const show = (tx)=>{ if (out) out.textContent = tx; };
      try{
        let url = document.getElementById('supUrl')?.value?.trim()||'';
        let key = document.getElementById('supServiceKey')?.value?.trim()||'';
        if (!url){ set('Enter a Supabase URL.'); return; }
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        try{ const u = new URL(url); url = u.origin; }catch{ set('Invalid URL.'); return; }
        if (!key){ set('Service role key required for pg_meta.'); return; }
        set('Listing tables...'); show('Loading...');
        const base = url.replace(/\/$/,'');
        const headers = { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Accept-Profile': 'pg_meta' };
        // RPC fallback if pg_meta is not exposed
        const rpcList = async (schema)=>{
          const rpcUrl = base + '/rest/v1/rpc/nb_list_tables';
          const body = schema ? { p_schema: schema } : {};
          console.log('[rpc] POST nb_list_tables schema=', schema||'(all)');
          const res = await fetch(rpcUrl, { method:'POST', headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
          if (!res.ok){
            let txt = ''; try{ txt = await res.text(); }catch{}
            throw new Error(`RPC nb_list_tables failed (${res.status}). ${txt||''}`);
          }
          const rows = await res.json();
          // rows expected: [{ schema, table, column, data_type, is_nullable, position }]
          const tableSet = new Map();
          rows.forEach(r=>{ const key = `${r.schema}.${r.table}`; if (!tableSet.has(key)) tableSet.set(key, { schema: r.schema, name: r.table }); });
          const tables = Array.from(tableSet.values());
          const cols = rows.map(r=>({ schema: r.schema, table: r.table, name: r.column, format: r.data_type, is_nullable: (r.is_nullable===true || r.is_nullable==='YES'), position: r.position }));
          return { tables, cols };
        };
        console.log('[pg_meta] base:', base);
        let tUrl = base + '/rest/v1/tables?select=schema,name&schema=eq.public';
        let cUrl = base + '/rest/v1/columns?select=schema,table,name,format,is_nullable,position&schema=eq.public';
        console.log('[pg_meta] GET tables (public):', tUrl);
        let tRes = await fetch(tUrl, { headers });
        console.log('[pg_meta] tables(public) status:', tRes.status);
        if (!tRes.ok){
          try{
            const txt = await tRes.text();
            console.warn('[pg_meta] tables(public) body:', txt);
            if (tRes.status === 406 && /schema must be one of/.test(txt)){
              // Try backend fallback first (no SQL required on Supabase project)
              set('pg_meta not exposed. Trying backend fallback...');
              try{
                let { tables, cols } = await backendList();
                // If no public tables, try all schemas
                if (!Array.isArray(tables) || tables.length === 0){
                  set('No tables in public. Trying all schemas (RPC)...');
                  const all = await rpcList(null);
                  tables = all.tables; cols = all.cols;
                }
                // Render
                const byTable = {};
                cols.forEach(col=>{ const k = `${col.schema}.${col.table}`; (byTable[k] ||= []).push(col); });
                let buf = '';
                tables.forEach(t=>{
                  const fq = `${t.schema}.${t.name}`;
                  buf += `Table: ${fq}\n`;
                  const list = (byTable[fq]||[]).sort((a,b)=> (a.position||0)-(b.position||0));
                  if (!list.length) buf += '  (no columns found)\n';
                  list.forEach(c=>{ buf += `  - ${c.name} ${c.format} ${c.is_nullable? 'NULL':'NOT NULL'}\n`; });
                  buf += '\n';
                });
                if (!tables.length) buf = 'No tables found.';
                show(buf);
                set('Listed tables.');
              }catch(err){
                console.warn('[backend] fallback failed, trying RPC...', err);
                // Try RPC fallback using nb_list_tables (requires function on DB)
                set('Backend fallback failed. Trying RPC fallback...');
                try{
                  const { tables, cols } = await rpcList('public');
                  const byTable = {}; cols.forEach(col=>{ const k = `${col.schema}.${col.table}`; (byTable[k] ||= []).push(col); });
                  let buf = '';
                  tables.forEach(t=>{
                    const fq = `${t.schema}.${t.name}`;
                    buf += `Table: ${fq}\n`;
                    const list = (byTable[fq]||[]).sort((a,b)=> (a.position||0)-(b.position||0));
                    if (!list.length) buf += '  (no columns found)\n';
                    list.forEach(c=>{ buf += `  - ${c.name} ${c.format} ${c.is_nullable? 'NULL':'NOT NULL'}\n`; });
                    buf += '\n';
                  });
                  if (!tables.length) buf = 'No tables found in public schema.';
                  show(buf);
                  set('Listed tables (RPC).');
                }catch(e2){
                  console.warn('[rpc] fallback failed:', e2);
                  set('pg_meta not exposed and both backend+RPC fallbacks failed.');
                }
              }
            } else {
              set(`Failed to fetch tables (${tRes.status})`);
            }
          }catch{}
          show('');
          return;
        }
        let tables = await tRes.json();
        console.log('[pg_meta] tables(public) count:', Array.isArray(tables)?tables.length:'n/a');
        console.log('[pg_meta] GET columns (public):', cUrl);
        let cRes = await fetch(cUrl, { headers });
        console.log('[pg_meta] columns(public) status:', cRes.status);
        if (!cRes.ok){ try{ const txt = await cRes.text(); console.warn('[pg_meta] columns(public) body:', txt); }catch{} set(`Fetched tables, but failed to fetch columns (${cRes.status})`); }
        let cols = cRes.ok ? await cRes.json() : [];
        if (Array.isArray(cols)) console.log('[pg_meta] columns(public) count:', cols.length);
        if (Array.isArray(tables) && tables.length === 0){
          set('No tables in public. Checking all schemas...');
          tUrl = base + '/rest/v1/tables?select=schema,name';
          cUrl = base + '/rest/v1/columns?select=schema,table,name,format,is_nullable,position';
          console.log('[pg_meta] GET tables (all):', tUrl);
          tRes = await fetch(tUrl, { headers });
          console.log('[pg_meta] tables(all) status:', tRes.status);
          if (tRes.ok){ tables = await tRes.json(); console.log('[pg_meta] tables(all) count:', Array.isArray(tables)?tables.length:'n/a'); }
          console.log('[pg_meta] GET columns (all):', cUrl);
          cRes = await fetch(cUrl, { headers });
          console.log('[pg_meta] columns(all) status:', cRes.status);
          if (cRes.ok){ cols = await cRes.json(); if (Array.isArray(cols)) console.log('[pg_meta] columns(all) count:', cols.length); }
        }
        const byTable = {};
        cols.forEach(col=>{ const k = `${col.schema||'public'}.${col.table||col.table_name||'unknown'}`; (byTable[k] ||= []).push(col); });
        let buf = '';
        tables.forEach(t=>{
          const tname = t.name || t.table || t.table_name;
          const schema = t.schema || 'public';
          const fq = `${schema}.${tname}`;
          buf += `Table: ${fq}\n`;
          const list = byTable[fq]||[];
          list.sort((a,b)=> (a.position||a.ordinal_position||0) - (b.position||b.ordinal_position||0));
          list.forEach(c=>{
            const cname = c.name || c.column_name;
            const typ = c.data_type || c.format || 'unknown';
            const nul = (c.is_nullable===true || c.is_nullable==='YES') ? 'NULL' : 'NOT NULL';
            buf += `  - ${cname} ${typ} ${nul}\n`;
          });
          if (!list.length) buf += '  (no columns found)\n';
          buf += '\n';
        });
        if (!tables.length) { buf = 'No tables found. If you used an anon key, pg_meta is restricted. Use the service_role key or create tables first.'; console.warn('[pg_meta] No tables returned.'); }
        show(buf);
        set('Listed tables.');
      }catch(e){ console.error(e); set('List failed: ' + (e?.message||'Unknown error')); }
      return;
    }
  });
  // initialize live preview once after DOM ready
  try { updateMiniPreview(); } catch{}
  // initialize collapsible sections
  try { initCollapsibles(); } catch{}
  // Wire persistent header create button if present
  try{
    const hdrCreate = document.getElementById('btnCreateBot');
    if (hdrCreate){
      hdrCreate.addEventListener('click', ()=>{
        try{ blankForm(); }catch{}
        try{ $('#fKey').value = genKey(); }catch{}
        // Enable editor for new bot
        try{ currentEditingId = 'new'; updateEditorDisabled(); }catch{}
        try{ $('#fKey').dataset.id=''; }catch{}
        try{ $('#fName')?.focus(); }catch{}
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }catch{}
})();
