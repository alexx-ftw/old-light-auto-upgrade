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
