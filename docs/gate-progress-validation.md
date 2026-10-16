# Progreso parcial del gate

La CI exacta38923441731 del commit79ae088af98769d71e2ac1735b6fd1aaa1229ba1 terminó por timeout global300000ms sin eventos de fallo. La suite local completa aprobó2384pruebas en256446ms. No prueba un fallo de Chromium ni una regresión del juego; tampoco permite localizar dónde se detuvo. Pages sí desplegó el mismo commit. No se descargaron artefactos denegados ni se amplió acceso.

El validador conserva ahora los resúmenes de archivo ya emitidos y los últimos10test:pass, con rutas relativas y duraciones, incluso antes de exigir éxito del proceso. Proceden del mismo reporter estructurado; no se interpreta stdout de las pruebas como eventos. parseTests sigue exigiendo todos los archivos y el resumen global final, sin fallos/omisiones. No cambia300000ms/120000ms, concurrencia, inventario, navegador ni filtros.

Mismo harness tests/release-validation.test.cjs copiado junto al validate-release.cjs exacto de79ae088 a /workspace/oldlight-transfer/gate-progress-before/. Comando dirigido:

```
node --test --test-name-pattern='CLI validates a recursive' /workspace/oldlight-transfer/gate-progress-before/tests/release-validation.test.cjs
```

Antes falla TypeError al consultar progress.completedFiles inexistente. Después registra el archivo completado y fixture passes. El caso de fallo ejecuta completed before failure seguido de una excepción: conserva el paso aprobado y rechaza la suite. Los controles de omisiones, foco y salida prematura permanecen. Esta reproducción acredita la observabilidad faltante, no reproduce300s ni atribuye causa histórica. Los filtros son solo experimentos de regresión; la publicación exige gate completo limpio y revisión independiente exacta. No cambian bytes ni versión del Helper1.17.27 por este ajuste de herramientas.
