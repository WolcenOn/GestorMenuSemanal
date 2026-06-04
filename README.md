# PlanificadorComidas

Planificador de comidas semanal con control de stock.

## Bootstrap de modulos

`app-bootstrap.js` carga los modulos extraidos de forma ordenada. Es la opcion recomendada para actualizar `index.html` con el menor cambio posible.

Incluir al final de `index.html`, despues del script principal actual y antes de `</body>`:

```html
<script src="app-bootstrap.js"></script>
```

Actualmente carga:

1. `data-store.js`
2. `import-export.js`
3. `stock-lifecycle.js`
4. `meal-costing.js`
5. `shopping-planner.js`
6. `index-hardening.js`
7. `pack-preview-fix.js`
8. `shopping-ui-bridge.js`

## Capa segura de datos

`data-store.js` centraliza lectura/escritura de `localStorage`, saneamiento de JSON, normalizacion de datos y migracion de backups.

Objetivos:

- evitar `JSON.parse` dispersos por `index.html`;
- limpiar textos, fechas, cantidades y arrays antes de guardar;
- normalizar ingredientes, productos, lotes, platos, recetas, semanas, miembros y comidas;
- garantizar estructura minima aunque haya datos antiguos o incompletos;
- preparar el modelo `stockLots` y `baseServings` para calculos mas precisos.

Funciones principales:

- `PlanificadorDataStore.normalizeBackup(data)`
- `PlanificadorDataStore.loadAll()`
- `PlanificadorDataStore.saveAll(data)`
- `PlanificadorDataStore.buildBackup(data)`
- `PlanificadorDataStore.normalizeIngredient(item)`
- `PlanificadorDataStore.normalizeDish(item)`
- `PlanificadorDataStore.normalizeStockLot(item, ingredient)`
- `PlanificadorDataStore.runSelfTests()`

## Importacion y exportacion segura

`import-export.js` centraliza validacion, normalizacion y utilidades de importacion/exportacion.

Funciones principales:

- `PlanificadorImportExport.safeJsonParse(text)`
- `PlanificadorImportExport.normalizeImportPayload(data, mode)`
- `PlanificadorImportExport.validateImportText(text, mode)`
- `PlanificadorImportExport.summarizePayload(payload, mode)`
- `PlanificadorImportExport.buildBackupFromState(state)`
- `PlanificadorImportExport.downloadJson(filename, data)`
- `PlanificadorImportExport.copyJson(data)`
- `PlanificadorImportExport.runSelfTests()`

Modos soportados:

- `backup`: copia completa.
- `ingredients`: lista de ingredientes.
- `dishes`: lista de platos o recetas.

## Coste por racion y lotes de stock

`meal-costing.js` separa dos ideas importantes:

- Coste consumido: el coste de una receta se calcula proporcionalmente por gramo, mililitro o unidad usada.
- Compra necesaria: mas adelante se podra calcular por paquetes completos, pero sin cargar el coste entero del paquete al primer plato.

Ejemplo: si un paquete de 500 g cuesta 1,25 euros, el coste base es 0,0025 euros/g. Una receta que usa 150 g consume 0,375 euros de ese ingrediente, aunque el paquete comprado sea completo.

El modulo tambien soporta lotes de stock con fechas distintas mediante `stockLots`:

```json
{
  "name": "Tomate triturado",
  "unit": "g",
  "stockLots": [
    { "id": "lote-1", "qty": 200, "unit": "g", "expiryDate": "2026-06-05", "storageType": "fridge" },
    { "id": "lote-2", "qty": 300, "unit": "g", "expiryDate": "2026-06-20", "storageType": "pantry" }
  ]
}
```

El consumo de stock se asigna por FEFO: primero se usan los lotes que caducan antes.

Funciones principales:

- `MealCosting.normalizeUnit(unit)`
- `MealCosting.convertQty(qty, fromUnit, toUnit)`
- `MealCosting.bestUnitCostProduct(ingredient)`
- `MealCosting.getIngredientLots(ingredient)`
- `MealCosting.allocateLots(ingredient, requiredQty, requiredUnit)`
- `MealCosting.calculateRecipeCost(dish, ingredients, servings)`
- `MealCosting.summarizeLots(ingredients)`
- `MealCosting.runSelfTests()`

