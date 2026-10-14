# Estado breve de producción de naves

## Reporte y alcance

La captura del 14 de octubre de 2026, 17:48 UTC, muestra Helper 1.16.1: Probe 30/30, Vanguard 1/5 en segunda prioridad, Sentinel 147/300 y Marauder 45/300. Vanguard cuesta 50.000 de cada recurso, frente a cantidades visibles redondeadas de 16,3k y 17,6k. No se ven el estado de Imperio, los títulos nativos completos, los ajustes de Depot ni las operaciones anteriores.

El planner publicado reserva recursos para la primera nave pendiente, aunque otra posterior ya sea asequible. Es una política expresa y cubierta por las pruebas existentes, no una selección accidental. En una reproducción con esas cantidades como valores exactos ilustrativos, selecciona Vanguard ×1 y `prepareShip` devuelve cero; poner Sentinel antes permite prepararlo. La ETA ilustrativa ronda 2h18m si producción y gastos no cambian. No es una lectura exacta de la sesión real.

La capacidad visible, 131,6k, basta para una Vanguard. Esas naves por sí solas no requieren ampliar Depot. Un umbral personalizado, un edificio no visible que exceda capacidad o una prioridad de Depot retenida pueden cambiar la decisión; no se descartan por la captura. Imperio puede sustituir los mínimos locales por un déficit global diferente.

La política estricta permanece intacta. Cambiarla para construir naves asequibles de menor prioridad es una decisión aparte.

## Cambio informativo

El estado activo de preparación, espera o confirmación de naves se muestra junto a sus controles. Se limpia al cambiar a otro estado operativo, sin conservar un mensaje de ahorro antiguo tras una pausa, barrera imperial o trabajo de infraestructura.

Después de no poder preparar un pedido se releen las filas nativas. Solo se muestra «Ahorrando para Vanguard ×1 · faltan … P y … I» cuando el título nativo confirma falta de fondos, la cuenta, sistema, selección y modo coinciden, la automatización sigue operativa, Imperio conserva permiso y no se adelanta Depot/Reactor, existen costes/cantidades exactos y el forecast no indica cola u otro bloqueo. P significa Palladium e I significa Iridium. El aviso permanece breve; no vuelve a explicar toda la política.

Los bloqueos conocidos conservan una causa breve. Sin evidencia suficiente se dice que no se pudo preparar el pedido. Un fallo de la lectura diagnóstica no rompe ni reintenta la producción. El aviso no concede autoridad y no añade clics, órdenes ni configuración.

## Regresiones verificables

`tests/fleet-execution-feedback.test.cjs` cubre siete casos:

1. Nave seleccionada y faltantes exactos con título nativo de fondos, sin mutar datos y con menos de 100 caracteres.
2. Lectura incompleta, bloqueo desconocido, edición manual y espera de misión, sin atribuir ahorro.
3. Forecast listo pero preparación fallida, sin prometer producción ni atribuir fondos.
4. Texto de ejecución explícito y limpieza del mensaje anterior, sin nuevas lecturas imperiales.
5. Wiring real de `show` y `step`, con estado inline oculto por defecto y solo activo en ramas de naves.
6. Prioridad/contexto cambiado, título no reconocido, cola, muelles o tesorería bloqueantes, sin atribuir ahorro.
7. Rama real de preparación fallida: relectura, cambio de sistema/objetivo/cuenta/modo, pausa, pestaña oculta, petición nativa en curso, permiso imperial retirado, prioridad Depot sobrevenida, cola sobrevenida, recursos desconocidos y error de lectura; cero nuevos intentos de preparación.

Las mismas siete pruebas finales contra los bytes previos de 1.16.2 fallan; con el cambio pasan. También se ejecutan las suites de prioridad de flota e infraestructura. La revisión independiente y el gate completo corresponden al árbol final; no se reutilizan después de integrar cambios de interfaz.

## Límites y criterio de revisión

No hay sesión real de Brave/Violentmonkey ni partida o Drive en esta validación. El DOM y los cambios síncronos son simulados. La captura es compatible con espera estricta por Vanguard, pero no prueba por sí sola la causa única de la sesión.

La revisión debe comprobar que «ahorrando» depende de evidencia reciente y específica, nunca de `prepareShip === 0` por sí solo; que una lectura fallida no crea efectos; que todos los demás estados limpian el aviso; y que planner, reservas, pausas, pedidos y permisos permanecen sin cambios. La ubicación y el diseño finales deben validarse de nuevo al integrar el rediseño del Helper.

## Hallazgos de revisión independiente corregidos

- Una cola llena con ETA conocida devolvía un motivo genérico porque la previsión estaba en espera, no bloqueada. Ahora conserva la causa de cola tanto con tiempo conocido como desconocido.
- La preparación puede cambiar estado síncronamente. Antes de atribuir ahorro, el diagnóstico vuelve a comprobar contexto y operatividad y recalcula infraestructura; una pausa, cambio de cuenta/modo, pérdida de permiso imperial o Depot prioritario muestra su causa breve. Esto no autoriza pedidos ni modifica el planner.
- Coste adicional acotado a preparar sin éxito: revalidación imperial si procede, relectura de flota/edificios y planificación informativa. No se añaden timers, observers, persistencia ni lecturas desde show.

- Una petición nativa marcada `.b-loading` aparecida durante la preparación también invalida la explicación de ahorro, aunque el botón conserve su título anterior de falta de fondos. Se comprueba con la misma query de operación en curso ya usada por el ejecutor.
