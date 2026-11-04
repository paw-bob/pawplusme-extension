import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const directory=new URL('../test/',import.meta.url);
const files=(await readdir(directory)).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>fileURLToPath(new URL(name,directory)));
if(!files.length)throw new Error('No test files found.');
const env={...process.env};delete env.NODE_TEST_CONTEXT;
const child=spawnSync(process.execPath,['--test',...files],{stdio:'inherit',env});
if(child.error)throw child.error;
process.exitCode=child.status??1;
