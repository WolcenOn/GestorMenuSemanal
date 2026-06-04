# Plan de refactorizacion de index.html

Objetivo: reducir el tamano y riesgo de `index.html` separando funcionalidad en modulos pequenos, cargados progresivamente desde `app-bootstrap.js`.

## Paso 1: bootstrap minimo

Incluir al final de `index.html`, despues del script principal actual:

```html
<script src="app-bootstrap.js"></script>
```

`app-bootstrap.js` carga por orden:

1. `stock-lifecycle.js`
2. `index-hardening.js`
3. `pack-preview-fix.js`

## Paso 2: modulos ya extraidos

- `stock-lifecycle.js`: caducidades, congelado, desperdicio, recomendaciones y migracion de stock.
- `index-hardening.js`: saneamiento de importaciones, campos de caducidad en ingredientes y enlace al panel de caducidades.
- `pack-preview-fix.js`: vista previa robusta de packs remotos.

## Paso 3: siguientes modulos a extraer

Orden recomendado:

1. `data-store.js`
   - claves de localStorage
   - parseo seguro
   - save/load
   - migraciones

2. `import-export.js`
   - backup completo
   - importacion de ingredientes
   - importacion de platos
   - validacion comun

3. `packs.js`
   - prompt de packs
   - carga remota
   - vista previa
   - importacion de packs

4. `shopping-list.js`
   - calculo de compra
   - presupuesto
   - copiar/compartir

5. `calendar-planner.js`
   - semanas
   - plan semanal
   - semana tipo
   - filtros del calendario

6. `barcode-openfoodfacts.js`
   - escaner
   - consulta Open Food Facts
   - productos asociados a ingredientes

7. `ui-renderers.js`
   - renderizado de listas
   - helpers visuales
   - estados vacios

## Criterios de seguridad

- Mantener `index.html` funcionando despues de cada paso.
- Extraer un modulo por commit.
- No cambiar nombres de claves de localStorage sin migracion.
- Mantener compatibilidad con backups anteriores.
- Validar arrays, textos, fechas y cantidades antes de guardar.
- Evitar `innerHTML` con datos de usuario salvo que pasen por escape.

## Comprobacion manual minima tras cada paso

1. Abrir la app sin datos.
2. Crear un ingrediente.
3. Crear un plato.
4. Planificar una comida.
5. Calcular compra.
6. Exportar backup.
7. Importar backup.
8. Cargar packs.
9. Abrir vista previa de pack.
10. Abrir `caducidades.html`.
