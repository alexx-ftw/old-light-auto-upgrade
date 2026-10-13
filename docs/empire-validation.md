# Validación de la gestión imperial 1.14.0

## Alcance

Base de contenido: release Drive 1.13.1, publicada en el commit `069488baf9006ab174c10f2560973d2b0e34a7bb`. El modo imperial es opt-in. La actualización mantiene los cuatro grants existentes y `@inject-into content`; cambia `@run-at` a `document-start` exclusivamente para colocar el observador antes de la conexión nativa. La inicialización previa del Helper continúa esperando a `DOMContentLoaded`.

- `empire-core.js`: configuración por sistema, normalización estricta, censo simultáneo y reparto de objetivos globales.
- `empire-runtime.js`: política por cuenta/galaxia, recorrido justo, exclusión durante operaciones y verificación inmediatamente anterior a cada orden.
- `empire-observer.js`: observación pasiva de `world.init`, `world.delta` y desconexión; campos permitidos, límites de memoria y descarte de credenciales y chat.
- `empire-adapter.js`: contraste del censo con el HUD y selección de sistemas propios mediante el botón nativo verificado.
- `empire-bridge.js`: entrega inicial de un puerto privado en un elemento ya separado del DOM; mensajes tipados y revalidados. El código privilegiado y el token de Drive no entran en la página.
- `empire-panel.js`: objetivos, roles, exclusiones y recursos/colas/capacidad, sin botones que emitan pedidos directamente.

## Resultado de la candidata

El árbol final pasa **990/990 pruebas automatizadas** (cero fallos, omitidas o pendientes), comprobación sintáctica y `git diff --check`. Los cuatro generadores de módulos se han vuelto a ejecutar. La revisión independiente incluye regresiones de arranque, aislamiento, Drive y las guardas del adaptador.

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

No hay comprobación visual final en navegador ni prueba real del puente bajo Brave/Violentmonkey y la CSP del juego. El navegador cloud disponible usa un entorno distinto y no accede al servidor de la página sintética; no ofrece carga directa de HTML mediante su API documentada. Esto limita la afirmación de compatibilidad. Una inyección tardía o bloqueada deja el adaptador sin datos y el modo imperial no autoriza pedidos. No se intenta una API alternativa, un socket adicional ni permisos nuevos para sortear ese estado.

La revisión no certifica resistencia frente a una página de juego comprometida. Se valida una separación mínima entre observación de estado y acceso privilegiado a Drive bajo el supuesto de ejecución del juego legítimo.

## Comprobación pendiente en el navegador del usuario

1. Actualizar, recargar el juego y abrir Imperio manteniéndolo desactivado.
2. Verificar que se listan únicamente sus sistemas y que recursos, colas y selección coinciden con el juego. Confirmar que aparece la versión 1.14.0 y que Drive conserva su comportamiento.
3. Si el estado nativo no aparece, registrar el texto de estado visible, gestor y versión de navegador. No compartir copias del perfil, tokens, tramas ni credenciales.
4. La activación queda a elección del usuario tras comprobar esos datos. Si no hay concordancia, conservar el modo detenido.
