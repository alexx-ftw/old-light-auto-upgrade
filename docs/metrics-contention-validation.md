# Métricas locales: contención entre pestañas, 1.16.7

## Alcance verificado

La base publicada es `cf751f39b3a1f132a7314ec3a582bade24c2cb58`, con árbol `c75b0381b809b0d1de550ac1af9c33c1cba6d7fa`; el commit local equivalente es `4afdd3d8c5ea4db8179e76096bc72b89ee1c19cf`. La auditoría del 14 de octubre de 2026 confirmó esa identidad y la igualdad del blob remoto de `docs/metrics-core.js` (`afe6a062f155442be8603e9b4424c165fa8407a0`).

Las métricas publicadas son **exclusivamente locales**, desactivadas inicialmente. Tienen 36 categorías fijas, 30 días UTC y un millón de incrementos como máximo por categoría/día. El documento completo de 30 días al límite ocupa 33.676 caracteres con la versión numérica más larga, por debajo del límite de lectura de 65.536. No guarda cuentas, nombres, mensajes, recursos, coordenadas, URLs, trazas o credenciales; el token local de revocación no aparece en exportaciones. No viajan por Drive ni por las copias de configuración. En el parche aislado de contención no existe cliente, transporte ni configuración PostHog; no se verificó un proyecto remoto ni estadísticas agregadas. El trabajo antiguo de telemetría no forma parte del parche. La preparación offline añadida posteriormente se describe por separado en [telemetry-offline-validation.md](telemetry-offline-validation.md), sin activar envío remoto.

No cambia el esquema, las claves, los eventos, los límites, el consentimiento, los permisos ni la política de retención. No añade colas ni persistencia. Tampoco modifica la observación del juego, sus órdenes, Drive o el panel de métricas. El informe sigue siendo orientativo: sin compare-and-swap, escritores concurrentes todavía pueden perder incrementos.

## Fallo causal

Una pestaña B prepara un incremento desde cero y queda retrasada antes de escribir. A registra un primer incremento y luego otro: su estado esperado pasa de 1 a 2. Entre esa segunda escritura y su verificación, B guarda el 1 que había preparado. Ese snapshot es canónico y válido, pero coincide exactamente con el estado anterior de A. El núcleo lo confundía con una escritura ignorada y activaba `write-unverified`, deteniendo A hasta una nueva activación explícita. No había fallado el almacenamiento.

Se conservó el mismo harness en `tests/metrics-contention.test.cjs` y se ejecutó sobre la base, antes de editar los fuentes:

```sh
node --test tests/metrics-contention.test.cjs
```

Primera reproducción: 9 casos, 2 aprobados y 7 fallidos. El caso causal `metrics contention: a delayed valid tab write cannot permanently stop another tab` falla por `false !== true` en el segundo registro de A. Los otros fallos describen los límites que deberá cumplir el nuevo reintento; no todos son fallos de privacidad de la base. En particular, varios escenarios de revocación ni siquiera alcanzaban entonces la fase de reintento. No se presenta esa ausencia de ejecución como una filtración.

La revisión independiente añadió 18 casos adversos, incorporados en `tests/metrics-contention-review.test.cjs`. Se extrajo la base con `git archive` en una carpeta temporal y se copiaron sin modificar ambos archivos finales. El comando `node --test tests/metrics-contention.test.cjs tests/metrics-contention-review.test.cjs` dio **8/27 en la base y 27/27 en la candidata**. Los fallos en la base incluyen expectativas de recuperación nueva y límites de fases entonces inexistentes; el bloqueo por el escritor retrasado es la reproducción causal que justifica la corrección.

## Corrección acotada

- Solo una verificación canónica que coincida exactamente con el estado anterior puede solicitar recuperación. Las excepciones, `false`, promesas, corrupción y reloj inválido no se reintentan.
- Se vuelve a leer y comprobar consentimiento y contadores. La generación debe coincidir con la del evento original: una desactivación o un ciclo desactivar→activar nunca autoriza reproducir ese evento en la generación nueva.
- Se permite un segundo intento máximo. Si también es ignorado, la medición se detiene con el mismo aviso. No hay bucle, timer, cola, retraso de escritura ni reproducción futura.
- Si el snapshot fresco ya contiene al menos el estado esperado del primer intento, no vuelve a sumar el evento. Se conserva y verifica ese agregado saneado. La comparación respeta la retención del día actual.
- Se conservan los contadores independientes de otro escritor y se repite la verificación estricta. La desactivación durante una escritura continúa invalidando su generación y borrando sus bytes de la mejor forma posible.

## Matriz y costes

Los casos cubren dos y tres escritores, segunda escritura ignorada, fallos explícitos o asíncronos, estado no canónico, error de lectura, revocación antes de releer/durante lectura/durante escritura, desactivar→activar, conservación de otro contador, restauración tardía del incremento original, cambio de día, purga de retención y saturación. Se ejecutan además los tests existentes de minimización, exportación y UI, borrado, generaciones, builders y ausencia de transporte.

En el camino normal continúa habiendo una escritura de contadores por evento, ninguna escritura de consentimiento y ninguna llamada de red. La medición sintética del wrapper de la base da 4 lecturas de consentimiento y 2 de contadores por registro; la actualización ordinaria del estado de la UI añade 2 y 1, respectivamente. Cien muestras imperiales idénticas ya producen un solo evento y una sola escritura, o cero escrituras sin consentimiento. La recuperación excepcional añade como máximo una escritura de contadores; una limpieza de revocación es independiente y no cuenta como un nuevo evento. Estos son recuentos de operaciones locales en Node VM, no tiempos de una sesión real.

Se detectó también que la navegación de pestañas refresca dos veces el panel de métricas. No se mezcla esa optimización menor con esta corrección de fiabilidad.

## Límites y revisión final

El gate completo se ejecuta sobre el commit final limpio y comprueba todos los tests seguidos, sintaxis, versiones, feedback y dos ejecuciones reproducibles de cada builder. Los informes y la revisión independiente se guardan fuera del árbol para no modificar los bytes validados. Una suite focal verde no sustituye el gate final ni la revisión independiente.

Quedan pendientes Brave/Violentmonkey, Google Drive y sesiones reales con varias pestañas. No se conectó al juego ni se enviaron órdenes. La contención se modela de forma determinista con adaptadores síncronos y snapshots separados; no se afirma una garantía contable ni una medición de rendimiento real.

Límite preexistente: si desactivar consigue guardar el consentimiento apagado pero el navegador impide tanto sobrescribir como eliminar los contadores, la instancia avisa de bytes pendientes. Si luego se recarga, ese diagnóstico en memoria no persiste; los bytes pueden seguir en almacenamiento aunque no se exportan ni se registran eventos con el consentimiento apagado. Esta candidata no añade un marcador persistente ni cambia ese comportamiento. La UI ya permite volver a «Borrar y desactivar».
