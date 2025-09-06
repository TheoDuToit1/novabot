(function(global){
  const NovaBot = {
    _loaded: false,
    async init(config){
      try{
        const cfg = config || {};
        await ensureCore();
        // Build a transient bot object similar to dashboard format
        let bot = normalizeConfig(cfg);
        // Backend: fetch tenant config and data if apiKey provided
        if (bot.apiKey){
          const API_BASE = cfg.apiBase || global.NOVABOT_API_BASE || 'http://localhost:5050';
          try{
            const headers = { 'x-api-key': bot.apiKey };
            const [conf, prods, pages, promos] = await Promise.all([
              fetch(`${API_BASE}/v1/config`, { headers }).then(r=>r.ok?r.json():null).catch(()=>null),
              fetch(`${API_BASE}/v1/products`, { headers }).then(r=>r.ok?r.json():null).catch(()=>null),
              fetch(`${API_BASE}/v1/pages`, { headers }).then(r=>r.ok?r.json():null).catch(()=>null),
              fetch(`${API_BASE}/v1/promos`, { headers }).then(r=>r.ok?r.json():null).catch(()=>null),
            ]);
            if (conf){
              bot.name = conf.name || bot.name;
              if (conf.widget) bot.widget = { ...bot.widget, ...conf.widget };
              if (conf.features) bot.features = { ...bot.features, ...conf.features };
              if (typeof conf.firstMessage === 'string') bot.firstMessage = conf.firstMessage;
            }
            // Set globals for the widget to use
            if (prods && Array.isArray(prods.products)) global.DEMO_PRODUCTS = prods.products;
            if (pages && Array.isArray(pages.pages)) global.DEMO_PAGES = pages.pages;
            if (promos && Array.isArray(promos.promos)) global.DEMO_PROMOS = promos.promos;
          }catch(e){ /* non-fatal */ }
        }
        // Expose bot for widget to read when no dashboard storage is present
        try { global.__sdkBot = bot; } catch{}
        // Apply immediately via event (mark as non-preview for public pages)
        bot.__preview = false;
        window.dispatchEvent(new CustomEvent('nova:preview-bot', { detail: bot }));
        // Optionally open widget
        if (cfg.autoOpen){
          const t = document.querySelector('.chatbot-toggle');
          if (t) t.click();
        }
        this._loaded = true;
        return true;
      }catch(e){
        console.error('[NovaBot] init failed', e);
        return false;
      }
    }
  };

  function normalizeConfig(cfg){
    return {
      id: cfg.id || 'sdk_active',
      name: cfg.name || cfg.siteName || 'Nova',
      origin: cfg.siteOrigin || location.origin,
      apiKey: cfg.apiKey || '',
      firstMessage: typeof cfg.firstMessage === 'string' ? cfg.firstMessage : '',
      widget: {
        position: (cfg.widget && cfg.widget.position) || 'bottom-right',
        primary: (cfg.widget && cfg.widget.primary) || '#60a5fa',
        accent: (cfg.widget && cfg.widget.accent) || '#6ee7b7',
        avatar: (cfg.widget && cfg.widget.avatar) || ''
      },
      features: {
        promos: getFlag(cfg, 'promos', true),
        upsell: getFlag(cfg, 'upsell', true),
        recommendations: getFlag(cfg, 'recommendations', true),
        voice: getFlag(cfg, 'voice', false),
        smallTalk: getFlag(cfg, 'smallTalk', true)
      }
    };
  }
  function getFlag(cfg, key, d){
    if (cfg.features && key in cfg.features) return !!cfg.features[key];
    if (key in cfg) return !!cfg[key];
    return d;
  }

  async function ensureCore(){
    // Load data.js and app.js if not already loaded
    const needsData = (typeof window.DEMO_PRODUCTS === 'undefined');
    const hasWidget = !!document.querySelector('.chatbot-toggle');
    if (needsData){ await loadScript(rel('assets/js/data.js')); }
    if (!hasWidget){ await loadScript(rel('assets/js/app.js')); }
  }

  function rel(path){
    // Resolve relative to current script if possible
    try{
      const me = document.currentScript && document.currentScript.src;
      if (me){
        const u = new URL(me, location.href);
        // If the script is at /assets/js/novabot.js, resolve relative path from its directory
        const base = u.href.replace(/[^\/]*$/, '');
        return new URL(path.replace(/^\.\//,''), base).href;
      }
    }catch{}
    return path;
  }

  function loadScript(src){
    return new Promise((resolve, reject)=>{
      const s = document.createElement('script');
      s.src = src; s.async = true; s.defer = true;
      s.onload = ()=> resolve();
      s.onerror = (e)=> reject(new Error('Failed to load '+src));
      document.head.appendChild(s);
    });
  }

  // Expose
  global.NovaBot = global.NovaBot || NovaBot;
})(window);
