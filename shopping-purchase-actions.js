(function ShoppingPurchaseActionsV4(global) {
  "use strict";

  const MARKER = "SHOPPING_PURCHASE_ACTIONS_V4_STABLE_PANEL";
  const STORE = {
    ingredients: "ingredients",
    entries: "purchaseEntries",
    lots: "purchaseLots",
    checked: "shoppingPurchaseChecked"
  };

  let installed = false;
  let lastSignature = "";
  let refreshTimer = null;

  const $ = id => document.getElementById(id);

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const value = JSON.parse(raw);
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function safeText(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function cleanUnit(unit) {
    const u = String(unit || "").trim().toLowerCase();
    if (["kg", "kilo", "kilos"].includes(u)) return "kg";
    if (["g", "gr", "gramo", "gramos"].includes(u)) return "g";
    if (["l", "litro", "litros"].includes(u)) return "l";
    if (["ml", "mililitro", "mililitros"].includes(u)) return "ml";
    if (["ud", "uds", "unidad", "unidades", "u"].includes(u)) return "unidades";
    return u || "unidades";
  }

  function toBase(qty, unit) {
    let n = Number(qty) || 0;
    let u = cleanUnit(unit);
    if (u === "kg") return { qty: n * 1000, unit: "g" };
    if (u === "l") return { qty: n * 1000, unit: "ml" };
    return { qty: n, unit: u };
  }

  function samePack(aQty, aUnit, bQty, bUnit) {
    const a = toBase(aQty, aUnit);
    const b = toBase(bQty, bUnit);
    if (!a.qty || !b.qty || a.unit !== b.unit) return false;
    return Math.abs(a.qty - b.qty) <= Math.max(1, a.qty * 0.02);
  }

  function formatNumber(value) {
    const n = Number(value) || 0;
    return n.toLocaleString("es-ES", { maximumFractionDigits: 2 });
  }

  function getIngredients() {
    const data = readJson(STORE.ingredients, []);
    return Array.isArray(data) ? data : [];
  }

  function saveIngredients(ingredients) {
    writeJson(STORE.ingredients, ingredients);
    // La app principal lee localStorage al renderizar en algunas rutas.
    document.dispatchEvent(new CustomEvent("shopping-purchase:stock-updated"));
  }

  function ingredientByName(name) {
    const target = normalizeText(name);
    return getIngredients().find(item => normalizeText(item.name) === target);
  }

  function signature(items) {
    return JSON.stringify(items.map(item => [item.name, item.qty, item.unit]));
  }

  function parseLineText(text) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean || /no falta|lista vacía|sin ingredientes/i.test(clean)) return null;

    // Formatos frecuentes:
    // "Tomate 500 g ..."
    // "Tomate: 500 g ..."
    // "Tomate · faltan 500 g ..."
    // "Tomate: 500 g (1,25 €)"
    const rx = /^(.*?)(?:\s*[:·-]\s*|\s+)(?:faltan\s+)?([0-9]+(?:[,.][0-9]+)?)\s*(kg|g|l|ml|ud|uds|unidad|unidades|u)\b/i;
    const match = clean.match(rx);
    if (match) {
      return {
        name: match[1].replace(/^[-•\s]+/, "").trim(),
        qty: Number(match[2].replace(",", ".")) || 0,
        unit: cleanUnit(match[3])
      };
    }

    // Si no detecta cantidad, lo deja como ingrediente sin cantidad para no perderlo.
    return {
      name: clean.replace(/^[-•\s]+/, "").trim(),
      qty: 0,
      unit: ""
    };
  }

  function getItemsFromComputeShoppingList() {
    try {
      if (typeof global.computeShoppingList !== "function") return [];
      const computed = global.computeShoppingList();
      if (!Array.isArray(computed)) return [];
      return computed.map(item => {
        const ingredient = item.ingredient || {};
        return {
          name: ingredient.name || item.name || "",
          qty: Number(item.missingQty ?? item.qty ?? 0) || 0,
          unit: ingredient.unit || item.unit || "",
          ingredientId: ingredient.id || item.ingredientId || ""
        };
      }).filter(item => item.name);
    } catch {
      return [];
    }
  }

  function getItemsFromDom() {
    const list = $("shoppingList");
    if (!list) return [];
    const nodes = Array.from(list.querySelectorAll(".item, .shopping-item, li, article, div"))
      .filter(node => node.children.length || node.textContent.trim().length);
    const candidates = [];
    const seen = new Set();

    nodes.forEach(node => {
      if (node.closest("#shoppingPurchasePanel") || node.closest("#shoppingPrintClean")) return;
      const text = node.textContent.trim();
      const parsed = parseLineText(text);
      if (!parsed || !parsed.name) return;
      const key = normalizeText(`${parsed.name}|${parsed.qty}|${parsed.unit}`);
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(parsed);
    });

    // En muchas listas el contenedor padre contiene todo el texto; preferimos filas pequeñas.
    return candidates.filter(item => item.name.length < 90).slice(0, 80);
  }

  function getShoppingItems() {
    const computed = getItemsFromComputeShoppingList();
    if (computed.length) return computed;
    return getItemsFromDom();
  }

  function ensurePanel() {
    const shoppingList = $("shoppingList");
    const panel = $("panel-shopping");
    if (!shoppingList || !panel) return null;

    let box = $("shoppingPurchasePanel");
    if (!box) {
      box = document.createElement("section");
      box.id = "shoppingPurchasePanel";
      box.className = "scanner-box no-print";
      box.innerHTML = `
        <h3>Actualizar stock desde la compra</h3>
        <p class="help">Usa estos botones mientras compras. No modifica la lista original, así evita parpadeos.</p>
        <div id="shoppingPurchaseRows" class="shopping-purchase-rows"></div>
      `;
      panel.insertBefore(box, shoppingList);
    }

    let printBox = $("shoppingPrintClean");
    if (!printBox) {
      printBox = document.createElement("section");
      printBox.id = "shoppingPrintClean";
      printBox.className = "print-only";
      panel.insertBefore(printBox, shoppingList);
    }

    return box;
  }

  function rowHtml(item, index, checked) {
    const qtyText = item.qty ? `${formatNumber(item.qty)} ${safeText(item.unit || "")}`.trim() : "cantidad pendiente";
    const checkedClass = checked ? " is-done" : "";
    return `
      <div class="shopping-purchase-row${checkedClass}" data-sp-index="${index}">
        <label class="shopping-purchase-check">
          <input type="checkbox" data-sp-action="toggle" data-sp-index="${index}" ${checked ? "checked" : ""}>
          <span>
            <strong>${safeText(item.name)}</strong>
            <small>${safeText(qtyText)}</small>
          </span>
        </label>
        <div class="shopping-purchase-actions">
          <button type="button" data-sp-action="scan" data-sp-index="${index}">Escanear</button>
          <button type="button" class="ghost" data-sp-action="manual" data-sp-index="${index}">Añadir manual</button>
        </div>
      </div>
    `;
  }

  function renderPrint(items) {
    const box = $("shoppingPrintClean");
    if (!box) return;
    if (!items.length) {
      box.innerHTML = "<h1>Lista de la compra</h1><p>No falta ningún ingrediente.</p>";
      return;
    }
    box.innerHTML = `
      <h1>Lista de la compra</h1>
      <table class="shopping-print-table">
        <thead><tr><th>Ingrediente</th><th>Cantidad</th></tr></thead>
        <tbody>
          ${items.map(item => `
            <tr>
              <td>${safeText(item.name)}</td>
              <td>${item.qty ? `${formatNumber(item.qty)} ${safeText(item.unit || "")}` : ""}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderPanel(force = false) {
    const panel = ensurePanel();
    if (!panel) return;

    const rows = $("shoppingPurchaseRows");
    if (!rows) return;

    const items = getShoppingItems();
    const sig = signature(items);
    if (!force && sig === lastSignature) return;
    lastSignature = sig;

    renderPrint(items);

    if (!items.length) {
      rows.innerHTML = `<div class="empty">No hay ingredientes pendientes en la lista de la compra.</div>`;
      return;
    }

    const checked = readJson(STORE.checked, {});
    rows.innerHTML = items.map((item, index) => {
      const key = normalizeText(`${item.name}|${item.qty}|${item.unit}`);
      return rowHtml(item, index, Boolean(checked[key]));
    }).join("");
  }

  function addStyles() {
    if ($("shoppingPurchaseActionsStyle")) return;
    const style = document.createElement("style");
    style.id = "shoppingPurchaseActionsStyle";
    style.textContent = `
      .shopping-purchase-rows{display:grid;gap:8px;margin-top:10px}
      .shopping-purchase-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:10px;border:1px solid var(--border,#cfe7df);border-radius:14px;background:#fff}
      .shopping-purchase-row.is-done{opacity:.58}
      .shopping-purchase-check{display:flex;gap:8px;align-items:flex-start;margin:0;font-weight:400}
      .shopping-purchase-check input{width:auto;margin-top:3px}
      .shopping-purchase-check strong{display:block}
      .shopping-purchase-check small{display:block;color:var(--muted,#64748b);margin-top:2px}
      .shopping-purchase-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
      .shopping-purchase-actions button{padding:7px 9px;font-size:.86rem}
      #shoppingPrintClean{display:none}
      @media(max-width:720px){
        .shopping-purchase-row{grid-template-columns:1fr}
        .shopping-purchase-actions{justify-content:flex-start}
      }
      @media print{
        #shoppingPurchasePanel,#shoppingList,#shoppingSummary,#panel-shopping .actions,#shoppingWeekInfo{display:none!important}
        #shoppingPrintClean{display:block!important}
        #shoppingPrintClean h1{font-size:22px;margin:0 0 14px}
        .shopping-print-table{width:100%;border-collapse:collapse;font-size:13px}
        .shopping-print-table th,.shopping-print-table td{border-bottom:1px solid #ddd;padding:7px 4px;text-align:left}
        .shopping-print-table th:last-child,.shopping-print-table td:last-child{text-align:right;white-space:nowrap}
      }
    `;
    document.head.appendChild(style);
  }

  function createProduct(barcode, brand, packageQty, packageUnit, price) {
    return {
      barcode: String(barcode || "").trim(),
      brand: String(brand || "").trim(),
      packageQty: Number(packageQty) || 0,
      packageUnit: cleanUnit(packageUnit || "unidades"),
      price: Number(price) || 0,
      source: "shopping-list",
      createdAt: new Date().toISOString()
    };
  }

  function associateBarcode(ingredient, product) {
    if (!product.barcode) return;
    ingredient.products = Array.isArray(ingredient.products) ? ingredient.products : [];

    const existingBarcode = ingredient.products.find(p => String(p.barcode || "").trim() === product.barcode);
    if (existingBarcode) {
      Object.assign(existingBarcode, { ...product, createdAt: existingBarcode.createdAt || product.createdAt });
      return;
    }

    const comparable = ingredient.products.find(p => p.packageQty && product.packageQty && samePack(p.packageQty, p.packageUnit, product.packageQty, product.packageUnit));
    if (!comparable && ingredient.products.length && product.packageQty) {
      const ok = confirm(`"${ingredient.name}" ya tiene productos con otro tamaño. ¿Guardar este código como variante?`);
      if (!ok) return;
    }

    ingredient.products.push(product);
  }

  function addLot(ingredient, qty, unit, expiryDate, dateType, storageType, barcode, brand) {
    const lots = readJson(STORE.lots, []);
    const entries = readJson(STORE.entries, []);
    const now = new Date().toISOString();
    const lot = {
      id: `lot-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      qty: Number(qty) || 0,
      unit: cleanUnit(unit || ingredient.unit),
      expiryDate: expiryDate || "",
      dateType: dateType || "expiry",
      storageType: storageType || ingredient.storageType || "pantry",
      barcode: barcode || "",
      brand: brand || "",
      createdAt: now
    };
    lots.push(lot);
    entries.push({ ...lot, type: "shopping-stock-entry" });
    writeJson(STORE.lots, lots.slice(-500));
    writeJson(STORE.entries, entries.slice(-500));
  }

  function addStock(item, mode) {
    const ingredients = getIngredients();
    let ingredient = item.ingredientId ? ingredients.find(i => i.id === item.ingredientId) : null;
    if (!ingredient) ingredient = ingredients.find(i => normalizeText(i.name) === normalizeText(item.name));

    if (!ingredient) {
      const ok = confirm(`No encuentro "${item.name}" en ingredientes. ¿Crearlo ahora?`);
      if (!ok) return;
      ingredient = {
        id: `id-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: item.name,
        qty: 0,
        unit: cleanUnit(item.unit || "unidades"),
        available: true,
        products: []
      };
      ingredients.push(ingredient);
    }

    const defaultQty = item.qty ? String(item.qty).replace(".", ",") : "";
    const qtyRaw = prompt(`Cantidad comprada de "${ingredient.name}"`, defaultQty);
    if (qtyRaw === null) return;
    const qty = Number(String(qtyRaw).replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) return alert("Cantidad no válida.");

    const unit = cleanUnit(prompt("Unidad", item.unit || ingredient.unit || "unidades") || item.unit || ingredient.unit || "unidades");
    const expiryDate = prompt("Fecha de caducidad o consumo preferente (AAAA-MM-DD). Opcional", "") || "";
    const dateType = expiryDate ? (confirm("Aceptar = caducidad. Cancelar = consumo preferente.") ? "expiry" : "bestBefore") : "";
    const storageType = prompt("Conservación: pantry, fridge o freezer", ingredient.storageType || "pantry") || ingredient.storageType || "pantry";

    let barcode = "";
    let brand = "";
    if (mode === "scan") {
      barcode = prompt("Código de barras escaneado/escrito", "") || "";
      if (barcode) {
        brand = prompt("Marca / producto", "") || "";
        const packQty = Number(String(prompt("Cantidad del envase", qty) || qty).replace(",", "."));
        const packUnit = cleanUnit(prompt("Unidad del envase", unit) || unit);
        const price = Number(String(prompt("Precio opcional", "") || "0").replace(",", "."));
        associateBarcode(ingredient, createProduct(barcode, brand, packQty, packUnit, price));
      }
    }

    ingredient.qty = (Number(ingredient.qty) || 0) + qty;
    ingredient.unit = unit || ingredient.unit || "unidades";
    ingredient.available = true;
    ingredient.expiryDate = expiryDate || ingredient.expiryDate || "";
    ingredient.storageType = storageType;

    addLot(ingredient, qty, unit, expiryDate, dateType, storageType, barcode, brand);
    saveIngredients(ingredients);

    markChecked(item);
    renderPanel(true);
    alert(`Stock actualizado: ${ingredient.name} +${formatNumber(qty)} ${unit}`);
  }

  function markChecked(item) {
    const checked = readJson(STORE.checked, {});
    checked[normalizeText(`${item.name}|${item.qty}|${item.unit}`)] = true;
    writeJson(STORE.checked, checked);
  }

  function onPanelClick(event) {
    const button = event.target.closest("[data-sp-action]");
    if (!button) return;

    const items = getShoppingItems();
    const index = Number(button.dataset.spIndex);
    const item = items[index];
    if (!item) return;

    const action = button.dataset.spAction;
    if (action === "manual") addStock(item, "manual");
    if (action === "scan") addStock(item, "scan");
    if (action === "toggle") {
      if (button.checked) markChecked(item);
      else {
        const checked = readJson(STORE.checked, {});
        delete checked[normalizeText(`${item.name}|${item.qty}|${item.unit}`)];
        writeJson(STORE.checked, checked);
      }
      renderPanel(true);
    }
  }

  function scheduleRender(force = false) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => renderPanel(force), 160);
  }

  function install() {
    if (installed) return;
    installed = true;
    addStyles();
    ensurePanel();

    const panel = $("panel-shopping");
    if (panel) panel.addEventListener("click", onPanelClick);

    document.addEventListener("click", event => {
      if (event.target.closest('[data-tab="shopping"]')) scheduleRender(true);
    });
    document.addEventListener("planificador:modules-ready", () => scheduleRender(true));
    document.addEventListener("shopping-purchase:stock-updated", () => scheduleRender(true));
    window.addEventListener("beforeprint", () => renderPrint(getShoppingItems()));

    // Render inicial y refrescos suaves, sin tocar filas originales.
    scheduleRender(true);
    setInterval(() => {
      const panelShopping = $("panel-shopping");
      if (panelShopping && panelShopping.classList.contains("active")) scheduleRender(false);
    }, 1800);
  }

  global.ShoppingPurchaseActions = {
    marker: MARKER,
    install,
    refresh: () => renderPanel(true),
    getItems: getShoppingItems
  };
})(window);

// SHOPPING_PURCHASE_ACTIONS_V4_STABLE_PANEL
