# Flota: mínimos locales y objetivos imperiales

## Incidencia y diagnóstico limitado por la evidencia

El 14 de octubre de 2026 se comunicó «No está construyendo naves» con dos capturas de Helper 1.16.0. En una se veían mínimos locales 30 Probe, 5 Vanguard, 300 Sentinel y 300 Marauder, y la casilla local de contar misiones desmarcada. En otra, Imperio estaba activo con objetivos globales equivalentes y un censo verificado de dos sistemas.

Las cifras visibles son compatibles con los objetivos globales ya cubiertos: 60 Probe, 403 Marauder, 310 Sentinel y posiblemente 6 Vanguard, sumando los sistemas mostrados. No se afirma que las dos capturas pertenezcan al mismo censo: no contienen la respuesta nativa completa, los títulos de todo el HUD, todos los roles ni el estado temporal de cada pedido. La prueba utiliza esas cantidades como un escenario hipotético coherente.

La lógica publicada es inequívoca: con Imperio activo, `empireOperationalSettings` sustituye los mínimos locales por la asignación imperial y fuerza contar las naves en misión. El total global verificado suma base, construcción y el censo de tránsito una sola vez; las misiones del HUD no se vuelven a sumar. `plan` solo asigna el déficit global. Cubrir los objetivos implica cero reposición imperial adicional, aunque una base tenga menos naves que los mínimos locales guardados.

El defecto demostrado es informativo: la pestaña Flota mostraba esos mínimos y la casilla local sin advertir de su sustitución; Imperio mostraba «activo» sin el progreso global por clase ni la razón de no producir. El texto «Depot necesario primero» es una descripción estática de prioridad, no evidencia de un bloqueo por Depot en la captura.

## Cambios

- Flota identifica los mínimos y la casilla de misiones como locales. Un aviso visible con Imperio activo explica que se aplican los objetivos globales.
- Cada objetivo imperial muestra total, objetivo guardado y faltantes, únicamente con un censo actual, íntegro y sincronizado. Los cambios aún no guardados no se presentan como aplicados.
- Un resumen independiente del estado operativo distingue objetivos cubiertos, ningún objetivo, falta de censo, falta de sistemas productores, modo desactivado y déficit pendiente. Las pausas y los errores del coordinador siguen visibles.
- Los datos parciales, antiguos, incompletos o de distintos censos no muestran totales o faltantes como verificados. No se reactivan asignaciones locales como alternativa.
- No cambia ninguna regla de producción, reparto, roles, recursos, Depot/Reactor, colas, pausa, consentimiento, almacenamiento o sincronización.

## Reproducción sobre 1.16.1

La base integrada es el commit local `41d6621415ae6472c2faddbc566dc1cafad0b341`, árbol `bad54c8380d43435d985ac3afebc7925662bc1d8`, idéntico al `main` remoto verificado `af91d5009f39879ed5db88491ba4b4ecd1230397`. No se reutiliza la validación del parche anterior de 1.16.0.

Se extrajo la base con `git archive` en un directorio temporal fuera del checkout. Solo se copiaron encima los tres archivos de tests finales, conservándolos byte a byte:

```sh
baseline=$(mktemp -d)
git archive 41d6621415ae6472c2faddbc566dc1cafad0b341 | tar -x -C "$baseline"
cp tests/empire-fleet-feedback.test.cjs tests/empire-panel.test.cjs tests/empire-order-pipeline.test.cjs "$baseline/tests/"
(cd "$baseline" && env -u NODE_PATH node --test tests/empire-fleet-feedback.test.cjs tests/empire-panel.test.cjs tests/empire-order-pipeline.test.cjs)
```

Resultado anterior: **55 casos, 17 aprobados, 38 fallidos, cero omitidos/cancelados/TODO; exit 1**. `reported ship totals explain covered imperial goals despite unmet local minima` recibe `[]` donde espera los cuatro resúmenes globales. `pipeline: complete init and delta count own transit once and render exact production` falla con `0 !== 4`: faltan los cuatro `goal-status`. `local fleet page identifies its scope and explains the active imperial override` no encuentra el título local. Los fallos de extracción de `syncFleetPolicyNotice` indican ausencia de esa nueva función, no un fallo del motor de producción. Los tres casos que validan la política de flota existente pasan ya en la base; no se afirma que haya cambiado esa política.

Con el mismo comando y los mismos tres tests en la candidata: **55/55 aprobados**, cero fallos, omitidos/cancelados/TODO; exit 0. Los 24 casos existentes del pipeline se han reforzado mediante un helper llamado por `assertReady` y `assertBlocked`, sin contarlos otra vez. Comparan las cuatro cifras con `core.aggregate` del estado actual durante confirmaciones antes/después/dentro del clic, pausas, barreras, cambios de cuenta, propiedad, reconexión, duplicados y caducidad. El stock verificado puede permanecer visible durante una pausa; nunca sustituye el estado operativo ni concede permiso para ordenar.

