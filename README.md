# Old Light Auto Upgrade

Userscript para [Old Light](https://oldlight.io/play) que mejora edificios por prioridad, muestra una ETA para la siguiente mejora, ajusta Reactor y Resource Depot según necesidad, repone naves hasta los mínimos configurados, muestra presets de flota con Shift + clic, permite esperar o producir las naves que falten para una misión y envía avisos opcionales al navegador o Telegram, incluidos objetivos de nivel por estructura. Versión **1.6.0**.

## Instalación

1. Instala [Tampermonkey](https://www.tampermonkey.net/) o [Violentmonkey](https://violentmonkey.github.io/get-it/).
2. Abre **[Instalar o actualizar el userscript](https://raw.githubusercontent.com/alexx-ftw/old-light-auto-upgrade/main/old-light-auto-upgrade.user.js)** y confirma la instalación en el gestor.
3. Recarga Old Light, selecciona un sistema y abre **Structures** o **Shipyard**.

Si el enlace muestra texto, utiliza la opción de instalar desde URL de tu gestor con ese mismo enlace.

**Si ya tienes la versión 1.0.0:** abre el enlace anterior una vez y acepta la actualización o sustitución del script existente. También puedes reemplazar su contenido en el editor del gestor. Esa primera instalación añade las direcciones necesarias para las futuras actualizaciones automáticas.

## Edificios y prioridades

El panel **Auto ↑** se activa por defecto. Abre la pestaña **Edificios** para elegir qué edificios mejorar y ajustar sus condiciones. **Arrastra el asa de cada fila**, con ratón o pantalla táctil, para ordenar las prioridades; también puedes usar **↑ / ↓**. El número **1** tiene la prioridad más alta. El orden se guarda y se aplica al siguiente pedido.

El script elige el primer edificio marcado y disponible según ese orden. Si uno todavía no puede mejorarse, pasa al siguiente disponible. Las mejoras afectan a los sistemas seleccionados, igual que al pulsar manualmente los botones del juego.

### Reactor y Resource Depot

Estos edificios también deben estar marcados y poder construirse normalmente:

- **Reactor:** se considera únicamente cuando otra mejora marcada, disponible y con sus condiciones satisfechas consume energía y dejaría la energía libre por debajo de **0**. No usa un umbral fijo. El juego permite entrar en déficit; el script añade esta condición para prevenirlo y espera antes de enviar la mejora que lo causaría.
- **Resource Depot:** se considera cuando **cualquiera de los dos recursos**, palladium o iridium, alcanza el **90 %** de su capacidad. Puedes cambiar ese porcentaje entre **1 y 100** en **Depot al alcanzar…**.

Si ya hay una mejora de Reactor o Depot en cola, espera antes de encargar otra del mismo tipo. Los valores desconocidos o la selección múltiple no justifican estas mejoras automáticas: necesitan datos del sistema seleccionado.

### ETA de la siguiente mejora

El indicador **Siguiente mejora**, encima de las pestañas, muestra el **edificio y nivel**, la **cuenta atrás aproximada** y el motivo de la espera. La cuenta atrás también se ve debajo de **Auto ↑** al minimizar el helper; al pasar el cursor aparece el detalle. No necesita activar ningún ajuste.

La ETA corresponde a cuándo se podrá **encolar el siguiente pedido automático de mejora**. Una construcción que ya esté en curso puede continuar mientras se añade otro pedido si queda un hueco. El tiempo de construcción del nuevo nivel es distinto y lo muestra el juego.

- Calcula cuánto falta de palladium e iridium y toma la mayor de las dos esperas según la producción actual. Usa las cantidades completas del juego aunque la interfaz muestre `K` o `M`.
- Si la cola está llena, espera también al primer hueco que se libere. Los recursos se producen durante esa espera: ambos tiempos se combinan por su máximo, no se suman.
- Pronostica la primera mejora que podrá hacerse con las prioridades y casillas marcadas actuales. Una mejora más barata puede estar disponible antes que la primera de la lista; si coinciden en tiempo, decide el orden de prioridad.
- Reactor solo aparece si otra mejora marcada lo justifica y llega a poder pagarse. Depot espera al porcentaje configurado. Ninguno se repite si ya está en cola.
- Si falta producción, el coste supera la capacidad, hay requisitos pendientes o faltan datos exactos, muestra **Sin ETA** y explica el bloqueo. La pausa y los pedidos pendientes también tienen su propio estado.

Se actualiza con los datos del juego y la comprobación habitual de cada segundo. La cuenta atrás continúa entre actualizaciones de las cantidades enteras del HUD; si llega a cero antes de que el juego habilite el pedido, espera su confirmación. El símbolo **≈** indica una estimación con las tasas actuales, que el juego redondea. Los pedidos de naves, otros gastos, los recursos que lleguen y las construcciones que terminen pueden cambiarla; se recalcula al observar esos cambios. Si tienes reposición de flota configurada, el indicador recuerda que la producción de naves tiene prioridad sobre los edificios.

Requiere **un único sistema**, una pestaña visible y **Structures o Shipyard** abierto. La previsión usa los datos disponibles sin iniciar peticiones, modificar prioridades ni generar notificaciones. No se guarda una cuenta atrás antigua: al recargar se calcula de nuevo.

## Mínimos de naves

En la pestaña **Flota**, configura un mínimo para **Probe, Marauder, Sentinel y Vanguard**. Un mínimo de **0** desactiva la reposición de ese tipo. También puedes ordenar los tipos con **↑ / ↓**.

- Por defecto cuenta las naves **estacionadas en el sistema seleccionado**. Activa **Contar también las naves en misión** para incluir además las misiones que el juego atribuye a ese sistema.
- Siempre descuenta las naves **ya en construcción**. Por ejemplo, con un mínimo de **10**, **4** en la base y **3** en cola, encarga **3** más.
- Pide el déficit pendiente, limitado por la cantidad máxima que admite el juego y los recursos disponibles. Si el juego acepta solo una parte, lee la cola y los contadores actualizados antes de recalcular lo que falta.
- Los mismos mínimos se aplican a cada sistema cuando lo seleccionas. La reposición requiere **un único sistema seleccionado**. Con selección múltiple continúan las mejoras masivas de edificios, pero se suspende la reposición porque los contadores de naves muestran `—`.

La reposición disponible tiene prioridad sobre los edificios. Si no puede encargar naves por recursos, requisitos o bloqueos, puede continuar con una mejora de edificio disponible.

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

Cada misión queda vinculada a la **cuenta, galaxia, sistema de origen y coordenadas exactas del destino**. Esta función requiere un **único origen seleccionado** y admite una misión pendiente por origen. Selecciona ese origen, mantén el helper activo y deja **Structures o Shipyard** abierto en una pestaña visible. Si cambias de sistema, la misión espera a que vuelvas. Los despachos inmediatos completos siguen admitiendo el comportamiento nativo por lotes.

Las misiones pendientes se guardan localmente. Tras recargar, el helper puede recuperar el destino mediante los controles del mapa y comprobar de nuevo la ruta antes de enviar; esa recuperación puede desplazar la vista del mapa. Una interacción tuya durante la preparación la interrumpe. Si el juego no permite comprobar el destino o cambia el preset, queda pausada para revisión. También puedes reconectarla seleccionando el mismo destino y preset con **Shift + clic**.

Si un envío queda **sin confirmar**, se detiene y no se repite automáticamente. Comprueba los movimientos del juego antes de usar la opción explícita de reanudación. Las copias locales y de Drive incluyen estas misiones y los presets recordados; **importar una copia deja las misiones pendientes en pausa** para revisarlas antes de reanudar.

## Notificaciones

La pestaña **Avisos** reúne los canales y los filtros de notificaciones. Los dos canales son independientes y están **desactivados por defecto**:

- **Navegador:** pulsa **Permitir avisos del navegador**. Solo ese botón solicita permiso; al concederlo se activa el canal. Después puedes controlarlo con **Avisos del navegador**.
- **Telegram:** introduce el **token de tu bot** y el **Chat ID** y activa **Avisos por Telegram**. Los cambios se guardan automáticamente; no hay botón Guardar. **Enviar prueba a Telegram** envía una prueba al chat guardado, independientemente de los filtros y sin necesidad de activar el canal. La prueba se bloquea mientras quedan credenciales incompletas en edición.

El token y el Chat ID se guardan en el almacenamiento del gestor de userscripts, mediante GM, fuera del archivo publicado. Cada pulsación guarda un borrador privado; cuando el par de credenciales es válido, se aplica tras **400 ms** sin cambios o al salir del campo. Mientras está incompleto, se conserva la conexión anterior. Los campos vacíos conservan lo guardado. Al recargar, se recuperan los borradores pendientes, sin rellenar los campos con las credenciales activas. **Borrar credenciales de Telegram** elimina tanto las credenciales como los borradores y desactiva el canal.

En **Tipos de notificación** puedes activar o desactivar individualmente los **19 tipos**, agrupados en **Actividad**, **Problemas** y **Ajustes del helper**, o usar **Todos / Ninguno**. Los mismos filtros se aplican a ambos canales que tengas habilitados:

- **Activados por defecto:** solicitudes, confirmaciones de edificios y naves, edificios terminados, objetivos de nivel alcanzados, cambios de flota, avisos emergentes del juego, informes nuevos con su contenido y aumentos de mensajes sin leer, errores, pedidos rechazados o sin confirmar y **pausas automáticas**.
- **Desactivados por defecto:** cambios de edificios marcados, mínimos de naves, modo de contar naves, prioridades, umbral del depósito y **pausa o reanudación manual**.

Cada aviso muestra una sola marca **Old Light**, un encabezado con el icono y tipo de evento, el sistema cuando se puede identificar y el detalle separado. Los cambios de vista del helper no envían avisos. Un cambio de flota se comunica como tal; por sí solo no demuestra que haya terminado una construcción. Los mensajes privados del juego se anuncian por su contador; su contenido no se descarga.

Cada canal tiene su propia cola de avisos **en memoria**, que no se conserva al recargar o cerrar la pestaña. Telegram separa los envíos al menos **3,1 segundos** y, si pide esperar por exceso de solicitudes, respeta ese plazo antes de reintentar. El panel muestra el estado de cada canal.

### Objetivos de nivel por estructura

En **Edificios → Objetivos de nivel**, indica el nivel que quieres alcanzar para cada edificio. **Vacío o 0** desactiva ese objetivo. Por ejemplo, Command Center **10** avisa cuando se observa que ha llegado al nivel **10** o lo ha superado. En **Avisos** puedes activar o desactivar el tipo **Objetivo de nivel alcanzado** y elegir los canales habituales de navegador y Telegram.

Comprueba el nivel construido, no la mejora pendiente en cola. Si el edificio ya había alcanzado el objetivo cuando lo configuraste o al empezar a observarlo, establece una referencia silenciosa. Evita repetir el aviso para la misma galaxia, sistema, estructura y objetivo, incluso al recargar. Los objetivos se aplican a cada sistema mientras lo tienes seleccionado; necesitan una selección única y datos actuales del panel del juego.

Los valores y los borradores se guardan en cada edición. Los objetivos y su estado se incluyen en la exportación, importación y copias de Drive. Cambiar un objetivo no genera una notificación de ajustes.

### Contenido de los informes

Con **Informe del juego** y al menos un canal activo, consulta los informes nuevos de la galaxia actual y añade los datos disponibles: resultado, fecha, origen/destino, flotas y pérdidas, botín, recursos y edificios del sondeo, lealtad, capturas, colonización y cargamentos.

Cada informe tiene un encabezado específico, como **🔎 Old Light · Sondeo**, **⚔️ Old Light · Combate** o **🛡️ Old Light · Defensa**. El destino aparece primero y la fecha usa formato de 24 horas con la zona horaria del navegador. En los sondeos omite los tipos de nave con cero exacto, las bajas vacías y el botín vacío; conserva las pérdidas y recursos que sí existan. Agrupa una defensa completamente desconocida como **desconocida**, identifica los tipos con información parcial y mantiene las cantidades aproximadas con **~**, incluido **~0**. Los edificios se presentan como una lista breve por nivel.

La primera comprobación crea una referencia silenciosa. Después revisa la lista cada **25 segundos**; un aumento del contador puede adelantar esa comprobación. Detecta informes aunque los leas enseguida y evita reenviar los mismos identificadores. Al desactivar este tipo o todos sus canales, la siguiente activación vuelve a empezar sin enviar el historial del período desactivado.

Solo hace lecturas **GET** a las rutas de informes que usa el cliente nativo. **No abre los informes ni los marca como leídos.** Si un detalle desaparece o falla repetidamente, envía el resumen disponible indicando que falta el detalle. Los informes largos se resumen hasta el límite de Telegram. El estado de la consulta aparece al final de **Avisos**.

Necesita una ruta válida de galaxia, sesión del juego y una pestaña visible con **Structures o Shipyard** abierto. Si la ruta no admite esta lectura, conserva el aviso básico del contador. Los errores de sesión o de red se muestran y se reintentan con espera.

## Pausa y funcionamiento

Usa el botón de la cabecera para **minimizar el panel a una barra compacta o restaurarlo**. Puedes moverlo arrastrando la cabecera, fuera de sus botones. Se guardan la posición, el estado minimizado y la última pestaña elegida; al cambiar el tamaño de la ventana, el panel se ajusta para mantener accesible la cabecera. Estos cambios de vista no envían avisos.

Pulsa **Activo** para pausar las mejoras, la reposición y las misiones pendientes. La pausa puede mantener los avisos del juego si dejas un canal de notificaciones activo. Las preferencias se guardan y se sincronizan entre las pestañas del juego. **Restablecer orden** recupera el orden inicial correspondiente sin cambiar mínimos, edificios marcados ni pausa.

El script respeta los costes, requisitos y colas del juego. Comparte una única petición pendiente entre edificios y naves, y espera su confirmación antes de enviar otra. Si una orden de naves queda sin confirmar y vence su plazo, **se pausa y pide comprobar la cola** antes de reanudar. Con Web Locks disponible, una sola pestaña controla los clics.

Deja **Structures o Shipyard abierto y la pestaña visible**. Los dos paneles del juego actualizan sus datos aunque uno esté oculto dentro de la página; no necesitas alternarlos. El script espera recuentos actualizados para decidir qué construir.

Cuando la pestaña está oculta, el cliente del juego aplaza el refresco de sus contadores y **el script no inicia nuevas acciones**. Los avisos dependen de los cambios que lleguen a la interfaz mientras se observa. No ofrece una cobertura completa de eventos del servidor ni actividad continua en segundo plano; al cerrar, suspender o descartar la pestaña, deja de actuar.

La versión **1.6.0** conserva las preferencias anteriores, incluidos pausa, edificios seleccionados y configuración de los canales con sus credenciales. Las construcciones ya encoladas mantienen su orden en el juego.

## Guardado local, exportación e importación

Todo lo configurable se guarda automáticamente en este navegador, sin botones de Guardar ajustes: edificios, prioridades, mínimos y modo de flota, atajo y catálogo de presets recordados, misiones pendientes, objetivos de nivel, umbral del depósito, pausa, posición de la ventana, estado minimizado, pestaña seleccionada, secciones desplegadas, canales y filtros de avisos, credenciales de Telegram y configuración de Drive.

Los campos de texto y números guardan el **borrador en cada cambio**. Los números y las credenciales se aplican cuando son válidos, tras 400 ms sin escribir o al salir del campo. Puedes recargar y continuar una edición incompleta; los valores válidos anteriores siguen activos mientras tanto. Los toggles se aplican inmediatamente; las prioridades y la posición se guardan al terminar el movimiento.

La pestaña **Datos** permite:

- **Exportar todo:** descarga un archivo JSON con la configuración guardada, incluidas las credenciales de Telegram.
- **Importar copia:** selecciona ese JSON para reemplazar la configuración actual. Se valida antes de aplicarlo; si falla el guardado, intenta restaurar los ajustes anteriores. El límite del archivo es **1 MiB**.

El archivo contiene el token y Chat ID si los has guardado: consérvalo como una copia privada. Las colas del juego, las notificaciones pendientes, la caché de informes y los permisos de notificación del navegador son estado de ejecución o del navegador y no se transfieren. Al importarlo en otro navegador tendrás que conceder allí el permiso para avisos. La copia de ajustes no guarda una partida ni cambia las construcciones ya encargadas.

Los ajustes del panel y sus borradores numéricos usan almacenamiento local del sitio; las credenciales, sus borradores, los objetivos de nivel, las misiones pendientes y la configuración de avisos y Drive usan el almacenamiento GM del gestor de userscripts. No se publican dentro del código del repositorio.

## Copias en Google Drive

La integración es **opcional** y viene configurada con la aplicación de Google del helper. La autorización se realiza en [la página de copias](https://alexx-ftw.github.io/old-light-auto-upgrade/drive.html), abierta desde el helper.

### Iniciar sesión

1. En el helper, abre **Datos → Abrir Google Drive**.
2. Pulsa **Iniciar sesión con Google**, elige tu cuenta y autoriza el permiso de datos privados de esta aplicación.
3. Usa **Guardar copia ahora**, restaura una copia o activa **Copia automática de los cambios locales**.

No necesitas crear un proyecto, copiar identificadores ni importar un JSON de Google para usar la conexión integrada. Si ya habías configurado tu propio cliente OAuth, se conserva para que puedas seguir accediendo a sus copias. La configuración avanzada y las opciones de cuenta comienzan cerradas.

### Usar tu propio proyecto

**Configuración avanzada** mantiene la opción de introducir un **Client ID OAuth de tipo Aplicación web** o importarlo desde el JSON de Google. Incluye enlaces para activar Google Drive API, configurar el consentimiento y autorizar el origen `https://alexx-ftw.github.io`. Del JSON solo se conserva el identificador público; no se guarda ni utiliza el client secret.

También puedes editarlo en **Datos → Configuración avanzada** dentro del helper. Un borrador incompleto o vacío se guarda sin cortar la conexión vigente. **Borrar Client ID** elimina la configuración activa; al volver a abrir Drive se adopta la conexión integrada. Las copias de proyectos distintos permanecen separadas: conserva tu identificador anterior si quieres volver a ellas.

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

## Pruebas del estimador

Las pruebas usan el estimador incluido en el propio userscript y módulos nativos de Node.js. Desde la raíz del repositorio:

```sh
node --test tests/upgrade-eta.test.cjs
```

Cubren recursos y capacidad, cola, prioridades, condiciones de Reactor y Depot, producción negativa y datos incompletos. No conectan al juego ni envían pedidos o notificaciones.

## Incidencias

[Informar de un problema](https://github.com/alexx-ftw/old-light-auto-upgrade/issues)
