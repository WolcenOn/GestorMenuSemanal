(function attachPurchaseMode(window, document) {
  "use strict";

  const KEYS = {
    ingredients: "ingredients",
    entries: "purchaseEntries",
    lots: "purchaseLots",
    weeks: "savedWeeks",
    activeWeekId: "activeWeekId",
    dishes: "dishes"
  };
  const MARKER = "PURCHASE_MODE_READY_V2_SHOPPING_LIST";
  let installed = false;
  let stream = null;
  let scanTimer = null;

  const $ = id => document.getElementById(id);
  const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const nowIso = () => new Date().toISOString();

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

  function asArray(value) { return Array.isArray(value) ? value : []; }
  function clean(value) { return String(value || "").trim(); }
  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
  function escapeHtml(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function formatNumber(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return "0";
    return parsed.toLocaleString("es-ES", { maximumFractionDigits: 2 });
  }
  function formatCurrency(value) {
    const parsed = Number(value) || 0;
    return parsed.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
  }
  function normalizeSearch(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }
  function normalizeUnit(unit) {
    const value = clean(unit).toLowerCase();
    if (["kg", "kilo", "kilos"].includes(value)) return "kg";
    if (["g", "gr", "gramo", "gramos"].includes(value)) return "g";
    if (["l", "litro", "litros"].includes(value)) return "l";
    if (["ml", "mililitro", "mililitros"].includes(value)) return "ml";
    if (["ud", "uds", "u", "unidad", "unidades", "pieza", "piezas"].includes(value)) return "unidades";
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
  function productsOf(ingredient) { return asArray(ingredient && ingredient.products); }

  function getIngredients() { return asArray(read(KEYS.ingredients, [])); }
  function getDishes() { return asArray(read(KEYS.dishes, [])); }
  function getWeeks() { return asArray(read(KEYS.weeks, [])); }
  function getActiveWeek() {
    const weeks = getWeeks();
    const activeId = localStorage.getItem(KEYS.activeWeekId) || weeks[0]?.id || "";
    return weeks.find(week => week.id === activeId) || weeks[0] || { name: "Semana", plan: {} };
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

  function productLabel(product) {
    if (!product) return "Sin producto registrado";
    const parts = [];
    if (product.brand || product.name || product.productName) parts.push(product.brand || product.name || product.productName);
    if (product.packageQty) parts.push(`${formatNumber(product.packageQty)} ${product.packageUnit || ""}`.trim());
    if (product.price) parts.push(formatCurrency(product.price));
    if (product.barcode) parts.push(product.barcode);
    return parts.join(" · ") || "Producto";
  }

  function bestProduct(ingredient, neededQty, neededUnit) {
    const neededBase = toBase(neededQty, neededUnit || ingredient?.unit || "unidades");
    const products = productsOf(ingredient);
    if (!products.length) return null;
    const scored = products.map(product => {
      const packBase = toBase(product.packageQty || product.qty || 0, product.packageUnit || product.unit || ingredient?.unit);
      if (!packBase.qty || packBase.unit !== neededBase.unit) return { product, score: -1 };
      const packs = Math.max(1, Math.ceil(neededBase.qty / packBase.qty));
      const purchased = packs * packBase.qty;
      const leftover = Math.max(0, purchased - neededBase.qty);
      const price = number(product.price);
      const score = 100 - (leftover / Math.max(1, purchased)) * 50 - price * 0.2;
      return { product, packs, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.score >= 0 ? scored[0] : { product: products[0], packs: 1, score: 0 };
  }

  function calculateShoppingRows() {
    const ingredients = getIngredients();
    const week = getActiveWeek();
    if (window.ShoppingPlanner?.calculateShoppingPlan) {
      try {
        const result = window.ShoppingPlanner.calculateShoppingPlan({
          plan: week.plan || {},
          dishes: getDishes(),
          ingredients
        });
        const rows = result.purchases.length ? result.purchases : result.allocatedDemand || [];
        return rows.map(row => {
          const ingredient = ingredients.find(item => item.id === row.ingredientId)
            || ingredients.find(item => normalizeSearch(item.name) === normalizeSearch(row.ingredientName))
            || row.ingredient;
          const missingQty = number(row.missingQty ?? row.allocation?.missingQty ?? 0);
          const missingUnit = row.missingUnit || row.unit || ingredient?.unit || "unidades";
          const purchase = row.purchase || {};
          const product = purchase.product || bestProduct(ingredient, missingQty || row.totalQty, missingUnit)?.product || null;
          return {
            ingredientId: ingredient?.id || row.ingredientId || "",
            ingredientName: ingredient?.name || row.ingredientName || "Ingrediente",
            missingQty,
            missingUnit,
            demandQty: number(row.demand?.totalQty ?? row.totalQty ?? missingQty),
            demandUnit: row.demand?.unit || row.unit || missingUnit,
            product,
            cost: number(purchase.totalCost || product?.price || 0),
            note: purchase.note || ""
          };
        }).filter(row => row.ingredientId && (row.missingQty > 0 || row.product));
      } catch (error) {
        console.warn("No se pudo calcular la compra optimizada", error);
      }
    }
    return fallbackShoppingRows(ingredients);
  }

  function fallbackShoppingRows(ingredients) {
    return ingredients
      .filter(item => item.available === false || number(item.qty) === 0)
      .map(item => ({
        ingredientId: item.id,
        ingredientName: item.name || "Ingrediente",
        missingQty: 1,
        missingUnit: item.unit || "unidades",
        demandQty: 1,
        demandUnit: item.unit || "unidades",
        product: productsOf(item)[0] || null,
        cost: number(productsOf(item)[0]?.price || item.approxPrice || 0),
        note: "No se pudo leer la planificación; se muestra stock no disponible."
      }));
  }

  function injectStyles() {
    if ($("purchaseModeStyles")) return;
    const style = document.createElement("style");
    style.id = "purchaseModeStyles";
    style.textContent = `
      .pm-grid{display:grid;grid-template-columns:minmax(260px,420px) 1fr;gap:16px;align-items:start}.pm-box{border:1px solid var(--border,#cfe7df);border-radius:16px;padding:14px;background:#fff}.pm-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.pm-inline{display:grid;grid-template-columns:1fr 110px 110px;gap:8px}.pm-status{margin-top:10px;padding:10px;border-radius:12px;background:#eefaf6;color:#12302b}.pm-warning{margin-top:10px;padding:10px;border-radius:12px;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa}.pm-shop-list{display:grid;gap:8px;max-height:68vh;overflow:auto;padding-right:4px}.pm-shop-item{border:1px solid var(--border,#cfe7df);border-radius:14px;padding:10px;background:#f8fffd}.pm-shop-top{display:flex;justify-content:space-between;gap:8px}.pm-shop-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.pm-shop-actions button{padding:7px 9px;font-size:.84rem}.pm-log{display:grid;gap:8px;margin-top:10px}.pm-log-item{border-bottom:1px solid var(--border,#cfe7df);padding:8px 0}.pm-video{display:none;width:100%;border-radius:14px;margin-top:10px;background:#111}@media(max-width:850px){.pm-grid{grid-template-columns:1fr}.pm-inline{grid-template-columns:1fr}.pm-shop-list{max-height:none}.pm-box{padding:12px}}`;
    document.head.appendChild(style);
  }

  function addTab() {
    const tabs = document.querySelector(".tabs");
    if (!tabs || tabs.querySelector('[data-tab="purchase-mode"]')) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab-btn";
    btn.dataset.tab = "purchase-mode";
    btn.textContent = "Modo compra";
    tabs.appendChild(btn);
  }

  function addPanel() {
    const main = document.querySelector("main");
    if (!main || $("panel-purchase-mode")) return;
    const section = document.createElement("section");
    section.id = "panel-purchase-mode";
    section.className = "tab-panel card";
    section.innerHTML = `
      <h2>Modo compra</h2>
      <p class="muted">Usa la lista de la compra mientras compras: prepara una línea, escanea el producto, confirma caducidad y se suma al stock.</p>
      <div class="pm-grid">
        <div class="pm-box">
          <h3>Entrada rápida</h3>
          <label for="pmBarcode">Código de barras</label>
          <input id="pmBarcode" inputmode="numeric" autocomplete="off" placeholder="Escanea o escribe el código" />
          <div class="pm-actions"><button id="pmScan" type="button" class="secondary">Usar cámara</button><button id="pmStopScan" type="button" class="danger" style="display:none">Parar</button><button id="pmFindBarcode" class="ghost" type="button">Buscar código</button></div>
          <video id="pmVideo" class="pm-video" playsinline muted></video>
          <label for="pmIngredient">Ingrediente</label>
          <select id="pmIngredient"></select>
          <div class="pm-inline"><div><label for="pmBrand">Marca</label><input id="pmBrand" placeholder="Opcional" /></div><div><label for="pmQty">Cantidad</label><input id="pmQty" type="number" min="0" step="0.01" value="1" /></div><div><label for="pmUnit">Unidad</label><input id="pmUnit" value="unidades" /></div></div>
          <div class="pm-inline"><div><label for="pmExpiry">Fecha</label><input id="pmExpiry" type="date" /></div><div><label for="pmDateType">Tipo</label><select id="pmDateType"><option value="expiry">Caducidad</option><option value="bestBefore">Preferente</option></select></div><div><label for="pmStorage">Conservación</label><select id="pmStorage"><option value="pantry">Despensa</option><option value="fridge">Nevera</option><option value="freezer">Congelador</option></select></div></div>
          <div class="pm-inline"><div><label for="pmPrice">Precio opcional</label><input id="pmPrice" type="number" min="0" step="0.01" placeholder="0.00" /></div><div><label for="pmIsBulk">A granel</label><select id="pmIsBulk"><option value="no">No</option><option value="yes">Sí</option></select></div><div><label>&nbsp;</label><button id="pmRegister" type="button">Añadir al stock</button></div></div>
          <div class="pm-actions"><button id="pmRefresh" class="secondary" type="button">Actualizar lista</button><button id="pmClear" class="ghost" type="button">Limpiar formulario</button></div>
          <div id="pmStatus" class="pm-status">Selecciona un artículo de la lista o registra uno fuera de lista.</div>
          <h3>Últimas entradas</h3><div id="pmLog" class="pm-log"></div>
        </div>
        <div class="pm-box">
          <div class="pm-shop-top"><h3>Lista de la compra</h3><button id="pmReloadShopping" type="button" class="ghost">Recalcular</button></div>
          <div id="pmShoppingMeta" class="muted"></div>
          <div id="pmShoppingList" class="pm-shop-list"></div>
        </div>
      </div>`;
    main.appendChild(section);
  }

  function setStatus(message, warning) {
    const box = $("pmStatus");
    if (!box) return;
    box.className = warning ? "pm-warning" : "pm-status";
    box.textContent = message;
  }

  function refreshIngredients(selectedId) {
    const ingredients = getIngredients();
    const select = $("pmIngredient");
    if (select) {
      const previous = selectedId || select.value;
      select.innerHTML = ingredients
        .slice()
        .sort((a, b) => clean(a.name).localeCompare(clean(b.name), "es"))
        .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || "Sin nombre")}</option>`)
        .join("");
      if (previous) select.value = previous;
    }
    return ingredients;
  }

  function setFormFromProduct(ingredient, product, fallbackQty, fallbackUnit, bulk) {
    refreshIngredients(ingredient?.id);
    if ($("pmIngredient")) $("pmIngredient").value = ingredient?.id || "";
    if ($("pmBarcode")) $("pmBarcode").value = bulk ? "" : (product?.barcode || "");
    if ($("pmBrand")) $("pmBrand").value = product?.brand || product?.name || product?.productName || "";
    if ($("pmQty")) $("pmQty").value = product?.packageQty || fallbackQty || 1;
    if ($("pmUnit")) $("pmUnit").value = product?.packageUnit || fallbackUnit || ingredient?.unit || "unidades";
    if ($("pmPrice")) $("pmPrice").value = product?.price || "";
    if ($("pmIsBulk")) $("pmIsBulk").value = bulk ? "yes" : "no";
    if ($("pmBarcode")) $("pmBarcode").focus();
  }

  function renderShoppingList() {
    const list = $("pmShoppingList");
    const meta = $("pmShoppingMeta");
    if (!list) return;
    const rows = calculateShoppingRows();
    const week = getActiveWeek();
    if (meta) meta.textContent = `${week.name || "Semana"} · ${rows.length} artículos pendientes`;
    if (!rows.length) {
      list.innerHTML = `<div class="empty">No hay compra pendiente calculada. Revisa que la semana tenga platos con receta.</div>`;
      return;
    }
    list.innerHTML = rows.map(row => {
      const product = row.product;
      return `<article class="pm-shop-item" data-ingredient-id="${escapeHtml(row.ingredientId)}" data-missing-qty="${escapeHtml(row.missingQty || row.demandQty || 1)}" data-missing-unit="${escapeHtml(row.missingUnit || row.demandUnit || "unidades")}">
        <div class="pm-shop-top"><strong>${escapeHtml(row.ingredientName)}</strong><span class="badge missing">${escapeHtml(formatCurrency(row.cost))}</span></div>
        <small>Falta: ${escapeHtml(formatNumber(row.missingQty || row.demandQty || 1))} ${escapeHtml(row.missingUnit || row.demandUnit || "unidades")}</small><br>
        <small>Producto sugerido: ${escapeHtml(productLabel(product))}</small>${row.note ? `<br><small>${escapeHtml(row.note)}</small>` : ""}
        <div class="pm-shop-actions">
          <button type="button" data-pm-action="prepare" data-ingredient-id="${escapeHtml(row.ingredientId)}">Preparar / escanear</button>
          <button type="button" class="ghost" data-pm-action="bulk" data-ingredient-id="${escapeHtml(row.ingredientId)}">A granel</button>
          <button type="button" class="secondary" data-pm-action="mark" data-ingredient-id="${escapeHtml(row.ingredientId)}">Marcar comprando</button>
        </div>
      </article>`;
    }).join("");
  }

  function renderLog() {
    const log = $("pmLog");
    if (!log) return;
    const entries = asArray(read(KEYS.entries, [])).slice(-5).reverse();
    if (!entries.length) {
      log.innerHTML = `<div class="empty">Aún no hay entradas registradas.</div>`;
      return;
    }
    log.innerHTML = entries.map(entry => `<div class="pm-log-item"><strong>${escapeHtml(entry.ingredientName)}</strong><span>${escapeHtml(formatNumber(entry.qty))} ${escapeHtml(entry.unit)} · ${escapeHtml(entry.brand || "sin marca")} · ${escapeHtml(entry.barcode || "sin código")}</span><br><small>${escapeHtml(entry.expiryDate || "sin fecha")} · ${escapeHtml(new Date(entry.createdAt).toLocaleString("es-ES"))}</small></div>`).join("");
  }

  function prepareFromShopping(ingredientId, bulk) {
    const ingredients = refreshIngredients();
    const ingredient = ingredients.find(item => item.id === ingredientId);
    if (!ingredient) return setStatus("No he encontrado el ingrediente de esta línea.", true);
    const rows = calculateShoppingRows();
    const row = rows.find(item => item.ingredientId === ingredientId) || {};
    const product = bulk ? null : row.product;
    setFormFromProduct(ingredient, product, row.missingQty || row.demandQty || 1, row.missingUnit || row.demandUnit || ingredient.unit, bulk);
    setStatus(bulk ? `Listo para registrar ${ingredient.name} a granel. Indica peso y fecha.` : `Listo para ${ingredient.name}. Escanea el código o confirma el producto sugerido.`);
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
    const product = { barcode, brand: form.brand, packageQty: form.qty, packageUnit: form.unit, price: form.price, source: "purchase-mode", createdAt: nowIso() };
    ingredient.products.push(product);
    return { added: true, reason: similar ? "same-pack" : "variant", product };
  }

  function readForm() {
    return {
      barcode: clean($("pmBarcode")?.value),
      ingredientId: clean($("pmIngredient")?.value),
      brand: clean($("pmBrand")?.value),
      qty: number($("pmQty")?.value),
      unit: normalizeUnit($("pmUnit")?.value),
      expiryDate: clean($("pmExpiry")?.value),
      dateType: clean($("pmDateType")?.value) || "expiry",
      storageType: clean($("pmStorage")?.value) || "pantry",
      price: number($("pmPrice")?.value),
      isBulk: clean($("pmIsBulk")?.value) === "yes"
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
    const lot = { id: uid("lot"), ingredientId: ingredient.id, ingredientName: ingredient.name, qty: form.qty, unit: form.unit, expiryDate: form.expiryDate, dateType: form.dateType, storageType: form.storageType, barcode: form.barcode, brand: form.brand, price: form.price, isBulk: form.isBulk, createdAt: nowIso() };
    const entry = { ...lot, id: uid("purchase") };
    write(KEYS.ingredients, ingredients);
    write(KEYS.lots, asArray(read(KEYS.lots, [])).concat(lot).slice(-500));
    write(KEYS.entries, asArray(read(KEYS.entries, [])).concat(entry).slice(-300));
    renderLog();
    renderShoppingList();
    refreshIngredients(ingredient.id);
    setStatus(`${ingredient.name}: stock actualizado (+${formatNumber(form.qty)} ${form.unit}).${productResult.added ? " Código asociado al ingrediente." : ""}`);
    document.dispatchEvent(new CustomEvent("purchase-mode:stock-updated", { detail: { ingredient, lot, entry } }));
  }

  function findBarcode() {
    const ingredients = refreshIngredients();
    const barcode = clean($("pmBarcode")?.value);
    if (!barcode) return setStatus("Introduce o escanea un código.", true);
    const found = findByBarcode(ingredients, barcode);
    if (!found) return setStatus("Código no registrado. Selecciona el ingrediente de la lista para asociarlo al añadir al stock.", true);
    setFormFromProduct(found.ingredient, found.product, found.product.packageQty || 1, found.product.packageUnit || found.ingredient.unit, false);
    setStatus(`Código encontrado: ${found.ingredient.name}. Revisa caducidad y añade al stock.`);
  }

  function clearForm() {
    ["pmBarcode", "pmBrand", "pmExpiry", "pmPrice"].forEach(id => { if ($(id)) $(id).value = ""; });
    if ($("pmQty")) $("pmQty").value = 1;
    if ($("pmUnit")) $("pmUnit").value = "unidades";
    if ($("pmIsBulk")) $("pmIsBulk").value = "no";
    setStatus("Formulario limpio. Selecciona una línea de compra o añade fuera de lista.");
  }

  async function startScanner() {
    if (!window.BarcodeDetector) return setStatus("Este navegador no soporta BarcodeDetector. Usa el campo de código manual.", true);
    try {
      const video = $("pmVideo");
      const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.srcObject = stream;
      video.style.display = "block";
      await video.play();
      if ($("pmStopScan")) $("pmStopScan").style.display = "inline-block";
      const tick = async () => {
        if (!stream) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            if ($("pmBarcode")) $("pmBarcode").value = codes[0].rawValue;
            stopScanner();
            findBarcode();
            return;
          }
        } catch {}
        scanTimer = window.setTimeout(tick, 350);
      };
      tick();
      setStatus("Cámara activa. Apunta al código del producto.");
    } catch (error) {
      setStatus(`No se pudo abrir la cámara: ${error.message}`, true);
    }
  }

  function stopScanner() {
    if (scanTimer) window.clearTimeout(scanTimer);
    scanTimer = null;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    const video = $("pmVideo");
    if (video) { video.pause(); video.srcObject = null; video.style.display = "none"; }
    if ($("pmStopScan")) $("pmStopScan").style.display = "none";
  }

  function wire() {
    $("pmRegister")?.addEventListener("click", registerPurchase);
    $("pmFindBarcode")?.addEventListener("click", findBarcode);
    $("pmRefresh")?.addEventListener("click", () => { refreshIngredients(); renderShoppingList(); renderLog(); setStatus("Lista actualizada."); });
    $("pmReloadShopping")?.addEventListener("click", () => { renderShoppingList(); setStatus("Lista de la compra recalculada."); });
    $("pmClear")?.addEventListener("click", clearForm);
    $("pmScan")?.addEventListener("click", startScanner);
    $("pmStopScan")?.addEventListener("click", stopScanner);
    $("pmBarcode")?.addEventListener("change", findBarcode);
    $("pmShoppingList")?.addEventListener("click", event => {
      const button = event.target.closest("button[data-pm-action]");
      if (!button) return;
      const id = button.dataset.ingredientId;
      if (button.dataset.pmAction === "prepare") prepareFromShopping(id, false);
      if (button.dataset.pmAction === "bulk") prepareFromShopping(id, true);
      if (button.dataset.pmAction === "mark") { prepareFromShopping(id, false); setStatus("Artículo preparado. Escanea el código, indica fecha y pulsa Añadir al stock."); }
    });
    document.addEventListener("purchase-mode:stock-updated", () => setTimeout(renderShoppingList, 80));
  }

  function installDynamicNavigation() {
    if (window.__purchaseModeTabsReady) return;
    window.__purchaseModeTabsReady = true;
    document.addEventListener("click", event => {
      const btn = event.target.closest && event.target.closest(".tab-btn[data-tab]");
      if (!btn) return;
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tab-btn").forEach(item => item.classList.toggle("active", item.dataset.tab === tab));
      document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === `panel-${tab}`));
    });
  }

  function install() {
    if (installed) return;
    installed = true;
    injectStyles();
    installDynamicNavigation();
    addTab();
    addPanel();
    refreshIngredients();
    renderShoppingList();
    renderLog();
    wire();
  }

  window.PurchaseMode = { install, registerPurchase, findBarcode, compatiblePack, renderShoppingList, marker: MARKER };
  window.addEventListener("beforeunload", stopScanner);
})(window, document);
// PURCHASE_MODE_READY_V2_SHOPPING_LIST
