# Rutas periódicas de refuerzos: diseño y validación (1.17.0)

## Base y alcance

Main se consultó mediante GitHub antes de editar: `1e6a310660d311751859d2e57d9a168c56c59d69`, árbol `927e728a1d7334bf7af837d7f7851a65d9a97a28` (1.16.7). La copia local parte del commit equivalente `364a3f83b2733d5b0b69887026f43affcd0d255a`, cuyo árbol se comprobó idéntico. La candidata anterior se conservó intacta.

Esta feature reúne naves mediante la acción nativa **Send**, nunca Attack. No crea sockets, no llama endpoints del juego ni automatiza una partida durante las pruebas. No añade permisos del gestor, telemetría o destinos externos. El juego advierte que automatizar infringe sus condiciones y puede ocasionar sanciones de cuenta; el trabajo técnico no elimina ese riesgo.

## Contratos y persistencia

- `reinforcement-core.js`: intención local por cuenta/galaxia, intervalos enteros 1–1440 minutos, cuatro tipos de naves, cantidades fijas o excedentes con reserva. Cuenta exclusivamente flota estacionada. Una cantidad fija espera a estar completa, sin envíos parciales.
- Los IDs `route:<ruta>:<secuencia>` y su ticket se verifican en almacenamiento **antes** de encolar. La cola existente persiste después su propio claim `sending` antes del clic. Escrituras fallidas no autorizan crear misión; fallos de almacenamiento no provocan un bucle de microtareas.
- El guard se ejecuta al elegir misión y en las fronteras del adaptador nativo, incluido su listener de captura de la confirmación. Relee ruta, ticket, cola, flota, reserva, identidad, propiedad y frescura. Cambiar cuenta, perder coordinación o cambiar generación/epoch invalida la autorización de un claim en curso.
- Un `sending` recuperado, resultado incierto, composición editada o ticket desaparecido detiene la ruta para revisión. No se generan ciclos para compensar el tiempo cerrado. El plazo siguiente empieza en `sentAt`; hace falta una observación posterior a esa confirmación.
- No sustituye una misión manual o campaña pendiente del mismo origen. Un traslado conocido de la misma ruta impide repetirla mientras sigue en vuelo; fuentes distintas pueden enviar al mismo destino. No se anticipan llegadas ni se suman naves en vuelo al stock.
- Las reservas son por origen y tipo. No se interpreta Resource Depot como capacidad de naves. La capacidad y otros impedimentos siguen comprobándose mediante los controles y errores nativos de confirmación.
- La configuración de rutas y su ledger de tickets no se sincronizan por Drive ni se incluyen en las copias existentes. Las misiones de refuerzo ya encoladas forman parte de `fleetMissions` y pueden aparecer en las copias generales. Restaurarlas conserva su pausa: en otra instalación no hay ruta local que autorice el envío; en la instalación original el core marca la ruta vinculada para revisión. Reanudar esa misión sin ruta no elude su guard. La exclusión mediante Web Locks protege pestañas del mismo navegador/origen; no es una coordinación entre dispositivos. Sin Web Locks, estas rutas no despachan ni navegan.

## Integración y controles

Con Imperio activo, los orígenes con trabajo útil se incorporan a su planificador; no se inicia un segundo selector. Sin Imperio, `reinforcement-runtime.js` toma el selector nativo verificado, cuya navegación puede pasar por sistemas intermedios. Cada salto revalida su ruta y permiso. La intervención humana, edición, pausa, cambio de cuenta o pérdida de liderazgo revoca los siguientes saltos. Un resultado de selección verdaderamente incierto pausa la ruta en vez de repetir el recorrido.

El panel vive en Flota → Misiones. Ctrl+pulsar/arrastrar/soltar propone un borrador; hay que revisar los extremos y flota y guardar explícitamente. No cambia la selección ni envía al realizar el gesto. Escape, blur, pérdida de Ctrl, pointercancel, salida del mapa o cuenta cambiada cancelan. Clic normal y Shift conservan su finalidad. Las flechas son elementos SVG sin captura de puntero. Pausar/borrar revoca una misión aún preparándose, pero no retira una flota que el juego ya aceptó.

Para una ruta que requiere revisión, comprueba los movimientos y utiliza «He revisado el envío». No se admite esta acción mientras el envío siga en curso. La revisión conserva la pausa y un intervalo conservador, exige censo nuevo y no reenvía el intento anterior. Después puedes reanudar o borrar la ruta. Borrar un envío en curso o ambiguo sin revisar se rechaza y conserva la ruta visible; eliminar no equivale a confirmar que no se envió.

