# Validación de estados Drive 1.15.1

Base publicada: 1.15.0, commit `a03e6f0362e7b44e85acd7672b719a96802789e8`, equivalente local `33b03283451c0e72541792594562739561b90142`. La revisión se limitó a estados de sincronización, desconexión y recuperación; no volvió a implementar ni alterar la fusión imperial.

## Defectos reproducidos

1. Tras terminar una sincronización, una edición compartida dejaba el estado del Helper en `synced`, aunque todavía no se había enviado ninguna petición para el cambio. Además, el ciclo en curso siempre notificaba `synced` aunque su revisión hubiera cambiado durante una subida y quedaran cambios pendientes. Los datos locales se conservaban: el fallo era la confirmación prematura.
2. Desconectar desde el Helper con su ventana de gestión abierta borraba la autorización y deshabilitaba el enlace, pero la ventana pedía mantenerla abierta porque se recuperaría al volver al juego. Su enlace se había cerrado definitivamente y ya no admitía recuperación. Esperar 65 segundos o recargar el Helper no lo restauraba; abrir una ventana nueva sí era la vía correcta.

Las dos regresiones de integración con el runtime privado fallan contra la versión 1.15.0 original y pasan con el arreglo. Usan las funciones de producción con DOM, reloj, almacenamiento y respuestas de Drive simulados.

## Corrección acotada

- Un cambio compartido anuncia `sync_pending` antes del siguiente envío cuando el estado anterior era satisfactorio. Los cambios solo locales no lo alteran; los avisos de error y las operaciones activas conservan su mensaje.
- Al completar un ciclo, `synced` solo se notifica si no se ha observado una revisión posterior. Una edición durante una subida mantiene `sync_pending` hasta el siguiente ciclo completo.
- La desconexión explícita reutiliza el código `disconnected` y muestra instrucciones para cerrar la ventana y abrir Drive desde el Helper. Una pérdida temporal conserva `bridge_reconnecting` y la recuperación existente. El aviso de la ventana distingue así cierre explícito de recuperación temporal.
- El companion servido y el runtime privado usan el mismo código. La URL de caché de `drive.js` cambia a `1.15.1`.

No se alteran OAuth, grants, almacenamiento de autorización, peticiones de Drive, relojes de reintento, documentos de sincronización, reglas de conflictos ni autorización de órdenes. No se añaden métricas, payloads o información personal a los estados. Las métricas existentes siguen locales, opcionales y basadas en códigos fijos.

## Compatibilidad y límites

Las fusiones simultáneas normales continúan resolviéndose de forma determinista. Los documentos incompatibles o con registros contradictorios siguen rechazándose íntegramente como `invalid_sync`, sin sustituir ajustes locales ni mostrar su contenido. Ese diagnóstico no identifica por sí solo qué cliente generó el documento; todos los Helpers del perfil deben estar actualizados para compartir políticas imperiales.

Las pruebas de esta corrección son offline. No se hicieron acciones en la partida, inicios de sesión de Google ni pruebas reales de Brave/Violentmonkey y Drive. La confirmación real de fluidez del usuario correspondía a 1.14.3; no se utiliza como prueba de sincronización real de 1.15.x.

## Validación del checkpoint de estados

El hotfix de estados aislado pasa **1188/1188 pruebas completas** y **3/3 comprobaciones independientes** sobre estados activos, errores, autorización y mensajes acotados. Los cuatro builders ejecutados dos veces conservan los bytes; sintaxis de 69 archivos JS/CJS, metadatos y diff-check pasan. Este checkpoint se conservó antes de integrar la corrección de la barrera del censo. La validación conjunta de la release se documenta en [validación de la barrera imperial](empire-order-validation.md).
