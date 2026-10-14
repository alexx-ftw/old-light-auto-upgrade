# Sincronización imperial 1.15.0

Esta entrega integra la política imperial sobre la base 1.14.3 (`4970f50c63c7311de2011ddfe2badffb756277d9`, equivalente local `eae5ca5aaed88276c44ef93877f03be96b6b439b`). Conserva los hotfixes del observador y las mejoras de rendimiento: readBundle fresco, systemPolicy acotada, guardas del panel y scheduler imperial de 50 ms. Incluye también los diagnósticos locales opt-in, separados de los documentos de preferencias. Véase [validación de la release](empire-combined-validation.md).

## Qué comparte

A través de la sincronización automática de Drive ya existente:

- Los cuatro objetivos globales de flota, cada uno como un registro independiente.
- El rol y la casilla **Atender** de cada UUID de sistema, también como registros independientes.
- Solo dentro del mismo perfil de juego, identificado por cuenta y galaxia, y de la misma asociación de Google/Client ID.

No comparte la activación global de Imperio, nombres de sistemas, recursos, observaciones, colas, planes, órdenes ni estados de ejecución. No añade credenciales, permisos de Google, grants del userscript, servidores o conexiones. Los campos anteriores de sincronización mantienen su comportamiento previo.

La interfaz avisa de que **Activar imperio** y **Detener imperio** siguen siendo decisiones locales. Una política recibida no activa un cliente nuevo. El cliente que ya está activo recalcula su plan antes de cualquier pedido con la nueva política.

## Conflictos, eliminación y arranque

Los registros usan el mismo reloj lógico y escritor del motor existente. Ediciones simultáneas de diferentes naves, sistemas o campos se combinan sin sustituir la política entera. El conflicto del mismo campo tiene resolución determinista.

Si la configuración imperial todavía no se ha cargado, su ausencia no se interpreta como un borrado: se conservan tanto los registros como las últimas observaciones del diario. La exportación comprueba que el perfil del coordinador coincide con la cuenta/galaxia actual; no adjunta la política anterior durante una transición.

Retirar una entrada genera marcas de eliminación para sus dos campos. Una meta eliminada vuelve a cero, un rol a Equilibrado y Atender a falso. La entrada conserva la identidad y el nombre local; el estado seguro no vuelve a publicarse como una edición nueva por el simple hecho de haber sido aplicado. Los UUID nuevos también empiezan desatendidos hasta aplicar un valor remoto explícito para Atender.

Los objetivos aceptan enteros de 0 a 1.000.000, los roles están enumerados y los UUID de los documentos son canónicos en minúsculas. Hay límites de 1.024 UUID, incluidas marcas de eliminación, y de 1 MiB. La unión de varios documentos también respeta esos límites. Los fallos de validación no dejan cambios parciales del diario.

## Aplicación y fallos

El Helper espera si existe un pedido pendiente, navegación imperial, importación, envío de misión, reintento o edición activa. Aplicar la política invalida el plan previo; no reutiliza autorizaciones de acción calculadas con otras preferencias.

La aplicación incluye restauración de los ajustes anteriores si falla alguna escritura. Si también falla esa restauración, se detiene la sesión y se intenta guardar el Helper pausado e Imperio desactivado. Cuando el almacenamiento no permite guardar la pausa, el texto explica que solo está garantizada en esa sesión y que hay que revisar el almacenamiento antes de recargar. No se presenta una pausa en memoria como protección persistente.

Las copias completas siguen siendo una restauración deliberada y dejan Imperio desactivado, igual que en 1.14.0. La importación de preferencias automáticas conserva el interruptor local en su estado anterior.

## Compatibilidad y despliegue

Se mantiene el documento schema 1 y se admiten documentos y copias antiguos sin campos imperiales. La migración desde una copia imperial completa conserva el perfil necesario para validar su ámbito.

**Hay que actualizar todos los Helpers que sincronicen ese perfil.** Las versiones anteriores desconocen los registros imperiales y rechazan el documento completo; no hacen una aplicación parcial ni borran esos campos. Esto protege el estado, pero no ofrece interoperabilidad completa entre clientes antiguos y nuevos. La URL versionada de `sync-core.js` del companion se actualiza para no reutilizar el núcleo antiguo en caché; deben cerrarse y reabrirse las ventanas de Drive antiguas al actualizar.

La publicación futura debe incluir conjuntamente el userscript regenerado, `docs/sync-core.js`, el companion HTML con caché renovada y la documentación. El token y motor de autorización de Drive permanecen sin cambios.

## Verificación

El hito independiente de sync pasó **1.168 pruebas automatizadas**, con cero fallos, omisiones o pendientes: las 1.095 de la base de rendimiento, las 70 de sincronización previamente revisadas y 3 nuevas de composición. Estas últimas verifican que guardar en el panel notifica a Drive sin perder las guardas de visibilidad; aplicar política remota invalida el plan y conserva una lectura fresca por actualización/permiso; y recibir política no activa un cliente detenido ni cruza cuentas. Los generadores reproducen el contenido embebido y se verifican sintaxis y diferencias. Las pruebas de sincronización incluyen 31 del núcleo, 11 de la aplicación real de preferencias, 21 de revisión y 7 de transporte entre dos clientes. Se mantiene el conjunto exacto de cinco grants que la base conserva desde 1.14.1; la sincronización no añade ninguno.

Las pruebas de transporte ejecutan el scheduler y las operaciones del companion contra un Drive simulado, incluidos multipart, cambios de cuenta, trabajo sin conexión, diarios persistidos, caché y reintentos. No utilizan Google real, credenciales nuevas ni una partida de juego. Las nuevas rutas de sincronización se han validado con simulaciones; no se afirma una prueba con Google ni con una partida real.

```sh
node build-sync.cjs
node build-empire.cjs
node build-drive.cjs
node build-metrics.cjs
node --check old-light-auto-upgrade.user.js
node --test tests/*.test.cjs
git diff --check
```

## Integración y conservación del hotfix

El parche original de sincronización `67daae7f86e8adaf9332e04ea39112f43d20b551` se integró primero sobre 1.14.1 en `2828beb1acc0c069a90fd23a539002257e0bfaf9`, después sobre 1.14.2 en `cd33e92cfc33962952047223b2beb710fee23a70` y ahora sobre 1.14.3. Solo apareció un conflicto en installEmpirePanel: se conservan tanto settingsChanged() al guardar, requerido por sincronización, como isVisible(), requerido por rendimiento. La resolución tiene una regresión dedicada.

En el hito aislado de sync permanecieron byte por byte iguales a 1.14.3 el observador, puente privado, adaptador, runtime, núcleo imperial, generadores, motor de Drive y metadata de permisos. La release conjunta añade las categorías de diagnóstico y el nuevo número de versión, sin ampliar grants ni capacidades. El panel solo añade el aviso de sincronización; conserva sus optimizaciones. El scheduler, los accesos systemPolicy y las comprobaciones frescas de permiso tampoco cambian. El núcleo de sincronización sigue siendo idéntico al de la candidata anterior; no se añadieron capacidades ni un permiso nuevo.

Las copias y checkpoints anteriores se conservan independientes. La versión final de esta integración es 1.15.0. La verificación de sus nuevas rutas utiliza datos, DOM, reloj y transporte simulados; no hay una prueba de sync con Google real ni de ejecución en una partida.
