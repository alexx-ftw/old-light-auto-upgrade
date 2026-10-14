# Validación de la gestión imperial 1.14.3

## Alcance

Base de contenido: release 1.14.2, publicada en el commit `bad7632ea45ab5c8959ac04c3edb3aeb8d38f47e`. El modo imperial es opt-in. La corrección 1.14.3 mantiene exactamente sus cinco grants, `@inject-into content`, `@run-at document-start`, el observador nativo y el puente de Drive. Reduce cálculos, lecturas y renderizados duplicados y agrupa ráfagas mientras Imperio está activo. No añade capacidades de juego ni sincronización de la política imperial.

- `empire-core.js`: configuración por sistema, normalización estricta, censo simultáneo y reparto de objetivos globales.
- `empire-runtime.js`: política por cuenta/galaxia, recorrido justo, exclusión durante operaciones y verificación inmediatamente anterior a cada orden.
- `empire-observer.js`: observación pasiva de `world.init`, `world.delta` y desconexión; campos permitidos, límites de memoria y descarte de credenciales y chat.
- `empire-adapter.js`: contraste del censo con el HUD y selección de sistemas propios mediante el botón nativo verificado.
- `empire-bridge.js`: entrega inicial de un puerto privado en un elemento ya separado del DOM; mensajes tipados y revalidados. El código privilegiado y el token de Drive no entran en la página.
- `empire-panel.js`: objetivos, roles, exclusiones y recursos/colas/capacidad, sin botones que emitan pedidos directamente.

## Resultado de la candidata

El árbol final pasa **1095/1095 pruebas automatizadas** (cero fallos, omitidas o pendientes), comprobación sintáctica y `git diff --check`. Los cuatro generadores de módulos se han vuelto a ejecutar. La revisión independiente incluye equivalencia bundle/lectores previos, preflight fresco, revocación, errores de lectura, tránsitos duplicados, descriptores seguros y aislamiento entre cuentas, además de las regresiones de arranque y Drive.

## Pruebas reproducibles

```sh
node build-empire.cjs
node build-metrics.cjs
node build-sync.cjs
node build-drive.cjs
node --check old-light-auto-upgrade.user.js
node --test tests/*.test.cjs
git diff --check
```

Las pruebas Node ejecutan los módulos y controladores sobre DOM, almacenamiento, relojes, eventos y conexiones simulados. Incluyen la revisión independiente de integración, privacidad del puente, inyección temprana y diferida, permisos durante misiones abiertas, propiedad, cambios de cuenta/galaxia, desconexión, datos caducados y parciales, doble contabilización, transferencias internas, colas, selección cancelada, confirmación incierta, pausa manual, borradores y recuperación tras pedidos. Las regresiones anteriores de Drive, métricas, misiones, infraestructura y sincronización se incluyen en la misma ejecución.

El fixture `tests/empire-panel.browser.cjs` prepara una página sintética sin datos reales ni peticiones al juego. Se conserva como comprobación manual reproducible; **no se ha validado su ejecución en esta sesión**.

## Límites de la validación

No se ha iniciado sesión, cambiado sistemas ni enviado una orden en una partida real. La evidencia del protocolo y del selector procede del código público identificado en `empire-native-evidence.md`, y las pruebas del adaptador usan réplicas acotadas de esas estructuras.

No hay comprobación visual final en navegador ni prueba real del puente bajo Brave/Violentmonkey y la CSP del juego. El navegador cloud disponible usa un entorno distinto y no accede al servidor de la página sintética; no ofrece carga directa de HTML mediante su API documentada. Esto limita la afirmación de compatibilidad. Una inserción bloqueada, o la ausencia de un estado inicial completo en una conexión observada, deja el adaptador sin censo y no autoriza pedidos. El estado de carga del documento por sí solo no determina ese resultado. Se utiliza la API documentada GM_addElement con el permiso aprobado para insertar el observador. No se abre un socket adicional, no se modifica CSP ni se usa unsafeWindow. Un fallo terminal elimina el contenedor y cierra el puerto. Los mensajes de diagnóstico conservan solo categorías fijas.

