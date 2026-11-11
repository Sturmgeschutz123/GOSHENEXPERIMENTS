(function () {
  "use strict";

  var supabaseUrl = "https://wtficzmrjbnveejlqblo.supabase.co";
  var supabasePublishableKey = "sb_publishable_piA2KADqwAAuEokNRDq4_Q_fXBZzstf";
  var supabaseClient = window.supabase
    ? window.supabase.createClient(supabaseUrl, supabasePublishableKey)
    : null;
  var loginView = document.getElementById("login-view");
  var inventoryView = document.getElementById("inventory-view");
  var loginForm = document.getElementById("login-form");
  var loginError = document.getElementById("login-error");
  var appError = document.getElementById("app-error");
  var itemError = document.getElementById("item-error");
  var dialog = document.getElementById("item-dialog");
  var itemForm = document.getElementById("item-form");
  var list = document.getElementById("inventory-list");
  var search = document.getElementById("search");
  var items = [];
  var editingId = null;
  var activeUserId = null;
  var inventoryLoaded = false;
  var isAdmin = false;

  function showLoginError(message) {
    loginError.textContent = message;
  }

  function showAppError(message) {
    appError.textContent = message;
    appError.hidden = !message;
  }

  function showItemError(message) {
    itemError.textContent = message;
    itemError.hidden = !message;
  }

  function getErrorMessage(error) {
    return error && error.message ? error.message : "An unexpected error occurred.";
  }

  function showLogin() {
    activeUserId = null;
    isAdmin = false;
    inventoryLoaded = false;
    items = [];
    inventoryView.hidden = true;
    loginView.hidden = false;
    loginForm.reset();
    document.getElementById("account-role").textContent = "";
    document.getElementById("inventory-description").textContent = "Your current farm stock";
  }

  async function showInventory(user) {
    loginView.hidden = true;
    inventoryView.hidden = false;
    document.getElementById("signed-in-user").textContent = user.email || "";

    if (activeUserId !== user.id) {
      activeUserId = user.id;
      isAdmin = false;
      items = [];
      inventoryLoaded = false;
      renderItems();
      var roleResult;
      try {
        roleResult = await supabaseClient
          .from("admin_users")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle();
      } catch (error) {
        await loadItems();
        showAppError("Could not check account role: " + getErrorMessage(error));
        return;
      }

      if (roleResult.error) {
        await loadItems();
        showAppError("Could not check account role: " + getErrorMessage(roleResult.error));
        return;
      }

      isAdmin = Boolean(roleResult.data);
      document.getElementById("account-role").textContent = isAdmin ? "Admin" : "";
      document.getElementById("inventory-description").textContent = isAdmin
        ? "View and manage inventory for all users."
        : "Your current farm stock";
      await loadItems();
    }
  }

  async function loadItems() {
    showAppError("");
    var result;
    try {
      result = await supabaseClient
        .from("inventory")
        .select("id, name, category, quantity, price")
        .order("created_at", { ascending: false });
    } catch (error) {
      showAppError("Could not load inventory: " + getErrorMessage(error));
      renderItems();
      return;
    }

    if (result.error) {
      showAppError("Could not load inventory: " + getErrorMessage(result.error));
      renderItems();
      return;
    }

    items = result.data.map(function (item) {
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        quantity: item.quantity,
        price: Number(item.price)
      };
    });
    inventoryLoaded = true;
    renderItems();
  }

  loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    showLoginError("");
    if (!supabaseClient) {
      showLoginError("Supabase could not be loaded. Check your internet connection and reload.");
      return;
    }

    var submitButton = loginForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    var result;
    try {
      result = await supabaseClient.auth.signInWithPassword({
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value
      });
    } catch (error) {
      showLoginError("Sign in failed: " + getErrorMessage(error));
      return;
    } finally {
      submitButton.disabled = false;
    }

    if (result.error) {
      showLoginError("Sign in failed: " + getErrorMessage(result.error));
      return;
    }
    if (result.data.user) {
      showInventory(result.data.user);
    }
  });

  document.getElementById("logout-button").addEventListener("click", async function () {
    var result;
    try {
      result = await supabaseClient.auth.signOut();
    } catch (error) {
      showAppError("Could not sign out: " + getErrorMessage(error));
      return;
    }
    if (result.error) {
      showAppError("Could not sign out: " + getErrorMessage(result.error));
      return;
    }
    showLogin();
  });

  document.getElementById("add-item-button").addEventListener("click", function () {
    editingId = null;
    itemForm.reset();
    showItemError("");
    document.getElementById("dialog-title").textContent = "Add item";
    dialog.showModal();
    document.getElementById("item-name").focus();
  });

  document.getElementById("close-dialog").addEventListener("click", closeDialog);
  document.getElementById("cancel-dialog").addEventListener("click", closeDialog);
  search.addEventListener("input", renderItems);

  itemForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    var formData = new FormData(itemForm);
    var item = {
      name: formData.get("name").trim(),
      category: formData.get("category").trim(),
      quantity: Number(formData.get("quantity")),
      price: Number(formData.get("price"))
    };
    var result;
    try {
      if (editingId) {
        result = await supabaseClient
          .from("inventory")
          .update(item)
          .eq("id", editingId)
          .select("id, name, category, quantity, price")
          .single();
      } else {
        result = await supabaseClient
          .from("inventory")
          .insert(item)
          .select("id, name, category, quantity, price")
          .single();
      }
    } catch (error) {
      showItemError("Could not save item: " + getErrorMessage(error));
      return;
    }

    if (result.error) {
      showItemError("Could not save item: " + getErrorMessage(result.error));
      return;
    }

    var savedItem = {
      id: result.data.id,
      name: result.data.name,
      category: result.data.category,
      quantity: result.data.quantity,
      price: Number(result.data.price)
    };
    if (editingId) {
      items = items.map(function (existing) {
        return existing.id === editingId ? savedItem : existing;
      });
    } else {
      items.unshift(savedItem);
    }
    showAppError("");
    showItemError("");
    renderItems();
    closeDialog();
  });

  function closeDialog() {
    showItemError("");
    dialog.close();
  }

  function renderItems() {
    var query = search.value.trim().toLowerCase();
    var filtered = items.filter(function (item) {
      return item.name.toLowerCase().includes(query) || item.category.toLowerCase().includes(query);
    });

    list.replaceChildren();
    filtered.forEach(function (item) {
      var row = document.createElement("tr");
      row.innerHTML =
        '<td class="item-name"></td><td class="category"></td>' +
        '<td></td><td></td><td></td>' +
        '<td class="actions"><button class="text-button edit" type="button">Edit</button>' +
        '<button class="text-button delete" type="button">Delete</button></td>';
      row.children[0].textContent = item.name;
      row.children[1].textContent = item.category;
      row.children[2].textContent = item.quantity;
      row.children[3].textContent = "$" + item.price.toFixed(2);
      row.children[4].innerHTML = item.quantity <= 5
        ? '<span class="status low">Low stock</span>'
        : '<span class="status in-stock">In stock</span>';
      row.querySelector(".edit").addEventListener("click", function () {
        editItem(item);
      });
      row.querySelector(".delete").addEventListener("click", function () {
        deleteItem(item);
      });
      list.appendChild(row);
    });

    document.getElementById("product-count").textContent = inventoryLoaded ? items.length : "—";
    document.getElementById("unit-count").textContent = inventoryLoaded
      ? items.reduce(function (sum, item) { return sum + item.quantity; }, 0)
      : "—";
    document.getElementById("low-stock-count").textContent = inventoryLoaded
      ? items.filter(function (item) { return item.quantity <= 5; }).length
      : "—";
    document.getElementById("empty-state").hidden = !inventoryLoaded || filtered.length > 0;
    document.getElementById("inventory-description").textContent = isAdmin
      ? "View and manage inventory for all users."
      : "Your current farm stock";
  }

  async function deleteItem(item) {
    if (!window.confirm("Delete " + item.name + " from your inventory?")) {
      return;
    }

    var result;
    try {
      result = await supabaseClient.from("inventory").delete().eq("id", item.id);
    } catch (error) {
      showAppError("Could not delete item: " + getErrorMessage(error));
      return;
    }
    if (result.error) {
      showAppError("Could not delete item: " + getErrorMessage(result.error));
      return;
    }
    items = items.filter(function (existing) { return existing.id !== item.id; });
    showAppError("");
    renderItems();
  }

  function editItem(item) {
    editingId = item.id;
    document.getElementById("dialog-title").textContent = "Edit item";
    document.getElementById("item-name").value = item.name;
    document.getElementById("item-category").value = item.category;
    document.getElementById("item-quantity").value = item.quantity;
    document.getElementById("item-price").value = item.price;
    showItemError("");
    dialog.showModal();
  }

  if (!supabaseClient) {
    showLoginError("Supabase could not be loaded. Check your internet connection and reload.");
    return;
  }

  supabaseClient.auth.getSession().then(function (result) {
    if (result.error) {
      showLoginError("Could not restore your session: " + getErrorMessage(result.error));
      return;
    }
    if (result.data.session) {
      return showInventory(result.data.session.user);
    }
  }).catch(function (error) {
    showLoginError("Could not restore your session: " + getErrorMessage(error));
  });
})();
