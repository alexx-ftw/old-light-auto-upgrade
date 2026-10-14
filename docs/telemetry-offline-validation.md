# Telemetría compartida: preparación offline, 1.16.7

## Estado y alcance

Esta entrega NO integra todavía un proyecto activo de PostHog ni aplica la preferencia de activación al navegador del usuario. No se ha accedido a ese almacenamiento. Se dispone de autorización para la instalación del propietario, no del consentimiento de otras instalaciones públicas. No se reconoce al propietario por cuenta, jugador, credenciales o identificadores personales.

La lectura del conector se interrumpió por cancelación durante el descubrimiento de herramientas. No se verificaron organización/proyecto, región, configuración ni recepción remota. No se obtuvo o guardó ninguna clave, se creó acceso ni se emitieron datos sintéticos o reales. El conector describió un token público de ingestión como distinto de credenciales personales administrativas; no se utiliza ninguno en esta entrega. No se añaden permisos de red.

La base contiene la corrección local revisada `d2cad77d4c4caf7b4b598397da075b35f6e146b8`, árbol `6e47f48448bce07d8ae6ab11bf3e9c39c5c20691`. `docs/metrics-core.js` no se modifica. El consentimiento y la exportación locales conservan esquema y claves, sin convertirse en autorización de envío remoto.

## Contrato mínimo

- `docs/telemetry-core.js` es un módulo sin cliente de red, servidor, persistencia, SDK ni conocimiento de PostHog. `create` recibe configuración de destino previamente verificada por el integrador y un transporte inyectado. Una bandera en datos del juego o en almacenamiento público nunca debe usarse para verificar un destino.
- La integración pública `createTelemetry` pasa `destination: null, transport: null`. No configura adaptadores de consentimiento ni guarda preferencias. No hay método público del panel para proporcionar un proyecto o token. Se prueba que este camino no invoca red, almacenamiento privado o timers incluso con métricas locales activas.
- El adaptador futuro de consentimiento debe usar almacenamiento privado por instalación, separado de ajustes, copias, Drive y métricas locales. Debe leer/escribir sincrónicamente un registro `schema`, `policy`, `destinationId`, `enabled`, `generation`. Se comprueba el resultado persistido y se requiere generación criptográfica nueva para activar. Un error detiene la instancia hasta una nueva elección explícita.
- `record(name)` acepta solo las mismas 36 categorías locales. `duration('helper.step', milliseconds)` solo guarda recuentos en intervalos: menos de 1 ms, 1–4, 4–16, 16–50, 50–200, 200–1000 y al menos 1000 ms, con mediciones válidas hasta 60 segundos. No conserva cada duración.
- `snapshot()` entrega una copia del agregado pendiente: esquema, versión numérica, contadores e histograma. No incluye generación, destino, identidad, hora precisa, informes, contenido ni dimensiones arbitrarias. No hay datos de combate.
- `flush()` toma un único lote, lo retira de memoria y llama al transporte únicamente si destino, adaptadores y consentimiento coinciden. Comprueba de nuevo el permiso antes de invocarlo. No solapa envíos; cada instancia admite como máximo doce intentos por hora, separados cinco minutos. La cola tiene cardinalidad fija y los contadores saturan a un millón. El agregado está limitado a 8192 bytes.
- El transporte retorna `{accepted: true}` solamente para aceptación de transporte. Eso no demuestra ingestión del proveedor. Fallos, excepciones, respuestas ambiguas y timeout a ocho segundos se descartan sin reintentar. Datos nuevos podrán formar un lote posterior.
- La revocación purga colas y timers. Una solicitud pendiente comprueba el permiso cada 250 ms y se aborta al observar un cambio. Esto no puede retirar bytes ya entregados ni garantizar latencia con timers del navegador suspendidos. Cada nuevo envío vuelve a comprobar el permiso; una generación antigua no migra a una nueva. Un transporte que ignora abortar no bloquea el cierre de la operación.
- El panel muestra estado breve y detalles nativos plegados. El interruptor está deshabilitado sin destino. El proveedor futuro puede observar datos técnicos de conexión; no se afirma anonimato absoluto. Un opt-out no borra datos ya ingeridos.