## Evidencia pública del mapa

Se inspeccionaron los assets oficiales sin login:

- `https://oldlight.io/assets/galaxy-CqK10P8m.js`, SHA-256 `ba9c761ac00e7f513a58014a33574fbcfef1f4942ffc3b337ef606ea4ab0ccdc`.
- `https://oldlight.io/assets/transits-DloGaxtE.js`, SHA-256 `4d79f1bb4e9ca042385be2b49cea6c952d7c21d660de35e30b20b11ec5c11880`, HTTP 200 el 15 de octubre de 2026 UTC.

Galaxy importa `Y as N` (singleton de cámara) y `et as P` (axial→mundo). `transits` exporta `oe` como `Y`, instancia de `ae`; su método `project` recibe cámara X/Y, zoom y dimensiones CSS. La fórmula es perspectiva, no una transformación afín. Las posiciones de `.star-actions` están limitadas al viewport y no sirven para calibrar; `.star-hover` ofrece una posición exacta, pero solo un nombre y no basta para seguir la cámara continuamente. No se extrapolan flechas usando anclas obsoletas.

## Observador de cámara de esta versión

`reinforcement-map.js` espera a que la URL exacta del asset aparezca como recurso ya cargado (script o modulepreload), el documento haya terminado y existan los controles creados por el mapa nativo. Importa esa misma URL para recuperar el módulo ya evaluado. No intenta descubrir o ejecutar assets desconocidos. Si cambian sus exportaciones, descriptores o geometría, deja de observar y el panel no presenta posiciones viejas como válidas.

El hook afecta solo al método `project` de esa instancia, nunca al prototipo compartido. Conserva `this`, argumentos, resultado, mutación del parámetro `out` y excepciones; restaura el descriptor anterior únicamente si el método sigue siendo su propio wrapper. La observación no cambia la cámara. El camino caliente compara escalares sin consultar el DOM por proyección; las publicaciones quedan limitadas a una por frame y un heartbeat con la cámara quieta.

Un canal privado transporta solo el snapshot numérico de cámara/viewport y su generación de publicación. Un marcador separado invalida la observación anterior antes de la entrega diferida. La parte privilegiada rechaza mensajes desordenados, otra galaxia, dimensiones incoherentes y datos antiguos. La fórmula usa dimensiones CSS, no píxeles de backing-store: no duplica escala en DPR2. El hit-test invierte la perspectiva y hace cube-round axial como el juego antes de aceptar un sistema propio; no elige simplemente la estrella propia más cercana cuando se ha pulsado un hexágono vecino.

El panel configura este proveedor como autoridad exclusiva: al perderlo no recurre al hover antiguo. Puede ocultar flechas brevemente mientras espera un frame nuevo. Esto es una integración apoyada en un asset versionado y pruebas offline; la compatibilidad real con el navegador/gestor continúa pendiente.

## Matriz offline

- Core: reglas, reservas y límite nativo, almacenamiento, claims, recarga, reentrancia, dos instancias, revisión, reloj, scope/epoch/generación, permisos y tránsitos.
- Integración: módulo real `createFleetWaitQueue` con core real, aceptación de custom/send, intervalo tras confirmación, resultado incierto y pérdida de propiedad/reserva/permiso tras claim.
- Runtime: dueño exclusivo de navegación, ceder a Imperio, cancelación antes/durante saltos, pausa tras selección incierta y no repetición.
- Panel: creación/edición/pausa/borrado, validación, cambios de scope, callbacks tardíos, gestos cancelados, errores, SVG y rutas fuera del viewport.
- Regresión general: todos los tests previos, builders, sintaxis, metadatos y changelog. Las fixtures de funciones extraídas se amplían con los nuevos colaboradores nulos; no se eliminan sus aserciones anteriores.

El informe del gate final identifica el commit/árbol y recuentos exactos; no reutilices un resultado anterior si se editan fuentes o tests.

## Límites de verificación

No se realizaron misiones reales ni sesiones con Brave/Violentmonkey o Google Drive. El intento de Chromium local no pudo arrancar: `socket() Operation not permitted`; el entorno de ejecución alternativo devolvió un error de filesystem de sesiones de solo lectura. No se sorteó esa restricción. Por tanto, las pruebas DOM/Node no equivalen a validación visual ni a compatibilidad confirmada con el gestor real.

