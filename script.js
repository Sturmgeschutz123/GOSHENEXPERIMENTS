(function () {
  "use strict";

  var loginView = document.getElementById("login-view");
  var appView = document.getElementById("app-view");
  var customerView = document.getElementById("customer-view");
  var loginError = document.getElementById("login-error");
  var appError = document.getElementById("app-error");
  var customerError = document.getElementById("customer-error");
  var inventory = [];
  var sales = [];
  var orders = [];
  var catalog = [];
  var cart = [];
  var authMode = "login";
  var editingId = null;
  var reportData = null;

  async function request(url, options) {
    options = options || {};
    options.credentials = "same-origin";
    options.headers = Object.assign({}, options.headers || {});
    if (options.body) options.headers["Content-Type"] = "application/json";

    var response = await fetch(url, options);
    var data;

    try {
      data = await response.json();
    } catch (error) {
      throw new Error("The server returned an unreadable response.");
    }

    if (!response.ok) {
      var message = data.error || "The request could not be completed.";
      throw new Error(message);
    }

    return data;
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
      var isSelected = button.dataset.page === name;
      button.classList.toggle("active", isSelected);
      if (isSelected) {
        button.setAttribute("aria-current", "page");
      } else {
        button.setAttribute("aria-current", "false");
      }
    });
    document.querySelectorAll(".page-panel").forEach(function (panel) {
      panel.hidden = panel.id !== name + "-page";
    });
    var labels = { dashboard: "Dashboard", inventory: "Inventory", sales: "Sales", orders: "Orders", reports: "Reports", team: "Team" };
    document.getElementById("page-title").textContent = labels[name];
    showAppError("");
    if (name === "reports") loadReport();
    if (name === "orders") loadOrders();
    if (name === "team") loadStaff();
  }

  async function enterApp(user) {
    loginView.hidden = true;
    if (user.role === "customer") {
      appView.hidden = true;
      customerView.hidden = false;
      cart = [];
      document.getElementById("customer-name").textContent = user.name;
      renderCart();
      await loadCustomerData();
      return;
    }
    customerView.hidden = true;
    appView.hidden = false;
    document.getElementById("signed-in-user").textContent = user.email;
    var roleName = "Staff";
    if (user.role === "admin") roleName = "Admin";
    document.getElementById("account-role").textContent = roleName;
    document.querySelectorAll("[data-role]").forEach(function (element) {
      element.hidden = user.role !== "admin" && element.dataset.role === "admin";
    });
    switchPage("dashboard");
    await loadSummary();
    await loadInventory();
    await loadSales();
  }

  async function loadSummary() {
    try {
      var data = await request("/api/summary");
      document.getElementById("summary-products").textContent = data.products;
      document.getElementById("summary-units").textContent = data.units.toLocaleString();
      document.getElementById("summary-low-stock").textContent = data.lowStock;
      document.getElementById("summary-today").textContent = dollars(data.todayRevenueCents);
      var saleWord = " sales today";
      if (data.todaySales === 1) saleWord = " sale today";
      document.getElementById("summary-today-count").textContent = data.todaySales + saleWord;
      document.getElementById("summary-revenue").textContent = dollars(data.totalRevenueCents);
    } catch (error) {
      showAppError(error.message);
    }
  }

  async function loadInventory() {
    try {
      var data = await request("/api/inventory");
      inventory = data.items;
      renderInventory();
      populateSaleProducts();
    } catch (error) {
      showAppError(error.message);
    }
  }

  async function loadSales() {
    try {
      var data = await request("/api/sales");
      sales = data.sales;
      renderSales();
      renderRecentSales();
    } catch (error) {
      showAppError(error.message);
    }
  }

  async function loadOrders() {
    try {
      var data = await request("/api/orders");
      orders = data.orders;
      renderOrders();
    } catch (error) {
      showAppError(error.message);
    }
  }

  async function loadStaff() {
    try {
      var data = await request("/api/staff");
      var list = document.getElementById("staff-list");
      list.replaceChildren();
      if (!data.staff.length) {
        list.textContent = "No staff accounts yet.";
        return;
      }
      for (var memberIndex = 0; memberIndex < data.staff.length; memberIndex += 1) {
        var member = data.staff[memberIndex];
        var row = document.createElement("div");
        row.className = "staff-member";
        var name = document.createElement("strong");
        name.textContent = member.name;
        var email = document.createElement("span");
        email.textContent = member.email;
        row.append(name, email);
        list.appendChild(row);
      }
    } catch (error) {
      showAppError(error.message);
    }
  }

  async function loadCustomerData() {
    try {
      var productData = await request("/api/products");
      catalog = productData.products;
      renderCatalog();
      await loadCustomerOrders();
    } catch (error) {
      customerError.textContent = error.message;
      customerError.hidden = false;
    }
  }

  async function loadCustomerOrders() {
    var data = await request("/api/orders");
    renderCustomerOrders(data.orders);
  }

  function renderInventory() {
    var query = document.getElementById("inventory-search").value.trim().toLowerCase();
    var body = document.getElementById("inventory-list");
    body.replaceChildren();
    var visibleCount = 0;

    for (var itemIndex = 0; itemIndex < inventory.length; itemIndex += 1) {
      var item = inventory[itemIndex];
      var matchesSearch = item.name.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query);

      if (!matchesSearch) continue;

      var row = document.createElement("tr");
      var status = "In stock";
      var statusClass = "in-stock";
      if (item.quantity === 0) {
        status = "Out of stock";
        statusClass = "low";
      } else if (item.quantity <= item.lowStockThreshold) {
        status = "Low stock";
        statusClass = "low";
      }
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
      addInventoryActions(row, item);
      body.appendChild(row);
      visibleCount += 1;
    }

    document.getElementById("inventory-empty").hidden = visibleCount !== 0;
    var itemWord = " items";
    if (inventory.length === 1) itemWord = " item";
    document.getElementById("inventory-count-label").textContent = inventory.length + itemWord;
  }

  function addInventoryActions(row, item) {
    row.querySelector(".edit").addEventListener("click", function () {
      openItemDialog(item);
    });
    row.querySelector(".delete").addEventListener("click", function () {
      deleteItem(item);
    });
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

  function setOrderStatusStyle(statusLabel, status) {
    if (status === "Pending") {
      statusLabel.classList.add("low");
    } else if (status === "Completed") {
      statusLabel.classList.add("in-stock");
    } else {
      statusLabel.classList.add("cancelled");
    }
  }

  function renderOrders() {
    var body = document.getElementById("orders-list");
    body.replaceChildren();
    orders.forEach(function (order) {
      var row = document.createElement("tr");
      row.innerHTML = "<td></td><td></td><td></td><td></td><td><span class=\"status\"></span></td><td class=\"actions\"></td>";
      row.children[0].textContent = dateLabel(order.createdAt);
      row.children[1].textContent = order.customer;
      if (order.customerEmail) {
        row.children[1].textContent += " · " + order.customerEmail;
      }
      row.children[2].textContent = order.itemSummary;
      row.children[3].textContent = dollars(order.totalCents);
      row.querySelector(".status").textContent = order.status;
      setOrderStatusStyle(row.querySelector(".status"), order.status);
      if (order.status === "Pending") {
        var complete = document.createElement("button");
        complete.className = "text-button";
        complete.type = "button";
        complete.textContent = "Complete";
        complete.addEventListener("click", function () { updateOrder(order, "Completed"); });
        var cancel = document.createElement("button");
        cancel.className = "text-button delete";
        cancel.type = "button";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", function () { updateOrder(order, "Cancelled"); });
        row.children[5].append(complete, cancel);
      }
      body.appendChild(row);
    });
    document.getElementById("orders-empty").hidden = orders.length !== 0;
  }

  async function updateOrder(order, status) {
    var message = "Mark this order as completed and include it in revenue?";
    if (status === "Cancelled") {
      message = "Cancel this order and return its reserved items to stock?";
    }
    if (!window.confirm(message)) return;

    try {
      await request("/api/orders/" + order.id, {
        method: "PUT",
        body: JSON.stringify({ status: status })
      });
      await loadOrders();
      await loadInventory();
      await loadSummary();
    } catch (error) {
      showAppError(error.message);
    }
  }

  function renderCatalog() {
    var grid = document.getElementById("catalog-grid");
    grid.replaceChildren();
    catalog.forEach(function (item) {
      var card = document.createElement("article");
      card.className = "product-card";
      var category = document.createElement("span");
      category.className = "eyebrow";
      category.textContent = item.category;
      var name = document.createElement("h3");
      name.textContent = item.name;
      var detail = document.createElement("p");
      detail.className = "muted";
      detail.textContent = item.quantity + " " + item.unit + " available";
      var footer = document.createElement("div");
      footer.className = "product-footer";
      var price = document.createElement("strong");
      price.textContent = dollars(item.priceCents) + " / " + item.unit;
      var button = document.createElement("button");
      button.className = "button secondary";
      button.type = "button";
      button.disabled = item.quantity < 1;
      button.textContent = "Add";
      if (item.quantity < 1) {
        button.textContent = "Sold out";
      }
      button.addEventListener("click", function () {
        addToCart(item);
        renderCart();
      });
      footer.append(price, button);
      card.append(category, name, detail, footer);
      grid.appendChild(card);
    });
    document.getElementById("catalog-empty").hidden = catalog.length !== 0;
  }

  function addToCart(item) {
    var existingItem = findCartItem(item.id);

    if (existingItem) {
      if (existingItem.quantity < item.quantity) {
        existingItem.quantity += 1;
      }
      return;
    }

    cart.push({ productId: item.id, quantity: 1 });
  }

  function findCartItem(productId) {
    for (var cartIndex = 0; cartIndex < cart.length; cartIndex += 1) {
      if (cart[cartIndex].productId === productId) {
        return cart[cartIndex];
      }
    }

    return null;
  }

  function renderCart() {
    var list = document.getElementById("cart-items");
    if (list) {
      list.replaceChildren();
      var total = 0;
      var count = 0;
      for (var cartIndex = 0; cartIndex < cart.length; cartIndex += 1) {
        var cartItem = cart[cartIndex];
        var item = findCatalogItem(cartItem.productId);
        if (!item) continue;

        total += item.priceCents * cartItem.quantity;
        count += cartItem.quantity;
        var row = document.createElement("div");
        row.className = "cart-item";
        var label = document.createElement("span");
        label.textContent = item.name + " × " + cartItem.quantity;
        var amount = document.createElement("strong");
        amount.textContent = dollars(item.priceCents * cartItem.quantity);
        var remove = createRemoveCartButton(item.id);
        row.append(label, amount, remove);
        list.appendChild(row);
      }
      document.getElementById("cart-total").textContent = dollars(total);
      document.getElementById("cart-empty").hidden = count !== 0;
      document.getElementById("place-order-button").disabled = count === 0;
      document.getElementById("cart-count").textContent = count;
    }
  }

  function findCatalogItem(productId) {
    for (var itemIndex = 0; itemIndex < catalog.length; itemIndex += 1) {
      if (catalog[itemIndex].id === productId) {
        return catalog[itemIndex];
      }
    }

    return null;
  }

  function removeFromCart(productId) {
    var remainingItems = [];

    for (var cartIndex = 0; cartIndex < cart.length; cartIndex += 1) {
      if (cart[cartIndex].productId !== productId) {
        remainingItems.push(cart[cartIndex]);
      }
    }

    cart = remainingItems;
  }

  function createRemoveCartButton(productId) {
    var button = document.createElement("button");
    button.className = "text-button delete";
    button.type = "button";
    button.textContent = "Remove";
    button.addEventListener("click", function () {
      removeFromCart(productId);
      renderCart();
    });
    return button;
  }

  function renderCustomerOrders(customerOrders) {
    var body = document.getElementById("customer-orders-list");
    body.replaceChildren();
    customerOrders.forEach(function (order) {
      var row = document.createElement("tr");
      row.innerHTML = "<td></td><td></td><td></td><td><span class=\"status\"></span></td>";
      row.children[0].textContent = dateLabel(order.createdAt);
      row.children[1].textContent = order.itemSummary;
      row.children[2].textContent = dollars(order.totalCents);
      row.querySelector(".status").textContent = order.status;
      setOrderStatusStyle(row.querySelector(".status"), order.status);
      body.appendChild(row);
    });
    document.getElementById("customer-orders-empty").hidden = customerOrders.length !== 0;
  }

  async function switchCustomerPage(name) {
    document.querySelectorAll("[data-customer-page]").forEach(function (tab) {
      tab.classList.toggle("active", tab.dataset.customerPage === name);
    });
    document.querySelectorAll(".customer-panel").forEach(function (panel) {
      panel.hidden = panel.id !== name + "-page";
    });
    if (name === "my-orders") {
      try {
        await loadCustomerOrders();
      } catch (error) {
        customerError.textContent = error.message;
        customerError.hidden = false;
      }
    }
  }

  function switchAuthMode(mode) {
    authMode = mode;
    var isRegistering = mode === "register";
    document.getElementById("login-form").hidden = isRegistering;
    document.getElementById("register-form").hidden = !isRegistering;
    if (isRegistering) {
      document.getElementById("auth-description").textContent =
        "Create an account to browse and order farm-fresh products.";
      document.getElementById("auth-switch").textContent =
        "Already have an account? Sign in";
    } else {
      document.getElementById("auth-description").textContent = "Sign in to your farm account.";
      document.getElementById("auth-switch").textContent =
        "New here? Create a customer account";
    }
    document.getElementById("login-error").textContent = "";
    document.getElementById("register-error").textContent = "";
  }

  function openItemDialog(item) {
    var form = document.getElementById("item-form");
    form.reset();
    document.getElementById("item-error").hidden = true;
    editingId = null;
    document.getElementById("item-dialog-title").textContent = "Add inventory item";
    document.getElementById("item-name").value = "";
    document.getElementById("item-sku").value = "";
    document.getElementById("item-category").value = "";
    document.getElementById("item-unit").value = "each";
    document.getElementById("item-quantity").value = 0;
    document.getElementById("item-price").value = "";
    document.getElementById("item-threshold").value = 5;

    if (item) {
      editingId = item.id;
      document.getElementById("item-dialog-title").textContent = "Edit item";
      document.getElementById("item-name").value = item.name;
      document.getElementById("item-sku").value = item.sku;
      document.getElementById("item-category").value = item.category;
      document.getElementById("item-unit").value = item.unit;
      document.getElementById("item-quantity").value = item.quantity;
      document.getElementById("item-price").value = (item.priceCents / 100).toFixed(2);
      document.getElementById("item-threshold").value = item.lowStockThreshold;
    }

    document.getElementById("item-dialog").showModal();
  }

  function showFormError(id, message) {
    var element = document.getElementById(id);
    element.textContent = message;
    element.hidden = false;
  }

  async function deleteItem(item) {
    if (!window.confirm('Delete "' + item.name + '" from inventory? Items in completed sales will be retained.')) return;
    try {
      await request("/api/inventory/" + item.id, { method: "DELETE" });
      await loadInventory();
      await loadSummary();
    } catch (error) {
      showAppError(error.message);
    }
  }

  function populateSaleProducts() {
    document.querySelectorAll(".sale-product").forEach(function (select) {
      var selected = select.value;
      select.replaceChildren();
      var placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Add inventory first";
      if (inventory.length > 0) {
        placeholder.textContent = "Choose an item";
      }
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
      var item = findInventoryItem(line.querySelector(".sale-product").value);
      var quantity = Number(line.querySelector(".sale-quantity").value);
      if (item && Number.isInteger(quantity) && quantity > 0) total += item.priceCents * quantity;
    });
    document.getElementById("sale-total").textContent = dollars(total);
  }

  function findInventoryItem(productId) {
    for (var itemIndex = 0; itemIndex < inventory.length; itemIndex += 1) {
      if (String(inventory[itemIndex].id) === productId) {
        return inventory[itemIndex];
      }
    }

    return null;
  }

  async function loadReport() {
    var from = document.getElementById("report-from").value;
    var to = document.getElementById("report-to").value;
    var query = "";
    if (from && to) {
      query = "?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
    }

    try {
      var data = await request("/api/reports" + query);
      reportData = data;
      document.getElementById("report-revenue").textContent = dollars(data.totalRevenueCents);
      document.getElementById("report-sales-count").textContent = data.totalSales;
      renderDailyChart(data.daily);
      renderTopProducts(data.topProducts);
      renderDailyTable(data.daily);
    } catch (error) {
      showAppError(error.message);
    }
  }

  function renderDailyChart(days) {
    var chart = document.getElementById("revenue-chart");
    chart.replaceChildren();
    var recent = days.slice(-14);
    var maximum = 1;
    for (var dayIndex = 0; dayIndex < recent.length; dayIndex += 1) {
      if (recent[dayIndex].revenueCents > maximum) {
        maximum = recent[dayIndex].revenueCents;
      }
    }
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
    for (var dayIndex = days.length - 1; dayIndex >= 0; dayIndex -= 1) {
      var day = days[dayIndex];
      var row = document.createElement("tr");
      row.innerHTML = "<td></td><td></td><td></td>";
      row.children[0].textContent = day.date;
      row.children[1].textContent = day.sales;
      row.children[2].textContent = dollars(day.revenueCents);
      body.appendChild(row);
    }
  }

  document.getElementById("login-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    loginError.textContent = "";
    var button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      var data = await request("/api/login", {
        method: "POST",
        body: JSON.stringify({
          email: document.getElementById("email").value.trim(),
          password: document.getElementById("password").value
        })
      });
      await enterApp(data.user);
    } catch (error) {
      loginError.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("register-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var error = document.getElementById("register-error");
    error.textContent = "";
    var button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      var data = await request("/api/register", {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("register-name").value.trim(),
          email: document.getElementById("register-email").value.trim(),
          password: document.getElementById("register-password").value
        })
      });
      await enterApp(data.user);
    } catch (failure) {
      error.textContent = failure.message;
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("auth-switch").addEventListener("click", function () {
    if (authMode === "login") {
      switchAuthMode("register");
    } else {
      switchAuthMode("login");
    }
  });

  async function signOut() {
    try {
      await request("/api/logout", { method: "POST" });
      appView.hidden = true;
      customerView.hidden = true;
      loginView.hidden = false;
      document.getElementById("login-form").reset();
      document.getElementById("register-form").reset();
      cart = [];
      renderCart();
      switchAuthMode("login");
    } catch (error) {
      showAppError(error.message);
    }
  }

  document.getElementById("logout-button").addEventListener("click", signOut);
  document.getElementById("customer-logout-button").addEventListener("click", signOut);

  document.querySelectorAll("[data-page]").forEach(function (button) {
    button.addEventListener("click", function () { switchPage(button.dataset.page); });
  });
  document.querySelectorAll("[data-customer-page]").forEach(function (button) {
    button.addEventListener("click", function () {
      switchCustomerPage(button.dataset.customerPage);
    });
  });
  document.getElementById("add-item-button").addEventListener("click", function () { openItemDialog(null); });
  document.getElementById("inventory-search").addEventListener("input", renderInventory);
  document.getElementById("cancel-item").addEventListener("click", function () {
    document.getElementById("item-dialog").close();
  });
  document.getElementById("close-item").addEventListener("click", function () {
    document.getElementById("item-dialog").close();
  });
  document.getElementById("item-form").addEventListener("submit", async function (event) {
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
    var url = "/api/inventory";
    var method = "POST";
    if (editingId) {
      url += "/" + editingId;
      method = "PUT";
    }

    try {
      await request(url, { method: method, body: JSON.stringify(data) });
      document.getElementById("item-dialog").close();
      await loadInventory();
      await loadSummary();
    } catch (error) {
      showFormError("item-error", error.message);
    }
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
  document.getElementById("sale-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var lines = [];
    var saleLines = document.querySelectorAll(".sale-line");
    for (var lineIndex = 0; lineIndex < saleLines.length; lineIndex += 1) {
      var line = saleLines[lineIndex];
      lines.push({
        productId: Number(line.querySelector(".sale-product").value),
        quantity: Number(line.querySelector(".sale-quantity").value)
      });
    }

    var button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;

    try {
      await request("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          customer: document.getElementById("sale-customer").value.trim(),
          paymentMethod: document.getElementById("sale-payment").value,
          lines: lines
        })
      });
      document.getElementById("sale-dialog").close();
      await loadInventory();
      await loadSales();
      await loadSummary();
    } catch (error) {
      showFormError("sale-error", error.message);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("place-order-button").addEventListener("click", async function (event) {
    var lines = [];
    for (var cartIndex = 0; cartIndex < cart.length; cartIndex += 1) {
      lines.push({
        productId: cart[cartIndex].productId,
        quantity: cart[cartIndex].quantity
      });
    }

    if (!lines.length) return;
    var button = event.currentTarget;
    button.disabled = true;

    try {
      await request("/api/orders", {
        method: "POST",
        body: JSON.stringify({ lines: lines })
      });
      cart = [];
      renderCart();
      customerError.hidden = true;
      await loadCustomerData();
      await switchCustomerPage("my-orders");
    } catch (error) {
      customerError.textContent = error.message;
      customerError.hidden = false;
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("staff-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var error = document.getElementById("staff-error");
    error.hidden = true;
    var button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await request("/api/staff", {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("staff-name").value.trim(),
          email: document.getElementById("staff-email").value.trim(),
          password: document.getElementById("staff-password").value
        })
      });
      form.reset();
      await loadStaff();
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("report-filter").addEventListener("submit", function (event) {
    event.preventDefault();
    loadReport();
  });
  document.getElementById("download-report").addEventListener("click", function () {
    if (!reportData) return;
    var lines = ['"Date","Sales","Revenue"'];

    for (var dayIndex = 0; dayIndex < reportData.daily.length; dayIndex += 1) {
      var day = reportData.daily[dayIndex];
      var revenue = (day.revenueCents / 100).toFixed(2);
      lines.push(quoteCsv(day.date) + "," + quoteCsv(day.sales) + "," + quoteCsv(revenue));
    }

    var csv = lines.join("\r\n");
    var link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "goshen-revenue-report.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  function quoteCsv(value) {
    var text = String(value).replace(/"/g, '""');
    return '"' + text + '"';
  }

  async function restoreSignIn() {
    try {
      var data = await request("/api/session");
      if (data.user) {
        await enterApp(data.user);
      }
    } catch (error) {
      loginError.textContent = error.message;
    }
  }

  restoreSignIn();

  var today = new Date();
  var startDate = new Date(today.getTime());
  startDate.setDate(startDate.getDate() - 29);
  function dateInputValue(date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  document.getElementById("report-from").value = dateInputValue(startDate);
  document.getElementById("report-to").value = dateInputValue(today);
})();
