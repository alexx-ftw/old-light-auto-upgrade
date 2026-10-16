# Protocolo de revisión técnica independiente

Este protocolo define el encargo del revisor externo de código para cada candidata. Complementa el [gate de publicación](release-validation.md): ejecutar la suite no sustituye revisar el producto ni el realismo de sus pruebas. El objetivo es encontrar supuestos falsos y recorridos rotos, no acumular tests ni prometer una revisión infalible.

## Entrada y método

El encargo debe incluir commit base y candidato, diff, comportamiento solicitado, informes de fallos, matriz de validación y límites conocidos. El revisor inspecciona el árbol exacto y los [criterios históricos de feedback](review-feedback.json), sin asumir que las conclusiones del autor son ciertas. Si falta evidencia, lo declara; no la rellena con una suposición favorable.

1. **Reconstruir el recorrido del usuario.** Desde el estado inicial realista hasta el resultado visible: arranque, datos disponibles, foco, modificadores, eventos, espera asíncrona, confirmación y cancelación. Seguir las funciones y listeners de producción, no solo sus helpers. Escribir qué ve y qué puede hacer el usuario en cada salida.
2. **Enumerar las hipótesis que hacen funcionar el cambio.** Para cada dependencia, preguntar quién garantiza disponibilidad, identidad, frescura, orden y autoridad. Identificar cómo podría fallar y qué evidencia la respalda. Un mock que siempre proporciona cámara, censo o respuesta válida no demuestra que producción lo haga.
3. **Revisar las fronteras de integración.** Contrastar DOM/Shadow DOM, contexto aislado/página, bridge, imports y forma de módulos, datos nativos, navegador y servicios afectados. Usar fuentes observadas con versión/hash cuando estén disponibles. Distinguir contrato documentado, implementación inspeccionada y comportamiento efectivamente observado.
4. **Intentar refutar la solución de forma independiente.** Derivar casos adversos propios del contrato y del recorrido antes de limitarse a repetir los del autor. Buscar también un flujo legítimo que la guarda pueda romper. Ejecutar probes en copia aislada y guardar comando, bytes, resultado esperado y observado; no alterar la candidata revisada. Comparar antes/después con el mismo harness cuando se afirme una reproducción causal.
5. **Cuestionar el harness.** ¿Reproduce orden de registro, captura/burbuja, retargeting, defaults, temporizadores, reentrada y revocaciones? ¿Está copiando la lógica que pretende verificar? Inspeccionar al menos la frontera decisiva contra producción. Un harness más detallado sigue siendo una simulación.
6. **Comprobar utilidad y degradación.** No basta impedir una acción peligrosa: verificar que el camino permitido sigue siendo alcanzable. Si falta una dependencia, comprobar un fallback válido y fresco si existe, o un estado visible con motivo y siguiente paso seguro. No aceptar un callejón sin salida silencioso ni inventar datos para desbloquearlo. Mantener las barreras de seguridad y permisos.
7. **Cerrar contra el árbol final.** Tras cualquier corrección, revisar su diff, repetir las reproducciones afectadas y obtener el gate del commit final. No trasladar una aprobación de bytes anteriores. Indicar expresamente lo que sigue sin comprobarse.

## Revisión adversarial del overlay

Ante parpadeo o cambios de flechas, aplicar el [procedimiento temporal](overlay-validation-process.md). El encargo debe incluir reproducción anterior al cambio, versión instalada/publicada por separado y serie evento → antes de frame → callback ejecutado → después. Derivar un probe propio y comprobar sensibilidad al eliminar callbacks. Verificar el dispatcher real del harness: contar vueltas o usar un Map que producción no consume puede dar un falso positivo.

Exigir continuidad de visibilidad/identidad y controles negativos de cámara/censo/gesto; no confundir dos snapshots correctos con pintura continua. Una revisión de otro árbol o un probe cuyo reloj no se ejecutó no se hereda como evidencia. La revisión final debe indicar expresamente si hubo navegador/compositor real y confirmación del usuario.

## Checklist para gestos y estado asíncrono

Aplicar al gesto Ctrl y a cambios equivalentes; justificar lo que no aplique.