SHA-256 de la reproducción:

| Archivo | SHA-256 |
| --- | --- |
| userscript base 1.16.1 | `9e68c8662bafae79001b08a286e6ba0aa6af0743896b1baf4a591e7341b719b6` |
| panel base 1.16.1 | `4cb068e030da4628149222099ea9bedb54fddd704dbc30353b1f6eb9e57ed575` |
| `tests/empire-fleet-feedback.test.cjs` antes y después | `1b9a2782da953a4497470a42e8a35d3df54481dd57d66bf3f354ffb820df8670` |
| `tests/empire-panel.test.cjs` antes y después | `7d476bd4e04cb01d6195f4b94350d1952d03691200b8160b1038ee6bf728a89c` |
| `tests/empire-order-pipeline.test.cjs` antes y después | `63412a48782f7aed0b1ad8e8431b3f81560c519296d4cd12fe71ff1cef0517d3` |
| registro anterior (fuera del checkout) | `c99ae740adc2b7343c2715d31e0106ca0b6bf6b503051096652517024c06cb7b` |
| registro posterior (fuera del checkout) | `758a55f94501308508e2a0615ea2797f11805e3306a8170efa35f0066b62bbe4` |

## Matriz de regresión

Los nombres siguientes son los casos exactos enlazados en `review-feedback.json`. Los escenarios de pipeline ejercitan módulos de producción con tráfico y DOM sintéticos, sin conexión ni pedidos reales.

| Escenario | Resultado requerido | Caso exacto |
| --- | --- | --- |
| Imperio activo, stock global cubierto y mínimos locales incumplidos con countAway local desmarcado. | El déficit imperial es cero; al desactivar Imperio se recuperan los mínimos locales sin mutarlos. | `covered imperial goals create zero deficits while local away-excluded minima stay saved` |
| Pérdida verificada o incremento del objetivo global. | Solo se reparte una vez el déficit global real. | `verified loss or increased goal requests only the real global shortfall once` |
| 100 actualizaciones consecutivas con el mismo modo, y una transición de activación. | No hay escrituras redundantes de hidden ni lecturas del censo; cada transición escribe una vez. | `local override notice writes visibility only when active mode changes` |
| Censo parcial, caducado, no sincronizado o con flota incompleta. | No se muestran totales, faltantes o asignaciones como verificados. | `goal feedback never labels partial, stale or unsynchronized totals as verified` |
| Cambio de cuenta/galaxia conservando snapshots y plan anteriores. | Desaparecen inmediatamente las cifras verificadas y el reparto del ámbito anterior. | `goal feedback clears cross-scope totals and cached allocations before any new census` |
| Observaciones duplicadas, sin propiedad o tránsito de otro ámbito/inconsistente con el HUD. | El resumen no afirma disponibilidad de producción ni cifras verificadas. | `goal feedback rejects conflicting, unowned and foreign transit observations` |
| Se reutilizan exactamente los mismos objetos de censo hasta 15 segundos y un milisegundo después. | El límite inclusivo sigue vigente; al caducar desaparecen cifras y no regresan hasta sincronizar la nueva generación. | `goal feedback expires reused census objects at the runtime freshness boundary` |
| Borrador enfocado, objetivo guardado cambiado y guardado fallido síncrono/asíncrono. | Se conserva el borrador y el error; el progreso usa solo el objetivo guardado hasta un guardado válido. | `goal feedback preserves focused drafts and saved goals across conflicts and failed saves` |
| Roles no productores, Atender desactivado o políticas UUID ambiguas con error operativo. | Se explica la ausencia de productores; al cubrir metas cambia el resumen sin borrar el error. | `production feedback respects disabled and conflicting producers without clearing runtime errors` |
| Objetivos cubiertos con pausa del Helper o barrera de censo posterior al pedido. | El progreso y el estado operativo permanecen visibles como información independiente. | `reported ship totals explain covered imperial goals despite unmet local minima` |
| Render visible sin cambios o panel oculto. | No se reescribe texto idéntico; oculto no lee censo y al reabrirse evalúa la frescura actual. | `hidden dashboard does no census reads and renders the latest values when opened` |
| La confirmación del HUD llega antes del censo posterior al pedido. | Se conserva la barrera y no se presentan cifras sin verificar como autorización. | `pipeline ship: HUD-before-census preserves the first post-order census` |
| El censo nativo llega primero y el HUD confirma después. | El stock disponible puede verse aunque siga pausado; tras confirmar se utiliza la primera revisión nativa válida. | `pipeline ship: census-before-HUD preserves the first post-order census` |
| Confirmación y censo durante el clic sintético. | Las cuatro cifras se revisan en las transiciones sin duplicar el pedido ni fabricar frescura. | `pipeline ship: synchronous-click preserves the first post-order census` |
| Reconexión con mensajes tardíos de la generación anterior. | El stock depende del censo actual; la generación antigua no recupera autoridad. | `pipeline: reconnect ignores late old-generation frames and HUD ACK waits for the new complete init` |
| Cambio de cuenta con una orden simulada pendiente y vuelta a la cuenta inicial. | Ninguna cifra ni permiso utiliza propiedad del ámbito anterior; se exige evidencia actual. | `pipeline: account/scope change cannot reuse pending ownership, and returning requires current account evidence` |
| Delta duplicado y entrega repetida del mismo DTO. | No se duplican naves ni se refresca la edad por releerlo; los mensajes caducan en el límite real. | `pipeline: duplicate native deltas replace inventory instead of double counting, while duplicate DTO delivery never refreshes age` |
| HUD múltiple, ajeno o no coincidente aunque haya censo completo. | La guarda de pedidos permanece cerrada y el estado operativo no se sustituye por el resumen de stock. | `pipeline: missing/ambiguous live HUD ownership never becomes ready despite a complete native census` |

