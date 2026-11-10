// js/admin.js — administrator console. Full control over customers,
// transactions (any date) and error-message types.
(async function () {
  'use strict';
  const { api, el, fmtEur, fmtDate, groupAccount, requireUser, wireLogout, entryLabel, toast } = Bank;

  const admin = await requireUser('admin');
  if (!admin) return;
  wireLogout(document.getElementById('logoutBtn'));
  document.getElementById('adminName').textContent = admin.name;

  const $ = (id) => document.getElementById(id);
  const dlg = $('dlg');
  let uid = 0;
  let usersCache = [];

  // ---------- small helpers ----------
  function showDialog(title, content, buttons, wide) {
    dlg.classList.toggle('wide', !!wide);
    $('dlgBody').replaceChildren(el('h2', { text: title }), content);
    $('dlgFoot').replaceChildren(...buttons);
    if (!dlg.open) dlg.showModal();
  }
  const closeBtn = () => el('button', { type: 'button', class: 'btn btn-secondary', text: 'Close', onclick: () => dlg.close() });
  const errorBox = () => el('div', { class: 'alert error', role: 'alert', hidden: true });
  const showErr = (box, e) => { box.textContent = e.message; box.hidden = false; };
  function field(labelText, input, hint) {
    input.id = 'f' + (++uid);
    return el('div', { class: 'field' }, el('label', { for: input.id, text: labelText }), input, hint ? el('span', { class: 'hint', text: hint }) : null);
  }
  const secretBox = (lines) =>
    el('div', { class: 'secret-box' },
      ...lines.map(([k, v]) => el('div', {}, el('span', { class: 'muted', text: k + ': ' }), el('span', { class: 'mono', text: v }))),
      el('span', { class: 'muted', text: 'Shown only once. Give it to the customer through a secure channel.' }));
  async function guarded(fn) {
    try { await fn(); } catch (e) {
      if (e.status === 401) return location.replace('index.html');
      toast(e.message, 'error');
    }
  }
  const toLocalInput = (ts) => {
    const d = new Date(ts * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };
  const kindLabel = { opening: 'Opening balance', transfer_in: 'Incoming', transfer_out: 'Outgoing', adjustment: 'Adjustment' };

  // ---------- tabs ----------
  const tabs = [...document.querySelectorAll('.tab')];
  const loaders = { customers: loadUsers, transactions: loadTransactions, messages: loadMessages, limits: loadLimits };
  function selectTab(name) {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
    guarded(loaders[name]);
  }
  tabs.forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));

  // ---------- customers ----------
  async function loadUsers() {
    const { users } = await api('GET', '/api/admin/users');
    usersCache = users;
    const btn = (text, fn, cls) => el('button', { type: 'button', class: 'btn btn-sm ' + (cls || 'btn-secondary'), text, onclick: fn });
    $('usersBody').replaceChildren(...users.map((u) =>
      el('tr', {},
        el('td', { class: 'mono', text: groupAccount(u.account) }),
        el('td', { text: u.name }),
        el('td', {}, el('span', { class: 'badge ' + u.status, text: u.status })),
        el('td', { class: 'num', text: fmtEur(u.balance_cents) }),
        el('td', {}, el('div', { class: 'row-actions' },
          btn('Ledger', () => guarded(() => openLedger(u))),
          btn('Edit', () => editUser(u)),
          btn('Password', () => resetPassword(u)),
          u.status === 'active'
            ? btn('Block', () => setStatus(u, 'blocked'), 'btn-danger')
            : btn('Unblock', () => setStatus(u, 'active')),
          btn('Delete', () => deleteUser(u), 'btn-danger'),
        )),
      )));
  }

  $('createForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('createError');
    err.hidden = true;
    guarded(async () => {
      try {
        const r = await api('POST', '/api/admin/users', {
          name: $('newName').value,
          password: $('newPassword').value,
          account: $('newAccount').value,
        });
        $('createdBox').replaceChildren(secretBox([['Name', r.name], ['Account number', groupAccount(r.account)], ['Password', r.password]]));
        $('createdBox').hidden = false;
        $('createForm').reset();
        loadUsers();
      } catch (ex) {
        if (ex.status === 401) throw ex;
        showErr(err, ex);
      }
    });
  });

  function editUser(u) {
    const name = el('input', { type: 'text', value: u.name, maxlength: '80' });
    const account = el('input', { type: 'text', value: groupAccount(u.account), maxlength: '29' });
    const err = errorBox();
    const save = el('button', {
      type: 'button', class: 'btn', text: 'Save',
      onclick: () => guarded(async () => {
        try {
          await api('PATCH', '/api/admin/users/' + u.id, { name: name.value, account: account.value });
          dlg.close(); toast('Saved'); loadUsers();
        } catch (ex) { if (ex.status === 401) throw ex; showErr(err, ex); }
      }),
    });
    showDialog('Edit customer', el('div', { class: 'form' }, err,
      field('Full name', name),
      field('Account number', account, '6-24 digits or letters')), [closeBtn(), save]);
  }

  function setStatus(u, status) {
    const verb = status === 'blocked' ? 'Block' : 'Unblock';
    if (!confirm(verb + ' ' + u.name + '?')) return;
    guarded(async () => {
      await api('PATCH', '/api/admin/users/' + u.id, { status });
      toast(u.name + ': ' + status);
      loadUsers();
    });
  }

  function deleteUser(u) {
    if (!confirm('Delete ' + u.name + ' and all of their transactions? This cannot be undone.')) return;
    guarded(async () => {
      await api('DELETE', '/api/admin/users/' + u.id);
      toast('Customer deleted');
      loadUsers();
    });
  }

  function resetPassword(u) {
    const pw = el('input', { type: 'text', autocomplete: 'off', placeholder: 'Leave empty to generate' });
    const err = errorBox();
    const save = el('button', {
      type: 'button', class: 'btn', text: 'Reset password',
      onclick: () => guarded(async () => {
        try {
          const r = await api('POST', '/api/admin/users/' + u.id + '/password', { password: pw.value });
          showDialog('Password reset · ' + u.name, secretBox([['New password', r.password]]), [closeBtn()]);
        } catch (ex) { if (ex.status === 401) throw ex; showErr(err, ex); }
      }),
    });
    showDialog('Reset password · ' + u.name, el('div', { class: 'form' },
      el('p', { class: 'muted', text: 'The customer is signed out everywhere.' }), err, field('New password', pw)), [closeBtn(), save]);
  }

  async function openLedger(u) {
    const d = await api('GET', '/api/admin/users/' + u.id + '/ledger');
    const rows = d.entries.map((e) => {
      const l = entryLabel(e);
      return el('tr', {},
        el('td', { text: fmtDate(e.created_at) }),
        el('td', {}, el('div', { text: l.title }), l.sub ? el('div', { class: 'muted', text: l.sub }) : null),
        el('td', { class: 'num', text: fmtEur(e.amount_cents) }),
      );
    });
    showDialog(u.name + ' · ledger', el('div', { class: 'grid-gap' },
      el('p', { class: 'muted', text: 'Balance ' + fmtEur(d.balance_cents) }),
      el('div', { class: 'table-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, el('th', { text: 'Date' }), el('th', { text: 'Entry' }), el('th', { class: 'num', text: 'Amount' }))),
        el('tbody', {}, rows)))), [closeBtn()], true);
  }

  // ---------- transactions ----------
  async function loadTransactions() {
    const filter = $('txFilter').value;
    const path = '/api/admin/transactions?limit=500' + (filter ? '&user_id=' + filter : '');
    const { entries } = await api('GET', path);
    const btn = (text, fn, cls) => el('button', { type: 'button', class: 'btn btn-sm ' + (cls || 'btn-secondary'), text, onclick: fn });
    $('txBody').replaceChildren(...entries.map((e) =>
      el('tr', {},
        el('td', { text: fmtDate(e.created_at) }),
        el('td', { text: e.owner_name + ' (' + groupAccount(e.owner_account) + ')' }),
        el('td', {}, el('span', { class: 'badge neutral', text: kindLabel[e.kind] || e.kind })),
        el('td', { text: e.counterparty_name || '—' }),
        el('td', { class: 'num', text: fmtEur(e.amount_cents) }),
        el('td', { class: 'muted mono', text: e.ref }),
        el('td', {}, el('div', { class: 'row-actions' },
          btn('Edit', () => editTransaction(e)),
          btn('Delete', () => deleteTransaction(e), 'btn-danger'),
        )),
      )));
  }

  $('txRefresh').addEventListener('click', () => guarded(loadTransactions));
  $('txFilter').addEventListener('change', () => guarded(loadTransactions));
  $('txNew').addEventListener('click', () => transactionDialog(null));

  function fillUserSelect(select, selectedId) {
    select.replaceChildren(...usersCache.map((u) =>
      el('option', { value: u.id, text: u.name + ' · ' + groupAccount(u.account) })));
    if (selectedId) select.value = selectedId;
  }

  function transactionDialog(e) {
    const isNew = !e;
    const userSel = el('select', {});
    const kindSel = el('select', {},
      el('option', { value: 'opening', text: 'Opening balance' }),
      el('option', { value: 'transfer_in', text: 'Incoming transfer' }),
      el('option', { value: 'transfer_out', text: 'Outgoing transfer' }),
      el('option', { value: 'adjustment', text: 'Adjustment' }));
    const amount = el('input', { type: 'text', inputmode: 'decimal', placeholder: '250.00 or -40.50', autocomplete: 'off' });
    const cpSel = el('select', {}, el('option', { value: '', text: '— none —' }));
    const description = el('input', { type: 'text', maxlength: '140', placeholder: 'Rent, invoice 42, gift…' });
    const date = el('input', { type: 'datetime-local' });
    const ref = el('input', { type: 'text', maxlength: '40', placeholder: 'Leave empty to generate' });
    const err = errorBox();

    fillUserSelect(userSel, e ? e.user_id : null);
    cpSel.append(...usersCache.map((u) => el('option', { value: u.id, text: u.name })));
    if (e) {
      kindSel.value = e.kind;
      amount.value = (e.amount_cents / 100).toFixed(2);
      cpSel.value = e.counterparty_name ? (usersCache.find((u) => u.name === e.counterparty_name) || {}).id || '' : '';
      description.value = e.description || '';
      date.value = toLocalInput(e.created_at);
      ref.value = e.ref;
    } else {
      date.value = toLocalInput(Math.floor(Date.now() / 1000));
    }

    const save = el('button', {
      type: 'button', class: 'btn', text: isNew ? 'Create transaction' : 'Save changes',
      onclick: () => guarded(async () => {
        const body = {
          user_id: userSel.value,
          kind: kindSel.value,
          amount: amount.value,
          counterparty_id: cpSel.value || undefined,
          description: description.value,
          date: date.value,
          ref: ref.value,
        };
        try {
          if (isNew) await api('POST', '/api/admin/transactions', body);
          else await api('PATCH', '/api/admin/transactions/' + e.id, body);
          dlg.close(); toast(isNew ? 'Transaction created' : 'Transaction saved');
          loadTransactions(); loadUsers();
        } catch (ex) { if (ex.status === 401) throw ex; showErr(err, ex); }
      }),
    });

    showDialog(isNew ? 'New transaction' : 'Edit transaction', el('div', { class: 'form' },
      err,
      field('Customer', userSel),
      field('Type', kindSel),
      field('Amount (EUR)', amount, 'Sign is set automatically by the type.'),
      field('Counterparty', cpSel, 'Only for transfers.'),
      field('Description', description),
      field('Date & time', date, 'Any date — past or present.'),
      field('Reference', ref, 'Unique ID of the entry. Leave empty to generate.'),
    ), [closeBtn(), save], true);
  }

  function editTransaction(e) { transactionDialog(e); }

  function deleteTransaction(e) {
    if (!confirm('Delete this transaction (' + fmtEur(e.amount_cents) + ' · ' + (kindLabel[e.kind] || e.kind) + ')?')) return;
    guarded(async () => {
      await api('DELETE', '/api/admin/transactions/' + e.id);
      toast('Transaction deleted');
      loadTransactions(); loadUsers();
    });
  }

  // ---------- error message types ----------
  async function loadMessages() {
    const { messages } = await api('GET', '/api/admin/messages');
    const btn = (text, fn, cls) => el('button', { type: 'button', class: 'btn btn-sm ' + (cls || 'btn-secondary'), text, onclick: fn });
    $('messagesList').replaceChildren(...messages.map((m) => {
      const ta = el('textarea', { maxlength: '300', rows: '2', 'aria-label': 'Message for ' + m.code, text: m.text });
      const err = errorBox();
      const save = el('button', {
        type: 'button', class: 'btn btn-sm', text: 'Save',
        onclick: () => guarded(async () => {
          try {
            await api('PUT', '/api/admin/messages', { code: m.code, text: ta.value });
            toast('Message saved');
          } catch (ex) { if (ex.status === 401) throw ex; showErr(err, ex); }
        }),
      });
      const del = DEFAULT_MESSAGES[m.code] ? null : btn('Delete', () => {
        if (!confirm('Delete message type ' + m.code + '?')) return;
        guarded(async () => {
          await api('DELETE', '/api/admin/messages/' + m.code);
          toast('Message type deleted');
          loadMessages();
        });
      }, 'btn-danger');
      return el('div', { class: 'msg-card' },
        el('div', { class: 'section-header' }, el('h3', { text: m.code }), el('div', { class: 'msg-actions' }, save, del)),
        el('p', { class: 'muted', text: m.description }),
        ta, err,
        m.placeholders && m.placeholders.length
          ? el('div', { class: 'chips' }, ...m.placeholders.map((p) => el('span', { class: 'chip', text: '{' + p + '}' })))
          : null,
        el('p', { class: 'hint muted', text: 'Default: ' + m.default }),
      );
    }));
  }

  $('msgNew').addEventListener('click', () => {
    const code = el('input', { type: 'text', maxlength: '40', placeholder: 'e.g. CARD_LIMIT_EXCEEDED' });
    const text = el('textarea', { maxlength: '300', rows: '3', placeholder: 'Text shown to the customer…' });
    const desc = el('input', { type: 'text', maxlength: '300', placeholder: 'Internal description (optional)' });
    const err = errorBox();
    const save = el('button', {
      type: 'button', class: 'btn', text: 'Create message type',
      onclick: () => guarded(async () => {
        try {
          await api('POST', '/api/admin/messages', { code: code.value, text: text.value, description: desc.value });
          dlg.close(); toast('Message type created'); loadMessages();
        } catch (ex) { if (ex.status === 401) throw ex; showErr(err, ex); }
      }),
    });
    showDialog('New error message type', el('div', { class: 'form' },
      err,
      field('Code', code, 'A-Z, 0-9, underscore. Example: CARD_LIMIT_EXCEEDED'),
      field('Message text', text, 'Placeholders like {limit} are filled in automatically.'),
      field('Description', desc),
    ), [closeBtn(), save]);
  });

  // ---------- limits ----------
  async function loadLimits() {
    const s = await api('GET', '/api/admin/settings');
    $('singleLimit').value = (s.single_limit_cents / 100).toFixed(2);
    $('dailyLimit').value = (s.daily_limit_cents / 100).toFixed(2);
  }

  $('limitsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('limitsError');
    err.hidden = true;
    guarded(async () => {
      try {
        await api('PUT', '/api/admin/settings', { single_limit: $('singleLimit').value, daily_limit: $('dailyLimit').value });
        toast('Limits saved');
      } catch (ex) { if (ex.status === 401) throw ex; showErr(err, ex); }
    });
  });

  selectTab('customers');
})();
