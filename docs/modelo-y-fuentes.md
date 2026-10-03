# Modelo, fuentes y licencias

## Flujo reproducible

1. `scripts/fetch-base-data.mjs` consulta los municipios del Huila en IGAC, agrega los registros EVA de café por municipio y año, recorta RUNAP al departamento y convierte los cauces con nombre de OpenStreetMap a GeoJSON.
2. Las geometrías se simplifican para visualización web sin cambiar los totales municipales.
3. `scripts/build-simulation-data.mjs` calcula la tendencia Theil–Sen, estima 2026 y distribuye las hectáreas sobre celdas candidatas fuera de RUNAP.
4. Cada celda recibe aptitud 2026/2035, intervalos de incorporación y retiro parcial, cobertura previa sintética y señales de agua, suelo y biodiversidad.
5. Se generan 120 cortes mensuales y `model-manifest.json`, que incluye supuestos, comprobaciones y SHA-256 por archivo.

El proceso no usa números aleatorios. Repetirlo con las mismas entradas produce la misma huella y los mismos indicadores.

## Puntuación espacial

La regla conceptual es:

`40 % aptitud territorial + 25 % aptitud climática + 15 % cobertura compatible + 10 % presión histórica + 10 % continuidad`

RUNAP es una exclusión dura. La capa UPRA de aptitud cafetera figuraba como “service not started” el 31 de agosto de 2026, por lo que esta versión no redistribuye su geometría cruda: conserva sus clases como referencia y aplica el proxy climático documentado. Una actualización futura puede reemplazar el proxy sin cambiar el contrato de la aplicación.

## Indicadores

- **CO₂ equivalente:** suma de hectáreas incorporadas progresivamente × 96 t CO₂e/ha para la clase sintética natural o × 17 t CO₂e/ha para mosaico agropecuario, dividida por 1.000. Son factores didácticos de existencias; IPCC aporta la referencia conceptual, no una calibración regional de estos números. El porcentaje usa 5,2 millones de t CO₂e como referencia asumida, no un inventario observado.
- **Fuentes hídricas:** 60 % conservación de condición ribereña y 40 % cambio relativo de demanda. En 2.1 las dos presiones se multiplican por 2 para el ejercicio de aula: `ribera = 78 − 1.900 × conversión próxima a cauces / área inicial`; `demanda = 82 − 340 × aumento relativo de área`. Los factores regionales de 233,2 L/kg de demanda y 16,1 L/kg de consumo azul se conservan como referencia conceptual.
- **Salud del suelo:** 45 % proporción de hectáreas activas fuera de pendiente fuerte sintética, 30 % fuera de carbono orgánico bajo sintético y 25 % condición sin conversión natural (`1 − conversión natural acumulada / (0,10 × área inicial)`). En 2.1 se resta adicionalmente `75 × expansión acumulada / área inicial` como presión didáctica por intensificación territorial.
- **Biodiversidad:** `60 × R + 25 × P + 15 × C`. En 2.1 se moderan las tres presiones con un factor didáctico 0,35: `R = 0,84 − 0,35 × 3,2 × conversión natural acumulada / área inicial`; `P = 1 − 0,35 × expansión acumulada próxima a RUNAP / (0,20 × área inicial)`; `C = 1 − 0,35 × conversión natural acumulada / (0,10 × área inicial)`. Cada componente se limita a 0–1. Las escalas y ponderaciones son supuestos didácticos. No se usan inventarios biológicos ni núcleos naturales observados.
- **Resiliencia climática:** 60 % proporción activa en aptitud alta/media, interpolada entre aptitud inicial y futura con el avance climático del escenario; 20 % índice hídrico y 20 % índice de suelo. En 2.1 se resta `6 × avance climático normalizado` como presión adicional didáctica, repartida en los 119 intervalos.

Todos los índices se limitan a 0–100 y se rotulan en pantalla como “índice didáctico estimado”.

### Representación territorial continua (octubre de 2026)

`npm run data:surface` genera `public/data/frontier-surface.json` a partir de los 292 elementos originales, los municipios IGAC y las áreas RUNAP. Es un producto exclusivamente visual: no modifica `cafe-frontier.geojson`, las hectáreas del modelo ni los 120 cortes de indicadores.

La malla utiliza un paso de 0,0018 grados y crecimiento contiguo de coste determinista. Su textura espacial es sintética, no procede de un modelo de elevaciones ni de coberturas observadas. Los núcleos próximos del mismo municipio pueden compartir borde; una expansión con un núcleo previo a más de 2 km de su centro de referencia se representa como isla. La distancia usa la aproximación 111 km/grado; no equivale a una medición predial. Las hectáreas orientan el tamaño de los parches, pero la discretización, el suavizado y las exclusiones hacen que su área dibujada no sea un cálculo métrico exacto.

Las celdas se incorporan progresivamente desde su mes inicial hasta diciembre de 2035; el retiro parcial progresa desde el borde hacia el interior durante varios años. Las fechas de los nodos se obtienen invirtiendo la misma función temporal que calcula las hectáreas y los indicadores. Los contornos se extraen de la malla, compartiendo las fronteras entre celdas, sin filtros de desenfoque o turbulencia. Se conserva un contorno discontinuo de la huella inicial. El relleno ámbar representa expansión; el violeta tramado representa retiro o pérdida de aptitud, sin inferir que todos los retiros son climáticos. El tiempo determina completamente la geometría y la pausa la congela. Una máscara gráfica final excluye RUNAP incluso al suavizar los bordes.

