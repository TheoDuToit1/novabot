(function(){
  // NovaBot single-entry loader
  // Loads required CSS and JS (data.js, app.js) relative to this script URL
  // Exposes a stub window.NovaBot that queues init() until the widget is ready
  try {
    var current = document.currentScript || (function(){ var scripts = document.getElementsByTagName('script'); return scripts[scripts.length-1]; })();
    var base = (function(){ try { return new URL('.', current.src).href; } catch(e){ return ''; } })();
    // Allow explicit base/app/data/css overrides via data attributes
    var ds = current && current.dataset ? current.dataset : {};
    var baseUrl = (function(){
      var b = ds.baseUrl || ds.base || '';
      if (!b) return base;
      try {
        // ensure trailing slash
        if (!/\/$/.test(b)) b = b + '/';
        return b;
      } catch(_e){ return base; }
    })();
    var urlCss  = ds.css  || (baseUrl + '../css/styles.css');
    var urlData = ds.data || (baseUrl + 'data.js');
    var urlApp  = ds.app  || (baseUrl + 'app.js');

    // Provide a stub NovaBot immediately
    if (!window.NovaBot) {
      var queue = [];
      window.NovaBot = {
        available: 'loading',
        init: function(cfg){ queue.push(cfg); }
      };
      // Expose for debugging
      try { window.__NovaBotQueue = queue; } catch{}
    }

    function ensureCss(){
      try {
        var id = 'novabot-styles';
        if (document.getElementById(id)) return;
        var link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = urlCss;
        document.head.appendChild(link);
      } catch(_e){}
    }

    function loadScript(src){
      return new Promise(function(resolve, reject){
        try {
          var s = document.createElement('script');
          s.src = src; s.async = false; s.defer = true;
          s.onload = function(){ resolve(true); };
          s.onerror = function(e){ reject(e || new Error('Failed to load '+src)); };
          document.head.appendChild(s);
        } catch(e){ reject(e); }
      });
    }

    function flushQueue(){
      try {
        if (window.NovaBot && typeof window.NovaBot.init === 'function' && Array.isArray(window.__NovaBotQueue)){
          var q = window.__NovaBotQueue.slice();
          window.__NovaBotQueue.length = 0;
          q.forEach(function(cfg){ try { window.NovaBot.init(cfg); } catch(_e){} });
        }
      } catch(_e){}
    }

    // If embed provided data-attributes, prepare a config and enqueue init
    function parseMaybeJSON(val){
      if (!val) return null;
      try { return JSON.parse(val); } catch(_e){ return null; }
    }
    (function autoInitFromAttrs(){
      try {
        var ds = current && current.dataset ? current.dataset : {};
        var cfg = {};
        if (ds.apiKey) cfg.apiKey = ds.apiKey;
        if (ds.siteOrigin) cfg.siteOrigin = ds.siteOrigin;
        var w = parseMaybeJSON(ds.widget); if (w) cfg.widget = w;
        var f = parseMaybeJSON(ds.features); if (f) cfg.features = f;
        if (ds.firstMessage) cfg.firstMessage = ds.firstMessage;
        if (ds.autoOpen != null) cfg.autoOpen = (ds.autoOpen === 'true' || ds.autoOpen === '1');
        if (Object.keys(cfg).length){
          try { window.NovaBot.init(cfg); } catch(_e){}
        }
      } catch(_e){}
    })();

    ensureCss();
    // Load dependencies sequentially to preserve order
    loadScript(urlData)
      .then(function(){ return loadScript(urlApp); })
      .then(function(){
        try { window.NovaBot.available = 'ready'; } catch{}
        flushQueue();
      })
      .catch(function(err){
        try { console.error('[NovaBot] Loader failed:', err); window.NovaBot.available = 'error'; } catch{}
      });
  } catch(e){ try { console.error('[NovaBot] Loader error:', e); } catch(_){} }
})();
