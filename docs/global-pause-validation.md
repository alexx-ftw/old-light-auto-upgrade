# Pausa global y recorrido imperial: 1.16.5

## Base, defecto y alcance

Base publicada 1.16.4: commit GitHub `05395515d5416ad096ecab59dcf57eb815ea5aad`, árbol `b1f8c7e0eac6e0ef829e79cc6a46bdf73492b677`. El checkout local equivalente es `c5f4e690eff170bc03a73947770aa8de0b9fbfc6`. Main se volvió a consultar antes de asignar 1.16.5; seguía en esa base. La publicación debe volver a contrastar main y usar el árbol final validado.

El botón global cambia `settings.enabled` y llama al scheduler, que puede esperar hasta 50 ms para actualizar Imperio. Durante ese intervalo, un poll del selector nativo puede observar la pausa y devolver false antes de que el coordinador sepa que fue una cancelación intencionada. El resultado era un `manualHold` que Reanudar no levantaba. Si se pausaba y reanudaba antes del siguiente poll, la selección anterior podía ejecutar su siguiente clic.

La corrección añade una revocación síncrona, idempotente y sin callbacks al comienzo del scheduler, antes de descartar una solicitud ya agrupada. Se aplica al Helper pausado y a la pestaña oculta. Invalida el token del recorrido, conserva el bloqueo de movimiento hasta su resolución y no modifica configuración, pedidos, errores genuinos ni plazos de suspensión. No introduce un segundo timer, un nuevo censo ni una caché de autoridad. El ciclo posterior conserva todas las validaciones existentes.

La cancelación no deshace un clic next ya enviado. Reanudar permite una nueva decisión solo tras datos actuales. Un fallo nativo real que ya produjo `manualHold` sigue requiriendo revisión; Pausar/Reanudar no lo borra. La interacción humana ordinaria mantiene su pausa temporal, sin convertirla en un fallo persistente.

## Reproducción causal antes/después

El mismo archivo final `tests/empire-interaction.test.cjs` se ejecutó contra los módulos y userscript de la base, mediante su selector existente de fuente:

```sh
OLD_LIGHT_INTERACTION_ROOT=/ruta/a/base-1.16.4 node --test tests/empire-interaction.test.cjs
```

Resultado en la base: 92 tests, 83 aprobados, 9 fallidos, cero omitidos/cancelados/TODO, exit 1. Es posible reproducirlo exportando el commit local indicado con `git archive` y apuntando la variable al directorio resultante. El archivo de tests se mantiene en el checkout nuevo; no se cambia ninguna assertion para el experimento.

Fallos centrales:

- `global Pause during a native hop cancels before a scheduled update and Resume recovers`: obtiene `manualHold === true`, esperado false. Se inicia A→intermedio, se pulsa el callback real de Pausar a los 49 ms del ciclo y se deja resolver el poll registrado antes del scheduler.
- `global Pause then Resume in one coalesced interval never resurrects the old native traversal`: obtiene 2 clics, esperado 1. Cinco pares de Pausar/Reanudar no pueden revivir la selección antigua.
- `global Pause before the selector microtask retains zero native clicks across immediate Resume`: obtiene 1 clic, esperado 0. La revocación cubre también una selección aún no enviada.
- Pestaña oculta/visible en el mismo intervalo y pausa con scheduler ya pendiente reproducen la misma falta de revocación. Las cuatro fronteras de cuenta/conexión/HUD/multiselección fallan primero porque el estado ya quedó retenido; no se atribuye a la base un bypass de esos guards.

Con la corrección, los 92 casos de interacción pasan. La combinación con scheduler y changelog da 125/125, cero omitidos/cancelados/TODO. Los contadores son evidencia sintética de comportamiento, no medidas de rendimiento de Brave ni pedidos enviados al juego. El gate completo final establece por separado el total de la suite y los bytes exactos aprobados.

## Matriz de fronteras

| Escenario | Resultado esperado y prueba |
| --- | --- |
| Pausar entre dos saltos y reanudar después | Solo el primer clic antiguo; sin manualHold; vuelve a actuar con datos actuales. `global Pause during a native hop...` |
| Pausar/Reanudar repetido dentro de un ciclo | No se revive el segundo salto; conserva una única operación. `global Pause then Resume in one coalesced interval...` |
| Pausa antes de la microtarea | Cero clics de la selección revocada. `global Pause before the selector microtask...` |
| Edición de exclusión, rol u objetivo mientras está pausado | Conserva exactamente la nueva política y no salta mientras sigue pausado. Tres casos `global Pause retains a mid-hop...` |
| Fallo de selector o HUD previo a la pausa | Mantiene manualHold y error, sin nuevos clics. `global Pause and Resume preserve a genuine unconfirmed selection hold` y `genuine native failure detected before Pause...` |
| Suspensión independiente e interacción | No se acortan los plazos de seguridad. `global Pause and Resume preserve independent suspensions and interaction deadlines` |
| Cuenta distinta, desconexión, HUD contradictorio o multiselección al reanudar | Cero nuevos clics y canAct false. Cuatro casos `global Resume does not bypass...` |
| Ocultar/mostrar rápido | Cancela el recorrido viejo igual que el botón. `hidden then visible during one coalesced interval...` |
| Scheduler ya pendiente y 20 llamadas adicionales | Sin timers duplicados ni recursión; abort nativo reconocido. `global Pause with a queued scheduler...` |
| Pedido existente y confirmación | Mismo registro/token, sin otro salto; censo anterior no basta, censo nuevo sí. `global Pause and Resume neither replace pending orders...` |

La fixture ejecuta el callback real del botón, la instalación del adaptador/coordinador, los lectores nativos, las factories reales de planificación, el scheduler y su respaldo. DOM, relojes, almacenamiento y next son sintéticos. El callback de guardado de ajustes y las notificaciones del botón son stubs; esta prueba no verifica persistencia en un navegador real. El scheduler aislado recibió `settings` y `document` sintéticos para modelar sus nuevas dependencias; sus assertions de rendimiento y plazos no se rebajaron.

## Gate, revisión y límites

`node validate-release.cjs --report <ruta fuera del checkout>` debe ejecutarse sobre el commit final limpio. Verifica toda la suite, sintaxis, coherencia de versión, ledger de regresiones y dos pasadas idempotentes de los cuatro builders. Una revisión independiente nueva debe inspeccionar el diff y el orden causal, comprobar los casos positivos y negativos, y validar el mismo árbol final. Una modificación posterior invalida esos resultados.

No se ha comprobado una sesión real de Brave/Violentmonkey ni Google Drive. No se han emitido órdenes a una partida, cambiado permisos, añadido telemetría, abierto conexiones nuevas ni manejado credenciales. El cambio no mejora ni valida el servicio Drive; conserva su código y sus pruebas previas. La distribución por GitHub, CDN y autoupdate se confirma aparte por el coordinador de publicación.
