# Recuperación guiada del lector, 1.16.6

## Alcance y conclusión

La captura recibida el 14 de octubre de 2026 a las 22:01 UTC muestra el mensaje que corresponde a un canal instalado, con observación inicial recibida y `generation = 0`: ningún socket reconocido ha sido observado. No demuestra que el juego esté desconectado ni cuándo se instaló su conexión. No se atribuye una causa definitiva a esa sesión.

Esta candidata mejora el diagnóstico y la recuperación manual. **No corrige retroactivamente una conexión ya creada ni recupera un `world.init` perdido.** No modifica el observador, el puente, el transporte, sus límites, los pedidos, la política, Drive, los permisos o las métricas. No abre, cierra ni reinicia sockets, y no recarga la pestaña.

## Contraste público actual

GET públicos nuevos, sin cookies, login, ejecución del cliente ni acciones del juego, el 14 de octubre a las 22:05 UTC:

| Fuente | SHA-256 |
| --- | --- |
| [Shell de la galaxia](https://oldlight.io/game/galaxy/alpha) | `dde42c776be45cec3bdaefce0300982ae78c5713cbcbe723c2778b40f4e8a246` |
| [galaxy-CqK10P8m.js](https://oldlight.io/assets/galaxy-CqK10P8m.js) | `ba9c761ac00e7f513a58014a33574fbcfef1f4942ffc3b337ef606ea4ab0ccdc` |
| [base-CkpLJbQ4.js](https://oldlight.io/assets/base-CkpLJbQ4.js) | `aae85046ccca0c29a261fefd48c0ea2f39e503716f2ab0f09e1abbc075743f76` |

Son idénticos a los assets ya documentados. La URL sigue siendo `wss://api.oldlight.io/socket.io/?EIO=4&transport=websocket`. El módulo guarda el constructor nativo al evaluarse y registra `onmessage`; el observador existente ya cubre esa asignación mientras el socket sigue CONNECTING. No se amplían dominios ni esquemas aceptados.

Offsets en el bundle de galaxia, caracteres Unicode base cero: constructor cacheado 486349; receptor `onmessage` 485774; ruta por defecto 510322; Engine.IO 491019; opciones de transporte 514741; `world.init` 515552; vaciado de `receiveBuffer` 507913; estado privado 533768; nuevo init de reconexión 558307. La API base aparece en el segundo asset, offset 1681.

No se encontró una API pública pasiva de replay del inicio ya entregado: el estado y el inicio permanecen en el cierre del arranque, y Socket.IO vacía su buffer. Esto describe el código inspeccionado, no cualquier futura versión. Si solo llega tarde un consumidor pero el observador ya capturó el inicio, el puente puede entregar su snapshot validado; es distinto de instalar el propio observador tarde.

## Reproducción causal y antes/después

Base publicada: commit `56bc5faf74deb4a1ff029d1087798e42a246e45a`, árbol `9bb5483dc860b79bad6a53fb19e89f9d5e507744`; commit local equivalente `4601edec7e467476f92e86340ad755870de4735b`.

La fixture de `tests/empire-late-start-review.test.cjs` ejecuta builder, bridge, observador y adaptador reales en dos contextos VM y con puerto asíncrono simulado. El orden relevante es:

1. El userscript solicita la inserción durante `loading`.
2. Antes de ejecutarse el script insertado, el juego simulado crea su socket, registra callbacks y recibe el inicio.
3. Se ejecuta la inserción con documento `complete`. El canal queda instalado y entrega `generation = 0`.
4. Deltas posteriores del socket anterior y un minuto de espera no fabrican censo ni crean conexiones.
5. Solo cuando el propio juego simulado crea su siguiente socket se observa la nueva conexión. Un delta previo no habilita nada; un inicio completo y de confianza recupera el censo.

Por tanto, `loading` registrado por el bootstrap no prueba que el hook estuviese listo antes del socket. El defecto de UX reproducido era dejar un párrafo ambiguo sin una ayuda contextual de recuperación. No se presenta la nueva UI como una reparación del transporte.

Para reproducir el antes/después, se extrajo la base con `git archive` en un directorio temporal y se copiaron sin cambios los cuatro archivos de pruebas finales que se indican. Comando en ambas copias:

```sh
node --test tests/empire-diagnostics.test.cjs tests/empire-panel.test.cjs tests/empire-observer-cached-constructor.test.cjs tests/empire-late-start-review.test.cjs
```

La primera reproducción con los nuevos casos dio 89 pruebas: 81 aprobadas y 8 fallidas en la base. Fallaron el límite del mensaje breve, la ausencia del lector de recuperación, la ausencia de ayuda contextual y el cableado en el userscript. Los escenarios nativos de no recuperación retroactiva y reconexión legítima ya pasan en la base: son límites preservados, no arreglos nuevos. Se añadió después la regresión de foco/cambio de cuenta oculto; el gate final enlaza cada caso realmente ejecutado con su commit y hashes.

## Cambio y matriz

- Mensaje de conexión no observada: menos de 90 caracteres. El origen del fallo no se afirma.
- `getRecovery()` devuelve únicamente categorías fijas y la fase del documento al arrancar. Lee flags del puente, sin clonar el censo. Nunca concede identidad, propiedad, selección, recursos ni permisos de acción.
- `Cómo recuperar el lector` aparece solo para conexión no observada, espera/falta de inicio y pérdida de conexión. Es un `details` nativo cerrado de inicio.
- Los tres pasos son manuales: pausar el Helper y guardar ediciones; recargar la pestaña; revisar el censo antes de reanudar. Mientras el juego carga, esperar o una reconexión natural pueden ser suficientes. La ayuda no promete que recargar resuelva todos los casos y desaconseja hacerlo en bucle.
- La ayuda conserva su apertura en renders estables; se cierra al cambiar el diagnóstico o la cuenta/galaxia, incluso en recorridos A→B→A con panel oculto. Desaparece al recuperarse el lector. Si tenía el foco, lo devuelve al aviso visible.
- Diagnósticos desconocidos, campos mal tipados, getters o lectores que arrojan errores no se muestran ni habilitan acciones. No hay URLs, errores crudos ni datos del juego en la ayuda.
- Abrir o cerrar ayuda no guarda preferencias ni toca el juego. Los bloqueos y mensajes operativos existentes permanecen visibles.
- Se conserva el puerto privado, la exigencia de eventos de confianza, el inicio completo, las guardas de época/generación/identidad/frescura y la observación pasiva de conexiones futuras.

## QA y límites

El gate completo debe ejecutarse sobre el commit final limpio y comprobar fuentes embebidas, metadatos, builders, sintaxis y toda la suite offline. El resultado final y la revisión independiente se registran fuera del árbol para no cambiar los bytes validados.

`tests/empire-observer-recovery.browser.cjs` contiene QA visual opcional en Chromium sobre una página sintética aislada: 300/360/560 px, apertura con clic y teclado, estados, foco y ausencia de efectos/red. El gate solo comprueba su sintaxis. El arranque de Chromium local quedó bloqueado por el entorno; esto no cuenta como un aprobado visual. Cualquier comprobación visual por otra ruta debe identificarse por separado y sobre los mismos fuentes.

Sigue pendiente la sesión real en Brave/Violentmonkey con Drive. No se han probado órdenes ni se requiere probarlas en la partida para esta corrección. La causa concreta de la captura del usuario sigue sin establecerse.

## Hallazgo de la revisión independiente: versión visible del README

La primera candidata, commit `4b5aabcd0cdcd7adafb7d5b9533a505043f35d2a`, tenía metadatos, constante y changelog en 1.16.6, pero la introducción del README aún decía 1.16.5. Se añadió sin cambiar el harness el caso `README current version and newest section match the installed release` a `tests/helper-changelog.test.cjs` y se ejecutó `node --test tests/helper-changelog.test.cjs`: 21 casos, 20 aprobados y 1 fallo por `'1.16.5' !== '1.16.6'`. Tras corregir esa introducción, el mismo comando dio 21/21. La prueba compara la versión visible y la sección más reciente con la versión instalada; la corrección exige repetir ambos gates sobre el nuevo árbol final.
