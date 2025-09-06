// Minimal multi-tenant backend MVP for NovaBot
// Node + Express server with in-memory storage
// Endpoints:
// - Auth: API key via 'x-api-key' header (per-tenant). Admin routes (bots CRUD) also allow 'x-admin-key'
// - /v1/bots [GET, POST] (admin) | /v1/bots/:id [GET, PUT, DELETE] (admin)
// - /v1/config [GET] -> public per-tenant bot config for widget (by api key)
// - /v1/products [GET]
// - /v1/pages [GET]
// - /v1/promos [GET]

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
let pg; try{ pg = require('pg'); }catch{}

const PORT = process.env.PORT || 5050;
const ADMIN_KEY = process.env.NOVABOT_ADMIN_KEY || 'dev-admin-key';
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// In-memory store (replace with DB later)
const store = {
  tenants: {
    // apiKey: { id, name, origin, features, widget }
  },
  bots: {
    // id: bot
  },
  products: {}, // tenantId -> array
  pages: {},    // tenantId -> array
  promos: {},   // tenantId -> array
};

function genId(prefix='bot'){
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}
function ensureTenant(apiKey){
  if (!apiKey) return null;
  return store.tenants[apiKey] || null;
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors({
  origin: (origin, cb)=>{
    // Allow local dev + the request origin (tighten later)
    const allowed = [undefined, null, 'http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5500'];
    if (allowed.includes(origin)) return cb(null, true);
    // Basic allow any for MVP
    return cb(null, true);
  },
  credentials: false
}));

// Middleware: tenant auth (for public data)
function requireTenant(req, res, next){
  const apiKey = req.header('x-api-key') || req.query.apiKey;
  const tenant = ensureTenant(apiKey);
  if (!tenant) return res.status(401).json({ error: 'invalid_api_key' });
  req.tenant = tenant; req.apiKey = apiKey; next();
}
// Middleware: admin auth
function requireAdmin(req, res, next){
  const key = req.header('x-admin-key');
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'invalid_admin_key' });
  next();
}

// Seed one demo tenant on boot
(function seed(){
  const apiKey = 'DEMO-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const botId = genId();
  const bot = {
    id: botId,
    name: 'Nova Demo',
    origin: 'http://localhost',
    apiKey,
    widget: { position: 'bottom-right', primary: '#60a5fa', accent: '#6ee7b7', avatar: '' },
    features: { promos: true, upsell: true, recommendations: true, voice: false, smallTalk: true }
  };
  store.tenants[apiKey] = { id: bot.id, name: bot.name, origin: bot.origin, features: bot.features, widget: bot.widget };
  store.bots[botId] = bot;
  store.products[botId] = demoProducts();
  store.pages[botId] = demoPages();
  store.promos[botId] = demoPromos();
  console.log('[seed] demo apiKey:', apiKey);
})();

// Admin: list bots
app.get('/v1/bots', requireAdmin, (req, res)=>{
  const list = Object.values(store.bots);
  res.json({ bots: list });
});
// Admin: create bot
app.post('/v1/bots', requireAdmin, (req, res)=>{
  const b = req.body || {};
  const id = genId();
  const apiKey = b.apiKey || ('BOT-' + crypto.randomBytes(6).toString('hex').toUpperCase());
  const bot = {
    id,
    name: b.name || 'Untitled',
    origin: b.origin || '',
    apiKey,
    widget: b.widget || { position: 'bottom-right', primary: '#60a5fa', accent: '#6ee7b7', avatar: '' },
    features: b.features || { promos: true, upsell: true, recommendations: true, voice: false, smallTalk: true },
    firstMessage: (b.firstMessage||'')
  };
  store.bots[id] = bot;
  store.tenants[apiKey] = { id, name: bot.name, origin: bot.origin, features: bot.features, widget: bot.widget, firstMessage: bot.firstMessage };
  store.products[id] = b.products || demoProducts();
  store.pages[id] = b.pages || demoPages();
  store.promos[id] = b.promos || demoPromos();
  res.status(201).json({ bot });
});
// Admin: get bot
app.get('/v1/bots/:id', requireAdmin, (req, res)=>{
  const bot = store.bots[req.params.id];
  if (!bot) return res.status(404).json({ error: 'not_found' });
  res.json({ bot });
});
// Admin: update bot
app.put('/v1/bots/:id', requireAdmin, (req, res)=>{
  const bot = store.bots[req.params.id];
  if (!bot) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  bot.name = b.name ?? bot.name;
  bot.origin = b.origin ?? bot.origin;
  bot.widget = b.widget ?? bot.widget;
  bot.features = b.features ?? bot.features;
  bot.firstMessage = (b.firstMessage !== undefined) ? b.firstMessage : (bot.firstMessage||'');
  store.tenants[bot.apiKey] = { id: bot.id, name: bot.name, origin: bot.origin, features: bot.features, widget: bot.widget, firstMessage: bot.firstMessage };
  res.json({ bot });
});
// Admin: delete bot
app.delete('/v1/bots/:id', requireAdmin, (req, res)=>{
  const bot = store.bots[req.params.id];
  if (!bot) return res.status(404).json({ error: 'not_found' });
  delete store.products[bot.id];
  delete store.pages[bot.id];
  delete store.promos[bot.id];
  delete store.tenants[bot.apiKey];
  delete store.bots[bot.id];
  res.json({ ok: true });
});

