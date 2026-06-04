/*
 * Enhanced shopping UI bridge for PlanificadorComidas.
 * Re-renders the shopping summary/list using ShoppingPlanner without modifying index.html.
 */
(function attachShoppingUiBridge(global) {
  "use strict";

  let renderTimer = null;
  let isRendering = false;

  function byId(id) { return document.getElementById(id); }

  function escapeHtml(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0";
    return number.toLocaleString("es-ES", { maximumFractionDigits: 2 });
  }

  function formatCurrency(value) {
    const number = Number(value) || 0;
    return number.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
  }

  function readArray(key, fallback = []) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch { return fallback; }
  }

  function readState() {
    // Prefer raw localStorage here. PlanificadorDataStore is useful for safety,
    // but the monolithic index can contain freshly saved recipe aliases that we want to preserve.
    const weeks = readArray("savedWeeks", []);
    const activeWeekId = localStorage.getItem("activeWeekId") || weeks[0]?.id || "";
    return {
      ingredients: readArray("ingredients", []),
      dishes: readArray("dishes", []),
      weeks,
      activeWeekId
    };
  }

  function activeWeek(state) {
    return state.weeks.find(week => week.id === state.activeWeekId) || state.weeks[0] || { name: "Semana", plan: {} };
  }

  function renderSummary(container, result, week) {
    const summaryItems = [
      ["Ingredientes demandados", result.demand.length],
      ["Productos a comprar", result.summary.totalMissingItems],
      ["Coste real estimado", formatCurrency(result.summary.totalPurchaseCost)],
      ["Semana", week.name || "Semana activa"]
    ];

    container.innerHTML = summaryItems.map(([label, value]) => `
      <div class="summary-item">
        <strong>${escapeHtml(value)}</strong>
        <span class="muted">${escapeHtml(label)}</span>
      </div>`).join("");
  }

  function purchaseDescription(item) {
    const purchase = item.purchase;
    if (!purchase.product) return purchase.note || "Sin envase compatible registrado.";
    const productName = purchase.product.name || purchase.product.brand || "Producto";
    return `${productName}: comprar ${purchase.packages} paquete/s de ${formatNumber(purchase.product.packageQty)} ${purchase.product.packageUnit} · ${formatCurrency(purchase.totalCost)}`;
  }

  function demandDetails(item) {
    const rows = item.demand?.rows || [];
    if (!rows.length) return "Sin detalle de platos.";
    const byDish = new Map();
    rows.forEach(row => {
      const key = row.dishName || row.dishId || "Plato";
      const current = byDish.get(key) || { qty: 0, unit: row.unit, servings: 0 };
      current.qty += Number(row.qty) || 0;
      current.servings += Number(row.servings) || 0;
      byDish.set(key, current);
    });
    return Array.from(byDish.entries()).map(([name, row]) => `${name}: ${formatNumber(row.qty)} ${row.unit}`).join(" · ");
  }

  function renderShoppingItems(container, result) {
    container.innerHTML = "";
    if (!result.demand.length) {
      container.innerHTML = '<div class="empty">No hay ingredientes demandados. Revisa que los platos planificados tengan receta asociada.</div>';
      return;
    }

    const rowsToRender = result.purchases.length
      ? result.purchases
      : result.allocatedDemand.map(item => ({
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          missingQty: item.allocation?.missingQty || 0,
          missingUnit: item.unit,
          purchase: { fitScore: 100, product: null, leftoverQty: 0, leftoverUnit: item.unit, note: "Cubierto con stock disponible." },
          demand: item
        }));

    rowsToRender.forEach(item => {
      const div = document.createElement("div");
      div.className = "item shopping-item";
      const fitClass = item.purchase.fitScore >= 80 ? "ok" : item.purchase.fitScore >= 55 ? "warn" : "zero";
      const usedLots = item.demand.allocation?.allocations || [];
      const lotText = usedLots.length
        ? usedLots.map(lot => `${formatNumber(lot.usedQty)} ${lot.unit}${lot.expiryDate ? ` · caduca ${lot.expiryDate}` : ""}`).join("; ")
        : "Sin lotes usados o sin lotes registrados.";
      const missingText = item.missingQty > 0.0001
        ? `Falta ${formatNumber(item.missingQty)} ${item.missingUnit}.`
        : "No falta: cubierto con stock.";

      div.innerHTML = `
        <input type="checkbox" />
        <div>
          <strong>${escapeHtml(item.ingredientName)}</strong>
          <small>Demanda total: ${formatNumber(item.demand.totalQty)} ${escapeHtml(item.demand.unit)}.</small>
          <small>${escapeHtml(demandDetails(item))}</small>
          <small>${escapeHtml(missingText)}</small>
          <small>${escapeHtml(purchaseDescription(item))}</small>
          <small>Sobrante previsto: ${formatNumber(item.purchase.leftoverQty)} ${escapeHtml(item.purchase.leftoverUnit)}.</small>
          <small>Stock usado antes de comprar: ${escapeHtml(lotText)}</small>
        </div>
        <span class="badge ${fitClass}">${escapeHtml(item.purchase.fitScore)}/100</span>`;
      container.appendChild(div);
    });
  }

  function renderEnhancedShopping() {
    if (isRendering) return;
    if (!global.ShoppingPlanner?.calculateShoppingPlan) return;
    const shoppingList = byId("shoppingList");
    const shoppingSummary = byId("shoppingSummary");
    const shoppingWeekInfo = byId("shoppingWeekInfo");
    if (!shoppingList || !shoppingSummary) return;

    const state = readState();
    const week = activeWeek(state);
    const result = global.ShoppingPlanner.calculateShoppingPlan({
      plan: week.plan || {},
      dishes: state.dishes || [],
      ingredients: state.ingredients || []
    });

    isRendering = true;
    try {
      if (shoppingWeekInfo) shoppingWeekInfo.textContent = `Compra optimizada para: ${week.name || "Semana activa"}`;
      renderSummary(shoppingSummary, result, week);
      renderShoppingItems(shoppingList, result);
      shoppingList.dataset.enhancedShopping = "true";
    } finally {
      isRendering = false;
    }
  }

  function scheduleRender(delay = 60) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderEnhancedShopping, delay);
  }

  function install() {
    scheduleRender(200);
    document.addEventListener("planificador:modules-ready", () => scheduleRender(50));
    window.addEventListener("storage", () => scheduleRender(80));
    document.addEventListener("click", () => scheduleRender(160), true);
    document.addEventListener("input", () => scheduleRender(200), true);
    document.addEventListener("change", () => scheduleRender(200), true);
    const target = byId("panel-shopping") || document.body;
    if (target && "MutationObserver" in window) {
      const observer = new MutationObserver(() => { if (!isRendering) scheduleRender(100); });
      observer.observe(target, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();

  global.ShoppingUiBridge = { renderEnhancedShopping, scheduleRender };
})(typeof window !== "undefined" ? window : globalThis);
