# Recuperar el déficit energético actual

## Hallazgo y alcance

El reporte del 14 de octubre de 2026 muestra Helper 1.16.2, energía −1, recursos locales aproximadamente 33,8k/29,8k y un Reactor de nivel 12 a 13 habilitado: cuesta aproximadamente 23k de cada recurso y aporta +57. Las otras seis mejoras visibles cuestan más que los recursos disponibles. Imperio indica estar activo y tener cubiertos los objetivos de flota.

Esto permite comprobar una limitación concreta, pero no demuestra todas las condiciones de aquella sesión. La captura no muestra la casilla de Reactor, el orden efectivo, el rol, el umbral de Depot, reservas retenidas, títulos exactos de recursos/costes, contenido completo de la cola ni eventos posteriores. La prueba utiliza números enteros compatibles con las cantidades redondeadas, todos los edificios marcados, umbral 90%, cola inicialmente vacía y un censo sintético autorizado. No atribuye esos supuestos al usuario.

En el árbol publicado 1.16.2, `selectBuilding` solo justificaba Reactor si otra mejora marcada **ya disponible** requería energía. `createUpgradeEtaEstimator` reproducía la misma condición futura. Por ello un déficit actual no bastaba: podía esperar a que se ahorrase para otro edificio, pese a que el Reactor ya se podía pagar. El test histórico de ETA incluso exigía estado inactivo con energía −5 y solo Reactor marcado. Se trata de un ajuste explícito de aquella política, solicitado al reportar el déficit, no de una supuesta regresión reciente.

No existe un ajuste separado `autoReactor` ni un nivel máximo de construcción. Las casillas de Edificios y el orden efectivo se mantienen. Los objetivos de nivel bajo Avisos son únicamente notificaciones. Los roles imperiales reordenan edificios, sin eliminar sus exclusiones; Atender y la autorización imperial siguen siendo obligatorios.

## Corrección acotada

- Un déficit **actual conocido menor que cero** justifica un Reactor marcado, nativamente habilitado y con aporte positivo conocido. No necesita otro edificio asequible.
- Energía cero/positiva no dispara Reactor por sí sola. Se conserva la demanda futura de otra mejora disponible.
- No adelanta Reactor sobre otra mejora independiente que tenga prioridad por el orden configurado o por el rol.
- No gasta reservas de flota. La cadena de Depot prioritario conserva su propia política: Reactor solo se adelanta si el Depot necesita energía.
- La previsión ordinaria usa la misma condición y dice «déficit actual». Conserva la espera por recursos propios, hueco en cola, producción insuficiente y datos desconocidos.
- No duplica un Reactor en cola ni uno pendiente de confirmación. Si termina y la energía sigue negativa, el siguiente ciclo puede justificar otro, sujeto a todas las guardas. No inventa la ganancia futura de una obra en cola.
- No cambia el paso de envío, las pausas, liderazgo, identidad, ámbito, permisos, censos, barreras de confirmación, almacenamiento, Drive ni las acciones nativas.

## Reproducción antes/después

Base: `1fc791c96a6ab8087b15a01d93c8b117336cfa91` (1.16.2). Se copió el checkout limpio y se añadió **sin cambios** el nuevo `tests/reactor-deficit.test.cjs`; se ejecutó:

```sh
node --test tests/reactor-deficit.test.cjs
```

Resultado de la base: **15 casos, 8 aprobados, 7 fallidos, 0 omitidos**. Fallos relevantes:

- El selector devuelve `undefined`, no `reactor`.
- El `step` completo registra cero clics en vez de un clic de Reactor, pese a permiso imperial válido.
- La previsión independiente devuelve `waiting`, no `ready`: espera a que otra mejora sea asequible.
- Reactor único queda inactivo ante déficit y su espera en cola no se describe como tal.