## Referencia anterior

Una comprobación sobre el userscript de `d2cad77d4c4caf7b4b598397da075b35f6e146b8` que exige `function createTelemetry()` termina con exit 1. Es la ausencia esperada de la funcionalidad y del panel, no un defecto de privacidad de la base. Los tests nuevos comprueban el comportamiento del adaptador y, sobre todo, que la preparación pública continúa sin enviar nada.

## Integración y verificación

`build-metrics.cjs` incrusta ambos módulos de forma determinista. `createLocalMetrics` solo reenvía nombres de categoría al adaptador, nunca contenidos de las notificaciones. Su resultado local es independiente. El bucle mide duración únicamente si hay consentimiento remoto, usando un reloj monotónico y `finally`; con la integración desconfigurada ni siquiera consulta ese reloj.

`tests/telemetry-core.test.cjs` usa transporte, consentimiento, reloj y timers sintéticos. Comprueba configuración ausente, permisos separados, minimización, límites, lotes, fallos/timeout, revocación entre instancias, respuestas tardías, generaciones, escrituras ambiguas y copia independiente de snapshots. `tests/telemetry-integration.test.cjs` ejecuta funciones reales del userscript con DOM simulado: estado desconfigurado, cero tráfico/lecturas privadas, detalles repetidos, clics no fiables, independencia local, instrumentación y copia embebida. Los tests existentes de métricas se conservan; dos selectores de harness se ajustan a la firma opcional del wrapper y la fixture del builder reconoce el segundo módulo.

La suite y gate final deben ejecutarse sobre los bytes congelados, con revisión independiente. Los resultados y manifiestos se guardan fuera del repositorio. La validación del DOM simulado no equivale a validación visual ni a Brave/Violentmonkey, Google Drive o una partida real. Se intentó iniciar Chromium con una fixture local y red bloqueada, pero el entorno rechazó la creación de sockets; la ruta de ejecución ampliada también falló antes de abrir el navegador. No hay capturas ni QA visual ejecutada.

## Revisión adversa y corrección

La primera candidata `6dcb5a093f3e3c7baa5c019c3b86b4e9c609d518` superó ambos gates con 1690 pruebas, pero la revisión independiente encontró una raíz que la suite no cubría: `abort()` notifica listeners síncronos. Al desactivar se abortaba antes de cerrar el permiso de la instancia. Un callback podía añadir datos a la generación nueva o iniciar otro transporte durante la revocación. No era tráfico de producción: la integración continuaba desconfigurada y las reproducciones usan adaptadores sintéticos.

La corrección cierra el permiso antes de abortar y marca toda purga como sección que rechaza reentrada: no admite registro, activación ni nuevos envíos hasta terminar. También garantiza que una excepción del adaptador al abortar no impida resolver la operación, tanto por revocación como por timeout. Se conservaron los once probes independientes y se añadieron tres sobre rotación observada y cleanup excepcional en `tests/telemetry-revocation-review.test.cjs`. Los mismos 14 casos dieron 9 aprobados y 5 fallidos sobre el núcleo de `6dcb5a0`; la candidata corregida pasa los 14. Los gates de ese primer commit no acreditan el árbol corregido: se repiten con la revisión sobre el nuevo commit.

## Siguiente paso separado

Después de verificar el proyecto y su destino, revisar el protocolo del proveedor y conectar únicamente un token público de ingestión, nunca una clave administrativa. Cualquier creación/configuración de credenciales persistentes debe obtener la aprobación que corresponda. El primer envío será exclusivamente sintético y se distinguirá de estadísticas reales; verificarlo por lectura en el proyecto. La activación del propietario requiere acceso autorizado a su instalación o su intervención. Otras instalaciones conservan su propia elección explícita y revocable.
