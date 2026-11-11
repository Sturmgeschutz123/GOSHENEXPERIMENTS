"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createApp } = require("./server");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "goshen-farm-test-"));
const app = createApp({
  dbPath: path.join(directory, "test.db"),
  adminEmail: "owner@example.com",
  adminPassword: "test-password-long-enough",
  logger: null
});
let baseUrl;
let cookie;

before(async () => {
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  baseUrl = "http://127.0.0.1:" + app.server.address().port;
});

after(async () => {
  await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  app.db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

async function api(url, options) {
  options = options || {};
  options.headers = Object.assign({}, options.headers || {});
  if (cookie) options.headers.Cookie = cookie;
  if (options.body) options.headers["Content-Type"] = "application/json";
  const response = await fetch(baseUrl + url, options);
  return { response, data: await response.json() };
}

test("protects the API and authenticates the configured administrator", async () => {
  const unauthorized = await api("/api/inventory");
  assert.equal(unauthorized.response.status, 401);

  const invalid = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ email: "owner@example.com", password: "wrong-password" })
  });
  assert.equal(invalid.response.status, 401);

  const login = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ email: "OWNER@example.com", password: "test-password-long-enough" })
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.user.email, "owner@example.com");
  cookie = login.response.headers.get("set-cookie").split(";")[0];
});

test("records inventory and sales atomically, then reports revenue", async () => {
  const created = await api("/api/inventory", {
    method: "POST",
    body: JSON.stringify({
      name: "Organic carrots",
      sku: "CARROT-01",
      category: "Produce",
      unit: "bunch",
      quantity: 10,
      price: 2.5,
      lowStockThreshold: 3
    })
  });
  assert.equal(created.response.status, 201);
  const item = created.data.item;
  assert.equal(item.priceCents, 250);
  assert.equal(item.quantity, 10);

  const sale = await api("/api/sales", {
    method: "POST",
    body: JSON.stringify({
      customer: "Market customer",
      paymentMethod: "Cash",
      lines: [
        { productId: item.id, quantity: 2 },
        { productId: item.id, quantity: 2 }
      ]
    })
  });
  assert.equal(sale.response.status, 201);
  assert.equal(sale.data.sale.totalCents, 1000);

  const inventory = await api("/api/inventory");
  assert.equal(inventory.data.items[0].quantity, 6);

  const oversell = await api("/api/sales", {
    method: "POST",
    body: JSON.stringify({
      customer: "",
      paymentMethod: "Cash",
      lines: [{ productId: item.id, quantity: 7 }]
    })
  });
  assert.equal(oversell.response.status, 409);
  assert.match(oversell.data.error, /only has 6/);
  assert.equal((await api("/api/inventory")).data.items[0].quantity, 6);

  const summary = await api("/api/summary");
  assert.equal(summary.data.totalRevenueCents, 1000);
  assert.equal(summary.data.todaySales, 1);
  assert.equal(summary.data.units, 6);

  const sales = await api("/api/sales");
  assert.equal(sales.data.sales.length, 1);
  assert.equal(sales.data.sales[0].itemSummary, "Organic carrots × 4");

  const date = new Date().toISOString().slice(0, 10);
  const report = await api("/api/reports?from=" + date + "&to=" + date);
  assert.equal(report.data.totalSales, 1);
  assert.equal(report.data.totalRevenueCents, 1000);
  assert.equal(report.data.daily[0].revenueCents, 1000);
  assert.equal(report.data.topProducts[0].quantity, 4);

  const cannotDeleteSoldItem = await api("/api/inventory/" + item.id, { method: "DELETE" });
  assert.equal(cannotDeleteSoldItem.response.status, 409);
});

test("rejects duplicate SKUs and invalid report dates", async () => {
  const first = await api("/api/inventory", {
    method: "POST",
    body: JSON.stringify({
      name: "Farm eggs", sku: "EGG-01", category: "Dairy", unit: "dozen",
      quantity: 4, price: 6, lowStockThreshold: 1
    })
  });
  assert.equal(first.response.status, 201);

  const duplicate = await api("/api/inventory", {
    method: "POST",
    body: JSON.stringify({
      name: "Eggs duplicate", sku: "egg-01", category: "Dairy", unit: "dozen",
      quantity: 2, price: 6, lowStockThreshold: 1
    })
  });
  assert.equal(duplicate.response.status, 409);

  const invalidDate = await api("/api/reports?from=2026-02-31&to=2026-03-01");
  assert.equal(invalidDate.response.status, 400);
});

test("serves the app and clears the session on logout", async () => {
  const page = await fetch(baseUrl + "/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Record a sale/);

  const logout = await api("/api/logout", { method: "POST" });
  assert.equal(logout.response.status, 200);
  cookie = null;
  assert.equal((await api("/api/inventory")).response.status, 401);
});
