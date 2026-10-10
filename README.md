# Old Light Auto Upgrade

Userscript para [Old Light](https://oldlight.io/play) que mejora edificios por prioridad, ajusta Reactor y Resource Depot según necesidad, repone naves hasta los mínimos configurados y envía avisos opcionales al navegador o Telegram. Versión **1.2.0**.

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

## Mínimos de naves

En la pestaña **Flota**, configura un mínimo para **Probe, Marauder, Sentinel y Vanguard**. Un mínimo de **0** desactiva la reposición de ese tipo. También puedes ordenar los tipos con **↑ / ↓**.

- Por defecto cuenta las naves **estacionadas en el sistema seleccionado**. Activa **Contar también las naves en misión** para incluir además las misiones que el juego atribuye a ese sistema.
- Siempre descuenta las naves **ya en construcción**. Por ejemplo, con un mínimo de **10**, **4** en la base y **3** en cola, encarga **3** más.
- Pide el déficit pendiente, limitado por la cantidad máxima que admite el juego y los recursos disponibles. Si el juego acepta solo una parte, lee la cola y los contadores actualizados antes de recalcular lo que falta.
- Los mismos mínimos se aplican a cada sistema cuando lo seleccionas. La reposición requiere **un único sistema seleccionado**. Con selección múltiple continúan las mejoras masivas de edificios, pero se suspende la reposición porque los contadores de naves muestran `—`.

La reposición disponible tiene prioridad sobre los edificios. Si no puede encargar naves por recursos, requisitos o bloqueos, puede continuar con una mejora de edificio disponible.

Con el modo de naves estacionadas, enviar naves a una misión puede provocar su reposición; cuando regresen, el total puede superar el mínimo. Activa **Contar también las naves en misión** si quieres evitar esa reposición para las misiones contabilizadas por el juego. El script no cancela construcciones ni desguaza naves para reducir excedentes.

## Notificaciones

La pestaña **Avisos** reúne los canales y los filtros de notificaciones. Los dos canales son independientes y están **desactivados por defecto**:

- **Navegador:** pulsa **Permitir avisos del navegador**. Solo ese botón solicita permiso; al concederlo se activa el canal. Después puedes controlarlo con **Avisos del navegador**.
- **Telegram:** introduce el **token de tu bot** y el **Chat ID**, pulsa **Guardar** y activa **Avisos por Telegram**. **Guardar no envía mensajes**. **Enviar prueba a Telegram** envía una prueba al chat guardado, independientemente de los filtros y sin necesidad de activar el canal.

El token y el Chat ID se guardan en el almacenamiento del gestor de userscripts, mediante GM, fuera del archivo publicado. Los campos vacíos conservan lo guardado. **Borrar credenciales de Telegram** elimina esos datos y desactiva el canal.

En **Tipos de notificación** puedes activar o desactivar individualmente los **18 tipos**, agrupados en **Actividad**, **Problemas** y **Ajustes del helper**, o usar **Todos / Ninguno**. Los mismos filtros se aplican a ambos canales que tengas habilitados:

- **Activados por defecto:** solicitudes, confirmaciones de edificios y naves, edificios terminados, cambios de flota, avisos emergentes del juego, informes nuevos con su contenido y aumentos de mensajes sin leer, errores, pedidos rechazados o sin confirmar y **pausas automáticas**.
- **Desactivados por defecto:** cambios de edificios marcados, mínimos de naves, modo de contar naves, prioridades, umbral del depósito y **pausa o reanudación manual**.

Cada aviso muestra una sola marca **Old Light**, un encabezado con el icono y tipo de evento, el sistema cuando se puede identificar y el detalle separado. Los cambios de vista del helper no envían avisos. Un cambio de flota se comunica como tal; por sí solo no demuestra que haya terminado una construcción. Los mensajes privados del juego se anuncian por su contador; su contenido no se descarga.

Cada canal tiene su propia cola de avisos **en memoria**, que no se conserva al recargar o cerrar la pestaña. Telegram separa los envíos al menos **3,1 segundos** y, si pide esperar por exceso de solicitudes, respeta ese plazo antes de reintentar. El panel muestra el estado de cada canal.

### Contenido de los informes

Con **Informe del juego** y al menos un canal activo, consulta los informes nuevos de la galaxia actual y añade los datos disponibles: título y resultado, fecha, origen/destino, flotas y pérdidas, botín, recursos y edificios del sondeo, lealtad, capturas, colonización y cargamentos. Conserva las cantidades desconocidas como `???` y las aproximadas con `~`.

La primera comprobación crea una referencia silenciosa. Después revisa la lista cada **25 segundos**; un aumento del contador puede adelantar esa comprobación. Detecta informes aunque los leas enseguida y evita reenviar los mismos identificadores. Al desactivar este tipo o todos sus canales, la siguiente activación vuelve a empezar sin enviar el historial del período desactivado.

Solo hace lecturas **GET** a las rutas de informes que usa el cliente nativo. **No abre los informes ni los marca como leídos.** Si un detalle desaparece o falla repetidamente, envía el resumen disponible indicando que falta el detalle. Los informes largos se resumen hasta el límite de Telegram. El estado de la consulta aparece al final de **Avisos**.

Necesita una ruta válida de galaxia, sesión del juego y una pestaña visible con **Structures o Shipyard** abierto. Si la ruta no admite esta lectura, conserva el aviso básico del contador. Los errores de sesión o de red se muestran y se reintentan con espera.

## Pausa y funcionamiento

Usa el botón de la cabecera para **minimizar el panel a una barra compacta o restaurarlo**. Puedes moverlo arrastrando la cabecera, fuera de sus botones. Se guardan la posición, el estado minimizado y la última pestaña elegida; al cambiar el tamaño de la ventana, el panel se ajusta para mantener accesible la cabecera. Estos cambios de vista no envían avisos.

Pulsa **Activo** para pausar tanto las mejoras como la reposición. La pausa puede mantener los avisos del juego si dejas un canal de notificaciones activo. Las preferencias se guardan y se sincronizan entre las pestañas del juego. **Restablecer orden** recupera el orden inicial correspondiente sin cambiar mínimos, edificios marcados ni pausa.

El script respeta los costes, requisitos y colas del juego. Comparte una única petición pendiente entre edificios y naves, y espera su confirmación antes de enviar otra. Si una orden de naves queda sin confirmar y vence su plazo, **se pausa y pide comprobar la cola** antes de reanudar. Con Web Locks disponible, una sola pestaña controla los clics.

Deja **Structures o Shipyard abierto y la pestaña visible**. Los dos paneles del juego actualizan sus datos aunque uno esté oculto dentro de la página; no necesitas alternarlos. El script espera recuentos actualizados para decidir qué construir.

Cuando la pestaña está oculta, el cliente del juego aplaza el refresco de sus contadores y **el script no inicia nuevas acciones**. Los avisos dependen de los cambios que lleguen a la interfaz mientras se observa. No ofrece una cobertura completa de eventos del servidor ni actividad continua en segundo plano; al cerrar, suspender o descartar la pestaña, deja de actuar.

La versión **1.2.0** conserva las preferencias anteriores, incluidos pausa, edificios seleccionados y configuración de los canales con sus credenciales. Las construcciones ya encoladas mantienen su orden en el juego.

## Guardado local, exportación e importación

Todo lo configurable se guarda automáticamente en este navegador: edificios, prioridades, mínimos y modo de flota, umbral del depósito, pausa, posición de la ventana, estado minimizado, pestaña seleccionada, secciones desplegadas, canales y filtros de avisos, credenciales de Telegram y configuración de Drive.

La pestaña **Datos** permite:

- **Exportar todo:** descarga un archivo JSON con la configuración guardada, incluidas las credenciales de Telegram.
- **Importar copia:** selecciona ese JSON para reemplazar la configuración actual. Se valida antes de aplicarlo; si falla el guardado, intenta restaurar los ajustes anteriores. El límite del archivo es **1 MiB**.

El archivo contiene el token y Chat ID si los has guardado: consérvalo como una copia privada. Las colas del juego, las notificaciones pendientes, la caché de informes y los permisos de notificación del navegador son estado de ejecución o del navegador y no se transfieren. Al importarlo en otro navegador tendrás que conceder allí el permiso para avisos. La copia de ajustes no guarda una partida ni cambia las construcciones ya encargadas.

Los ajustes del panel usan almacenamiento local del sitio; las credenciales y la configuración de avisos y Drive usan el almacenamiento GM del gestor de userscripts. No se publican dentro del código del repositorio.

## Copias en Google Drive

La integración es **opcional** y necesita un **Client ID OAuth propio**, de tipo aplicación web. No requiere un client secret. La autorización se realiza en [la página de copias](https://alexx-ftw.github.io/old-light-auto-upgrade/drive.html), abierta desde el helper.

### Configuración inicial

1. En [Google Cloud Console](https://console.cloud.google.com/), crea o elige tu proyecto y habilita **Google Drive API**.
2. Configura la pantalla de consentimiento OAuth y, si tu aplicación está en modo de prueba, añade tu cuenta como usuario de prueba.
3. Crea un **ID de cliente OAuth**, tipo **Aplicación web**, y añade exactamente este **origen JavaScript autorizado**: `https://alexx-ftw.github.io`.
4. En **Datos → Copia opcional en Google Drive**, pega el Client ID y pulsa **Guardar configuración**.
5. Pulsa **Abrir Google Drive** y, en la ventana auxiliar, **Conectar Google Drive**. Autoriza tu cuenta y el permiso de datos privados de esta aplicación.

### Copias y restauración

- **Guardar copia ahora** crea una copia nueva con fecha, sin reemplazar las anteriores.
- **Actualizar lista** muestra las **30 copias más recientes**. Selecciona una y pulsa **Restaurar la copia seleccionada** para aplicarla al helper.
- **Copia automática de los cambios locales** guarda los cambios después de **5 segundos** sin otros cambios, mientras la ventana auxiliar permanezca abierta y su autorización siga vigente. Evita copias automáticas idénticas. Conectar y guardar el Client ID no generan una copia por sí solos; puedes crear la primera con **Guardar copia ahora**.

Es respaldo automático de los ajustes locales hacia Drive. La restauración desde Drive siempre se elige manualmente, para que otro navegador no sobrescriba tus cambios en curso.

Solicita únicamente el permiso `drive.appdata`. Las copias se guardan en el espacio privado de la aplicación, que no aparece como archivos normales en Mi unidad; se consultan desde la ventana auxiliar usando el mismo proyecto OAuth y la misma cuenta. El token de Google se conserva solo en memoria en esa ventana y nunca se añade al JSON ni al almacenamiento del userscript. Si caduca, pulsa **Conectar Google Drive** de nuevo.

Las copias incluyen la misma configuración y credenciales de Telegram que la exportación local. Se transfieren al puente por un canal privado y a Google por HTTPS. Cada copia tiene un identificador y un hash para comprobar su integridad al restaurarla. No se almacenan copias ni tokens en GitHub.

Documentación oficial: [configurar OAuth](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid), [modelo de tokens](https://developers.google.com/identity/oauth2/web/guides/use-token-model) y [datos privados de la aplicación en Drive](https://developers.google.com/workspace/drive/api/guides/appdata).

## Actualizaciones automáticas

El gestor comprueba si hay una versión superior según su configuración y frecuencia de actualización. Cuando la detecta, descarga el script nuevo desde este repositorio. Mantén activadas las actualizaciones automáticas en Tampermonkey o Violentmonkey; también puedes solicitar una comprobación manual desde el gestor. Después de actualizar, recarga la página del juego.

La cabecera define `@updateURL` para consultar el archivo ligero `old-light-auto-upgrade.meta.js` y `@downloadURL` para descargar el `.user.js` completo. Ambos archivos deben compartir el mismo `@version`, que se incrementa con cada publicación.

Documentación de los gestores: [Tampermonkey](https://www.tampermonkey.net/documentation.php?locale=en&q=update_url) y [Violentmonkey](https://violentmonkey.github.io/api/metadata-block/).

## Incidencias

[Informar de un problema](https://github.com/alexx-ftw/old-light-auto-upgrade/issues)
