import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';

const bridgeSource=await readFile(new URL('../dist/extension/demo-bridge.js',import.meta.url),'utf8');
const backgroundSource=await readFile(new URL('../dist/extension/background.js',import.meta.url),'utf8');
const contentSource=await readFile(new URL('../dist/extension/content.js',import.meta.url),'utf8');
const focusSource=await readFile(new URL('../dist/extension/pet-focus.js',import.meta.url),'utf8');
const shortcutsSource=await readFile(new URL('../dist/extension/pet-shortcuts.js',import.meta.url),'utf8');
const origin='http://127.0.0.1:4391',alias='201a04f4-2c98-4111-a5e3-502919b41761';

function bridge({secure=false,ticket='gift-fixture-ticket',status=200}={}){
  const base=secure?'https://www.pawplusme.com':origin,listeners=[],sent=[],replies=[],requests=[];
  const window={postMessage:value=>replies.push(structuredClone(value))};
  const context=vm.createContext({...configGlobals(),window,URL,document:{documentElement:{dataset:{}}},
    addEventListener:(type,fn)=>{if(type==='message')listeners.push(fn);},
    fetch:async(url,options)=>{requests.push({url,options});return Response.json({token:ticket},{status});},
    chrome:{runtime:{sendMessage(message,done){sent.push(structuredClone(message));done({ok:true});}},storage:{onChanged:{addListener(){}}}}
  });
  Object.assign(context,configGlobals(base));
  vm.runInContext(bridgeSource,context);
  return {base,sent,replies,requests,async adopt({gift,foreign=false}={}){for(const fn of listeners)await fn({source:window,origin:foreign?'https://untrusted.test':base,data:{channel:'pet-companion-page',action:'adopt',petId:alias,requestId:'gift-1',...(gift===undefined?{}:{gift})}});}};
}

test('HTTP gift pickup obtains a cookie-authorized claim ticket before contacting the extension',async()=>{
  const app=bridge();await app.adopt({gift:true});
  assert.equal(app.requests.length,1);assert.equal(app.requests[0].url,origin+'/api/claim-ticket');
  assert.equal(app.requests[0].options.credentials,'include');
  assert.equal(app.requests[0].options.headers['X-Pet-Demo'],'1');
  assert.deepEqual(JSON.parse(app.requests[0].options.body),{petId:alias});
  assert.equal(app.sent[0].claimToken,'gift-fixture-ticket');
});

test('failed or malformed gift authorization never falls through to unprotected HTTP adoption',async()=>{
  for(const options of [{status:404},{ticket:''},{ticket:null}]){
    const app=bridge(options);await app.adopt({gift:true});
    assert.equal(app.sent.length,0);assert.equal(app.replies.at(-1).code,'claim-required');
  }
});

test('the ordinary HTTP demo stays unchanged while HTTPS adoption still requires a ticket',async()=>{
  const local=bridge();await local.adopt();assert.equal(local.requests.length,0);assert.equal(local.sent[0].claimToken,undefined);
  const secure=bridge({secure:true});await secure.adopt();assert.equal(secure.requests.length,1);assert.equal(secure.sent[0].claimToken,'gift-fixture-ticket');
  const foreign=bridge();await foreign.adopt({gift:true,foreign:true});assert.equal(foreign.sent.length,0);assert.equal(foreign.requests.length,0);
});

function background(){
  const handlers=[],requests=[],state={},library=new Map(),empty=()=>({addListener(){}});
  const chrome={runtime:{onMessage:{addListener:fn=>handlers.push(fn)},onInstalled:empty(),onStartup:empty(),getURL:name=>'chrome-extension://fixture/'+name,getManifest:()=>({version:'0.6.9'})},
    tabs:{create(){}},storage:{onChanged:empty(),local:{async get(keys){return Object.fromEntries(keys.filter(key=>key in state).map(key=>[key,state[key]]));},async set(values){Object.assign(state,values);}}},
    alarms:{onAlarm:empty(),async get(){},async create(){},async clear(){}}};
  const manifest={id:alias,name:'Local preview gift',columns:4,rows:5,cellSize:192,motion:'poses',animations:{look:[0,1,2,3,4,5,6,7],run:[8],sleep:[9],peek:[10]}};
  const context=vm.createContext({...configGlobals(),chrome,URL,Uint8Array,btoa,console,crypto:{randomUUID:()=>alias},
    PetLibrary:{async list(){return [...library.values()];},async get(id){return library.get(id);},async put(pet){library.set(pet.id,pet);}},
    fetch:async(url,options)=>{requests.push({url,options:structuredClone(options)});return url.endsWith('/pet.json')?Response.json(manifest):new Response(Uint8Array.of(137,80,78,71),{headers:{'content-type':'image/png'}});},
    importScripts(...names){for(const name of names)if(name==='pet-focus.js')vm.runInContext(focusSource,context);else if(name==='pet-shortcuts.js')vm.runInContext(shortcutsSource,context);}
  });
  Object.assign(context,configGlobals(origin));
  vm.runInContext(backgroundSource,context);
  return {requests,state,async adopt(claimToken){await vm.runInContext('focusQueue',context);return new Promise(resolve=>handlers.forEach(fn=>fn({action:'adopt',petId:alias,...(claimToken?{claimToken}:{})},{url:origin+'/gift'},resolve)));}};
}

test('HTTP claim-token adoption uses bearer-only downloads and preserves the gift alias in its local cache',async()=>{
  const app=background();assert.equal((await app.adopt('recipient-ticket')).ok,true);
  assert.equal(app.requests.length,2);assert.equal(app.state.pet.id,alias);
  for(const {url,options} of app.requests){assert.match(url,new RegExp('/pets/'+alias+'/'));assert.equal(options.headers.Authorization,'Bearer recipient-ticket');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');}
});

test('legacy HTTP adoption without a ticket still uses the existing local demo path',async()=>{
  const app=background();assert.equal((await app.adopt()).ok,true);
  assert.equal(app.requests.length,2);for(const {options} of app.requests)assert.deepEqual(options,{});
});

test('gift pages keep their own preview runtime without injecting a second extension pet',()=>{
  for(const pathname of ['/','/index.html','/gift','/gift.html']){
    const context=vm.createContext({...configGlobals(),document:{documentElement:{dataset:{}}},location:{origin:'http://127.0.0.1:4318',pathname}});
    assert.doesNotThrow(()=>vm.runInContext(contentSource,context));
  }
});