- [ ] Con cámara disponible, el hit-test válido adquiere el gesto; un hit-test rechazado no activa un fallback reservado a cámara ausente.
- [ ] Con cámara ausente o fallida, recorrer desde el movimiento/hover inicial hasta el borrador. Verificar disponibilidad real de la ficha, identidad, censo, tiempo y posición; un origen ambiguo o viejo no sirve.
- [ ] Si el gesto no se adquiere, seguir qué hace el evento nativo: ¿desplaza el mapa, selecciona o no hace nada? Comprobar que el mensaje/ayuda explica la limitación y que no se secuestra input ajeno.
- [ ] Dibujar la secuencia `window → document → canvas` y su retorno, con fase y orden de registro por tipo de evento. En la evidencia de Pixi de 1.17.1: down en canvas capture, move en document capture y up en window capture previo al Helper. No suponer que un listener posterior puede deshacer uno ya ejecutado.
- [ ] Verificar pointer capture, movimiento fuera del mapa y pérdida accidental de captura. Distinguir `lostpointercapture` implícito tras pointerup de una cancelación durante el arrastre; la primera no debe destruir una verificación de destino aún válida.
- [ ] Reproducir destino válido con demora de ficha y todas las cancelaciones relevantes: Escape, soltar Ctrl, blur, pointercancel, salida y captura perdida. Durante la espera, repetir cambio de epoch, ámbito/ruta, identidad o desaparición del origen. Un callback antiguo no revive el gesto.
- [ ] Probar controles vecinos: pan ordinario, Shift, foco/borradores y clicks nativos. Abrir un borrador no equivale a enviar una orden; comprobar ausencia de efectos no autorizados.
- [ ] Cuando la cámara es inválida, no dibujar flechas con anclas hover antiguas. Separar la disponibilidad del borrador por ficha de la disponibilidad de una reproyección continua.

Referencias: [reproducción y alcance de 1.17.1](1.17.1-validation.md), [pruebas del panel](../tests/reinforcement-panel.test.cjs) y [pruebas del mapa](../tests/reinforcement-map.test.cjs). Son evidencia offline; no acreditan una sesión real de Brave/Violentmonkey con Drive.

## De cada fallo a una pregunta de revisión mejor

Cada nuevo bug comunicado debe dejar una lección, también cuando no se reproduce. Añadir un test mejora la cobertura; cambiar la hipótesis y la pregunta del encargo mejora cómo razona el revisor. Se necesitan ambas cosas cuando el fallo es reproducible. Registrar: observación, hipótesis fallida o aún por contrastar, pregunta nueva del revisor, evidencia que podría refutarla, y límite pendiente. No atribuir al usuario una causa que solo se reprodujo en una fixture. Para los fallos reproducibles, actualizar además `review-feedback.json` con su esquema vigente y las regresiones exactas. No añadir campos al manifiesto para este registro narrativo.

| Incidente / evidencia | Hipótesis de revisión a cuestionar | Pregunta o prueba independiente que cambia | Límite que debe conservarse |
| --- | --- | --- | --- |
| Ctrl arrastra el mapa en 1.17; [reproducción](1.17.1-validation.md), entrada `reinforcement-ctrl-native-pan` del manifiesto | El camino feliz con cámara implica que Ctrl adquiere el gesto en producción | Empezar sin cámara: hover → Ctrl → down → move → up; seguir el evento hasta Pixi si `pick` rechaza. Reproducir también el fallback permitido y el rechazo con cámara disponible | Cámara ausente reproduce el pan offline; no demuestra por qué faltaba en aquella sesión ni prueba usabilidad real |
| Captura y ficha retardada; [casos del panel](../tests/reinforcement-panel.test.cjs) | Toda pérdida de captura cancela; al soltar el ratón ya terminó la operación | Emitir pointerup → liberación implícita → ficha válida tardía, y por separado pérdida accidental durante drag. Soltar Ctrl también durante la espera | La fixture debe respetar el listener nativo previo de pointerup; falta navegador real |
| Cambio de epoch/path/origen durante espera; [casos del panel](../tests/reinforcement-panel.test.cjs) | Una ficha o selección válida al inicio conserva autoridad al completar | Cambiar cada dimensión mientras está pendiente; exigir cero borradores/órdenes del contexto anterior y permitir un gesto nuevo válido | No equiparar igualdad de valores a continuidad de una generación |
| Teclado Helper; [matriz](1.16.1-validation-matrix.md), entrada `helper-shadow-keyboard-isolation` | Un INPUT seguirá siendo INPUT para todos los listeners y contener teclas no afecta su liberación | Revisar composed path/retargeting, G en ShadowRoot, Escape en drag y WASD juego → Helper → keyup | No se revierte captura previa; IME y defaults reales no están acreditados por callbacks sintéticos |
| Ctrl sigue desplazando el fondo en 1.17.1; [reproducción](1.17.2-validation.md), entrada `reinforcement-ctrl-intent-before-authority` | Rechazar una identidad obliga a dejar pasar down y los errores dentro del panel equivalen a feedback visible | Separar reserva del gesto de autorización de extremos; exigir ausencia de pan en cada salida, aviso visible con panel cerrado, preview sin autoridad y selección manual vacía cuando no hay origen | La degradación manual no acredita arrastre directo sin cámara; la causa concreta de cámara sigue pendiente en la sesión afectada |