No se reemplaza el selector ni el paso por funciones imitadas. El harness extrae las funciones distribuidas, ejecuta lectura de filas/títulos/energía, selección, los planificadores y el `step` completo. El coordinador y el núcleo imperial son los módulos reales; DOM, recursos y adaptador de lecturas son sintéticos. Las pruebas generales de observador/adaptador/barreras existentes siguen cubriendo sus capas por separado.

La expectativa histórica de «Reactor inactivo con energía −5» se sustituye por energía **0** en `upgrade-eta.test.cjs`. La nueva suite comprueba expresamente ambos lados: negativo actúa; cero/positivo/desconocido sin consumidor disponible no actúa.

Comando focal final:

```sh
node --test tests/reactor-deficit.test.cjs tests/upgrade-eta.test.cjs tests/infrastructure-priority.test.cjs
```

Resultado focal: **83 casos aprobados, 0 fallidos, 0 omitidos**. El gate completo del commit limpio es la autoridad para el conjunto final y sus hashes; este recuento focal no sustituye ese gate.

## Matriz de límites

| Escenario | Resultado comprobado |
| --- | --- |
| Déficit −1, Reactor asequible, otros edificios inasequibles | Selector y ETA eligen Reactor; el step imperial registra exactamente un clic |
| Modo local y los cuatro roles imperiales | Mismo criterio de déficit; no muta configuración |
| Energía 0, positiva o desconocida sin consumidor disponible | Ningún clic de Reactor especulativo |
| Casilla desmarcada, fuera del orden, control deshabilitado/oculto/cargando/error | No supera el veto |
| Aporte de Reactor cero, negativo o desconocido | Ningún clic ni previsión ready |
| Solicitud pendiente y posterior Reactor en cola | No repite la orden; confirma por la ruta normal |
| Reactor único, fondos insuficientes, cola llena, producción cero | Esperas correctas o bloqueo sin cuenta atrás inventada |
| Pausa, pestaña oculta, sin liderazgo, cooldown, informes/misión ocupados | Cero clics |
| Pausa imperial, interacción, Atender desactivado, datos antiguos, selección múltiple, no propio | Cero clics |
| Permiso imperial revocado justo antes de capturar la barrera de envío | Cero clics y ningún pending nuevo |
| Reserva de flota pendiente | No gasta en recuperación energética |
| Reserva Depot retenida esperando Reactor | Sigue reservada, sin segundo Reactor |
| Depot necesario de coste energético cero, asequible o todavía ahorrando | Conserva prioridad del Depot; no deriva su reserva hacia Reactor |
| Edificio de energía cero antes de Reactor en el orden | Conserva su prioridad |
| Déficit ya corregido | Cesa la demanda independiente de Reactor |

## Hallazgo de revisión independiente

La primera implementación también hacía que la previsión de una cadena de Depot prioritario escogiese Reactor por déficit actual, incluso cuando el Depot consumía cero energía. El revisor reprodujo que la base elegía Depot y el primer diff elegía Reactor. Se conservó el caso `existing energy debt cannot divert a zero-energy urgent Depot reservation to Reactor` en `infrastructure-priority.test.cjs`.

Antes del ajuste, ese mismo caso falla con `reactor` en lugar de `warehouse`; después pasa para Depot asequible y para ahorro de recursos. La condición nueva se limita al ETA ordinario (`!depotRequired`). Dentro de la reserva Depot sigue siendo necesaria la dependencia energética preexistente. El hallazgo queda corregido y cubierto, no aceptado por tener el resto de la suite verde.

## Límites pendientes

Todo lo descrito es offline. No se han enviado pedidos a una partida real ni se ha comprobado esta corrección en Brave/Violentmonkey con Drive. La captura no permite verificar la configuración efectiva de la sesión original ni afirmar que se ejecutó después un Reactor. La validación visual, la latencia nativa y la integración real siguen pendientes.

Este commit es funcional, sin bump independiente de versión ni publicación. Su integración con cambios de navegación/UI debe conservar ambas coberturas, añadir las notas y versión de la release conjunta, revisar el árbol integrado y ejecutar de nuevo el gate completo antes de publicarlo.
