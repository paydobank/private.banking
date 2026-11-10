// js/store.js — fully editable data layer. The administrator can create, edit
// and delete users, transactions (past and present) and error-message types.
// Everything is stored in the browser (localStorage); no server required.
(function () {
  'use strict';

  const DB_KEY = 'paydo_core_v2';
  const SESSION_KEY = 'paydo_sid_v2';
  const SESSION_TTL = 8 * 3600;

  const DEFAULT_SETTINGS = { single_limit_cents: 5000000, daily_limit_cents: 10000000 };

  // code -> [text, description, placeholders]
  const DEFAULT_MESSAGES = {
    INSUFFICIENT_FUNDS: [
      "Insufficient funds on the account. Available balance: {balance}.",
      "The amount is larger than the sender's balance.", ['balance']],
    SINGLE_LIMIT_EXCEEDED: [
      "The amount exceeds the per-transfer limit of {limit}.",
      "The amount is above the single-transfer limit.", ['limit']],
    DAILY_LIMIT_EXCEEDED: [
      "The daily transfer limit of {limit} would be exceeded. Remaining today: {remaining}.",
      "Transfers in the last 24 hours plus this one are above the daily limit.", ['limit', 'remaining']],
    RECIPIENT_NOT_FOUND: [
      "The recipient account was not found. Please check the account number.",
      "No active customer account has this number.", []],
    RECIPIENT_BLOCKED: [
      "The recipient account cannot receive transfers at the moment.",
      "The recipient account is blocked.", []],
    ACCOUNT_BLOCKED: [
      "Your account is blocked. Please contact support.",
      "The sender (or the user logging in) is blocked.", []],
    SAME_ACCOUNT: [
      "You cannot transfer funds to your own account.",
      "Sender and recipient are the same account.", []],
    INVALID_AMOUNT: [
      "Please enter a valid amount (for example 125.50).",
      "The amount is missing, zero, negative or has too many decimals.", []],
  };

  // ---- helpers -----------------------------------------------------------
  function hashPassword(password, salt) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    const s = salt + '::' + password;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  function randHex(n) {
    return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  function randToken(n) {
    const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => a[b % 64]).join('');
  }
  const now = () => Math.floor(Date.now() / 1000);

  function freshDb() {
    return {
      seq: { user: 1, ledger: 1 },
      users: [], ledger: [], sessions: [],
      settings: { ...DEFAULT_SETTINGS }, messages: null,
    };
  }

  let db = null;
  try { db = JSON.parse(localStorage.getItem(DB_KEY)) || null; } catch (e) { db = null; }
  if (!db || !Array.isArray(db.users) || !db.users.length) {
    db = freshDb();
    seed();
    db.messages = {};
    for (const [code, [text, desc]] of Object.entries(DEFAULT_MESSAGES)) {
      db.messages[code] = { text, description: desc };
    }
    persist();
  }
  if (!db.messages) {
    db.messages = {};
    for (const [code, [text, desc]] of Object.entries(DEFAULT_MESSAGES)) {
      db.messages[code] = { text, description: desc };
    }
    persist();
  }

  function persist() { localStorage.setItem(DB_KEY, JSON.stringify(db)); }

  function pushEntry(uid, kind, cents, description, counterpartyId, ref, createdBy, at) {
    const id = db.seq.ledger++;
    db.ledger.push({
      id, user_id: uid, kind, amount_cents: cents,
      description: description || '', counterparty_id: counterpartyId || null,
      ref, created_by: createdBy || null, created_at: at || now(),
    });
    return id;
  }

  function transferSeed(fromId, toId, cents, description, daysAgo) {
    const at = now() - daysAgo * 86400;
    const ref = 'tr-' + randHex(8);
    pushEntry(fromId, 'transfer_out', -cents, description, toId, ref, null, at);
    pushEntry(toId, 'transfer_in', cents, description, fromId, ref, null, at);
  }

  function seed() {
    const t = now() - 90 * 86400;
    const addUser = (account, name, role, password) => {
      const id = db.seq.user++;
      const salt = randHex(8);
      db.users.push({
        id, account, name, role, status: 'active',
        pw_salt: salt, pw_hash: hashPassword(password, salt), created_at: t,
      });
      return id;
    };

    addUser('770123458901', 'Elena Marsh', 'admin', 'Tundra-4821-Marsh');
    const volkov = addUser('482199007312', 'Alexander Volkov', 'user', 'Sable-9142-Volkov');
    const rossi = addUser('905344172288', 'Maria Rossi', 'user', 'Cobalt-5520-Rossi');

    pushEntry(volkov, 'opening', 25420000, 'Opening balance', null, 'open-' + randHex(6), null, t);
    pushEntry(rossi, 'opening', 1000000, 'Opening balance', null, 'open-' + randHex(6), null, t);

    transferSeed(volkov, rossi, 120000, 'Rent — October', 20);
    transferSeed(rossi, volkov, 25000, 'Dinner split', 12);
  }

  // ---- shared helpers -----------------------------------------------------
  const byId = (uid) => db.users.find((u) => u.id === uid);
  const publicUser = (u) => ({ id: u.id, name: u.name, account: u.account, role: u.role, status: u.status });
  const balanceOf = (uid) => db.ledger.filter((l) => l.user_id === uid)
    .reduce((sum, l) => sum + l.amount_cents, 0);

  function entryView(l) {
    const cp = l.counterparty_id ? byId(l.counterparty_id) : null;
    return {
      id: l.id, user_id: l.user_id, kind: l.kind, amount_cents: l.amount_cents,
      description: l.description, counterparty_name: cp ? cp.name : '',
      ref: l.ref, created_at: l.created_at,
    };
  }
  const userEntries = (uid, limit) => db.ledger
    .filter((l) => l.user_id === uid).sort((a, b) => b.id - a.id)
    .slice(0, limit).map(entryView);

  const eur = (cents) => (cents / 100).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function renderMessage(code, values) {
    let text = (db.messages[code] && db.messages[code].text) || (DEFAULT_MESSAGES[code] || [''])[0] || code;
    for (const [k, v] of Object.entries(values || {})) text = text.split('{' + k + '}').join(v);
    return text;
  }

  function cleanText(value, maxLen, minLen, field) {
    const s = String(value == null ? '' : value).replace(/[\x00-\x1f\x7f]/g, ' ').trim();
    if (s.length < minLen || s.length > maxLen) {
      throw apiErr(400, 'INVALID_INPUT', field + ' must be ' + minLen + '-' + maxLen + ' characters.');
    }
    return s;
  }

  function parseAmount(value, signed) {
    const s = String(value == null ? '' : value).trim().replace(',', '.');
    if (!/^[+-]?\d{1,10}(\.\d{1,2})?$/.test(s)) throw new Error('bad amount');
    if (s[0] === '-' && !signed) throw new Error('bad amount');
    const cents = Math.round(parseFloat(s) * 100);
    if (!isFinite(cents) || cents === 0) throw new Error('bad amount');
    return cents;
  }

  function parseTimestamp(value) {
    const s = String(value == null ? '' : value).trim();
    if (!s) return now();
    const t = Math.floor(new Date(s).getTime() / 1000);
    if (!isFinite(t)) throw new Error('bad date');
    return t;
  }

  function normalizeAccount(value) {
    const v = String(value == null ? '' : value).replace(/[\s-]/g, '').toUpperCase();
    return /^[0-9A-Z]{6,24}$/.test(v) ? v : '';
  }

  function newAccountNumber() {
    let n;
    do { n = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b % 10).join(''); }
    while (db.users.some((u) => u.account === n));
    return n;
  }

  function apiErr(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }

  // ---- sessions -----------------------------------------------------------
  const sessionToken = () => localStorage.getItem(SESSION_KEY);

  function currentUser() {
    const t = sessionToken();
    if (!t) return null;
    const s = db.sessions.find((x) => x.token_hash === hashPassword(t, 'session'));
    if (!s || s.expires_at < now()) return null;
    return byId(s.user_id) || null;
  }

  function dropSessions(uid) { db.sessions = db.sessions.filter((s) => s.user_id !== uid); }

  const fails = {};
  function throttleCheck(key, limit) {
    const t = now();
    const recent = (fails[key] || []).filter((x) => t - x < 900);
    fails[key] = recent;
    if (recent.length >= limit) {
      throw apiErr(429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Please try again in a few minutes.');
    }
  }
  const throttleFail = (key) => { (fails[key] = fails[key] || []).push(now()); };

  // ---- routes -------------------------------------------------------------
  const routes = [];
  const route = (method, pattern, auth, fn) => routes.push({ method, re: new RegExp('^' + pattern + '$'), auth, fn });

  route('GET', '/api/config', null, () => ({ brand: BankConfig.brand }));

  route('POST', '/api/login', null, (ctx, body) => {
    const account = normalizeAccount(body.account);
    const password = String(body.password || '');
    throttleCheck('local|' + account, 5);
    throttleCheck('local', 30);
    const user = account ? db.users.find((u) => u.account === account) : null;
    if (!user || user.pw_hash !== hashPassword(password, user.pw_salt)) {
      throttleFail('local|' + account);
      throttleFail('local');
      persist();
      throw apiErr(401, 'INVALID_CREDENTIALS', 'Invalid account number or password.');
    }
    if (user.status !== 'active') throw apiErr(403, 'ACCOUNT_BLOCKED', renderMessage('ACCOUNT_BLOCKED'));
    const t = randToken(32);
    db.sessions = db.sessions.filter((s) => s.expires_at >= now());
    db.sessions.push({ token_hash: hashPassword(t, 'session'), user_id: user.id, created_at: now(), expires_at: now() + SESSION_TTL });
    persist();
    localStorage.setItem(SESSION_KEY, t);
    return { user: publicUser(user) };
  });

  route('POST', '/api/logout', null, () => {
    const t = sessionToken();
    if (t) db.sessions = db.sessions.filter((s) => s.token_hash !== hashPassword(t, 'session'));
    localStorage.removeItem(SESSION_KEY);
    persist();
    return { ok: true };
  });

  route('GET', '/api/me', 'any', (ctx) => ({ user: publicUser(ctx.user), config: { brand: BankConfig.brand } }));

  route('GET', '/api/dashboard', 'user', (ctx) => {
    const uid = ctx.user.id, t = now();
    const sum = (kind, since) => db.ledger
      .filter((l) => l.user_id === uid && l.kind === kind && l.created_at >= since)
      .reduce((s, l) => s + l.amount_cents, 0);
    const used24 = -sum('transfer_out', t - 86400);
    return {
      user: publicUser(ctx.user),
      balance_cents: balanceOf(uid),
      received_30d_cents: sum('transfer_in', t - 30 * 86400),
      sent_30d_cents: -sum('transfer_out', t - 30 * 86400),
      daily_remaining_cents: Math.max(0, db.settings.daily_limit_cents - used24),
      single_limit_cents: db.settings.single_limit_cents,
      daily_limit_cents: db.settings.daily_limit_cents,
      entries: userEntries(uid, 20),
    };
  });

  route('GET', '/api/transactions', 'user', (ctx, _b, q) => {
    let limit = parseInt(q.limit || '200', 10);
    if (!isFinite(limit)) limit = 200;
    return { entries: userEntries(ctx.user.id, Math.max(1, Math.min(500, limit))) };
  });

  route('POST', '/api/transfer', 'user', (ctx, body) => {
    const recipientAcc = normalizeAccount(body.recipient_account);
    const reference = cleanText(body.reference || '', 140, 0, 'Reference');
    const fail = (code, values) => { throw apiErr(422, code, renderMessage(code, values)); };
    let cents;
    try { cents = parseAmount(body.amount); } catch (e) { fail('INVALID_AMOUNT'); }
    const sender = byId(ctx.user.id);
    if (sender.status !== 'active') fail('ACCOUNT_BLOCKED');
    const recipient = recipientAcc ? db.users.find((u) => u.account === recipientAcc && u.role === 'user') : null;
    if (!recipient) fail('RECIPIENT_NOT_FOUND');
    if (recipient.id === sender.id) fail('SAME_ACCOUNT');
    if (recipient.status !== 'active') fail('RECIPIENT_BLOCKED');
    if (cents > db.settings.single_limit_cents) {
      fail('SINGLE_LIMIT_EXCEEDED', { limit: '€' + eur(db.settings.single_limit_cents) });
    }
    const t = now();
    const used = -db.ledger
      .filter((l) => l.user_id === sender.id && l.kind === 'transfer_out' && l.created_at >= t - 86400)
      .reduce((s, l) => s + l.amount_cents, 0);
    if (used + cents > db.settings.daily_limit_cents) {
      fail('DAILY_LIMIT_EXCEEDED', {
        limit: '€' + eur(db.settings.daily_limit_cents),
        remaining: '€' + eur(Math.max(0, db.settings.daily_limit_cents - used)),
      });
    }
    if (balanceOf(sender.id) - cents < 0) {
      fail('INSUFFICIENT_FUNDS', { balance: '€' + eur(balanceOf(sender.id)) });
    }
    const ref = 'tr-' + randHex(8);
    pushEntry(sender.id, 'transfer_out', -cents, reference, recipient.id, ref, null);
    pushEntry(recipient.id, 'transfer_in', cents, reference, sender.id, ref, null);
    persist();
    return { ok: true, amount_cents: cents, recipient_name: recipient.name, balance_cents: balanceOf(sender.id) };
  });

  // ---- admin: customers ----------------------------------------------------
  const targetUser = (id) => {
    const u = byId(id);
    if (!u) throw apiErr(404, 'NOT_FOUND', 'Customer not found.');
    return u;
  };

  route('GET', '/api/admin/users', 'admin', () => ({
    users: db.users.filter((u) => u.role === 'user')
      .map((u) => ({ ...publicUser(u), balance_cents: balanceOf(u.id) })),
  }));

  route('POST', '/api/admin/users', 'admin', (ctx, body) => {
    const name = cleanText(body.name, 80, 1, 'Name');
    let password = String(body.password || '');
    if (password && (password.length < 8 || password.length > 200)) {
      throw apiErr(400, 'WEAK_PASSWORD', 'Password must be between 8 and 200 characters.');
    }
    if (!password) password = randToken(9);
    const id = db.seq.user++;
    const salt = randHex(8);
    const account = body.account ? normalizeAccount(body.account) : newAccountNumber();
    if (!account) throw apiErr(400, 'INVALID_INPUT', 'Account number must be 6-24 digits/letters.');
    if (db.users.some((u) => u.account === account)) {
      throw apiErr(409, 'DUPLICATE', 'This account number is already in use.');
    }
    db.users.push({
      id, account, name, role: 'user', status: 'active',
      pw_salt: salt, pw_hash: hashPassword(password, salt), created_at: now(),
    });
    persist();
    return { id, name, account, password };
  });

  route('PATCH', '/api/admin/users/(\\d+)', 'admin', (ctx, body, _q, m) => {
    const u = targetUser(parseInt(m[1], 10));
    if (body.name !== undefined) u.name = cleanText(body.name, 80, 1, 'Name');
    if (body.account !== undefined) {
      const acc = normalizeAccount(body.account);
      if (!acc) throw apiErr(400, 'INVALID_INPUT', 'Account number must be 6-24 digits/letters.');
      if (db.users.some((x) => x.account === acc && x.id !== u.id)) {
        throw apiErr(409, 'DUPLICATE', 'This account number is already in use.');
      }
      u.account = acc;
    }
    if (body.status !== undefined && ['active', 'blocked'].includes(body.status)) {
      u.status = body.status;
      dropSessions(u.id);
    }
    persist();
    return { ok: true };
  });

  route('DELETE', '/api/admin/users/(\\d+)', 'admin', (ctx, _b, _q, m) => {
    const u = targetUser(parseInt(m[1], 10));
    if (u.role === 'admin') throw apiErr(400, 'INVALID_INPUT', 'Administrators cannot be deleted.');
    db.users = db.users.filter((x) => x.id !== u.id);
    db.ledger = db.ledger.filter((l) => l.user_id !== u.id && l.counterparty_id !== u.id);
    dropSessions(u.id);
    persist();
    return { ok: true };
  });

  route('POST', '/api/admin/users/(\\d+)/password', 'admin', (ctx, body, _q, m) => {
    const u = targetUser(parseInt(m[1], 10));
    const password = String(body.password || '') || randToken(9);
    if (password.length < 8 || password.length > 200) {
      throw apiErr(400, 'WEAK_PASSWORD', 'Password must be between 8 and 200 characters.');
    }
    u.pw_salt = randHex(8);
    u.pw_hash = hashPassword(password, u.pw_salt);
    dropSessions(u.id);
    persist();
    return { password };
  });

  route('GET', '/api/admin/users/(\\d+)/ledger', 'admin', (_ctx, _b, _q, m) => {
    const u = targetUser(parseInt(m[1], 10));
    return {
      user: { id: u.id, name: u.name, account: u.account },
      balance_cents: balanceOf(u.id),
      entries: userEntries(u.id, 500),
    };
  });

  // ---- admin: transactions (full CRUD, any date) ---------------------------
  route('GET', '/api/admin/transactions', 'admin', (_ctx, _b, q) => {
    let limit = parseInt(q.limit || '500', 10);
    if (!isFinite(limit)) limit = 500;
    const uid = q.user_id ? parseInt(q.user_id, 10) : null;
    let list = db.ledger.slice().sort((a, b) => b.id - a.id);
    if (uid) list = list.filter((l) => l.user_id === uid || l.counterparty_id === uid);
    return {
      entries: list.slice(0, Math.max(1, Math.min(1000, limit))).map((l) => {
        const v = entryView(l);
        const owner = byId(l.user_id);
        v.owner_name = owner ? owner.name : '—';
        v.owner_account = owner ? owner.account : '';
        return v;
      }),
    };
  });

  route('POST', '/api/admin/transactions', 'admin', (ctx, body) => {
    const user = targetUser(parseInt(body.user_id, 10) || 0);
    const kind = String(body.kind || '');
    if (!['opening', 'transfer_in', 'transfer_out', 'adjustment'].includes(kind)) {
      throw apiErr(400, 'INVALID_INPUT', 'Choose a valid entry type.');
    }
    let cents;
    try { cents = parseAmount(body.amount, true); } catch (e) {
      throw apiErr(400, 'INVALID_AMOUNT', 'Enter a non-zero amount such as 250.00 or -40.50.');
    }
    // Normalise sign by kind so the balance always stays consistent.
    if (kind === 'transfer_out' && cents > 0) cents = -cents;
    if ((kind === 'transfer_in' || kind === 'opening') && cents < 0) cents = -cents;
    if (kind === 'transfer_out' && balanceOf(user.id) + cents < 0) {
      throw apiErr(409, 'NEGATIVE_BALANCE', 'This entry would make the balance negative.');
    }
    const description = cleanText(body.description || '', 140, 0, 'Description');
    let counterpartyId = null;
    if (body.counterparty_id) counterpartyId = targetUser(parseInt(body.counterparty_id, 10)).id;
    const at = parseTimestamp(body.date);
    const ref = body.ref ? cleanText(body.ref, 40, 3, 'Reference') : ('man-' + randHex(8));
    if (db.ledger.some((l) => l.ref === ref)) {
      throw apiErr(409, 'DUPLICATE', 'A transaction with this reference already exists.');
    }
    pushEntry(user.id, kind, cents, description, counterpartyId, ref, ctx.user.id, at);
    persist();
    return { ok: true, id: db.seq.ledger - 1 };
  });

  route('PATCH', '/api/admin/transactions/(\\d+)', 'admin', (ctx, body, _q, m) => {
    const l = db.ledger.find((x) => x.id === parseInt(m[1], 10));
    if (!l) throw apiErr(404, 'NOT_FOUND', 'Transaction not found.');
    if (body.user_id !== undefined) l.user_id = targetUser(parseInt(body.user_id, 10)).id;
    if (body.kind !== undefined) {
      const kind = String(body.kind);
      if (!['opening', 'transfer_in', 'transfer_out', 'adjustment'].includes(kind)) {
        throw apiErr(400, 'INVALID_INPUT', 'Choose a valid entry type.');
      }
      l.kind = kind;
    }
    if (body.amount !== undefined) {
      let cents;
      try { cents = parseAmount(body.amount, true); } catch (e) {
        throw apiErr(400, 'INVALID_AMOUNT', 'Enter a non-zero amount such as 250.00 or -40.50.');
      }
      if (l.kind === 'transfer_out' && cents > 0) cents = -cents;
      if ((l.kind === 'transfer_in' || l.kind === 'opening') && cents < 0) cents = -cents;
      l.amount_cents = cents;
    } else {
      // Re-normalise sign if only the kind changed.
      if (l.kind === 'transfer_out' && l.amount_cents > 0) l.amount_cents = -l.amount_cents;
      if ((l.kind === 'transfer_in' || l.kind === 'opening') && l.amount_cents < 0) l.amount_cents = -l.amount_cents;
    }
    if (balanceOf(l.user_id) < 0) {
      throw apiErr(409, 'NEGATIVE_BALANCE', 'This change would make the balance negative.');
    }
    if (body.description !== undefined) l.description = cleanText(body.description, 140, 0, 'Description');
    if (body.counterparty_id !== undefined) {
      l.counterparty_id = body.counterparty_id ? targetUser(parseInt(body.counterparty_id, 10)).id : null;
    }
    if (body.date !== undefined) l.created_at = parseTimestamp(body.date);
    if (body.ref !== undefined) l.ref = cleanText(body.ref, 40, 3, 'Reference');
    persist();
    return { ok: true };
  });

  route('DELETE', '/api/admin/transactions/(\\d+)', 'admin', (ctx, _b, _q, m) => {
    const id = parseInt(m[1], 10);
    const l = db.ledger.find((x) => x.id === id);
    if (!l) throw apiErr(404, 'NOT_FOUND', 'Transaction not found.');
    db.ledger = db.ledger.filter((x) => x.id !== id);
    if (balanceOf(l.user_id) < 0) {
      // Re-insert to avoid a negative balance, then complain.
      db.ledger.push(l);
      db.ledger.sort((a, b) => a.id - b.id);
      throw apiErr(409, 'NEGATIVE_BALANCE', 'Deleting this would make the balance negative.');
    }
    persist();
    return { ok: true };
  });

  // ---- admin: error message types (full CRUD) -------------------------------
  route('GET', '/api/admin/messages', 'admin', () => ({
    messages: Object.keys(db.messages).sort().map((code) => ({
      code,
      text: db.messages[code].text,
      description: db.messages[code].description,
      placeholders: DEFAULT_MESSAGES[code] ? DEFAULT_MESSAGES[code][2] : [],
      default: DEFAULT_MESSAGES[code] ? DEFAULT_MESSAGES[code][0] : '',
    })),
  }));

  route('POST', '/api/admin/messages', 'admin', (ctx, body) => {
    const code = String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!/^[A-Z][A-Z0-9_]{2,39}$/.test(code)) {
      throw apiErr(400, 'INVALID_INPUT', 'Code must be 3-40 characters: A-Z, 0-9, underscore, starting with a letter.');
    }
    if (db.messages[code]) throw apiErr(409, 'DUPLICATE', 'This code already exists.');
    const text = cleanText(body.text, 300, 5, 'Message');
    const description = cleanText(body.description || '', 300, 0, 'Description');
    db.messages[code] = { text, description };
    persist();
    return { ok: true, code };
  });

  route('PUT', '/api/admin/messages', 'admin', (ctx, body) => {
    const code = String(body.code || '');
    const text = cleanText(body.text, 300, 5, 'Message');
    if (!db.messages[code]) throw apiErr(404, 'NOT_FOUND', 'Unknown message code.');
    db.messages[code].text = text;
    persist();
    return { ok: true };
  });

  route('PATCH', '/api/admin/messages/(\\w+)', 'admin', (ctx, body, _q, m) => {
    const code = m[1];
    if (!db.messages[code]) throw apiErr(404, 'NOT_FOUND', 'Unknown message code.');
    if (body.text !== undefined) db.messages[code].text = cleanText(body.text, 300, 5, 'Message');
    if (body.description !== undefined) db.messages[code].description = cleanText(body.description, 300, 0, 'Description');
    persist();
    return { ok: true };
  });

  route('DELETE', '/api/admin/messages/(\\w+)', 'admin', (ctx, _b, _q, m) => {
    const code = m[1];
    if (DEFAULT_MESSAGES[code]) {
      throw apiErr(400, 'INVALID_INPUT', 'Built-in message types cannot be deleted, only edited.');
    }
    if (!db.messages[code]) throw apiErr(404, 'NOT_FOUND', 'Unknown message code.');
    delete db.messages[code];
    persist();
    return { ok: true };
  });

  route('GET', '/api/admin/settings', 'admin', () => ({ ...db.settings }));

  route('PUT', '/api/admin/settings', 'admin', (ctx, body) => {
    let single, daily;
    try {
      single = parseAmount(body.single_limit);
      daily = parseAmount(body.daily_limit);
    } catch (e) {
      throw apiErr(400, 'INVALID_AMOUNT', 'Enter limits as amounts such as 50000 or 50000.00.');
    }
    if (daily < single) {
      throw apiErr(400, 'INVALID_INPUT', 'The daily limit cannot be lower than the per-transfer limit.');
    }
    db.settings.single_limit_cents = single;
    db.settings.daily_limit_cents = daily;
    persist();
    return { ok: true };
  });

  // ---- dispatcher ------------------------------------------------------------
  function request(method, rawPath, body) {
    const qIndex = rawPath.indexOf('?');
    const path = qIndex === -1 ? rawPath : rawPath.slice(0, qIndex);
    const q = {};
    if (qIndex !== -1) {
      rawPath.slice(qIndex + 1).split('&').forEach((kv) => {
        const [k, v] = kv.split('=');
        if (k) q[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
    }
    const found = routes.find((r) => r.method === method && r.re.test(path));
    if (!found) throw apiErr(404, 'NOT_FOUND', 'Not found.');
    const ctx = { user: currentUser() };
    if (found.auth) {
      if (!ctx.user) throw apiErr(401, 'UNAUTHENTICATED', 'Please sign in.');
      if ((found.auth === 'user' || found.auth === 'admin') && ctx.user.role !== found.auth) {
        throw apiErr(403, 'FORBIDDEN', 'You do not have access to this page.');
      }
    }
    return found.fn(ctx, body || {}, q, path.match(found.re));
  }

  window.BankStore = { request };
})();
