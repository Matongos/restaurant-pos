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
const isOwner = (rid, uid) => members.some((m) => m.restaurant_id === rid && m.user_id === uid && m.role !== 'device');
const admins = new Set();
const onlineOrders = []; // like the online_orders table
const events = [];
const live = (r) => !!r.last_seen_at && Date.now() - Date.parse(r.last_seen_at) < 3 * 60000;
const bySlug = (slug) => [...restaurants.values()].find((r) => r.slug === String(slug || '').toLowerCase() && r.plan !== 'closed');
const menuOf = (r) => records.get(`${r.id}|public|menu`)?.data || {};
const ORDER_COLS = ['id', 'number', 'customer_name', 'phone', 'mode', 'table_name', 'address', 'lines', 'total', 'status', 'ready_minutes', 'created_at', 'restaurant_id', 'public_token', 'updated_at'];
function filterRows(rows, url) {
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    rows = rows.filter((r) => op === 'eq' ? String(r[k]) === val : op === 'gt' ? Date.parse(r[k]) > Date.parse(val) : op === 'in' ? val.replace(/[()]/g, '').split(',').includes(String(r[k])) : true);
  }
  return rows;
}
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
    if (p === '/__backdate') { let n = 0; for (const r of records.values()) if (r.kind === 'orders' && r.data?.createdAt && Date.parse(r.data.createdAt) < Date.now() - 200 * 864e5) { r.updated_at = r.data.createdAt; n++; } return send(200, { n }); }
    if (p === '/__reset') { users.clear(); tokens.clear(); refreshTokens.clear(); restaurants.clear(); members.length = 0; records.clear(); admins.clear(); onlineOrders.length = 0; events.length = 0; return send(200, {}); }
    if (p === '/__admin') { const u = users.get(url.searchParams.get('email')); if (u) admins.add(u.id); return send(200, { ok: !!u }); }
    if (p === '/__age') { for (const r of restaurants.values()) r.last_seen_at = new Date(Date.now() - 10 * 60000).toISOString(); return send(200, {}); }
    if (p === '/__online') return send(200, { onlineOrders, events });
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
    if (p === '/auth/v1/user' && req.method === 'PUT') {
      const u = [...users.values()].find((x) => x.id === uid);
      if (!u) return send(401, { msg: 'Invalid JWT' });
      if (body.password) { if (body.password.length < 6) return send(422, { error_code: 'weak_password', msg: 'Password should be at least 6 characters.' }); u.password = body.password; }
      if (body.email) { if (users.has(body.email)) return send(422, { error_code: 'email_exists', msg: 'A user with this email address has already been registered' }); users.delete(u.email); u.email = body.email; users.set(u.email, u); }
      return send(200, { id: u.id, email: u.email });
    }

    if (p === '/rest/v1/rpc/slug_available') {
      const s = String(body.p_slug || '').toLowerCase();
      return send(200, /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(s) && ![...restaurants.values()].some((r) => r.slug === s) && !['www', 'app', 'admin'].includes(s));
    }
    if (p === '/rest/v1/app_events' && req.method === 'POST') { events.push({ ...body, created_at: now() }); return send(201); }
    if (p === '/rest/v1/rpc/public_menu') {
      const r = bySlug(body.p_slug);
      if (!r || !(r.web_page || r.qr_menu)) return send(200, null);
      const m = menuOf(r); const rec = records.get(`${r.id}|public|menu`);
      return send(200, { slug: r.slug, name: r.name, town: r.town, currency: 'USD', info: r.public_info || {}, webPage: r.web_page, qrMenu: r.qr_menu, onlineOrders: r.online_orders, online: live(r), updatedAt: rec?.updated_at ?? null,
        categories: m.categories || [], items: m.items || [], addOns: m.addOns || [], symbol: m.symbol || '$', tagline: m.tagline ?? null, logo: m.logo ?? null, brandColor: m.brandColor ?? null });
    }
    if (p === '/rest/v1/rpc/place_online_order') {
      const r = bySlug(body.p_slug);
      if (!r || !r.online_orders) return send(400, { code: 'P0001', message: 'This restaurant is not taking online orders' });
      if (!live(r)) return send(400, { code: 'P0001', message: 'The restaurant is offline right now — please order at the counter' });
      if (!/^[0-9+ ()-]{7,20}$/.test(body.p_phone || '')) return send(400, { code: '23514', message: 'phone check failed' });
      if (onlineOrders.filter((o) => o.restaurant_id === r.id && o.phone === body.p_phone.trim() && ['new', 'accepted'].includes(o.status)).length >= 5) return send(400, { code: 'P0001', message: 'Too many open orders for this phone number' });
      const m = menuOf(r); let total = 0; const priced = [];
      for (const ln of body.p_lines) {
        const it = (m.items || []).find((x) => x.id === ln.itemId);
        if (!it || !it.available) return send(400, { code: 'P0001', message: `Sold out: ${it ? it.name : 'an item'}` });
        const qty = Math.max(1, Math.min(20, ln.qty || 1));
        const unit = it.price + (m.addOns || []).filter((a) => a.available !== false && (ln.extras || []).includes(a.id) && (it.addOnIds || []).includes(a.id)).reduce((t, a) => t + a.price, 0);
        priced.push({ itemId: it.id, name: it.name, qty, unitPrice: unit, extras: ln.extras || [], without: ln.without || [], note: (ln.note || '').slice(0, 120) }); total += qty * unit;
      }
      const n = onlineOrders.filter((o) => o.restaurant_id === r.id).length + 1;
      const o = { id: crypto.randomUUID(), restaurant_id: r.id, number: n, customer_name: body.p_name.trim(), phone: body.p_phone.trim(), mode: body.p_mode || 'pickup', table_name: body.p_table, address: null, lines: priced, total: Math.round(total * 100) / 100, status: 'new', ready_minutes: null, public_token: crypto.randomUUID(), created_at: now(), updated_at: now() };
      onlineOrders.push(o);
      return send(200, { number: o.number, token: o.public_token, total: o.total });
    }
    if (p === '/rest/v1/rpc/online_order_status') {
      const o = onlineOrders.find((x) => x.public_token === body.p_token);
      if (!o) return send(200, null);
      return send(200, { number: o.number, status: o.status, readyMinutes: o.ready_minutes, total: o.total, lines: o.lines, mode: o.mode, restaurant: restaurants.get(o.restaurant_id).name, createdAt: o.created_at, updatedAt: o.updated_at });
    }
    if (p === '/rest/v1/rpc/cancel_online_order') { const o = onlineOrders.find((x) => x.public_token === body.p_token && x.status === 'new'); if (o) { o.status = 'cancelled'; o.updated_at = now(); } return send(200, !!o || null); }
    if (!uid) return send(401, { code: '42501', message: 'JWT required' });
    if (p === '/rest/v1/rpc/console_overview') {
      if (!admins.has(uid)) return send(403, { code: '42501', message: 'not allowed' });
      const rs = [...restaurants.values()];
      return send(200, { visits: events.filter((e) => e.kind === 'site_visit').length, downloads: events.filter((e) => e.kind === 'download_click').length, firstOpens: events.filter((e) => e.kind === 'first_open').length, signups: rs.length, restaurants: rs.filter((r) => r.plan !== 'closed').length, activeWeek: rs.filter((r) => r.last_seen_at).length, paying: rs.filter((r) => ['restaurant', 'group'].includes(r.plan)).length, monthlyIncome: rs.reduce((t, r) => t + (r.plan === 'restaurant' ? 15 : r.plan === 'group' ? 35 : 0), 0), perDay: [{ day: new Date().toISOString().slice(0, 10), downloads: 2, signups: rs.length }], countries: { ZW: rs.length } });
    }
    if (p === '/rest/v1/rpc/console_restaurants') {
      if (!admins.has(uid)) return send(403, { code: '42501', message: 'not allowed' });
      return send(200, [...restaurants.values()].map((r) => ({ ...r, owner_email: [...users.values()].find((u) => members.some((m) => m.restaurant_id === r.id && m.user_id === u.id && m.role === 'owner'))?.email, devices: new Set([...records.values()].filter((x) => x.restaurant_id === r.id).map((x) => x.device_id)).size, orders: [...records.values()].filter((x) => x.restaurant_id === r.id && x.kind === 'orders' && !x.deleted).length, online_orders_count: onlineOrders.filter((o) => o.restaurant_id === r.id).length, web_page: !!r.web_page, qr_menu: !!r.qr_menu, online_orders: !!r.online_orders })));
    }
    if (p === '/rest/v1/rpc/admin_set_plan') {
      if (!admins.has(uid)) return send(403, { code: '42501', message: 'not allowed' });
      const r = restaurants.get(body.p_restaurant); r.plan = body.p_plan; if (body.p_trial_days != null) r.trial_ends_at = new Date(Date.now() + body.p_trial_days * 864e5).toISOString();
      return send(200, null);
    }
    if (p === '/rest/v1/restaurants') {
      const pick = (r) => ({ name: r.name, slug: r.slug, plan: r.plan, trial_ends_at: r.trial_ends_at, web_page: !!r.web_page, qr_menu: !!r.qr_menu, online_orders: !!r.online_orders, public_info: r.public_info || {} });
      let rows = filterRows([...restaurants.values()].filter((r) => isMember(r.id, uid) || admins.has(uid)), url);
      if (req.method === 'PATCH') {
        const allowed = ['name', 'town', 'web_page', 'qr_menu', 'online_orders', 'public_info'];
        if (Object.keys(body).some((k) => !allowed.includes(k))) return send(403, { code: '42501', message: 'permission denied for table restaurants' });
        rows = rows.filter((r) => isOwner(r.id, uid));
        rows.forEach((r) => Object.assign(r, body));
      }
      return send(200, rows.map(pick));
    }
    if (p === '/rest/v1/online_orders') {
      let rows = filterRows(onlineOrders.filter((o) => isMember(o.restaurant_id, uid)), url);
      if (req.method === 'PATCH') rows.forEach((o) => { Object.assign(o, body); o.updated_at = now(); });
      return send(200, rows.map((o) => Object.fromEntries(ORDER_COLS.map((c) => [c, o[c]]))));
    }
    if (p === '/rest/v1/rpc/create_restaurant') {
      if ([...restaurants.values()].some((r) => r.slug === body.p_slug)) return send(409, { code: '23505', message: 'duplicate key value violates unique constraint "restaurants_slug_key"' });
      const r = { id: crypto.randomUUID(), name: body.p_name, slug: body.p_slug, town: body.p_town, plan: 'trial', trial_ends_at: new Date(Date.now() + 30 * 864e5).toISOString(), created_at: now(), web_page: false, qr_menu: false, online_orders: false, public_info: {} };
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
      let since = -Infinity, before = Infinity;
      for (const v of url.searchParams.getAll('updated_at')) { if (v.startsWith('gt.')) since = Date.parse(v.slice(3)); if (v.startsWith('lt.')) before = Date.parse(v.slice(3)); }
      const kf = url.searchParams.get('kind') || '';
      const kinds = (kf.match(/in\.\((.*)\)/) || [])[1]?.split(',') || null;
      const kindOk = (k) => !kinds || (kf.startsWith('not.') ? !kinds.includes(k) : kinds.includes(k));
      const limit = Number(url.searchParams.get('limit') || 1000);
      const rows = [...records.values()].filter((r) => r.restaurant_id === rid && Date.parse(r.updated_at) > since && Date.parse(r.updated_at) < before && kindOk(r.kind)).sort((a, b) => a.updated_at.localeCompare(b.updated_at)).slice(0, limit);
      return send(200, rows);
    }
    send(404, { message: 'not in mock: ' + p });
  });
}).listen(PORT, () => console.log('cloud mock on', PORT));