| Ruta en revisión y misión «Lista»; [evidencia](1.17.3-queue-validation.md) | waiting + flota completa autoriza envío y la cola puede modificar cualquier misión | Pausar/reconciliar/reanudar y modificar producción; verificar propietario en tarjeta, contador, controles y guardas; recuperar ticket legado sin limpiar incertidumbre | No conocemos la cronología de la sesión ni si hubo envío; las guardas nativas anteriores ya bloqueaban la ruta |

| Cámara esperando observación; [clase oficial y regresión](camera-unproject-regression.md) | Todo render llama a project en CPU | Ejecutar bounds y hover nativos sin una sola llamada a project; preservar semántica de unproject y rechazar viewport incompatible | La reproducción oficial no prueba la causa exacta ni geometría del dispositivo afectado |

El incidente Ctrl muestra por qué una suite verde, incluso un recuento de 1.862 pruebas, no responde «¿puede el usuario completar este recorrido con las dependencias que realmente tiene?». El recuento no es evidencia de disponibilidad de cámara, adquisición del gesto ni calidad del harness. La conclusión debe apoyarse en el caso y sus límites, no en esa cifra.

Para nuevas filas usar esta plantilla breve:

> Observación y fuente: … / Hipótesis fallida o pendiente: … / Nueva pregunta al revisor: … / Experimento que podría refutarla y resultado: … / Camino legítimo preservado: … / Incertidumbre o QA pendiente: …

## Dictamen y bloqueantes

El informe debe separar:

- **Hechos verificados:** commit/árbol, archivos y líneas, comandos, resultados observados y alcance (estático, sintético, navegador aislado o integración real).
- **Hallazgos bloqueantes:** reproducción o razonamiento causal verificable de un contrato roto, pérdida de guardas, efectos no autorizados, estado obsoleto aceptado, flujo prometido inaccesible sin degradación útil, o una afirmación de evidencia falsa. Para cada uno: pasos, esperado/observado, impacto y criterio de cierre. Una suite verde no rebaja un bloqueante conocido.
- **Limitaciones y QA pendiente:** escenario y entorno exactos, motivo de falta de evidencia, riesgo y comprobación necesaria. No marcar «aprobado» ni atribuir causalidad por no poder ejecutarlo. Si falta evidencia esencial para el contrato principal, el dictamen queda inconcluso para ese alcance.
- **Conclusión acotada:** bloqueantes encontrados o ninguno encontrado dentro del alcance examinado; qué incertidumbre permanece. No decir «sin bugs». La decisión de publicación corresponde al mantenedor bajo sus reglas, sin convertir QA pendiente en validación real ni tratar este informe como autorización para actuar en cuentas/partidas.

## Encargo breve reutilizable

Copiar en el encargo de cada revisión y completar los campos; añadir los criterios específicos de las entradas relevantes del manifiesto:

```text
Revisa independientemente BASE=<commit> frente a CANDIDATA=<commit>.
Contrato y fallo comunicado: <comportamiento y fuente>. Evidencia y límites: <rutas>.
Sigue docs/independent-code-review.md y los criterios pertinentes de docs/review-feedback.json.
Reconstruye el recorrido del usuario con código de producción y dependencias reales; enumera y cuestiona los supuestos de integración y del harness. Diseña probes adversos propios, además de repetir los existentes. Verifica tanto bloqueos/cancelaciones como el camino legítimo, fallback fresco y feedback cuando una dependencia falla. Para gestos, contrasta orden window/document/canvas, captura, liberación implícita, espera y cambios de generación.
No equipares tests verdes con usabilidad ni simulación con sesión real. Trabaja sobre una copia aislada, sin modificar/publicar la candidata ni efectuar acciones reales no autorizadas.
Entrega hallazgos priorizados con archivos/líneas, pasos o comando, esperado/observado, impacto y cierre; separa hechos, hipótesis, bloqueantes y QA pendiente. Por cada fallo descubierto o comunicado, indica qué hipótesis de revisión falló y qué pregunta/evidencia debe conservarse para futuras revisiones. Cierra con un dictamen limitado al commit y alcance revisados.
```

