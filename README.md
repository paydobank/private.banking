# PayDo — Online Banking

Client-side online banking with a fully editable back office. The administrator
controls everything: customers, transactions (past and present) and the error
messages customers see. Pure HTML/CSS/JavaScript — no build step, no server,
no dependencies. Data is stored in the browser (localStorage).

## Run

Open `index.html` in a browser, or deploy the folder to any static host
(GitHub Pages, Netlify, Vercel…). For GitHub Pages: push the repository,
then enable Pages in **Settings → Pages** with the root folder as the source.

Sign-in page: `index.html` · Customer dashboard: `dashboard.html` ·
New transfer: `transfer.html` · Administrator console: `admin.html`.

## Accounts (created on first launch)

| Role | Name | Account | Password |
|------|------|---------|----------|
| Administrator | Elena Marsh | 7701 2345 8901 | `Tundra-4821-Marsh` |
| Customer | Alexander Volkov | 4821 9900 7312 | `Sable-9142-Volkov` |
| Customer | Maria Rossi | 9053 4417 2288 | `Cobalt-5520-Rossi` |

To wipe all data and start over, run `localStorage.clear()` in the browser
console and reload the page.

## What the administrator can do (`admin.html`)

**Customers** — create (custom name, account number, password), rename,
change the account number, block/unblock, reset passwords, delete a customer
together with their transactions.

**Transactions** — create, edit and delete any entry: opening balance,
incoming/outgoing transfers, adjustments. Any date and time, past or present.
Amount sign is set automatically by the entry type. Filter the list by
customer.

**Error messages** — edit the text of every built-in error type, or create
your own types with placeholders like `{limit}` and `{balance}`. Custom types
can be deleted again; built-in ones cannot.

**Limits** — per-transfer limit and rolling 24-hour limit.

## Customise

- Product name: `js/config.js` (variable `BRAND`) — applied everywhere.
- Initial customers, balances and history: `js/store.js`, function `seed()`.
- Default error texts: `DEFAULT_MESSAGES` in `js/store.js`.
- Default limits: `DEFAULT_SETTINGS` in `js/store.js`.
- Colours and theme: CSS variables at the top of `css/style.css`.

## Files

`index.html` sign in · `dashboard.html` customer area · `transfer.html` new
transfer · `admin.html` administrator console · `css/style.css` theme ·
`js/config.js` product name · `js/store.js` data layer (users, transactions,
sessions, limits, message types) · `js/api.js` shared helpers ·
`js/auth.js`, `js/dashboard.js`, `js/transfer.js`, `js/admin.js` page logic.
