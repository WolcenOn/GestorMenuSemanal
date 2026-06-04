/*
 * Meal costing helpers for PlanificadorComidas.
 * Normalizes units, calculates proportional recipe costs, and allocates stock lots
 * using FEFO: first-expired, first-out.
 */
(function attachMealCosting(global) {
  "use strict";

  const UNIT_GROUPS = {
    mass: {
      baseUnit: "g",
      units: { g: 1, gr: 1, gramo: 1, gramos: 1, kg: 1000, kilo: 1000, kilos: 1000 }
    },
    volume: {
      baseUnit: "ml",
      units: { ml: 1, mililitro: 1, mililitros: 1, cl: 10, l: 1000, litro: 1000, litros: 1000 }
    },
    count: {
      baseUnit: "ud",
      units: { ud: 1, uds: 1, u: 1, unidad: 1, unidades: 1, pieza: 1, piezas: 1, racion: 1, raciones: 1 }
    }
  };

  function cleanText(value, fallback = "") {
    return String(value ?? fallback).trim();
  }

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function round(value, decimals = 4) {
    const factor = 10 ** decimals;
    return Math.round((Number(value) || 0) * factor) / factor;
  }

  function normalizeUnit(unit) {
    const clean = cleanText(unit || "ud").toLowerCase();
    for (const [group, config] of Object.entries(UNIT_GROUPS)) {
      if (Object.prototype.hasOwnProperty.call(config.units, clean)) {
        return { group, unit: clean, baseUnit: config.baseUnit, factor: config.units[clean] };
      }
    }
    return { group: "custom", unit: clean || "ud", baseUnit: clean || "ud", factor: 1 };
  }

  function convertQty(qty, fromUnit, toUnit) {
    const from = normalizeUnit(fromUnit);
    const to = normalizeUnit(toUnit);
    if (from.group !== to.group) return null;
    return numberOrZero(qty) * from.factor / to.factor;
  }

  function toBaseQty(qty, unit) {
    const normalized = normalizeUnit(unit);
    return {
      qty: numberOrZero(qty) * normalized.factor,
      unit: normalized.baseUnit,
      group: normalized.group
    };
  }

  function isValidDate(value) {
    if (!value || typeof value !== "string") return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00`);
    return !Number.isNaN(date.getTime());
  }

  function compareExpiry(a, b) {
    const aDate = isValidDate(a.expiryDate) ? a.expiryDate : "9999-12-31";
    const bDate = isValidDate(b.expiryDate) ? b.expiryDate : "9999-12-31";
    return aDate.localeCompare(bDate);
  }

  function normalizeProduct(product = {}, fallbackUnit = "ud") {
    const packageUnit = product.packageUnit || product.unit || fallbackUnit || "ud";
    const base = toBaseQty(product.packageQty ?? product.qty ?? product.quantity ?? 0, packageUnit);
    const price = numberOrZero(product.price);
    return {
      ...product,
      id: product.id || product.barcode || product.code || "",
      name: cleanText(product.productName || product.name || product.brand || "Producto"),
      packageQty: numberOrZero(product.packageQty ?? product.qty ?? product.quantity ?? 0),
      packageUnit,
      packageBaseQty: base.qty,
      packageBaseUnit: base.unit,
      unitGroup: base.group,
      price,
      unitCost: base.qty > 0 && price > 0 ? price / base.qty : 0
    };
  }

  function bestUnitCostProduct(ingredient = {}) {
    const products = Array.isArray(ingredient.products) ? ingredient.products : [];
    const ingredientUnit = ingredient.unit || "ud";
    const ingredientGroup = normalizeUnit(ingredientUnit).group;
    const compatible = products
      .map(product => normalizeProduct(product, ingredientUnit))
      .filter(product => product.price > 0 && product.packageBaseQty > 0 && product.unitGroup === ingredientGroup);

    if (!compatible.length) {
      const ingredientBase = toBaseQty(ingredient.qty || 1, ingredientUnit);
      const approxPrice = numberOrZero(ingredient.approxPrice);
      if (approxPrice > 0 && ingredientBase.qty > 0) {
        return {
          id: "approx",
          name: "Precio aproximado",
          packageQty: ingredient.qty || 1,
          packageUnit: ingredientUnit,
          packageBaseQty: ingredientBase.qty,
          packageBaseUnit: ingredientBase.unit,
          unitGroup: ingredientBase.group,
          price: approxPrice,
          unitCost: approxPrice / ingredientBase.qty,
          source: "approxPrice"
        };
      }
      return null;
    }

    return compatible.slice().sort((a, b) => a.unitCost - b.unitCost)[0];
  }

  function normalizeStockLot(lot = {}, ingredient = {}) {
    const unit = lot.unit || ingredient.unit || "ud";
    const base = toBaseQty(lot.qty ?? lot.quantity ?? 0, unit);
    const product = lot.product || bestUnitCostProduct(ingredient);
    const normalizedProduct = product ? normalizeProduct(product, unit) : null;
    return {
      id: lot.id || `${ingredient.id || ingredient.name || "ingredient"}-${Math.random().toString(16).slice(2)}`,
      ingredientId: lot.ingredientId || ingredient.id || "",
      ingredientName: ingredient.name || lot.ingredientName || "Ingrediente",
      qty: numberOrZero(lot.qty ?? lot.quantity ?? 0),
      unit,
      baseQty: base.qty,
      baseUnit: base.unit,
      unitGroup: base.group,
      expiryDate: lot.expiryDate || ingredient.expiryDate || "",
      openedDate: lot.openedDate || ingredient.openedDate || "",
      storageType: lot.storageType || ingredient.storageType || "pantry",
      unitCost: numberOrZero(lot.unitCost) || (normalizedProduct ? normalizedProduct.unitCost : 0),
      product: normalizedProduct
    };
  }

  function getIngredientLots(ingredient = {}) {
    if (Array.isArray(ingredient.stockLots) && ingredient.stockLots.length) {
      return ingredient.stockLots.map(lot => normalizeStockLot(lot, ingredient));
    }

    return [normalizeStockLot({
      id: `${ingredient.id || ingredient.name || "ingredient"}-main`,
      qty: ingredient.available === false ? 0 : numberOrZero(ingredient.qty),
      unit: ingredient.unit || "ud",
      expiryDate: ingredient.expiryDate || "",
      openedDate: ingredient.openedDate || "",
      storageType: ingredient.storageType || "pantry",
      unitCost: 0
    }, ingredient)];
  }

  function allocateLots(ingredient = {}, requiredQty, requiredUnit) {
    const requiredBase = toBaseQty(requiredQty, requiredUnit || ingredient.unit || "ud");
    const lots = getIngredientLots(ingredient)
      .filter(lot => lot.unitGroup === requiredBase.group && lot.baseQty > 0)
      .sort(compareExpiry);

    let remaining = requiredBase.qty;
    const allocations = [];

    for (const lot of lots) {
      if (remaining <= 0) break;
      const usedBaseQty = Math.min(remaining, lot.baseQty);
      remaining -= usedBaseQty;
      allocations.push({
        lotId: lot.id,
        ingredientId: lot.ingredientId,
        ingredientName: lot.ingredientName,
        usedBaseQty: round(usedBaseQty),
        baseUnit: requiredBase.unit,
        usedQty: round(convertQty(usedBaseQty, requiredBase.unit, requiredUnit || ingredient.unit || "ud") ?? usedBaseQty),
        unit: requiredUnit || ingredient.unit || "ud",
        expiryDate: lot.expiryDate,
        storageType: lot.storageType,
        unitCost: lot.unitCost,
        cost: round(usedBaseQty * lot.unitCost, 4)
      });
    }

    return {
      requiredBaseQty: round(requiredBase.qty),
      baseUnit: requiredBase.unit,
      allocatedBaseQty: round(requiredBase.qty - Math.max(remaining, 0)),
      missingBaseQty: round(Math.max(remaining, 0)),
      missingQty: round(convertQty(Math.max(remaining, 0), requiredBase.unit, requiredUnit || ingredient.unit || "ud") ?? Math.max(remaining, 0)),
      unit: requiredUnit || ingredient.unit || "ud",
      allocations,
      stockCost: round(allocations.reduce((sum, item) => sum + item.cost, 0), 4)
    };
  }

  function recipeRowCost(row = {}, ingredient = {}, servings = 1) {
    const qty = numberOrZero(row.qtyPerServing ?? row.qty ?? row.amount ?? 0) * numberOrZero(servings || 1);
    const unit = row.unit || ingredient.unit || "ud";
    const base = toBaseQty(qty, unit);
    const product = bestUnitCostProduct(ingredient);
    const unitCost = product && product.unitGroup === base.group ? product.unitCost : 0;
    const allocation = allocateLots(ingredient, qty, unit);
    const estimatedCost = unitCost ? base.qty * unitCost : allocation.stockCost;

    return {
      ingredientId: ingredient.id || row.ingredientId || "",
      ingredientName: ingredient.name || row.name || "Ingrediente",
      qty: round(qty),
      unit,
      baseQty: round(base.qty),
      baseUnit: base.unit,
      unitCost: round(unitCost || allocation.allocations[0]?.unitCost || 0, 6),
      estimatedCost: round(estimatedCost, 4),
      allocation,
      product
    };
  }

  function calculateRecipeCost(dish = {}, ingredients = [], servings = 1) {
    const rows = Array.isArray(dish.recipe) ? dish.recipe : [];
    const details = rows.map(row => {
      const ingredient = ingredients.find(item => item.id === row.ingredientId) || row;
      return recipeRowCost(row, ingredient, servings);
    });
    const totalCost = details.reduce((sum, item) => sum + item.estimatedCost, 0);
    return {
      dishId: dish.id || "",
      dishName: dish.name || "Plato",
      servings: numberOrZero(servings || 1),
      totalCost: round(totalCost, 4),
      costPerServing: round(totalCost / Math.max(1, numberOrZero(servings || 1)), 4),
      ingredients: details
    };
  }

  function summarizeLots(ingredients = []) {
    return ingredients.map(ingredient => {
      const lots = getIngredientLots(ingredient).sort(compareExpiry);
      const totalBaseQty = lots.reduce((sum, lot) => sum + lot.baseQty, 0);
      return {
        ingredientId: ingredient.id || "",
        ingredientName: ingredient.name || "Ingrediente",
        unit: ingredient.unit || "ud",
        lots,
        totalBaseQty: round(totalBaseQty),
        baseUnit: lots[0]?.baseUnit || normalizeUnit(ingredient.unit || "ud").baseUnit,
        nextExpiryDate: lots.find(lot => lot.expiryDate)?.expiryDate || "",
        lotCount: lots.length
      };
    });
  }

  function calculateDishCosts(dishes = [], ingredients = []) {
    return dishes.map(dish => calculateRecipeCost(dish, ingredients, 1));
  }

  function runSelfTests() {
    const ingredients = [{
      id: "tomate",
      name: "Tomate triturado",
      qty: 500,
      unit: "g",
      available: true,
      products: [{ brand: "Bote", packageQty: 500, packageUnit: "g", price: 1.25 }],
      stockLots: [
        { id: "old", qty: 200, unit: "g", expiryDate: "2026-06-05" },
        { id: "new", qty: 300, unit: "g", expiryDate: "2026-06-20" }
      ]
    }];
    const dish = { id: "pasta", name: "Pasta con tomate", recipe: [{ ingredientId: "tomate", qty: 150, unit: "g" }] };
    const cost = calculateRecipeCost(dish, ingredients, 2);
    const allocation = allocateLots(ingredients[0], 300, "g");
    const assertions = [
      [convertQty(1, "kg", "g") === 1000, "kg converts to g"],
      [bestUnitCostProduct(ingredients[0]).unitCost === 0.0025, "unit cost is price divided by package quantity"],
      [cost.totalCost === 0.75, "recipe cost is proportional to grams used"],
      [allocation.allocations[0].lotId === "old", "FEFO uses earliest expiry first"],
      [allocation.missingBaseQty === 0, "stock allocation covers available quantity"]
    ];
    return assertions.map(([ok, message]) => ({ ok, message }));
  }

  global.MealCosting = {
    UNIT_GROUPS,
    normalizeUnit,
    convertQty,
    toBaseQty,
    normalizeProduct,
    bestUnitCostProduct,
    normalizeStockLot,
    getIngredientLots,
    allocateLots,
    recipeRowCost,
    calculateRecipeCost,
    calculateDishCosts,
    summarizeLots,
    runSelfTests
  };
})(typeof window !== "undefined" ? window : globalThis);