## Lección 1.17.4: altura visible no equivale a límite fijo

Observación: captura con scroll y unos 300 píxeles libres bajo el panel. Hipótesis fallida: 720 píxeles CSS bastan para cualquier viewport. Pregunta al revisor: ¿el anclaje superior y el mínimo utilizable sobreviven a drag/cancelación, resize y restauración? Evidencia requerida: contrato CSS y pruebas de layout productivo; el harness de rectángulos no acredita render. Camino conservado: minimizado compacto y margen inferior. QA pendiente: Camoufox y sesión real, explícita en la matriz 1.17.4.

## Lección 1.17.5: un lock no vuelve fresca una caché del gestor

Observación: el primer borrador del comprobador abría dos instaladores con cachés GM distintas, aunque los callbacks adquirieran Web Lock en serie. Hipótesis fallida: esperar GM.setValue garantiza que GM_getValue en otra pestaña observe la escritura. Pregunta nueva: ¿quién garantiza la frescura de la lectura después del lock, y qué acuse espera realmente la API? Evidencia: implementación oficial y constructor productivo con cachés obsoletas, [revisión 1.17.5](1.17.5-update-review.md). Añadir reentrada durante escritura, doble clic y reintento desde pestaña antigua; el registro no debe retroceder y la degradación manual debe seguir utilizable. Límite: los dobles no acreditan permisos, interceptación del instalador o experiencia real del navegador.

## Lección 1.17.11: ruta activa no demuestra oportunidad de envío

Observación: ruta reanudada con intervalo 15 min, excedentes con reserva cero y cola vacía; ningún envío observado por el propietario. Hipótesis que falta contrastar: la ruta tiene flota disponible, controles nativos legibles, coordinación y plazo vencido. Pregunta nueva: ¿qué condición efectiva impide preparar el ticket y dónde puede verla el usuario? La captura no contiene esos valores; no asignar causa por exclusión ni quitar guardas. Evidencia: [matriz de diagnóstico](1.17.11-route-diagnostics-validation.md), constructor productivo de diagnóstico y pruebas de núcleo/panel. Exigir que consultar no altere almacenamiento, tickets ni efectos; que el texto cambie al recuperar la dependencia y conserve el foco de los controles. QA pendiente: causa exacta de la sesión y representación en navegador real, sin enviar órdenes para comprobarla.

## Lección 1.17.12: una petición inmediata no es autorización ilimitada

Petición: cuenta atrás por ruta, acceso sobre flecha y envío inmediato. Hipótesis a refutar: omitir el intervalo implica permiso para enviar cualquier flota o revivir una ruta pausada. Exigir un ticket único con cantidades fijadas, reserva/tipos/cantidad máxima vigentes, origen y propiedad frescos, exclusión de otros pendientes, Web Locks y revisión nativa final. Preguntar por doble clic, otra pestaña, callback reentrante y claim recuperado. Separar ETA de vencimiento y envío confirmado; al editar intervalos conservar comprobantes. El control de flecha debe seguir cámara/zoom actuales sin interceptar el resto del mapa, ocultarse sin proyección y conservar borradores al abrir repetidamente. Evidencia: [matriz de 1.17.12](1.17.12-route-actions-validation.md) y probes sobre núcleo/cola/panel reales. Límite: no se conoce aún la causa del no-envío de la sesión; ningún probe offline equivale a una orden real.

Revisión de 1.17.12: el primer acceso de flecha estaba fuera del host y dejaba escapar G hasta el atajo nativo. Hipótesis fallida: identificar un evento como Helper para la pausa imperial equivale a aislar teclas del juego. Pregunta nueva: ¿cada raíz interactiva externa registra la barrera productiva de keydown/keypress y deja keyup? Exigir prueba del wiring, fase de burbuja y liberación de un movimiento ya pulsado; no sustituir el instalador con un mock. Se corrigió antes de publicar. La captura previa no explica esta regresión nueva del borrador.

## Lección 1.17.13: reconocer no retira una condición de bloqueo persistente

Observación: ruta propia y cola de 107 Marauder vuelven a revisión con aliado pendiente de ID. Hipótesis que falló: una prohibición conservadora para destinos ajenos es pertinente también para un Send a sí mismo. La prueba con núcleo/cola/guardia/adaptador productivos reproduce reconocimiento → pausa conservada → reanudación explícita → plazo y censo nuevos → otra revisión por el mismo alias, sin fallo de almacenamiento ni Drive. Preguntar qué condición cambia tras reconocer y si se refiere realmente al propietario del destino. Exigir ownerId propio observado, acción Send guardada, ruta identificada y token previo de propietario/sesión; ataques o destinos ajenos continúan bloqueados. Mantener las revisiones previas, flota, reservas, Web Locks y casos de incertidumbre; no convertir un reconocimiento humano en permiso general ni afirmar un envío real por su marca temporal. Evidencia y límites en [matriz 1.17.13](1.17.13-own-reinforcement-review-validation.md).

