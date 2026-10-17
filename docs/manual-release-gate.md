# Comprobar una candidata antes de main

El workflow manual «Manual complete release gate» conserva el archivo histórico chromium-startup-order.yml para usar el evento workflow_dispatch ya disponible en la rama por defecto. Sustituye el antiguo ensayo de orden, que leía el hash de la imagen antes del arranque y no era gate de publicación. Los ensayos históricos conservan su significado; los experimentos acotados viven en ramas diagnósticas separadas.

Una candidata comprometida en una rama puede ejecutar `gh workflow run chromium-startup-order.yml --ref <rama>` sin crear PR ni mensajes externos. El workflow ejecuta exactamente `node validate-release.cjs --report "$RUNNER_TEMP/release-validation.json"`, igual que offline-browser.yml: mismo Node24, runner, módulos públicos hash-pinned, OVERLAY_BROWSER_REQUIRED=1, timeout15min, permisos contents:read y artefactos. No usa filtros, precargas, overrides ni relajación de checks.

El paso manual no publica ni sustituye el gate local, la revisión independiente o la concurrencia. Solo es válido para el SHA exacto ejecutado. Antes de main, comprobar que ese SHA coincide con la candidata final y que todos los pasos terminaron correctamente. Cualquier cambio posterior exige validar el nuevo árbol. Después del push normal a main, comprobar nuevamente el CI automático exacto y los bytes servidos; el pase manual previo no garantiza otro runner ni repara por sí mismo una condición de arranque inestable.

Cada informe debe indicar el SHA, el resultado real y sus límites. Este workflow no acredita una sesión de juego ni repara por sí solo el almacenamiento del runner.
