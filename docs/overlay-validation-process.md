# Revisión y validación temporal del overlay

Este procedimiento es obligatorio para cambios e informes de parpadeo de las flechas. Complementa [publicación](release-validation.md) y [revisión independiente](independent-code-review.md). Busca refutar hipótesis concretas; no promete cobertura exhaustiva ni permite acciones en una partida real.

## Brechas observadas y alcance de las afirmaciones

- 1.17.13 corrigió un hueco simulado de entrega del censo de hasta100ms. Eso no cubría scroll del Helper y no demostraba el resultado en la sesión real. El informe persistente se ha confirmado en **1.17.14**; esa versión ya incluía aquel ajuste.
- 1.17.15 corrige otro mecanismo reproducido: scroll del Helper borra el SVG entre repintados limitados a80ms. Antes:16/20frames ocultos; después:0/20 en la misma simulación. La versión1.17.15 está publicada, pero el usuario aún no ha validado su resultado. No cerrar el incidente real por esa reproducción.
- Las pruebas iniciales de snapshots no registraban todo el intervalo entre evento y siguiente frame. Un estado correcto después de render no demuestra continuidad.
- Un probe independiente inicial inyectó un Map para rAF que el harness sobrescribía. Sus dos observaciones por vuelta no acreditaban callbacks ejecutados. El probe final de1.17.15 se corrigió y contó120callbacks; este cambio hace persistente esa exigencia en las pruebas del repositorio.
- Los controles de versión, hashes, suite verde y enlaces del manifiesto prueban aspectos distintos; ninguno acredita por sí solo la causa del usuario o una pintura real.

## Secuencia requerida antes de editar comportamiento

1. Registrar versión instalada con su fuente, última versión publicada y contexto conocido. No deducir instalación de main, telemetría o fecha de publicación. Si falta contexto, conservarlo como pendiente; no solicitar nombres, coordenadas o credenciales para estudiar un parpadeo.
2. Congelar commit base, árbol, estado remoto y cambios concurrentes. Reproducir primero con bytes anteriores. Derivar una hipótesis que pueda fallar: por ejemplo, un evento UI ajeno al mapa invalida dibujo válido. Registrar también la hipótesis alternativa y el control que la distinguiría.
3. Usar el mismo harness y los mismos tests para base y candidata. Preferir QA_REINFORCEMENT_PANEL_SOURCE para el módulo; si cambia también integración, usar copias aisladas del árbol y copiar solo el harness final. Registrar qué frontera se sustituye y hashes. Si no se reproduce, no inventar un beforeFail: entregar diagnóstico mínimo y dato pendiente.
4. Recorrer el tiempo: evento → estado antes de rAF → callback real → estado después. Contar solicitudes, callbacks realmente ejecutados, visibilidad, identidad de línea/botón y vaciados. El número de vueltas o de llamadas a frame no sustituye al contador de ejecución.
5. Validar sensibilidad del harness: desactivar la ejecución de callbacks debe hacer fallar sus afirmaciones temporales. No cambiar producción para pasar el experimento. Conservar mutación, comando, salida y resultado esperado/observado fuera del árbol de publicación.

## Matriz mínima ajustada al defecto

| Camino | Evidencia requerida |
| --- | --- |
| Reposo, censos/revisiones repetidos y timers | Serie temporal estable, callbacks contados, sin vaciados ocultos entre muestras. |
| Scroll/wheel del Helper, contenedor minimizado y Shadow DOM | Seguir callback productivo, composedPath y host real; no sustituir esa frontera por un mock que siempre responde true. |
| Puntero flotante, tooltip y editor | Entrada/salida repetida, borrador intacto y controles estables; documentar lo no ejercitado. |
| Cámara/zoom nuevo válido | Reproyectar y no retener geometría antigua. |
| Cámara inválida, censo ausente/caducado, sesión/scope/canvas nuevo | Ocultar y mantener lectores autoritativos sin datos; ningún fallback de autoridad. |
| Hueco pendiente breve y prolongado | Conservar solo la decoración acotada ya permitida; no extender100ms ni activar el marcador con caché. |
| Gesto activo, rueda del mapa y evento desconocido | Conservar cancelación/invalidation y cero órdenes de juego. |

Justificar si una fila no aplica. Añadir escenarios por el diff y por el informe; esta tabla no agota todos los eventos ni el compositor del navegador.

## Revisión independiente fresca

El revisor recibe el commit inmutable final, base, diff, informe del usuario, estado de versión/contexto, reproducción anterior, matriz y límites. Debe derivar al menos un probe adversarial propio de la frontera decisiva y un camino permitido. Debe cuestionar la fixture: ¿es el mismo Map de timers que consume producción?, ¿se ejecutaron callbacks?, ¿la frontera de host/cámara/bridge procede del código real? Repetir únicamente la suite del autor no cierra la revisión.

Un probe que no ejecutó lo afirmado se retira o corrige expresamente; no se suman sus vueltas como pruebas válidas. Tras cambiar bytes, revisar el diff nuevo y repetir la reproducción afectada. Registrar dictamen, commit/árbol exactos, comandos, hashes y gaps. Los requisitos son revisión humana/agente independiente, no una capacidad automática del gate.

## Cierre de publicación y del incidente

Actualizar review-feedback.json con reproducción verdadera, referencias exactas y criterios refutables; registrar la lección en independent-code-review.md. Ejecutar la suite completa mediante validate-release.cjs sobre commit limpio final, incluidos builders e integridad. Comprobar concurrencia otra vez, publicar sin force y verificar padre/árbol/commit remoto, CI terminal exacto y bytes de autoupdate/archivos servidos.

Informar por separado: mecanismo reproducido y corregido offline; inspección/pintura real de navegador realizada o no; resultado del usuario confirmado o pendiente. La validación en sesión real no se obtiene enviando órdenes ni accediendo a credenciales. No declarar «parpadeo resuelto» mientras solo exista evidencia condicional offline.

## Control de sensibilidad reproducido en este cambio

Base del proceso:599f18422c72af974d2a44d1dc2d8d587658dbcd. En copias aisladas se conserva el módulo productivo y se modifica solo la fixture: `window.requestAnimationFrame = callback => ++frameId`, sin insertar callback en su cola. Se ejecuta:

```sh
node --test --test-name-pattern='helper scroll and wheel preserve continuous|temporal census gaps tooltip' /ruta/copia/tests/reinforcement-panel.test.cjs
```

Con los tests anteriores de599f184:2/2pasan, aunque se ejecutan cero callbacks. Con el harness final y los contadores exigidos:0/2pasan,2fallan por0!==120 y0!==240. Sin esa alteración,150/150pruebas del panel pasan. El contador se incrementa dentro del dispatcher antes de invocar cada callback; no al solicitar un frame. Este control comprueba sensibilidad a un falso positivo específico, no todas las alteraciones posibles del harness.