Parpadeo1.17.13: un hueco autoritativo de publicación puede convertirse en ocultación visual aunque la geometría no cambie. Hipótesis fallida: usar el mismo snapshot para autoridad y decoración no tiene coste de continuidad. Exigir prueba del bridge/panel juntos, un límite absoluto de100ms, sesión/ámbito/proyección iguales y botones deshabilitados; snapshot autoritativo debe seguir null. Descartar datos de acción en caché y retirar decoración al cambiar propietario validado, cámara, pausa o sesión. La cuenta atrás sin huecos fue control negativo, no causa demostrada.

| Drive pide conectar repetidamente; [reproducción1.17.14](1.17.14-drive-recovery-validation.md) | Probar reload implica que una pestaña ya abierta descubre una autorización nueva; cuenta recordada implica permiso vigente | A+B sin autorización → login explícitoB → volver aA sin reload; comprobar nuevoID, mismoID retirado, foco/visibilidad, almacenamiento fallido y fecha absoluta; seguir listeners y teardown reales | Recuperación multitab demostrada offline; no prueba causa de captura. Expirar exige gesto de usuario en el modelo Google actual y no se elude. |

| «The arrow keeps flickering», versión pendiente; [reproducción1.17.15](1.17.15-arrow-scroll-validation.md) | Estabilidad de snapshots o corregir un hueco de100ms implica continuidad visual; todo scroll mueve el mapa | Emitir scroll/wheel del Helper cada16ms frente a rAF80ms y observar nodos/visibilidad entre eventos. Contrastar hostShadowDOM real, minimizado, tooltip, censos/zoom y revocación; repetir en mapa/gesto activo | ScrollHelper reproduce16/20frames ocultos offline; no acredita el evento real ni pintura del compositor. Versión/contexto faltan. |

| Refuerzo de proceso tras informe confirmado en1.17.14; [procedimiento](overlay-validation-process.md) | Que un loop temporal realmente ejecuta rAF y que resolver un mecanismo cierra el incidente | Suprimir callbacks: las pruebas deben fallar; exigir120/240callbacks ejecutados, muestras antes/después y revisión adversarial del dispatcher real | El probe final1.17.15 sí contó120callbacks; los anteriores WIP sin ejecución no son evidencia de frames. Resultado real de1.17.15 pendiente. |

| Mapa quieto sin parpadeo y Enviar ahora sin efecto en1.17.14; [validación1.17.16](1.17.16-local-overlay-diagnostics-validation.md) | Un caso simulado de scroll explica el movimiento; una misión preparada equivale a envío, o feedback en cabecera siempre se ve | Medir revocación durante cambio de cámara y entrega, sin ampliarla; diagnóstico local categórico/limitado. Recorrer click productivo→ticket→cola→dispatch→confirmación con apto/inapto y aviso fijo explícito | Sin causa real de bloqueo ni pintura. La preparación no confirma envío; el informe local son muestras sin datos personales, no todos los mensajes. |

| Preparación rename; [plan](rename-migration-plan.md) | Un checkout limpio acredita los bytes leídos y un inventario regex prueba todas las dependencias | Incluir symlink externo y script src espaciado/mayúsculas; exigir blobs regulares del commit, límites reales de salida y revisión de cargas dinámicas. Separar empaquetado offline de servicio real del prefijo antiguo | No se ha autorizado ni modificado el sitio de cuenta; rename sigue bloqueado y no se promete análisis exhaustivo de dependencias. |

## Lectura de configuración fallida (1.17.17)

La reproducción offline de [lectura de ajustes](1.17.17-settings-read-validation.md) refuta la hipótesis de que normalizar valores iniciales es un fallback inocuo: puede activar automatización y perder las exclusiones de la sesión. La revisión debe empezar con una configuración activa realista y hacer fallar tanto lectura como parseo desde el listener de producción; comprobar pausa, conservación y cero escrituras. Contrastar la ausencia legítima de datos y la recuperación posterior válida para no bloquear la primera instalación ni ignorar una elección explícita de otra pestaña. El alcance es la raíz guardada y su lectura; no acredita reparación profunda ni una incidencia real del usuario.

