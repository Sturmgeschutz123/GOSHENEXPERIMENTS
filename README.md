# Goshen Farm Operations

A full-stack inventory, sales, and revenue tracking app built with Node.js and SQLite. It has no third-party runtime dependencies. The Node server serves the web app, provides the JSON API, and stores its database locally.

The app uses plain JavaScript with no front-end framework. `server.js` handles the database and requests, `script.js` updates the pages and handles forms, and `index.html` contains the page layout.

## Run locally

1. Install Node.js 22.13 or later.
2. In PowerShell, from this folder, run:

   ```powershell
   npm start
   ```

3. Open <http://127.0.0.1:3000>.
4. On the first run, copy the administrator email and generated password printed in the server console. The password is only shown at account creation.

To choose the first administrator credentials yourself, set these before the first run:

```powershell
$env:ADMIN_EMAIL = "you@example.com"
$env:ADMIN_PASSWORD = "use-a-unique-password-of-at-least-12-characters"
npm start
```

The initial administrator is created only when the database has no users. Passwords are stored as salted scrypt hashes. Do not expose the first-run credentials in shared logs.
Customers can register from the sign-in page with a password of at least 12 characters. Sign in as the administrator and open **Team** to create staff accounts. Staff can manage inventory and customer orders but cannot create accounts. Customers can browse products, place pickup orders, and view only their own order history. Orders reserve stock immediately; staff complete them at pickup or cancel them to return reserved stock.

## Features

- Password-protected administrator access with server-side, expiring sessions.
- Customer self-registration, customer shopping, pickup orders, and private order history.
- Administrator-managed staff accounts with inventory and order-management access.
- Order stock reservations; cancelling an order restores its stock, and completed orders count toward revenue.
- Inventory items with SKU, category, units, quantity, unit price, and low-stock threshold.
- Sales with multiple products, customer, payment method, and price snapshots.
- Atomic stock deductions: a sale is rejected if the requested quantity is not available.
- Dashboard totals, recent sales, inventory alerts, date-range revenue reports, top products, and CSV export.
- SQLite persistence at `.data/goshen.db` by default.

Set `GOSHEN_DB_PATH` to store the database at a different path. Set `PORT` and `HOST` to configure the listener. The default listener is `127.0.0.1`; use a trusted HTTPS reverse proxy for deployment. Set `NODE_ENV=production` behind HTTPS to enable the session cookie's `Secure` attribute. GitHub Pages only hosts static files and cannot run this backend.

The previous Supabase SQL scripts are retained for reference but are not used by this Node.js application.

## Test

```powershell
npm test
```
