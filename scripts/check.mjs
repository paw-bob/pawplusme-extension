import {readFile,readdir,access} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {buildExtension,DEFAULT_ORIGIN} from './build.mjs';
import {readZip} from './zip.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const walk=async path=>(await Promise.all((await readdir(path,{withFileTypes:true})).map(async entry=>entry.isDirectory()?walk(join(path,entry.name)):[join(path,entry.name)]))).flat();
for(const path of [...await walk(join(root,'src')),...await walk(join(root,'scripts'))]){
  if(/\.(?:js|mjs)$/.test(path))execFileSync(process.execPath,['--check',path],{stdio:'pipe'});
}
const built=await buildExtension(),files=await readZip(await readFile(built.zip));
const manifest=JSON.parse(files.get('manifest.json'));
assert.equal(manifest.version,JSON.parse(await readFile(join(root,'package.json'))).version);
assert.deepEqual(manifest.permissions,['storage','alarms']);
assert.deepEqual(manifest.host_permissions,[`${DEFAULT_ORIGIN}/*`]);
const referenced=[manifest.background.service_worker,manifest.action.default_popup,...Object.values(manifest.icons),...Object.values(manifest.action.default_icon),...manifest.content_scripts.flatMap(script=>script.js)];
for(const name of referenced)assert.ok(files.has(name),`Missing manifest resource: ${name}`);
for(const block of manifest.content_scripts)assert.equal(block.js[0],'site-config.js');
for(const [name,bytes]of files){
  assert.ok(!/(?:^|\/)(?:\.env[^/]*|node_modules|data|cloud|artifacts|\.git)(?:\/|$)/.test(name),`Private path in extension: ${name}`);
  if(/\.(?:js|json|html|css)$/.test(name)){
    const source=bytes.toString();
    assert.ok(!/localhost|127\.0\.0\.1|\/Users\/|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(source),`Development/private content in production extension: ${name}`);
    if(/\.html$/.test(name))for(const match of source.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)){
      const resource=match[1];if(!/^(?:https?:|data:)/.test(resource))assert.ok(files.has(resource.replace(/^\//,'')),`Missing HTML resource: ${resource}`);
    }
    if(/\.css$/.test(name))for(const match of source.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)){
      const resource=match[1];if(!/^(?:https?:|data:)/.test(resource))assert.ok(files.has(resource.replace(/^\//,'')),`Missing CSS resource: ${resource}`);
    }
  }
}
assert.ok(files.has(`_locales/${manifest.default_locale}/messages.json`));
const release=JSON.parse(await readFile(built.manifestPath));
for(const [name,hash]of Object.entries(release.files))assert.equal(createHash('sha256').update(await readFile(join(root,'dist',name))).digest('hex'),hash);
for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md'])await access(join(root,name));
console.log(`Checked ${files.size} production extension files, manifest references, syntax and release hashes.`);
