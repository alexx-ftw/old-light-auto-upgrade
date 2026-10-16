'use strict';
const path=require('node:path'),fs=require('node:fs'),{launch}=require('./helpers/browser-process.cjs');
const dir=process.argv[2],handle=launch(process.execPath,[path.join(__dirname,'browser-startup.fixture.cjs'),'ready'],dir);
handle.endpoint.then(()=>fs.writeFileSync(path.join(dir,'signal-ready.json'),JSON.stringify({pid:handle.child.pid}))).catch(()=>process.exitCode=1);