// Public: config by api key
app.get('/v1/config', requireTenant, (req, res)=>{
  const t = req.tenant;
  res.json({
    name: t.name,
    widget: t.widget,
    features: t.features,
    firstMessage: t.firstMessage || ''
  });
});
// Public: products
app.get('/v1/products', requireTenant, (req, res)=>{
  const id = req.tenant.id;
  res.json({ products: store.products[id] || [] });
});
// Public: pages
app.get('/v1/pages', requireTenant, (req, res)=>{
  const id = req.tenant.id;
  res.json({ pages: store.pages[id] || [] });
});
// Public: promos
app.get('/v1/promos', requireTenant, (req, res)=>{
  const id = req.tenant.id;
  res.json({ promos: store.promos[id] || [] });
});

app.get('/healthz', (req,res)=> res.json({ ok: true }));

// Introspection: list tables/columns from public via direct DB connection (no pg_meta)
// Requires env SUPABASE_DB_URL (or DATABASE_URL). Protected by x-admin-key.
app.get('/v1/introspect/public', async (req, res)=>{
  if ((req.header('x-admin-key')||'') !== ADMIN_KEY) return res.status(401).json({ error: 'invalid_admin_key' });
  if (!pg || !SUPABASE_DB_URL) return res.status(503).json({ error: 'introspection_unavailable', hint: 'Install pg and set SUPABASE_DB_URL' });
  const { Pool } = pg;
  const pool = new Pool({ connectionString: SUPABASE_DB_URL, max: 1, ssl: SUPABASE_DB_URL.includes('supabase.co') ? { rejectUnauthorized: false } : undefined });
  let client;
  try{
    client = await pool.connect();
    const q = `
      select
        c.table_schema::text as schema,
        c.table_name::text   as "table",
        c.column_name::text  as "column",
        c.data_type::text    as data_type,
        c.is_nullable::text  as is_nullable,
        c.ordinal_position::int as position
      from information_schema.columns c
      where c.table_schema = 'public'
      order by c.table_name, c.ordinal_position
    `;
    const { rows } = await client.query(q);
    res.json({ rows });
  }catch(err){
    console.error('[introspect/public] error', err);
    res.status(500).json({ error: 'query_failed', message: String(err && err.message || err) });
  }finally{
    try{ client && client.release(); }catch{}
    try{ await pool.end(); }catch{}
  }
});

// Chat: proxy to Groq API to keep API key server-side
// Body: { message: string }
app.post('/v1/chat/groq', express.json(), async (req, res)=>{
  try{
    const { message, botName } = req.body || {};
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'invalid_message' });
    // Graceful fallback reply used when GROQ is unavailable
    const name = (typeof botName === 'string' && botName.trim()) ? botName.trim() : 'Nova';
    const fallback = () => {
      const txt = `I'm having trouble reaching AI right now, but I can still help with navigation and quick actions. Try: "recommend travel", "view policy", or "checkout".`;
      return res.json({ reply: txt });
    };
    // If no key configured, return a friendly fallback instead of an error to keep UX responsive
    if (!GROQ_API_KEY) {
      return fallback();
    }
    const sys = `You are **${name}**, a warm, helpful, and upbeat demo shop assistant for an e-commerce store.  \nYour personality: friendly, conversational, lightly playful, and always customer-focused.  \nYou are not an AI model or language model — you are simply ${name}, the assistant.  \nNever mention that you are an AI or model.  \nKeep answers clear, concise, and human-like.  \nWhen asked about general things (weather, feelings, chit-chat), answer in a warm, casual way, like a shop clerk chatting with a customer.  \nWhen asked about shopping-related things, smoothly hand off to the store logic if possible.  \nAlways stay in character as ${name}.`;
    const payload = {
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: message }
      ]
    };
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`,'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });
      if (!r.ok){
        // Upstream error — fall back instead of surfacing 5xx to the UI
        const t = await r.text().catch(()=>'' );
        console.warn('[chat/groq] upstream not OK', r.status, t);
        return fallback();
      }
      const data = await r.json();
      const reply = data?.choices?.[0]?.message?.content || '';
      return res.json({ reply });
    } catch (e) {
      console.warn('[chat/groq] fetch failed, falling back:', e && e.message || e);
      return fallback();
    }
  }catch(err){
    console.error('[chat/groq] error', err);
    // Final safety net — return a friendly message rather than a 500 to keep the bot responsive
    try {
      const txt = "I'm having trouble reaching AI right now, but I can still help with navigation and quick actions. Try: \"recommend travel\", \"view policy\", or \"checkout\".";
      return res.json({ reply: txt });
    } catch {}
    return res.status(200).json({ reply: "Sorry, I'm a bit stuck right now. Please try again." });
  }
});

// When running on Vercel Serverless, export the app instead of listening.
// Vercel detects the exported handler and binds it automatically.
if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, ()=>{
    console.log(`[NovaBot] backend running on http://localhost:${PORT}`);
  });
}

// Demo data
function demoProducts(){
  return [
    { id: 'p1', name: 'Demo Hoodie', price: 49.99, category: 'apparel' },
    { id: 'p2', name: 'Demo Mug', price: 14.00, category: 'home' },
    { id: 'p3', name: 'Demo Headphones', price: 89.00, category: 'gadgets' }
  ];
}
function demoPages(){
  return [
    { slug: 'home', title: 'Home' },
    { slug: 'about', title: 'About' },
    { slug: 'contact', title: 'Contact' }
  ];
}
function demoPromos(){
  return [
    { code: 'WELCOME10', desc: '10% off your first order', note: 'New customers' },
    { code: 'FREESHIP', desc: 'Free shipping over $50', note: 'Today only' }
  ];
}
