# Old Light Auto Upgrade

Userscript para [Old Light](https://oldlight.io/play) que pulsa la mejora de los edificios elegidos cuando el juego habilita sus botones.

## Instalación

1. Instala [Tampermonkey](https://www.tampermonkey.net/) o [Violentmonkey](https://violentmonkey.github.io/get-it/).
2. Abre **[Instalar o actualizar el userscript](https://raw.githubusercontent.com/alexx-ftw/old-light-auto-upgrade/main/old-light-auto-upgrade.user.js)** y confirma la instalación en el gestor.
3. Recarga Old Light, selecciona tus sistemas y abre **Structures**.

Si el enlace muestra texto, utiliza la opción de instalar desde URL de tu gestor con ese mismo enlace.

**Si ya tienes la versión 1.0.0:** abre el enlace anterior una vez y acepta la actualización o sustitución del script existente. También puedes reemplazar su contenido en el editor del gestor. Esa primera instalación añade las direcciones necesarias para las futuras actualizaciones automáticas.

## Uso

El panel **Auto ↑** se activa por defecto. Pulsa **Activo** para pausar o despliega **Edificios** para elegir qué edificios mejorar. Las preferencias se guardan en el navegador.

- Elige el primer edificio disponible según el orden de la lista del juego.
- Aplica las mejoras a los sistemas seleccionados, igual que los botones normales del juego.
- Espera a que la interfaz refleje cada petición antes de continuar. Si no recibe confirmación tras varios intentos, se pausa.
- Coordina los clics entre pestañas cuando el navegador dispone de Web Locks.

Deja **Structures abierto y la pestaña cargada**. Puede actuar en segundo plano mientras el navegador siga ejecutándola. Al cerrar, suspender o descartar la pestaña, deja de actuar.

## Actualizaciones automáticas

El gestor comprueba si hay una versión superior según su configuración y frecuencia de actualización. Cuando la detecta, descarga el script nuevo desde este repositorio. Mantén activadas las actualizaciones automáticas en Tampermonkey o Violentmonkey; también puedes solicitar una comprobación manual desde el gestor. Después de actualizar, recarga la página del juego.

La cabecera define `@updateURL` para consultar el archivo ligero `old-light-auto-upgrade.meta.js` y `@downloadURL` para descargar el `.user.js` completo. Ambos archivos deben compartir el mismo `@version`, que se incrementa con cada publicación.

Documentación de los gestores: [Tampermonkey](https://www.tampermonkey.net/documentation.php?locale=en&q=update_url) y [Violentmonkey](https://violentmonkey.github.io/api/metadata-block/).

## Incidencias

[Informar de un problema](https://github.com/alexx-ftw/old-light-auto-upgrade/issues)
