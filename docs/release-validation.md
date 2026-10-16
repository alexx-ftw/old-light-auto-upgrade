# Validación de una candidata de publicación

El comando único `node validate-release.cjs` reúne las comprobaciones offline. No publica, no instala dependencias, no se conecta al juego ni sustituye la revisión de una persona. Se ejecuta sobre un commit local limpio y deja los fuentes originales intactos.

## Uso

Requiere Node.js 24 o posterior, Git y Linux o macOS. Esta revisión se ha ejecutado en Linux con Node 24.19.0; macOS no se ha probado en este entorno. Windows se rechaza de forma explícita porque la limpieza de grupos de procesos utilizada aquí requiere POSIX. Desde la raíz del repositorio:

```sh
node validate-release.cjs
```

Imprime un informe JSON. Para conservarlo en un archivo nuevo, fuera del checkout:

```sh
node validate-release.cjs --report /ruta/absoluta/fuera-del-repo/candidata.json
```

No sobrescribe un informe existente. No acepta listas de tests, filtros ni opciones para saltarse etapas. Rechaza los overrides de fuente o ejecución que podrían validar otro archivo. Si el entorno hereda uno, el informe identifica su nombre sin mostrar su valor; quítalo únicamente de esa invocación antes de repetir (por ejemplo, `env -u NODE_PATH node validate-release.cjs`). El checkout debe estar limpio, sin archivos ignorados o no seguidos que puedan alterar la ejecución.

## Preparar el árbol final

1. Termina los cambios y sus pruebas de regresión. Convierte el feedback reproducible en una entrada de `docs/review-feedback.json` siguiendo el ciclo de revisión de abajo. Si cambia un módulo embebido, ejecuta su builder correspondiente antes de guardar el commit. Un builder que «repare» un artefacto durante la validación es un fallo de la candidata, no una aprobación.
2. Comprueba la versión de los dos metadatos, `SCRIPT_VERSION`, las notas integradas y README cuando cambie el userscript distribuido. Un cambio exclusivo de herramientas/documentación puede conservar la versión y los bytes del Helper.
3. Guarda todos los archivos relevantes en un commit. No deben quedar cambios locales ni archivos nuevos fuera de Git. Esto evita probar silenciosamente una selección diferente de la que se va a publicar.
4. Ejecuta el gate completo, sin filtros de pruebas ni variables de sustitución de fuentes. Guarda el informe fuera del repositorio si necesitas conservarlo. Si algo falla, corrige, crea el nuevo commit final y vuelve a ejecutar el gate completo.

