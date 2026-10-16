# Migración directa a old-light-helper

El propietario rechazó expresamente crear el recurso adicional alexx-ftw.github.io y autorizó usar el nuevo nombre directamente, aceptando que el enlace Pages anterior deje de funcionar. Esta decisión sustituye el plan de compatibilidad anterior. No crear otro repositorio, sitio, DNS, credencial ni configuración OAuth.

## Operación autorizada

Renombrar el mismo repositorio id1413202349, node_id R_kgDOVDvBrQ, de alexx-ftw/old-light-auto-upgrade a alexx-ftw/old-light-helper. Conservar historia, padre de main y permisos; integración normal sin force push. Tras revisión y gate del commit final, renombrar, actualizar origin y publicar. Verificar identidad, commit/árbol/padre remoto y CI del SHA exacto.

URLs canónicas: https://github.com/alexx-ftw/old-light-helper ; metadata https://raw.githubusercontent.com/alexx-ftw/old-light-helper/main/old-light-auto-upgrade.meta.js ; instalador https://raw.githubusercontent.com/alexx-ftw/old-light-helper/main/old-light-auto-upgrade.user.js ; companion https://alexx-ftw.github.io/old-light-helper/drive.html . Verificar bytes y dependencias servidas tras deploy. La ruta antigua Pages no tiene garantía de redirección ni se provisiona compatibilidad.

## Identidad conservada y límites

Se mantienen @name Old Light Auto Upgrade y @namespace old-light-auto-upgrade para no crear otra instalación del userscript, además de filenames, claves GM/localStorage, formatos de backup, protocolo, Client ID, scopes y origen OAuth https://alexx-ftw.github.io. Solo cambia la ruta exacta del companion y referencias públicas del repositorio. No se autoriza ni modifica ninguna cuenta Google; la configuración externa OAuth y una conexión real posterior siguen sin verificarse.

Instalaciones antiguas deben actualizarse para abrir la nueva ruta Drive. Una sesión headless con autorización válida puede seguir operando hasta su vencimiento; no se garantiza recuperar una ventana antigua tras el cambio. El nuevo userscript rechaza rutas que no correspondan a su companion canónico. Los enlaces GitHub pueden redirigir, pero no se promete que el gestor siga URLs antiguas de autoupdate: se entrega el instalador canónico y se comprueban las respuestas reales.

prepare-rename-compat.cjs permanece como herramienta offline auditada para reproducir sus fixtures históricos; no se usa para crear/desplegar ningún recurso ni activar un segundo sitio. Sus pruebas normalizan explícitamente el fixture a la ruta legacy antes de probar la adaptación. No confundir un paquete offline con compatibilidad servida.
