# UI/UX 1.16.3: menos texto, navegación y edición de objetivos

## Alcance integrado

Primera entrega de claridad de Imperio y Flota. La base local inmutable es `1fc791c96a6ab8087b15a01d93c8b117336cfa91`, árbol `94f6d665e1292995897d9db00b6e378a3d806831`, idéntico a main 1.16.2 `b14b08cbb26baeeebfab8292af39beb76c442090` al verificarlo el 14 de octubre de 2026. El parche UI anterior `3e1cdc7a26022e642196a6bdf06bf3edcb3f8fad` se ha fusionado por bloques y regenerado; no se ha sustituido el módulo de 1.16.2 por una copia anterior.

- Subpestañas de Flota en flujo normal debajo de las principales, fuera del scroller. Solo aparecen en Flota; la regla existente de minimización oculta todos los hijos salvo la cabecera. Conservan scroll por subvista, flechas/Home/End y una parada de Tab.
- En Imperio quedan a la vista estado, recuento, progreso por nave, objetivo guardado, producción y controles. La explicación larga de reparto/Drive y las explicaciones repetidas de rol pasan a detalles cerrados. El resumen de base, misiones, traslados y construcción y la sustitución de mínimos locales siguen visibles.
- Flota reduce la introducción y añade ayuda cerrada sobre recuento/producción y presets. El aviso activo mantiene que los mínimos locales no se aplican e incluye **Ver objetivos**: utiliza la pestaña existente, lleva al primer objetivo y no activa ni modifica política.
- Imperio responde al ancho de su contenedor; controles estrechos, nombres largos y focos tienen estilos específicos. Estas reglas se inspeccionan como código, no como una comprobación visual.
- Los borradores, errores y éxitos son locales a instancia/ámbito. Blur y change confirman sin duplicar; error o valor inválido se conservan. Reset remoto conserva un borrador pendiente pero retira éxitos obsoletos. Guardar fusiona la edición con la política vigente. El hook de identidad ya leída invalida A→B→A oculto sin procesar censo.

Se conservan `goalStatuses`, `productionSummary` y reparto condicionado a `ready` de 1.16.2. `aria-describedby` contiene progreso guardado y feedback de edición, en ese orden. No cambian runtime, planner, lector, adaptador, puente, Drive, permisos, telemetría ni guardas de pedidos. El teclado continúa en las mismas raíces. No se guardan datos personales en estas fixtures.

No es un rediseño completo: campañas, misiones, avisos, backups y flujos de autorización mantienen su contenido y funcionamiento. Un rediseño adicional de tarjetas/gráficos o del resto de pantallas queda fuera de esta entrega.

## Densidad medida, no inferida

`tests/helper-ui-density.test.cjs` monta el panel real con dos sistemas sintéticos y analiza la plantilla real de Flota como árbol DOM de fixture. Cuenta palabras de ayuda visibles con detalles cerrados, incluidos sus resúmenes. Excluye avisos dinámicos, cifras y etiquetas de controles. No mide píxeles, recortes ni primera pantalla real.

| Bloque | 1.16.2 | 1.16.3 | Reducción |
| --- | ---: | ---: | ---: |
| Imperio, dos sistemas | 145 | 41 | 71,7 % |
| Flota | 42 | 17 | 59,5 % |

Los mismos tests comprueban que controles, progreso y estado permanecen fuera de la ayuda cerrada y que el texto completo de roles, recursos y recuento sigue disponible. Los avisos de credenciales/importación, consentimientos y alertas dinámicas no se ocultan ni editan.

## Reproducción roja y verde sobre la misma batería

Se exportó la base local con `git archive` a un directorio temporal fuera del checkout, se copiaron sin cambios los tres archivos finales de tests nuevos/modificados (panel, navegación y densidad) y se ejecutó en ambos árboles:

```sh
env -u NODE_PATH node --test tests/empire-panel.test.cjs tests/helper-navigation.test.cjs tests/helper-ui-density.test.cjs tests/helper-keyboard-boundary.test.cjs tests/empire-fleet-feedback.test.cjs tests/empire-order-pipeline.test.cjs
```

- Base 1.16.2: **104 casos, 81 aprobados, 23 fallidos, exit 1**.
- Integrado: **104 aprobados, cero fallos, omitidos, cancelados o TODO**.
- Fallos conductuales: borrador inválido reemplazado tras blur/render, cambio tardío que guarda en otro ámbito, guardados fallidos sin feedback persistente, repetición de guardado, ausencia de invalidación oculta y navegación dentro del scroll.
- Expectativas nuevas: dos IDs de descripción accesible, nueva ayuda cerrada/presupuesto de texto y atajo Ver objetivos. Su ausencia en la base no demuestra una avería previa de las guardas de producción.
- La batería incluye las regresiones de teclado, el flujo real de pedidos con tráfico sintético y las cifras/guardas de 1.16.2. No se eliminan pruebas para hacerla pasar; los dos asserts anteriores de descripción única y descarte del valor fallido se actualizan explícitamente al contrato nuevo.

### Matriz de fronteras

