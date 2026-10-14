# Validación de la gestión imperial 1.14.1

## Alcance

Base de contenido: release 1.14.0, publicada en el commit `15756dc3f3da52ef039aa24de3471ea4324e737f`. El modo imperial es opt-in. La corrección 1.14.1 conserva los cuatro grants anteriores y añade únicamente `GM_addElement`, con autorización específica del usuario. Mantiene `@inject-into content` y `@run-at document-start` para colocar el observador antes de la conexión nativa. La inicialización previa del Helper continúa esperando a `DOMContentLoaded`.

- `empire-core.js`: configuración por sistema, normalización estricta, censo simultáneo y reparto de objetivos globales.
- `empire-runtime.js`: política por cuenta/galaxia, recorrido justo, exclusión durante operaciones y verificación inmediatamente anterior a cada orden.
- `empire-observer.js`: observación pasiva de `world.init`, `world.delta` y desconexión; campos permitidos, límites de memoria y descarte de credenciales y chat.
- `empire-adapter.js`: contraste del censo con el HUD y selección de sistemas propios mediante el botón nativo verificado.
- `empire-bridge.js`: entrega inicial de un puerto privado en un elemento ya separado del DOM; mensajes tipados y revalidados. El código privilegiado y el token de Drive no entran en la página.
- `empire-panel.js`: objetivos, roles, exclusiones y recursos/colas/capacidad, sin botones que emitan pedidos directamente.

## Resultado de la candidata

El árbol final pasa **1049/1049 pruebas automatizadas** (cero fallos, omitidas o pendientes), comprobación sintáctica y `git diff --check`. Los cuatro generadores de módulos se han vuelto a ejecutar. La revisión independiente incluye regresiones de arranque, aislamiento, Drive y las guardas del adaptador.

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

No hay comprobación visual final en navegador ni prueba real del puente bajo Brave/Violentmonkey y la CSP del juego. El navegador cloud disponible usa un entorno distinto y no accede al servidor de la página sintética; no ofrece carga directa de HTML mediante su API documentada. Esto limita la afirmación de compatibilidad. Una inyección tardía o bloqueada deja el adaptador sin datos y el modo imperial no autoriza pedidos. Se utiliza la API documentada GM_addElement con el permiso aprobado para insertar el observador. No se abre un socket adicional, no se modifica CSP ni se usa unsafeWindow. Un fallo terminal elimina el contenedor y cierra el puerto. Los mensajes de diagnóstico conservan solo categorías fijas.

La revisión no certifica resistencia frente a una página de juego comprometida. Se valida una separación mínima entre observación de estado y acceso privilegiado a Drive bajo el supuesto de ejecución del juego legítimo.

## Comprobación pendiente en el navegador del usuario

1. Actualizar, aceptar GM_addElement si el gestor lo solicita, recargar el juego y abrir Imperio manteniéndolo desactivado.
2. Verificar que se listan únicamente sus sistemas y que recursos, colas y selección coinciden con el juego. Confirmar que aparece la versión 1.14.1 y que Drive conserva su comportamiento.
3. Si el estado nativo no aparece, registrar el texto de estado visible, gestor y versión de navegador. No compartir copias del perfil, tokens, tramas ni credenciales.
4. La activación queda a elección del usuario tras comprobar esos datos. Si no hay concordancia, conservar el modo detenido.

## Cobertura del hotfix

El problema reproducido es que el cliente guarda el constructor nativo de WebSocket antes de instalar el lector: el proxy de constructor solo no ve esa conexión. El hook del setter nativo onmessage permite descubrirla mientras siga CONNECTING, preservando el callback original y sin tocar send ni abrir conexiones. Se prueban reemplazos, reconexiones, eventos no confiables, duplicados y restauración de descriptores. Esto no demuestra cuál fue la causa única del reporte real, que carecía de diagnóstico.

GM_addElement entrega el elemento después de insertarlo y ejecutar el script. Por eso la escucha se registra en un contenedor antes de llamar al gestor. El script retira el contenedor y confirma un MessagePort privado después de instalar correctamente el observador; el primer DTO espera hasta que el receptor está preparado. Un timeout de dos segundos retira el contenedor, evita una instalación diferida y revoca los datos. El arranque fuera de loading no engancha una conexión cuyo init pudo perderse.

Fuente primaria de la API: [Violentmonkey GM_addElement](https://violentmonkey.github.io/api/gm/#gm_addelement), disponible desde VM 2.13.1. Sus garantías documentadas no sustituyen la prueba real pendiente bajo el navegador y la versión del gestor del usuario.
