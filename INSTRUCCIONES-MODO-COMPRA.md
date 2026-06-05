# Integrar Modo compra

1. Sube `purchase-mode.js` a la raíz del repositorio `WolcenOn/GestorMenuSemanal`.
2. En `app-bootstrap.js`, añade `"purchase-mode.js"` al array `optionalModules`.
3. En `loadAll()`, añade esta línea tras los otros módulos opcionales:

```js
if (window.PurchaseMode && typeof window.PurchaseMode.install === "function") window.PurchaseMode.install();
```

4. Comprueba que `purchase-mode.js` termina exactamente con:

```js
// PURCHASE_MODE_READY_V1
```

## Qué añade

- Pestaña `Modo compra`.
- Entrada rápida de stock durante la compra.
- Asociación de varios códigos de barras a un mismo ingrediente.
- Confirmación si el envase/peso no coincide con los productos ya asociados.
- Caducidad o consumo preferente.
- Conservación: despensa, nevera o congelador.
- Compra a granel.
- Historial `purchaseEntries`.
- Lotes `purchaseLots`.
