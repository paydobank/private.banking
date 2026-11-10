(function () {
  'use strict';

  const DB_KEY = 'paydo_core_v2';
  const SESSION_KEY = 'paydo_sid_v2';
  const SESSION_TTL = 8 * 3600;

  const DEFAULT_SETTINGS = { single_limit_cents: 5000000, daily_limit_cents: 10000000 };

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
