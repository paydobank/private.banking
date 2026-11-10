// js/admin.js — administration panel.
(function () {
  'use strict';
  const { api, applyConfig, requireUser, wireLogout, fmtEur, fmtDate, el } = window.Bank;

  let currentUser = null;

  async function init() {
    currentUser = await requireUser('admin');
    if (!currentUser) return;

    document.getElementById('adminName').textContent = currentUser.name;
    wireLogout(document.getElementById('logoutBtn'));

    initTabs();
    initCustomersTab();
    initTransactionsTab();
    initMessagesTab();
    initLimitsTab();
  }

  function initTabs() {
    const tabs = document.querySelectorAll('.tab');
    const panels = document.querySelectorAll('[data-panel]');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.setAttribute('aria-selected', 'false'));
        panels.forEach((p) => p.hidden = true);
        tab.setAttribute('aria-selected', 'true');
        const panel = document.querySelector('[data-panel="' + tab.dataset.tab + '"]');
        if (panel) panel.hidden = false;
      });
    });
  }

  // ---- Customers ----
  function initCustomersTab() {
    const list = document.getElementById('customersList');
    const addBtn = document.getElementById('addCustomerBtn');
    const dialog = document.getElementById('customerDialog');
    const form = document.getElementById('customerForm');
    const errorBox = document.getElementById('customerError');
    const saveBtn = document.getElementById('customerSaveBtn');
    const cancelBtn = document.getElementById('customerCancelBtn');

    async function refresh() {
      try {
        const data = await api('GET', '/api/admin/users');
        list.innerHTML = '';
        if (!data.users.length) {
          list.append(el('p', { class: 'muted', text: 'No customers yet.' }));
          return;
        }
        const table = el('table', { class: 'admin-table' });
        table.innerHTML = '<thead><tr><th>Name</th><th>Account</th><th>Balance</th><th>Status</th><th></th></tr></thead>';
        const tbody = el('tbody');
        data.users.forEach((u) => {
          const row = el('tr', {},
            el('td', { text: u.name }),
            el('td', { text: u.account }),
            el('td', { text: fmtEur(u.balance_cents) }),
            el('td', { text: u.status }),
            el('td', {},
              el('button', { class: 'btn btn-sm', text: 'Edit', onclick: () => openEdit(u) }),
              ' ',
              el('button', { class: 'btn btn-sm btn-secondary', text: 'Delete', onclick: () => deleteUser(u) })
            )
          );
          tbody.append(row);
        });
        table.append(tbody);
        list.append(table);
      } catch (err) {
        window.Bank.toast(err.message, 'error');
      }
    }

    function openEdit(u) {
      document.getElementById('customerId').value = u.id;
      document.getElementById('customerName').value = u.name;
      document.getElementById('customerAccount').value = u.account;
      document.getElementById('customerPassword').value = '';
      document.getElementById('customerStatus').value = u.status;
      errorBox.hidden = true;
      dialog.showModal();
    }

    function openAdd() {
      document.getElementById('customerId').value = '';
      document.getElementById('customerName').value = '';
      document.getElementById('customerAccount').value = '';
      document.getElementById('customerPassword').value = '';
      document.getElementById('customerStatus').value = 'active';
      errorBox.hidden = true;
      dialog.showModal();
    }

    async function deleteUser(u) {
      if (!confirm('Delete customer ' + u.name + '? This cannot be undone.')) return;
      try {
        await api('DELETE', '/api/admin/users/' + u.id);
        refresh();
      } catch (err) {
        window.Bank.toast(err.message, 'error');
      }
    }

    addBtn.addEventListener('click', openAdd);
    cancelBtn.addEventListener('click', () => dialog.close());
    saveBtn.addEventListener('click', async () => {
      const id = document.getElementById('customerId').value;
      const body = {
        name: document.getElementById('customerName').value.trim(),
        account: document.getElementById('customerAccount').value.trim(),
        password: document.getElementById('customerPassword').value,
        status: document.getElementById('customerStatus').value,
      };
      try {
        if (id) {
          await api('PATCH', '/api/admin/users/' + id, body);
          if (body.password) {
            await api('POST', '/api/admin/users/' + id + '/password', { password: body.password });
          }
        } else {
          const res = await api('POST', '/api/admin/users', body);
          alert('Customer created.\nAccount: ' + res.account + '\nPassword: ' + res.password);
        }
        dialog.close();
        refresh();
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      }
    });

    refresh();
  }

  // ---- Transactions ----
  function initTransactionsTab() {
    const list = document.getElementById('transactionsList');
    const addBtn = document.getElementById('addTransactionBtn');

    async function refresh() {
      try {
        const data = await api('GET', '/api/admin/transactions');
        list.innerHTML = '';
        if (!data.entries.length) {
          list.append(el('p', { class: 'muted', text: 'No transactions.' }));
          return;
        }
        const table = el('table', { class: 'admin-table' });
        table.innerHTML = '<thead><tr><th>Date</th><th>Owner</th><th>Type</th><th>Counterparty</th><th>Amount</th><th>Description</th><th>Ref</th></tr></thead>';
        const tbody = el('tbody');
        data.entries.forEach((e) => {
          tbody.append(el('tr', {},
            el('td', { text: fmtDate(e.created_at) }),
            el('td', { text: e.owner_name }),
            el('td', { text: e.kind }),
            el('td', { text: e.counterparty_name || '—' }),
            el('td', { text: fmtEur(e.amount_cents) }),
            el('td', { text: e.description || '' }),
            el('td', { text: e.ref || '' })
          ));
        });
        table.append(tbody);
        list.append(table);
      } catch (err) {
        window.Bank.toast(err.message, 'error');
      }
    }

    addBtn.addEventListener('click', async () => {
      const userId = prompt('User ID:');
      const kind = prompt('Type (opening / transfer_in / transfer_out / adjustment):');
      const amount = prompt('Amount (e.g. 250.00 or -40.50):');
      const description = prompt('Description:') || '';
      if (!userId || !kind || !amount) return;
      try {
        await api('POST', '/api/admin/transactions', { user_id: userId, kind, amount, description });
        refresh();
      } catch (err) {
        window.Bank.toast(err.message, 'error');
      }
    });

    refresh();
  }

  // ---- Messages ----
  function initMessagesTab() {
    const list = document.getElementById('messagesList');
    const addBtn = document.getElementById('addMessageBtn');

    async function refresh() {
      try {
        const data = await api('GET', '/api/admin/messages');
        list.innerHTML = '';
        const table = el('table', { class: 'admin-table' });
        table.innerHTML = '<thead><tr><th>Code</th><th>Text</th><th></th></tr></thead>';
        const tbody = el('tbody');
        data.messages.forEach((m) => {
          tbody.append(el('tr', {},
            el('td', { text: m.code }),
            el('td', { text: m.text }),
            el('td', {},
              el('button', { class: 'btn btn-sm', text: 'Edit', onclick: () => editMessage(m) })
            )
          ));
        });
        table.append(tbody);
        list.append(table);
      } catch (err) {
        window.Bank.toast(err.message, 'error');
      }
    }

    async function editMessage(m) {
      const newText = prompt('New text for ' + m.code + ':', m.text);
      if (!newText) return;
      try {
        await api('PUT', '/api/admin/messages', { code: m.code, text: newText });
        refresh();
      } catch (err) {
        window.Bank.toast(err.message, 'error');
      }
    }

    addBtn.addEventListener('click', async () => {
      const code = prompt('New message code (e.g. CUSTOM_ERROR):');
      const text = prompt('Message text:');
      if (!code || !text) return;
      try {
        await api('POST', '/api/admin/messages', { code, text });
        refresh();
      } catch (err) {
        window.Bank.toast(err.message, 'error');
      }
    });

    refresh();
  }

  // ---- Limits ----
  function initLimitsTab() {
    const form = document.getElementById('limitsForm');
    const errorBox = document.getElementById('limitsError');
    const singleInput = document.getElementById('singleLimit');
    const dailyInput = document.getElementById('dailyLimit');

    async function load() {
      try {
        const data = await api('GET', '/api/admin/settings');
        singleInput.value = (data.single_limit_cents / 100).toFixed(2);
        dailyInput.value = (data.daily_limit_cents / 100).toFixed(2);
      } catch (err) {
        window.Bank.toast(err.message, 'error');
      }
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      try {
        await api('PUT', '/api/admin/settings', {
          single_limit: singleInput.value,
          daily_limit: dailyInput.value,
        });
        window.Bank.toast('Limits saved.', 'success');
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      }
    });

    load();
  }

  init();
})();