## Revisiones reproducidas durante la implementación

### SVG fuera del ShadowRoot y apertura del borrador

La primera implementación añadía el SVG de flechas a `document.body`, pero su CSS estaba dentro del ShadowRoot del Helper. Sin atributos propios, no se garantizaba `pointer-events:none` ni posición/pintura. Abrir un borrador mediante Ctrl tampoco llevaba al usuario a Flota/Misiones antes de enfocarlo.

El harness final ejecutó cuatro casos idénticos sobre una fuente anterior reconstruida mediante inversión exacta de los seis cambios correctivos y sobre la corrección: **0/4 antes, 4/4 después**. Esta fuente no es un commit histórico congelado; la reproducción demuestra las propiedades DOM omitidas en el prototipo, no una incidencia de 1.16.7. SHA-256 fuente anterior `1443bbf93aa5c2dddc83ceb4e50f3efe4d84a50d94ad526e4709fe5dd72265cf`, fuente corregida en ese momento `5916f90a63aeea7f32a4f58d1a2c2a919c7600c48b021f9043d137777377ea09`. El fallo causal obtuvo `position: undefined` en vez de `fixed`, y cero llamadas de apertura en vez de una.

La corrección aplica los estilos esenciales inline al SVG externo, atributos explícitos a líneas/flechas y apertura de la vista antes de enfocar, revalidando la cuenta tras el callback. Las pruebas conservan tanto estilos como orden temporal.

### Cámara invalidada no puede recuperar anclas viejas

Una cámara externa podía devolver `null` al invalidarse, pero el panel recuperaba posiciones hover previamente cacheadas. Se guardó la fuente anterior, SHA-256 `5916f90a63aeea7f32a4f58d1a2c2a919c7600c48b021f9043d137777377ea09`, y se ejecutaron los dos casos nuevos antes de editar: **0/2**, con overlay visible y borrador abierto pese a no haber una cámara válida. Tras la corrección, los mismos casos pasan. Si se proporciona un observador externo, su falta de proyección o hit-test es vinculante: no se recurre a anclas antiguas. El modo hover solo existe si no se configuró un proveedor externo.

Los árboles Git locales de las fixtures reproducidas son `d12b1284dca8915569267266b4fe2f07345a0e98` (overlay/onOpen reconstruido) y `cba20bbea208231ad3fdba83882b944833f37a5d` (fallback cámara), cada uno con el módulo y los tests idénticos usados en su comparación. Son snapshots de prototipos, no releases publicados.

### Aceptación perdida al pausar o editar antes de reconcile

La revisión independiente del commit `4c51b4ead7a8efa0a00e6d609c5a4709e51fcad0` encontró que `clearPending` trataba un job `sent` como otro pendiente cancelable. La secuencia `save → tick → sent → pause → resume → tick`, sin avanzar tiempo ni censo, borraba `sentAt` y encolaba una segunda flota. Editar la ruta podía causar lo mismo. El gate de ese commit había pasado 1.838 tests, pero no cubría este orden temporal y no se considera aprobación de publicación.

Se conservaron los bytes anteriores, SHA-256 `bd10a2a577a52bd53e97294648d7432563b6975b18b9628f54e125f0aaec8263`, idénticos al módulo de ese commit. Añadir cuatro probes al mismo harness antes de corregir dio **34 aprobados y 4 fallidos**. Cubren pausa/reanudación, edición reduciendo intervalo, borrado/recreación con otro ID tras recargar y fechas de aceptación inválidas. No son misiones reales: `sent` lo suministra una fixture.

La corrección conserva la aceptación y el plazo por origen, también cuando se borra o reemplaza una ruta. Un envío en curso o un resultado ambiguo no se convierte en permiso al borrar: la operación conserva una fila pausada/revisable y muestra el motivo. El control explícito «He revisado el envío» exige comprobar antes los movimientos; no activa ni reintenta y mantiene un plazo conservador y la obligación de obtener censo nuevo. Un `sending` vivo continúa bloqueándolo. El gate final debe ejecutarse de nuevo sobre el commit corregido.

Los recibos confirmados se almacenan localmente por origen (máximo 256), con migración de los envíos conocidos del esquema anterior. Cada ticket reserva capacidad antes de encolar. Sólo se podan tras vencer el plazo, observar un censo posterior del origen y no quedar tickets de ese origen. Los 52 tests del motor y los 158 tests conjuntos de refuerzos pasan en la corrección; el informe de release determina el resultado de la suite completa.
