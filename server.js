"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SESSION_COOKIE = "goshen_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/script.js": ["script.js", "text/javascript; charset=utf-8"],
  "/styles (1).css": ["styles (1).css", "text/css; charset=utf-8"]
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64);
}

function sendJson(response, status, data, headers) {
  response.writeHead(status, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }, headers || {}));
  response.end(JSON.stringify(data));
}

function parseCookies(header) {
  const cookies = {};
  for (const part of (header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0) {
      cookies[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
    }
  }
  return cookies;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Expected an object.");
    }
    return body;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function requireString(value, label, maxLength, allowEmpty) {
  if (typeof value !== "string") throw new HttpError(400, label + " is required.");
  const clean = value.trim();
  if ((!allowEmpty && !clean) || clean.length > maxLength) {
    throw new HttpError(400, label + " must be " + (allowEmpty ? "at most " : "between 1 and ") + maxLength + " characters.");
  }
  return clean;
}

function requireInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new HttpError(400, label + " must be a whole number between " + minimum + " and " + maximum + ".");
  }
  return value;
}

function priceToCents(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10000000) {
    throw new HttpError(400, "Price must be a number from 0 to 10,000,000.");
  }
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 0.000001) {
    throw new HttpError(400, "Price must have no more than two decimal places.");
  }
  return cents;
}

function normalizeInventory(body) {
  return {
    name: requireString(body.name, "Name", 80, false),
    sku: requireString(body.sku === undefined ? "" : body.sku, "SKU", 40, true),
    category: requireString(body.category, "Category", 50, false),
    unit: requireString(body.unit, "Unit", 20, false),
    quantity: requireInteger(body.quantity, "Quantity", 0, 10000000),
    priceCents: priceToCents(body.price),
    lowStockThreshold: requireInteger(body.lowStockThreshold, "Low-stock threshold", 0, 10000000)
  };
}

function normalizeDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, label + " must be a date in YYYY-MM-DD format.");
  }
  const parsed = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, label + " is not a valid date.");
  }
  return value;
}

