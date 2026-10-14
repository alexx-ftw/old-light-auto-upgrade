# Old Light Auto Upgrade

Userscript para [Old Light](https://oldlight.io/play) que atiende primero el Resource Depot necesario y su Reactor, después da prioridad a la flota y reserva recursos para los mínimos de naves y muestra una ETA del siguiente pedido. También mejora edificios por prioridad, ajusta Reactor y Resource Depot según necesidad, muestra presets de flota con Shift + clic, permite esperar o producir las naves que falten para una misión, reintenta ataques fallidos con un Marauder más y envía avisos opcionales al navegador o Telegram, incluidos objetivos de nivel por estructura. Versión **1.16.5**, con gestión imperial coordinada y Drive sin ventana permanente, métricas locales opcionales de uso y errores y un changelog integrado. Mantiene la infraestructura necesaria antes que la flota. Retira automáticamente las misiones vinculadas al cancelar su campaña. Reintenta las interrupciones temporales, muestra su motivo concreto y funciona en las vistas estrechas Galaxy y Movements. Permite editar las flotas de misiones y campañas, con borradores guardados automáticamente. La versión cargada aparece en la cabecera del helper, también al minimizarlo.


## Pausa fiable durante el recorrido imperial (1.16.5)

**Pausar** revoca inmediatamente la selección imperial en curso, incluso si el siguiente ciclo del Helper ya está programado. **Reanudar** no revive los saltos pendientes de ese recorrido. El primer salto ya enviado permanece; tras revalidar el sistema actual, Imperio continúa con una decisión nueva. Ocultar la pestaña aplica la misma cancelación.

La pausa conocida ya no se confunde con una selección sin confirmar. Los fallos nativos genuinos siguen exigiendo revisión, y se conservan las suspensiones independientes, los pedidos pendientes y sus barreras de confirmación, la política guardada y las verificaciones de cuenta, sistema y censo. No añade permisos ni telemetría. La [matriz de pausa y reanudación](docs/global-pause-validation.md) distingue la reproducción offline de la comprobación pendiente en Brave/Violentmonkey y Drive.

## Reactor y recorrido con trabajo útil (1.16.4)

Reactor corrige un déficit actual de energía aunque no haya otra mejora asequible. Conserva su casilla, el orden efectivo, las colas y las reservas de flota y Depot. Imperio omite destinos comprobablemente sin trabajo inmediato y los reevalúa con los recursos, colas, política y censo actuales; los datos dudosos conservan el recorrido habitual. El selector nativo puede atravesar sistemas intermedios. Detener Imperio o cambiar su política revoca los siguientes saltos de la operación anterior, sin deshacer un salto ya enviado.

Flota muestra una línea breve de estado de producción y solo anuncia ahorro para una nave cuando los recursos y el bloqueo nativo lo confirman. Mantiene la prioridad estricta de la flota y la UI compacta de 1.16.3. La [matriz integrada](docs/1.16.4-validation-matrix.md) registra pruebas y límites. Es un candidato local: el número se debe revalidar frente a main antes de publicar. Brave/Violentmonkey y Drive real siguen pendientes; no hay permisos ni telemetría nuevos.

## Menos texto y navegación estable (1.16.3)

Flota mantiene **Mínimos, Campañas y Misiones** debajo de las pestañas principales, fuera del área desplazable. La ayuda de Flota e Imperio pasa a desplegables cerrados: quedan a la vista estado, cifras, objetivos y controles. El aviso de mínimos locales no aplicables incluye **Ver objetivos**, que abre Imperio sin activar ni cambiar ninguna política. Los detalles de cada rol están disponibles en **Qué hace este rol**.

Los objetivos imperiales conservan valores inválidos y guardados fallidos al salir del campo. Cada edición muestra su estado; el progreso sigue usando el objetivo guardado. Un cambio de cuenta/galaxia descarta la edición anterior, incluso con el panel oculto. Los cambios de política recibidos durante una edición se combinan al confirmarla, sin sustituir el borrador ni anunciar un guardado antiguo como actual.

Es un primer lote de claridad y navegación, no un rediseño completo. En la fixture de dos sistemas, la ayuda visible de Imperio baja de 145 a 41 palabras; la de Flota, de 42 a 17. Son recuentos de texto con ayuda cerrada, no mediciones visuales. Conserva 1.16.2, la frontera de teclado, avisos críticos y consentimientos. No cambia pedidos, censo, prioridades, Drive, permisos ni telemetría. La [matriz de 1.16.3](docs/ui-ux-validation.md) detalla reproducción, revisiones y los límites de QA: navegador real, Brave/Violentmonkey y Drive siguen pendientes.

## Objetivos de flota claros (1.16.2)

**Flota** identifica sus mínimos y la casilla de contar misiones como ajustes locales. Con Imperio activo aparece un aviso de que se sustituyen por los objetivos globales, que cuentan base, misiones, traslados y construcción una sola vez. Los mínimos locales guardados se conservan y vuelven a usarse cuando detienes Imperio.

**Imperio** muestra, por nave, el total verificado, el objetivo guardado y las unidades que faltan. Explica si los objetivos ya están cubiertos, no hay objetivos o faltan sistemas productores con **Atender** y rol **Equilibrado/Astillero**. Ese resumen es independiente de las pausas, barreras y errores operativos, que siguen visibles. Los borradores enfocados no se confunden con objetivos ya guardados; un censo parcial, de otra cuenta/galaxia, antiguo o no sincronizado no muestra cifras como verificadas.

No cambia el reparto, los roles, las guardas de pedidos ni la prioridad de recursos, colas, Depot/Reactor. No se añaden permisos, telemetría ni cambios de Drive. La explicación es compatible con las capturas recibidas, pero no demuestra la causa de aquella sesión. La [matriz de 1.16.2](docs/fleet-goal-feedback-validation.md) conserva la reproducción sobre 1.16.1 y los límites: pruebas offline con DOM sintético; sigue pendiente la comprobación real en Brave/Violentmonkey con Drive.

## Teclado dentro del Helper (1.16.1)

Los campos, botones y menús propios contienen `keydown` y `keypress` antes de que lleguen a los atajos globales del juego en fase burbuja. Esto corrige que escribir **G** en un nombre abra el mapa. No cancela la edición, composición, copiar/pegar, Tab ni activación con Enter. Las liberaciones `keyup` continúan al juego para evitar que quede retenido un movimiento iniciado antes de entrar al Helper; Escape conserva la cancelación del arrastre.

La frontera cubre las cuatro raíces Shadow y los dos diálogos propios, incluidos controles añadidos después. No intercepta los controles del juego ni puede deshacer un listener de captura que ya se ejecutó. Se ha verificado el modelo de atajos del bundle público conservado, no una sesión real de Brave/Violentmonkey. La [matriz de 1.16.1](docs/1.16.1-validation-matrix.md) distingue reproducción, pruebas y límites. El [gate de publicación](docs/release-validation.md) exige vincular feedback a regresiones que realmente se ejecuten; un recuento alto de pruebas no sustituye esa evidencia.

## Jugadores protegidos (1.16.0)

En **Flota → Jugadores protegidos** puedes guardar jugadores a los que el helper no debe enviar flotas. La lista empieza vacía, se guarda por cuenta y galaxia solo en este navegador y **no se incluye en copias ni en la sincronización Drive**. Una actualización no configura contactos personales ni altera listas de otras personas. Si cambias de navegador, debes configurarla allí también.

- Un ID de jugador se acepta solo si aparece en datos nativos recientes y, cuando proporcionas un nombre, ambos coinciden. El ID es la identidad estable; dos jugadores con el mismo nombre conservan entradas separadas. Añadir un nombre no elimina un ID ya protegido.
- Un nombre sin ID es una protección provisional. Bloquea coincidencias exactas normalizadas y pausa también los demás envíos hasta verificar el ID, para no perder protección si cambia de nombre. No convierte un nombre en una identidad fiable.
- Con una lista activa, un propietario desconocido, datos caducados, una sesión distinta, pérdida de conexión o datos de propiedad pendientes impiden el envío. El censo de terceros es parcial. Un cambio regional que no puede reconstruirse requiere una nueva inicialización nativa antes de continuar; no se abre otra conexión ni se inventa propiedad.
- Las comprobaciones se repiten al preparar y en el clic final de las misiones pendientes, campañas/reintentos y el envío inmediato de Shift + clic. Si cambia el propietario o la sesión durante la preparación, se pausa. Los destinos protegidos no se confirman automáticamente. Shift con varios orígenes queda bloqueado con protección activa porque no puede verificar un único origen.
- La lista no cancela flotas que ya están viajando ni controla acciones manuales del juego. Tampoco puede impedir que el destinatario cambie de dueño después del lanzamiento. Para la protección que el servidor vuelve a comprobar al llegar, utiliza el tratado bilateral del juego.

El juego no ofrece refuerzos militares amistosos ni defensa compartida. Una flota de combate enviada a otro jugador lo ataca, y tu sesión no puede ver ataques a terceros. Los regalos de recursos y los tratados son mecanismos distintos y no se ejecutan automáticamente con esta función. [Evidencia oficial, verificación de ID y límites](docs/ally-defense-evidence.md).

La integración conserva la cuenta atrás y las guardas de 1.15.2. Un cambio de cuenta o galaxia durante Shift bloquea la confirmación aunque la lista del nuevo contexto esté vacía. El formulario identifica explícitamente una lista sin configurar y no traslada un aviso de guardado de una cuenta a otra. La invalidación de observaciones usa solo cinco valores escalares; las ráfagas coalescidas no copian el censo de propietarios por cada evento, y las lecturas económicas no copian propiedad de terceros. Matriz, mediciones y límites en [validación de 1.16.0](docs/1.16.0-validation-matrix.md). El gesto Shift también revoca un salto imperial pendiente antes de abrir el atajo; sus eventos sintéticos no prolongan la pausa.


## Pausa por interacción y ayuda de roles (1.15.2)

Imperio muestra ahora cuántos segundos quedan de su pausa de interacción. Los clics, teclas, rueda y gestos táctiles en el juego vuelven a iniciar los 15 segundos; mover el puntero, dejar la página quieta o leer el panel no los renueva. La actualización usa el ciclo existente del Helper. En una pestaña visible, la reanudación se revisa en el siguiente ciclo después del plazo, siempre que el censo, la identidad, las colas y las otras guardas permitan continuar.

Se unifica la pausa del selector y del coordinador: interrumpir un cambio de sistema de forma conocida ya no se confunde con un selector fallido que exigía apagar y encender Imperio. Las interacciones dentro del Helper quedan fuera del contador de actividad del juego. Si estás editando un campo del Helper, el recorrido espera hasta que salgas de él; un cambio de sistema pendiente se revoca sin añadir una nueva espera de 15 segundos. Un fallo real de selección, una orden pendiente o una suspensión de seguridad siguen bloqueando.

Junto a cada selector de rol aparece una explicación de sus prioridades y de su participación en los objetivos de flota. Los roles reordenan prioridades sin excluir los demás edificios, conservan las marcas y las reglas de infraestructura y no crean patrullas, ataques ni transportes. No cambia la lógica de los roles, la sincronización ni los permisos.

Los defectos se reprodujeron en el flujo nativo con DOM y eventos simulados. La captura del usuario solo muestra la pausa temporal; no permite atribuir su sesión al bloqueo permanente encontrado durante la investigación. Alcance, matriz y límites en [validación de interacción y roles](docs/1.15.2-validation-matrix.md).

## Confirmación del censo y estados de Drive (1.15.1)

Antes de enviar cada pedido, Imperio captura una marca interna del censo validado. Al confirmar el pedido, usa esa referencia anterior para la barrera: rechaza observaciones anteriores al envío sin descartar la revisión nativa que acaba de confirmar la cola y el gasto. Corrige una espera innecesaria de otra revisión que podía dejar el panel en «0 de 2 sistemas» aunque el censo de confirmación ya estuviera disponible. Se mantienen identidad, propiedad, HUD y datos posteriores al envío como condiciones para otro pedido. La captura del usuario motivó el diagnóstico; su causa concreta todavía requiere confirmación. Alcance y pruebas en [validación de la barrera del censo](docs/empire-order-validation.md).

### Estados de sincronización más claros

Un ajuste pendiente ya no conserva el aviso **Drive sincronizado**. Esto incluye ediciones realizadas mientras terminaba la subida anterior: el aviso solo vuelve a sincronizado cuando el ciclo termina sin cambios posteriores pendientes. Los errores que requieren atención no se ocultan por editar otro ajuste.

Al desconectar desde el Helper con la ventana de gestión abierta, Drive explica que hay que abrirla de nuevo desde el Helper. Ya no promete recuperar automáticamente una conexión que se cerró deliberadamente. La recuperación temporal conserva su comportamiento anterior. No cambia la autorización de Google, la fusión de ajustes, los permisos ni las acciones del juego. Actualiza el Helper y reabre las ventanas de Drive para cargar los textos y estados nuevos.

Los fallos se reprodujeron con el motor real sobre DOM, almacenamiento y tráfico simulados, sin cuentas ni partidas reales. Alcance y comprobaciones en [validación de estados Drive](docs/drive-status-validation.md).

## Sincronización imperial y diagnósticos (1.15.0)

Drive comparte ahora los objetivos globales de flota, roles y **Atender** de cada sistema dentro de la misma cuenta y galaxia. La activación de Imperio permanece local en cada cliente: recibir una política no pone en marcha otro Helper. No se transfieren recursos, colas, órdenes, censo ni estado de ejecución.

**Al actualizar:** actualiza todos los Helpers que usen ese perfil, recarga el juego y cierra/reabre las ventanas de Drive antiguas. Los clientes anteriores rechazan los nuevos campos de forma íntegra para no sobrescribirlos. En **Datos → Google Drive**, conserva una conexión válida y la sincronización de preferencias activada; después cambia objetivos o roles en **Imperio**. No hay permisos nuevos ni cambios del Client ID o de OAuth. Esta actualización no corrige por sí sola una autorización de Google denegada o caducada.

El lector distingue actualizaciones sin estado inicial de un formato inválido. **Datos → Métricas locales** puede contar la apertura de Imperio y categorías fijas del lector, solo si activas esa medición. No registra payloads, cuentas, recursos, mensajes ni secretos; no envía telemetría remota ni sincroniza métricas. Se conservan las optimizaciones de rendimiento de 1.14.3. Alcance y pruebas en la [validación de 1.15.0](docs/empire-combined-validation.md).

## Rendimiento con Imperio activo (1.14.3)

Reduce trabajo repetido durante el recorrido imperial. Cada actualización y cada comprobación de permiso leen un único censo coherente, sin mantener una caché de permisos ni saltarse las lecturas previas a pedidos y navegación. La vista de flota ya no valida misiones si no hay una misión pendiente y evita una comprobación duplicada.

El panel reutiliza el formato de números, evita reescribir valores iguales y no calcula ni dibuja su resumen cuando está oculto. Al abrirlo vuelve a leer el estado actual, incluida su caducidad. Los cambios del juego se agrupan con un intervalo máximo de 50 ms mientras Imperio está activo, dejando tiempo al juego entre ciclos. La automatización habitual conserva su programación inmediata; los plazos de respuesta pueden detectarse hasta 50 ms después en modo imperial.

Las mejoras se miden con datos sintéticos y se prueban sin pedidos reales. El banco del panel con 50 sistemas pasó de aproximadamente 19,3 a 0,47 ms por render y de 555 a cero escrituras de texto cuando no cambia ningún dato; no representa una medición del navegador del usuario. La [validación](docs/empire-validation.md) detalla pruebas y límites. Tras actualizar y recargar, comprueba el comportamiento real antes de dejar Imperio funcionando. Esta corrección no añade permisos ni telemetría y no incluía la sincronización imperial incorporada después en 1.15.0.

## Diagnósticos imperiales (1.15.0)

La versión 1.15.0 integra los diagnósticos sobre la base de rendimiento 1.14.3. Un `world.delta` válido recibido antes del estado inicial se identifica como **falta de estado inicial**, sin marcarlo como formato inválido ni guardar su contenido. Un sobre malformado sigue rechazándose. El resumen del puente añade solo dos indicadores booleanos: conexión observada y censo completo. Ninguno concede permiso para pedidos.

Si activas **Datos → Métricas locales**, se cuenta también la apertura de Imperio y las transiciones de su lector entre categorías fijas: instalación fallida, conexión aún no observada, espera o falta de estado inicial, formato u observación rechazados, censo recibido, conexión perdida y datos incompletos. Repetir el mismo estado no incrementa el contador; volver a él después de otro sí. Activar la medición no recupera el historial previo. Siguen desactivadas inicialmente, sin datos del censo, identificadores de cuenta/sistema, tramas, errores crudos, credenciales ni telemetría remota.

El informe conserva únicamente la versión, días UTC y contadores de categorías fijas. Mantiene 30 días, con purga al registrar el próximo evento; desactivar borra los contadores y las otras pestañas dejan de escribir. No se incluye en Drive ni en las copias. No cambia permisos ni comportamiento de pedidos; conserva las optimizaciones de 1.14.3 y mantiene estas métricas fuera de la sincronización imperial. Las pruebas son sintéticas; no validan una partida real. La [validación de diagnósticos](docs/empire-diagnostics-validation.md) detalla alcance y resultados.

## Lectura nativa después del parseo (1.14.2)

Corrige una guarda excesiva de arranque: `document.readyState` indica el estado de carga del documento, no si el juego ya abrió su conexión. En particular, `interactive` puede preceder a la ejecución de los scripts de módulo. El lector ya no se descarta por encontrar `interactive` o `complete`, tanto al iniciar el Helper como al insertar el observador mediante GM_addElement.

La observación sigue siendo pasiva. Instalar el canal no concede permiso para pedidos: hace falta recibir y validar un `world.init` completo de la conexión observada, además de las comprobaciones de identidad, propiedad, selección y frescura. Los deltas sin ese estado inicial no fabrican un censo. No se recarga el juego, no se fuerza una reconexión ni se abre otro socket.

**Límite:** no descubre retroactivamente un socket que ya estaba abierto con sus callbacks registrados, ni recupera un estado inicial que nunca observó. Puede atender una conexión nativa futura o un estado inicial posterior en una conexión que sí observa. El texto del panel distingue un canal instalado esperando datos de una instalación fallida. No se añaden permisos; Drive y el permiso GM_addElement de 1.14.1 permanecen aislados.

Actualiza y recarga para cargar esta versión. Comprueba el censo en **Imperio**, todavía detenido. El defecto de la guarda está reproducido y cubierto por pruebas locales; **el resultado real en Brave/Violentmonkey aún requiere confirmación**. La sincronización de política imperial continúa fuera de esta corrección.

## Arranque del lector imperial (1.14.1)

La corrección añade únicamente el permiso **GM_addElement**, aprobado para insertar el observador de estado mediante la API de Violentmonkey. Es la vía documentada del gestor para scripts en páginas con CSP restrictiva. El Helper y Drive mantienen `@inject-into content`; el código insertado es estático y no recibe capacidades GM, credenciales, cookies ni acceso al motor de Drive. No se añaden conexiones externas.

Al actualizar, acepta el nuevo permiso si el gestor lo solicita y **recarga Old Light**. Después abre **Imperio** manteniéndolo detenido para comprobar que aparecen tus sistemas. El lector también reconoce la conexión si el juego había guardado antes el constructor nativo de WebSocket y todavía está registrando sus callbacks. No recupera un socket ya abierto cuyo estado inicial se perdió, ni abre otro para intentarlo.

El panel diferencia permiso no disponible, inserción fallida, arranque tardío, espera de conexión, falta del estado inicial, desconexión y datos inválidos. Ningún diagnóstico autoriza pedidos. El canal se entrega sobre un contenedor retirado del DOM, con escucha previa a la inserción y confirmación limitada a dos segundos; un fallo elimina el contenedor y deja Imperio bloqueado.

Se han probado el arranque, la CSP simulada, el constructor cacheado, el puerto entre contextos y las regresiones de Drive con fixtures locales. **No hay confirmación todavía del resultado en la partida real con Brave/Violentmonkey**. La [validación](docs/empire-validation.md) documenta la cobertura y la comprobación pendiente. La sincronización automática de objetivos y roles imperiales no forma parte de esta corrección.

## Sincronización imperial (1.15.0)

La sincronización automática de objetivos globales de flota, roles y **Atender** por sistema utiliza la conexión de Drive existente. Está integrada sobre 1.14.3, conservando los hotfixes del observador y las mejoras de rendimiento. Solo comparte la política de la misma cuenta y galaxia; el interruptor de activación global de Imperio permanece local.

La activación de Imperio sigue siendo local. No viajan recursos, órdenes ni ejecución. Las ediciones se combinan por nave y por campo/UUID; cambiar de cuenta o galaxia no mezcla políticas. Una configuración que aún no se ha cargado no borra preferencias remotas. Ante una aplicación fallida se recuperan los ajustes anteriores o se pausa con un aviso explícito si esa pausa no puede guardarse.

**Compatibilidad:** los clientes nuevos leen documentos antiguos, pero los antiguos rechazan los registros imperiales nuevos. Habrá que actualizar todos los Helpers del perfil y reabrir sus ventanas de Drive. No se necesitan nuevas autorizaciones de Google ni permisos del userscript. El hito independiente de sync pasó **1.168 pruebas** sobre datos y transporte simulados; el conjunto previo a la release pasó **1.181**; la validación del árbol de 1.15.0 se documenta en la [validación conjunta](docs/empire-combined-validation.md). Alcance, límites y pasos de publicación en [validación de sincronización imperial](docs/empire-sync-validation.md).

## Gestión imperial coordinada (1.14.0)

La pestaña **Imperio** reúne todos los sistemas propios de la cuenta y galaxia actuales. Muestra recursos y capacidad por sistema y agregados, energía libre, colas y flota. Los objetivos de Probe, Marauder, Sentinel y Vanguard son **totales del imperio**: el plan cuenta las naves en base, las pendientes de producción y todos los tránsitos propios una sola vez, incluidos los traslados internos. No suma capturas tomadas en momentos distintos para autorizar nuevos pedidos.

1. Actualiza el userscript y **recarga Old Light**. La observación debe iniciarse antes de que el juego abra su conexión habitual.
2. Abre **Imperio** y espera a que aparezcan tus sistemas con datos recientes. Si falta el estado nativo, el botón de activación permanece bloqueado; no hace falta configurar una API del juego. Desde 1.14.1 se solicita el permiso GM_addElement descrito arriba.
3. Establece los objetivos globales y el rol de cada sistema: **Equilibrado** conserva tu orden de edificios; **Industria** prioriza extractores; **Astillero** prioriza capacidad de construcción; **Defensa** prioriza Command Center e infraestructura. Solo Equilibrado y Astillero reciben producción adicional para cubrir el objetivo imperial. Defensa no añade ataques ni una estrategia militar automática.
4. Pulsa **Activar imperio** con el Helper en marcha. Recorre automáticamente los sistemas habilitados mediante el selector nativo y atiende cada uno por turno. Las colas del juego siguen trabajando en paralelo. **Atender** permite excluir un sistema de los pedidos, sin ocultar sus existencias del total.

Se mantienen separados el UUID de cada sistema, recursos, colas, observaciones y asignaciones. Antes de cada pedido se comprueban la identidad de cuenta/galaxia, propiedad, selección única, concordancia con el HUD y frescura del censo completo. Tras confirmar una orden se exige un nuevo censo antes de seguir. Una pérdida de conexión, datos parciales, cambio de propiedad, selección dudosa o cambio manual suspenden la ejecución. Las operaciones ya abiertas conservan su origen; el recorrido espera a que terminen. Tras un cambio de sistema que no se pueda confirmar, detener y volver a activar el modo es necesario para reintentarlo.

**Límites y uso:** viene desactivado. Funciona con una pestaña del juego abierta y visible; usa un solo dispositivo para ejecutar automatizaciones. No mueve recursos entre sistemas ni redistribuye naves estacionadas, y no sustituye las reglas de misiones/campañas existentes. Los totales de recursos son informativos: cada sistema gasta únicamente sus recursos. Los roles modifican el orden de edificios y el reparto de producción, manteniendo tus exclusiones, requisitos y protecciones de Reactor/Depot. La política imperial sustituye los mínimos locales mientras está activa; un objetivo cero no desmantela naves. Al detenerla vuelve el comportamiento habitual del sistema seleccionado.

**Configuración en la versión 1.14.0:** objetivos, roles y sistemas excluidos se guardan localmente por cuenta/galaxia. No viajan mediante la sincronización automática de preferencias de Drive; sí se incluyen en las copias completas. Restaurarlos exige la misma cuenta/galaxia y deja Imperio detenido para que revises la política antes de activarla. Los datos económicos y las observaciones del juego no se guardan como un historial ni se incluyen en esa copia.

**Aislamiento:** el Helper y Drive siguen en el contexto aislado del gestor. Un observador mínimo al inicio de la página recibe únicamente los eventos de estado necesarios de la conexión nativa existente. No abre una segunda conexión, no envía mensajes, no lee autenticación/cookies ni copia chat, tokens o tramas completas a registros. El puente usa un puerto privado, valida datos acotados y no da acceso al almacenamiento GM. El token de Google nunca pasa al contexto del juego. La seguridad presupone el código legítimo del juego; no pretende proteger una página íntegramente comprometida.

Implementación modular en `docs/empire-{core,runtime,panel,observer,adapter,bridge}.js`; tras editar ejecuta `node build-empire.cjs`. El diseño y las comprobaciones están en [validación de Imperio](docs/empire-validation.md), y las referencias del selector y del estado nativo en [evidencia técnica](docs/empire-native-evidence.md). La candidata pasa **990 pruebas automatizadas**, incluida revisión independiente de seguridad y regresiones. Las pruebas usan datos y DOM simulados, sin pedidos al juego real. **La compatibilidad visual y la inyección real con Brave/Violentmonkey aún requieren comprobación en navegador**; si la inyección no es posible, Imperio queda bloqueado y no inventa otra vía de órdenes.

## Drive sin ventana permanente (1.13.1)

En Brave con Violentmonkey, **Conectar Google Drive** abre la autorización de Google. Tras autorizar y confirmar que Violentmonkey ha aceptado guardar el token temporal, esa ventana se cierra y el motor de Drive continúa dentro del userscript. Recargar Old Light recupera la autorización mientras siga vigente; **Gestionar Google Drive** permite volver a consultar/restaurar copias o cambiar de cuenta. Cerrar esa ventana devuelve el trabajo al motor interno, sin mantener dos motores activos en la misma pestaña.

Se conserva únicamente un token de acceso temporal, su caducidad original, el Client ID y el identificador de cuenta necesario, en una clave privada separada del almacenamiento GM. **Desconectar**, retirar el permiso o cambiar el Client ID elimina la autorización local; una respuesta 401 o la caducidad también la invalida. Al recuperar una sesión se verifica la cuenta con Google antes de copiar o sincronizar. Si el navegador está cerrado o suspendido no puede ejecutar el borrado; al volver, rechaza y elimina el token vencido antes de utilizarlo. No se guarda un refresh token ni se obtiene una autorización nueva sin un clic.

**Privacidad:** el token de Drive no se incluye en las exportaciones, copias, sincronización, métricas o registros del Helper. El almacenamiento GM no es cifrado por el Helper: una exportación completa o sincronización del propio gestor de userscripts puede incluirlo. Desconecta Drive antes de compartir datos del gestor. Esta protección no puede controlar las copias de Violentmonkey o del perfil del navegador.

El userscript solicita ejecución aislada con `@inject-into content` y comprueba que Violentmonkey confirma ese contexto efectivo mediante `GM_info.injectInto`. Si el gestor no confirma el aislamiento o no ofrece `GM.setValue` asíncrono, conserva el modo de ventana/memoria y no activa el almacenamiento del token. La ventana de Google y el motor local reutilizan la misma implementación; las peticiones a Google omiten cookies y rechazan redirecciones. El secreto que enlaza la ventana permanece en la memoria aislada y en su fragmento inicial; nunca aparece en el almacenamiento/DOM del juego ni en el aviso público de conexión. Las credenciales solo pasan por el canal privado autenticado. No se añade un servidor ni un iframe de terceros.

**Límite real:** la sesión termina cuando Google caduca o revoca el token. Entonces hay que pulsar Conectar y autorizar de nuevo. La nueva versión evita mantener una ventana abierta, pero no ofrece renovación desatendida. La opción Recordar mi cuenta sigue controlando solamente la pista de correo para la siguiente autorización.

Para modificar el motor, edita `docs/drive.js` y ejecuta `node build-drive.cjs`; el bloque generado queda privado dentro del userscript. Verifica con `node --check docs/drive.js`, `node --check old-light-auto-upgrade.user.js` y `node --test tests/*.test.cjs`. Las pruebas usan ventanas, almacenamiento, relojes y respuestas de Google simulados; no acceden a Google ni al juego real. La candidata pasó **793 pruebas automatizadas**, incluidas **43 nuevas** para autorización local, y revisión independiente. La prueba real de Brave + Violentmonkey/OAuth sigue pendiente; no se presenta como validada en navegador.

## Changelog integrado (1.13.0)

Pulsa **Changelog** en el pie del helper, disponible desde cualquiera de sus cinco pestañas, para abrir **Datos → Changelog · novedades**. Muestra un resumen en español de las versiones 1.15.1, 1.15.0, 1.14.3, 1.14.2, 1.14.1, 1.14.0, 1.13.1, 1.13.0, 1.12.1, 1.12.0 y 1.11.0, basado en las secciones de este README, e identifica la versión instalada. Las notas se incluyen en el userscript y no necesitan una conexión adicional.

Puedes cerrarlo con **Cerrar changelog**, **Escape**, su cabecera desplegable o pulsando otra vez el acceso del pie. Al cambiar a otra pestaña se cierra; al volver o recargar no se abre automáticamente. El cierre conserva un foco de teclado visible. Se desplaza dentro del helper y adapta sus textos al ancho disponible, sin ventanas emergentes ni avisos de actualización repetidos. El estado abierto/cerrado no se guarda, no viaja por Drive y no cambia la automatización ni las preferencias de métricas.

## Métricas locales de uso y errores (1.13.0)

En **Datos → Métricas locales** puedes activar voluntariamente contadores de uso y resultados del helper. Vienen desactivados. Solo se registran nombres de funciones y categorías fijas: apertura de pestañas/subvistas, cambios de ajustes, copias, pedidos confirmados o fallidos, misiones y estados de sincronización. Los errores de ejecución se cuentan solo en el bucle del helper; no se recopilan los errores globales del juego.

El informe agrupa los contadores por día UTC y muestra los últimos 30 días, incluyendo el día actual. Los días más antiguos se purgan del almacenamiento al registrar el siguiente evento; cerrar el navegador impide ejecutar esa limpieza. Al cambiar de versión se reinician para no atribuir errores de otra release a la actual; se mantiene tu elección de activación. No incluyen nombres de jugadores, cuentas, coordenadas, recursos, mensajes, credenciales, URLs, trazas de error ni identificadores personales. **Ver informe** muestra el JSON exacto y **Exportar métricas** lo descarga para revisarlo y compartirlo manualmente. Desactivar borra los contadores; **Borrar y desactivar** los elimina y detiene la medición, sin cambiar los ajustes del juego.

Esta instrumentación es local: no transmite métricas a ningún servidor, no añade permisos y no se incluye en las copias ni en la sincronización de Drive. No proporciona todavía estadísticas agregadas entre usuarios. El consentimiento pertenece a este navegador, no viaja con una copia. Si el almacenamiento falla, la medición se detiene y se muestra el problema. Varias pestañas respetan la desactivación, pero escrituras exactamente simultáneas pueden perder un incremento: son métricas orientativas, no un registro contable.

El módulo se mantiene en `docs/metrics-core.js`. Después de modificarlo, ejecuta `node build-metrics.cjs`, `node --check old-light-auto-upgrade.user.js` y `node --test tests/*.test.cjs`. Las pruebas comprueban consentimiento, minimización, retención, fallos de almacenamiento y la igualdad entre fuente y módulo embebido.

Verificación de 1.13.0: **731 pruebas automatizadas**, incluidas 82 nuevas comprobaciones de métricas (68 de núcleo y 14 de integración) y 20 del changelog. Cubren consentimiento entre pestañas, revocación sin generador criptográfico, escrituras concurrentes, cambio de día UTC, retención, filtrado de datos privados, exportación y controles con DOM simulado. Las del changelog ejecutan los controladores reales de apertura, cierre, Escape, navegación de pestañas, acceso a Drive y minimizar/restaurar con un DOM simulado, además de comprobar las notas y sus referencias. La validación visual en navegador real no se pudo ejecutar en este entorno. No se enviaron acciones al juego ni datos de métricas a servicios externos.

## Depot necesario antes que la flota (1.12.1)

El Resource Depot marcado tiene prioridad sobre los mínimos de naves y el orden normal de edificios cuando cualquiera de los recursos alcanza el porcentaje configurado, o cuando su capacidad impide una mejora marcada y desbloqueada o una unidad de nave pendiente. Se comprueba el coste de **una nave**, no el del mínimo completo. No hace falta añadir un ajuste nuevo.

Si el Depot consumiría más energía libre de la disponible, se atiende primero su Reactor, también marcado. El Reactor puede comenzar aunque todavía falte reunir parte del coste del Depot. Durante esa secuencia se reservan los recursos: gastar en el Reactor no devuelve la prioridad a las naves por haber bajado el porcentaje de llenado. La prioridad de esta secuencia se conserva en memoria para el sistema activo, no se sincroniza; al recargar o cambiar de sistema se vuelven a evaluar las condiciones actuales.

La espera usa la **cola de edificios**, nunca la de naves. Una cola de naves ocupada durante horas no bloquea estas mejoras. No se repite un Reactor ni un Depot ya en cola. Una vez encolado el Depot, la flota recupera su prioridad habitual. Los edificios desmarcados siguen desmarcados; un requisito imposible o un bloqueo nativo se explica y no reserva indefinidamente todos los recursos.

**Siguiente acción** y la ejecución utilizan la misma decisión. La tarjeta muestra Reactor o Resource Depot y explica qué obliga a priorizarlo; en Flota aparece **Depot necesario primero**. Se mantienen los mínimos, las campañas, las misiones y los ajustes de Drive.

Verificación de 1.12.1: **629 pruebas automatizadas**, incluidas 28 regresiones de infraestructura, y **19 comprobaciones en Camoufox/Playwright** con una página de prueba aislada a 1200×920 y 390×844. El controlador real pasó por Reactor → espera sin pedidos duplicados → Depot → Sentinel ×12 al liberarse la cola de naves. Se comprobaron la previsión, las exclusiones, la interfaz sin desbordamiento horizontal y la ausencia de errores de consola. No se enviaron pedidos al juego real ni peticiones a Google. Comandos: `node --check old-light-auto-upgrade.user.js` y `node --test tests/*.test.cjs`.

## Interfaz por tareas (1.12.0)

**Flota** se divide en **Mínimos**, **Campañas** y **Misiones**, con contadores de pendientes. Campañas y misiones tienen filtros **Pendientes**, **Revisar** y **Todas**. Revisar incluye pausas, envíos sin confirmar, límites alcanzados y ediciones pendientes; Todas conserva el historial. Filtrar solo cambia lo que ves: nunca pausa, reanuda, cancela ni envía una operación. Las tarjetas de campaña siguen visibles cuando pliegas los ajustes de reintentos.

La cabecera identifica el sistema seleccionado. **Siguiente acción** aparece en Edificios y Mínimos, no ocupa espacio en las otras vistas. El pie mantiene un acceso directo al estado de Drive: diferencia conexión, autorización, cambios pendientes, sincronización, reintentos y errores. Solo una confirmación de sincronización muestra **Drive sincronizado**; una copia guardada no se presenta como sincronización. Pulsarlo abre Datos, donde Drive aparece antes que las copias manuales.

**Datos → Ventana del helper → Densidad** permite elegir Cómoda o Compacta. La subvista, los filtros y la densidad sobreviven a una recarga en este navegador, pero no se sincronizan ni modifican preferencias operativas. Las subvistas admiten flechas, Inicio y Fin; los paneles admiten foco de teclado. Hay estados vacíos explicativos y controles adaptados al ancho del propio helper y a pantallas táctiles. El botón de pausa aclara que afecta a mejoras y reposición, no cancela campañas o misiones.

Verificación de 1.12.0: 601 pruebas automatizadas y 57 comprobaciones de interfaz con Camoufox/Playwright en un escenario aislado (1280×900, 560×800, 390×844, 320×700 y 900×420). Incluye filtros con tarjetas del controlador real, navegación por teclado, autoguardado, persistencia tras recargar, minimizar/restaurar y ausencia de desbordamiento horizontal. No se enviaron acciones al juego ni peticiones a Google durante esas comprobaciones.

## Sincronización automática de ajustes (1.11.0)

**Datos → Google Drive → Sincronizar ajustes automáticamente entre dispositivos** viene activado. Actualiza todos los clientes, cierra la antigua ventana de Drive y ábrela de nuevo desde el helper. Usa la misma cuenta de Google, el mismo proyecto OAuth y la misma cuenta/galaxia de Old Light. Los cambios se envían tras 1,5 segundos sin nuevos cambios compartidos y se comprueban automáticamente cada 15 segundos mientras la conexión permanece activa. Los temporizadores pueden demorarse si el navegador suspende pestañas.

Se sincronizan prioridades y exclusiones de edificios, prioridades y mínimos de naves, recuento de naves fuera, umbral del Depot, presets, objetivos de nivel, pausa del helper, preferencias de reintentos/mínimos automáticos y preferencias de avisos, incluidos filtros, pausas y credenciales de Telegram. La fusión es por ajuste; ordenar edificios es una sola operación. Cambios simultáneos del mismo ajuste se resuelven de forma determinista con reloj lógico y escritor. Un navegador nuevo no trata sus valores antiguos como cambios recientes. Los cambios sin conexión se conservan localmente y los fallos temporales se reintentan con espera creciente.

**Esto sincroniza preferencias, no la ejecución distribuida de flotas.** Misiones, campañas en curso, envíos, informes procesados, confirmaciones y colas de notificaciones permanecen locales. No se importan ni reanudan desde el otro cliente. No proporciona exclusión mutua entre ordenadores: utiliza un único cliente para ejecutar campañas. El ancho, posición, pestaña abierta, despliegues de la interfaz y borradores tampoco viajan por la sincronización automática. Las copias completas siguen disponibles para restauraciones deliberadas.

La primera conexión sin datos de sincronización puede recuperar los ajustes compartidos de la copia compatible más reciente, sin importar sus misiones. Las copias históricas sin identificador de perfil se tratan como preferencias generales de esa cuenta de Drive. No se borran copias ni réplicas automáticamente.

**Conexión actual:** desde 1.13.1 no hace falta mantener la ventana de Drive abierta. El token temporal se conserva en el almacenamiento GM hasta caducar o desconectar; no hay renovación desatendida. La interfaz distingue conexión, cambios pendientes, sincronización y reintentos.

Pruebas: `node --test tests/*.test.cjs`. El núcleo compartido se incluye dentro del userscript, sin dependencias de red adicionales para ejecutarlo. Después de modificar `docs/sync-core.js`, ejecuta `node build-sync.cjs` y las pruebas.

## Validación para mantenedores

Antes de publicar una candidata, guarda el árbol final en un commit limpio y ejecuta `node validate-release.cjs`. El gate agrupa la suite offline completa, la sintaxis, la coherencia de versiones y dos pasadas reproducibles de los cuatro builders en una copia temporal. Rechaza pruebas omitidas y sustituciones de fuente; no repara silenciosamente el userscript ni publica nada.

El informe queda ligado a los hashes probados. La revisión independiente, la matriz de flujos afectados y las comprobaciones de concurrencia/autoupdate/Pages siguen siendo obligatorias. Las pruebas de navegador no ejecutadas se declaran como límite. Consulta el [procedimiento de validación y publicación](docs/release-validation.md).

## Instalación

1. Instala [Tampermonkey](https://www.tampermonkey.net/) o [Violentmonkey](https://violentmonkey.github.io/get-it/).
2. Abre **[Instalar o actualizar el userscript](https://raw.githubusercontent.com/alexx-ftw/old-light-auto-upgrade/main/old-light-auto-upgrade.user.js)** y confirma la instalación en el gestor.
3. Recarga Old Light y selecciona un sistema. En escritorio, abre **Structures** o **Shipyard**; en la vista estrecha también puedes permanecer en **Galaxy** o **Movements**.

Si el enlace muestra texto, utiliza la opción de instalar desde URL de tu gestor con ese mismo enlace.

**Si ya tienes la versión 1.0.0:** abre el enlace anterior una vez y acepta la actualización o sustitución del script existente. También puedes reemplazar su contenido en el editor del gestor. Esa primera instalación añade las direcciones necesarias para las futuras actualizaciones automáticas.

## Interfaz y navegación

El helper mantiene la cabecera y las cuatro pestañas accesibles mientras desplazas su contenido. La ventana conserva su altura al cambiar de pestaña. **Siguiente acción**, en Edificios y Mínimos, destaca la ETA, el próximo pedido y el motivo de espera; la fila de ese edificio o nave también queda resaltada.

| Pestaña | Contenido |
| --- | --- |
| **Edificios** | Prioridades, nivel construido y estado de cada estructura, condiciones de Reactor y Depot, objetivos de nivel. |
| **Flota** | Mínimos y orden de naves, cantidades en base, misión y cola, campañas y misiones pendientes con flota editable, y atajo de presets. |
| **Avisos** | Pausa global, tarjetas independientes de navegador y Telegram, filtros por evento y diagnóstico. |
| **Datos** | Exportar e importar, conexión y copias de Google Drive, ancho y posición de la ventana, métricas locales y changelog. |

Los controles de uso habitual aparecen primero. La conexión de Telegram, los límites de reintentos, la configuración avanzada de Drive y el diagnóstico se agrupan en secciones desplegables. Se recuerda cuáles dejas abiertas; las credenciales de Telegram comienzan accesibles si todavía falta configurar el canal. **Actividad del helper** muestra el estado detallado y la última solicitud. Los errores que requieren atención permanecen visibles fuera de los desplegables.

Puedes **mover** el helper arrastrando la cabecera y **minimizarlo** con **−**. La barra compacta conserva la versión, la pausa de automatización y la ETA. Para **cambiar el ancho**, arrastra el borde izquierdo o usa **Datos → Ventana del helper → Ancho**; admite de **300 a 560 px** y se adapta al espacio disponible. **Restablecer tamaño y posición** recupera el ancho de 360 px y la esquina inferior derecha. La posición, el ancho, la última pestaña, el estado minimizado y los desplegables se guardan localmente y viajan en las copias.

También se puede navegar con el teclado: **← / →**, **Inicio** y **Fin** cambian de pestaña cuando su botón tiene el foco. **↑ / ↓** sobre el asa de una prioridad la mueve, y los botones de flecha ofrecen la misma acción. En el borde de ancho, **← / →** ajustan 20 px e **Inicio / Fin** llevan a los límites; un doble clic restablece 360 px. **Escape** cancela un arrastre de ventana, ancho o prioridad. El foco se conserva mientras llegan actualizaciones del juego.

### Ventanas estrechas

Con **900 px de ancho o menos**, Old Light pasa a una navegación con **Star**, **Movements** y **Galaxy**. En estas dos últimas vistas oculta visualmente los paneles de construcción, pero sigue actualizando sus controles y datos. Desde **1.10.1**, el helper mantiene la lectura de niveles, ETA, producción, mejoras, misiones pendientes y observación de eventos en esas vistas. No necesita cambiar de pantalla ni abrir el menú de navegación.

La pestaña del navegador debe seguir visible y los datos del sistema deben estar cargados. Los controles deshabilitados, el astillero bloqueado, una pantalla de carga o error y la pausa del helper siguen deteniendo las acciones correspondientes. La detección de muelles llenos también funciona cuando la vista estrecha oculta el indicador de flota. Cambiar de ancho o de vista actualiza el helper automáticamente.

## Edificios y prioridades

El helper se activa por defecto. Abre la pestaña **Edificios** para elegir qué edificios mejorar y ajustar sus condiciones. **Arrastra el asa de cada fila**, con ratón o pantalla táctil, para ordenar las prioridades; también puedes usar **↑ / ↓**. El número **1** tiene la prioridad más alta. El orden se guarda y se aplica al siguiente pedido.

Fuera de la secuencia prioritaria del Depot necesario y su Reactor, el script elige el primer edificio marcado y disponible según ese orden. Si uno todavía no puede mejorarse, pasa al siguiente disponible. Las mejoras afectan a los sistemas seleccionados, igual que al pulsar manualmente los botones del juego.

### Reactor y Resource Depot

Estos edificios también deben estar marcados y poder construirse normalmente:

- **Reactor:** si está marcado, puede corregir un déficit energético actual (**energía < 0**) sin esperar a que otra mejora sea asequible. Con energía cero o positiva, sigue necesitando que otra mejora marcada y disponible consumiría más energía libre de la existente. Exige un aporte de energía positivo y confirmado. Mantiene el orden de edificios, los roles y las reservas de flota/Depot; no sustituye los recursos ni las guardas del juego. Para un Depot necesario, solo se adelanta si es su dependencia energética, aunque todavía falten recursos para el propio Depot. [Alcance y validación de la corrección](docs/reactor-deficit-validation.md).
- **Resource Depot:** se considera cuando **cualquiera de los dos recursos**, palladium o iridium, alcanza el **90 %** de su capacidad. Puedes cambiar ese porcentaje entre **1 y 100** en **Depot al alcanzar…**. También se prioriza por debajo de ese porcentaje si la capacidad bloquea una mejora marcada y desbloqueada o una unidad de nave pendiente.

Si ya hay una mejora de Reactor o Depot en cola, espera antes de encargar otra del mismo tipo. Los valores desconocidos o la selección múltiple no justifican estas mejoras automáticas: necesitan datos del sistema seleccionado.

### ETA del siguiente pedido

El indicador **Siguiente acción**, al principio de Edificios y Mínimos, muestra la **nave y cantidad** o el **edificio y nivel**, la **cuenta atrás aproximada** y el motivo de la espera. La cuenta atrás también se ve debajo de **Old Light** al minimizar el helper; al pasar el cursor aparece el detalle. No necesita activar ningún ajuste.

La ETA corresponde a cuándo se podrá **encolar el siguiente pedido automático de flota o mejora**. Una construcción que ya esté en curso puede continuar mientras se añade otro pedido si queda un hueco. El tiempo de construcción de la nave o del nuevo nivel es distinto y lo muestra el juego.

- Calcula cuánto falta de palladium e iridium y toma la mayor de las dos esperas según la producción actual. Usa las cantidades completas del juego aunque la interfaz muestre `K` o `M`.
- **La flota tiene prioridad sobre los edificios ordinarios, también mientras reúne recursos; el Depot necesario y su Reactor se atienden antes.** Si hay un mínimo o una producción autorizada de misión pendientes, muestra el primer tipo de nave pendiente que pueda producirse según el orden de Flota. Una nave de menor prioridad o un edificio ordinario más barato no consumen los recursos que está reservando.
- La ETA de una nave corresponde al **siguiente lote posible**. Si todavía no alcanza para una, calcula cuándo podrá encargar la primera; no espera a poder pagar todo el mínimo. El coste nativo mostrado para varias naves se divide por su cantidad para obtener el coste de una unidad.
- Si la cola está llena, espera también al primer hueco que se libere en la **cola correspondiente**, de naves o de edificios. Los recursos se producen durante esa espera: ambos tiempos se combinan por su máximo, no se suman. Una cola de naves detenida o sin tiempo conocido no genera una cuenta atrás inventada.
- Cuando la flota está cubierta o ya en construcción, pronostica la primera mejora que podrá hacerse con las prioridades y casillas marcadas actuales. Entre edificios, una mejora más barata puede estar disponible antes que la primera de la lista; si coinciden en tiempo, decide el orden de prioridad.
- Reactor aparece para corregir un déficit actual o si otra mejora marcada disponible lo justifica; para el Depot necesario puede anticiparse a que el propio Depot sea asequible, solo cuando este necesita energía. Depot se justifica por el porcentaje configurado, por una capacidad insuficiente o por completar la secuencia ya priorizada. Ninguno se repite si ya está en cola.
- Si una nave no puede producirse por un requisito, capacidad, muelles, tesorería o falta de producción, explica ese bloqueo. Puede continuar con otros pedidos posibles según las reglas de prioridad. Si faltan datos exactos, conserva la reserva de flota y muestra **Sin ETA**. La pausa y los pedidos pendientes también tienen su propio estado; durante la confirmación conserva el nombre de la nave solicitada.
- Mientras recupera los combates recientes necesarios para continuar, muestra **Comprobando…**. Si falla esa lectura, indica **En espera** y deja visible la causa; una mejora asequible no aparece como disponible mientras la recuperación bloquea los pedidos.

Se actualiza con los datos del juego y la comprobación habitual de cada segundo. La cuenta atrás continúa entre actualizaciones de las cantidades enteras del HUD; si llega a cero antes de que el juego habilite el pedido, espera su confirmación. El símbolo **≈** indica una estimación con las tasas actuales, que el juego redondea. Los pedidos, otros gastos, las naves que regresen, los recursos que lleguen y las construcciones que terminen pueden cambiarla; se recalcula al observar esos cambios. Funciona también si todos los edificios están desmarcados y solo mantienes mínimos de flota.

Requiere **un único sistema**, una pestaña visible y los datos de **Structures o Shipyard** cargados. En escritorio, deja uno de esos paneles abierto; en la vista estrecha también funciona desde **Galaxy o Movements**. La previsión usa los datos disponibles sin iniciar peticiones, modificar prioridades ni generar notificaciones. No se guarda una cuenta atrás antigua: al recargar se calcula de nuevo.

## Mínimos de naves

En la pestaña **Flota**, configura un mínimo para **Probe, Marauder, Sentinel y Vanguard**. Un mínimo de **0** desactiva la reposición de ese tipo. Ordena los tipos **arrastrando su asa** o con **↑ / ↓**. Cada fila muestra por separado las naves en **base**, **misión** y **cola**.

- Por defecto cuenta las naves **estacionadas en el sistema seleccionado**. Activa **Contar también las naves en misión** para incluir además las misiones que el juego atribuye a ese sistema.
- Siempre descuenta las naves **ya en construcción**. Por ejemplo, con un mínimo de **10**, **4** en la base y **3** en cola, encarga **3** más.
- Pide el déficit pendiente, limitado por la cantidad máxima que admite el juego y los recursos disponibles. Si el juego acepta solo una parte, lee la cola y los contadores actualizados antes de recalcular lo que falta.
- Los mismos mínimos se aplican a cada sistema cuando lo seleccionas. La reposición requiere **un único sistema seleccionado**. Con selección múltiple continúan las mejoras masivas de edificios, pero se suspende la reposición porque los contadores de naves muestran `—`.

**Flota tiene prioridad sobre los edificios ordinarios, después del Depot necesario y su Reactor.** Si la primera nave pendiente del orden puede producirse pero aún faltan recursos, el helper **reserva esos recursos** y espera. No los gasta en edificios ordinarios ni en tipos de nave de menor prioridad. También mantiene la reserva mientras espera un hueco normal en la cola de naves, salvo que haya que atender antes el Depot necesario y su Reactor. La ETA y los pedidos usan la misma selección de prioridad.

Por ejemplo: Probe con mínimo **2** y **3** en base, Marauder con mínimo **8**, **7** en base y **1** en construcción, Sentinel con mínimo **1** y **1** en base, y Vanguard con mínimo **1** y **0** disponibles. Sin un Depot necesario pendiente, el siguiente objetivo es **Vanguard ×1**. El Marauder en cola ya cubre su mínimo. El helper ahorra para Vanguard y retoma los edificios cuando los mínimos quedan cubiertos o ya en construcción.

Una nave bloqueada por requisitos, muelles llenos, tesorería, errores del juego, coste de una unidad superior al Depot o un recurso que falta y no se produce no retiene indefinidamente todos los pedidos. En esos casos puede continuar con otra nave posible o una mejora que cumpla las reglas de Edificios, e indica el motivo si muestra la ETA de esa mejora. No inventa recursos, capacidad ni tiempos de desbloqueo. Si el coste o la producción son desconocidos, espera datos exactos conservando la prioridad de flota.

Con el modo de naves estacionadas, enviar naves a una misión puede provocar su reposición; cuando regresen, el total puede superar el mínimo. Activa **Contar también las naves en misión** si quieres evitar esa reposición para las misiones contabilizadas por el juego. El script no cancela construcciones ni desguaza naves para reducir excedentes.

## Presets de flota con Shift + clic

Con tus sistemas de origen seleccionados, haz **Shift + clic** sobre un hexágono que contenga un sistema de destino. El helper muestra tus presets guardados **junto al menú circular del hexágono**, sin mostrar el panel de despacho.

**Un clic en un preset completo envía directamente la flota a ese destino**, mediante los controles nativos del juego. Si faltan naves, ofrece guardar una misión pendiente con las opciones de espera y producción descritas más abajo. El helper comprueba de nuevo el destino, los orígenes y las cantidades antes de confirmar una sola vez; los dobles clics no generan un segundo envío. Si el juego bloquea la orden o exige una decisión especial, como abandonar la protección inicial, muestra su diálogo. Puedes cerrar el menú con **Escape** o haciendo clic fuera.

Con varios sistemas de origen, el envío directo conserva el despacho por lotes del juego cuando todos pueden completar el preset. Si el rango de disponibilidad indica que a alguno le faltan naves, el helper muestra el despacho para revisión. Para programar producción y espera, selecciona un único origen. El resumen nativo muestra el resultado del lote.

El toggle de **Shift + clic** en **Flota** activa o desactiva el atajo y se guarda automáticamente. Está activado por defecto; al desactivarlo recuperas la multiselección nativa con Shift. Los clics sin ese modificador mantienen su funcionamiento normal. Los hexágonos vacíos no abren presets de un destino anterior. El selector sigue abierto cuando el mapa tarda en situar el menú circular o lo mueve unos píxeles.

Los presets se crean y se administran en el despacho del juego. El helper recuerda localmente sus cantidades para poder mostrarlos aunque te quedes sin ninguna nave y el juego desactive **Fleet**. Necesita haber leído esos presets al menos una vez con naves disponibles. Antes de cualquier envío vuelve a comprobar el preset en los controles actuales del juego.

### Si faltan naves para un preset

Al elegir un preset que no puedes completar, se muestran las cantidades necesarias, las naves en base, en misión y en construcción. Puedes marcar dos opciones independientes:

- **Producir las naves que faltan:** autoriza al helper a encargar el déficit real cuando lo permitan el astillero y los recursos. Descuenta las naves en base, en misión y ya en construcción. Está desactivado inicialmente.
- **Enviar automáticamente cuando el preset esté completo:** espera hasta reunir **todas** las cantidades en la base y envía una sola misión al destino elegido. Puedes activarlo sin producir, para esperar al regreso de otras misiones. Está marcado inicialmente; sólo se programa cuando pulsas **Guardar misión pendiente**.

Por ejemplo, un preset de **4 Probe + 2 Marauder**, con **1 Probe en base**, **2 Probe en misión** y **1 Marauder en construcción**, necesita producir **1 Probe + 1 Marauder**. El envío espera a tener los **4 Probe y 2 Marauder en base**. Si las que ya existen bastan para completar el preset, la producción pendiente es cero.

En **Flota → Misiones pendientes** puedes cambiar ambas opciones, pausar, reanudar o cancelar la espera. Cancelar retira la misión del helper; las naves que el juego ya haya aceptado construir siguen en su cola. Si sólo activas producción, el encargo termina cuando reúne la flota y queda preparado para envío manual. No modifica tus mínimos permanentes ni los suma al déficit: utiliza la cantidad mayor de ambos objetivos cuando coinciden.

Cada misión queda vinculada a la **cuenta, galaxia, sistema de origen y coordenadas exactas del destino**. Esta función requiere un **único origen seleccionado** y admite una misión pendiente por origen. Selecciona ese origen, mantén el helper activo y deja la pestaña del navegador visible. En escritorio, abre **Structures o Shipyard**; en la vista estrecha puedes permanecer en **Galaxy o Movements**. Si cambias de sistema, la misión espera a que vuelvas. Los despachos inmediatos completos siguen admitiendo el comportamiento nativo por lotes.

Las misiones pendientes se guardan localmente. Tras recargar, el helper puede recuperar el destino mediante los controles del mapa y comprobar de nuevo la ruta antes de enviar; esa recuperación puede desplazar la vista del mapa. Si haces clic, escribes, desplazas la página, cambias de vista o aparece otro diálogo antes del envío, la misión vuelve a **esperar**. Se reintenta automáticamente cuando el origen y el helper estén disponibles y los diálogos o menús que bloqueaban la preparación se hayan cerrado. Después de una interacción espera al menos **1,5 segundos** sin nuevas interacciones. Las demoras de carga del mapa también se reintentan.

Si cambian las coordenadas verificadas, la ruta, el tipo de misión o el preset, o el juego rechaza la preparación, la misión queda **pausada para revisión**, con el motivo visible tanto en la misión como en su campaña. También puedes reconectarla seleccionando el mismo destino y preset con **Shift + clic**. Las misiones y campañas que ya estaban pausadas antes de actualizar conservan su pausa: pulsa **Reanudar** una vez para continuar las que quieras ejecutar. La actualización recupera el motivo de la misión cuando una campaña antigua mostraba solamente «La misión pendiente está en pausa».

Si un envío queda **sin confirmar**, se detiene y no se repite automáticamente. Comprueba los movimientos del juego antes de usar la opción explícita de reanudación. Las copias locales y de Drive incluyen estas misiones y los presets recordados; **importar una copia deja las misiones pendientes en pausa** para revisarlas antes de reanudar.

### Cambiar la flota de una misión o campaña

En **Flota**, pulsa **Editar flota** en una misión pendiente o en la tarjeta de una campaña. El editor muestra **Probe, Marauder, Sentinel y Vanguard**, con un campo independiente para cada tipo y sus cantidades en base, en misión y en cola. **0 excluye ese tipo del envío**; el máximo es **50.000 por tipo**.

Por ejemplo, una campaña que prepara **9 Marauder + 1 Vanguard** puede cambiarse a **9 Marauder** poniendo Vanguard a **0**. Al pulsar **Listo**, la campaña y su misión vinculada muestran la nueva composición y dejan de esperar ese Vanguard. También puedes añadir tipos o aumentar sus cantidades: el helper recalcula las naves que faltan, descontando las existentes y las que están en construcción.

- **Cada cambio se guarda al escribir.** Abrir el editor deja esa misión o campaña en espera, incluida su producción pendiente, hasta terminar la edición. Los campos vacíos o inválidos se conservan como borrador y nunca se usan para enviar una flota parcial.
- **Listo** valida y aplica la composición completa. Después retoma la producción o el envío que estuvieran autorizados y espera a reunir todas las naves en base. Si la misión, campaña o automatización ya estaban pausadas, conserva esa pausa.
- **Cerrar o Escape** conserva el borrador y la espera, también tras recargar la página. Usa **Continuar edición** para retomarlo. **Descartar edición** recupera la composición anterior.
- La campaña y la misión vinculada comparten la misma edición: puedes abrirla desde cualquiera de las dos tarjetas. Los mínimos permanentes y los presets guardados del juego conservan sus valores. Las construcciones que el juego ya haya aceptado continúan en su cola.
- Una misión debe contener al menos una nave. Las campañas de reintento necesitan al menos un **Marauder o Sentinel**. Solo se editan órdenes pendientes; un envío iniciado, sin confirmar o a la espera de su informe conserva la flota que se envió.

Las misiones editadas mantienen su destino y la acción nativa **Attack** o **Send**. Antes del envío se comprueban otra vez el origen, las coordenadas, el tipo de misión y las cantidades exactas. Los cambios desde otra pestaña o un fallo de guardado mantienen el envío detenido y ofrecen recargar los valores guardados. Los borradores se incluyen en las copias; al importar, las misiones y campañas siguen en pausa. Editar la composición no genera notificaciones de ajustes.

## Reintentar ataques fallidos

En **Flota → Tras una derrota**, activa **Reintentar ataques**. Viene **desactivado**. Al activarlo empieza a observar informes posteriores a ese momento; instalarlo no vuelve a atacar objetivos de informes antiguos.

Después de una **derrota ofensiva explícita**, prepara otro ataque desde el mismo sistema y hacia las mismas coordenadas, con **un Marauder más que la flota enviada**. Conserva las cantidades de los demás tipos de nave. Por ejemplo:

| Resultado observado | Siguiente ataque |
| --- | --- |
| Derrota con 7 Marauder | 8 Marauder |
| Derrota del reintento con 8 Marauder | 9 Marauder |
| Victoria o captura | Finaliza los reintentos de esa campaña |

El incremento se aplica a la flota completa que se enviará. Si se perdieron los 7 Marauder del ejemplo, necesita reunir **8**, contando los que ya tengas disponibles, en misión o en construcción. No basta con construir uno para reemplazar toda la flota perdida.

- **Producir las naves que falten**, dentro de **Preparación y límites**, está marcado inicialmente. Reutiliza la cola de misiones pendientes y descuenta naves en base, en misión y en construcción. Si desmarcas la opción, espera a reunir las cantidades sin encargar producción para ese reintento. La opción se aplica a los nuevos reintentos; para detener uno ya preparado, pausa o cancela su campaña.
- **Espera a la flota completa en base** antes de enviar. Por ejemplo, para 8 Marauder, con 2 en base, 3 en misión y 1 en construcción, necesita producir 2 y esperar a reunir los 8. Esta producción mantiene la prioridad de Flota sobre Edificios y respeta el orden de tipos de nave configurado.
- **Máximo de reintentos:** por defecto, **3 por campaña**, además del ataque original. **0** permite continuar sin ese límite. Se cuentan los envíos confirmados. Reducir el máximo detiene un reintento pendiente que exceda el nuevo límite.
- Cada campaña muestra el objetivo, origen, cantidades, estado, motivo de espera o pausa y número de reintentos enviados. Conserva la explicación de su misión vinculada para que puedas ver qué condición falta. Puedes **Editar flota** mientras el ataque esté pendiente, **Pausar**, **Reanudar** o **Cancelar campaña**. Si el ataque editado vuelve a perder, el siguiente incremento de **+1 Marauder** parte de la composición que realmente se envió. Desactivar la función pausa sus ataques pendientes; las construcciones o misiones ya aceptadas por el juego continúan.

**Cancelar campaña también retira sus misiones del helper**, incluidas las pausadas y los registros de envíos confirmados o pendientes de revisión. El vínculo se conserva entre reintentos y recargas. Si la preparación o confirmación de un envío está en curso, se cancela la campaña inmediatamente y se retira el registro cuando el adaptador termina; mientras tanto se muestra el motivo y **Quitar** espera a que concluya la limpieza. Funciona también con los reintentos o el helper desactivados. Las flotas que el juego ya haya enviado continúan su misión y las construcciones ya aceptadas siguen en su cola.

La limpieza afecta únicamente a las misiones vinculadas a esa campaña. Al cargar también se retiran las que sigan asociadas a campañas ya canceladas. Si una versión antigua perdió por completo ese vínculo, el registro debe quitarse manualmente. La importación y la restauración de copias terminan de recuperar ambas listas antes de limpiar las campañas canceladas.

La función verifica la cuenta, galaxia, origen y coordenadas exactas. Requiere tener seleccionado el sistema de origen, el helper activo, la pestaña visible y **Structures o Shipyard** abierto en escritorio; en la vista estrecha también funciona desde **Galaxy o Movements**. La comprobación del destino puede mover la vista del mapa. Si hay otra misión pendiente de ese origen, espera su turno sin reemplazarla. Los reintentos utilizan las cantidades del ataque y no crean ni cambian presets guardados del juego.

Solo escala derrotas confirmadas de tus ataques con flota ofensiva conocida. No convierte sondeos, defensas, un botín vacío ni pérdidas de texto sin resultado en órdenes de ataque. Un empate pausa la campaña; un informe incompatible o un envío sin confirmar exige revisión y no provoca un nuevo envío automático. Antes de confirmar, vuelve a comprobar que el objetivo admite **Attack**, que la ruta y las cantidades coinciden y que la campaña continúa autorizada.

El seguimiento usa el identificador único de cada informe y conserva su estado entre recargas. Para relacionar un resultado con el reintento utiliza origen, destino, cantidades y fecha posterior al envío confirmado: la interfaz de informes no proporciona un vínculo fiable con el identificador de la misión. Evita mezclar ataques manuales idénticos hacia la misma ruta mientras una campaña espera resultado; un informe incompatible detiene la campaña para revisión.

Funciona también con Telegram y las notificaciones del navegador desactivados. Si quieres avisos, activa **Avisos → Tipos de notificación → Reintentos de ataque** y el canal correspondiente. Los cambios de estos ajustes no generan notificaciones. Los ajustes, borradores y campañas se guardan automáticamente y se incluyen en las copias locales y de Drive; **importar una copia desactiva los reintentos y pausa sus campañas**.

### Aumentar automáticamente los mínimos de naves

En **Flota → Tras una derrota**, la opción **Aumentar mínimos de flota** ajusta los mínimos a la flota del ataque perdido con **+1 Marauder**. Conserva las cantidades de los otros tipos de nave y nunca reduce un mínimo que ya sea mayor.

| Último ataque fallido | Mínimos actuales | Mínimos resultantes |
| --- | --- | --- |
| 8 Marauder | 8 Marauder | 9 Marauder |
| 8 Marauder | 12 Marauder | 12 Marauder |
| 8 Marauder y 2 Sentinel | 5 Marauder y 1 Sentinel | 9 Marauder y 2 Sentinel |

Viene desactivada y es **independiente del reenvío automático**: puedes mantener la flota preparada y enviar las misiones manualmente. Empieza con los combates posteriores a su activación. Solo admite derrotas ofensivas confirmadas con cantidades conocidas; sondeos, defensas e informes incompletos no suben los mínimos.

Si se recuperan varios informes juntos, usa la última derrota de la cuenta, aunque después haya una victoria en ese destino. Una derrota nueva con cantidades desconocidas deja sin efecto una propuesta anterior pendiente. Los informes más antiguos o repetidos no sustituyen el resultado más reciente.

Los mínimos siguen siendo los ajustes compartidos del helper que se aplican al sistema seleccionado. Se respetan el orden de prioridades de naves, el modo de contar las naves en misión y la pausa general de producción. El cambio se guarda automáticamente, se refleja en los campos de mínimos y se incluye en las copias locales y de Drive. Importar una copia desactiva esta automatización para que puedas revisar sus ajustes.

Si estás editando un mínimo que habría que aumentar, el helper conserva tu borrador y deja la actualización pendiente hasta que termines. Releer el mismo informe, recargar o reintentar un guardado no vuelve a subir un mínimo que hayas cambiado manualmente después. Desactivar la opción cancela los cambios automáticos pendientes y conserva los mínimos que ya se hayan aplicado.

### Recuperación de reintentos en 1.7.1

Corrige informes que podían aparecer correctamente en Telegram y no llegar al reintento: la fecha de la lista y la del detalle no tienen que coincidir, y una cantidad numérica exacta puede omitir el indicador `kind`. Se siguen exigiendo el mismo identificador de informe, coordenadas exactas y una flota ofensiva conocida.

Si la función **ya estaba activada antes del combate**, la actualización vuelve a comprobar hasta **20 combates recientes**, recorriendo como máximo **5 páginas** de la lista. Incluye informes ya notificados, conserva la fecha de activación y guarda el progreso por cuenta y galaxia. **No vuelve a enviar sus reportes a Telegram o al navegador**; sí puede avisar de un reintento que acaba de preparar.

Para recuperar solo considera el resultado más reciente de cada ruta. Una victoria, captura, empate o resultado que requiera revisión impide revivir una derrota anterior. El historial que quede fuera de esa ventana no inicia ataques durante la recuperación. Las campañas canceladas, terminadas o detenidas por su límite permanecen detenidas. Una campaña que necesita revisión conserva ese estado tras recargar.

Mientras comprueba un lote de resultados, espera antes de gastar recursos o enviar una misión pendiente. Un fallo de lectura o guardado deja la recuperación pendiente, muestra la causa y reintenta después. Si falta información para decidir un ataque, **Flota → Tras una derrota** muestra una explicación.

Ejemplo: tras perder **8 Marauder**, el nuevo objetivo es **9**. Con **8 en base**, encarga **1**; con **0 en base, 0 en misión y 0 en construcción**, necesita producir **9**. El mínimo permanente de 8 no limita la cantidad del reintento, y el envío espera a tener los 9 en base. Se conserva el orden de prioridades de naves configurado.

Si los reintentos estaban desactivados cuando llegó el informe, activarlos ahora comienza con los combates nuevos. Desactivarlos y activarlos otra vez cambia la fecha de inicio; no es necesario hacerlo para aplicar esta corrección.

## Notificaciones

La pestaña **Avisos** reúne los canales y los filtros de notificaciones. Los dos canales son independientes y están **desactivados por defecto**:

- **Navegador:** pulsa **Permitir avisos del navegador**. Solo ese botón solicita permiso; al concederlo se activa el canal. Después puedes controlarlo con el interruptor **Navegador**.
- **Telegram:** abre **Configurar Telegram**, introduce el **token de tu bot** y el **Chat ID** y activa el interruptor **Telegram**. Los cambios se guardan automáticamente; no hay botón Guardar. **Enviar prueba a Telegram** envía una prueba al chat guardado, independientemente de los filtros y sin necesidad de activar el canal. La prueba respeta la pausa global y la de Telegram; también se bloquea mientras quedan credenciales incompletas en edición.

El token y el Chat ID se guardan en el almacenamiento del gestor de userscripts, mediante GM, fuera del archivo publicado. Cada pulsación guarda un borrador privado; cuando el par de credenciales es válido, se aplica tras **400 ms** sin cambios o al salir del campo. Mientras está incompleto, se conserva la conexión anterior. Los campos vacíos conservan lo guardado. Al recargar, se recuperan los borradores pendientes, sin rellenar los campos con las credenciales activas. **Borrar credenciales de Telegram** elimina tanto las credenciales como los borradores y desactiva el canal.

En **Tipos de notificación** puedes activar o desactivar individualmente los **20 tipos**, agrupados en **Actividad**, **Problemas** y **Ajustes del helper**, o usar **Todos / Ninguno**. Los mismos filtros se aplican a ambos canales que tengas habilitados:

- **Activados por defecto:** solicitudes, confirmaciones de edificios y naves, edificios terminados, objetivos de nivel alcanzados, cambios de flota, reintentos de ataque, avisos emergentes del juego, informes nuevos con su contenido y aumentos de mensajes sin leer, errores, pedidos rechazados o sin confirmar y **pausas automáticas**.
- **Desactivados por defecto:** cambios de edificios marcados, mínimos de naves, modo de contar naves, prioridades, umbral del depósito y **pausa o reanudación manual**.

Cada aviso muestra una sola marca **Old Light**, un encabezado con el icono y tipo de evento, el sistema cuando se puede identificar y el detalle separado. Los cambios de vista del helper no envían avisos. Un cambio de flota se comunica como tal; por sí solo no demuestra que haya terminado una construcción. Los mensajes privados del juego se anuncian por su contador; su contenido no se descarga.

Cada canal tiene su propia cola de avisos **en memoria**, que no se conserva al recargar o cerrar la pestaña. Telegram separa los envíos al menos **3,1 segundos** y, si pide esperar por exceso de solicitudes, respeta ese plazo antes de reintentar. El panel muestra el estado de cada canal.

### Pausar y reanudar los avisos

En **Avisos**, pulsa **Pausar todos los avisos** para detener temporalmente las notificaciones de ambos canales. El botón cambia a **Reanudar avisos**. Las tarjetas **Navegador** y **Telegram** tienen sus propios botones **Pausar / Reanudar** y muestran el estado de cada canal.

Las pausas son independientes de los interruptores de activación, los filtros y las credenciales. Por ejemplo, si pausas Telegram y después pausas todos los avisos, **reanudar la pausa global deja Telegram pausado**. Reanudar un canal durante la pausa global lo deja preparado para cuando reanudes los avisos globales. Un canal desactivado sigue desactivado.

Se descartan los avisos pendientes del canal que pausas y los eventos detectados mientras está pausado, para que al reanudar recibas los nuevos avisos. Una notificación que ya se haya entregado no se puede retirar. La pausa global y las de cada canal se guardan al pulsar el botón, se sincronizan entre las pestañas y se incluyen en la exportación, importación y copias de Drive.

**La automatización continúa:** estas pausas solo controlan las notificaciones; las mejoras, la reposición de flota, las misiones pendientes y el seguimiento de combates mantienen su funcionamiento habitual. Cambiar la pausa de avisos no envía una notificación ni solicita permisos del navegador.

### Objetivos de nivel por estructura

En **Edificios → Objetivos de nivel**, indica el nivel que quieres alcanzar para cada edificio. **Vacío o 0** desactiva ese objetivo. Por ejemplo, Command Center **10** avisa cuando se observa que ha llegado al nivel **10** o lo ha superado. En **Avisos** puedes activar o desactivar el tipo **Objetivo de nivel alcanzado** y elegir los canales habituales de navegador y Telegram.

Comprueba el nivel construido, no la mejora pendiente en cola. Si el edificio ya había alcanzado el objetivo cuando lo configuraste o al empezar a observarlo, establece una referencia silenciosa. Evita repetir el aviso para la misma galaxia, sistema, estructura y objetivo, incluso al recargar. Los objetivos se aplican a cada sistema mientras lo tienes seleccionado; necesitan una selección única y datos actuales del panel del juego.

Los valores y los borradores se guardan en cada edición. Los objetivos y su estado se incluyen en la exportación, importación y copias de Drive. Cambiar un objetivo no genera una notificación de ajustes.

### Contenido de los informes

Con **Informe del juego** y al menos un canal activo, consulta los informes nuevos de la galaxia actual y añade los datos disponibles: resultado, fecha, origen/destino, flotas y pérdidas, botín, recursos y edificios del sondeo, lealtad, capturas, colonización y cargamentos.

Cada informe tiene un encabezado específico, como **🔎 Old Light · Sondeo**, **⚔️ Old Light · Combate** o **🛡️ Old Light · Defensa**. El destino aparece primero y la fecha usa formato de 24 horas con la zona horaria del navegador. En los sondeos omite los tipos de nave con cero exacto, las bajas vacías y el botín vacío; conserva las pérdidas y recursos que sí existan. Agrupa una defensa completamente desconocida como **desconocida**, identifica los tipos con información parcial y mantiene las cantidades aproximadas con **~**, incluido **~0**. Los edificios se presentan como una lista breve por nivel.

La primera comprobación crea una referencia silenciosa. Después revisa la lista cada **25 segundos**; un aumento del contador puede adelantar esa comprobación. Detecta informes aunque los leas enseguida y evita reenviar los mismos identificadores. Si desactivas este tipo y no hay reintentos activos, la siguiente activación empieza sin enviar el historial del período desactivado. Cuando están activos los reintentos, continúa leyendo los informes necesarios aunque sus avisos estén desactivados, y la referencia inicial admite únicamente informes posteriores a la activación de esa función. Cada cuenta y galaxia tienen una referencia independiente.

Solo hace lecturas **GET** a las rutas de informes que usa el cliente nativo. **No abre los informes ni los marca como leídos.** Si un detalle desaparece o falla repetidamente, envía el resumen disponible indicando que falta el detalle. Los informes largos se resumen hasta el límite de Telegram. El estado de la consulta aparece en **Avisos → Estado y diagnóstico**; los errores activos también se muestran junto a la ETA.

Necesita una ruta válida de galaxia, sesión del juego y una pestaña visible con los datos de **Structures o Shipyard** cargados. En la vista estrecha puede seguir leyendo los informes desde **Galaxy o Movements**. Si la ruta no admite esta lectura, conserva el aviso básico del contador. Los errores de sesión o de red se muestran y se reintentan con espera.

## Pausa y funcionamiento

Usa **−** en la cabecera para **minimizar el panel a una barra compacta** y **+** para restaurarlo. Al cambiar el tamaño de la ventana, el panel se ajusta para mantener accesible la cabecera. Estos cambios de vista no envían avisos.

Pulsa **Pausar** en la cabecera para detener las mejoras, la reposición y las misiones pendientes, y **Reanudar** para continuar. La pausa puede mantener los avisos del juego si dejas un canal de notificaciones activo y la lectura de resultados si tienes habilitados los reintentos; no prepara ni envía ataques mientras el helper está pausado. Las preferencias se guardan y se sincronizan entre las pestañas del juego. **Restablecer orden** recupera el orden inicial correspondiente sin cambiar mínimos, edificios marcados ni pausa.

El script respeta los costes, requisitos y colas del juego. Comparte una única petición pendiente entre edificios y naves, y espera su confirmación antes de enviar otra. Si una orden de naves queda sin confirmar y vence su plazo, **se pausa y pide comprobar la cola** antes de reanudar. Con Web Locks disponible, una sola pestaña controla los clics.

Deja **la pestaña del navegador visible**. En escritorio, abre **Structures o Shipyard**; en la vista estrecha también puedes permanecer en **Galaxy o Movements**. Los dos paneles del juego actualizan sus datos aunque la navegación oculte uno o ambos; no necesitas alternarlos. El script espera recuentos actualizados para decidir qué construir.

Cuando la pestaña está oculta, el cliente del juego aplaza el refresco de sus contadores y **el script no inicia nuevas acciones**. Los avisos dependen de los cambios que lleguen a la interfaz mientras se observa. No ofrece una cobertura completa de eventos del servidor ni actividad continua en segundo plano; al cerrar, suspender o descartar la pestaña, deja de actuar.

La versión **1.10.3** conserva las preferencias anteriores, incluidos pausa, edificios seleccionados y configuración de los canales con sus credenciales. Las copias antiguas siguen siendo compatibles: las misiones y campañas sin borrador conservan su flota, y los campos de interfaz ausentes usan sus valores iniciales. Las construcciones ya encoladas mantienen su orden en el juego.

## Guardado local, exportación e importación

Todo lo configurable se guarda automáticamente en este navegador, sin botones de Guardar ajustes: edificios, prioridades, mínimos y modo de flota, atajo y catálogo de presets recordados, misiones pendientes, ajustes y campañas de reintentos, objetivos de nivel, umbral del depósito, pausa, posición y ancho de la ventana, estado minimizado, pestaña seleccionada, secciones desplegadas, canales, filtros y pausas global y por canal de avisos, credenciales de Telegram y configuración de Drive.

Los campos de texto y números guardan el **borrador en cada cambio**. Los números y las credenciales se aplican cuando son válidos, tras 400 ms sin escribir o al salir del campo; el máximo de reintentos se aplica en cuanto el valor es válido. Puedes recargar y continuar una edición incompleta; los valores válidos anteriores siguen activos mientras tanto. Los toggles se aplican inmediatamente; las prioridades, la posición y el ancho arrastrado se guardan al terminar el movimiento. El selector de ancho de **Datos** y los desplegables se guardan con cada cambio.

La pestaña **Datos** permite:

- **Exportar todo:** descarga un archivo JSON con la configuración guardada, incluidas las credenciales de Telegram.
- **Importar copia:** selecciona ese JSON para reemplazar la configuración actual. Se valida antes de aplicarlo; si falla el guardado, intenta restaurar los ajustes anteriores. El límite del archivo es **1 MiB**.

El archivo contiene el token y Chat ID si los has guardado: consérvalo como una copia privada. Las colas del juego, las notificaciones pendientes, la caché de informes y los permisos de notificación del navegador son estado de ejecución o del navegador y no se transfieren. Al importarlo en otro navegador tendrás que conceder allí el permiso para avisos. La copia de ajustes no guarda una partida ni cambia las construcciones ya encargadas.

Los ajustes del panel y sus borradores numéricos usan almacenamiento local del sitio; las credenciales, sus borradores, los objetivos de nivel, las misiones pendientes, las campañas de reintentos y la configuración de avisos y Drive usan el almacenamiento GM del gestor de userscripts. No se publican dentro del código del repositorio.

## Copias en Google Drive

La integración es **opcional** y viene configurada con la aplicación de Google del helper. La autorización se realiza en [la página de copias](https://alexx-ftw.github.io/old-light-auto-upgrade/drive.html), abierta desde el helper.

### Iniciar sesión

1. En el helper, abre **Datos → Conectar Google Drive**.
2. Pulsa **Iniciar sesión con Google**, elige tu cuenta y autoriza el permiso de datos privados de esta aplicación.
3. La ventana se cierra y la sincronización continúa en el helper. Para guardar o restaurar una copia manual, pulsa **Gestionar Google Drive**; la copia automática también se activa desde Datos.

No necesitas crear un proyecto, copiar identificadores ni importar un JSON de Google para usar la conexión integrada. Si ya habías configurado tu propio cliente OAuth, se conserva para que puedas seguir accediendo a sus copias. La configuración avanzada y las opciones de cuenta comienzan cerradas.

### Usar tu propio proyecto

**Configuración avanzada** mantiene la opción de introducir un **Client ID OAuth de tipo Aplicación web** o importarlo desde el JSON de Google. Incluye enlaces para activar Google Drive API, configurar el consentimiento y autorizar el origen `https://alexx-ftw.github.io`. Del JSON solo se conserva el identificador público; no se guarda ni utiliza el client secret.

También puedes editarlo en **Datos → Google Drive → Conexión avanzada** dentro del helper. Un borrador incompleto o vacío se guarda sin cortar la conexión vigente. **Borrar Client ID** elimina la configuración activa; al volver a abrir Drive se adopta la conexión integrada. Las copias de proyectos distintos permanecen separadas: conserva tu identificador anterior si quieres volver a ellas.

### Cuenta y autorización

- La pantalla muestra la cuenta autorizada, si Google proporciona su identidad, y el tiempo aproximado que queda de sesión.
- En **Cuenta y permisos**, **Recordar mi cuenta** guarda únicamente el correo como pista para la siguiente conexión; puedes desactivarlo en cualquier momento. Esta opción no controla el token temporal: su almacenamiento separado permite continuar sin ventana abierta.
- **Renovar conexión** o **Volver a conectar** reutiliza esa pista de cuenta para evitar selecciones innecesarias. **Cambiar cuenta** abre expresamente el selector.
- Cerrar, cancelar o denegar una renovación conserva la sesión anterior mientras siga siendo válida. La autorización tiene un límite de espera y descarta respuestas tardías de intentos cancelados.
- Si Google no carga, aparece **Reintentar conexión**. La autorización siempre empieza con un clic; la reconexión no abre ventanas por su cuenta.
- **Desconectar esta sesión** elimina el token local del Helper y detiene los clientes de este mismo gestor cuando observan el cambio. **Retirar permiso de Google** pide una confirmación dentro de la página y revoca el acceso de la aplicación; solo muestra éxito cuando Google lo confirma. También ofrece un enlace a los permisos de tu cuenta.

La conexión utiliza el modelo de tokens de Google Identity Services para aplicaciones web, sin servidor propio. El identificador público de la aplicación ya está incluido; al caducar la sesión, vuelve a iniciar sesión desde la ventana de copias.

### Copias y restauración

- **Guardar copia ahora** crea una copia nueva con fecha, sin reemplazar las anteriores.
- **Actualizar lista** muestra las **30 copias más recientes**. Selecciona una y pulsa **Restaurar la copia seleccionada** para aplicarla al helper.
- **Copia automática de los cambios locales** guarda los cambios después de **5 segundos** sin otros cambios, mientras el helper permanezca activo y su autorización siga vigente. Evita copias automáticas idénticas. Conectar, recordar la cuenta y configurar el Client ID no generan una copia por sí solos; puedes crear la primera con **Guardar copia ahora**.

Es respaldo automático de los ajustes locales hacia Drive. La restauración desde Drive siempre se elige manualmente, para que otro navegador no sobrescriba tus cambios en curso.

Solicita únicamente el permiso `drive.appdata`. Las copias se guardan en el espacio privado de la aplicación, que no aparece como archivos normales en Mi unidad; se consultan desde la ventana auxiliar usando el mismo proyecto OAuth y la misma cuenta. El token temporal de Google se conserva en almacenamiento GM separado y nunca se añade al JSON de exportación, a las copias ni a los documentos de sincronización del Helper. Si caduca, pulsa **Conectar Google Drive**. Los cambios de preferencias permanecen en el registro local y se sincronizan al reconectar la misma cuenta. Si cambias a otra cuenta, se descartan los envíos automáticos pendientes de la anterior; los ajustes permanecen guardados en local y puedes crear una copia manual o continuar editando.

Las copias incluyen la misma configuración y credenciales de Telegram que la exportación local. Se transfieren al puente por un canal privado y a Google por HTTPS. Cada copia tiene un identificador y un hash para comprobar su integridad al restaurarla. No se almacenan copias ni tokens en GitHub.

Documentación oficial: [configurar OAuth](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid), [modelo de tokens](https://developers.google.com/identity/oauth2/web/guides/use-token-model) y [datos privados de la aplicación en Drive](https://developers.google.com/workspace/drive/api/guides/appdata).

## Actualizaciones automáticas

El gestor comprueba si hay una versión superior según su configuración y frecuencia de actualización. Cuando la detecta, descarga el script nuevo desde este repositorio. Mantén activadas las actualizaciones automáticas en Tampermonkey o Violentmonkey; también puedes solicitar una comprobación manual desde el gestor. Después de actualizar, recarga la página del juego.

La cabecera define `@updateURL` para consultar el archivo ligero `old-light-auto-upgrade.meta.js` y `@downloadURL` para descargar el `.user.js` completo. Ambos archivos deben compartir el mismo `@version`, que se incrementa con cada publicación.

Documentación de los gestores: [Tampermonkey](https://www.tampermonkey.net/documentation.php?locale=en&q=update_url) y [Violentmonkey](https://violentmonkey.github.io/api/metadata-block/).

## Pruebas de automatización y preferencias

Las pruebas usan los planificadores incluidos en el propio userscript y módulos nativos de Node.js. Desde la raíz del repositorio:

```sh
node --test tests/*.test.cjs
```

Cubren la reserva para la flota, orden de naves, lotes parciales, recursos y capacidad, colas separadas, prioridades de edificios, condiciones de Reactor y Depot, producción negativa y datos incompletos. También cubren detección de derrotas, escalado de Marauder, límites, pausa, persistencia, deduplicación, autorización de la misión antes de enviar, identidad del origen y paginación de informes con separación por cuenta. Incluyen formatos nativos con fechas independientes y cantidades sin `kind`, recuperación de informes ya notificados, elección del último resultado por ruta, bloqueo de historial anterior y conservación de campañas en revisión. Las pruebas de preferencias comprueban el ancho, los desplegables, la compatibilidad con copias antiguas y el rechazo de valores de importación inválidos. Las de edición de flota comprueban borradores, cantidades inválidas, pausa durante la edición, sincronización entre campaña y misión, recuperación de guardados parciales, importación y el siguiente reintento desde la flota realmente enviada. También verifican el tipo de misión y el rechazo de autorizaciones de envío obsoletas. Las de esperas y pausas comprueban la recuperación automática sin duplicados, la conservación del motivo entre recargas y el respeto de pausas manuales, importaciones, ediciones y envíos inciertos. No conectan al juego ni envían pedidos o notificaciones.

La cancelación de campañas se prueba con las colas y controladores reales: limpieza de esperas, pausas y registros de envío, cancelación durante la preparación, recuperación tras recarga o fallo de guardado, migración de vínculos antiguos y protección de misiones independientes o pertenecientes a otra campaña.

## Incidencias

[Informar de un problema](https://github.com/alexx-ftw/old-light-auto-upgrade/issues)
