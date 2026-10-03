# Modelo, fuentes y licencias

## Flujo reproducible

1. `scripts/fetch-base-data.mjs` consulta los municipios del Huila en IGAC, agrega los registros EVA de café por municipio y año, recorta RUNAP al departamento y convierte los cauces con nombre de OpenStreetMap a GeoJSON.
2. Las geometrías se simplifican para visualización web sin cambiar los totales municipales.
3. `scripts/build-simulation-data.mjs` calcula la tendencia Theil–Sen, estima 2026 y distribuye las hectáreas sobre celdas candidatas fuera de RUNAP.
4. Cada celda recibe aptitud 2026/2035, mes de incorporación o retiro, cobertura previa y señales de agua, suelo y biodiversidad.
5. Se generan 120 cortes mensuales y `model-manifest.json`, que incluye supuestos, comprobaciones y SHA-256 por archivo.

El proceso no usa números aleatorios. Repetirlo con las mismas entradas produce la misma huella y los mismos indicadores.

## Puntuación espacial

La regla conceptual es:

`40 % aptitud territorial + 25 % aptitud climática + 15 % cobertura compatible + 10 % presión histórica + 10 % continuidad`

RUNAP es una exclusión dura. La capa UPRA de aptitud cafetera figuraba como “service not started” el 31 de agosto de 2026, por lo que esta versión no redistribuye su geometría cruda: conserva sus clases como referencia y aplica el proxy climático documentado. Una actualización futura puede reemplazar el proxy sin cambiar el contrato de la aplicación.

## Indicadores

- **CO₂ equivalente:** diferencia de existencias por conversión de cobertura, expresada en kt CO₂e mediante `44/12`. El porcentaje usa una existencia de referencia departamental del escenario, no emisiones productivas completas.
- **Fuentes hídricas:** 60 % conservación de condición ribereña y 40 % cambio relativo de demanda. Los factores regionales de 233,2 L/kg de demanda y 16,1 L/kg de consumo azul se conservan como referencia conceptual.
- **Salud del suelo:** 45 % fuera de pendiente fuerte, 30 % fuera de carbono orgánico bajo y 25 % sin conversión de cobertura natural.
- **Biodiversidad:** 60 % retención de cobertura natural, 25 % distancia respecto a áreas protegidas o núcleos naturales y 15 % expansión sin conversión natural.
- **Resiliencia climática:** 60 % café en aptitud futura alta/media, 20 % índice hídrico y 20 % índice de suelo.

Todos los índices se limitan a 0–100 y se rotulan en pantalla como “índice didáctico estimado”.

### Representación territorial continua (octubre de 2026)

`npm run data:surface` genera `public/data/frontier-surface.json` a partir de los 292 elementos originales, los municipios IGAC y las áreas RUNAP. Es un producto exclusivamente visual: no modifica `cafe-frontier.geojson`, las hectáreas del modelo ni los 120 cortes de indicadores.

La malla utiliza un paso de 0,0018 grados y crecimiento contiguo de coste determinista. Su textura espacial es sintética, no procede de un modelo de elevaciones ni de coberturas observadas. Los núcleos próximos del mismo municipio pueden compartir borde; una expansión con un núcleo previo a más de 2 km de su centro de referencia se representa como isla. La distancia usa la aproximación 111 km/grado; no equivale a una medición predial. Las hectáreas orientan el tamaño de los parches, pero la discretización, el suavizado y las exclusiones hacen que su área dibujada no sea un cálculo métrico exacto.

Las celdas se incorporan progresivamente durante el mes anterior a su fecha de entrada; el retiro progresa desde el borde hacia el interior. Los contornos se extraen de la malla, compartiendo las fronteras entre celdas, sin filtros de desenfoque o turbulencia. Se conserva un contorno discontinuo de la huella inicial. El relleno ámbar representa expansión; el violeta tramado representa retiro o pérdida de aptitud, sin inferir que todos los retiros son climáticos. El tiempo determina completamente la geometría y la pausa la congela. Una máscara gráfica final excluye RUNAP incluso al suavizar los bordes.

El desplazamiento transforma píxeles de pantalla a unidades del SVG usando su escala real (`preserveAspectRatio`). Al soltar, esa misma conversión se aplica al centro del mapa para evitar desapariciones o saltos. La prueba de arrastre compara posiciones en pantalla antes, durante y después del gesto, también con zoom y en formato móvil.

## Fuentes y atribución

| Fuente | Uso | Atribución/licencia |
|---|---|---|
| [IGAC · límites](https://mapas2.igac.gov.co/server/rest/services/limites/limites/FeatureServer) | 37 municipios y contorno del Huila | Datos abiertos de la República de Colombia; atribución IGAC |
| [UPRA · EVA](https://www.datos.gov.co/resource/uejq-wxrr.json) | Área sembrada, cosechada, producción y rendimiento 2019–2025 | Datos Abiertos Colombia; atribución UPRA |
| [RUNAP](https://mapas.parquesnacionales.gov.co/arcgis/rest/services/pnn/runap/FeatureServer) | Exclusión legal y proximidad a áreas protegidas | Atribución RUNAP / Parques Nacionales Naturales |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Cauces con nombre y fondo OpenFreeMap | ODbL; © colaboradores de OpenStreetMap |
| [OpenFreeMap](https://openfreemap.org/) | Estilo cartográfico conectado | Según sus términos y atribución OSM visible |
| [UPRA · Aptitud café 2022](https://geoservicios.upra.gov.co/arcgis/rest/services/aptitud_uso_suelo/Aptitud_Cafe_Jul2022/MapServer/0) | Clases conceptuales A1/A2/A3/N | Referencia institucional UPRA; servicio no operativo al compilar |
| [IDEAM · escenarios departamentales](https://ideam.gov.co/sala-de-prensa/noticia/el-instituto-lanza-nuevos-escenarios-de-cambio-climatico-escala-departamental-para-fortalecer-la) | Señal SSP2-4.5 2021–2040 | Referencia institucional IDEAM |
| [Modelo multicriterio de aptitud](https://pmc.ncbi.nlm.nih.gov/articles/PMC8791496/) | Rangos de temperatura, precipitación, pendiente y carbono orgánico | Artículo científico de acceso abierto |
| [IPCC 2019 Refinement, AFOLU](https://efdb.ipcc-nggip.iges.or.jp/public/2019rf/vol4.html) | Cambio de existencias de carbono | Referencia metodológica IPCC |
| [Estudio de ocho cuencas del sur del Huila](https://hemeroteca.unad.edu.co/index.php/riaa/article/download/2284/2662?inline=1) | Referentes regionales de agua en caficultura | Artículo académico; cifras citadas con atribución |

La aplicación redistribuye resultados derivados y geometrías simplificadas con atribución visible. No incluye descargas raster crudas de MapBiomas, SoilGrids o escenarios climáticos.

## Contratos de datos

- `SimulationSnapshot`: fecha, área total, expansión, retiro, CO₂e y cuatro índices.
- `FrontierFeature`: municipio, origen, mes de inicio/retiro, hectáreas representadas, aptitud y confianza.
- `ModelManifest`: versión, escenario, fuentes, supuestos, comprobaciones y checksum.

## Pruebas

Las pruebas verifican tendencia robusta, clasificación de aptitud, activación y retiro, interpolación, límites 0–100, 37 municipios, 120 meses y paquete inferior a 8 MB. Playwright verifica reproducción/pausa, selección temporal, teclado, reinicio, sincronización, bloqueo de solicitudes externas y vistas 1440×900, 1024×768 y 390×844.
