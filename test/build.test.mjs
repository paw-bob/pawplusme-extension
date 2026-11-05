import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {buildExtension,validateOrigin,DEFAULT_ORIGIN,DEVELOPMENT_ORIGIN} from '../scripts/build.mjs';
import {createZip,readZip} from '../scripts/zip.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const packageVersion=JSON.parse(await readFile(join(root,'package.json'))).version;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const temporary=async t=>{const dir=await mkdtemp(join(tmpdir(),'pawplusme-build-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;};
const sourceHashes=async(path=root)=>Object.fromEntries((await Promise.all((await readdir(path,{withFileTypes:true})).filter(entry=>!['dist','node_modules','.git'].includes(entry.name)).map(async entry=>{
  const file=join(path,entry.name);return entry.isDirectory()?Object.entries(await sourceHashes(file)):[[file,digest(await readFile(file))]];
}))).flat());

test('production release is deterministic, complete and does not modify source',async t=>{
  const dir=await temporary(t),before=await sourceHashes();
  const first=await buildExtension({outDir:join(dir,'a'),sourceCommit:'1234567890abcdef'}),second=await buildExtension({outDir:join(dir,'b'),sourceCommit:'1234567890abcdef'});
  for(const key of ['zip','runtimeZip','sourceZip','manifestPath'])assert.deepEqual(await readFile(first[key]),await readFile(second[key]),key);
  assert.deepEqual(await sourceHashes(),before);
  const files=readZip(await readFile(first.zip)),manifest=JSON.parse(files.get('manifest.json'));
  assert.equal(manifest.version,packageVersion);assert.deepEqual(manifest.host_permissions,[`${DEFAULT_ORIGIN}/*`]);
  assert.ok(files.has('site-config.js'));assert.ok(files.has('nunito-sans-700.woff2'));assert.ok(!files.has('extension/manifest.json'));
  const context=vm.createContext({});vm.runInContext(files.get('site-config.js').toString(),context);
  assert.equal(context.PawPlusMeConfig.siteOrigin,DEFAULT_ORIGIN);assert.equal(context.PawPlusMeConfig.campaign.utm_source,'pawplusme_extension');
  for(const [name,bytes]of files)if(/\.(?:js|json|html|css)$/.test(name))assert.doesNotMatch(bytes.toString(),/127\.0\.0\.1|localhost|\/Users\//,name);
  const release=JSON.parse(await readFile(first.manifestPath));assert.equal(release.commit,'1234567890abcdef');
  for(const [name,bytes]of readZip(await readFile(first.runtimeZip)))assert.equal(release.runtimeFiles[name],digest(bytes));
});

test('development and preview configurations use one generated origin throughout',async t=>{
  const dir=await temporary(t);
  const origins=[DEVELOPMENT_ORIGIN,'http://127.0.0.1:4391','http://localhost:4391','http://[::1]:4391','https://preview.example.com'];
  for(const [index,origin] of origins.entries()){
    // Hostnames such as [::1] are valid origins but invalid Windows directory names.
    const built=await buildExtension({origin,outDir:join(dir,`origin-${index}`)}),files=readZip(await readFile(built.zip));
    const manifest=JSON.parse(files.get('manifest.json'));assert.deepEqual(manifest.host_permissions,[`${origin}/*`]);
    assert.deepEqual(manifest.content_scripts.find(script=>script.js.includes('demo-bridge.js')).matches,[`${origin}/*`]);
    assert.match(files.get('site-config.js').toString(),new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    for(const file of ['background.js','content.js','popup.js','demo-bridge.js'])assert.match(files.get(file).toString(),/PawPlusMeConfig\.siteOrigin/,file);
  }
  for(const origin of ['http://preview.example.com','http://localhost.example.com:4391','https://preview.example.com/path','https://user:pass@preview.example.com','https://preview.example.com:444','https://preview.example.com?token=x','https://preview.example.com#x'])assert.throws(()=>validateOrigin(origin));
  await assert.rejects(buildExtension({outDir:join(root,'src/overwrite')}),/overwrite/);
});

test('source release builds standalone without private files or checkout',async t=>{
  const dir=await temporary(t),built=await buildExtension({outDir:join(dir,'original'),sourceCommit:'release-commit'}),source=readZip(await readFile(built.sourceZip));
  assert.ok(source.has('scripts/build.mjs'));assert.ok(source.has('LICENSE'));assert.ok(source.has('THIRD_PARTY_NOTICES.md'));
  for(const [name,bytes]of source){assert.doesNotMatch(name,/(?:^|\/)(?:test|cloud|data|\.env|\.git)(?:\/|$)/);const file=join(dir,'source',name);await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes);}
  const {buildExtension:portableBuild}=await import(pathToFileURL(join(dir,'source/scripts/build.mjs')).href);
  const rebuilt=await portableBuild({outDir:join(dir,'rebuilt'),sourceCommit:'release-commit'});
  assert.deepEqual(await readFile(rebuilt.zip),await readFile(built.zip));
  assert.deepEqual(await readFile(rebuilt.runtimeZip),await readFile(built.runtimeZip));
  await rm(join(dir,'source/LICENSE'));
  await assert.rejects(portableBuild({outDir:join(dir,'without-license')}),{code:'ENOENT'});
  await writeFile(join(dir,'source/LICENSE'),source.get('LICENSE'));
  await rm(join(dir,'source/THIRD_PARTY_NOTICES.md'));
  await assert.rejects(portableBuild({outDir:join(dir,'without-notices')}),{code:'ENOENT'});
});

test('ZIP reader checks integrity and rejects unsafe or duplicate paths',()=>{
  const encoded=createZip(new Map([['hello.txt',Buffer.from('hello ZIP')],['empty.txt',Buffer.alloc(0)]]));
  assert.equal(readZip(encoded).get('hello.txt').toString(),'hello ZIP');assert.equal(readZip(encoded).get('empty.txt').length,0);
  assert.deepEqual(encoded,createZip({'empty.txt':Buffer.alloc(0),'hello.txt':Buffer.from('hello ZIP')}));
  for(const name of ['../file','/file','C:/file','a\\b','a//b','a/./b'])assert.throws(()=>createZip({[name]:Buffer.alloc(0)}),/Unsafe/);
  assert.throws(()=>createZip(new Map([['A',Buffer.alloc(0)],['a',Buffer.alloc(0)]])),/Duplicate/);
  const broken=Buffer.from(encoded);broken[encoded.indexOf(Buffer.from('hello.txt'))+'hello.txt'.length+2]^=1;assert.throws(()=>readZip(broken));
  assert.throws(()=>readZip(encoded.subarray(0,encoded.length-1)));
  // A ZIP generated independently by Python's stdlib, not by createZip.
  const independent=Buffer.from('UEsDBBQAAAAIAFCZZF1ChqYJFwAAABcAAAAPAAAAaW5kZXBlbmRlbnQudHh0y8xLSS1IBRJ5JQpRngEKaZkVJaVFqQBQSwECFAMUAAAACABQmWRdQoamCRcAAAAXAAAADwAAAAAAAAAAAAAAgAEAAAAAaW5kZXBlbmRlbnQudHh0UEsFBgAAAAABAAEAPQAAAEQAAAAAAA==','base64');
  assert.equal(readZip(independent).get('independent.txt').toString(),'independent ZIP fixture');
});
