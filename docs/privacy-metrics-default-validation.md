# Coherencia del estado inicial de métricas locales

Preparación local sobre main997a641b84b3d197cc17f322512e38a3f8de0dad. La política decía «Están desactivados inicialmente», aunque el adaptador activa métricas si falta la elección y el panel explica ese valor por defecto. No se cambia el comportamiento ni se resuelve aquí la aclaración pendiente sobre ese valor: se describe la implementación existente.

## Reproducción y corrección

Con el test nuevo y la política anterior, `node --test --test-name-pattern='Privacy policy and rendered metrics panel' tests/metrics-integration.test.cjs` falla en la afirmación que exige describir la activación por defecto en ausencia de elección. Con la política corregida, el mismo caso pasa. `node --test tests/metrics-integration.test.cjs tests/metrics-default-review.test.cjs`:27/27 pasan, sin omisiones.

El caso lee solo la sección de métricas locales de la política, ejecuta el adaptador real y renderiza el panel real en el harness DOM existente. Contrasta texto, checkbox y adaptador para elección ausente, false y true; exige conservar exactamente la elección almacenada y no crear una al abrir el panel. Rechaza la afirmación anterior de desactivación inicial.

## Límites y revisión

Solo documentación y pruebas; no cambia userscript, core, transporte remoto, almacenamiento ni metadatos. El harness DOM no acredita pintura en navegador ni sesión de juego. El contrato textual protege frases verificables, no interpreta cualquier contradicción imaginable en lenguaje natural. El gate de publicación y CI remoto siguen pendientes: esta preparación no se publica ni sustituye la resolución del bloqueo de Chromium. La revisión independiente debe contrastar el diff, la reproducción y las elecciones explícitas, sin reabrir el diagnóstico cancelado.