El reporte utiliza resúmenes estructurados por archivo y global del [test runner de Node.js](https://nodejs.org/docs/latest-v24.x/api/test.html#event-testsummary), en lugar de interpretar como éxito cualquier texto impreso por las pruebas. Identifica el commit, el árbol y los hashes exactos de los archivos probados. Los resultados solo son válidos para esos bytes. No reutilices un informe después de modificar fuentes, pruebas, builders o configuración de publicación.

## Qué verifica automáticamente

- Inventario recursivo de todas las entradas `*.test.cjs`, sin seleccionar solo las pruebas de la función modificada. Se rechazan entradas `*.test.js`, `*.test.mjs`, `*.test.ts`, `*.test.cts`, `*.test.mts`, `*.test.jsx` y `*.test.tsx` no soportadas para que no queden silenciosamente fuera de la suite. Node 24 puede ejecutar TypeScript, pero este gate solo admite `*.test.cjs`; añadir otro formato requiere integrarlo expresamente en el inventario y sus controles.
- Suite completa sin fallos, cancelaciones, pruebas omitidas, TODO ni resultados vacíos o incompletos. Un código de salida cero por sí solo no basta.
- Manifiesto de feedback obligatorio y versionado: esquema estricto, enlaces a evidencia y tests seguidos por Git, escenarios límite y criterios para la revisión independiente. Cada caso enlazado debe generar exactamente un evento real `test:pass` del archivo y nombre indicados. No valen una suite, un nombre duplicado ni texto de consola que imite un resultado.
- Sintaxis de todos los archivos `*.js` y `*.cjs` del inventario, incluidos los scripts *.browser.cjs históricos sin ejecutarlos; la nueva prueba de overlay *.test.cjs sí ejecuta Chromium cuando está disponible.
- Coherencia de los metadatos del userscript y del archivo `.meta.js`, `SCRIPT_VERSION` y la primera entrada de las notas integradas.
- Los cuatro builders en una copia temporal, dos pasadas; cada ejecución debe conservar los artefactos ya preparados. No se actualiza el checkout original para hacer que una prueba pase.
- Identidad del árbol de entrada y ausencia de cambios durante la ejecución. Se rechazan rutas enlazadas o entradas que puedan escapar de la copia.
- Informe explícito del alcance offline. Los scripts *.browser.cjs excluidos quedan identificados como no ejecutados. La prueba de overlay *.test.cjs entra en el inventario: el preflight informa disponibilidad y CI exige OVERLAY_BROWSER_REQUIRED=1; no se acredita render si falta Chromium.

Los archivos cacheados de Pages pueden conservar versiones anteriores si no han cambiado. Por ejemplo, en 1.15.1 `drive.js`, `sync-core.js` y `drive.css` llevan versiones diferentes. Revisar que un recurso modificado invalide correctamente su caché sigue formando parte de la revisión del diff.

## Convertir feedback en controles duraderos

Con cada fallo reproducible o hueco de revisión detectado:

1. Identifica el comportamiento observado, su alcance y el árbol anterior. Conserva un caso que falle antes de corregirlo y anota el comando y el fallo concreto en una evidencia Markdown seguida por Git. No confundas una avería del harness con la reproducción del comportamiento.
2. Corrige y ejecuta ese mismo caso. Añade límites realistas a ambos lados de la guarda: el flujo que debe bloquearse y el flujo legítimo que debe seguir funcionando. Incluye el orden de eventos y otras superficies afectadas cuando importen.
3. Añade una entrada a `docs/review-feedback.json` y conserva las anteriores. Los nombres enlazados son exactos y deben ser únicos dentro de su archivo; al renombrar un test, actualiza también sus referencias. Una eliminación de cobertura exige revisar y justificar la sustitución, no borrar el registro para poner el gate en verde.
4. Especifica los gaps pendientes y criterios concretos que otro revisor pueda contrastar contra el diff, los escenarios y la evidencia. Si un informe no se reproduce, anótalo como límite en la matriz; no inventes un fallo previo ni cierres su incertidumbre por tener una suite verde.
5. Actualiza el [registro de lecciones del revisor](independent-code-review.md): qué hipótesis falló o falta contrastar, qué pregunta cambia y qué evidencia se exigirá. Los fallos aún no reproducidos se conservan como incertidumbre, sin inventar un `beforeFail`.
6. Revisa de forma independiente el árbol final y ejecuta el gate completo sobre su commit limpio. Las correcciones posteriores invalidan el resultado anterior y requieren volver a validar.

El esquema versión 1 exige un objeto con `schemaVersion: 1` y un array `entries` no vacío. Cada entrada contiene exactamente:

- `id`: slug único en minúsculas, y `feedback`: descripción del fallo o hueco de control.
- `beforeFail`: `revision` (ID Git completo de commit o árbol), `command`, `observedFailure` y `evidence` (ruta a un Markdown seguido por Git; puede incluir un fragmento). El registro explica cómo se conservó el mismo harness al probar el árbol anterior.
- `regressions`: uno o más objetos `{ "file": "tests/archivo.test.cjs", "name": "nombre exacto del caso" }`.
- `boundaries`: uno o más objetos con `scenario`, `expected` y `regression`; este último debe ser una referencia de `regressions` de la propia entrada.
- `qaGaps`: array explícito de objetos `scope` y `reason`. `[]` significa que no se conocen gaps específicos de esa entrada; no elimina las limitaciones offline del gate.
- `independentReviewCriteria`: array no vacío de criterios concretos de revisión, no una declaración de aprobación.

Se rechazan campos desconocidos, textos vacíos, IDs repetidos, enlaces no seguidos, casos no inventariados y referencias de límites que no estén en la propia entrada. El informe distingue `feedbackManifest.scope: schema-and-tracked-links-only` de `tests.regressionPasses`, la evidencia de ejecución actual vinculada al commit y hashes del informe. La presencia de un registro histórico no demuestra automáticamente que el fallo previo sucediera, que el escenario sea realista o que un revisor lo haya aprobado. Estas tres cosas requieren inspección independiente. Tampoco se vuelve a ejecutar código histórico ni comandos guardados en el JSON.

### Regresión del propio control de feedback

Se reprodujo la ausencia de este control con el validador del árbol `7529a0d4f798ddf2995c4f8d6ddd41200916d974` (commit local equivalente `90bc8f9acbeb805356faf11657da65ae9724e46d`). En un directorio temporal se colocaron ese `validate-release.cjs` y el nuevo `tests/release-validation.test.cjs`, conservando el test nuevo sin cambios, y se ejecutó:

```sh
node --test --test-name-pattern='CLI fails closed on missing or malformed feedback' /ruta/temporal/tests/release-validation.test.cjs
```

El caso esperaba que el CLI rechazara un manifiesto ausente. El validador anterior devolvió éxito y el test falló con `0 !== 1`. Ese filtro sirve únicamente para el experimento antes/después; no es una validación de publicación. Con el validador corregido se comprueban además JSON malformado, referencias inexistentes, casos no ejecutados, nombres ambiguos, suites y falsas afirmaciones impresas. La aprobación actual solo queda establecida por el gate completo del árbol final.

## Informes de parpadeo y cambios del overlay

Aplicar el [procedimiento temporal del overlay](overlay-validation-process.md) antes de modificar comportamiento: reproducción base/candidata con el mismo harness, estados entre eventos y frames, callbacks ejecutados contados y control de sensibilidad del reloj. Requiere revisión independiente fresca del árbol final y controles negativos de censo/cámara/gestos. Una suite verde sin esos controles no cierra un informe de parpadeo.

Registrar versión instalada confirmada separada de la publicada. Describir por separado simulación DOM, pintura del navegador y resultado del usuario; los dos últimos pueden seguir pendientes tras publicar una corrección condicional. El gate comprueba ejecución y enlaces del manifiesto, no la veracidad causal de esa revisión.

## Lo que requiere revisión antes de publicar

Un resultado offline satisfactorio no significa «listo para publicar» por sí solo:

- Un revisor independiente debe recibir el [encargo reutilizable y protocolo de revisión](independent-code-review.md), estudiar el árbol final y las regresiones fuera de la función modificada. No basta con repetir el mismo test o sumar sus ejecuciones como casos distintos.
- La matriz debe cubrir los flujos afectados y su orden temporal: entrada de datos, validación, coordinación, interfaz y efectos. Cuando corresponda, incluir confirmación temprana/tardía/duplicada, timeout, rechazo, cero efectos demostrable, cambios de identidad, pausa/reanudación, reconexión, conflictos y clientes antiguos.
- Deben quedar explícitas las invariantes de identidad y frescura, la exclusión mientras hay una operación pendiente, la posibilidad de reintentar cuando procede y los mensajes que verá el usuario.
- Hay que distinguir pruebas sintéticas, visuales y de integración real. Un gap de navegador o servicio real no se convierte en una prueba aprobada. No se envían órdenes a una partida real para completar este gate.
- No se declara una causa definitiva del problema del usuario solo porque una simulación reproduzca el mismo mensaje.
- Ante un reporte de automatización inactiva, contrastar el resultado esperado con la configuración efectiva, no solo con inputs visibles: modo local o global, precedencia, totales y déficits, frescura, roles y pausas. Una configuración sustituida debe indicarlo en su propia pantalla; los valores parciales o antiguos no se presentan como verificados. Conservar la diferencia entre causa demostrada y una explicación compatible con capturas de instantes distintos.
- Si un revisor encuentra un fallo, se corrige y se repiten los checks pertinentes y el gate completo sobre el árbol final; el número de pruebas no justifica publicar un fallo conocido.

La [matriz de 1.15.1](1.15.1-validation-matrix.md) es un ejemplo de evidencia por flujo y límites, no una aprobación reutilizable de versiones futuras.

## Comprobar la distribución

El gate local no toca GitHub ni puede descartar trabajo concurrente por sí mismo. Antes de mover `main`, vuelve a leer su HEAD y conserva cualquier cambio ajeno. La publicación usa el árbol exacto probado y una actualización con lease, sin sobrescribir concurrencia.

Después, verifica el commit y árbol remotos, los metadatos y bytes del autoupdate y el resultado terminal de Pages para ese mismo commit. Comprueba también los archivos servidos que dependan del cambio. No anuncies distribución completada mientras estos pasos estén pendientes o fallen.

## Alcance y seguridad de la herramienta

Ejecuta el gate únicamente sobre código y pruebas de confianza: una copia temporal evita modificar accidentalmente los fuentes, pero no es una sandbox de seguridad para ejecutar código hostil. Las interrupciones o límites deben terminar los procesos descendientes del grupo normal de cada comando. Un cierre forzado con SIGKILL del propio gate o código que se separe deliberadamente del grupo no puede considerarse cubierto por esa limpieza. El gate no añade permisos del userscript, telemetría remota ni acceso a cuentas; ejecuta únicamente la cobertura de navegador offline que esté inventariada como *.test.cjs; no ejecuta OAuth, acciones de juego o publicaciones.

## Navegador offline permanente del overlay

`tests/reinforcement-overlay-browser.test.cjs` inicia Chromium instalado mediante CDP, sin npm y con HTTP/HTTPS bloqueado. Comprueba el SVG productivo contra una escena Canvas2D de referencia con eventos reales de navegador, muestreando cada frame. Es cobertura de referencia, no renderer Pixi/cliente/MessagePort nativo. El preflight registra executable y required. El workflow Offline browser and release gate exige navegador y guarda PNG, frames.json y reporte del gate como artifacts; no guarda perfiles. En local sin navegador el test declara BROWSER_UNAVAILABLE, sin usar skip/TODO ni fingir ejecución visual. Para exigirlo: `OVERLAY_BROWSER_REQUIRED=1 env -u NODE_PATH node validate-release.cjs --report /ruta/nueva.json`.

Desde1.17.22 la prueba de navegador inventariada exige ambos órdenes del renderer y transporte0/45/180ms con observer/MessagePort productivos y Pixi de tests vendorizado. El gate no descarga dependencias ni ejecuta el bootstrap conectado. Consulta1.17.22-camera-render-order-validation.md para autoridad decorativa y fronteras aún sustituidas.
