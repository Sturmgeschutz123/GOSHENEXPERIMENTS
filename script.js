(function () {
  "use strict";

  var loginView = document.getElementById("login-view");
  var appView = document.getElementById("app-view");
  var loginError = document.getElementById("login-error");
  var appError = document.getElementById("app-error");
  var inventory = [];
  var sales = [];
  var editingId = null;
  var reportData = null;

  function request(url, options) {
    options = options || {};
    options.credentials = "same-origin";
    options.headers = Object.assign({}, options.headers || {});
    if (options.body) options.headers["Content-Type"] = "application/json";
    return fetch(url, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || "The request could not be completed.");
        return data;
      });
    });
  }

  function showAppError(message) {
    appError.textContent = message || "";
    appError.hidden = !message;
  }

  function dollars(cents) {
    return "$" + (Number(cents || 0) / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function dateLabel(value) {
    return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function switchPage(name) {
    document.querySelectorAll("[data-page]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.page === name);
      button.setAttribute("aria-current", button.dataset.page === name ? "page" : "false");
    });
    document.querySelectorAll(".page-panel").forEach(function (panel) {
      panel.hidden = panel.id !== name + "-page";
    });
    var labels = { dashboard: "Dashboard", inventory: "Inventory", sales: "Sales", reports: "Reports" };
    document.getElementById("page-title").textContent = labels[name];
    showAppError("");
    if (name === "reports") loadReport();
  }

  function enterApp(user) {
    loginView.hidden = true;
    appView.hidden = false;
    document.getElementById("signed-in-user").textContent = user.email;
    switchPage("dashboard");
    return Promise.all([loadSummary(), loadInventory(), loadSales()]);
  }

  function loadSummary() {
    return request("/api/summary").then(function (data) {
      document.getElementById("summary-products").textContent = data.products;
      document.getElementById("summary-units").textContent = data.units.toLocaleString();
      document.getElementById("summary-low-stock").textContent = data.lowStock;
      document.getElementById("summary-today").textContent = dollars(data.todayRevenueCents);
      document.getElementById("summary-today-count").textContent =
        data.todaySales + (data.todaySales === 1 ? " sale today" : " sales today");
      document.getElementById("summary-revenue").textContent = dollars(data.totalRevenueCents);
    }).catch(showAppError);
  }

  function loadInventory() {
    return request("/api/inventory").then(function (data) {
      inventory = data.items;
      renderInventory();
      populateSaleProducts();
    }).catch(showAppError);
  }

  function loadSales() {
    return request("/api/sales").then(function (data) {
      sales = data.sales;
      renderSales();
      renderRecentSales();
    }).catch(showAppError);
  }

  function renderInventory() {
    var query = document.getElementById("inventory-search").value.trim().toLowerCase();
    var filtered = inventory.filter(function (item) {
      return item.name.toLowerCase().includes(query) || item.category.toLowerCase().includes(query);
    });
    var body = document.getElementById("inventory-list");
    body.replaceChildren();
    filtered.forEach(function (item) {
      var row = document.createElement("tr");
      var status = item.quantity === 0 ? "Out of stock" : item.quantity <= item.lowStockThreshold ? "Low stock" : "In stock";
      var statusClass = item.quantity === 0 || item.quantity <= item.lowStockThreshold ? "low" : "in-stock";
      row.innerHTML =
        '<td><strong class="item-name"></strong><small class="table-subtitle"></small></td>' +
        '<td class="category-cell"></td><td></td><td></td>' +
        '<td><span class="status"></span></td>' +
        '<td class="actions"><button class="text-button edit" type="button">Edit</button>' +
        '<button class="text-button delete" type="button">Delete</button></td>';
      row.querySelector(".item-name").textContent = item.name;
      row.querySelector(".table-subtitle").textContent = item.sku || "No SKU";
      row.querySelector(".category-cell").textContent = item.category;
      row.children[2].textContent = item.quantity + " " + item.unit;
      row.children[3].textContent = dollars(item.priceCents);
      row.querySelector(".status").textContent = status;
      row.querySelector(".status").classList.add(statusClass);
      row.querySelector(".edit").addEventListener("click", function () { openItemDialog(item); });
      row.querySelector(".delete").addEventListener("click", function () { deleteItem(item); });
      body.appendChild(row);
    });
    document.getElementById("inventory-empty").hidden = filtered.length !== 0;
    document.getElementById("inventory-count-label").textContent =
      inventory.length + (inventory.length === 1 ? " item" : " items");
  }

  function renderSales() {
    var body = document.getElementById("sales-list");
    body.replaceChildren();
    sales.forEach(function (sale) {
      var row = document.createElement("tr");
      row.innerHTML = "<td></td><td></td><td></td><td></td><td></td>";
      row.children[0].textContent = dateLabel(sale.createdAt);
      row.children[1].textContent = sale.customer || "Walk-in";
      row.children[2].textContent = sale.itemSummary;
      row.children[3].textContent = sale.paymentMethod;
      row.children[4].textContent = dollars(sale.totalCents);
      body.appendChild(row);
    });
    document.getElementById("sales-empty").hidden = sales.length !== 0;
  }

  function renderRecentSales() {
    var body = document.getElementById("recent-sales-list");
    body.replaceChildren();
    sales.slice(0, 5).forEach(function (sale) {
      var row = document.createElement("tr");
      row.innerHTML = "<td></td><td></td><td></td>";
      row.children[0].textContent = dateLabel(sale.createdAt);
      row.children[1].textContent = sale.customer || "Walk-in";
      row.children[2].textContent = dollars(sale.totalCents);
      body.appendChild(row);
    });
    document.getElementById("recent-sales-empty").hidden = sales.length !== 0;
  }

  function openItemDialog(item) {
    var form = document.getElementById("item-form");
    form.reset();
    document.getElementById("item-error").hidden = true;
    editingId = item ? item.id : null;
    document.getElementById("item-dialog-title").textContent = item ? "Edit item" : "Add inventory item";
    document.getElementById("item-name").value = item ? item.name : "";
    document.getElementById("item-sku").value = item ? item.sku : "";
    document.getElementById("item-category").value = item ? item.category : "";
    document.getElementById("item-unit").value = item ? item.unit : "each";
    document.getElementById("item-quantity").value = item ? item.quantity : 0;
    document.getElementById("item-price").value = item ? (item.priceCents / 100).toFixed(2) : "";
    document.getElementById("item-threshold").value = item ? item.lowStockThreshold : 5;
    document.getElementById("item-dialog").showModal();
  }

  function showFormError(id, message) {
    var element = document.getElementById(id);
    element.textContent = message;
    element.hidden = false;
  }

  function deleteItem(item) {
    if (!window.confirm('Delete "' + item.name + '" from inventory? Items in completed sales will be retained.')) return;
    request("/api/inventory/" + item.id, { method: "DELETE" })
      .then(function () { return Promise.all([loadInventory(), loadSummary()]); })
      .catch(showAppError);
  }

  function populateSaleProducts() {
    document.querySelectorAll(".sale-product").forEach(function (select) {
      var selected = select.value;
      select.replaceChildren();
      var placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = inventory.length ? "Choose an item" : "Add inventory first";
      select.appendChild(placeholder);
      inventory.forEach(function (item) {
        var option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.name + " · " + item.quantity + " " + item.unit + " · " + dollars(item.priceCents);
        option.disabled = item.quantity < 1;
        select.appendChild(option);
      });
      select.value = selected;
    });
    updateSaleTotal();
  }

  function addSaleLine() {
    var line = document.createElement("div");
    line.className = "sale-line";
    line.innerHTML =
      '<select class="sale-product" aria-label="Product" required></select>' +
      '<input class="sale-quantity" type="number" min="1" step="1" value="1" aria-label="Quantity" required>' +
      '<button class="remove-line" type="button" aria-label="Remove item">×</button>';
    line.querySelector(".sale-product").addEventListener("change", updateSaleTotal);
    line.querySelector(".sale-quantity").addEventListener("input", updateSaleTotal);
    line.querySelector(".remove-line").addEventListener("click", function () {
      if (document.querySelectorAll(".sale-line").length > 1) line.remove();
      updateSaleTotal();
    });
    document.getElementById("sale-lines").appendChild(line);
    populateSaleProducts();
  }

  function updateSaleTotal() {
    var total = 0;
    document.querySelectorAll(".sale-line").forEach(function (line) {
      var item = inventory.find(function (product) {
        return String(product.id) === line.querySelector(".sale-product").value;
      });
      var quantity = Number(line.querySelector(".sale-quantity").value);
      if (item && Number.isInteger(quantity) && quantity > 0) total += item.priceCents * quantity;
    });
    document.getElementById("sale-total").textContent = dollars(total);
  }

  function loadReport() {
    var from = document.getElementById("report-from").value;
    var to = document.getElementById("report-to").value;
    var query = from && to ? "?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to) : "";
    request("/api/reports" + query).then(function (data) {
      reportData = data;
      document.getElementById("report-revenue").textContent = dollars(data.totalRevenueCents);
      document.getElementById("report-sales-count").textContent = data.totalSales;
      renderDailyChart(data.daily);
      renderTopProducts(data.topProducts);
      renderDailyTable(data.daily);
    }).catch(showAppError);
  }

  function renderDailyChart(days) {
    var chart = document.getElementById("revenue-chart");
    chart.replaceChildren();
    var recent = days.slice(-14);
    var maximum = Math.max.apply(null, recent.map(function (day) { return day.revenueCents; }).concat([1]));
    recent.forEach(function (day) {
      var column = document.createElement("div");
      column.className = "chart-column";
      var amount = document.createElement("span");
      amount.className = "chart-value";
      amount.textContent = dollars(day.revenueCents);
      var bar = document.createElement("div");
      bar.className = "chart-bar";
      bar.style.height = Math.max(3, day.revenueCents / maximum * 100) + "%";
      var label = document.createElement("small");
      label.textContent = day.date.slice(5);
      column.append(amount, bar, label);
      chart.appendChild(column);
    });
  }

  function renderTopProducts(products) {
    var list = document.getElementById("top-products");
    list.replaceChildren();
    if (!products.length) {
      list.textContent = "No sales in this date range.";
      return;
    }
    products.forEach(function (product) {
      var row = document.createElement("div");
      row.className = "top-product";
      var label = document.createElement("span");
      label.textContent = product.name + " · " + product.quantity + " sold";
      var total = document.createElement("strong");
      total.textContent = dollars(product.revenueCents);
      row.append(label, total);
      list.appendChild(row);
    });
  }

  function renderDailyTable(days) {
    var body = document.getElementById("daily-report-list");
    body.replaceChildren();
    days.slice().reverse().forEach(function (day) {
      var row = document.createElement("tr");
      row.innerHTML = "<td></td><td></td><td></td>";
      row.children[0].textContent = day.date;
      row.children[1].textContent = day.sales;
      row.children[2].textContent = dollars(day.revenueCents);
      body.appendChild(row);
    });
  }

  document.getElementById("login-form").addEventListener("submit", function (event) {
    event.preventDefault();
    loginError.textContent = "";
    var button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    request("/api/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value
      })
    }).then(function (data) {
      return enterApp(data.user);
    }).catch(function (error) {
      loginError.textContent = error.message;
    }).finally(function () {
      button.disabled = false;
    });
  });

  document.getElementById("logout-button").addEventListener("click", function () {
    request("/api/logout", { method: "POST" }).then(function () {
      appView.hidden = true;
      loginView.hidden = false;
      document.getElementById("login-form").reset();
    }).catch(showAppError);
  });

  document.querySelectorAll("[data-page]").forEach(function (button) {
    button.addEventListener("click", function () { switchPage(button.dataset.page); });
  });
  document.getElementById("add-item-button").addEventListener("click", function () { openItemDialog(null); });
  document.getElementById("inventory-search").addEventListener("input", renderInventory);
  document.getElementById("cancel-item").addEventListener("click", function () {
    document.getElementById("item-dialog").close();
  });
  document.getElementById("close-item").addEventListener("click", function () {
    document.getElementById("item-dialog").close();
  });
  document.getElementById("item-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var form = new FormData(event.currentTarget);
    var data = {
      name: form.get("name").trim(),
      sku: form.get("sku").trim(),
      category: form.get("category").trim(),
      unit: form.get("unit").trim(),
      quantity: Number(form.get("quantity")),
      price: Number(form.get("price")),
      lowStockThreshold: Number(form.get("lowStockThreshold"))
    };
    var url = "/api/inventory" + (editingId ? "/" + editingId : "");
    request(url, { method: editingId ? "PUT" : "POST", body: JSON.stringify(data) })
      .then(function () {
        document.getElementById("item-dialog").close();
        return Promise.all([loadInventory(), loadSummary()]);
      }).catch(function (error) { showFormError("item-error", error.message); });
  });

  document.getElementById("add-sale-line").addEventListener("click", addSaleLine);
  document.querySelectorAll("[data-new-sale]").forEach(function (button) {
    button.addEventListener("click", function () {
      document.getElementById("add-sale-button").click();
    });
  });
  document.getElementById("cancel-sale").addEventListener("click", function () {
    document.getElementById("sale-dialog").close();
  });
  document.getElementById("close-sale").addEventListener("click", function () {
    document.getElementById("sale-dialog").close();
  });
  document.getElementById("add-sale-button").addEventListener("click", function () {
    document.getElementById("sale-form").reset();
    document.getElementById("sale-error").hidden = true;
    document.getElementById("sale-lines").replaceChildren();
    addSaleLine();
    document.getElementById("sale-dialog").showModal();
  });
  document.getElementById("sale-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var lines = Array.from(document.querySelectorAll(".sale-line")).map(function (line) {
      return {
        productId: Number(line.querySelector(".sale-product").value),
        quantity: Number(line.querySelector(".sale-quantity").value)
      };
    });
    var button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    request("/api/sales", {
      method: "POST",
      body: JSON.stringify({
        customer: document.getElementById("sale-customer").value.trim(),
        paymentMethod: document.getElementById("sale-payment").value,
        lines: lines
      })
    }).then(function () {
      document.getElementById("sale-dialog").close();
      return Promise.all([loadInventory(), loadSales(), loadSummary()]);
    }).catch(function (error) {
      showFormError("sale-error", error.message);
    }).finally(function () {
      button.disabled = false;
    });
  });

  document.getElementById("report-filter").addEventListener("submit", function (event) {
    event.preventDefault();
    loadReport();
  });
  document.getElementById("download-report").addEventListener("click", function () {
    if (!reportData) return;
    var rows = [["Date", "Sales", "Revenue"]].concat(reportData.daily.map(function (day) {
      return [day.date, day.sales, (day.revenueCents / 100).toFixed(2)];
    }));
    var csv = rows.map(function (row) {
      return row.map(function (value) { return '"' + String(value).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\r\n");
    var link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "goshen-revenue-report.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  request("/api/session").then(function (data) {
    if (data.user) return enterApp(data.user);
  }).catch(function (error) {
    loginError.textContent = error.message;
  });

  var today = new Date();
  var startDate = new Date(today.getTime());
  startDate.setDate(startDate.getDate() - 29);
  function dateInputValue(date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  document.getElementById("report-from").value = dateInputValue(startDate);
  document.getElementById("report-to").value = dateInputValue(today);
})();
