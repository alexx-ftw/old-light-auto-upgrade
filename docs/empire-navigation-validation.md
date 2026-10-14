# Recorrido imperial guiado por trabajo disponible

## Alcance

El cambio añade un filtro consultivo antes de elegir el siguiente sistema. Reutiliza los planificadores de infraestructura, flota y edificios. No cambia esos motores, los mínimos, la reserva estricta para producir naves, el envío de pedidos ni sus barreras. Una previsión solo puede conservar u omitir una visita; nunca concede permiso para gastar.

El adaptador aporta costes, requisitos, colas, capacidad de colas y déficit de tesorería del mismo censo nativo que sus recursos y flotas. La revisión y su huella incluyen estos nuevos datos. No se crean conexiones, credenciales ni telemetría.

Cuando todos los sistemas habilitados están comprobablemente sin trabajo inmediato, el coordinador permanece en el seleccionado y sigue reevaluando en su ciclo habitual. Los umbrales de recursos se proyectan desde el censo; las revisiones nativas, la política y las misiones se releen. Los datos ausentes o incompatibles conservan el recorrido ordinario. La caducidad, desconexión y demás barreras existentes siguen deteniendo navegación y pedidos.

## Correcciones conservadoras

- Los muelles llenos liberan la reserva de flota del motor real. Como ese indicador HUD no está en el censo consultivo, una mejora de edificio lista conserva la visita aunque la previsión de una nave sin muelles llenos espere recursos. Esto puede añadir visitas, pero no cambia la orden que decidirá el motor real.
- La intención local de completar Depot puede perderse al atender otro sistema. Si esa continuación podría estar lista, no se excluye el sistema por la ausencia del único identificador retenido. No se inventa ni persiste una nueva intención económica.
- Una cola cuyo plazo nominal ya pasó conserva la visita hasta recibir la revisión nativa que confirma niveles, energía y precios. Tiempos, slots o energía desconocidos tampoco justifican excluirla.
- Un reintento activo con origen conocido por coordenadas y todavía sin UUID conserva la rotación normal hasta que su propio resolvedor lo identifica.
- La microtarea de selección relee la configuración antes de llamar al selector. Desactivar, excluir, cambiar rol/objetivos o perder lectura cancela el salto pendiente.
- Los sistemas atravesados durante una selección no consumen un turno útil de equidad. Solo se registra una llegada cuando termina la selección.

## Navegación visible

El selector nativo utiliza `next` y puede atravesar sistemas intermedios. Filtrar destinos reduce visitas sin trabajo y permite quedarse quieto cuando todo está al día; no convierte los cambios en navegación invisible ni garantiza reducir cada clic físico. Durante los pasos intermedios no se permite actuar. Se conservan las guardas de interacción manual, identidad, propiedad, petición pendiente y selección incierta.

## Evidencia automatizada

`tests/empire-navigation.test.cjs` usa las cuatro factories reales del userscript, el adaptador y el coordinador reales, además del callback instalado de misiones/reintentos. Cubre:

- Muelles desconocidos/llenos y edificio asequible; la reserva real de flota sigue siendo estricta cuando los muelles están libres.
- Continuación Depot después de Reactor y cambio de sistema.
- Umbral de recursos, costes imposibles, bloqueos/maxed, exclusiones, misiones y reintentos sin UUID.
- Identidad de censo, datos duplicados/futuros/incompletos, revisión contradictoria, caducidad, desconexión y reconexión.
- Colas de edificios y naves, pausa de cola y finalización nominal.
- Espera global sin trabajo, actualización que despierta un destino y actualización que cancela uno antes del salto.
- Cambios de configuración/lectura/pausa antes de la microtarea.
- Equidad entre destinos cuando el orden físico de `next` atraviesa un tercero.

Se reparan tres harnesses previos para cargar la nueva factory con sus dependencias o extraer el final real de la función; no se relajan sus assertions. La suite previa recupera 60 casos que antes quedaban ocultos tras errores de extracción de dos archivos.

`tests/empire-navigation-performance.test.cjs` comprueba 2, 10 y 50 sistemas con trabajo de edificios o flota: todos alcanzan los planificadores reales, sin fallback desconocido; el número de llamadas por sistema está acotado, y el filtro no añade lecturas de origen ni caché de permisos al segmento sintético del ciclo.

## Medición y gate final

`node benchmarks/empire-navigation.cjs` compara el mismo adaptador/core/runtime con el filtro omitido e instalado. Usa DTO completos, cuatro tránsitos externos por sistema y casos listos, esperando recursos, esperando cola y Depot/Reactor urgente. Registra update por ciclo, comprobación de acción, dos updates más lectura activa/comprobación y cambios de revisión. Sus assertions verifican destinos elegibles/ociosos exactos y ausencia de retornos desconocidos. El JSON identifica hashes de módulos y factories y detecta cambios durante la medición.

El informe de `node validate-release.cjs --report <archivo fuera del checkout>` identifica el commit limpio y los bytes finales, inventaría toda la suite y sintaxis y ejecuta dos pasadas idempotentes de los cuatro builders. La aprobación offline se refiere solo a ese informe y árbol; no debe reutilizarse tras modificar el parche.

Todas estas comprobaciones son sintéticas y offline. No prueban Brave/Violentmonkey, Google Drive, el coste total del Helper ni el recorrido en una sesión real. No se han enviado órdenes a una partida para validarlas. Este trabajo no publica ni incrementa la versión; debe integrarse con las publicaciones concurrentes antes de distribuirlo.