## Planificador de compra

`shopping-planner.js` convierte el plan semanal en demanda de ingredientes, asignacion de stock y propuesta de compra por paquetes.

Diferencia entre calculos:

- La demanda de recetas se calcula por raciones planificadas.
- El stock se descuenta usando lotes cuando existen.
- La compra recomendada redondea a paquetes completos.
- El sobrante esperado se calcula para poder reutilizarlo en otras comidas.

Funciones principales:

- `ShoppingPlanner.calculatePlannedServings(plan)`
- `ShoppingPlanner.buildIngredientDemand(plan, dishes, ingredients)`
- `ShoppingPlanner.allocateDemand(demand, ingredients)`
- `ShoppingPlanner.choosePurchaseOption(ingredient, missingQty, missingUnit)`
- `ShoppingPlanner.buildPurchasePlan(allocatedDemand)`
- `ShoppingPlanner.calculateShoppingPlan({ plan, dishes, ingredients })`
- `ShoppingPlanner.runSelfTests()`

## Lista de compra mejorada

`shopping-ui-bridge.js` mejora la seccion de compra sin modificar directamente `index.html`.

Aporta:

- coste real estimado por paquetes completos;
- ajuste medio de compra;
- sobrante previsto tras comprar;
- detalle de lotes usados antes de comprar, incluyendo caducidad cuando exista;
- refresco automatico cuando cambia el plan, ingredientes o stock.

## Caducidad, congelado y desperdicio

El modulo `stock-lifecycle.js` normaliza datos de stock y calcula avisos de consumo prioritario.

Campos soportados en ingredientes y platos:

- `expiryDate`: fecha en formato `YYYY-MM-DD`.
- `openedDate`: fecha de apertura.
- `preparedDate`: fecha de elaboracion.
- `frozenDate`: fecha de congelado.
- `storageType`: `pantry`, `fridge` o `freezer`.
- `discardedDate`, `discardedQty` y `wasteReason`: datos opcionales para registrar desperdicio.

Funciones principales:

- `StockLifecycle.normalizeIngredientStock(item)`
- `StockLifecycle.normalizeDishStock(item)`
- `StockLifecycle.migrateStockDatabase(data)`
- `StockLifecycle.buildExpiryAlerts(data, options)`
- `StockLifecycle.buildConsumptionRecommendations(data, options)`
- `StockLifecycle.calculateWasteScore(data, options)`
- `StockLifecycle.runSelfTests()`

## Hardening de index

`index-hardening.js` es una integracion progresiva para `index.html`. Aporta:

- campo de caducidad y conservacion al crear o editar ingredientes;
- saneamiento de JSON antes de importar copias completas, ingredientes o platos;
- limites de tamano y longitud para reducir datos corruptos o excesivos;
- normalizacion de fechas, cantidades, textos, productos y recetas;
- enlace rapido al panel `caducidades.html`.

## Vista previa de packs

`pack-preview-fix.js` corrige la vista previa de packs remotos de forma progresiva. Intercepta el boton `Vista previa`, resuelve rutas locales, rutas de GitHub y URLs raw, permite marcar recetas individuales y muestra un modal con platos detectados, categoria, tiempo, dificultad, numero de ingredientes y notas.

## Campo notes en recetas

El campo `notes` se debe usar para guardar tanto las notas generales como el procedimiento de elaboracion del plato. Esto mantiene la compatibilidad con el importador actual.

## Panel de caducidades

`caducidades.html` usa el mismo `localStorage` que la app principal y permite editar fechas, ver avisos, consultar la puntuacion de desperdicio y registrar cantidades desperdiciadas.

## Refactorizacion

Ver `docs/refactor-plan.md` para el plan de extraccion progresiva de `index.html`.

## Tests

Abre `tests/stock-lifecycle.test.html` en el navegador para ejecutar los tests minimos.
