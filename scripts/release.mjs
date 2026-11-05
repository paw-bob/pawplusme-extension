import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function releaseArguments({root=ROOT,tag=process.env.RELEASE_TAG}={}){
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  const manifestBytes=await readFile(join(root,'dist/release.json'));
  const release=JSON.parse(manifestBytes);
  assert.equal(tag,`v${pkg.version}`,'Release tag must match the package version.');
  assert.equal(release.version,pkg.version,'Built release version must match the package version.');
  assert.equal(release.origin,'https://www.pawplusme.com','Publish only the official website build.');
  const names=Object.keys(release.files).sort();
  assert.deepEqual(names,['extension','runtime','source'].map(kind=>`pawplusme-${kind}-${pkg.version}.zip`),'Release must contain exactly the three versioned archives.');
  for(const name of names)assert.equal(sha256(await readFile(join(root,'dist',name))),release.files[name],`Archive checksum mismatch: ${name}`);
  const expectedSums={...release.files,'release.json':sha256(manifestBytes)};
  const sums=Object.entries(expectedSums).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,hash])=>`${hash}  ${name}`).join('\n')+'\n';
  assert.equal(await readFile(join(root,'dist/SHA256SUMS'),'utf8'),sums,'Checksum file must match the selected release.');
  const paths=[...names,'release.json','SHA256SUMS'].map(name=>join(root,'dist',name));
  return ['release','create',tag,...paths,'--draft','--verify-tag','--generate-notes'];
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.slice(2).some(arg=>arg!=='--dry-run'))throw new Error('Usage: node scripts/release.mjs [--dry-run]');
  const args=await releaseArguments();
  if(process.argv.includes('--dry-run'))console.log(JSON.stringify({command:'gh',args},null,2));
  else execFileSync('gh',args,{cwd:ROOT,stdio:'inherit'});
}
