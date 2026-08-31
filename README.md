# Café 2035 · Huila

Aplicación web educativa para explorar un escenario fijo de expansión y desplazamiento de la huella cafetera del Huila entre enero de 2026 y diciembre de 2035.

La pantalla reproduce la composición visual aprobada: mapa territorial en el 75 % del espacio, panel de salud en el 25 %, leyenda, cronología y cuatro índices ambientales. La cartografía no es una imagen generada: se dibuja a partir de GeoJSON de IGAC, RUNAP y OpenStreetMap, con OpenFreeMap como fondo conectado y un mapa SVG local como respaldo.

## Ejecutar

```bash
npm install
npm run dev
```

Abrir `http://localhost:3000`. Para forzar el fondo local determinista: `http://localhost:3000/?basemap=local`.

## Controles

- Arrastrar la cronología selecciona cualquiera de los 120 meses.
- `Espacio` reproduce o pausa.
- `←` y `→` avanzan o retroceden un mes.
- `Inicio` y `Fin` saltan a los extremos.
- La reproducción completa dura 30 segundos y se detiene en diciembre de 2035.
- El mapa permite acercar, alejar, desplazar y consultar las celdas estimadas.

## Datos y modelo

Los archivos entregados a la aplicación están en `public/data/` y pesan aproximadamente 1 MB sin compresión. La huella inicial se calibra con el área sembrada municipal EVA 2019–2025 y se extrapola a 2026 mediante Theil–Sen con crecimiento anual limitado a ±3 %.

No existe una capa abierta y actual de lotes cafeteros individuales. Por tanto, las celdas son unidades visuales agregadas y su ubicación se identifica expresamente como estimación espacial. El servicio de aptitud cafetera de UPRA no estaba operativo durante la compilación; se conserva como referencia institucional y se usa un proxy reproducible basado en los umbrales climáticos publicados para *Coffea arabica*.

El intervalo inclusivo enero de 2026–diciembre de 2035 contiene **120 cortes mensuales**. Esto corrige la cifra de 109 que aparecía en el borrador del plan, sin modificar sus fechas de inicio o fin.

Más detalle en [docs/modelo-y-fuentes.md](docs/modelo-y-fuentes.md).

## Comandos

```bash
npm run data:fetch   # vuelve a consultar IGAC, EVA, RUNAP y OSM
npm run data:build   # regenera huella, cortes y manifiesto, sin aleatoriedad
npm run test:model   # pruebas unitarias y validación de datos
npm run test:e2e     # siete pruebas Playwright
npm run lint
npm run build
```

Las capturas de Playwright se escriben en `outputs/playwright/` y no se versionan. Las descargas crudas pesadas tampoco se guardan en Git.

## Advertencia de uso

El escenario es educativo y tendencial. No es una predicción parcelaria, no reemplaza monitoreo de campo y no autoriza expansión agrícola. El CO₂e incluye únicamente el cambio estimado de cobertura; excluye fertilizantes, transporte, beneficio y energía.

