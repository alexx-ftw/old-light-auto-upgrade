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

1. Termina los cambios y sus pruebas de regresión. Si cambia un módulo embebido, ejecuta su builder correspondiente antes de guardar el commit. Un builder que «repare» un artefacto durante la validación es un fallo de la candidata, no una aprobación.
2. Comprueba la versión de los dos metadatos, `SCRIPT_VERSION`, las notas integradas y README cuando cambie el userscript distribuido. Un cambio exclusivo de herramientas/documentación puede conservar la versión y los bytes del Helper.
3. Guarda todos los archivos relevantes en un commit. No deben quedar cambios locales ni archivos nuevos fuera de Git. Esto evita probar silenciosamente una selección diferente de la que se va a publicar.
4. Ejecuta el gate completo, sin filtros de pruebas ni variables de sustitución de fuentes. Guarda el informe fuera del repositorio si necesitas conservarlo. Si algo falla, corrige, crea el nuevo commit final y vuelve a ejecutar el gate completo.

El reporte utiliza resúmenes estructurados por archivo y global del [test runner de Node.js](https://nodejs.org/docs/latest-v24.x/api/test.html#event-testsummary), en lugar de interpretar como éxito cualquier texto impreso por las pruebas. Identifica el commit, el árbol y los hashes exactos de los archivos probados. Los resultados solo son válidos para esos bytes. No reutilices un informe después de modificar fuentes, pruebas, builders o configuración de publicación.

## Qué verifica automáticamente

- Inventario recursivo de todas las entradas `*.test.cjs`, sin seleccionar solo las pruebas de la función modificada. Se rechazan entradas `*.test.js`, `*.test.mjs`, `*.test.ts`, `*.test.cts`, `*.test.mts`, `*.test.jsx` y `*.test.tsx` no soportadas para que no queden silenciosamente fuera de la suite. Node 24 puede ejecutar TypeScript, pero este gate solo admite `*.test.cjs`; añadir otro formato requiere integrarlo expresamente en el inventario y sus controles.
- Suite completa sin fallos, cancelaciones, pruebas omitidas, TODO ni resultados vacíos o incompletos. Un código de salida cero por sí solo no basta.
- Sintaxis de todos los archivos `*.js` y `*.cjs` del inventario, incluido el archivo de la prueba de navegador sin ejecutarla.
- Coherencia de los metadatos del userscript y del archivo `.meta.js`, `SCRIPT_VERSION` y la primera entrada de las notas integradas.
- Los cuatro builders en una copia temporal, dos pasadas; cada ejecución debe conservar los artefactos ya preparados. No se actualiza el checkout original para hacer que una prueba pase.
- Identidad del árbol de entrada y ausencia de cambios durante la ejecución. Se rechazan rutas enlazadas o entradas que puedan escapar de la copia.
- Informe explícito del alcance offline. Las pruebas de navegador quedan identificadas como no ejecutadas, nunca contadas como aprobadas.

Los archivos cacheados de Pages pueden conservar versiones anteriores si no han cambiado. Por ejemplo, en 1.15.1 `drive.js`, `sync-core.js` y `drive.css` llevan versiones diferentes. Revisar que un recurso modificado invalide correctamente su caché sigue formando parte de la revisión del diff.

## Lo que requiere revisión antes de publicar

Un resultado offline satisfactorio no significa «listo para publicar» por sí solo:

- Un revisor independiente debe estudiar el árbol final y las regresiones fuera de la función modificada. No basta con repetir el mismo test o sumar sus ejecuciones como casos distintos.
- La matriz debe cubrir los flujos afectados y su orden temporal: entrada de datos, validación, coordinación, interfaz y efectos. Cuando corresponda, incluir confirmación temprana/tardía/duplicada, timeout, rechazo, cero efectos demostrable, cambios de identidad, pausa/reanudación, reconexión, conflictos y clientes antiguos.
- Deben quedar explícitas las invariantes de identidad y frescura, la exclusión mientras hay una operación pendiente, la posibilidad de reintentar cuando procede y los mensajes que verá el usuario.
- Hay que distinguir pruebas sintéticas, visuales y de integración real. Un gap de navegador o servicio real no se convierte en una prueba aprobada. No se envían órdenes a una partida real para completar este gate.
- No se declara una causa definitiva del problema del usuario solo porque una simulación reproduzca el mismo mensaje.
- Si un revisor encuentra un fallo, se corrige y se repiten los checks pertinentes y el gate completo sobre el árbol final; el número de pruebas no justifica publicar un fallo conocido.

La [matriz de 1.15.1](1.15.1-validation-matrix.md) es un ejemplo de evidencia por flujo y límites, no una aprobación reutilizable de versiones futuras.

## Comprobar la distribución

El gate local no toca GitHub ni puede descartar trabajo concurrente por sí mismo. Antes de mover `main`, vuelve a leer su HEAD y conserva cualquier cambio ajeno. La publicación usa el árbol exacto probado y una actualización con lease, sin sobrescribir concurrencia.

Después, verifica el commit y árbol remotos, los metadatos y bytes del autoupdate y el resultado terminal de Pages para ese mismo commit. Comprueba también los archivos servidos que dependan del cambio. No anuncies distribución completada mientras estos pasos estén pendientes o fallen.

## Alcance y seguridad de la herramienta

Ejecuta el gate únicamente sobre código y pruebas de confianza: una copia temporal evita modificar accidentalmente los fuentes, pero no es una sandbox de seguridad para ejecutar código hostil. Las interrupciones o límites deben terminar los procesos descendientes del grupo normal de cada comando. Un cierre forzado con SIGKILL del propio gate o código que se separe deliberadamente del grupo no puede considerarse cubierto por esa limpieza. El gate no añade permisos del userscript, telemetría remota ni acceso a cuentas; tampoco ejecuta por su cuenta pruebas de navegador, OAuth, acciones de juego o publicaciones.