### Corrección de coherencia temporal, modelo 2.0.0

La versión anterior retiraba una celda completa como mínimo por municipio y concentraba sus bajas en un solo mes. En mayo de 2035 aparecían 17.339,6 ha retiradas adicionales y una caída neta de 16.808,7 ha. Era un artefacto del modelo, sin evidencia de un evento ambiental de esa magnitud.

Ahora el retiro municipal equivale exactamente a su fracción objetivo, aplicada parcialmente a las celdas de mayor riesgo. La expansión equivale a `objetivo 2035 − área inicial + retiro objetivo`, sin el mínimo artificial del 45 % de una celda. La distribución mensual utiliza `0,8t + 0,2t²(3−2t)`, con `t` normalizado al intervalo de cada operación. Las incorporaciones comienzan entre los meses 1–24 y los retiros entre 12–24; ambos terminan en 119. Estas ventanas son supuestos de un escenario gradual sin desastres discretos, no un calendario observado.

Se conserva el objetivo municipal tendencial: `crecimiento = limitar(2,2 × tendencia anual EVA + incentivo sur/general − presión climática, −13 %, +16 %)`, con incentivos asumidos de 8,5 %/3,5 % y presión de 10 %/6 %/2,5 % según la altitud representativa. Esta regla sigue siendo ilustrativa. Los datos EVA se descargaron el 31 de agosto de 2026; esta corrección recalcula esa base, no introduce nuevas observaciones. Cenicafé describe que los cambios de área y sistemas productivos también responden a factores sociales, económicos y de manejo; suavizar la serie no constituye una validación predictiva ([estudio de dinámica de fincas](https://publicaciones.cenicafe.org/index.php/cenicafe/article/view/52)).

Resultado recalculado: enero de 2026, 151.697,8 ha; diciembre de 2035, 154.043,9 ha; expansión acumulada 10.312,1 ha; retiro acumulado 7.966,0 ha. De abril a mayo de 2035: +86,0 ha de expansión, +70,3 ha de retiro y +15,7 ha netas. El máximo mensual neto es 42,6 ha; el máximo de expansión 107,4 ha; el máximo de retiro 87,6 ha; el máximo de cambio de un índice es 0,2 puntos.

Las pruebas verifican el balance de todos los meses y municipios, el respeto a los objetivos finales, la monotonía de expansión/retiro/CO₂e, variación neta mensual inferior a 0,1 % del área inicial departamental, variación neta municipal inferior a 0,5 % mensual y 3 % en doce meses, y saltos de índices menores a 0,5 puntos. Son controles de coherencia para este escenario, no umbrales científicos universales.

El desplazamiento transforma píxeles de pantalla a unidades del SVG usando su escala real (`preserveAspectRatio`). Al soltar, esa misma conversión se aplica al centro del mapa para evitar desapariciones o saltos. La prueba de arrastre compara posiciones en pantalla antes, durante y después del gesto, también con zoom y en formato móvil.

## Fuentes y atribución

### Calibración de aula 2.1.0

Por solicitud del usuario se multiplica por 1,92 tanto la expansión como el retiro objetivo de la versión 2.0, conservando su proporción. Se mantienen las 292 ubicaciones, el área inicial y las ventanas progresivas. Para distribuir el mayor retiro sin superar el 100 % de una celda, se selecciona un número suficiente de celdas de riesgo. La nueva expansión es 19.798,5 ha, el retiro 15.294,6 ha y el área final 156.201,7 ha (+3,0 % respecto a 2026). La cifra cercana a 20.000 ha es una calibración pedagógica, no una estimación oficial incorporada desde una fuente nueva.

Se interpretó “reducir el de biodiversidad” como moderar su caída respecto a la versión anterior. Se amplifican las sensibilidades de agua, suelo y resiliencia y se atenúa la de biodiversidad mediante los coeficientes descritos arriba. Estos ajustes no cambian las coberturas sintéticas ni incorporan mediciones ambientales.

| Índice | Enero 2026 | Diciembre 2035 | Caída en puntos |
|---|---:|---:|---:|
| Agua | 79,6 | 64,3 | 15,3 |
| Suelo | 88,9 | 72,3 | 16,6 |
| Resiliencia | 91,4 | 77,6 | 13,8 |
| Biodiversidad | 90,4 | 83,0 | 7,4 |

El máximo neto mensual es 84,0 ha; el máximo de expansión, 206,2 ha; el de retiro, 167,4 ha. Los indicadores mantienen saltos máximos de 0,2 puntos. La mayor rotación territorial hizo que Isnos superara el control anual municipal del 3 % de la versión anterior: para este escenario ampliado el control se fija explícitamente en 5 %, manteniendo el límite mensual municipal de 0,5 % y los límites departamentales previos. Las pruebas conservan todos los meses y todos los municipios, además de verificar la proporción del ajuste y la mayor caída de agua/suelo/resiliencia frente a biodiversidad.

Verificación 2.1: 23 pruebas de datos/modelo y TypeScript correctos; valores abril/mayo y congelación al pausar correctos. La primera medición de fluidez del navegador local registró 20,63 fps (fallo conservado en los resultados de prueba); la repetición aislada del mismo test superó 30 fps. La fluidez depende del equipo y su carga, por lo que esta repetición no garantiza un mínimo universal.

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