| Flujo | Cobertura |
| --- | --- |
| Objetivos | Vacío/espacios/negativo/fracción/NaN/Infinity/texto/fuera de rango, 0/1/máximo, corrección, no-op 20→40→20, blur/change tardío, reintento del mismo valor. |
| Política externa | Drive simulado cambia objetivo y otros campos; se mantiene borrador y se fusiona sobre política actual; reset descarta éxito obsoleto, no el borrador. |
| Identidad y ciclo de vida | Cuenta, galaxia, scope vacío, eventos tardíos, panel oculto A→B→A, destroy durante save, scope y nuevas ediciones reentrantes. |
| Foco/teclado | Navegación montada de producción con modelo captura/burbuja y frontera real; flechas/Home/End, defaults Tab/Escape/G, Enter en Ver objetivos, foco/scroll y cero cambios de política. Los defaults se simulan. |
| Refresco | 50 renders sin cambios no reescriben texto; panel oculto no lee censo; reapertura evalúa frescura. |
| Conservación | Progreso guardado más feedback de edición; pausas/errores separados de stock; reparto retenido oculto cuando ready es falso. |

## Revision reentrante

La revisión independiente del parche UI anterior encontró cuatro defectos temporales. Se copiaron **los mismos tests finales** de `tests/empire-panel.test.cjs` al árbol inmutable `3e1cdc7a26022e642196a6bdf06bf3edcb3f8fad` y se ejecutó:

```sh
env -u NODE_PATH node --test --test-name-pattern='reentrant save completion|scope generation|destroy during|rejected async|nested saves of different' tests/empire-panel.test.cjs
```

Resultado anterior: **0/5, exit 1**. Un borrador 55 acababa sustituido por 40; un error de A aparecía en B; destroy lanzaba `TypeError` al escribir feedback; una promesa rechazada generaba `unhandledRejection`. Resultado integrado: **5/5** en la batería anterior. La corrección valida generación de ámbito/guardado e identidad del objeto de edición, invalida destroy y consume rechazos sin declarar éxito asíncrono. Incluye A→B→A, nuevo borrador del mismo valor, guardado anidado y error de operación obsoleta.

Una segunda revisión detectó un campo atrapado en «Guardando…» cuando se guardaba otro campo dentro del callback. Ahora cada identidad de edición finaliza por separado y solo la secuencia más reciente controla la alerta compartida. El caso también detecta en el parche anterior que el éxito externo borraba el error del segundo campo. Se retiró preventScroll del salto Ver objetivos para permitir al navegador revelar el campo enfocado; no equivale a comprobar su visibilidad real.

Las primeras pruebas del parche sin integrar y sus antiguos gates no certifican esta entrega. La revisión independiente del snapshot final y el gate limpio deben referirse al commit/árbol congelados; el manifiesto obligatorio conserva los criterios y las regresiones exactas.

## Integridad de los tests comparados

SHA-256 de los archivos ejecutados sin modificar entre rojo y verde:

- `tests/empire-panel.test.cjs`: `845eff0002223a29e2e4ccda00a70f38a445c8a9dc5b0146913214b1c5a09ac5`
- `tests/helper-navigation.test.cjs`: `ddd1dd5785e7550288e648f5d832d76607ca3e3cd9207aec7218384a536fa95f`
- `tests/helper-ui-density.test.cjs`: `ccab65cf4fa170b66a84e8d97617437932ba48fd822077ad409def43298708ec`
- `tests/helper-keyboard-boundary.test.cjs`: `29fc0395e34001aa969a59756f9d329ea806b5c03a46681574bc611307cd2c1b`
- `tests/empire-fleet-feedback.test.cjs`: `1b9a2782da953a4497470a42e8a35d3df54481dd57d66bf3f354ffb820df8670`
- `tests/empire-order-pipeline.test.cjs`: `63412a48782f7aed0b1ad8e8431b3f81560c519296d4cd12fe71ff1cef0517d3`

## Navegador y QA real pendientes

`tests/helper-ui-ux.browser.cjs` es un ensayo opcional aislado de plantilla/estilos/handlers de producción y la frontera real de teclado, con tráfico externo bloqueado. La revisión de sintaxis no cuenta como ejecución. Prepara anchos viewport/panel 1200/300, 1200/360, 1200/560, 390/360 y 320/300, scroll, objetivos, ayuda nativa y teclado; no monta el userscript entero.

**No se ha ejecutado en esta integración.** La ruta Chromium anterior falló al arrancar por una restricción de sockets; el navegador disponible no tiene una ruta soportada a localhost de este shell. No se recurrió a un lanzamiento manual ni a otra ruta para eludirla. Por tanto layout, recortes, foco real, accesibilidad, zoom 125/200 %, altura corta y tacto siguen sin comprobar. Tampoco hubo sesión real de Brave/Violentmonkey, conexión Drive, envío de flotas ni otros pedidos.

Los modelos de eventos no prueban implementación nativa de input number, composición, lector de pantalla o detalles en navegador. Estos límites permanecen abiertos aun con la suite offline verde; no se pide usar la partida para simular pedidos.
