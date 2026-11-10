// js/dashboard.js — customer dashboard.
(function () {
  'use strict';
  const { api, applyConfig, requireUser, wireLogout, fmtEur, fmtDate, entryLabel, el } = window.Bank;

  let currentUser = null;

  async function init() {
    currentUser = await requireUser('user');
    if (!currentUser) return;

    document.getElementById('userName').textContent = currentUser.name;
    wireLogout(document.getElementById('logoutBtn'));

    await loadDashboard();
    document.getElementById('csvBtn').addEventListener('click', downloadCsv);
  }

  async function loadDashboard() {
    try {
      const data = await api('GET', '/api/dashboard');
      document.getElementById('balance').textContent = fmtEur(data.balance_cents);
      document.getElementById('received').textContent = fmtEur(data.received_30d_cents);
      document.getElementById('sent').textContent = fmtEur(data.sent_30d_cents);
      document.getElementById('dailyRemaining').textContent = fmtEur(data.daily_remaining_cents);

      const list = document.getElementById('transactionsList');
      list.innerHTML = '';
      if (!data.entries.length) {
        list.append(el('p', { class: 'muted', text: 'No transactions yet.' }));
        return;
      }
      data.entries.forEach((e) => {
        const info = entryLabel(e);
        const row = el('div', { class: 'transaction' },
          el('div', { class: 'transaction-info' },
            el('div', { class: 'transaction-title', text: info.title }),
            el('div', { class: 'transaction-sub', text: (info.sub || '') + ' · ' + fmtDate(e.created_at) })
          ),
          el('div', {
            class: 'transaction-amount ' + (e.amount_cents >= 0 ? 'positive' : 'negative'),
            text: (e.amount_cents >= 0 ? '+' : '') + fmtEur(e.amount_cents)
          })
        );
        list.append(row);
      });
    } catch (err) {
      window.Bank.toast(err.message, 'error');
    }
  }

  async function downloadCsv() {
    try {
      const data = await api('GET', '/api/transactions?limit=500');
      const rows = [['Date', 'Type', 'Counterparty', 'Description', 'Amount (EUR)', 'Reference']];
      data.entries.forEach((e) => {
        rows.push([
          fmtDate(e.created_at),
          e.kind,
          e.counterparty_name || '',
          e.description || '',
          (e.amount_cents / 100).toFixed(2),
          e.ref || ''
        ]);
      });
      const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'statement_' + currentUser.account + '.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      window.Bank.toast(err.message, 'error');
    }
  }

  init();
})();
