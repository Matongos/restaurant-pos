// A stand-in for the Supabase online account, for testing sync without the internet.
// Implements only what the app calls: sign-up/sign-in/refresh, members, records, and the RPCs
// slug_available, create_restaurant, push_records — with the same membership rules as the SQL.
// Run: node tests/cloud-mock.cjs [port]   (default 54321). CONFIRM=1 makes sign-up need email confirmation.
const http = require('http');
const crypto = require('crypto');
const PORT = Number(process.argv[2] || 54321);
const users = new Map(); // email -> {id,email,password,confirmed}
const tokens = new Map(); // access token -> user id
const refreshTokens = new Map();
const restaurants = new Map(); // id -> {...}
const members = []; // {restaurant_id,user_id,role}
const records = new Map(); // rid|kind|id -> row
let lastMs = 0;
const now = () => { let t = Date.now(); if (t <= lastMs) t = lastMs + 1; lastMs = t; return new Date(t).toISOString(); };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function session(u) {
  const access = `${b64({ alg: 'none' })}.${b64({ sub: u.id, email: u.email })}.${crypto.randomBytes(8).toString('hex')}`;
  const refresh = crypto.randomBytes(12).toString('hex');
  tokens.set(access, u.id); refreshTokens.set(refresh, u.id);
  return { access_token: access, refresh_token: refresh, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: u.id, email: u.email } };
}
const isMember = (rid, uid) => members.some((m) => m.restaurant_id === rid && m.user_id === uid);
const stats = { pushes: 0, selects: 0 };

http.createServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') return send(204);
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const body = raw ? JSON.parse(raw) : {};
    const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
    const uid = tokens.get(auth);
    const p = url.pathname;
    // test helpers
    if (p === '/__state') return send(200, { users: users.size, restaurants: [...restaurants.values()], members, records: [...records.values()].map((r) => ({ kind: r.kind, id: r.id, deleted: r.deleted, device_id: r.device_id })), stats });
    if (p === '/__confirm') { const u = users.get(url.searchParams.get('email')); if (u) u.confirmed = true; return send(200, { ok: !!u }); }
    if (!req.headers.apikey) return send(401, { message: 'No API key' });

    if (p === '/auth/v1/signup') {
      if (users.has(body.email)) return send(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
      if (!body.password || body.password.length < 6) return send(422, { error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
      const u = { id: crypto.randomUUID(), email: body.email, password: body.password, confirmed: !process.env.CONFIRM };
      users.set(u.email, u);
      return send(200, u.confirmed ? session(u) : { id: u.id, email: u.email });
    }
    if (p === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'password') {
        const u = users.get(body.email);
        if (!u || u.password !== body.password) return send(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        if (!u.confirmed) return send(400, { error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
        return send(200, session(u));
      }
      const id = refreshTokens.get(body.refresh_token);
      if (!id) return send(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      refreshTokens.delete(body.refresh_token);
      return send(200, session([...users.values()].find((u) => u.id === id)));
    }
    if (p === '/auth/v1/logout') { tokens.delete(auth); return send(204); }
    if (p === '/auth/v1/recover') return send(200, {});

    if (p === '/rest/v1/rpc/slug_available') {
      const s = String(body.p_slug || '').toLowerCase();
      return send(200, /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(s) && ![...restaurants.values()].some((r) => r.slug === s) && !['www', 'app', 'admin'].includes(s));
    }
    if (!uid) return send(401, { code: '42501', message: 'JWT required' });
    if (p === '/rest/v1/rpc/create_restaurant') {
      if ([...restaurants.values()].some((r) => r.slug === body.p_slug)) return send(409, { code: '23505', message: 'duplicate key value violates unique constraint "restaurants_slug_key"' });
      const r = { id: crypto.randomUUID(), name: body.p_name, slug: body.p_slug, town: body.p_town, plan: 'trial', trial_ends_at: new Date(Date.now() + 30 * 864e5).toISOString() };
      restaurants.set(r.id, r); members.push({ restaurant_id: r.id, user_id: uid, role: 'owner' });
      return send(200, r.id);
    }
    if (p === '/rest/v1/rpc/push_records') {
      if (!isMember(body.rid, uid)) return send(403, { code: '42501', message: 'not a member of this restaurant' });
      stats.pushes++;
      for (const it of body.items) {
        records.set(`${body.rid}|${it.kind}|${it.id}`, { restaurant_id: body.rid, kind: it.kind, id: it.id, data: it.data ?? {}, deleted: !!it.deleted, device_id: body.device, updated_at: now() });
      }
      restaurants.get(body.rid).last_seen_at = now();
      return send(200, now());
    }
    if (p === '/rest/v1/members') {
      const want = (url.searchParams.get('user_id') || '').replace(/^eq\./, '');
      const list = members.filter((m) => isMember(m.restaurant_id, uid) && (!want || m.user_id === want));
      return send(200, list.map((m) => { const r = restaurants.get(m.restaurant_id); return { restaurant_id: m.restaurant_id, role: m.role, restaurants: { name: r.name, slug: r.slug, plan: r.plan, trial_ends_at: r.trial_ends_at } }; }));
    }
    if (p === '/rest/v1/records') {
      stats.selects++;
      const rid = (url.searchParams.get('restaurant_id') || '').replace(/^eq\./, '');
      if (!isMember(rid, uid)) return send(200, []); // RLS: nothing visible
      const gt = url.searchParams.get('updated_at');
      const since = gt ? Date.parse(gt.replace(/^gt\./, '')) : -Infinity;
      const limit = Number(url.searchParams.get('limit') || 1000);
      const rows = [...records.values()].filter((r) => r.restaurant_id === rid && Date.parse(r.updated_at) > since).sort((a, b) => a.updated_at.localeCompare(b.updated_at)).slice(0, limit);
      return send(200, rows);
    }
    send(404, { message: 'not in mock: ' + p });
  });
}).listen(PORT, () => console.log('cloud mock on', PORT));
