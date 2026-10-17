# Arranque frío de la herramienta Chromium

## Evidencia observada

La CI38982114166 de main75b504b completó113archivos/2389pruebas:2388pass y1fail por primer arranque, timeout15167ms yprimerstderr12098ms. La privacidad no cambia el runtime y sus16casos de integración pasan.

El diagnóstico38984164825 (7f36b5e) conserva preparación completa:snapshot,sintaxis,orden/reporter,builders,integridad,fuentes/tests de75b504b. Observa45s pero mantieneFAILirreversible a15s. Primer endpoint31704ms,primerstderr21398ms; a31704ms el grupo vivo tiene1878fallos mayores,214810624bytes de lecturas,50ticksCPU(CLK_TCK100) ylíderD. Después pasan2389/2389,113archivos,builders e integridad; la observación falla correctamente. Siguientes arranques152–179ms. Duración de suite357920.885ms. Fuente: [ejecución completa](https://github.com/alexx-ftw/old-light-auto-upgrade/actions/runs/38984164825).

La matriz38982927572 usa el mismo hash de imagen fe5a683855bb91f3bf5a5496ca2fe7e4c4511673e66605efcbf64c74db88a944: natural14784ms/1886fallos mayores/~215MBlecturas; control de lectura secuencial previa321ms/98fallos/~49MBlecturas. Hosts distintos limitan causalidad yel brazo natural tuvo1fallo de suite no identificado en su resumen. No se usa el control como gate, no se recupera el artifact403 por otra ruta yno se afirma reparación del almacenamiento. Datos compatibles con coste de carga bajo demanda, no con una avería demostrada del Helper.

## Corrección acotada y reproducción

El presupuesto del helper nativo pasa de15s a40s:31.704×1.25=39.630s, redondeado a40s. Es margen provisional de infraestructura basado en una observación legítima, no percentil garantizado. No se copia45s diagnóstico. El endpoint debe llegar completo; el silencio continúa fallando. No hay precarga,warmup,reintento,fallback,cambio de navegador/flags/perfiles ni acceso al juego. El cambio afecta solo al harness offline; el userscript/meta permanecen1.17.28 byteexactos.

El nuevo caso ejecuta el helper real con reloj/eventos controlados: conserva pendiente después de15001ms, recibe el endpoint a31704ms una sola vez, cancela timeout ypreserva tiempos; en otra instancia el silencio sigue pendiente39999ms yfalla a40000ms con cierre ysin timers/listeners. Esto no simula costeI/O; la llegada legítima tardía procede deCIreal.

Antes: extraer helper de75b504b a archivo externo (SHA256 656f7e5f2d595a81f4e7f4e221cf95a9f0a27627b47edd5b39e697c0e4954b7f) y ejecutar `QA_BROWSER_PROCESS_SOURCE=/workspace/oldlight-transfer/browser-process-before-cold-budget.cjs node --test --test-name-pattern='native cold startup accepts' tests/browser-process.test.cjs`. Falla: failed frente apending tras15001ms. Después, mismo caso sin override pasa. El gate soportado nunca usa esos overrides.

La prueba de silencio real espera40s, exige rechazo entre39y50s ycierre del grupo propio; su timeout externo pasa25→55s para poder comprobar ese contrato. No se omite ni se sustituye por reloj falso. Casos de salida temprana,descendientes,señales,stderrredactado,UTF8 yendpointfragmentado siguen incluidos. Se conserva420s global,120s pordefecto de Node,overrides existentes(Conquista60s,nativas180s),builder30s y15s del harness overlay separado. El negativo real añade25s a la carga; se proyectan~382.9s sobre el ensayo357.9s, que debe verificarse con el gate soportado final.

## Publicación y límites

El workflow manual ejecuta el gate soportado exacto en la rama candidata antes de main: [procedimiento](manual-release-gate.md). Solo publicar con commitlimpio,gatefinal,revisión independiente,CI de rama yconcurrencia comprobados; después verificar CIautomático ybytes servidos. Un pase diagnóstico no sustituye esas comprobaciones.40s puede seguir fallando en otrohost yno modifica autoridad,datos,acciones otelemetría del Helper. No se ha probado partida real.

## Cierre de cobertura del workflow

edd22ee aprobó gate local2390/2390 (412599.379ms de suite sobre420000) y [gate manual38985192898](https://github.com/alexx-ftw/old-light-auto-upgrade/actions/runs/38985192898). Su primera preparación de workflow sustituía los jobs de orden por el gate completo. Antes de main se corrigió esa reducción de cobertura: los dos órdenes originales quedan íntegros, el hash pasa al final y se añade el job completo. El nuevo árbol exige revisión/gate/CI propios; no hereda la aprobación de edd22ee. El presupuesto420s permanece intacto ysu margen local reducido se conserva como límite observado.
