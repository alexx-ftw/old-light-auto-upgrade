# Arranque y limpieza de Chromium en CI

## Evidencia previa y límites

Main inicial limpio c4475b7e4864a9f4cdfb3dd001dd024bd04ff896, árbolacc8a64fd3869c8f584536ef12a2881feb3832dd. Workflow38916916335 intentos1y2 falla al abrir Chromium en conquest-panel-browser, antes de montar escena/aserciones:15,131ms y15,007ms. Intento2 además agota300000ms de suite. Pages sí termina. Gate local de esos mismos bytes pasó2371/110. Se leyeron logs completos, no solo summary: /workspace/oldlight-transfer/1.17.26-ci-attempt{1,2}-full.log. La ejecución verde anterior38914585804 usa la misma imagen ubuntu24.04 versión20261012.334.1, Node24.21.0, ruta/usr/bin/chromium y mismos SHAs checkout/setup-node/upload-artifact. No hay evidencia para atribuirlo a una actualización del runner.

Se inspeccionó metadata del artefacto12053301974, offline-overlay-browser-evidence,419126bytes. Su contenido no se descargó: se mantiene la denegación403 previa, sin otra ruta ni ampliación de acceso. El workflow anterior no recogía stderr ni diagnóstico de arranque; el helper tampoco los persistía ni imprimía al fallar. Los logs completos tienen stderr vacío. La causa raíz del arranque remoto sigue desconocida: un timeout aislado no demuestra saturación, binario roto, OOM ni error del producto.

## Defectos reproducidos offline

El helper esperaba error o anuncio DevTools, pero no exit/close. Un launcher que imprime OFFLINE_STARTUP_FIXTURE_FAILURE y sale42 acababa tras15segundos como Native Chromium startup timeout, perdiendo su causa. close mataba únicamente el PID directo y no esperaba cierre: un wrapper que sale y deja un descendiente con stderr heredado lo dejaba vivo.

Mismo harness actual tests/browser-process.test.cjs, frontera spawn sustituida por un launcher Node sin navegador/red/juego. Controlador del helper anterior extraído sin modificar con git show c4475b7:tests/helpers/native-browser.cjs a archivo externo:

```sh
QA_NATIVE_BROWSER_SOURCE=/workspace/oldlight-transfer/browser-startup-before-native.cjs node --test --test-name-pattern='native browser startup' tests/browser-process.test.cjs
```

Antes:2fallos en30.9s. Primero, timeout genérico no coincide con exited before DevTools/code42; segundo, descendiente sigue vivo (true!=false). El harness mata únicamente su descendiente propio incluso al fallar. Evidencia externa browser-process-final-before.tap. Después, los mismos casos pasan rápidamente y preservan código/mensaje sanitizado. Un primer fixture WIP usaba exitCode y retenía al padre por su child handle; se corrigió a salida42 explícita antes de conservar esta reproducción. Ese fallo del fixture no se atribuye al producto.

El probe independiente separado en browser-startup-independent/ confirma ambos defectos. No prueba que hayan causado el arranque fallido de GitHub; sí demuestra que impedían diagnosticarlo y podían alargar una suite tras fallo.

## Cambio mínimo de herramientas

Nuevo browser-process.cjs es dueño de un grupo POSIX por navegador descartable. Detecta salida temprana, error o deadline de15segundos; no reintenta, no cambia ejecutable ni omite aserciones. Registra un prefijo acotado de stderr (máximo16KiB tras sanitizar, con indicación de truncamiento) y metadata fija (binario/realpath/Node/OS, estado, códigos y tiempos), sin entorno ni perfiles de cuenta. Error de arranque incluye cola sanitizada de2KiB para que el log del gate sea útil aun sin descargar artefactos. Se redactan URLs, Bearer, patrones de claves y campos de token/secret/password/APIkey; no se registran argumentos ni variables de entorno.

Cierre conserva errores, cancela pendientes y socket, termina su grupo, espera cierre y usa SIGKILL solo para remanentes de ese grupo; no espera un comando Browser.close que puede no responder si desaparece DevTools. Señales SIGTERM/SIGINT y exit del harness limpian sus grupos; se preserva la señal original. El límite300000ms del gate y15000ms del arranque no cambian. No se instala otro navegador, no hay fallback automático ni se relaja guardia o prueba alguna. Workflow conserva los dos archivos de diagnóstico además de toda la evidencia anterior.

Controles nuevos: salida42 con mensaje/código sin secret de fixture; wrapper/descendiente con pipe; endpoint anunciado una vez y cierre propio; SIGTERM del harness preservada con grupo eliminado; navegador silencioso falla a los mismos15segundos y se limpia. Los casos de UI reales y el gate completo deben seguir pasando. macOS mantiene el contrato POSIX, pero no se ha ejecutado aquí. Windows ya se rechaza por el gate.

## Alcance de publicación

Solo herramientas, workflow y documentación. No cambia userscript/meta ni versión1.17.26. Se exige revisión independiente exacta y gate completo limpio antes de publicar este diagnóstico. Una CI nueva después del cambio aporta evidencia nueva de código de salida/stderr y limpieza, no es otro retry ciego de los mismos bytes. Si falla, su mensaje se investiga antes de otra acción. No afirmar resuelta la causa de Chromium sin esa evidencia. Sin juego real, credenciales nuevas o más permisos.

## Redacción rechazada en la primera candidata de herramientas

El commit local44851f8e9b4dd9ecb81604b1704214f63ebd14f4 fue rechazado por revisión antes de publicar. sanitize dejaba intacto JSON con token entre comillas, el resto de una contraseña con espacios y el valor de Authorization Basic. Reproducción sintética sin credenciales reales: QA_BROWSER_PROCESS_SOURCE=/workspace/oldlight-transfer/browser-process-redaction-before.cjs node --test --test-name-pattern='browser startup diagnostics redact quoted' tests/browser-process.test.cjs, con módulo exacto extraído por git show44851f8:tests/helpers/browser-process.cjs. El caso falla por SYNTHETIC_TOKEN_VALUE en el resultado; los probes independientes también prueban las otras dos formas.

La versión corregida reconoce claves/valores entrecomillados y redacta el valor completo de autorización/campos no entrecomillados hasta fin de línea. El prefijo acotado conserva la etiqueta del secreto antes de redactar; una cola truncada podría dejar solo su valor. La búsqueda de DevTools usa una ventana separada nunca persistida y exige línea completa para no aceptar una URL cortada entre chunks. No se amplían15segundos. Se añade control de línea de credencial sobredimensionada sin fuga al log ni al error. Son datos sintéticos, no una afirmación de detección universal de secretos; el navegador siempre usa perfil nuevo y no se registra entorno ni argumentos. El gate anterior fue abortado y no se acredita.

## Límite real en bytes

La revisión de ce0af099c76caf8e9bc91e431f644a49a27b6201 detectó que slice contaba caracteres: un fixture Unicode produjo48030bytes pese al límite16KiB anunciado. El mismo caso permanente con QA_BROWSER_PROCESS_SOURCE=/workspace/oldlight-transfer/browser-process-unicode-before.cjs falla antes, y ahora limita UTF8 después de sanitizar sin cortar caracteres. No se trata de una fuga de credenciales. Este ajuste quedó preservado al priorizar la investigación urgente del hanging; el árbol final combinado incluye ambas correcciones con evidencia separada.