La revisión no certifica resistencia frente a una página de juego comprometida. Se valida una separación mínima entre observación de estado y acceso privilegiado a Drive bajo el supuesto de ejecución del juego legítimo.

## Comprobación pendiente en el navegador del usuario

1. Actualizar, aceptar GM_addElement si el gestor lo solicita, recargar el juego y abrir Imperio manteniéndolo desactivado.
2. Verificar que se listan únicamente sus sistemas y que recursos, colas y selección coinciden con el juego. Confirmar que aparece la versión 1.14.3 y que Drive conserva su comportamiento.
3. Si el estado nativo no aparece, registrar el texto de estado visible, gestor y versión de navegador. No compartir copias del perfil, tokens, tramas ni credenciales.
4. La activación queda a elección del usuario tras comprobar esos datos. Si no hay concordancia, conservar el modo detenido.

## Cobertura del hotfix

El problema reproducido es que el cliente guarda el constructor nativo de WebSocket antes de instalar el lector: el proxy de constructor solo no ve esa conexión. El hook del setter nativo onmessage permite descubrirla mientras siga CONNECTING, preservando el callback original y sin tocar send ni abrir conexiones. Se prueban reemplazos, reconexiones, eventos no confiables, duplicados y restauración de descriptores. Esto no demuestra cuál fue la causa única del reporte real, que carecía de diagnóstico.

GM_addElement entrega el elemento después de insertarlo y ejecutar el script. Por eso la escucha se registra en un contenedor antes de llamar al gestor. El script retira el contenedor y confirma un MessagePort privado después de instalar correctamente el observador; el primer DTO espera hasta que el receptor está preparado. Un timeout de dos segundos retira el contenedor, evita una instalación diferida y revoca los datos. Desde 1.14.2 el estado interactive/complete permite instalar la observación pasiva, conservando el requisito independiente de un init completo. Si la ejecución diferida supera el timeout, el contenedor ya retirado impide reactivar el intento caducado.

