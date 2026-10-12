# Old Light Auto Upgrade

Userscript para [Old Light](https://oldlight.io/play) que da prioridad a la flota, reserva recursos para los mínimos de naves y muestra una ETA del siguiente pedido. También mejora edificios por prioridad, ajusta Reactor y Resource Depot según necesidad, muestra presets de flota con Shift + clic, permite esperar o producir las naves que falten para una misión, reintenta ataques fallidos con un Marauder más y envía avisos opcionales al navegador o Telegram, incluidos objetivos de nivel por estructura. Versión **1.10.2**, que reintenta las interrupciones temporales de misiones y campañas y muestra su motivo concreto. Conserva el funcionamiento en las vistas estrechas Galaxy y Movements y las flotas editables, con borradores guardados automáticamente. La versión cargada aparece en la cabecera del helper, también al minimizarlo.

## Instalación

1. Instala [Tampermonkey](https://www.tampermonkey.net/) o [Violentmonkey](https://violentmonkey.github.io/get-it/).
2. Abre **[Instalar o actualizar el userscript](https://raw.githubusercontent.com/alexx-ftw/old-light-auto-upgrade/main/old-light-auto-upgrade.user.js)** y confirma la instalación en el gestor.
3. Recarga Old Light y selecciona un sistema. En escritorio, abre **Structures** o **Shipyard**; en la vista estrecha también puedes permanecer en **Galaxy** o **Movements**.

Si el enlace muestra texto, utiliza la opción de instalar desde URL de tu gestor con ese mismo enlace.

**Si ya tienes la versión 1.0.0:** abre el enlace anterior una vez y acepta la actualización o sustitución del script existente. También puedes reemplazar su contenido en el editor del gestor. Esa primera instalación añade las direcciones necesarias para las futuras actualizaciones automáticas.

## Interfaz y navegación

El helper mantiene la cabecera y las cuatro pestañas accesibles mientras desplazas su contenido. La ventana conserva su altura al cambiar de pestaña. **Siguiente acción** destaca la ETA, el próximo pedido y el motivo de espera; la fila de ese edificio o nave también queda resaltada.

| Pestaña | Contenido |
| --- | --- |
| **Edificios** | Prioridades, nivel construido y estado de cada estructura, condiciones de Reactor y Depot, objetivos de nivel. |
| **Flota** | Mínimos y orden de naves, cantidades en base, misión y cola, campañas y misiones pendientes con flota editable, y atajo de presets. |
| **Avisos** | Pausa global, tarjetas independientes de navegador y Telegram, filtros por evento y diagnóstico. |
| **Datos** | Exportar e importar, conexión y copias de Google Drive, ancho y posición de la ventana. |

Los controles de uso habitual aparecen primero. La conexión de Telegram, los límites de reintentos, la configuración avanzada de Drive y el diagnóstico se agrupan en secciones desplegables. Se recuerda cuáles dejas abiertas; las credenciales de Telegram comienzan accesibles si todavía falta configurar el canal. **Actividad del helper** muestra el estado detallado y la última solicitud. Los errores que requieren atención permanecen visibles fuera de los desplegables.

Puedes **mover** el helper arrastrando la cabecera y **minimizarlo** con **−**. La barra compacta conserva la versión, la pausa de automatización y la ETA. Para **cambiar el ancho**, arrastra el borde izquierdo o usa **Datos → Ventana del helper → Ancho**; admite de **300 a 560 px** y se adapta al espacio disponible. **Restablecer tamaño y posición** recupera el ancho de 360 px y la esquina inferior derecha. La posición, el ancho, la última pestaña, el estado minimizado y los desplegables se guardan localmente y viajan en las copias.

También se puede navegar con el teclado: **← / →**, **Inicio** y **Fin** cambian de pestaña cuando su botón tiene el foco. **↑ / ↓** sobre el asa de una prioridad la mueve, y los botones de flecha ofrecen la misma acción. En el borde de ancho, **← / →** ajustan 20 px e **Inicio / Fin** llevan a los límites; un doble clic restablece 360 px. **Escape** cancela un arrastre de ventana, ancho o prioridad. El foco se conserva mientras llegan actualizaciones del juego.

### Ventanas estrechas

Con **900 px de ancho o menos**, Old Light pasa a una navegación con **Star**, **Movements** y **Galaxy**. En estas dos últimas vistas oculta visualmente los paneles de construcción, pero sigue actualizando sus controles y datos. Desde **1.10.1**, el helper mantiene la lectura de niveles, ETA, producción, mejoras, misiones pendientes y observación de eventos en esas vistas. No necesita cambiar de pantalla ni abrir el menú de navegación.

La pestaña del navegador debe seguir visible y los datos del sistema deben estar cargados. Los controles deshabilitados, el astillero bloqueado, una pantalla de carga o error y la pausa del helper siguen deteniendo las acciones correspondientes. La detección de muelles llenos también funciona cuando la vista estrecha oculta el indicador de flota. Cambiar de ancho o de vista actualiza el helper automáticamente.

## Edificios y prioridades

El helper se activa por defecto. Abre la pestaña **Edificios** para elegir qué edificios mejorar y ajustar sus condiciones. **Arrastra el asa de cada fila**, con ratón o pantalla táctil, para ordenar las prioridades; también puedes usar **↑ / ↓**. El número **1** tiene la prioridad más alta. El orden se guarda y se aplica al siguiente pedido.

El script elige el primer edificio marcado y disponible según ese orden. Si uno todavía no puede mejorarse, pasa al siguiente disponible. Las mejoras afectan a los sistemas seleccionados, igual que al pulsar manualmente los botones del juego.

### Reactor y Resource Depot

Estos edificios también deben estar marcados y poder construirse normalmente:

- **Reactor:** se considera únicamente cuando otra mejora marcada, disponible y con sus condiciones satisfechas consume energía y dejaría la energía libre por debajo de **0**. No usa un umbral fijo. El juego permite entrar en déficit; el script añade esta condición para prevenirlo y espera antes de enviar la mejora que lo causaría.
- **Resource Depot:** se considera cuando **cualquiera de los dos recursos**, palladium o iridium, alcanza el **90 %** de su capacidad. Puedes cambiar ese porcentaje entre **1 y 100** en **Depot al alcanzar…**.

Si ya hay una mejora de Reactor o Depot en cola, espera antes de encargar otra del mismo tipo. Los valores desconocidos o la selección múltiple no justifican estas mejoras automáticas: necesitan datos del sistema seleccionado.

### ETA del siguiente pedido

El indicador **Siguiente acción**, al principio del contenido de cada pestaña, muestra la **nave y cantidad** o el **edificio y nivel**, la **cuenta atrás aproximada** y el motivo de la espera. La cuenta atrás también se ve debajo de **Old Light** al minimizar el helper; al pasar el cursor aparece el detalle. No necesita activar ningún ajuste.

La ETA corresponde a cuándo se podrá **encolar el siguiente pedido automático de flota o mejora**. Una construcción que ya esté en curso puede continuar mientras se añade otro pedido si queda un hueco. El tiempo de construcción de la nave o del nuevo nivel es distinto y lo muestra el juego.

- Calcula cuánto falta de palladium e iridium y toma la mayor de las dos esperas según la producción actual. Usa las cantidades completas del juego aunque la interfaz muestre `K` o `M`.
- **La flota tiene prioridad sobre los edificios, también mientras reúne recursos.** Si hay un mínimo o una producción autorizada de misión pendientes, muestra el primer tipo de nave pendiente que pueda producirse según el orden de Flota. Una nave o un edificio más baratos no consumen los recursos que está reservando.
- La ETA de una nave corresponde al **siguiente lote posible**. Si todavía no alcanza para una, calcula cuándo podrá encargar la primera; no espera a poder pagar todo el mínimo. El coste nativo mostrado para varias naves se divide por su cantidad para obtener el coste de una unidad.
- Si la cola está llena, espera también al primer hueco que se libere en la **cola correspondiente**, de naves o de edificios. Los recursos se producen durante esa espera: ambos tiempos se combinan por su máximo, no se suman. Una cola de naves detenida o sin tiempo conocido no genera una cuenta atrás inventada.
- Cuando la flota está cubierta o ya en construcción, pronostica la primera mejora que podrá hacerse con las prioridades y casillas marcadas actuales. Entre edificios, una mejora más barata puede estar disponible antes que la primera de la lista; si coinciden en tiempo, decide el orden de prioridad.
- Reactor solo aparece si otra mejora marcada lo justifica y llega a poder pagarse. Depot espera al porcentaje configurado. Ninguno se repite si ya está en cola.
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

**Flota tiene prioridad sobre Edificios.** Si la primera nave pendiente del orden puede producirse pero aún faltan recursos, el helper **reserva esos recursos** y espera. No los gasta en edificios ni en tipos de nave de menor prioridad. También mantiene la reserva mientras espera un hueco normal en la cola de naves. La ETA y los pedidos usan la misma selección de prioridad.

Por ejemplo: Probe con mínimo **2** y **3** en base, Marauder con mínimo **8**, **7** en base y **1** en construcción, Sentinel con mínimo **1** y **1** en base, y Vanguard con mínimo **1** y **0** disponibles. El siguiente objetivo es **Vanguard ×1**. El Marauder en cola ya cubre su mínimo. El helper ahorra para Vanguard y retoma los edificios cuando los mínimos quedan cubiertos o ya en construcción.

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

La versión **1.10.2** conserva las preferencias anteriores, incluidos pausa, edificios seleccionados y configuración de los canales con sus credenciales. Las copias antiguas siguen siendo compatibles: las misiones y campañas sin borrador conservan su flota, y los campos de interfaz ausentes usan sus valores iniciales. Las construcciones ya encoladas mantienen su orden en el juego.

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

1. En el helper, abre **Datos → Abrir Google Drive**.
2. Pulsa **Iniciar sesión con Google**, elige tu cuenta y autoriza el permiso de datos privados de esta aplicación.
3. Usa **Guardar copia ahora**, restaura una copia o activa **Copia automática de los cambios locales**.

No necesitas crear un proyecto, copiar identificadores ni importar un JSON de Google para usar la conexión integrada. Si ya habías configurado tu propio cliente OAuth, se conserva para que puedas seguir accediendo a sus copias. La configuración avanzada y las opciones de cuenta comienzan cerradas.

### Usar tu propio proyecto

**Configuración avanzada** mantiene la opción de introducir un **Client ID OAuth de tipo Aplicación web** o importarlo desde el JSON de Google. Incluye enlaces para activar Google Drive API, configurar el consentimiento y autorizar el origen `https://alexx-ftw.github.io`. Del JSON solo se conserva el identificador público; no se guarda ni utiliza el client secret.

También puedes editarlo en **Datos → Google Drive → Conexión avanzada** dentro del helper. Un borrador incompleto o vacío se guarda sin cortar la conexión vigente. **Borrar Client ID** elimina la configuración activa; al volver a abrir Drive se adopta la conexión integrada. Las copias de proyectos distintos permanecen separadas: conserva tu identificador anterior si quieres volver a ellas.

### Cuenta y autorización

- La pantalla muestra la cuenta autorizada, si Google proporciona su identidad, y el tiempo aproximado que queda de sesión.
- En **Cuenta y permisos**, **Recordar mi cuenta** guarda únicamente el correo como pista para la siguiente conexión; puedes desactivarlo en cualquier momento. Nunca guarda el token de Google.
- **Renovar conexión** o **Volver a conectar** reutiliza esa pista de cuenta para evitar selecciones innecesarias. **Cambiar cuenta** abre expresamente el selector.
- Cerrar, cancelar o denegar una renovación conserva la sesión anterior mientras siga siendo válida. La autorización tiene un límite de espera y descarta respuestas tardías de intentos cancelados.
- Si Google no carga, aparece **Reintentar conexión**. La autorización siempre empieza con un clic; la reconexión no abre ventanas por su cuenta.
- **Desconectar esta sesión** elimina el token de esta ventana. **Retirar permiso de Google** pide una confirmación dentro de la página y revoca el acceso de la aplicación; solo muestra éxito cuando Google lo confirma. También ofrece un enlace a los permisos de tu cuenta.

La conexión utiliza el modelo de tokens de Google Identity Services para aplicaciones web, sin servidor propio. El identificador público de la aplicación ya está incluido; al caducar la sesión, vuelve a iniciar sesión desde la ventana de copias.

### Copias y restauración

- **Guardar copia ahora** crea una copia nueva con fecha, sin reemplazar las anteriores.
- **Actualizar lista** muestra las **30 copias más recientes**. Selecciona una y pulsa **Restaurar la copia seleccionada** para aplicarla al helper.
- **Copia automática de los cambios locales** guarda los cambios después de **5 segundos** sin otros cambios, mientras la ventana auxiliar permanezca abierta y su autorización siga vigente. Evita copias automáticas idénticas. Conectar, recordar la cuenta y configurar el Client ID no generan una copia por sí solos; puedes crear la primera con **Guardar copia ahora**.

Es respaldo automático de los ajustes locales hacia Drive. La restauración desde Drive siempre se elige manualmente, para que otro navegador no sobrescriba tus cambios en curso.

Solicita únicamente el permiso `drive.appdata`. Las copias se guardan en el espacio privado de la aplicación, que no aparece como archivos normales en Mi unidad; se consultan desde la ventana auxiliar usando el mismo proyecto OAuth y la misma cuenta. El token de Google se conserva solo en memoria en esa ventana y nunca se añade al JSON ni al almacenamiento del userscript. Si caduca, pulsa **Volver a conectar**. Los cambios locales recibidos durante la caducidad quedan pendientes en esta ventana y se copian tras reconectar la misma cuenta. Si cambias a otra cuenta, se descartan los envíos automáticos pendientes de la anterior; los ajustes permanecen guardados en local y puedes crear una copia manual o continuar editando.

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

## Incidencias

[Informar de un problema](https://github.com/alexx-ftw/old-light-auto-upgrade/issues)
