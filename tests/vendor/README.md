# Offline browser dependency

`pixi-8.22.0.min.js` is the unmodified `package/dist/pixi.min.js` from the official npm `pixi.js@8.22.0` distribution, obtained read-only from https://registry.npmjs.org/pixi.js/-/pixi.js-8.22.0.tgz.

- Tarball integrity: `sha512-QbTANHMZ751MIjLiLSUSM8a7LNMWwMIf0KbRCqlW+SPS9hNLfSVS+cl1O2SEp9g1K/wyLzj/OJHv+1TUfiPr/w==`, verified before extraction.
- Browser file: 840663 bytes; SHA256 `06d9ef9823e743518793083c296d801e752db128cb1f519fbabe37e1259567ea`.
- MIT license copied verbatim to `pixi-LICENSE`.
- Test-only dependency. Not loaded or distributed by the userscript or Pages; no runtime download or installation in the release gate.

This official Pixi version is an explicit reference renderer, not proof of the version embedded in Old Light's public asset graph. The test uses real Pixi WebGL rendering with synthetic stars and the exact previously verified native camera excerpt. It never evaluates the game bootstrap or opens game network connections.
