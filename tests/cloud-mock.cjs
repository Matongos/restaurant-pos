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
const aalOf = new Map(); // access token -> 'aal1' | 'aal2'
const refreshAal = new Map();
function session(u, aal = 'aal1') {
  const access = `${b64({ alg: 'none' })}.${b64({ sub: u.id, email: u.email, aal })}.${crypto.randomBytes(8).toString('hex')}`;
  const refresh = crypto.randomBytes(12).toString('hex');
  tokens.set(access, u.id); refreshTokens.set(refresh, u.id); aalOf.set(access, aal); refreshAal.set(refresh, aal);
  return { access_token: access, refresh_token: refresh, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: u.id, email: u.email } };
}
// Authenticator codes (RFC 6238), like Supabase's two-step login.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32decode = (t) => { let bits = ''; for (const c of t.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
const totp = (secret, step = Math.floor(Date.now() / 30000)) => { const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step)); const h = crypto.createHmac('sha1', b32decode(secret)).update(msg).digest(); const o = h[h.length - 1] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0'); };
const factors = new Map(); // factor id -> { id, uid, secret, status }
const challenges = new Map();
const payments = []; const adminLog = []; let platform = {};
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
    if (p === '/__plan') { for (const r of restaurants.values()) if (r.slug === url.searchParams.get('slug')) { r.plan = url.searchParams.get('plan'); if (url.searchParams.get('ended')) r.trial_ends_at = new Date(Date.now() - 10 * 864e5).toISOString(); } return send(200, {}); }
    if (p === '/__confirmmode') { if (url.searchParams.get('on') === '1') process.env.CONFIRM = '1'; else delete process.env.CONFIRM; return send(200, {}); }
    if (p === '/__reset') { users.clear(); tokens.clear(); refreshTokens.clear(); restaurants.clear(); members.length = 0; records.clear(); admins.clear(); onlineOrders.length = 0; events.length = 0; payments.length = 0; adminLog.length = 0; factors.clear(); challenges.clear(); platform = {}; return send(200, {}); }
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
      return send(200, session([...users.values()].find((u) => u.id === id), refreshAal.get(body.refresh_token) || 'aal1'));
    }
    if (p === '/auth/v1/logout') { tokens.delete(auth); return send(204); }
    if (p === '/auth/v1/recover') return send(200, {});
    if (p === '/auth/v1/user' && req.method === 'GET') {
      const u = [...users.values()].find((x) => x.id === uid);
      if (!u) return send(401, { msg: 'Invalid JWT' });
      return send(200, { id: u.id, email: u.email, factors: [...factors.values()].filter((f) => f.uid === uid).map((f) => ({ id: f.id, factor_type: 'totp', status: f.status })) });
    }
    if (p === '/auth/v1/factors' && req.method === 'POST') {
      if (!uid) return send(401, { msg: 'Invalid JWT' });
      const secret = Array.from(crypto.randomBytes(20), (b) => B32[b % 32]).join('');
      const f = { id: crypto.randomUUID(), uid, secret, status: 'unverified' }; factors.set(f.id, f);
      return send(200, { id: f.id, type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', secret, uri: 'otpauth://totp/x?secret=' + secret } });
    }
    let fm;
    if ((fm = p.match(/^\/auth\/v1\/factors\/([^/]+)(\/challenge|\/verify)?$/))) {
      const f = factors.get(fm[1]);
      if (!uid || !f || f.uid !== uid) return send(404, { msg: 'Factor not found' });
      if (req.method === 'DELETE') { factors.delete(f.id); return send(200, {}); }
      if (fm[2] === '/challenge') { const c = { id: crypto.randomUUID(), factor: f.id }; challenges.set(c.id, c); return send(200, { id: c.id, expires_at: Date.now() / 1000 + 300 }); }
      if (fm[2] === '/verify') {
        const c = challenges.get(body.challenge_id);
        const step = Math.floor(Date.now() / 30000);
        if (!c || c.factor !== f.id || ![step - 1, step, step + 1].some((t) => totp(f.secret, t) === String(body.code))) return send(422, { error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' });
        challenges.delete(c.id); f.status = 'verified';
        return send(200, session([...users.values()].find((u) => u.id === uid), 'aal2'));
      }
    }
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
        categories: m.categories || [], items: m.items || [], addOns: m.addOns || [], symbol: m.symbol || '$', tagline: m.tagline ?? null, logo: m.logo ?? null, brandColor: m.brandColor ?? null, delivery: m.delivery || { on: false } });
    }
    if (p === '/rest/v1/rpc/place_online_order') {
      const r = bySlug(body.p_slug);
      if (!r || !r.online_orders) return send(400, { code: 'P0001', message: 'This restaurant is not taking online orders' });
      if (!live(r)) return send(400, { code: 'P0001', message: 'The restaurant is offline right now — please order at the counter' });
      if (!/^[0-9+ ()-]{7,20}$/.test(body.p_phone || '')) return send(400, { code: '23514', message: 'phone check failed' });
      if (onlineOrders.filter((o) => o.restaurant_id === r.id && o.phone === body.p_phone.trim() && ['new', 'accepted'].includes(o.status)).length >= 5) return send(400, { code: 'P0001', message: 'Too many open orders for this phone number' });
      const m = menuOf(r); let total = 0; const priced = []; let fee = 0;
      if (body.p_mode === 'delivery') {
        if (!m.delivery?.on) return send(400, { code: 'P0001', message: 'This restaurant does not deliver online orders' });
        if ((body.p_address || '').trim().length < 5) return send(400, { code: 'P0001', message: 'Type the delivery address' });
        fee = Math.max(0, Number(m.delivery.fee) || 0);
      }
      for (const ln of body.p_lines) {
        const it = (m.items || []).find((x) => x.id === ln.itemId);
        if (!it || !it.available) return send(400, { code: 'P0001', message: `Sold out: ${it ? it.name : 'an item'}` });
        const qty = Math.max(1, Math.min(20, ln.qty || 1));
        const unit = it.price + (m.addOns || []).filter((a) => a.available !== false && (ln.extras || []).includes(a.id) && (it.addOnIds || []).includes(a.id)).reduce((t, a) => t + a.price, 0);
        priced.push({ itemId: it.id, name: it.name, qty, unitPrice: unit, extras: ln.extras || [], without: ln.without || [], note: (ln.note || '').slice(0, 120) }); total += qty * unit;
      }
      const n = onlineOrders.filter((o) => o.restaurant_id === r.id).length + 1;
      const o = { id: crypto.randomUUID(), restaurant_id: r.id, number: n, customer_name: body.p_name.trim(), phone: body.p_phone.trim(), mode: body.p_mode || 'pickup', table_name: body.p_table, address: body.p_mode === 'delivery' ? body.p_address.trim() : null, lines: priced, total: Math.round((total + fee) * 100) / 100, delivery_fee: fee, status: 'new', ready_minutes: null, public_token: crypto.randomUUID(), created_at: now(), updated_at: now() };
      onlineOrders.push(o);
      return send(200, { number: o.number, token: o.public_token, total: o.total, deliveryFee: fee });
    }
    if (p === '/rest/v1/rpc/online_order_status') {
      const o = onlineOrders.find((x) => x.public_token === body.p_token);
      if (!o) return send(200, null);
      return send(200, { number: o.number, status: o.status, readyMinutes: o.ready_minutes, total: o.total, lines: o.lines, mode: o.mode, address: o.address, deliveryFee: o.delivery_fee || 0, restaurant: restaurants.get(o.restaurant_id).name, createdAt: o.created_at, updatedAt: o.updated_at });
    }
    if (p === '/rest/v1/rpc/cancel_online_order') { const o = onlineOrders.find((x) => x.public_token === body.p_token && x.status === 'new'); if (o) { o.status = 'cancelled'; o.updated_at = now(); } return send(200, !!o || null); }
    if (p === '/rest/v1/platform_settings') return send(200, [{ data: platform }]);
    if (!uid) return send(401, { code: '42501', message: 'JWT required' });
    const isAdmin = () => admins.has(uid) && aalOf.get(auth) === 'aal2';
    const groupOf = (id) => { const r = restaurants.get(id); return r ? r.group_id || r.id : null; };
    const log = (action, restaurant, detail) => adminLog.unshift({ id: adminLog.length + 1, at: now(), action, restaurant, detail });
    if (p === '/rest/v1/rpc/admin_status') return send(200, { admin: admins.has(uid), aal2: aalOf.get(auth) === 'aal2' });
    if (p === '/rest/v1/rpc/record_payment') {
      if (!isAdmin()) return send(403, { code: '42501', message: 'not allowed' });
      const g = groupOf(body.p_restaurant); const main = restaurants.get(g);
      const cur = main.paid_until ? Date.parse(main.paid_until) : 0;
      const until = body.p_plan === 'free' ? null : new Date(Math.max(cur, Date.now()) + body.p_months * 30.44 * 864e5).toISOString();
      payments.unshift({ id: crypto.randomUUID(), restaurant_id: g, amount: body.p_amount, currency: body.p_currency || 'USD', method: body.p_method, reference: body.p_reference, plan: body.p_plan, months: body.p_months, paid_until: until, note: body.p_note, created_at: now() });
      for (const r of restaurants.values()) if (r.id === g || r.group_id === g) { r.plan = body.p_plan; r.paid_until = until; }
      log('payment', g, { amount: body.p_amount, method: body.p_method, plan: body.p_plan, months: body.p_months, reference: body.p_reference });
      return send(200, until);
    }
    if (p === '/rest/v1/payments') {
      const want = (url.searchParams.get('restaurant_id') || '').replace(/^eq\./, '');
      const mine = new Set([...restaurants.values()].filter((r) => members.some((m) => m.restaurant_id === r.id && m.user_id === uid && m.role !== 'device')).map((r) => r.group_id || r.id));
      return send(200, payments.filter((x) => (isAdmin() || mine.has(x.restaurant_id)) && (!want || x.restaurant_id === want)));
    }
    if (p === '/rest/v1/rpc/admin_set_platform') { if (!isAdmin()) return send(403, { code: '42501', message: 'not allowed' }); platform = body.p_data || {}; log('platform_settings', null, platform); return send(200, null); }
    if (p === '/rest/v1/admin_log') return send(200, isAdmin() ? adminLog : []);
    if (p === '/rest/v1/rpc/admin_delete_restaurant') {
      if (!isAdmin()) return send(403, { code: '42501', message: 'not allowed' });
      const r = restaurants.get(body.p_restaurant);
      if (!r || (body.p_confirm_name || '').trim() !== r.name) return send(400, { code: 'P0001', message: 'The name does not match' });
      log('delete_restaurant', r.id, { name: r.name, slug: r.slug }); restaurants.delete(r.id);
      return send(200, null);
    }
    if (p === '/rest/v1/rpc/console_overview') {
      if (!isAdmin()) return send(403, { code: '42501', message: 'not allowed' });
      const rs = [...restaurants.values()];
      return send(200, { visits: events.filter((e) => e.kind === 'site_visit').length, downloads: events.filter((e) => e.kind === 'download_click').length, firstOpens: events.filter((e) => e.kind === 'first_open').length, signups: rs.length, restaurants: rs.filter((r) => r.plan !== 'closed').length, activeWeek: rs.filter((r) => r.last_seen_at).length, paying: rs.filter((r) => ['restaurant', 'group'].includes(r.plan)).length, monthlyIncome: rs.reduce((t, r) => t + (r.plan === 'restaurant' ? 15 : r.plan === 'group' ? 35 : 0), 0), paidThisMonth: payments.reduce((t, x) => t + Number(x.amount), 0), overdue: rs.filter((r) => r.paid_until && Date.parse(r.paid_until) < Date.now()).length, perDay: [{ day: new Date().toISOString().slice(0, 10), downloads: 2, signups: rs.length }], countries: { ZW: rs.length } });
    }
    if (p === '/rest/v1/rpc/console_restaurants') {
      if (!isAdmin()) return send(403, { code: '42501', message: 'not allowed' });
      return send(200, [...restaurants.values()].map((r) => ({ ...r, owner_email: [...users.values()].find((u) => members.some((m) => m.restaurant_id === r.id && m.user_id === u.id && m.role === 'owner'))?.email, devices: new Set([...records.values()].filter((x) => x.restaurant_id === r.id).map((x) => x.device_id)).size, orders: [...records.values()].filter((x) => x.restaurant_id === r.id && x.kind === 'orders' && !x.deleted).length, online_orders_count: onlineOrders.filter((o) => o.restaurant_id === r.id).length, web_page: !!r.web_page, qr_menu: !!r.qr_menu, online_orders: !!r.online_orders, paid_until: r.paid_until || null, last_payment: payments.find((x) => x.restaurant_id === (r.group_id || r.id))?.created_at || null })));
    }
    if (p === '/rest/v1/rpc/admin_set_plan') {
      if (!isAdmin()) return send(403, { code: '42501', message: 'not allowed' });
      const r = restaurants.get(body.p_restaurant); r.plan = body.p_plan; if (body.p_trial_days != null) r.trial_ends_at = new Date(Date.now() + body.p_trial_days * 864e5).toISOString();
      return send(200, null);
    }
    if (p === '/rest/v1/restaurants') {
      const pick = (r) => ({ name: r.name, slug: r.slug, plan: r.plan, trial_ends_at: r.trial_ends_at, web_page: !!r.web_page, qr_menu: !!r.qr_menu, online_orders: !!r.online_orders, public_info: r.public_info || {}, group_id: r.group_id || null, paid_until: r.paid_until || null });
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
    if (p === '/rest/v1/rpc/create_branch') {
      let m = restaurants.get(body.p_main);
      if (!m) return send(400, { code: 'P0001', message: 'restaurant not found' });
      if (!members.some((x) => x.restaurant_id === m.id && x.user_id === uid && x.role === 'owner')) return send(403, { code: '42501', message: 'Only the owner can add a branch' });
      if (m.group_id && m.group_id !== m.id) m = restaurants.get(m.group_id);
      if (!['trial', 'group', 'free'].includes(m.plan)) return send(400, { code: 'P0001', message: 'Branches come with the Group plan ($35 a month for up to 5 branches). Ask TechPlug to switch your plan.' });
      const n = [...restaurants.values()].filter((r) => r.id === m.id || r.group_id === m.id).length;
      if (n >= 5) return send(400, { code: 'P0001', message: 'The Group plan has up to 5 branches' });
      if ([...restaurants.values()].some((r) => r.slug === body.p_slug)) return send(409, { code: '23505', message: 'duplicate key value violates unique constraint "restaurants_slug_key"' });
      if (!m.group_id) m.group_id = m.id;
      const r = { id: crypto.randomUUID(), name: body.p_name, slug: body.p_slug, town: body.p_town, plan: m.plan, trial_ends_at: m.trial_ends_at, created_at: now(), web_page: false, qr_menu: false, online_orders: false, public_info: {}, group_id: m.id };
      restaurants.set(r.id, r); members.push({ restaurant_id: r.id, user_id: uid, role: 'owner' });
      return send(200, r.id);
    }
    if (p === '/rest/v1/rpc/group_summary') {
      const today = Date.parse(body.p_today), week = Date.parse(body.p_week);
      const mine = [...restaurants.values()].filter((r) => members.some((x) => x.restaurant_id === r.id && x.user_id === uid && x.role !== 'device'));
      return send(200, mine.map((r) => {
        const os = [...records.values()].filter((x) => x.restaurant_id === r.id && x.kind === 'orders' && !x.deleted && Date.parse(x.data.createdAt) >= week && !x.data.training && x.data.status !== 'cancelled');
        const td = os.filter((x) => Date.parse(x.data.createdAt) >= today);
        const sum = (a) => a.reduce((t, x) => t + Number(x.data.total || 0), 0);
        return { id: r.id, name: r.name, slug: r.slug, town: r.town, last_seen_at: r.last_seen_at || null, is_main: r.group_id === r.id, orders_today: td.length, sales_today: sum(td), orders_week: os.length, sales_week: sum(os) };
      }).sort((a, b) => (b.is_main ? 1 : 0) - (a.is_main ? 1 : 0)));
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
