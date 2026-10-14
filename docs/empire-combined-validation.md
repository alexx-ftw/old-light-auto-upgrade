# Validación de la entrega imperial 1.15.0

La entrega 1.15.0 parte del conjunto local revisado `a271edcd7212bb2d95fad2c3ae5be036d7a44a2a`, conservado como checkpoint. Su preparación actualiza versión, changelog, documentación y la URL de caché del núcleo de sync. No añade comportamientos funcionales a esa candidata. La distribución debe corresponder al mismo árbol que supera la validación final, sin sobrescribir commits concurrentes.

## Composición preservada

- Base publicada: `4970f50c63c7311de2011ddfe2badffb756277d9`, equivalente local `eae5ca5aaed88276c44ef93877f03be96b6b439b`.
- Hito sync independiente: `2d99272fd32b9d82f3a093548f6da966685f0103`, derivado del checkpoint `cd33e92`.
- Hito diagnósticos independiente: `837a4cffa6ee02e2cf9a5231eda7439bf4f39b21`, derivado del checkpoint `d173eba`.
- La combinación de ambos hitos no tuvo conflictos de código. La integración previa de sync conservó a la vez el aviso `settingsChanged()` y la guarda `isVisible()` del panel.

## Fronteras de datos y autoridad

El namespace imperial de sync contiene únicamente objetivos globales y rol/Atender por sistema y cuenta/galaxia. No transmite la activación global de Imperio, censo, planes, colas, órdenes, estado de ejecución, credenciales ni métricas. Un cliente detenido permanece detenido. Los campos históricos del motor de preferencias conservan su comportamiento autorizado previo, incluido el tratamiento existente de ajustes y credenciales de notificaciones; esta extensión no lo amplía ni envía el token OAuth privado.

Los nuevos diagnósticos son locales y opt-in. Registran únicamente contadores por día UTC y categorías fijas, incluida la apertura de la pestaña Imperio. No incluyen IDs de cuentas/sistemas, tramas, recursos, mensajes, errores crudos ni secretos. No viajan a Drive ni a copias; desactivar borra contadores y las otras instancias dejan de escribir. La clasificación `missing-init` no fabrica datos ni habilita acciones.

Se conservan las optimizaciones 1.14.3: bundle nuevo en cada actualización, permiso y preflight; `systemPolicy` acotada; panel sin render oculto ni escrituras de texto iguales; scheduler imperial con coalescencia de 50 ms. Cada orden sigue dependiendo de identidad, propiedad, HUD, censo completo y actual, y barreras posteriores a pedidos. El puente y los cinco grants no amplían acceso.

## Verificación del conjunto previo

Las pasadas completas propia e independiente del conjunto son **1181/1181**, sin fallos, omitidas ni pendientes. Los cuatro builders, comprobación de sintaxis y diff-check pasan. Los documentos de [sync](empire-sync-validation.md) y [diagnósticos](empire-diagnostics-validation.md) conservan resultados históricos de sus hitos independientes.

La revisión cruzada independiente pasa **40 comprobaciones**: separación entre sync y métricas, revocación/opt-out entre instancias, rechazo atómico de campos prohibidos, convergencia por cuenta/galaxia y preservación de las guardas de rendimiento. Tras desactivar, 100 cambios posteriores de sync/diagnóstico no escribieron métricas ni reactivaron Imperio. No se encontraron bloqueos de código; se corrigieron únicamente referencias documentales a los hitos aislados. Los cuatro builders también son idempotentes en una copia de revisión. Informe y resultados se conservan junto al checkpoint local.

Las pruebas usan DOM, almacenamiento y tráfico nativo sintéticos. No se ejecutaron órdenes en una partida, autorizaciones nuevas de Google ni pruebas reales de navegador. No prueban por sí mismas el rendimiento o la exactitud del censo en Brave/Violentmonkey.

## Validación final de 1.15.0

El árbol de 1.15.0 pasa **1181/1181 pruebas completas**, sin fallos ni omisiones, tanto en la ejecución propia como en la nueva revisión independiente. Esta revisión añade **44 comprobaciones externas** sobre privacidad, consentimiento, convergencia, autoridad, versión, directivas de seguridad, igualdad funcional con la candidata y caché del companion. Los cuatro builders ejecutados dos veces conservan todos los bytes; sintaxis de los JS/CJS y diff-check pasan. No se añadieron pruebas redundantes ni se cambiaron las funciones revisadas para esta publicación. Después de publicar se comprueban el commit remoto, los bytes del autoupdate y el despliegue Pages.

Los clientes que compartan perfil deben actualizar juntos y reabrir las ventanas Drive antiguas. Las versiones anteriores rechazan el documento con registros imperiales de forma atómica. La extensión conserva cinco grants; no necesita otro scope de Google, nuevos servicios ni telemetría remota. El token OAuth privado sigue separado de preferencias, métricas y código del juego.
