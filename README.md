# Old Light Auto Upgrade

Userscript para [Old Light](https://oldlight.io/play) que mejora edificios por prioridad, ajusta Reactor y Resource Depot según necesidad, repone naves hasta los mínimos configurados y envía avisos opcionales al navegador o Telegram. Versión **1.1.0**.

## Instalación

1. Instala [Tampermonkey](https://www.tampermonkey.net/) o [Violentmonkey](https://violentmonkey.github.io/get-it/).
2. Abre **[Instalar o actualizar el userscript](https://raw.githubusercontent.com/alexx-ftw/old-light-auto-upgrade/main/old-light-auto-upgrade.user.js)** y confirma la instalación en el gestor.
3. Recarga Old Light, selecciona un sistema y abre **Structures** o **Shipyard**.

Si el enlace muestra texto, utiliza la opción de instalar desde URL de tu gestor con ese mismo enlace.

**Si ya tienes la versión 1.0.0:** abre el enlace anterior una vez y acepta la actualización o sustitución del script existente. También puedes reemplazar su contenido en el editor del gestor. Esa primera instalación añade las direcciones necesarias para las futuras actualizaciones automáticas.

## Edificios y prioridades

El panel **Auto ↑** se activa por defecto. Despliega **Edificios** para elegir qué edificios mejorar y usa **↑ / ↓** para ordenar sus prioridades. El número **1** tiene la prioridad más alta.

El script elige el primer edificio marcado y disponible según ese orden. Si uno todavía no puede mejorarse, pasa al siguiente disponible. Las mejoras afectan a los sistemas seleccionados, igual que al pulsar manualmente los botones del juego.

### Reactor y Resource Depot

Estos edificios también deben estar marcados y poder construirse normalmente:

- **Reactor:** se considera únicamente cuando otra mejora marcada, disponible y con sus condiciones satisfechas consume energía y dejaría la energía libre por debajo de **0**. No usa un umbral fijo. El juego permite entrar en déficit; el script añade esta condición para prevenirlo y espera antes de enviar la mejora que lo causaría.
- **Resource Depot:** se considera cuando **cualquiera de los dos recursos**, palladium o iridium, alcanza el **90 %** de su capacidad. Puedes cambiar ese porcentaje entre **1 y 100** en **Depot al alcanzar…**.

Si ya hay una mejora de Reactor o Depot en cola, espera antes de encargar otra del mismo tipo. Los valores desconocidos o la selección múltiple no justifican estas mejoras automáticas: necesitan datos del sistema seleccionado.

## Mínimos de naves

Configura un mínimo para **Probe, Marauder, Sentinel y Vanguard**. Un mínimo de **0** desactiva la reposición de ese tipo. También puedes ordenar los tipos con **↑ / ↓**.

- Por defecto cuenta las naves **estacionadas en el sistema seleccionado**. Activa **Contar también las naves en misión** para incluir además las misiones que el juego atribuye a ese sistema.
- Siempre descuenta las naves **ya en construcción**. Por ejemplo, con un mínimo de **10**, **4** en la base y **3** en cola, encarga **3** más.
- Pide el déficit pendiente, limitado por la cantidad máxima que admite el juego y los recursos disponibles. Si el juego acepta solo una parte, lee la cola y los contadores actualizados antes de recalcular lo que falta.
- Los mismos mínimos se aplican a cada sistema cuando lo seleccionas. La reposición requiere **un único sistema seleccionado**. Con selección múltiple continúan las mejoras masivas de edificios, pero se suspende la reposición porque los contadores de naves muestran `—`.

La reposición disponible tiene prioridad sobre los edificios. Si no puede encargar naves por recursos, requisitos o bloqueos, puede continuar con una mejora de edificio disponible.

Con el modo de naves estacionadas, enviar naves a una misión puede provocar su reposición; cuando regresen, el total puede superar el mínimo. Activa **Contar también las naves en misión** si quieres evitar esa reposición para las misiones contabilizadas por el juego. El script no cancela construcciones ni desguaza naves para reducir excedentes.

## Notificaciones

El tercer desplegable, **Notificaciones**, permite activar dos canales independientes. Ambos están **desactivados por defecto**:

- **Navegador:** pulsa **Permitir avisos del navegador**. Solo ese botón solicita permiso; al concederlo se activa el canal. Después puedes controlarlo con **Avisos del navegador**.
- **Telegram:** introduce el **token de tu bot** y el **Chat ID**, pulsa **Guardar** y activa **Avisos por Telegram**. **Guardar no envía mensajes**. Si quieres comprobar el destino, pulsa **Enviar prueba a Telegram**; esa prueba sí envía un mensaje al chat guardado y no requiere activar el canal.

El token y el Chat ID se guardan en el almacenamiento del gestor de userscripts, mediante GM, fuera del archivo publicado. Los campos vacíos conservan lo guardado. **Borrar credenciales de Telegram** elimina esos datos y desactiva el canal.

Con un canal activo, los avisos cubren:

- Solicitudes, confirmaciones, errores, pausas, reanudaciones y cambios de ajustes del script.
- Subidas de nivel construido y cambios observados en la flota del sistema seleccionado.
- Nuevos avisos emergentes del juego y aumentos de los contadores de informes o mensajes sin leer.

La primera lectura se toma como referencia silenciosa y se evitan avisos repetidos. No se reenvía el historial ni se obtiene el contenido completo de informes o mensajes del servidor. Un cambio de flota se comunica como tal; por sí solo no demuestra que haya terminado una construcción.

Cada canal tiene su propia cola de avisos **en memoria**, que no se conserva al recargar o cerrar la pestaña. Telegram separa los envíos al menos **3,1 segundos** y, si pide esperar por exceso de solicitudes, respeta ese plazo antes de reintentar. El panel muestra el estado de cada canal.

## Pausa y funcionamiento

Pulsa **Activo** para pausar tanto las mejoras como la reposición. La pausa puede mantener los avisos del juego si dejas un canal de notificaciones activo. Las preferencias se guardan y se sincronizan entre las pestañas del juego. **Restablecer orden** recupera el orden inicial correspondiente sin cambiar mínimos, edificios marcados ni pausa.

El script respeta los costes, requisitos y colas del juego. Comparte una única petición pendiente entre edificios y naves, y espera su confirmación antes de enviar otra. Si una orden de naves queda sin confirmar y vence su plazo, **se pausa y pide comprobar la cola** antes de reanudar. Con Web Locks disponible, una sola pestaña controla los clics.

Deja **Structures o Shipyard abierto y la pestaña visible**. Los dos paneles del juego actualizan sus datos aunque uno esté oculto dentro de la página; no necesitas alternarlos. El script espera recuentos actualizados para decidir qué construir.

Cuando la pestaña está oculta, el cliente del juego aplaza el refresco de sus contadores y **el script no inicia nuevas acciones**. Los avisos dependen de los cambios que lleguen a la interfaz mientras se observa. No ofrece una cobertura completa de eventos del servidor ni actividad continua en segundo plano; al cerrar, suspender o descartar la pestaña, deja de actuar.

La versión **1.1.0** conserva la pausa y los edificios seleccionados anteriormente. Los cambios de ajustes se aplican a las siguientes peticiones; las construcciones ya encoladas mantienen su orden en el juego.

## Actualizaciones automáticas

El gestor comprueba si hay una versión superior según su configuración y frecuencia de actualización. Cuando la detecta, descarga el script nuevo desde este repositorio. Mantén activadas las actualizaciones automáticas en Tampermonkey o Violentmonkey; también puedes solicitar una comprobación manual desde el gestor. Después de actualizar, recarga la página del juego.

La cabecera define `@updateURL` para consultar el archivo ligero `old-light-auto-upgrade.meta.js` y `@downloadURL` para descargar el `.user.js` completo. Ambos archivos deben compartir el mismo `@version`, que se incrementa con cada publicación.

Documentación de los gestores: [Tampermonkey](https://www.tampermonkey.net/documentation.php?locale=en&q=update_url) y [Violentmonkey](https://violentmonkey.github.io/api/metadata-block/).

## Incidencias

[Informar de un problema](https://github.com/alexx-ftw/old-light-auto-upgrade/issues)
