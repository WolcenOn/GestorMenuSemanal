/*
 * Waste metrics for PlanificadorComidas.
 * Calculates food mass, waste ratio, CO2 impact and weekly history snapshots.
 */
(function attachWasteMetrics(global) {
  "use strict";

  const HISTORY_KEY = "wasteMetricsHistory";
  const CO2_PER_KG_WASTE = 2.5;

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function cleanDate(value) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
    const date = new Date(`${text}T00:00:00`);
    return Number.isNaN(date.getTime()) ? "" : text;
  }

  function todayString(date = new Date()) {
    return new Date(date).toISOString().slice(0, 10);
  }

  function normalizeUnit(unit) {
    const clean = String(unit || "").trim().toLowerCase();
    const aliases = {
      gr: "g", gramo: "g", gramos: "g",
      kilo: "kg", kilos: "kg",
      litro: "l", litros: "l",
      mililitro: "ml", mililitros: "ml",
      ud: "unidades", uds: "unidades", u: "unidades", unidad: "unidades", pieza: "unidades", piezas: "unidades",
      racion: "unidades", raciones: "unidades"
    };
    return aliases[clean] || clean || "unidades";
  }

  function isCountUnit(unit) {
    return normalizeUnit(unit) === "unidades";
  }

  function itemKg(item = {}, qtyOverride = null) {
    const qty = qtyOverride === null ? numberOrZero(item.qty ?? item.cantidad ?? item.stock ?? item.racionesPreparadas) : numberOrZero(qtyOverride);
    const unit = normalizeUnit(item.unit || item.unidad);
    const unitWeightG = numberOrZero(item.unitWeightG ?? item.pesoUnidadG ?? item.weightPerUnitG);
    if (unit === "kg") return qty;
    if (unit === "g") return qty / 1000;
    if (unit === "l") return qty;
    if (unit === "ml") return qty / 1000;
    if (isCountUnit(unit) && unitWeightG > 0) return (qty * unitWeightG) / 1000;
    return 0;
  }

  function unitCost(item = {}) {
    const qty = numberOrZero(item.qty ?? item.cantidad ?? item.stock ?? item.racionesPreparadas) || numberOrZero(item.discardedQty ?? item.cantidadDesperdiciada);
    const approxPrice = numberOrZero(item.approxPrice ?? item.priceApprox ?? item.precioAproximado ?? item.price);
    if (approxPrice > 0 && qty > 0) return approxPrice / qty;
    const products = Array.isArray(item.products) ? item.products : [];
    const unit = normalizeUnit(item.unit || item.unidad);
    const compatible = products
      .map(product => {
        const packageQty = numberOrZero(product.packageQty ?? product.qty ?? product.quantity);
        const price = numberOrZero(product.price);
        const packageUnit = normalizeUnit(product.packageUnit || product.unit || unit);
        return { packageQty, price, packageUnit, unitCost: packageQty > 0 ? price / packageQty : 0 };
      })
      .filter(product => product.price > 0 && product.packageQty > 0 && product.packageUnit === unit)
      .sort((a, b) => a.unitCost - b.unitCost);
    return compatible[0]?.unitCost || 0;
  }

  function wasteQty(item = {}) {
    const discarded = numberOrZero(item.discardedQty ?? item.cantidadDesperdiciada);
    if (discarded > 0) return discarded;
    const expiryDate = cleanDate(item.expiryDate || item.caducidad || item.bestBeforeDate || item.fechaCaducidad);
    if (!expiryDate) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(`${expiryDate}T00:00:00`);
    expiry.setHours(0, 0, 0, 0);
    if (expiry.getTime() < today.getTime()) return numberOrZero(item.qty ?? item.cantidad ?? item.stock ?? item.racionesPreparadas);
    return 0;
  }

  function normalizeIngredient(item = {}) {
    return {
      ...item,
      id: item.id || item.name || item.nombre || Math.random().toString(16).slice(2),
      name: item.name || item.nombre || "Sin nombre",
      qty: numberOrZero(item.qty ?? item.cantidad),
      unit: normalizeUnit(item.unit || item.unidad),
      unitWeightG: numberOrZero(item.unitWeightG ?? item.pesoUnidadG ?? item.weightPerUnitG),
      approxPrice: numberOrZero(item.approxPrice ?? item.priceApprox ?? item.precioAproximado ?? item.price),
      discardedQty: numberOrZero(item.discardedQty ?? item.cantidadDesperdiciada),
      expiryDate: cleanDate(item.expiryDate || item.caducidad || item.bestBeforeDate || item.fechaCaducidad),
      available: item.available !== false && item.disponible !== false,
      itemType: "Ingrediente"
    };
  }

  function normalizeDish(item = {}) {
    return {
      ...item,
      id: item.id || item.name || item.nombre || Math.random().toString(16).slice(2),
      name: item.name || item.nombre || "Sin nombre",
      qty: numberOrZero(item.qty ?? item.racionesPreparadas ?? item.stock),
      unit: normalizeUnit(item.unit || item.unidad || "unidades"),
      unitWeightG: numberOrZero(item.unitWeightG ?? item.pesoUnidadG ?? item.weightPerUnitG),
      approxPrice: numberOrZero(item.approxPrice ?? item.priceApprox ?? item.precioAproximado ?? item.price),
      discardedQty: numberOrZero(item.discardedQty ?? item.cantidadDesperdiciada),
      preparedDate: cleanDate(item.preparedDate || item.fechaPreparacion || item.cookedDate),
      expiryDate: cleanDate(item.expiryDate || item.caducidad || item.bestBeforeDate || item.fechaCaducidad),
      itemType: "Plato"
    };
  }

  function calculateMetrics({ ingredients = [], dishes = [] } = {}) {
    const items = [
      ...ingredients.map(normalizeIngredient).filter(item => item.available !== false || item.qty > 0 || item.discardedQty > 0),
      ...dishes.map(normalizeDish).filter(item => item.qty > 0 || item.discardedQty > 0)
    ];
    const enriched = items.map(item => {
      const wastedQty = wasteQty(item);
      const currentKg = itemKg(item);
      const wastedKg = itemKg(item, wastedQty);
      const totalKg = Math.max(currentKg, wastedKg);
      const cost = wastedQty * unitCost(item);
      return { ...item, totalKg, wastedQty, wastedKg, wasteCost: cost, co2Kg: wastedKg * CO2_PER_KG_WASTE };
    });
    const totalKg = enriched.reduce((sum, item) => sum + item.totalKg, 0);
    const wastedKg = enriched.reduce((sum, item) => sum + item.wastedKg, 0);
    const wasteCost = enriched.reduce((sum, item) => sum + item.wasteCost, 0);
    const co2Kg = enriched.reduce((sum, item) => sum + item.co2Kg, 0);
    const wasteRatio = totalKg > 0 ? wastedKg / totalKg : 0;
    const score = Math.max(0, Math.min(100, Math.round(100 - wasteRatio * 100)));
    const missingWeightCount = enriched.filter(item => isCountUnit(item.unit) && (item.qty > 0 || item.discardedQty > 0) && !item.unitWeightG).length;
    return {
      date: todayString(), score, totalKg, wastedKg, wasteRatio, wastePercent: wasteRatio * 100, wasteCost, co2Kg,
      missingWeightCount, itemCount: enriched.length,
      items: enriched.sort((a, b) => b.wastedKg - a.wastedKg || b.co2Kg - a.co2Kg || b.wasteCost - a.wasteCost)
    };
  }

  function loadHistory() {
    try {
      const parsed = JSON.parse(global.localStorage?.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  function saveHistory(history) {
    global.localStorage?.setItem(HISTORY_KEY, JSON.stringify(Array.isArray(history) ? history.slice(-104) : []));
  }

  function saveSnapshot(metrics, label = "") {
    const history = loadHistory();
    const weekKey = label || metrics.weekId || metrics.date || todayString();
    const snapshot = {
      id: `${weekKey}-${Date.now()}`, weekKey, date: todayString(), score: metrics.score,
      totalKg: metrics.totalKg, wastedKg: metrics.wastedKg, wastePercent: metrics.wastePercent,
      wasteCost: metrics.wasteCost, co2Kg: metrics.co2Kg, missingWeightCount: metrics.missingWeightCount
    };
    history.push(snapshot);
    saveHistory(history);
    return snapshot;
  }

  function trend(history = loadHistory()) {
    const sorted = [...history].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (sorted.length < 2) return { direction: "stable", deltaScore: 0, deltaWasteKg: 0 };
    const previous = sorted[sorted.length - 2];
    const latest = sorted[sorted.length - 1];
    const deltaScore = latest.score - previous.score;
    const deltaWasteKg = latest.wastedKg - previous.wastedKg;
    return { direction: deltaScore > 0 ? "improving" : deltaScore < 0 ? "worsening" : "stable", deltaScore, deltaWasteKg, previous, latest };
  }

  global.WasteMetrics = { HISTORY_KEY, CO2_PER_KG_WASTE, normalizeUnit, isCountUnit, itemKg, unitCost, wasteQty, calculateMetrics, loadHistory, saveHistory, saveSnapshot, trend };
})(typeof window !== "undefined" ? window : globalThis);
