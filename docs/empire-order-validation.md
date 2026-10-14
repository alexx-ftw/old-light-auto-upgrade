# Validación de la barrera del censo imperial 1.15.1

Base publicada: 1.15.0, commit `a03e6f0362e7b44e85acd7672b719a96802789e8`. El checkpoint de estados Drive `61aa5f162186d963d99ee42b9d1d2a9d169aaf19` conserva la corrección independiente y su revisión; esta entrega añade únicamente el ajuste del momento de la barrera del pedido y sus regresiones.

## Evidencia y causa reproducida

La captura mostraba «El censo imperial no está disponible o es ambiguo», «0 de 2 sistemas con datos recientes», recursos desconocidos y flota sin censo sincronizado. Ese texto se produce después de aceptar un roster completo y reciente, cuando se rechaza alguna fila del lote; no demuestra por sí solo que el lector haya perdido su conexión o que Drive haya fallado.

La integración incorporaba el nuevo censo al principio del ciclo. Después, al reconocer la confirmación del pedido en el HUD, llamaba a `invalidate` con la hora actual y la revisión recién incorporada. La barrera exigía otra revisión más reciente y descartaba justamente el censo de confirmación. Con dos sistemas, el coordinador vaciaba las mediciones para no autorizar pedidos con un lote incompleto: el panel reproducía las cuatro líneas de la captura.

El control simulado usó una revisión nativa con cola aumentada y recursos descontados. Una barrera anterior al envío rechazó correctamente la revisión previa y aceptó esa confirmación; una barrera creada después de incorporarla reprodujo el bloqueo. La captura por sí sola no identifica si ese fue el caso del usuario.

Una caducidad general de más de 120 segundos normalmente descarta también el roster y muestra 0 de 0, no el estado persistente de la captura. Cruzar exactamente ese umbral entre dos lecturas puede mostrar el mismo aviso durante un ciclo, antes de pasar a 0 de 0. No se amplía el plazo ni se reutilizan permisos caducados.

## Cambio y límites

La comprobación previa al clic captura una marca opaca del bundle recién validado, ligada a cuenta/galaxia, sistema, hora, censo y época de configuración. La referencia que acompaña a la petición local es opaca; sus metadatos viven únicamente en una WeakMap privada. No se persiste ni se exporta. Capturar deshabilita inmediatamente la autoridad actual y cancela navegación; la petición pendiente mantiene el bloqueo de envíos y navegación durante la respuesta.

Al confirmar, `invalidate` consume una vez la marca y aplica la barrera con la referencia previa al envío, sin reducir una barrera existente. Una marca ausente, manipulada, reutilizada o de otro contexto usa la invalidación conservadora actual. No se sustituyen las guardas por el marcador: cada pedido sigue requiriendo identidad, propiedad, selección, HUD, censo completo y reciente, revisión diferente y fecha estrictamente posterior a la referencia del envío.

Se descartó un traslado simple de `invalidate` antes del clic porque habría añadido esperas nuevas tras un rechazo sin delta. La marca no crea una barrera hasta confirmar, por lo que conserva los caminos de reintento anteriores en rechazos/no envío. Tampoco retira una barrera por timeout ni renueva artificialmente la fecha de los datos. Los resultados inciertos conservan las pausas y controles previos. No se crean peticiones nuevas ni se fuerza una reconexión.

Los tests utilizan código de producción y datos sintéticos. No se hicieron acciones de partida, autorizaciones de Google ni pruebas de pedidos en una sesión real. Tampoco se capturaron tramas del usuario, cuentas o secretos. Cuando el único motivo de rechazo es esa barrera y el resto del lote es completo y coherente, el panel explica que espera un censo posterior al pedido confirmado. Datos ausentes, duplicados, de otra identidad, caducados o incompletos conservan su diagnóstico de rechazo, sin presentar la espera como permiso.

La corrección de [estados Drive](drive-status-validation.md) se valida junto a esta sin alterar su autenticación o fusión de preferencias.

## Cierre de la revisión

La [matriz ampliada](1.15.1-validation-matrix.md) contiene los resultados por flujo y sus límites. La suite final suma 1250 casos: 1181 anteriores, 7 regresiones Drive, 38 de barreras y 24 del pipeline completo offline. El revisor independiente repitió la suite y añadió 19 casos adversarios, 7 comprobaciones de integridad/compatibilidad y 3 de Drive, sin encontrar bloqueos en el código final. Otros 4 controles dinámicos con un marcador sentinel comprobaron backup, journal, ETA, eventos y métricas: ninguna ruta leyó o serializó la marca de pedido. Cuatro builders ejecutados dos veces conservaron exactamente el userscript; la sintaxis y el diff-check pasaron. Las repeticiones y los 24 casos del pipeline no se cuentan dos veces.

Durante la revisión se corrigieron dos casos adicionales antes de congelar las fuentes: la invalidación de fallback debía conservar todos los IDs prohibidos en una barrera con timestamps empatados; y el diagnóstico de espera debía tener el mismo resultado con lectores legacy y bundle. La documentación no atribuye definitivamente la captura del usuario al defecto reproducido.