## Confirmación de escritura de preferencias Drive (1.17.18)

La [reproducción sintética](1.17.18-drive-config-write-validation.md) refuta que no lanzar una excepción equivalga a persistir: false y no-op activaban ajustes y mostraban éxito. La revisión debe atravesar el listener montado, hacer fallar escritura y lectura por separado, comprobar config/revisión/notificación/controles antes de confirmar y después de reintentar. Probar también rechazo asíncrono con política strict y éxito síncrono recuperable; un thenable rechazado por contrato aún necesita consumir su rechazo. No atribuir atomicidad ni cancelación a un gestor que escriba tarde: el parche no revierte datos posiblemente concurrentes ni cubre todas las escrituras del Helper.

## Protección económica y rename directo (1.17.19)

La petición de [protección de créditos](1.17.19-credit-protection-validation.md) exige comprobar la frontera final del pedido, no solo la fórmula. Revisar cantidades finales tras input, todas las colas recruit, datos desconocidos y opt-out; distinguir saldo de neto diario y no acreditar scrap futuro. Derivar caso permitido y bloqueado, fallo de persistencia y recuperación; los toggles quedan locales/backups para no romper journals antiguos. El intento de rename fue rechazado con403por la integración: la publicación conserva las URLs actuales y no debe anunciarse como migrada. Para el [rename directo pendiente](rename-migration-plan.md), comprobar misma identidad e historia, URLs canónicas y conservación de @name/@namespace/datos/OAuth, con ruptura Pages antigua aceptada explícitamente. El [nuevo seguimiento de movimiento](1.17.19-movement-followup.md) acredita una ventana de revocación en simulación y sensibilidad a callbacks ausentes, no una causa real ni reparación.

## Intervalo vencido y observabilidad (1.17.20)

La [captura de intervalo vencido](1.17.20-deadline-status-validation.md) solo prueba que el usuario vio una línea genérica; no prueba un scheduler detenido. La revisión debe contrastar el texto de esa misma línea con el diagnóstico conocido y con getDiagnostics fallido, sin inferir actividad de un contador. Recorrer vencimiento, pausa, coordinación, censo ausente y recuperación; la ausencia de clics de juego y de duplicados debe mantenerse. La fixture ejecuta schedule/núcleo reales con cola sintética, pero no una concesión Web Locks o suspensión de navegador real. No presentar el cambio de texto como reparación causal del envío ni del parpadeo.

## Overlay real en Chromium y referencia limitada (1.17.21)

La [reproducción de navegador](1.17.21-browser-overlay-validation.md) refuta que snapshots DOM y throttling80ms basten para seguir un mapa en movimiento: la escena real Canvas+SVG revela desfase y frames ocultos. El revisor debe ejecutar su propio recorrido, comprobar la métrica9px de padding, los callbacks productivos, hashes, capturas y sensibilidad; cuestionar exclusiones de frames y fronteras sustituidas. Revisar coste CPU por frame y no aceptar cámara/censo inválidos para disimular flicker. Distinguir esta referencia con proyección fresca del renderer Pixi y carrera MessagePort aún pendientes; pedir su entrypoint offline versionado, no acceso a la partida. CI debe fallar si falta el navegador exigido, no convertir una ausencia en evidencia visual.

## Lección1.17.22: rAF y puerto no garantizan orden de pintura

La aprobación acotada de1.17.21 dejó un desfase conocido de10.29px al invertir callbacks. Esa brecha debe ser regresión obligatoria antes de afirmar sincronía de movimiento: exigir ambos órdenes y transporte productivo con demoras, no una función de cámara siempre fresca. La nueva [matriz](1.17.22-camera-render-order-validation.md) usa Pixi oficial y cámara exacta, pero aún sustituye bootstrap y mundo nativos. Pregunta al revisor: ¿la notificación decorativa llega antes de paint sin conceder autoridad a gestos o marcadores? Derivar un probe propio de orden/demora/censo, probar recuperación legítima y rechazos, cuestionar el salto de mundos aislados aún no ejercitado y el coste por censo/ruta. No rebajar un desfase reproducido a simple QA pendiente por tener CIverde.

El probe independiente1.17.22 añade ambos órdenes con jitter20/320ms y recuperación120frames:38frames no bastan para habilitar marcador tras scope nuevo. No transformar esa espera segura en aceptación de proyección pendiente; documentar latencia y distinguir el microprobe de eventoDOM entre mundos de la integración completa del gestor.

## Lección1.17.23: geometría alineada no es autoridad vigente

