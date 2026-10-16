# Presupuesto global medido de la suite

El presupuesto del inventario completo pasa de300000a420000ms. Es un límite de capacidad del gate, distinto de las guardas de comportamiento: Chromium mantiene15000ms, cada test120000ms, builder30000ms y jobGitHub15min. No se omiten archivos/aserciones, no se añade retry/warmup ni se cambia concurrencia1. Una salida fallida, cancelada, incompleta o sin resumen global sigue siendo fallo.

## Mediciones conservadas

CIverde38914585804 del commit0124962bf362e0d40c8a53e1eac641beda591264:2365pruebas/110archivos,218231ms. CI38927422752 del commit e48db1fa56dcdd45015da981b073ca88e1de2ce2:100archivos completados de112 y12pendientes, corte global300s/limpieza303s. failureEvents vacío no prueba aprobación completa. El corte sucedió durante release-validation.test.cjs, tras el caso de builder agotado30977ms y SIGTERM1031ms. No fue un timeout de Chromium en esa ejecución:Conquista llegó a DevTools11913ms y completó17569ms.

Los100archivos completos sumaron241204ms; principales costes:

| Archivo | CI ms |
| --- | ---: |
| tests/native-galaxy-overlay.test.cjs | 145874 |
| tests/reinforcement-overlay-browser.test.cjs | 37760 |
| tests/conquest-panel-browser.test.cjs | 17569 |
| tests/browser-process.test.cjs | 15721 |
| Otros96archivos completos | 24280 |

Lista íntegra y resúmenes por archivo: evidencia externa1.17.27-timing-ci-gate.json. Los12pendientes empiezan en release-validation.test.cjs y terminan en upgrade-eta.test.cjs. En local, esos12archivos completos sumaron62531ms; incluye todo el archivo de fixtures ya parcialmente ejecutado en CI, deliberadamente conservador.

En los mismos100archivos, local194465ms frente a remoto241204ms: factor1.24035, redondeado1.25 para estimar la cola. Cálculo:241204+62531×1.25=319368ms. Añadir30% de margen acotado da415179ms; redondeo a420000ms (7min), por debajo de15min del job. No pretende garantizar cualquier máquina ni cada combinación patológica: el límite continúa finito y exige completar todo el inventario. Evidencia externa suite-budget-sizing.json conserva operandos/alcance exactos.

Respecto a CIverde:hay21pruebas más (2386en112archivos), incluidas10de procesos de navegador con un control silencioso real de15s. Los archivos costosos nativa/referencia no cambiaron sus escenarios/aserciones. El reporte verde no conserva duraciones por archivo; no se inventan tiempos retrospectivos. Misma imagen/Node no prueba misma carga/velocidad instantánea. Los ensayos separados38927422800 pasaron ambos órdenes y mostraron primer arranque1.075/1.566s frente a posteriores0.096–0.137s; no reprodujeron el fallo histórico15s. No se atribuye causalidad a DBus, actualización de runner ni interferencia entre jobs en máquinas separadas.

Concurrencia de archivos sigue1. El reporte añade muestras de CPUs lógicas, availableParallelism y carga media del host al empezar/terminar la suite. No incluye entorno, argumentos, rutas personales ni credenciales. Son observabilidad de capacidad; carga media no equivale a usoCPU del proceso/cgroup ni acredita contención causante. No hay una causa de infraestructura demostrada que justifique un cambio adicional.

## Regresión antes/después

Mismo tests/release-validation.test.cjs actual copiado junto al validate-release.cjs exacto e48db1f a /workspace/oldlight-transfer/suite-budget-before/. node --test con filtro CLI validates a recursive falla300000!=420000. Tras el ajuste ese caso exige presupuesto420s, concurrencia1, muestras de capacidad y test-timeout120000 preservado. Los casos runtime omissions mantienen rechazo de fallo, cancelación, foco, cero tests, salida temprana y stdout falso. Las pruebas existentes de builder30s y señales siguen ejecutándose en el gate completo. El filtro solo documenta la regresión de política; publicación requiere todos los archivos sobre commit limpio final y revisión independiente exacta.

El cambio es solo de herramientas/documentación, conserva bytes/versión del Helper1.17.27. Los diagnósticos de orden no se repiten sin una nueva hipótesis. El hanging de Eros permanece un incidente separado sin confirmación causal.
