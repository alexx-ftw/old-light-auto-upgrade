# Validación de la candidata 1.13.1: Drive sin ventana permanente

Estado: preparada localmente, sin publicar. Fecha: 2026-10-13.

## Resultado

- 793 pruebas automatizadas pasan; 0 fallos, 0 omitidas.
- 43 pruebas nuevas ejecutan el helper y los motores de ventana/local reales, con almacenamiento GM, relojes, ventanas y respuestas de Google simulados.
- Sintaxis de `docs/drive.js` y del userscript: correcta.
- `git diff --check`: correcto.
- Revisión independiente de seguridad y regresiones enfocadas: sin bloqueos importantes pendientes.

Comandos:

```sh
node build-drive.cjs
node --check docs/drive.js
node --check old-light-auto-upgrade.user.js
node --test tests/*.test.cjs
git diff --check
```

## Cobertura del cambio

- Autorización nueva, aceptación asíncrona de almacenamiento y cierre posterior de la ventana.
- Restauración tras recarga sin nuevo popup ni OAuth y conservación de la caducidad original.
- Caducidad, desconexión, cambio de cliente, revocación confirmada y errores 401.
- Identidad distinta, ausente o temporalmente inaccesible: ninguna escritura de archivos antes de verificarla.
- Reintento tras falta de red sin desechar un token vigente.
- Carreras entre pestañas, tokens nuevos frente a temporizadores antiguos y escritura que termina después de desconectar/cambiar cliente/destruir el módulo.
- Caché de Violentmonkey visible antes del ACK: el motor no migra antes de la confirmación y descarta candidatos rechazados.
- Copia automática pendiente durante la apertura/cierre de Gestión: se conserva sin doble copia.
- Bootstrap privado, rechazo de origen/ventana/protocolo incorrectos, y ausencia de secretos en mensajes públicos, URL de red, DOM o almacenamiento del juego.
- Ausencia de token en exports, configuración, cuerpos de sincronización, métricas y estados públicos del Helper.
- Modo seguro alternativo sin persistencia cuando el contexto aislado efectivo no está confirmado o falta almacenamiento asíncrono.
- La implementación usada en el motor local coincide exactamente con la de la ventana; el bloque generado permanece dentro del cierre privado del userscript.

## Límites de esta validación

No se ejecutó Brave + Violentmonkey real ni Google OAuth real. El intento de arrancar un navegador de prueba aislado quedó bloqueado por las restricciones del entorno. No se enviaron acciones a una partida ni peticiones reales a Google. Las pruebas de Node verifican comportamiento y protocolos simulados; no prueban una instalación de extensión ni restricciones concretas de un perfil Brave.

Después de publicar e instalar con autorización, conviene comprobar en un perfil de prueba: conectar y ver cerrar la ventana; recargar y verificar sincronización; abrir/cerrar Gestión; desconectar y verificar que otra pestaña detiene el acceso; dejar caducar y renovar. No hace falta ejecutar misiones ni pedidos del juego para esa comprobación.

El Helper no cifra el token ni puede excluirlo de una exportación/sincronización completa de Violentmonkey o una copia del perfil del navegador. Solo garantiza su exclusión de sus propios exports, copias, registros y sincronización. Desconectar antes de compartir datos del gestor.

## Referencias técnicas

- [Google: modelo de tokens y CORS](https://developers.google.com/identity/oauth2/web/guides/use-token-model#use_rest_and_cors_with_google_apis)
- [Chrome: aislamiento y CSP de content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#content_security_policy)
- [Violentmonkey: información del mundo de inyección efectivo](https://github.com/violentmonkey/violentmonkey/blob/master/src/injected/web/gm-api-wrapper.js)
- [Violentmonkey: redirecciones de GM_xmlhttpRequest](https://github.com/violentmonkey/violentmonkey/issues/2359)