Fuente primaria de la API: [Violentmonkey GM_addElement](https://violentmonkey.github.io/api/gm/#gm_addelement), disponible desde VM 2.13.1. Sus garantías documentadas no sustituyen la prueba real pendiente bajo el navegador y la versión del gestor del usuario.

## Defecto de arranque reproducido y corrección 1.14.2

El mensaje reportado en 1.14.1 se emitía por la condición del bootstrap `readyState !== loading`, antes de llamar a GM_addElement. Existían otros dos bloqueos equivalentes en el bridge y el script de página. La captura prueba que se tomó esa rama, pero no demuestra cuál era el estado del socket ni un fallo de CSP o del permiso concedido.

El estándar pone el documento en interactive antes de ejecutar la lista de scripts diferidos/módulos. Violentmonkey tampoco garantiza que document-start en content anteceda a todos los scripts. Por ello se retiran las tres exclusiones basadas solo en el parseo. Los estados desconocidos, el timeout terminal y los demás controles del puente se mantienen. La autorización real sigue dependiendo de los datos nativos completos y las guardas del adaptador/runtime, que no cambian.

Fuentes primarias: [HTML, final del parseo](https://html.spec.whatwg.org/multipage/parsing.html#the-end), [Document.readyState](https://developer.mozilla.org/en-US/docs/Web/API/Document/readyState) y [Violentmonkey run-at](https://violentmonkey.github.io/api/metadata-block/#run-at).

Las pruebas cubren interactive antes de módulos, complete antes de una conexión, raíz y ejecución del grant diferidas, socket previo ya OPEN con init perdido, deltas sin init, init posterior válido en una conexión observada, desconexión y recepción futura. No fuerzan recargas, reconexiones ni órdenes. No prueban que un socket previo invisible pueda recuperarse.

## Rendimiento imperial: corrección 1.14.3

Perfilado local con DTO y DOM sintéticos, sin navegador ni peticiones al juego. Los escenarios usan 2, 10 y 50 sistemas y cuatro tránsitos propios por sistema; el reloj fijo aísla el coste de repetir una revisión. `node benchmarks/empire-runtime.cjs [ruta-al-repo]` , `node benchmarks/empire-panel.cjs [ruta-al-repo]` y `node benchmarks/empire-priority.cjs [ruta-al-repo]` reproducen las mediciones sin conectarse a ningún servicio. No describen la latencia de Brave/Violentmonkey ni la frecuencia real de eventos en la partida.

Medianas del mismo entorno Node antes/después:

| Sección medida | 2 sistemas | 10 sistemas | 50 sistemas |
| --- | --- | --- | --- |
| Dos update + readActive + canAct | 1,414 → 0,584 ms | 5,965 → 2,047 ms | 27,683 → 9,095 ms |
| Render del panel (DOM mínimo) | 0,82 → 0,11 ms | 3,81 → 0,15 ms | 19,32 → 0,47 ms |

La previsión de flota sin misión pendiente ejecutaba dos comprobaciones imperiales y diez reconstrucciones de censo por consulta. Ahora esa rama no consulta permisos de una misión inexistente. Si hay misión pendiente, sigue comprobándolos en cada consulta, con dos reconstrucciones en lugar de diez. `empire-priority.cjs` ejecuta las funciones reales de prioridad, política y permisos sobre un HUD sintético; no mide el coste del DOM ni un step completo. No deben sumarse sus tiempos parciales para afirmar un porcentaje global del Helper.

El test determinista del scheduler agrupa 100 tareas separadas por 1 ms en tres ejecuciones, frente a 100 antes. Un flujo de 100 tareas cada 10 ms produce 21 ejecuciones sin inanición. La demora añadida a un plazo en el escenario probado es 49 ms. Se prueba también la lectura de una nueva identidad y de la pausa mientras la ejecución estaba pendiente.

El ciclo parcial reconstruía el censo 13 veces; ahora lo hace cuatro. No incluye todas las ramas de `step`, el DOM real ni la observación nativa. Una ráfaga secuencial de veinte revisiones distintas con 50 sistemas pasó de aproximadamente 576 a 172 ms antes de cualquier coalescencia del scheduler. El panel de 50 sistemas escribía 555 textos iguales por render; ahora no escribe ninguno si nada cambia. La vista oculta/minimizada no solicita estado, y al abrirla vuelve a leer todos los datos y su caducidad.

Las lecturas se agrupan **solo dentro de una llamada síncrona**. `update`, cada `canAct` y el preflight de navegación solicitan un bundle nuevo. No existe caché por revisión ni por tiempo. Siguen comprobándose la propiedad, cuenta/galaxia, selección y HUD actuales, antigüedad, retrocesos de generación/revisión, contradicciones con la misma revisión, tránsitos y la barrera posterior a pedidos. Si falla el bundle, no se combinan lecturas legacy para recuperarlo.

El scheduler activo agrupa tareas con separación de 50 ms y cede el hilo mediante un timer; no depende de animation frames. No conserva permisos ni datos de identidad de la llamada a schedule. El modo habitual mantiene sus microtareas inmediatas. Las comprobaciones de respuesta pueden retrasarse hasta 50 ms adicionales, además de cualquier demora propia del navegador; no se adelantan plazos ni se eliminan guardas. Elimina dos validaciones de misión redundantes en cada previsión de flota cuando no hay misión pendiente.

Cobertura adicional: bundles mutables/contradictorios, desconexión y cambio de scope/HUD entre actualización y permiso, expiración sin revisión nueva, configuración desactivada, snapshots duplicados/faltantes, devolución de políticas desacopladas, panel oculto/reapertura/caducidad y valores editados con foco. Se conserva el aislamiento de Drive, el puente, el lector nativo y los cinco grants. La sincronización imperial y las nuevas métricas de diagnóstico quedan fuera del hotfix.

Pendiente: confirmar con el usuario el rendimiento después de actualizar y recargar. Las mejoras del banco sintético no garantizan por sí solas la experiencia real ni demuestran que el censo observado por el usuario sea correcto.
