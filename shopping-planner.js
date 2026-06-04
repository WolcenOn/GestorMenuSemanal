/*
 * Shopping planner engine for PlanificadorComidas.
 * Converts a weekly plan into ingredient demand, stock allocation and purchase suggestions.
 * Robustly reads recipe rows from recipe/ingredients/ingredientes/receta and resolves ingredients by id or name.
 */
(function attachShoppingPlanner(global) {
  "use strict";

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function round(value, decimals = 4) {
    const factor = 10 ** decimals;
    return Math.round((Number(value) || 0) * factor) / factor;
  }

  function normalizeSearch(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function normalizeUnit(unit) {
    if (global.MealCosting?.normalizeUnit) return global.MealCosting.normalizeUnit(unit);
    const clean = String(unit || "unidades").trim().toLowerCase();
    const aliases = {
      gr: "g", gramo: "g", gramos: "g",
      kilo: "kg", kilos: "kg",
      litro: "l", litros: "l",
      mililitro: "ml", mililitros: "ml",
      ud: "unidades", uds: "unidades", u: "unidades", unidad: "unidades", pieza: "unidades", piezas: "unidades"
    };
    const normalized = aliases[clean] || clean || "unidades";
    const group = ["g", "kg"].includes(normalized) ? "mass" : ["ml", "l"].includes(normalized) ? "volume" : "count";
    const baseUnit = group === "mass" ? "g" : group === "volume" ? "ml" : "unidades";
    const factor = normalized === "kg" ? 1000 : normalized === "l" ? 1000 : 1;
    return { group, unit: normalized, baseUnit, factor };
  }

  function toBaseQty(qty, unit) {
    if (global.MealCosting?.toBaseQty) return global.MealCosting.toBaseQty(qty, unit);
    const normalized = normalizeUnit(unit);
    return { qty: numberOrZero(qty) * (normalized.factor || 1), unit: normalized.baseUnit, group: normalized.group };
  }

  function convertQty(qty, fromUnit, toUnit) {
    if (global.MealCosting?.convertQty) return global.MealCosting.convertQty(qty, fromUnit, toUnit);
    const from = normalizeUnit(fromUnit);
    const to = normalizeUnit(toUnit);
    if (from.group !== to.group) return null;
    const baseQty = numberOrZero(qty) * (from.factor || 1);
    return baseQty / (to.factor || 1);
  }

  function getPlanDishEntries(plan = {}) {
    const entries = [];
    Object.entries(plan || {}).forEach(([slotId, value]) => {
      const values = Array.isArray(value) ? value : (value ? [value] : []);
      values.forEach(entry => {
        if (!entry) return;
        if (typeof entry === "string") {
          entries.push({ slotId, dishId: entry, servings: 1 });
        } else if (typeof entry === "object") {
          entries.push({
            slotId,
            dishId: entry.dishId || entry.id || entry.value || entry.platoId || "",
            servings: Math.max(0, numberOrZero(entry.servings ?? entry.raciones ?? entry.qty ?? 1)) || 1,
            memberIds: Array.isArray(entry.memberIds) ? entry.memberIds : []
          });
        }
      });
    });
    return entries.filter(entry => entry.dishId);
  }

  function calculatePlannedServings(plan = {}) {
    const servingsByDish = {};
    const entries = getPlanDishEntries(plan);
    entries.forEach(entry => {
      servingsByDish[entry.dishId] = (servingsByDish[entry.dishId] || 0) + entry.servings;
    });
    return { entries, servingsByDish };
  }

  function getDishRecipeRows(dish = {}) {
    const rows = dish.recipe || dish.ingredients || dish.ingredientes || dish.receta || dish.items || [];
    return Array.isArray(rows) ? rows : [];
  }

  function normalizeRecipeRow(row = {}) {
    const ingredientId = row.ingredientId || row.ingredienteId || row.id || row.ingredient_id || "";
    const name = row.name || row.nombre || row.ingredient || row.ingrediente || row.product || row.producto || "";
    return {
      ...row,
      ingredientId,
      name,
      qty: numberOrZero(row.qty ?? row.qtyPerServing ?? row.cantidad ?? row.amount ?? row.quantity ?? row.cantidadPorRacion),
      unit: row.unit || row.unidad || row.units || ""
    };
  }

  function ingredientName(ingredient = {}, row = {}) {
    return ingredient.name || ingredient.nombre || row.name || row.nombre || row.ingredient || row.ingrediente || "Ingrediente";
  }

  function buildIngredientIndexes(ingredients = []) {
    const byId = new Map();
    const byName = new Map();
    ingredients.forEach(ingredient => {
      if (ingredient.id) byId.set(String(ingredient.id), ingredient);
      const name = normalizeSearch(ingredient.name || ingredient.nombre);
      if (name && !byName.has(name)) byName.set(name, ingredient);
    });
    return { byId, byName };
  }

  function resolveIngredient(row = {}, indexes) {
    const normalizedRow = normalizeRecipeRow(row);
    if (normalizedRow.ingredientId && indexes.byId.has(String(normalizedRow.ingredientId))) {
      return { ingredient: indexes.byId.get(String(normalizedRow.ingredientId)), ingredientId: normalizedRow.ingredientId, row: normalizedRow };
    }
    const rowName = normalizeSearch(normalizedRow.name);
    if (rowName && indexes.byName.has(rowName)) {
      const ingredient = indexes.byName.get(rowName);
      return { ingredient, ingredientId: ingredient.id || normalizedRow.ingredientId || "", row: normalizedRow };
    }
    return {
      ingredient: {
        id: normalizedRow.ingredientId || "",
        name: normalizedRow.name || "Ingrediente sin registrar",
        unit: normalizedRow.unit || "unidades",
        qty: 0,
        available: false,
        approxPrice: numberOrZero(normalizedRow.approxPrice ?? normalizedRow.price ?? normalizedRow.precioAproximado),
        products: []
      },
      ingredientId: normalizedRow.ingredientId || "",
      row: normalizedRow
    };
  }

  function buildIngredientDemand(plan = {}, dishes = [], ingredients = []) {
    const { entries } = calculatePlannedServings(plan);
    const dishesById = new Map(dishes.map(dish => [String(dish.id), dish]));
    const indexes = buildIngredientIndexes(ingredients);
    const demandByIngredient = new Map();

    entries.forEach(entry => {
      const dish = dishesById.get(String(entry.dishId));
      if (!dish) return;
      const recipe = getDishRecipeRows(dish).map(normalizeRecipeRow).filter(row => row.qty > 0);
      recipe.forEach(rawRow => {
        const { ingredient, ingredientId, row } = resolveIngredient(rawRow, indexes);
        const unit = row.unit || ingredient.unit || ingredient.unidad || "unidades";
        const qty = row.qty * entry.servings;
        const base = toBaseQty(qty, unit);
        const key = ingredientId || `name:${normalizeSearch(ingredientName(ingredient, row))}::${normalizeUnit(unit).baseUnit}`;
        const current = demandByIngredient.get(key) || {
          ingredientId,
          ingredientName: ingredientName(ingredient, row),
          unit,
          baseUnit: base.unit,
          unitGroup: base.group,
          totalQty: 0,
          totalBaseQty: 0,
          rows: [],
          virtualIngredient: !ingredientId
        };

        current.totalQty += qty;
        current.totalBaseQty += base.qty;
        current.rows.push({
          dishId: dish.id,
          dishName: dish.name || dish.nombre || "Plato",
          slotId: entry.slotId,
          servings: entry.servings,
          qty,
          unit,
          baseQty: base.qty,
          baseUnit: base.unit
        });
        demandByIngredient.set(key, current);
      });
    });

    return Array.from(demandByIngredient.values()).map(item => ({
      ...item,
      totalQty: round(item.totalQty, 4),
      totalBaseQty: round(item.totalBaseQty, 4)
    })).sort((a, b) => a.ingredientName.localeCompare(b.ingredientName, "es"));
  }

  function allocateDemand(demandItems = [], ingredients = []) {
    const indexes = buildIngredientIndexes(ingredients);
    return demandItems.map(demand => {
      const ingredient = demand.ingredientId
        ? indexes.byId.get(String(demand.ingredientId))
        : indexes.byName.get(normalizeSearch(demand.ingredientName));
      const safeIngredient = ingredient || { id: demand.ingredientId, name: demand.ingredientName, unit: demand.unit, qty: 0, available: false, products: [] };
      const allocation = global.MealCosting?.allocateLots
        ? global.MealCosting.allocateLots(safeIngredient, demand.totalQty, demand.unit)
        : fallbackAllocate(safeIngredient, demand.totalQty, demand.unit);
      return { ...demand, ingredient: safeIngredient, allocation };
    });
  }

  function fallbackAllocate(ingredient, requiredQty, unit) {
    const available = ingredient.available === false ? 0 : numberOrZero(ingredient.qty);
    const convertedAvailable = convertQty(available, ingredient.unit || unit, unit);
    const availableInDemandUnit = convertedAvailable === null ? available : convertedAvailable;
    const missing = Math.max(0, numberOrZero(requiredQty) - availableInDemandUnit);
    return {
      requiredBaseQty: numberOrZero(requiredQty),
      baseUnit: unit,
      allocatedBaseQty: Math.min(numberOrZero(requiredQty), availableInDemandUnit),
      missingBaseQty: missing,
      missingQty: missing,
      unit,
      allocations: [],
      stockCost: 0
    };
  }

  function normalizeProduct(product = {}, fallbackUnit = "unidades") {
    if (global.MealCosting?.normalizeProduct) return global.MealCosting.normalizeProduct(product, fallbackUnit);
    const price = numberOrZero(product.price);
    const packageQty = numberOrZero(product.packageQty ?? product.qty ?? product.quantity ?? 0);
    const packageUnit = product.packageUnit || product.unit || fallbackUnit;
    const packageBase = toBaseQty(packageQty, packageUnit);
    return {
      ...product,
      name: product.productName || product.name || product.brand || "Producto",
      packageQty,
      packageUnit,
      packageBaseQty: packageBase.qty,
      packageBaseUnit: packageBase.unit,
      unitGroup: packageBase.group,
      price,
      unitCost: packageBase.qty > 0 ? price / packageBase.qty : 0
    };
  }

  function choosePurchaseOption(ingredient = {}, missingQty, missingUnit) {
    const missingBase = toBaseQty(missingQty, missingUnit || ingredient.unit || "unidades");
    const options = (Array.isArray(ingredient.products) ? ingredient.products : [])
      .map(product => normalizeProduct(product, ingredient.unit || missingUnit || "unidades"))
      .filter(product => product.price > 0 && product.packageBaseQty > 0 && product.unitGroup === missingBase.group)
      .map(product => {
        const packages = Math.max(1, Math.ceil(missingBase.qty / product.packageBaseQty));
        const purchasedBaseQty = packages * product.packageBaseQty;
        const leftoverBaseQty = Math.max(0, purchasedBaseQty - missingBase.qty);
        const leftoverQty = convertQty(leftoverBaseQty, product.packageBaseUnit, product.packageUnit) ?? leftoverBaseQty;
        const wasteRatio = purchasedBaseQty > 0 ? leftoverBaseQty / purchasedBaseQty : 1;
        const fitScore = Math.max(0, Math.min(100, Math.round(100 - wasteRatio * 60 - Math.max(0, product.unitCost) * 2)));
        return {
          product,
          packages,
          purchasedBaseQty: round(purchasedBaseQty, 4),
          purchasedQty: round(packages * product.packageQty, 4),
          purchasedUnit: product.packageUnit,
          leftoverBaseQty: round(leftoverBaseQty, 4),
          leftoverQty: round(leftoverQty, 4),
          leftoverUnit: product.packageUnit,
          totalCost: round(packages * product.price, 4),
          unitCost: round(product.unitCost, 6),
          fitScore,
          wasteRatio: round(wasteRatio, 4)
        };
      });

    if (!options.length) {
      const approxPrice = numberOrZero(ingredient.approxPrice);
      return {
        product: null,
        packages: 0,
        purchasedBaseQty: round(missingBase.qty, 4),
        purchasedQty: round(missingQty, 4),
        purchasedUnit: missingUnit || ingredient.unit || "unidades",
        leftoverBaseQty: 0,
        leftoverQty: 0,
        leftoverUnit: missingUnit || ingredient.unit || "unidades",
        totalCost: approxPrice,
        unitCost: 0,
        fitScore: approxPrice ? 60 : 30,
        wasteRatio: 0,
        note: "Sin producto por envase compatible; usa precio aproximado si existe."
      };
    }

    return options.sort((a, b) => b.fitScore - a.fitScore || a.totalCost - b.totalCost || a.unitCost - b.unitCost)[0];
  }

  function buildPurchasePlan(allocatedDemand = []) {
    return allocatedDemand
      .filter(item => item.allocation.missingQty > 0.0001)
      .map(item => {
        const purchase = choosePurchaseOption(item.ingredient, item.allocation.missingQty, item.unit);
        return {
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          missingQty: round(item.allocation.missingQty, 4),
          missingUnit: item.unit,
          missingBaseQty: item.allocation.missingBaseQty,
          baseUnit: item.allocation.baseUnit,
          purchase,
          demand: item
        };
      })
      .sort((a, b) => a.ingredientName.localeCompare(b.ingredientName, "es"));
  }

  function calculateShoppingPlan({ plan = {}, dishes = [], ingredients = [] } = {}) {
    const demand = buildIngredientDemand(plan, dishes, ingredients);
    const allocatedDemand = allocateDemand(demand, ingredients);
    const purchases = buildPurchasePlan(allocatedDemand);
    const totalPurchaseCost = purchases.reduce((sum, item) => sum + numberOrZero(item.purchase.totalCost), 0);
    const totalMissingItems = purchases.length;
    const totalLeftoverBaseQty = purchases.reduce((sum, item) => sum + numberOrZero(item.purchase.leftoverBaseQty), 0);
    const averageFitScore = purchases.length
      ? purchases.reduce((sum, item) => sum + numberOrZero(item.purchase.fitScore), 0) / purchases.length
      : 100;

    return {
      demand,
      allocatedDemand,
      purchases,
      summary: {
        totalPurchaseCost: round(totalPurchaseCost, 2),
        totalMissingItems,
        totalLeftoverBaseQty: round(totalLeftoverBaseQty, 4),
        averageFitScore: round(averageFitScore, 2)
      }
    };
  }

  function runSelfTests() {
    const ingredients = [{
      id: "tomate",
      name: "Tomate triturado",
      qty: 100,
      unit: "g",
      available: true,
      products: [{ brand: "Bote", packageQty: 500, packageUnit: "g", price: 1.25 }],
      stockLots: [{ id: "lote-1", qty: 100, unit: "g", expiryDate: "2026-06-05" }]
    }];
    const dishes = [
      { id: "pasta", name: "Pasta", recipe: [{ ingredientId: "tomate", qty: 150, unit: "g" }] },
      { id: "ensalada", name: "Ensalada", ingredients: [{ name: "Tomate triturado", qty: 50, unit: "g" }] }
    ];
    const plan = { slot1: ["pasta", "pasta", "ensalada"] };
    const result = calculateShoppingPlan({ plan, dishes, ingredients });
    const tomatoDemand = result.demand.find(item => item.ingredientId === "tomate" || item.ingredientName === "Tomate triturado");
    const assertions = [
      [tomatoDemand && tomatoDemand.totalQty === 350, "demand reads recipe and ingredients aliases by id or name"],
      [result.allocatedDemand[0].allocation.missingQty === 250, "stock is subtracted from demand"],
      [result.purchases[0].purchase.packages === 1, "purchase is rounded to complete packages"],
      [result.summary.totalPurchaseCost === 1.25, "purchase cost uses full package price"]
    ];
    return assertions.map(([ok, message]) => ({ ok, message }));
  }

  global.ShoppingPlanner = {
    getPlanDishEntries,
    calculatePlannedServings,
    getDishRecipeRows,
    normalizeRecipeRow,
    buildIngredientDemand,
    allocateDemand,
    choosePurchaseOption,
    buildPurchasePlan,
    calculateShoppingPlan,
    runSelfTests
  };
})(typeof window !== "undefined" ? window : globalThis);
