# Diagnósticos imperiales 1.15.0

Diagnósticos incorporados a 1.15.0 sobre la base de rendimiento 1.14.3. Las cifras históricas siguientes corresponden al hito independiente; la validación de la release está en el documento conjunto.

La cifra de pruebas de este documento corresponde al hito independiente de diagnósticos. Esta copia lo compone con sync; los resultados agregados están en la [validación del conjunto](empire-combined-validation.md).

## Alcance integrado

Base: `eae5ca5aaed88276c44ef93877f03be96b6b439b` (rendimiento 1.14.3). Cambios preparados en `d173eba148ffcd4a52499b41a4011066e8b311b1`, aplicados en una copia independiente sin tocar los repositorios originales.

- `world.delta` anterior al init: reconoce el sobre JSON y objeto acotados y devuelve `missing-init`. Sigue rechazando sobres malformados, profundidad excesiva, tramas sobredimensionadas y tipos inválidos. No retiene el cuerpo para proyectarlo más tarde. Un init completo y validado sigue siendo imprescindible para permitir pedidos.
- `bridge.status()`: conserva las categorías previas y añade solo `connectionObserved` y `complete`, ambos booleanos. No devuelve IDs, generaciones, censo ni tramas.
- Métricas opt-in existentes: añade únicamente `ui.tab.empire` y los nueve códigos congelados del lector. Se cuentan transiciones, no cada frame ni cada consulta. Un estado observado antes de activar no se reproduce retroactivamente.

Las categorías de arranque son `installation_failed`, `socket_unobserved`, `awaiting_init`, `missing_init`, `format_rejected`, `observation_rejected`, `census_received`, `connection_lost` e `incomplete`, bajo el prefijo `empire.observer.`. No se añadieron otras métricas ni dimensiones.

El consentimiento y la nota del informe explican ahora explícitamente la apertura de Imperio, las categorías del lector, deduplicación y ausencia de replay. El JSON visible y exportado contiene únicamente `schema`, `version` y días UTC con contadores. No incluye el censo, IDs de cuenta/sistema, payloads, errores crudos, credenciales ni el token local de revocación del consentimiento. No hay envío remoto ni incorporación a copias/Drive.

## Corrección de la prueba congelada

La prueba anterior estaba detenida en 9/10 por una expectativa incorrecta: `setEnabled(false)` devuelve `true` cuando la revocación y el borrado fueron verificados; no devuelve el estado activado. El contrato ya estaba cubierto por las pruebas del núcleo.

También se corrige su aserción final, hasta ahora inalcanzada: el borrado normalmente escribe un estado válido con `days: []`. Eliminar la clave es solo la recuperación si no se confirma esa escritura. Exigir ausencia de la clave confundía eliminación de contadores con eliminación del sobre local.

La prueba completa comprueba consentimiento desactivado, cero contadores persistidos, otra pestaña sin nuevas escrituras, rechazo de `ui.tab.empire` tras opt-out y reactivación sin recuperar el estado visto durante la revocación. Un cambio posterior válido vuelve a contar normalmente. No se cambió el contrato ni el código de revocación para satisfacer la prueba.

## Límites de almacenamiento y retención

- 36 categorías en total, 30 días UTC y máximo 1.000.000 por contador, todos sin cambios salvo las diez categorías ya preparadas.
- El peor JSON válido, con las 36 categorías saturadas durante 30 días, versión de longitud máxima y token de consentimiento, ocupa 33.676 caracteres ASCII (también 33.676 bytes UTF-8). El lector admite hasta 65.536 caracteres. El límite existente sigue siendo suficiente; no se amplió.
- Una prueba pasa ese máximo por el adaptador real de localStorage y verifica lectura y escritura. Al avanzar un día, el informe omite el día caducado y el próximo evento lo purga del almacenamiento.
- Un estado activo que excede 65.536 caracteres detiene las métricas y no genera nuevas escrituras. No se cambia el manejo de fallos ni la advertencia existente.

## Preservación de 1.14.3

En el hito aislado de diagnósticos, `empire-core.js`, `empire-runtime.js`, `empire-adapter.js`, `empire-panel.js`, `drive.js`, `sync-core.js`, los cuatro builders y el archivo meta son idénticos a la base. El bloque de metadatos completo también es idéntico: conserva los cinco grants ya aprobados, sin permisos ni conexiones adicionales. La función `schedule` y `updateEmpireState` son idénticas.

Se conservan `readBundle` fresco por llamada y preflight, `systemPolicy` desacoplada, render oculto sin lecturas y scheduler imperial de hasta 50 ms. La suscripción al puente añade únicamente una lectura del resumen reducido antes de la llamada habitual a `schedule`; no lee el snapshot del mundo para las métricas.

En el hito aislado de diagnósticos no se integró la sincronización imperial preparada aparte ni se cambió la autorización de pedidos, navegación, selección, propiedad, frescura o barrera posterior a pedidos. Esta copia conjunta añade después el hito de sync, cuyos módulos y documentación tienen su propia verificación.

## Verificación

- Suite completa: **1108/1108**, cero fallos, omitidas o pendientes.
- Cuatro builders ejecutados dos veces, salida idempotente.
- Sintaxis del userscript y módulos afectados, y `git diff --check`, correctos.
- Revisión propia del diff y comparación literal de módulos, metadatos y funciones de rendimiento.
- Bancos sintéticos de runtime, panel y prioridad ejecutados. El panel de 50 sistemas mantiene cero escrituras de texto cuando no cambian los datos (mediana aproximada 0,51 ms en esta ejecución); sin misión pendiente, prioridad no lee censo ni comprueba un permiso de misión inexistente; con misión conserva dos lecturas frescas. Son mediciones parciales de Node, no un resultado en Brave/Violentmonkey ni una comparación controlada entre máquinas.

Para reproducir:

```sh
node build-empire.cjs
node build-metrics.cjs
node build-sync.cjs
node build-drive.cjs
node --check old-light-auto-upgrade.user.js
node --test tests/*.test.cjs
git diff --check
node benchmarks/empire-runtime.cjs
node benchmarks/empire-panel.cjs
node benchmarks/empire-priority.cjs
```

El conjunto cuenta con revisión independiente; su validación final está documentada en [1.15.0](empire-combined-validation.md). Las pruebas diagnósticas son sintéticas. Durante ellas no se inició una partida, abrió socket adicional, realizó un pedido, cambió permisos ni autorizó OAuth. La mejora diagnóstica explica la falta de init; no recupera retroactivamente un estado nativo nunca observado.
