# Migración compatible a old-light-helper

## Estado y decisión mínima

El rename de `alexx-ftw/old-light-auto-upgrade` a `alexx-ftw/old-light-helper` está autorizado, pero **no se ejecuta mientras retire el acceso antiguo de Drive**. Solo se han preparado archivos y pruebas dentro del repositorio actual. No se ha creado/modificado otro repositorio, sitio, DNS, credencial ni configuración OAuth.

La URL abierta por los userscripts existentes es `https://alexx-ftw.github.io/old-light-auto-upgrade/drive.html`. El companion comprueba ese origen y esa ruta exactos. Su fragmento lleva únicamente el enlace privado de la ventana; nunca debe registrarse o enviarse al preparar la migración. Los datos y permisos Google siguen en el mecanismo existente.

[GitHub no redirige URLs de Pages de proyecto al renombrar](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository). El sitio actual no tiene dominio propio y se publica desde main/docs. Añadir una carpeta o un 404 en el repo renombrado no permite atender el prefijo antiguo: su sitio pasa al prefijo nuevo. Tampoco se debe crear un repo con el nombre antiguo, pues rompe las redirecciones Git y contradice conservar el mismo repositorio.

La solución preparada usa el [sitio de cuenta](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), cuyo origen sigue siendo `https://alexx-ftw.github.io`, para mantener una carpeta `/old-light-auto-upgrade/` con seis archivos estáticos públicos. No necesita servicio contratado, credenciales nuevas ni permisos/orígenes OAuth adicionales. Requiere autorización aparte para **usar o crear y habilitar Pages en `alexx-ftw/alexx-ftw.github.io`, exclusivamente para servir esa carpeta, conservando el resto de cualquier sitio existente**. No se ha inspeccionado ni modificado ese recurso fuera del alcance actual.

## Paquete preparado, no desplegado

Desde un commit limpio:

```sh
node prepare-rename-compat.cjs --out /ruta/absoluta/nueva/fuera-del-repo
```

El resultado contiene `manifest.json` y `old-light-auto-upgrade/{drive.html,drive.js,drive.css,sync-core.js,index.html,privacy.html}`. El manifiesto incluye commit/árbol fuente, hashes/bytes de fuentes y resultados y el origen/ruta que debe servirlos. Es determinista; no contiene fechas, configuración de usuarios ni autenticación. El comando no usa red, no publica y no renombra.

Lee los blobs regulares del commit capturado, no archivos externos a través de symlinks. Rechaza checkout sucio, salida existente, salida dentro del repo incluso mediante un directorio symlink, ruta de companion desconocida y cambios en las dependencias HTML auditadas. Detecta imports/url CSS comunes y exige revisión si aparecen. No es un analizador general de JavaScript, CSS o HTML: al regenerarlo deben revisarse cargas dinámicas/imports, assets y protocolo, no inferir cierre exhaustivo de dependencias por una suite verde.

Hoy los seis archivos se copian sin cambiar bytes. Los cuatro assets Drive tampoco cambiaron entre 1.17.14 y 1.17.16. Para una fuente futura cuyo HELPER_PATH sea exactamente `/old-light-helper/drive.html`, el empaquetador genera la variante legacy sustituyendo **solo** esa constante por `/old-light-auto-upgrade/drive.html`. Marca la transformación y ambos hashes. No añade una allowlist de rutas, no cambia el origen y no reemplaza globalmente nombres de almacenamiento/formato.

## Secuencia después de autorizar el recurso adicional

1. Inspeccionar el sitio de cuenta y su publicación sin sobrescribir contenido/configuración existente. Determinar dónde se sirven archivos estáticos y si ya existe esa carpeta. Si requiere permisos o credenciales adicionales, detener; no crearlos.
2. Preparar y revisar el paquete del commit vigente. Servir los seis archivos en el prefijo antiguo usando el sitio de cuenta, preservando el resto. Verificar por HTTP bytes de los seis, origen y dependencias, sin OAuth real ni partida. Antes del rename el proyecto actual también sirve esos mismos bytes: no depender de una precedencia de routing sin medirla.
3. Preparar en este repo la candidata de referencias canónicas nuevas y su companion con ruta nueva. Mantener identidad del userscript (`@name`, `@namespace`), nombres de archivos, claves GM/localStorage, APP/COPY_FORMAT/ROOT_FORMAT, protocolos y Client ID existentes. Mantener mismo origen/scope Google. Revisar fixtures de instalaciones anteriores y empaquetado legacy contra la candidata final.
4. Revisión independiente adversarial fresca y gate completo del commit final. Contrastar main remoto de nuevo. Renombrar **el mismo repositorio**, sin borrar/recrear ni reutilizar el nombre viejo; publicar referencias normales sin force. Verificar que ID/node_id, árbol e historial sean los esperados.
5. Verificar viejo/nuevo remote git y URLs update/download con bytes exactos; no asumir un redirect raw sin comprobarlo. Verificar el Pages nuevo, el Drive antiguo servido por el sitio de cuenta, assets, portada y privacidad; CI terminal del SHA exacto. El fragmento y MessagePort se prueban con valores ficticios, nunca con autorizaciones reales.
6. Conservar el mirror mientras haya instalaciones que apunten al prefijo viejo. En posteriores cambios Drive, regenerar/revisar la variante exacta legacy y comprobar compatibilidad de protocolos. Solo sustituirla por una redirección cuando se haya probado la continuidad del bootstrap y se haya aprobado esa fase; no es necesaria para el rename inicial.

El mirror mantiene las entradas normales de Drive, portada y privacidad. No promete conservar automáticamente todas las URLs históricas de documentos Markdown u otros assets no inventariados. Si se necesita esa cobertura, inventariarla y autorizarla antes de actuar.

## Revisión del empaquetador y regresiones

La primera preparación tenía dos huecos encontrados por el revisor: podía copiar bytes de un symlink externo y no detectaba un script añadido con `src =` o mayúsculas. El árbol local anterior inmutable es `9151c24040e674b16e4992726cf6526e8cdda2be`; SHA256 del CLI anterior: `38b6019c756c8c566e178d8b9f95f5568603e0b6ef45690e6d978bfbdaf2bc82`. Ese árbol nunca se publicó.

Se extrae git archive de ese árbol en `/tmp/oldlight-rename-compat-before-review`, se copia solo `tests/rename-compat-preparation.test.cjs` final y se ejecuta:

```sh
node --test --test-name-pattern='rejects committed symlink|detects alternate HTML' /tmp/oldlight-rename-compat-before-review/tests/rename-compat-preparation.test.cjs
```

Antes: 2 casos fallidos porque el CLI acepta lo que se espera rechazar. Después: los 6 casos del archivo pasan; incluyen fuentes inmutables, adaptación de una sola ruta y rechazo de salida/checkout/dependencias inseguras. El inventario futuro sigue requiriendo revisión humana/agente, no solo regex. Gate y revisión final se registran para el commit exacto fuera del árbol de publicación.