La escena pública nativa con mundos aislados y GPU detectó marcador visible/activo tras caducidad de cámara entre callbacks; la referencia rápida previa no cruzaba ese límite. El control autoritativo negaba datos, pero no notificaba su pérdida y el clic confiaba en disabled pintado. [Reproducción](1.17.23-native-galaxy-validation.md):0notificaciones donde se esperaba1 y apertura extra con cámara ya inválida. El revisor debe probar reloj/framelargo, paquetes reordenados, activación sin repintado y recuperación, sin ampliar1500ms. Cuestionar centroides raster frente a anillos/oclusiones y no atribuir fallos del fixture al producto. Contrastar transformación exacta de assets y ausencia de red; el mundo sintético compatible no equivale a cuenta ni partida reales.

## Tarjetas de flota y protección de créditos1.17.24

La hipótesis de que gridColumn1/-1 crea una fila nueva falló: grid-row1 heredado de label permite solapamiento. Revisar geometría de todos los controles con CSS y ShadowRoot reales, cardinalidad, ayuda larga y fila de estado, más allá de comprobar texto o lógica de créditos. Ver docs/1.17.24-credit-layout-validation.md; la confirmación instalada sigue pendiente.

## Conquista1.17.25: cerrar intención no equivale a resolver envío

La revisión adversarial de los borradores no publicados refutó que impedir Retirar bastase: Cerrar tras revisión manual podía borrar un ataque confirmado, y sustituir una cola permitía recrear un claim ya aceptado. Exigir recorrer las acciones UI alternativas y persistencia entre GM/cola, reportes tardíos, incertidumbre y fallback legado. Una lectura válida no confirma una escritura false/no-op. La comparación del target debe ser semántica después de normalización productiva. Ver [reproducciones y límites](1.17.25-conquest-validation.md); los árboles parciales históricos no son revisiones publicadas. La propiedad positiva actual no inventa dueño histórico ni prueba fabricación.

La primera candidata final e83024b fue rechazada por discrepancia entre parsers: una fecha inválida de lista con fallback válido en detalle liberaba reportes terminales al motor anterior. Exigir probar el dispatcher entre ambos consumidores con el mismo payload, además de cada parser aislado; un fallo de parseo no debe convertir intención gestionada en permiso para otra automatización. Confirmar nombres/ruta legítimos antes de atribuir reproducción.

## Conquista1.17.26: esperar la evidencia pertinente a cada misión

La recuperación de una pausa no equivale siempre a esperar reporte: el mismo ticket sent puede ser Send propio de reunión o ataque. La validación impidió el estado inválido, pero dejó un recorrido legítimo sin recuperación. Exigir pausa→recarga→reanudar en ambas clases, mismo ticket y una única aceptación; llegada exige censo estacionado posterior, ataque exige reporte. Contrastar dueño cambiado y captura sin quitar las guardas. [Antes/después y límites de métricas](1.17.26-conquest-resume-validation.md).

La primera candidata090058a falló en aceptación anterior al tick reconciliador: Reanudar no puede confiar solo en ticket.state. Exigir evidencia cruzada del trabajo de cola (mismo claim, fecha válida) antes de decidir la recuperación; comprobar el intervalo entre sent nativo y persistencia del controller, no solo un sent ya normalizado. Rechazar borrar evidencia con cola ausente/fecha inválida.

## Arranque Chromium: timeout no identifica causa ni confirma limpieza

Los fallos repetidos1.17.26 refutaron que un timeout genérico bastase para diagnosticar el runner. Un launcher que sale42 se confundía con15s de espera y un wrapper dejaba descendiente/pipe vivos. Exigir código/señal y stderr acotado/sanitizado, grupo propio, cierre confirmado y prueba SIGTERM; contrastar deadline silencioso y endpoint legítimo sin retries/fallbacks. La inyección de launcher demuestra esas fronteras, no causa el fallo remoto ni prueba un renderer. Revisar logs completos/imagen exacta y conservar incertidumbre si no se recogió stderr. [Evidencia](browser-startup-validation.md).

La candidata44851f8 demostró que separar logs del entorno no basta: las reglas simples de redacción omiten JSON, comillas/espacios y Basic. Revisar ejemplos sintéticos contra archivo y mensaje, antes y después de truncar. Conservar la etiqueta antes de redactar para no publicar una cola de valor sin contexto. No afirmar un detector universal de secretos; mantener diagnósticos limitados y sin datos de cuenta.

## Conquista1.17.27: poco DOM no implica poco trabajo

