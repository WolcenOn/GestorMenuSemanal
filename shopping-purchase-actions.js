(function attachShoppingPurchaseActions(global) {
  "use strict";

  const MARKER = "SHOPPING_PURCHASE_ACTIONS_V3_INLINE_LIST";
  const LS = {
    ingredients: "ingredients",
    entries: "purchaseEntries",
    lots: "purchaseLots"
  };
  let observer = null;
  let scannerStream = null;
  let scannerTimer = null;
  let enhanceTimer = null;
  let enhancing = false;

  const $ = (id) => document.getElementById(id);
  const money = (value) => (Number(value) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
  const num = (value) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const normalized = String(value ?? "").replace(/\./g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const esc = (text) => String(text ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function id() {
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeUnit(unit) {
    const clean = String(unit || "").trim().toLowerCase();
    if (["kg", "kilo", "kilos"].includes(clean)) return "kg";
    if (["g", "gr", "gramo", "gramos"].includes(clean)) return "g";
    if (["l", "litro", "litros"].includes(clean)) return "l";
    if (["ml", "mililitro", "mililitros"].includes(clean)) return "ml";
    if (["ud", "uds", "unidad", "unidades"].includes(clean)) return "unidades";
    return clean || "unidades";
  }

  function samePack(aQty, aUnit, bQty, bUnit) {
    const qa = num(aQty);
    const qb = num(bQty);
    if (!qa || !qb) return false;
    if (normalizeUnit(aUnit) !== normalizeUnit(bUnit)) return false;
    return Math.abs(qa - qb) <= Math.max(1, qb * 0.03);
  }

  function ingredients() {
    const data = readJson(LS.ingredients, []);
    return Array.isArray(data) ? data : [];
  }

  function entries() {
    const data = readJson(LS.entries, []);
    return Array.isArray(data) ? data : [];
  }

  function lots() {
    const data = readJson(LS.lots, []);
    return Array.isArray(data) ? data : [];
  }

  function findIngredientByName(name) {
    const clean = String(name || "").trim().toLowerCase();
    return ingredients().find(item => String(item.name || "").trim().toLowerCase() === clean) || null;
  }

  function findIngredientByBarcode(barcode) {
    const code = String(barcode || "").trim();
    if (!code) return null;
    return ingredients().find(item => Array.isArray(item.products) && item.products.some(product => String(product.barcode || "").trim() === code)) || null;
  }

  function cleanText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function firstLabel(row) {
    const strong = row.querySelector("strong");
    if (strong && cleanText(strong.textContent)) return cleanText(strong.textContent);
    const nameNode = row.querySelector(".item-name,[data-ingredient-name],[data-name]");
    if (nameNode && cleanText(nameNode.textContent || nameNode.dataset.ingredientName || nameNode.dataset.name)) return cleanText(nameNode.textContent || nameNode.dataset.ingredientName || nameNode.dataset.name);
    const clone = row.cloneNode(true);
    clone.querySelectorAll("button,input,.purchase-actions,.badge").forEach(node => node.remove());
    const text = cleanText(clone.textContent).split(/[·\n]/)[0];
    return text.replace(/^☐\s*/, "").trim();
  }

  function parseItemData(row) {
    const text = cleanText(row.textContent || "");
    const explicit = row.dataset || {};
    let name = explicit.ingredientName || explicit.name || firstLabel(row);
    let qty = num(explicit.qty || explicit.missingQty || 0);
    let unit = normalizeUnit(explicit.unit || "");
    const patterns = [
      /falta(?:n)?\s+([\d.,]+)\s*([^·\.\n]+)/i,
      /necesitas\s+([\d.,]+)\s*([^·\.\n]+)/i,
      /comprar\s+([\d.,]+)\s*([^·\.\n]+)/i,
      /([\d.,]+)\s*(kg|g|gr|gramos|l|ml|ud|uds|unidad(?:es)?)/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        qty = qty || num(match[1]);
        unit = unit || normalizeUnit(match[2]);
        break;
      }
    }
    const ingredient = findIngredientByName(name);
    if (!qty && ingredient) qty = num(ingredient.packageQty || 1);
    if (!unit && ingredient?.unit) unit = normalizeUnit(ingredient.unit);
    return { name, qty: qty || 1, unit: unit || "unidades", ingredientId: ingredient?.id || "" };
  }

  function injectStyles() {
    if ($("shoppingPurchaseActionsStyles")) return;
    const style = document.createElement("style");
    style.id = "shoppingPurchaseActionsStyles";
    style.textContent = `
      .purchase-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.purchase-actions button{padding:7px 9px;font-size:.82rem}.purchase-sheet-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9998}.purchase-sheet{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);width:min(560px,calc(100% - 18px));max-height:90vh;overflow:auto;background:#fff;border:1px solid var(--border,#cfe7df);border-radius:18px;box-shadow:0 24px 60px rgba(15,23,42,.28);z-index:9999;padding:14px}.purchase-sheet h2{margin:0 0 8px}.purchase-sheet-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.purchase-sheet label{font-size:.85rem}.purchase-sheet .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.purchase-status{margin-top:8px;color:var(--muted,#5d7972);font-size:.9rem}.purchase-video{width:100%;max-height:220px;background:#111;border-radius:14px;margin-top:8px;display:none}.purchase-print-line{display:none}.shopping-item.shopping-purchase-ready{align-items:start}.shopping-purchase-debug{margin:8px 0;color:var(--muted,#5d7972);font-size:.85rem}
      @media (max-width:680px){.purchase-sheet-grid{grid-template-columns:1fr}.purchase-sheet{bottom:0;border-radius:18px 18px 0 0;width:100%}}
      @media print{#panel-shopping .actions,#panel-shopping .summary,#shoppingWeekInfo,.purchase-actions,.purchase-sheet,.purchase-sheet-backdrop,#shoppingList input,#shoppingList .badge,#shoppingList small:not(.purchase-print-line){display:none!important}#shoppingList{display:block!important}#shoppingList .shopping-item{display:block!important;border:0!important;border-bottom:1px solid #ddd!important;box-shadow:none!important;background:#fff!important;padding:6px 0!important}#shoppingList .shopping-item>div{display:block!important}#shoppingList strong{font-size:12pt!important;color:#000!important}.purchase-print-line{display:inline!important;margin-left:8px;color:#000!important;font-size:12pt!important}.print-only{display:block!important}}
    `;
    document.head.appendChild(style);
  }

  function ensureSheet() {
    let backdrop = $("purchaseSheetBackdrop");
    let sheet = $("purchaseSheet");
    if (backdrop && sheet) return sheet;
    backdrop = document.createElement("div");
    backdrop.id = "purchaseSheetBackdrop";
    backdrop.className = "purchase-sheet-backdrop";
    backdrop.hidden = true;
    sheet = document.createElement("section");
    sheet.id = "purchaseSheet";
    sheet.className = "purchase-sheet";
    sheet.hidden = true;
    sheet.innerHTML = `
      <h2>Añadir compra al stock</h2>
      <p class="muted" id="purchaseSheetItemInfo"></p>
      <input id="purchaseIngredientId" type="hidden" />
      <label for="purchaseIngredientName">Ingrediente</label>
      <input id="purchaseIngredientName" list="purchaseIngredientList" placeholder="Ej. Atún en lata" />
      <datalist id="purchaseIngredientList"></datalist>
      <div class="purchase-sheet-grid">
        <div><label for="purchaseQty">Cantidad comprada</label><input id="purchaseQty" type="number" min="0" step="0.01" /></div>
        <div><label for="purchaseUnit">Unidad</label><input id="purchaseUnit" placeholder="g, ml, unidades..." /></div>
        <div><label for="purchaseBarcode">Código de barras</label><input id="purchaseBarcode" inputmode="numeric" placeholder="Escanea o escribe" /></div>
        <div><label for="purchaseBrand">Marca / producto</label><input id="purchaseBrand" placeholder="Opcional" /></div>
        <div><label for="purchasePrice">Precio</label><input id="purchasePrice" type="number" min="0" step="0.01" placeholder="Opcional" /></div>
        <div><label for="purchaseDateType">Tipo de fecha</label><select id="purchaseDateType"><option value="expiry">Caducidad</option><option value="bestBefore">Consumo preferente</option><option value="none">Sin fecha</option></select></div>
        <div><label for="purchaseExpiryDate">Fecha</label><input id="purchaseExpiryDate" type="date" /></div>
        <div><label for="purchaseStorageType">Conservación</label><select id="purchaseStorageType"><option value="pantry">Despensa</option><option value="fridge">Nevera</option><option value="freezer">Congelador</option></select></div>
      </div>
      <video id="purchaseVideo" class="purchase-video" playsinline muted></video>
      <div id="purchaseStatus" class="purchase-status"></div>
      <div class="actions"><button id="purchaseStartScanBtn" type="button" class="secondary">Escanear cámara</button><button id="purchaseSaveBtn" type="button">Añadir al stock</button><button id="purchaseCloseBtn" type="button" class="ghost">Cerrar</button></div>`;
    document.body.append(backdrop, sheet);
    backdrop.addEventListener("click", closeSheet);
    $("purchaseCloseBtn").addEventListener("click", closeSheet);
    $("purchaseSaveBtn").addEventListener("click", savePurchase);
    $("purchaseStartScanBtn").addEventListener("click", startScanner);
    return sheet;
  }

  function refreshIngredientList() {
    const list = $("purchaseIngredientList");
    if (!list) return;
    list.innerHTML = ingredients().slice().sort((a, b) => String(a.name).localeCompare(String(b.name), "es")).map(item => `<option value="${esc(item.name)}"></option>`).join("");
  }

  function openSheet(data, scanNow) {
    injectStyles();
    const sheet = ensureSheet();
    refreshIngredientList();
    $("purchaseSheetBackdrop").hidden = false;
    sheet.hidden = false;
    const ingredient = data.ingredientId ? ingredients().find(item => item.id === data.ingredientId) : findIngredientByName(data.name);
    $("purchaseIngredientId").value = ingredient?.id || "";
    $("purchaseIngredientName").value = ingredient?.name || data.name || "";
    $("purchaseQty").value = data.qty || "";
    $("purchaseUnit").value = normalizeUnit(data.unit || ingredient?.unit || "unidades");
    $("purchaseBarcode").value = data.barcode || "";
    $("purchaseBrand").value = "";
    $("purchasePrice").value = "";
    $("purchaseExpiryDate").value = "";
    $("purchaseDateType").value = "expiry";
    $("purchaseStorageType").value = ingredient?.storageType || "pantry";
    $("purchaseSheetItemInfo").textContent = data.name ? `Artículo de la lista: ${data.name}` : "Alta rápida fuera de la lista.";
    $("purchaseStatus").textContent = scanNow ? "Preparado para escanear. Si la cámara no funciona, escribe el código manualmente." : "Revisa cantidad y fecha antes de añadir al stock.";
    if (scanNow) startScanner();
  }

  function closeSheet() {
    stopScanner();
    const sheet = $("purchaseSheet");
    const backdrop = $("purchaseSheetBackdrop");
    if (sheet) sheet.hidden = true;
    if (backdrop) backdrop.hidden = true;
  }

  async function startScanner() {
    const status = $("purchaseStatus");
    const video = $("purchaseVideo");
    if (!navigator.mediaDevices?.getUserMedia || !("BarcodeDetector" in global)) {
      if (status) status.textContent = "Este navegador no permite escaneo directo. Escribe el código manualmente.";
      return;
    }
    stopScanner();
    try {
      const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
      scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.srcObject = scannerStream;
      video.style.display = "block";
      await video.play();
      const tick = async () => {
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            $("purchaseBarcode").value = codes[0].rawValue || "";
            if (status) status.textContent = `Código detectado: ${codes[0].rawValue}`;
            stopScanner();
            return;
          }
        } catch {}
        scannerTimer = setTimeout(tick, 350);
      };
      tick();
    } catch (error) {
      if (status) status.textContent = `No se pudo abrir la cámara: ${error.message}`;
    }
  }

  function stopScanner() {
    if (scannerTimer) clearTimeout(scannerTimer);
    scannerTimer = null;
    if (scannerStream) scannerStream.getTracks().forEach(track => track.stop());
    scannerStream = null;
    const video = $("purchaseVideo");
    if (video) {
      video.pause();
      video.srcObject = null;
      video.style.display = "none";
    }
  }

  function savePurchase() {
    const name = $("purchaseIngredientName").value.trim();
    const qty = num($("purchaseQty").value);
    const unit = normalizeUnit($("purchaseUnit").value);
    const barcode = $("purchaseBarcode").value.trim();
    const brand = $("purchaseBrand").value.trim();
    const price = num($("purchasePrice").value);
    const expiryDate = $("purchaseExpiryDate").value;
    const dateType = $("purchaseDateType").value;
    const storageType = $("purchaseStorageType").value;
    const status = $("purchaseStatus");

    if (!name) return status.textContent = "Escribe o selecciona un ingrediente.";
    if (!qty || qty <= 0) return status.textContent = "Introduce una cantidad comprada válida.";

    const data = ingredients();
    let ingredient = data.find(item => item.id === $("purchaseIngredientId").value) || data.find(item => String(item.name || "").trim().toLowerCase() === name.toLowerCase());
    const existingBarcodeOwner = barcode ? data.find(item => Array.isArray(item.products) && item.products.some(product => String(product.barcode || "") === barcode)) : null;
    if (existingBarcodeOwner && ingredient && existingBarcodeOwner.id !== ingredient.id) {
      if (!confirm(`Este código ya está asociado a ${existingBarcodeOwner.name}. ¿Quieres asociarlo también a ${ingredient.name}?`)) return;
    }
    if (!ingredient) {
      ingredient = { id: id(), name, qty: 0, unit, available: true, storageType, products: [] };
      data.push(ingredient);
    }
    ingredient.qty = num(ingredient.qty) + qty;
    ingredient.unit = ingredient.unit || unit;
    ingredient.available = true;
    ingredient.storageType = storageType;
    if (expiryDate && (dateType === "expiry" || dateType === "bestBefore")) ingredient.expiryDate = expiryDate;
    if (!Array.isArray(ingredient.products)) ingredient.products = [];
    if (barcode && !ingredient.products.some(product => String(product.barcode || "") === barcode)) {
      const comparable = ingredient.products.filter(product => product.packageQty && product.packageUnit);
      const hasSamePack = !comparable.length || comparable.some(product => samePack(product.packageQty, product.packageUnit, qty, unit));
      if (!hasSamePack && !confirm("El envase no coincide con los productos asociados. ¿Guardar como variante de este ingrediente?")) return;
      ingredient.products.push({ barcode, brand: brand || "Producto", packageQty: qty, packageUnit: unit, price: price || 0, source: "shopping-list", createdAt: new Date().toISOString() });
    }

    const entry = { id: id(), ingredientId: ingredient.id, ingredientName: ingredient.name, qty, unit, barcode, brand, price, expiryDate, dateType, storageType, createdAt: new Date().toISOString(), source: "shopping-list" };
    const lot = { id: id(), ingredientId: ingredient.id, qty, unit, barcode, brand, expiryDate, dateType, storageType, createdAt: entry.createdAt, source: "shopping-list" };
    saveJson(LS.ingredients, data);
    saveJson(LS.entries, [...entries(), entry]);
    saveJson(LS.lots, [...lots(), lot]);
    status.textContent = `Añadido al stock: ${ingredient.name} · ${qty} ${unit}${price ? ` · ${money(price)}` : ""}`;
    document.dispatchEvent(new CustomEvent("planificador:stock-updated", { detail: { ingredientId: ingredient.id, source: "shopping-list" } }));
    if (typeof global.renderAll === "function") global.renderAll();
    scheduleEnhance(250);
  }

  function enhanceRow(row) {
    if (!row || row.dataset.purchaseActionsReady === "true") return;
    const data = parseItemData(row);
    if (!data.name) return;
    row.dataset.purchaseActionsReady = "true";
    row.classList.add("shopping-purchase-ready");
    const labelTarget = row.querySelector("strong") || row.querySelector(".item-name") || row.firstElementChild || row;
    let printLine = row.querySelector(".purchase-print-line");
    if (!printLine) {
      printLine = document.createElement("small");
      printLine.className = "purchase-print-line";
      labelTarget.insertAdjacentElement(labelTarget === row ? "afterbegin" : "afterend", printLine);
    }
    printLine.textContent = `— ${data.qty.toLocaleString("es-ES", { maximumFractionDigits: 2 })} ${data.unit}`;
    let actions = row.querySelector(":scope .purchase-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "purchase-actions";
      actions.innerHTML = `<button type="button" class="secondary" data-purchase-action="scan">Escanear</button><button type="button" class="ghost" data-purchase-action="manual">Añadir manual</button>`;
      actions.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-purchase-action]");
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        openSheet(parseItemData(row), button.dataset.purchaseAction === "scan");
      });
    }
    const content = row.querySelector("div:not(.purchase-actions)") || row;
    content.appendChild(actions);
  }

  function enhanceShoppingList() {
    if (enhancing) return;
    enhancing = true;
    try {
      injectStyles();
      const list = $("shoppingList");
      if (!list) return;
      if (observer) observer.disconnect();
      list.querySelectorAll(".shopping-item").forEach(enhanceRow);
      observeShoppingList();
    } finally {
      enhancing = false;
    }
  }

  function scheduleEnhance(delay = 160) {
    clearTimeout(enhanceTimer);
    enhanceTimer = setTimeout(enhanceShoppingList, delay);
  }

  function observeShoppingList() {
    const list = $("shoppingList");
    if (!list || !("MutationObserver" in window)) return;
    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations) => {
      if (enhancing) return;
      const relevant = mutations.some(mutation =>
        Array.from(mutation.addedNodes || []).some(node =>
          node.nodeType === 1 && (node.classList?.contains("shopping-item") || node.querySelector?.(".shopping-item"))
        )
      );
      if (relevant) scheduleEnhance(180);
    });
    observer.observe(list, { childList: true });
  }

  function install() {
    injectStyles();
    ensureSheet();
    scheduleEnhance(120);
    observeShoppingList();
    setTimeout(enhanceShoppingList, 700);
    setTimeout(enhanceShoppingList, 1600);
    if (!document.documentElement.dataset.shoppingPurchaseDelegated) {
      document.documentElement.dataset.shoppingPurchaseDelegated = "true";
      document.addEventListener("click", event => {
        const tab = event.target.closest && event.target.closest(".tab-btn[data-tab='shopping']");
        if (tab) scheduleEnhance(260);
      }, true);
      document.addEventListener("planificador:modules-ready", () => scheduleEnhance(260));
    }
    global.ShoppingPurchaseActions = { marker: MARKER, install, enhanceShoppingList, openSheet };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})(typeof window !== "undefined" ? window : globalThis);
// SHOPPING_PURCHASE_ACTIONS_READY_V3_INLINE_LIST