## Hallazgo de revisión: reparto retenido tras editar

La revisión independiente detectó que `runtime.setConfig` revoca `ready` pero conserva `plan` hasta el siguiente `update`. Con un objetivo Probe de 40 y 22 naves verificadas, el plan contiene 9 por sistema. Cambiar el objetivo a cero y dibujar inmediatamente podía mostrar «sin objetivos» junto a «Reparto propuesto: Probe ×9». Los cambios de roles o Atender podían conservar la misma contradicción. El harness unitario recalculaba el plan en cada lectura y no reproducía ese orden real.

Se añadió `pipeline: immediate config edits hide retained allocations until runtime recalculates goals, roles and Atender`, que usa el runtime de producción. Primero se ejecutó sin la guarda de `ready`, en una copia temporal de las fuentes de la candidata: panel SHA-256 `9628420748f6e78c46e1b245f735e2633e32033f26a225b43c904f590083a7c3`, userscript SHA-256 `e4f5d4d747e2881304e97bfb882688f0a661d3afcb8e04764590959ceb0e158c`. Comando:

```sh
env -u NODE_PATH node --test --test-name-pattern='pipeline: immediate config edits' tests/empire-order-pipeline.test.cjs
```

Resultado: 1 caso, 1 fallo, exit 1; `A retained plan must not appear alongside the new goals before update` (actual false, esperado true). Registro SHA-256 `96c074c6680843938cac894e0366fbd99b45ce9dc97b79962186bab28ad2475b`. No es una avería del harness: el propio caso verifica que `setConfig` ha guardado la política nueva, conserva el plan anterior y revoca permiso.

La corrección exige `state.ready === true` para el reparto visible, además de modo activo y censo íntegro/fresco. No cambia runtime/planner ni oculta las cifras de stock durante una pausa. El mismo caso pasa los tres escenarios después: objetivos a cero; roles Industria/Defensa; y Atender desactivado en la colonia. Verifica la fase inmediatamente anterior al tick y la posterior: en Atender se recalcula 18 para la sede y cero para la colonia, sin ningún clic ni navegación. El caso nuevo cuenta una vez entre los 55 focalizados; los 24 casos anteriores del pipeline siguen reforzados.

## Integración y control completo

Se conservan byte a byte frente a 1.16.1 `docs/empire-core.js`, `empire-runtime.js`, `empire-observer.js`, `empire-adapter.js`, `empire-bridge.js`, `sync-core.js`, `drive.js` y `metrics-core.js`. También permanecen iguales las funciones distribuidas `empireOperationalSettings`, `fleetDeficit` e `installHelperKeyboardBoundary` y la suite de teclado. La actualización de metadatos, `SCRIPT_VERSION`, README y changelog corresponde a 1.16.2. La entrada histórica de 1.16.1 en README se alinea con «Teclado dentro del Helper», sin relajar su prueba.

Los cuatro builders se ejecutan antes del commit. El control de publicación obligatorio es `env -u NODE_PATH node validate-release.cjs --report <ruta-absoluta-fuera-del-checkout>`, sobre el commit final limpio, con la suite completa sin filtros. El informe externo identifica commit, árbol, hashes, regresiones enlazadas y pruebas de navegador no ejecutadas. No es válido reutilizar el antiguo informe de 1.459 pruebas del parche aislado, ni sumar los 55 casos focalizados al recuento de la suite completa. Cualquier cambio posterior exige otro commit y otro gate completo; este documento no afirma una aprobación independiente ni una publicación.

## Límites

No se ha probado esta UI dentro de Brave/Violentmonkey conectado a una partida y Drive. Las pruebas de DOM son sintéticas y no demuestran distribución visual, accesibilidad real del navegador ni pedidos reales. No se envió ningún pedido para investigar. El revisor independiente final debe inspeccionar los cambios integrados y estos límites antes de publicar.
