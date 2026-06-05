(function attachPurchaseMode(window, document) {
  "use strict";

  const KEYS = {
    ingredients: "ingredients",
    entries: "purchaseEntries",
    lots: "purchaseLots"
  };
  const MARKER = "PURCHASE_MODE_READY_V1";
  let installed = false;

  const $ = id => document.getElementById(id);
  const nowIso = () => new Date().toISOString();
  const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function clean(text) {
    return String(text || "").trim();
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeUnit(unit) {
    const value = clean(unit).toLowerCase();
    if (["kg", "kilo", "kilos"].includes(value)) return "kg";
    if (["g", "gr", "gramo", "gramos"].includes(value)) return "g";
    if (["l", "litro", "litros"].includes(value)) return "l";
    if (["ml", "mililitro", "mililitros"].includes(value)) return "ml";
    if (["ud", "uds", "unidad", "unidades"].includes(value)) return "unidades";
    return value || "unidades";
  }

  function toBase(qty, unit) {
    const amount = number(qty);
    const normalized = normalizeUnit(unit);
    if (normalized === "kg") return { qty: amount * 1000, unit: "g" };
    if (normalized === "l") return { qty: amount * 1000, unit: "ml" };
    return { qty: amount, unit: normalized };
  }

  function compatiblePack(aQty, aUnit, bQty, bUnit) {
    const a = toBase(aQty, aUnit);
    const b = toBase(bQty, bUnit);
    if (!a.qty || !b.qty || a.unit !== b.unit) return false;
    return Math.abs(a.qty - b.qty) <= Math.max(1, a.qty * 0.03);
  }

  function productsOf(ingredient) {
    return asArray(ingredient && ingredient.products);
  }

  function findByBarcode(ingredients, barcode) {
    const code = clean(barcode);
    if (!code) return null;
    for (const ingredient of ingredients) {
      const product = productsOf(ingredient).find(item => clean(item.barcode) === code);
      if (product) return { ingredient, product };
    }
    return null;
  }

  function optionList(ingredients) {
    return ingredients
      .slice()
      .sort((a, b) => clean(a.name).localeCompare(clean(b.name), "es"))
      .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || "Sin nombre")}</option>`)
      .join("");
  }

  function injectStyles() {
    if ($("purchaseModeStyles")) return;
    const style = document.createElement("style");
    style.id = "purchaseModeStyles";
    style.textContent = `
      .purchase-mode-grid{display:grid;grid-template-columns:minmax(260px,420px) 1fr;gap:16px;align-items:start}.purchase-mode-box{border:1px solid var(--border,#cfe7df);border-radius:16px;padding:14px;background:#fff}.purchase-mode-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.purchase-mode-inline{display:grid;grid-template-columns:1fr 110px 110px;gap:8px}.purchase-mode-status{margin-top:10px;padding:10px;border-radius:12px;background:#eefaf6;color:#12302b}.purchase-mode-warning{margin-top:10px;padding:10px;border-radius:12px;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa}.purchase-mode-log{display:grid;gap:8px;margin-top:10px}.purchase-mode-log-item{border-bottom:1px solid var(--border,#cfe7df);padding:8px 0}.purchase-mode-log-item strong{display:block}@media(max-width:800px){.purchase-mode-grid{grid-template-columns:1fr}.purchase-mode-inline{grid-template-columns:1fr}}`;
    document.head.appendChild(style);
  }

  function activatePurchaseTab() {
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === "purchase-mode"));
    document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === "panel-purchase-mode"));
  }

  function addTab() {
    const tabs = document.querySelector(".tabs");
    if (!tabs) return;
    let btn = tabs.querySelector('[data-tab="purchase-mode"]');
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tab-btn";
      btn.dataset.tab = "purchase-mode";
      btn.textContent = "Modo compra";
      tabs.appendChild(btn);
    }
    if (!btn.dataset.purchaseModeReady) {
      btn.dataset.purchaseModeReady = "1";
      btn.addEventListener("click", activatePurchaseTab);
    }
  }

  function addPanel() {
    const main = document.querySelector("main");
    if (!main || $("panel-purchase-mode")) return;
    const section = document.createElement("section");
    section.id = "panel-purchase-mode";
    section.className = "tab-panel card";
    section.innerHTML = `
      <h2>Modo compra</h2>
      <p class="muted">Actualiza stock y caducidad mientras compras. Puedes escribir o escanear un código, asociarlo a un ingrediente y registrar lote.</p>
      <div class="purchase-mode-grid">
        <div class="purchase-mode-box">
          <h3>Entrada rápida</h3>
          <label for="pmBarcode">Código de barras</label>
          <input id="pmBarcode" inputmode="numeric" placeholder="Escanea o escribe el código" />
          <label for="pmIngredient">Ingrediente</label>
          <select id="pmIngredient"></select>
          <div class="purchase-mode-inline">
            <div><label for="pmBrand">Marca</label><input id="pmBrand" placeholder="Opcional" /></div>
            <div><label for="pmQty">Cantidad</label><input id="pmQty" type="number" min="0" step="0.01" value="1" /></div>
            <div><label for="pmUnit">Unidad</label><input id="pmUnit" value="unidades" /></div>
          </div>
          <div class="purchase-mode-inline">
            <div><label for="pmExpiry">Fecha</label><input id="pmExpiry" type="date" /></div>
            <div><label for="pmDateType">Tipo</label><select id="pmDateType"><option value="expiry">Caducidad</option><option value="bestBefore">Preferente</option></select></div>
            <div><label for="pmStorage">Conservación</label><select id="pmStorage"><option value="pantry">Despensa</option><option value="fridge">Nevera</option><option value="freezer">Congelador</option></select></div>
          </div>
          <div class="purchase-mode-inline">
            <div><label for="pmPrice">Precio opcional</label><input id="pmPrice" type="number" min="0" step="0.01" placeholder="0.00" /></div>
            <div><label for="pmIsBulk">A granel</label><select id="pmIsBulk"><option value="no">No</option><option value="yes">Sí</option></select></div>
            <div><label>&nbsp;</label><button id="pmRegister" type="button">Añadir al stock</button></div>
          </div>
          <div class="purchase-mode-actions">
            <button id="pmFindBarcode" class="ghost" type="button">Buscar código</button>
            <button id="pmRefresh" class="secondary" type="button">Actualizar ingredientes</button>
          </div>
          <div id="pmStatus" class="purchase-mode-status">Listo para registrar compra.</div>
        </div>
        <div class="purchase-mode-box">
          <h3>Últimas entradas</h3>
          <div id="pmLog" class="purchase-mode-log"></div>
        </div>
      </div>`;
    main.appendChild(section);
  }

  function setStatus(message, warning) {
    const box = $("pmStatus");
    if (!box) return;
    box.className = warning ? "purchase-mode-warning" : "purchase-mode-status";
    box.textContent = message;
  }

  function refreshIngredients() {
    const ingredients = asArray(read(KEYS.ingredients, []));
    const select = $("pmIngredient");
    if (select) select.innerHTML = optionList(ingredients);
    return ingredients;
  }

  function renderLog() {
    const log = $("pmLog");
    if (!log) return;
    const entries = asArray(read(KEYS.entries, [])).slice(-8).reverse();
    if (!entries.length) {
      log.innerHTML = `<div class="empty">Aún no hay entradas registradas.</div>`;
      return;
    }
    log.innerHTML = entries.map(entry => `
      <div class="purchase-mode-log-item">
        <strong>${escapeHtml(entry.ingredientName)}</strong>
        <span>${escapeHtml(entry.qty)} ${escapeHtml(entry.unit)} · ${escapeHtml(entry.brand || "sin marca")} · ${escapeHtml(entry.barcode || "sin código")}</span><br>
        <small>${escapeHtml(entry.expiryDate || "sin fecha")} · ${escapeHtml(new Date(entry.createdAt).toLocaleString("es-ES"))}</small>
      </div>`).join("");
  }

  function addProductIfNeeded(ingredient, form) {
    const barcode = clean(form.barcode);
    if (!barcode || form.isBulk) return { added: false, reason: "bulk-or-no-barcode" };
    ingredient.products = productsOf(ingredient);
    const existing = ingredient.products.find(item => clean(item.barcode) === barcode);
    if (existing) return { added: false, reason: "existing", product: existing };

    const similar = ingredient.products.find(item => compatiblePack(item.packageQty, item.packageUnit, form.qty, form.unit));
    if (ingredient.products.length && !similar) {
      const ok = window.confirm(`Este código no existe para ${ingredient.name} y el envase no coincide con los productos registrados. ¿Guardarlo como variante diferenciada?`);
      if (!ok) return { added: false, reason: "cancelled" };
    }

    const product = {
      barcode,
      brand: form.brand,
      packageQty: form.qty,
      packageUnit: form.unit,
      price: form.price,
      source: "purchase-mode",
      createdAt: nowIso()
    };
    ingredient.products.push(product);
    return { added: true, reason: similar ? "same-pack" : "variant", product };
  }

  function readForm() {
    return {
      barcode: clean($("pmBarcode") && $("pmBarcode").value),
      ingredientId: clean($("pmIngredient") && $("pmIngredient").value),
      brand: clean($("pmBrand") && $("pmBrand").value),
      qty: number($("pmQty") && $("pmQty").value),
      unit: normalizeUnit($("pmUnit") && $("pmUnit").value),
      expiryDate: clean($("pmExpiry") && $("pmExpiry").value),
      dateType: clean($("pmDateType") && $("pmDateType").value) || "expiry",
      storageType: clean($("pmStorage") && $("pmStorage").value) || "pantry",
      price: number($("pmPrice") && $("pmPrice").value),
      isBulk: clean($("pmIsBulk") && $("pmIsBulk").value) === "yes"
    };
  }

  function registerPurchase() {
    const ingredients = refreshIngredients();
    const form = readForm();
    if (!form.ingredientId) return setStatus("Selecciona un ingrediente.", true);
    if (!form.qty) return setStatus("Introduce una cantidad válida.", true);

    const ingredient = ingredients.find(item => item.id === form.ingredientId);
    if (!ingredient) return setStatus("Ingrediente no encontrado.", true);

    const productResult = addProductIfNeeded(ingredient, form);
    if (productResult.reason === "cancelled") return setStatus("Entrada cancelada. No se modificó el stock.", true);

    ingredient.qty = number(ingredient.qty) + form.qty;
    ingredient.unit = normalizeUnit(ingredient.unit || form.unit);
    ingredient.available = true;
    if (form.expiryDate) ingredient.expiryDate = form.expiryDate;
    ingredient.storageType = form.storageType;
    ingredient.updatedAt = nowIso();

    const lot = {
      id: uid("lot"),
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      qty: form.qty,
      unit: form.unit,
      expiryDate: form.expiryDate,
      dateType: form.dateType,
      storageType: form.storageType,
      barcode: form.barcode,
      brand: form.brand,
      price: form.price,
      isBulk: form.isBulk,
      createdAt: nowIso()
    };
    const entry = { ...lot, id: uid("purchase") };

    write(KEYS.ingredients, ingredients);
    write(KEYS.lots, asArray(read(KEYS.lots, [])).concat(lot).slice(-500));
    write(KEYS.entries, asArray(read(KEYS.entries, [])).concat(entry).slice(-300));

    renderLog();
    refreshIngredients();
    const productText = productResult.added ? " Código asociado al ingrediente." : "";
    setStatus(`${ingredient.name}: stock actualizado (+${form.qty} ${form.unit}).${productText}`);
    document.dispatchEvent(new CustomEvent("purchase-mode:stock-updated", { detail: { ingredient, lot, entry } }));
  }

  function findBarcode() {
    const ingredients = refreshIngredients();
    const barcode = clean($("pmBarcode") && $("pmBarcode").value);
    if (!barcode) return setStatus("Introduce o escanea un código.", true);
    const found = findByBarcode(ingredients, barcode);
    if (!found) return setStatus("Código no registrado. Selecciona un ingrediente para asociarlo al añadir al stock.", true);
    if ($("pmIngredient")) $("pmIngredient").value = found.ingredient.id;
    if ($("pmBrand")) $("pmBrand").value = found.product.brand || "";
    if ($("pmQty")) $("pmQty").value = found.product.packageQty || 1;
    if ($("pmUnit")) $("pmUnit").value = found.product.packageUnit || found.ingredient.unit || "unidades";
    if ($("pmPrice")) $("pmPrice").value = found.product.price || "";
    setStatus(`Código encontrado: ${found.ingredient.name}. Revisa caducidad y añade al stock.`);
  }

  function wire() {
    $("pmRegister")?.addEventListener("click", registerPurchase);
    $("pmFindBarcode")?.addEventListener("click", findBarcode);
    $("pmRefresh")?.addEventListener("click", () => { refreshIngredients(); renderLog(); setStatus("Ingredientes actualizados."); });
    $("pmBarcode")?.addEventListener("change", findBarcode);
  }

  function install() {
    if (installed) return;
    installed = true;
    injectStyles();
    addTab();
    addPanel();
    refreshIngredients();
    renderLog();
    wire();
  }

  window.PurchaseMode = { install, registerPurchase, findBarcode, compatiblePack, marker: MARKER };
})(window, document);
// PURCHASE_MODE_READY_V1