La firma de render se comprobaba después de planificar. Con1objetivo/1000sistemas, candidatos/donantes cuadráticos producen17tareas largas y22frames/6s; sinobjetivos también se clonaba censo. Exigir perfil CPU/rAF/longtask real con0objetivos,flota lista,imposible,reunión viable yvistaoculta, además de equivalencia funcional/destinos/reservas. Diferenciar el coste reproducido del hanging real sin confirmar versión/censo. Un atajo vacío no debe eludir lectura fallida ni autorizar jobs huérfanos, y saltarse preview oculta no autoriza cachear guardas. El peor caso de reunión viable grande permanece explícito.

DiagnósticosUnicode: KiB cuenta bytes, no longitudUTF16. Exigir multibyte después de sanitizar y evitar cortar un carácter; la candidata ce0 excedía16KiB aunque estaba acotada en caracteres.

## Timeout global sin progreso parcial

La CI38923441731 de1.17.27 agotó300s sin failureEvents; el reporte descartaba resúmenes y pasos aprobados ya recibidos. Exigir conservar progreso parcial como diagnóstico, manteniendo la exigencia del resumen global completo para aprobar. No atribuir el corte a Chromium sin evidencia ni aumentar un plazo por intuición. Contrastar el último archivo completado y el siguiente inventariado antes de corregir costes o bloqueos. Ver [reproducción y límites](gate-progress-validation.md).

## Tiempo de arranque distinto de vida del proceso

La revisión9f9af4a detectó elapsedMs reescrito al cerrar y reporter que descartaba stdout/diagnostic. Exigir firstStderrAfterMs,readyAfterMs youtcomeAtMs inmutables, timeout separado de cleanup, resumen de campos fijos sin secretos y ambos órdenes en runners nuevos sin calentar navegador para ocultar el fallo. No confundir DBus stderr con causa, primer arranque con escena específica, ni un ensayo verde con resolución. Ver [evidencia y límites](browser-startup-timing-validation.md).

## Capacidad del inventario frente a deadlines de comportamiento

La CI38927422752 de e48db1f localizó corte300s durante fixtures, con100archivos/241.2s completos y12pendientes. Exigir cálculo explícito para presupuesto global y preservar15s/120s/30s, fallo al cortar y todos los archivos/aserciones. No optimizar escenas ni repetir arranques para esconder fallos. Contrastar denominadores local/remoto, cola completa parcialmente ejecutada y margen acotado, sin inventar duración de archivos de la CIverde que no se registró. Carga media es indicio de capacidad, no causa. Ver [cálculo](suite-budget-validation.md).

## Mutaciones propias y microtasks sin ceder (1.17.28)

Un render estable no es inocuo si escribe atributos observados aunque el valor coincida. La [reproducción](1.17.28-observer-loop-validation.md) liga hidden/aria-label/title a observer→microtask→render:2000iteraciones sin timer/rAF antes de corte. Exigir panelShadowRoot+marcadoreslightDOM, scheduler/observerproductivos, arranque sin interacción/objetivos, cámara inválida/válida eImperioOFF/ON. No confundir latidos posteriores al corte con progreso previo. Controlcausal de idempotenciaDOM y cambios nativos positivos; no aprobar un filtro global que silencie disponibilidad ni caché de autoridad. Probar floats largos por normalizaciónCSS. Módulo idéntico.24/.27: no adjudicar el defecto a Conquista ni cerrar incidente instalado sin confirmación.

## Refutar un hueco de diagnóstico antes de añadir infraestructura

El experimento de transporte stderr sobre b0ed476 refutó que agrupación/fragmentación de escrituras pierda resúmenes en el CLI real de Node24: ya retiene tres líneas válidas. Una llamada directa a un parser con dosJSON concatenados no representa por sí sola ese transporte. Se retiró buffering innecesario y se añadió cobertura de integración de mensajes válidos, oversize, incompletos y campos privados sintéticos. Exigir evidencia del límite real antes de programar una corrección y no inventar beforeFail para un test que ya pasa. Ver [contrato probado](browser-summary-transport-validation.md).

## Política y valor inicial de métricas locales

Que el panel y el adaptador coincidan no garantiza que la política publicada diga lo mismo. Contrastar las tres superficies con elección ausente y elecciones explícitas true/false, y exigir que renderizar no escriba consentimiento. La [regresión](privacy-metrics-default-validation.md) falla con la frase anterior; corregir transparencia no resuelve por sí mismo la aclaración pendiente sobre el valor inicial ni autoriza cambiar recogida de datos.
