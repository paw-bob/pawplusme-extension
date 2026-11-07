import {readFile,writeFile,readdir,mkdir,rm,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,join,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createZip} from './zip.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const DEFAULT_ORIGIN='https://www.pawplusme.com';
export const DEVELOPMENT_ORIGIN='http://127.0.0.1:4318';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const campaign={utm_source:'pawplusme_extension',utm_medium:'referral',utm_campaign:'opensource'};

export function validateOrigin(origin){
  let url;try{url=new URL(origin);}catch{throw new Error('Provide an HTTPS origin or an explicit loopback development origin.');}
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))||(url.port&&!loopback))throw new Error('Provide an HTTPS origin or an explicit loopback development origin.');
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('The site origin must not include credentials, a path, query parameters or a fragment.');
  return url.origin;
}
async function tree(path,prefix=''){
  const result=new Map();
  for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    const name=prefix+entry.name,source=join(path,entry.name);
    if(entry.isSymbolicLink())throw new Error(`Symlinks are not allowed in release inputs: ${name}`);
    if(entry.isDirectory())for(const [key,value]of await tree(source,`${name}/`))result.set(key,value);
    else if(entry.isFile())result.set(name,await readFile(source));
  }
  return result;
}
async function saveTree(path,files){
  for(const [name,bytes]of files){const target=join(path,name);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);}
}
async function commitId(sourceCommit){
  if(sourceCommit)return sourceCommit;
  try{await lstat(join(ROOT,'.git'));return execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return 'uncommitted';}
}

export async function buildExtension({origin=DEFAULT_ORIGIN,outDir=join(ROOT,'dist'),sourceCommit}={}){
  const target=validateOrigin(origin),output=resolve(outDir),sourceRoots=['src','assets','scripts','test','.github'];
  const inside=(parent,child)=>{const path=relative(parent,child);return !path||(!isAbsolute(path)&&path!=='..'&&!path.startsWith(`..${sep}`));};
  if(inside(output,ROOT)||sourceRoots.some(name=>inside(join(ROOT,name),output)))throw new Error('The build directory must not overwrite source files.');
  const pkg=JSON.parse(await readFile(join(ROOT,'package.json'),'utf8')),version=pkg.version;
  if(!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version))throw new Error('The package version must be a Chrome extension version.');
  const extensionFiles=await tree(join(ROOT,'src/extension')),runtimeFiles=await tree(join(ROOT,'src/shared'));
  for(const [name,bytes]of await tree(join(ROOT,'assets/fonts')))runtimeFiles.set(name,bytes);
  for(const [name,bytes]of runtimeFiles){if(extensionFiles.has(name))throw new Error(`Duplicate extension file: ${name}`);extensionFiles.set(name,bytes);}
  for(const [name,bytes]of await tree(join(ROOT,'assets/icons'),'icons/'))extensionFiles.set(name,bytes);
  const manifest=JSON.parse(extensionFiles.get('manifest.json').toString());
  manifest.version=version;manifest.host_permissions=[`${target}/*`];manifest.content_scripts.find(script=>script.js.includes('demo-bridge.js')).matches=[`${target}/*`];
  extensionFiles.set('manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
  extensionFiles.set('site-config.js',Buffer.from(`globalThis.PawPlusMeConfig=Object.freeze(${JSON.stringify({siteOrigin:target,campaign})});\n`));
  await mkdir(output,{recursive:true});
  const extension=join(output,'extension');await rm(extension,{recursive:true,force:true});await saveTree(extension,extensionFiles);
  const zip=join(output,`pawplusme-extension-${version}.zip`),runtimeZip=join(output,`pawplusme-runtime-${version}.zip`),sourceZip=join(output,`pawplusme-source-${version}.zip`);
  const sourceFiles=new Map();
  for(const sub of ['src','assets'])for(const [name,bytes]of await tree(join(ROOT,sub),`${sub}/`))sourceFiles.set(name,bytes);
  const sourcePackage={...pkg,scripts:{build:pkg.scripts.build,'build:dev':pkg.scripts['build:dev']}};
  sourceFiles.set('package.json',Buffer.from(JSON.stringify(sourcePackage,null,2)+'\n'));
  for(const name of ['scripts/build.mjs','scripts/zip.mjs','LICENSE','THIRD_PARTY_NOTICES.md']){
    sourceFiles.set(name,await readFile(join(ROOT,name)));
  }
  const artifacts=new Map([[zip,createZip(extensionFiles)],[runtimeZip,createZip(runtimeFiles)],[sourceZip,createZip(sourceFiles)]]);
  for(const [path,bytes]of artifacts)await writeFile(path,bytes);
  const release={schema:1,name:'pawplusme-extension',version,origin:target,commit:await commitId(sourceCommit),files:Object.fromEntries([...artifacts].map(([path,bytes])=>[relative(output,path),sha256(bytes)])),runtimeFiles:Object.fromEntries([...runtimeFiles].map(([name,bytes])=>[name,sha256(bytes)]))};
  const manifestPath=join(output,'release.json');await writeFile(manifestPath,JSON.stringify(release,null,2)+'\n');
  await writeFile(join(output,'SHA256SUMS'),Object.entries({...release.files,'release.json':sha256(await readFile(manifestPath))}).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,hash])=>`${hash}  ${name}`).join('\n')+'\n');
  return {origin:target,extension,zip,runtimeZip,sourceZip,manifestPath,version};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--dev')options.origin=DEVELOPMENT_ORIGIN;
    else if(args[i]==='--origin'&&args[i+1])options.origin=args[++i];
    else if(args[i]==='--out-dir'&&args[i+1])options.outDir=args[++i];
    else throw new Error(`Unknown or incomplete build option: ${args[i]}`);
  }
  const result=await buildExtension(options);console.log(`Built PawPlusMe ${result.version} for ${result.origin}: ${result.zip}`);
}