function createApp(options) {
  options = options || {};
  const dbPath = options.dbPath || process.env.GOSHEN_DB_PATH || path.join(__dirname, ".data", "goshen.db");
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash BLOB NOT NULL,
      password_salt BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'each',
      quantity INTEGER NOT NULL CHECK(quantity >= 0),
      price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
      low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK(low_stock_threshold >= 0),
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_sku_unique_idx
      ON inventory(sku COLLATE NOCASE) WHERE sku <> '';
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL,
      total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sales_created_at_idx ON sales(created_at);
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0)
    );
    CREATE INDEX IF NOT EXISTS sale_items_sale_idx ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS sale_items_inventory_idx ON sale_items(inventory_id);
  `);

  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  let adminCredentials = null;
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (userCount === 0) {
    const email = String(options.adminEmail || process.env.ADMIN_EMAIL || "admin@goshen.local").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      db.close();
      throw new Error("ADMIN_EMAIL must be a valid email address.");
    }
    const password = options.adminPassword || process.env.ADMIN_PASSWORD || crypto.randomBytes(18).toString("base64url");
    if (typeof password !== "string" || password.length < 12 || password.length > 256) {
      db.close();
      throw new Error("ADMIN_PASSWORD must contain between 12 and 256 characters.");
    }
    const salt = crypto.randomBytes(16);
    const passwordHash = hashPassword(password, salt);
    db.prepare("INSERT INTO users (email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?)")
      .run(email, passwordHash, salt, new Date().toISOString());
    adminCredentials = { email, password };
    if (options.logger !== null) {
      (options.logger || console.log)("First-time Goshen admin account: " + email + " / " + password);
      (options.logger || console.log)("Save these credentials now; the password is not stored in plain text.");
    }
  }

  const statements = {
    userByEmail: db.prepare("SELECT id, email, password_hash, password_salt FROM users WHERE email = ?"),
    userById: db.prepare("SELECT id, email FROM users WHERE id = ?"),
    inventoryList: db.prepare("SELECT id, name, sku, category, unit, quantity, price_cents, low_stock_threshold FROM inventory ORDER BY name COLLATE NOCASE"),
    inventoryById: db.prepare("SELECT id, name, sku, category, unit, quantity, price_cents, low_stock_threshold FROM inventory WHERE id = ?"),
    insertInventory: db.prepare("INSERT INTO inventory (name, sku, category, unit, quantity, price_cents, low_stock_threshold, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    updateInventory: db.prepare("UPDATE inventory SET name = ?, sku = ?, category = ?, unit = ?, quantity = ?, price_cents = ?, low_stock_threshold = ? WHERE id = ?"),
    deleteInventory: db.prepare("DELETE FROM inventory WHERE id = ?"),
    salesList: db.prepare(`
      SELECT s.id, s.customer, s.payment_method, s.total_cents, s.created_at,
        group_concat(si.product_name || ' × ' || si.quantity, ', ') AS item_summary
      FROM sales s JOIN sale_items si ON si.sale_id = s.id
      GROUP BY s.id ORDER BY s.created_at DESC LIMIT 100
    `),
    summary: db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM inventory) AS products,
        (SELECT COALESCE(SUM(quantity), 0) FROM inventory) AS units,
        (SELECT COUNT(*) FROM inventory WHERE quantity <= low_stock_threshold) AS low_stock,
        (SELECT COALESCE(SUM(total_cents), 0) FROM sales) AS total_revenue_cents,
        (SELECT COUNT(*) FROM sales WHERE created_at >= ? AND created_at < ?) AS today_sales,
        (SELECT COALESCE(SUM(total_cents), 0) FROM sales WHERE created_at >= ? AND created_at < ?) AS today_revenue_cents
    `),
    insertSession: db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"),
    sessionByHash: db.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?")
  };

  function getCurrentUser(request) {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const session = statements.sessionByHash.get(tokenHash);
    if (!session) return null;
    if (session.expires_at <= Date.now()) {
      statements.deleteSession.run(tokenHash);
      return null;
    }
    return statements.userById.get(session.user_id) || null;
  }

  function requireUser(request) {
    const user = getCurrentUser(request);
    if (!user) throw new HttpError(401, "Please sign in to continue.");
    return user;
  }

  function validateOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) return;
    try {
      if (new URL(origin).host !== request.headers.host) throw new Error("Mismatched host.");
    } catch {
      throw new HttpError(403, "Cross-origin requests are not allowed.");
    }
  }

  function handleApi(request, response, url) {
    return (async function () {
      const method = request.method;
      const pathname = url.pathname;
      if (method === "POST") validateOrigin(request);

      if (method === "GET" && pathname === "/api/session") {
        const user = getCurrentUser(request);
        sendJson(response, 200, { user: user ? { email: user.email } : null });
        return;
      }

      if (method === "POST" && pathname === "/api/login") {
        const body = await readJson(request);
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const password = typeof body.password === "string" ? body.password : "";
        if (email.length > 254 || password.length > 256) throw new HttpError(400, "Enter a valid email and password.");
        const user = statements.userByEmail.get(email);
        if (!user || !crypto.timingSafeEqual(hashPassword(password, user.password_salt), user.password_hash)) {
          throw new HttpError(401, "Email or password is incorrect.");
        }
        db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const expiresAt = Date.now() + SESSION_DURATION_MS;
        statements.insertSession.run(tokenHash, user.id, expiresAt);
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        sendJson(response, 200, { user: { email: user.email } }, {
          "Set-Cookie": SESSION_COOKIE + "=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + Math.floor(SESSION_DURATION_MS / 1000) + secure
        });
        return;
      }

      if (method === "POST" && pathname === "/api/logout") {
        const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
        if (token && /^[a-f0-9]{64}$/.test(token)) {
          statements.deleteSession.run(crypto.createHash("sha256").update(token).digest("hex"));
        }
        sendJson(response, 200, { ok: true }, {
          "Set-Cookie": SESSION_COOKIE + "=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
        });
        return;
      }

      if (!pathname.startsWith("/api/")) return false;
      requireUser(request);

      if (method === "GET" && pathname === "/api/inventory") {
        const items = statements.inventoryList.all().map(toInventory);
        const query = (url.searchParams.get("q") || "").trim().toLowerCase();
        sendJson(response, 200, {
          items: query ? items.filter((item) => item.name.toLowerCase().includes(query) || item.category.toLowerCase().includes(query) || item.sku.toLowerCase().includes(query)) : items
        });
        return;
      }

      if (method === "POST" && pathname === "/api/inventory") {
        const item = normalizeInventory(await readJson(request));
        try {
          const result = statements.insertInventory.run(item.name, item.sku, item.category, item.unit, item.quantity, item.priceCents, item.lowStockThreshold, new Date().toISOString());
          sendJson(response, 201, { item: toInventory(statements.inventoryById.get(Number(result.lastInsertRowid))) });
        } catch (error) {
          if (String(error.message).includes("inventory.sku")) throw new HttpError(409, "That SKU is already in use.");
          throw error;
        }
        return;
      }

      const itemMatch = pathname.match(/^\/api\/inventory\/(\d+)$/);
      if (itemMatch && (method === "PUT" || method === "DELETE")) {
        const id = Number(itemMatch[1]);
        if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, "Invalid inventory item.");
        if (!statements.inventoryById.get(id)) throw new HttpError(404, "Inventory item not found.");
        if (method === "DELETE") {
          try {
            statements.deleteInventory.run(id);
          } catch (error) {
            if (String(error.message).includes("FOREIGN KEY constraint failed")) {
              throw new HttpError(409, "This item is part of a recorded sale and cannot be deleted.");
            }
            throw error;
          }
          sendJson(response, 200, { ok: true });
          return;
        }
        const item = normalizeInventory(await readJson(request));
        try {
          statements.updateInventory.run(item.name, item.sku, item.category, item.unit, item.quantity, item.priceCents, item.lowStockThreshold, id);
        } catch (error) {
          if (String(error.message).includes("inventory.sku")) throw new HttpError(409, "That SKU is already in use.");
          throw error;
        }
        sendJson(response, 200, { item: toInventory(statements.inventoryById.get(id)) });
        return;
      }

      if (method === "GET" && pathname === "/api/summary") {
        const start = new Date();
        start.setUTCHours(0, 0, 0, 0);
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        const summary = statements.summary.get(start.toISOString(), end.toISOString(), start.toISOString(), end.toISOString());
        sendJson(response, 200, {
          products: summary.products,
          units: summary.units,
          lowStock: summary.low_stock,
          totalRevenueCents: summary.total_revenue_cents,
          todaySales: summary.today_sales,
          todayRevenueCents: summary.today_revenue_cents
        });
        return;
      }

      if (method === "GET" && pathname === "/api/sales") {
        const rows = statements.salesList.all();
        sendJson(response, 200, { sales: rows.map((sale) => ({
          id: sale.id,
          customer: sale.customer,
          paymentMethod: sale.payment_method,
          totalCents: sale.total_cents,
          createdAt: sale.created_at,
          itemSummary: sale.item_summary
        })) });
        return;
      }

      if (method === "POST" && pathname === "/api/sales") {
        const body = await readJson(request);
        const customer = requireString(body.customer === undefined ? "" : body.customer, "Customer", 80, true);
        const methods = ["Cash", "Card", "Bank transfer", "Other"];
        if (!methods.includes(body.paymentMethod)) throw new HttpError(400, "Choose a valid payment method.");
        if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 50) {
          throw new HttpError(400, "A sale must contain between 1 and 50 items.");
        }
        const quantities = new Map();
        for (const line of body.lines) {
          if (!line || typeof line !== "object" || Array.isArray(line)) throw new HttpError(400, "Sale item is invalid.");
          const productId = requireInteger(line.productId, "Product ID", 1, Number.MAX_SAFE_INTEGER);
          const quantity = requireInteger(line.quantity, "Sale quantity", 1, 10000000);
          quantities.set(productId, (quantities.get(productId) || 0) + quantity);
        }

        db.exec("BEGIN IMMEDIATE");
        let sale;
        try {
          const lineItems = [];
          let totalCents = 0;
          for (const [productId, quantity] of quantities) {
            const item = statements.inventoryById.get(productId);
            if (!item) throw new HttpError(404, "An item in this sale no longer exists.");
            if (item.quantity < quantity) throw new HttpError(409, item.name + " only has " + item.quantity + " " + item.unit + " in stock.");
            totalCents += item.price_cents * quantity;
            if (!Number.isSafeInteger(totalCents)) throw new HttpError(400, "Sale total is too large.");
            lineItems.push({ item, quantity });
          }
          const createdAt = new Date().toISOString();
          const result = db.prepare("INSERT INTO sales (customer, payment_method, total_cents, created_at) VALUES (?, ?, ?, ?)")
            .run(customer, body.paymentMethod, totalCents, createdAt);
          const saleId = Number(result.lastInsertRowid);
          const insertLine = db.prepare("INSERT INTO sale_items (sale_id, inventory_id, product_name, quantity, unit_price_cents) VALUES (?, ?, ?, ?, ?)");
          const reduceStock = db.prepare("UPDATE inventory SET quantity = quantity - ? WHERE id = ? AND quantity >= ?");
          for (const line of lineItems) {
            const stockChange = reduceStock.run(line.quantity, line.item.id, line.quantity);
            if (Number(stockChange.changes) !== 1) throw new HttpError(409, line.item.name + " no longer has enough stock.");
            insertLine.run(saleId, line.item.id, line.item.name, line.quantity, line.item.price_cents);
          }
          sale = { id: saleId, totalCents, createdAt };
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        sendJson(response, 201, { sale });
        return;
      }

      if (method === "GET" && pathname === "/api/reports") {
        const now = new Date();
        const to = normalizeDate(url.searchParams.get("to") || now.toISOString().slice(0, 10), "End date");
        const defaultFrom = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const from = normalizeDate(url.searchParams.get("from") || defaultFrom, "Start date");
        const fromTime = Date.parse(from + "T00:00:00.000Z");
        const toTime = Date.parse(to + "T00:00:00.000Z");
        if (fromTime > toTime) throw new HttpError(400, "Start date must be on or before end date.");
        if (toTime - fromTime > 366 * 24 * 60 * 60 * 1000) throw new HttpError(400, "Date range cannot be longer than one year.");
        const afterTo = new Date(toTime + 24 * 60 * 60 * 1000).toISOString();
        const dailyRows = db.prepare(`
          SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS sales, COALESCE(SUM(total_cents), 0) AS revenue_cents
          FROM sales WHERE created_at >= ? AND created_at < ? GROUP BY date ORDER BY date
        `).all(from + "T00:00:00.000Z", afterTo);
        const dailyByDate = new Map(dailyRows.map((row) => [row.date, row]));
        const daily = [];
        for (let time = fromTime; time <= toTime; time += 24 * 60 * 60 * 1000) {
          const date = new Date(time).toISOString().slice(0, 10);
          const row = dailyByDate.get(date);
          daily.push({ date, sales: row ? row.sales : 0, revenueCents: row ? row.revenue_cents : 0 });
        }
        const totals = db.prepare("SELECT COUNT(*) AS sales, COALESCE(SUM(total_cents), 0) AS revenue_cents FROM sales WHERE created_at >= ? AND created_at < ?")
          .get(from + "T00:00:00.000Z", afterTo);
        const topProducts = db.prepare(`
          SELECT product_name AS name, SUM(quantity) AS quantity, SUM(quantity * unit_price_cents) AS revenue_cents
          FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE s.created_at >= ? AND s.created_at < ?
          GROUP BY product_name ORDER BY revenue_cents DESC, quantity DESC LIMIT 10
        `).all(from + "T00:00:00.000Z", afterTo);
        sendJson(response, 200, {
          from,
          to,
          totalSales: totals.sales,
          totalRevenueCents: totals.revenue_cents,
          daily: daily.map((row) => ({ date: row.date, sales: row.sales, revenueCents: row.revenueCents })),
          topProducts: topProducts.map((row) => ({ name: row.name, quantity: row.quantity, revenueCents: row.revenue_cents }))
        });
        return;
      }

      throw new HttpError(404, "API endpoint not found.");
    })();
  }

  function toInventory(row) {
    return {
      id: row.id,
      name: row.name,
      sku: row.sku,
      category: row.category,
      unit: row.unit,
      quantity: row.quantity,
      priceCents: row.price_cents,
      lowStockThreshold: row.low_stock_threshold
    };
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      handleApi(request, response, url)
        .then((handled) => {
          if (handled === false && !response.headersSent) sendJson(response, 404, { error: "API endpoint not found." });
        })
        .catch((error) => {
          if (response.headersSent) {
            response.destroy();
            return;
          }
          if (error instanceof HttpError) {
            sendJson(response, error.status, { error: error.message });
            return;
          }
          if (String(error.message).includes("inventory.sku")) {
            sendJson(response, 409, { error: "That SKU is already in use." });
            return;
          }
          (options.logger || console.error)("Request failed:", error);
          sendJson(response, 500, { error: "An internal server error occurred." });
        });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      sendJson(response, 400, { error: "Invalid URL." });
      return;
    }
    const asset = STATIC_FILES[pathname];
    if (!asset) {
      sendJson(response, 404, { error: "Page not found." });
      return;
    }
    const file = path.join(__dirname, asset[0]);
    response.writeHead(200, {
      "Content-Type": asset[1],
      "Cache-Control": "no-cache",
      "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY"
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    fs.createReadStream(file).pipe(response);
  });

  return { server, db, adminCredentials };
}

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  app.server.listen(port, host, () => {
    console.log("Goshen Farm Operations is running at http://" + host + ":" + port);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => app.server.close(() => {
      app.db.close();
      process.exit(0);
    }));
  }
}

module.exports = { createApp };
