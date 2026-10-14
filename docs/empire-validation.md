# Validación de la gestión imperial 1.14.2

## Alcance

Base de contenido: release 1.14.1, publicada en el commit `5398c115bdbabdff008c070c19b31bf053daf826`. El modo imperial es opt-in. La corrección 1.14.2 mantiene exactamente sus cinco grants, `@inject-into content` y `@run-at document-start`. Retira únicamente la suposición de que un documento ya parseado implica una conexión nativa perdida: el observador intenta instalarse en loading, interactive y complete, sin abrir conexiones. La inicialización previa del Helper conserva su espera a DOMContentLoaded cuando el documento aún está cargando.

- `empire-core.js`: configuración por sistema, normalización estricta, censo simultáneo y reparto de objetivos globales.
- `empire-runtime.js`: política por cuenta/galaxia, recorrido justo, exclusión durante operaciones y verificación inmediatamente anterior a cada orden.
- `empire-observer.js`: observación pasiva de `world.init`, `world.delta` y desconexión; campos permitidos, límites de memoria y descarte de credenciales y chat.
- `empire-adapter.js`: contraste del censo con el HUD y selección de sistemas propios mediante el botón nativo verificado.
- `empire-bridge.js`: entrega inicial de un puerto privado en un elemento ya separado del DOM; mensajes tipados y revalidados. El código privilegiado y el token de Drive no entran en la página.
- `empire-panel.js`: objetivos, roles, exclusiones y recursos/colas/capacidad, sin botones que emitan pedidos directamente.

## Resultado de la candidata

El árbol final pasa **1060/1060 pruebas automatizadas** (cero fallos, omitidas o pendientes), comprobación sintáctica y `git diff --check`. Los cuatro generadores de módulos se han vuelto a ejecutar. La revisión independiente incluye regresiones de arranque, aislamiento, Drive y las guardas del adaptador.

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
2. Verificar que se listan únicamente sus sistemas y que recursos, colas y selección coinciden con el juego. Confirmar que aparece la versión 1.14.2 y que Drive conserva su comportamiento.
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
