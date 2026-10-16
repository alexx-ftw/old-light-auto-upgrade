# Trabajo en este repositorio

Antes de preparar una publicación, lee [docs/release-validation.md](docs/release-validation.md) y [docs/independent-code-review.md](docs/independent-code-review.md). La revisión independiente debe ser fresca y corresponder al commit/árbol final exacto; repetir la suite del autor no la sustituye.

Para informes de parpadeo o cambios del overlay de refuerzos, lee y aplica [docs/overlay-validation-process.md](docs/overlay-validation-process.md) antes de cambiar comportamiento. Reproduce primero con bytes anteriores, conserva el mismo harness para comparar y exige evidencia temporal entre eventos y frames con callbacks ejecutados contados y un control de sensibilidad. Mantén controles negativos de censo, cámara y gestos. Documenta regresiones y límites; si no reproduces, conserva esa incertidumbre.

Distingue versión instalada, versión publicada, simulación DOM, pintura real del navegador y confirmación del usuario. Una corrección condicional offline no cierra por sí sola el incidente real. El alcance de las pruebas debe ajustarse al defecto; no prometas cobertura exhaustiva ni uses la partida real para obtener evidencia.

Publica solo dentro de la autorización vigente: commit limpio final, gate completo, concurrencia comprobada, sin force push; después verifica commit/árbol/padre remoto, CI exacto y bytes de autoupdate y archivos servidos afectados. Un cambio posterior invalida el gate anterior y exige nueva revisión de su diff y validación final.
