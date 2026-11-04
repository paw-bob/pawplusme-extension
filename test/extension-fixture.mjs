import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// Exercise packaged scripts while keeping all fixture traffic on a fake backend.
const context=vm.createContext({});
vm.runInContext(await readFile(new URL('../dist/extension/site-config.js',import.meta.url),'utf8'),context);
const config=structuredClone(context.PawPlusMeConfig);
export function configGlobals(siteOrigin='http://127.0.0.1:4318'){
  return {PawPlusMeConfig:Object.freeze({...config,siteOrigin})};
}
