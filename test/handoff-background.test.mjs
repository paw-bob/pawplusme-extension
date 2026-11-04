import test from 'node:test';
import {fullPetFixture} from './full-motion-fixture.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../dist/extension/background.js',import.meta.url),'utf8');
const focusSource=await readFile(new URL('../dist/extension/pet-focus.js',import.meta.url),'utf8');
const shortcutsSource=await readFile(new URL('../dist/extension/pet-shortcuts.js',import.meta.url),'utf8');
const i18nSource=await readFile(new URL('../dist/extension/pet-i18n.js',import.meta.url),'utf8');
const bridgeSource=await readFile(new URL('../dist/extension/demo-bridge.js',import.meta.url),'utf8');
const popupSource=await readFile(new URL('../dist/extension/popup.js',import.meta.url),'utf8');
const BASE='http://127.0.0.1:4318';
const id='64bcddbc-c205-4b4c-b384-c2b3418ff22c';
const manifest={id,name:'原名字',createdAt:'2026-11-01T09:00:00Z',columns:4,rows:5,cellSize:192,animations:{look:[0,1,2,3,4,5,6,7],run:[8],sleep:[9],peek:[10]},motion:'poses'};

function worker(initial={},assetManifest=manifest,{savedPets=[]}={}){
  const store=structuredClone(initial),listeners={message:[],installed:[],startup:[],changed:[],alarm:[]},requests=[],opened=[];
  const event=key=>({addListener:fn=>listeners[key].push(fn)});
  const alarms=new Map();
  let failImage=false,failLibrary=false,failCache=false,context;
  const library=new Map(savedPets.map(pet=>[pet.id,structuredClone(pet)]));
  const PetLibrary={
    async list(){return [...library.values()].map(pet=>({id:pet.id,name:pet.name||'小伴',revision:pet.revision||''}));},
    async get(id){return library.has(id)?structuredClone(library.get(id)):null;},
    async put(pet){if(failLibrary)throw new Error('宠物暂时无法保存，请检查浏览器存储空间后重试。');library.set(pet.id,structuredClone(pet));}
  };
  const chrome={
    runtime:{onMessage:event('message'),onStartup:event('startup'),onInstalled:event('installed'),getManifest:()=>({version:'0.4.0'}),getURL:path=>`chrome-extension://fixture/${path}`},
    tabs:{create:options=>opened.push(structuredClone(options))},
    storage:{onChanged:event('changed'),local:{
      async get(keys){return Object.fromEntries(keys.filter(key=>key in store).map(key=>[key,structuredClone(store[key])]));},
      async set(values){if(failCache&&values.pet)throw new Error('QUOTA_BYTES quota exceeded');const changes={};for(const [key,value]of Object.entries(values)){changes[key]={oldValue:store[key],newValue:structuredClone(value)};store[key]=structuredClone(value);}listeners.changed.forEach(fn=>fn(changes,'local'));}
    }},
    alarms:{onAlarm:event('alarm'),async get(name){return alarms.get(name);},async create(name,value){alarms.set(name,value);},async clear(name){return alarms.delete(name);}}
  };
  const fetch=async url=>{
    requests.push(url);
    if(url===`${BASE}/pets/${assetManifest.id}/pet.json`)return Response.json(assetManifest);
    if([`${BASE}/pets/${assetManifest.id}/sheet.png`,`${BASE}/pets/${assetManifest.id}/motion.png`].includes(url))return new Response(new Uint8Array([137,80,78,71]),{status:failImage?503:200,headers:{'content-type':'image/png'}});
    throw new Error(`unexpected fetch ${url}`);
  };
  let serial=0;
  context=vm.createContext({...configGlobals(),chrome,fetch,URL,console,Uint8Array,btoa,PetLibrary,crypto:{randomUUID:()=>`selection-${++serial}`},importScripts:(...names)=>{for(const name of names){assert.ok(['site-config.js','pet-i18n.js','pet-focus.js','pet-shortcuts.js','pet-library.js'].includes(name));if(name!=='pet-library.js'&&name!=='site-config.js')vm.runInContext(name==='pet-i18n.js'?i18nSource:name==='pet-shortcuts.js'?shortcutsSource:focusSource,context);}}});
  vm.runInContext(source,context);
  const settled=()=>vm.runInContext('focusQueue',context);
  const send=(message,sender={url:`${BASE}/?welcome=1`,tab:{id:1}})=>new Promise((resolve,reject)=>{
    let handled=false;
    for(const listener of listeners.message){if(listener(message,sender,response=>resolve(structuredClone(response)))===true)handled=true;}
    if(!handled)reject(new Error('message not handled'));
  });
  return{store,library,requests,opened,send,settled,failImage(){failImage=true;},failLibrary(){failLibrary=true;},failCache(value=true){failCache=value;},setManifest(value){assetManifest=value;},async installed(reason){for(const fn of listeners.installed)await fn({reason});await settled();}};
}

const popupSender={url:'chrome-extension://fixture/popup.html'};
const savedPet={...manifest,id:'301a04f4-2c98-4111-a5e3-502919b41761',name:'First pet',revision:'first-v1',image:'data:image/png;base64,first'};

test('the popup migrates a legacy pet and lists metadata without downloading assets',async()=>{
  const app=worker({pet:savedPet,enabled:false,mode:'sleep',size:180});await app.settled();
  const result=await app.send({action:'list-pets'},popupSender);
  assert.deepEqual(result,{ok:true,pets:[{id:savedPet.id,name:savedPet.name,revision:savedPet.revision}],activePetId:savedPet.id});
  assert.deepEqual(app.library.get(savedPet.id),savedPet);assert.deepEqual(app.store.pet,savedPet);
  assert.equal(app.store.enabled,false);assert.equal(app.store.mode,'sleep');assert.deepEqual(app.requests,[]);
});

test('adopting another pet retains the first and switching uses only cached assets',async()=>{
  const app=worker({pet:savedPet,mode:'follow',size:180,locale:'ja',shortcuts:{follow:{code:'KeyG',alt:true,shift:true}}});await app.settled();
  assert.equal((await app.send({action:'adopt',petId:id,name:'Second pet'})).error,undefined);
  const downloaded=app.requests.length,second=structuredClone(app.store.pet);
  assert.equal(app.library.size,2);assert.deepEqual(app.library.get(savedPet.id),savedPet);
  await app.send({action:'focus-start'});await app.settled();
  const result=await app.send({action:'select-pet',petId:savedPet.id},popupSender);
  assert.equal(result.pet.id,savedPet.id);assert.equal(result.petSelectionToken,'selection-1');
  assert.deepEqual(app.store.pet,savedPet);assert.equal(app.store.mode,'look');assert.equal(app.store.enabled,true);assert.equal(app.store.focus.phase,'off');
  assert.equal(app.store.size,180);assert.equal(app.store.locale,'ja');assert.equal(app.store.shortcuts.follow.code,'KeyG');
  assert.equal(app.store.recallToken,undefined,'selection must not make the website fetch another private order');
  assert.equal(app.requests.length,downloaded,'switching never downloads or generates');
  await app.send({action:'select-pet',petId:second.id},popupSender);assert.deepEqual(app.store.pet,second);
});

test('same-pet selection is a no-op and re-adoption updates one library entry',async()=>{
  const app=worker();await app.settled();await app.send({action:'adopt',petId:id});
  await app.send({action:'focus-start'});await app.settled();const before=structuredClone(app.store),downloads=app.requests.length;
  const same=await app.send({action:'select-pet',petId:id},popupSender);assert.equal(same.pet.id,id);assert.deepEqual(app.store,before);assert.equal(app.requests.length,downloads);
  app.setManifest({...manifest,updatedAt:'2026-11-03T03:00:00Z'});await app.send({action:'adopt',petId:id,name:'Updated pet'});
  assert.equal(app.library.size,1);assert.equal(app.library.get(id).revision,'2026-11-03T03:00:00Z');assert.equal(app.library.get(id).name,'Updated pet');
});

test('library or active-cache failures keep the old pet, settings and new saved assets recoverable',async()=>{
  const app=worker({pet:savedPet,mode:'sleep'});await app.settled();app.failLibrary();
  const failed=await app.send({action:'adopt',petId:id});assert.match(failed.error,/存储空间/);assert.deepEqual(app.store.pet,savedPet);assert.equal(app.store.mode,'sleep');
  const second={...savedPet,id,name:'Second pet'},select=worker({pet:savedPet,enabled:false,mode:'sleep'},{...manifest},{savedPets:[second]});await select.settled();
  select.failCache();const result=await select.send({action:'select-pet',petId:id},popupSender);assert.match(result.error,/存储空间/);
  assert.deepEqual(select.store.pet,savedPet);assert.equal(select.store.enabled,false);assert.equal(select.store.mode,'sleep');assert.deepEqual(select.library.get(id),second);
});

test('only the popup can enumerate or select saved pets and invalid choices do not alter state',async()=>{
  const app=worker({pet:savedPet});await app.settled();
  for(const sender of [{url:`${BASE}/`,tab:{id:1}},{url:'https://untrusted.test/',tab:{id:2}}])for(const action of ['list-pets','select-pet'])assert.match((await app.send({action,petId:savedPet.id},sender)).error,/只允许/);
  assert.match((await app.send({action:'select-pet',petId:'../../other'},popupSender)).error,/编号/);
  assert.match((await app.send({action:'select-pet',petId:id},popupSender)).error,/尚未保存/);
  assert.deepEqual(app.store.pet,savedPet);assert.deepEqual(app.requests,[]);
});

test('a downloaded pet remains in the library when active-cache persistence fails and can be selected later offline',async()=>{
  const app=worker({pet:savedPet,enabled:false,mode:'sleep'});await app.settled();app.failCache();
  const response=await app.send({action:'adopt',petId:id,name:'Saved for later'});
  assert.match(response.error,/存储空间/);assert.deepEqual(app.store.pet,savedPet);assert.equal(app.library.get(id).name,'Saved for later');
  const downloads=app.requests.length;app.failCache(false);
  const selected=await app.send({action:'select-pet',petId:id},popupSender);
  assert.equal(selected.pet.id,id);assert.equal(app.requests.length,downloads);assert.equal(app.library.size,2);
});

test('website adopts the selected pet and status reports the cached identity without resetting preferences',async()=>{
  const app=worker({pet:{id:'previous',name:'旧伙伴'},mode:'follow',size:180,enabled:false});
  await app.settled();
  const status=await app.send({action:'companion-status'});
  assert.deepEqual(status.pet,{id:'previous',name:'旧伙伴',revision:''});
  assert.equal(status.enabled,false);
  const result=await app.send({action:'adopt',petId:id,name:'  豆豆  '});
  const {shortcuts:adoptedShortcuts,...adoptedStatus}=result;assert.equal(adoptedShortcuts.follow.code,'Digit3');
  assert.deepEqual(adoptedStatus,{ok:true,protocol:1,version:'0.4.0',pet:{id,name:'豆豆',revision:manifest.createdAt},enabled:true,locale:'zh'});
  assert.equal(app.store.mode,'follow');assert.equal(app.store.size,180);
  assert.equal(app.store.focus.phase,'off');
  assert.deepEqual(app.requests,[`${BASE}/pets/${id}/pet.json`,`${BASE}/pets/${id}/sheet.png`]);
  assert.equal((await app.send({action:'companion-status'})).pet.id,id);
  assert.equal(app.requests.length,2,'status uses local cache and never generates or fetches a latest pet');
});

test('trusted site can read configured shortcuts and switch modes without changing the cached pet',async()=>{
  const custom={code:'KeyG',alt:true,shift:true,ctrl:false,meta:false},app=worker({pet:{id,name:'同一只'},shortcuts:{follow:custom},mode:'auto'});await app.settled();
  assert.deepEqual((await app.send({action:'companion-status'})).shortcuts.follow,custom);
  const result=await app.send({action:'set-mode',mode:'follow'});assert.equal(result.ok,true);assert.equal(app.store.mode,'follow');assert.equal(app.store.pet.id,id);
  assert.match((await app.send({action:'set-mode',mode:'invalid'})).error,/模式/);
  assert.match((await app.send({action:'set-mode',mode:'sleep'},{url:'https://untrusted.test/',tab:{id:2}})).error,/只允许/);assert.equal(app.store.mode,'follow');
});

test('extension accepts dense gaze and preserves its calibrated head anchor',async()=>{
  const dense={...manifest,columns:8,rows:9,gaze:{anchor:{x:.5,y:.24},frames:64,angles:Array.from({length:64},(_,i)=>i*Math.PI/32)},animations:{look:Array.from({length:64},(_,i)=>i),run:[64],sleep:[65],peek:[66]}};
  const app=worker({},dense);await app.settled();const result=await app.send({action:'adopt',petId:id});
  assert.equal(result.error,undefined);assert.equal(app.store.pet.animations.look.length,64);assert.deepEqual(app.store.pet.gaze,dense.gaze);
  const invalid=worker({}, {...dense,animations:{...dense.animations,look:Array.from({length:97},(_,i)=>i)}});await invalid.settled();assert.match((await invalid.send({action:'adopt',petId:id})).error,/动作列表/);
  const badAngles=worker({}, {...dense,gaze:{...dense.gaze,angles:[...dense.gaze.angles].reverse()}});await badAngles.settled();assert.match((await badAngles.send({action:'adopt',petId:id})).error,/动作列表/);
});

const runDirectionNames=['e','se','s','sw','w','nw','n','ne'];
const directionalRuns=()=>Object.fromEntries(runDirectionNames.map((direction,i)=>[direction,{frames:[8,11,12],flip:['sw','w','nw'].includes(direction)}]));

test('schema 3 accepts the complete bounded Fast atlas and retains all directional frames',async()=>{
  const sequence=start=>Array.from({length:96},(_,i)=>start+i);
  const pack={...manifest,schemaVersion:3,columns:16,rows:48,motion:'continuous-video',animations:{look:sequence(0),run:sequence(96),sleep:sequence(576),peek:sequence(672)},runDirections:Object.fromEntries(runDirectionNames.map((name,i)=>[name,{frames:sequence([96,192,288,192,96,384,480,384][i]),flip:['sw','w','nw'].includes(name)}]))};
  const app=worker({},pack);await app.settled();assert.equal((await app.send({action:'adopt',petId:id})).error,undefined);
  assert.equal(app.store.pet.columns,16);assert.equal(app.store.pet.rows,48);assert.equal(app.store.pet.animations.peek.at(-1),767);assert.deepEqual(app.store.pet.runDirections,pack.runDirections);
  for(const invalid of [{...pack,rows:49},{...pack,columns:32},{...pack,schemaVersion:2}]){
    const rejected=worker({pet:{id:'previous'}},invalid);await rejected.settled();assert.match((await rejected.send({action:'adopt',petId:id})).error,/动作格式/);assert.equal(rejected.store.pet.id,'previous');
  }
});

test('extension imports complete eight-direction runs and restores only their whitelisted cache structure',async()=>{
  const runDirections=directionalRuns();runDirections.w.frames=runDirections.e.frames;
  const app=worker({mode:'follow',size:180},{...manifest,runDirections});await app.settled();
  const result=await app.send({action:'adopt',petId:id,name:'八方向伙伴'});
  assert.equal(result.error,undefined);assert.deepEqual(app.store.pet.runDirections,runDirections);
  assert.deepEqual(Object.keys(app.store.pet.runDirections),runDirectionNames);
  for(const entry of Object.values(app.store.pet.runDirections))assert.deepEqual(Object.keys(entry),['frames','flip']);
  assert.equal(app.store.mode,'follow');assert.equal(app.store.size,180);
  const restored=worker(app.store);await restored.settled();
  const identity=await restored.send({action:'companion-status'});
  assert.equal(identity.pet.name,'八方向伙伴');assert.deepEqual(restored.store.pet.runDirections,runDirections);
  assert.equal(restored.requests.length,0,'restored directions remain local and do not fetch assets again');
});

test('extension rejects incomplete, invalid or polluted direction maps before replacing its cached pet',async()=>{
  const cases=[
    ['null',()=>null],['array',()=>[]],['missing direction',value=>{delete value.ne;return value;}],
    ['unknown direction',value=>({...value,sideways:{frames:[8,9],flip:false}})],
    ['one frame',value=>{value.e.frames=[8];return value;}],
    ['non-array frames',value=>{value.e.frames='8,9';return value;}],
    ['negative frame',value=>{value.s.frames=[-1,9];return value;}],
    ['outside atlas',value=>{value.s.frames=[8,20];return value;}],
    ['fractional frame',value=>{value.n.frames=[8,9.5];return value;}],
    ['NaN frame',value=>{value.n.frames=[8,NaN];return value;}],
    ['infinite frame',value=>{value.n.frames=[8,Infinity];return value;}],
    ['too many frames',value=>{value.ne.frames=Array.from({length:97},()=>8);return value;}],
    ['string flip',value=>{value.sw.flip='true';return value;}],
    ['missing flip',value=>{delete value.w.flip;return value;}],
    ['extra entry field',value=>{value.se.url='https://untrusted.test/run.png';return value;}],
    ['prototype direction',value=>JSON.parse(JSON.stringify(value).replace(/}$/,',"__proto__":{"polluted":true}}'))],
    ['prototype entry field',value=>{value.n=JSON.parse('{"frames":[8,9],"flip":false,"__proto__":{"polluted":true}}');return value;}],
  ];
  for(const [label,change]of cases){
    const previous={id:'previous',name:'原伙伴'},app=worker({pet:previous,enabled:true},{...manifest,runDirections:change(directionalRuns())});
    await app.settled();const result=await app.send({action:'adopt',petId:id});
    assert.match(result.error||'',/动作列表/,label);assert.deepEqual(app.store.pet,previous,label);
    assert.deepEqual(app.requests,[`${BASE}/pets/${id}/pet.json`],label+' is rejected before PNG download');
    assert.equal({}.polluted,undefined,label+' does not pollute local prototypes');
  }
});

test('legacy pets without directional runs keep their original import shape',async()=>{
  const app=worker({},manifest);await app.settled();const result=await app.send({action:'adopt',petId:id});
  assert.equal(result.error,undefined);assert.equal(Object.hasOwn(app.store.pet,'runDirections'),false);
  assert.deepEqual(app.store.pet.animations,manifest.animations);
});

test('failed download preserves the previous pet and untrusted pages cannot query or replace it',async()=>{
  const app=worker({pet:{id:'previous',name:'旧伙伴'},enabled:true});await app.settled();app.failImage();
  const before=structuredClone(app.store.pet);
  const failed=await app.send({action:'adopt',petId:id,name:'新伙伴'});
  assert.match(failed.error,/PNG/);assert.deepEqual(app.store.pet,before);
  for(const action of ['companion-status','adopt','set-language']){
    const denied=await app.send({action,petId:id},{url:'https://example.test/',tab:{id:2}});
    assert.match(denied.error,/只允许/);
  }
  const invalid=await app.send({action:'adopt',petId:'../../other'});
  assert.match(invalid.error,/编号无效/);assert.equal(app.requests.length,2);
});

test('only first installation opens the website so its existing local progress can resume',async()=>{
  const app=worker();await app.settled();await app.installed('update');assert.equal(app.opened.length,0);
  await app.installed('install');assert.equal(app.opened.length,1);const welcome=new URL(app.opened[0].url);assert.equal(welcome.origin,BASE);assert.equal(welcome.searchParams.get('welcome'),'1');assert.equal(welcome.searchParams.get('lang'),'zh');assert.equal(welcome.searchParams.get('utm_source'),'pawplusme_extension');assert.equal(welcome.searchParams.get('utm_medium'),'referral');assert.equal(welcome.searchParams.get('utm_campaign'),'opensource');assert.equal(welcome.hash,'#bring-home');
});

test('adoption carries language and later language changes preserve the pet and active deadline',async()=>{
  const app=worker({mode:'follow',size:180});await app.settled();
  const adopted=await app.send({action:'adopt',petId:id,name:'豆豆',locale:'ja'});
  assert.equal(adopted.locale,'ja');assert.equal(app.store.locale,'ja');
  await app.send({action:'focus-start'});await app.settled();
  const before=structuredClone(app.store);
  const changed=await app.send({action:'set-language',locale:'es'},{url:'chrome-extension://fixture/popup.html'});
  const {shortcuts:changedShortcuts,...changedStatus}=changed;assert.equal(changedShortcuts.sleep.code,'Digit4');
  assert.deepEqual(changedStatus,{ok:true,protocol:1,version:'0.4.0',pet:{id,name:'豆豆',revision:manifest.createdAt},enabled:true,locale:'es'});
  assert.deepEqual(app.store,{...before,locale:'es'});
  assert.equal((await app.send({action:'companion-status'})).locale,'es');
  for(const locale of ['fr','en-US','EN','',null,undefined]){
    assert.match((await app.send({action:'set-language',locale})).error,/语言设置无效/);
    assert.equal(app.store.locale,'es');
  }
  const requests=app.requests.length;
  assert.match((await app.send({action:'adopt',petId:id,locale:'fr'})).error,/语言设置无效/);
  assert.equal(app.requests.length,requests,'invalid language is rejected before fetching images');
  await app.installed('install');assert.equal(new URL(app.opened[0].url).searchParams.get('lang'),'es');
});

test('an explicit language update after an in-flight adoption wins in request order',async()=>{
  const app=worker();await app.settled();
  const [adopted,changed]=await Promise.all([app.send({action:'adopt',petId:id,locale:'ja'}),app.send({action:'set-language',locale:'en'})]);
  assert.equal(adopted.locale,'ja');assert.equal(changed.locale,'en');assert.equal(app.store.locale,'en');
});

test('page bridge forwards status, adoption and language, rejects other origins and explains an invalidated extension',()=>{
  const replies=[],sent=[],handlers=[],storageHandlers=[];
  const window={postMessage:(data,origin)=>replies.push({data,origin})};
  const runtime={sendMessage(message,respond){sent.push(message);respond({ok:true,protocol:1,pet:null});}};
  const context=vm.createContext({...configGlobals(),window,chrome:{runtime,storage:{onChanged:{addListener:fn=>storageHandlers.push(fn)}}},addEventListener:(type,fn)=>{assert.equal(type,'message');handlers.push(fn);}});
  vm.runInContext(bridgeSource,context);
  assert.equal(replies[0].data.action,'ready');
  const send=(data,origin=BASE,source=window)=>handlers[0]({source,origin,data:{channel:'pet-companion-page',requestId:'request-1',...data}});
  send({action:'companion-status'},'https://example.test/');send({action:'adopt',petId:id},BASE,{});assert.equal(sent.length,0);
  send({action:'companion-status'});send({action:'adopt',petId:id,name:'豆豆',locale:'ja'});send({action:'set-language',locale:'es'});
  assert.equal(sent.length,3);assert.equal(sent[1].petId,id);assert.equal(sent[1].name,'豆豆');assert.equal(sent[1].locale,'ja');assert.equal(sent[2].locale,'es');
  assert.equal(replies.at(-1).data.requestId,'request-1');assert.equal(replies.at(-1).origin,BASE);
  storageHandlers[0]({locale:{newValue:'es'}},'local');
  assert.equal(replies.at(-1).data.action,'language-changed');assert.equal(replies.at(-1).data.locale,'es');
  const count=replies.length;storageHandlers[0]({locale:{newValue:'fr'}},'local');storageHandlers[0]({locale:{newValue:'ja'}},'sync');assert.equal(replies.length,count);
  runtime.sendMessage=()=>{throw new Error('Extension context invalidated');};
  send({action:'companion-status'});assert.equal(replies.at(-1).data.code,'reload-required');assert.match(replies.at(-1).data.error,/刷新/);
});

test('popup opens new pet creation and keeps the cached website identity',async()=>{
  const elements=new Map(),opened=[];
  function element(name){
    if(!elements.has(name))elements.set(name,{listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(){},replaceChildren(){},getContext(){return{clearRect(){},drawImage(){}};}});
    return elements.get(name);
  }
  const pet={...manifest,name:'豆豆',revision:manifest.createdAt,image:'data:image/png;base64,fixture'};
  let state={pet,enabled:true};
  const chrome={storage:{local:{async get(){return state;},async set(){}},onChanged:{addListener(){}}},tabs:{create:options=>opened.push(structuredClone(options))},runtime:{async sendMessage(){return{ok:true};}}};
  const context=vm.createContext({...configGlobals(),document:{getElementById:element,createElement:()=>({})},chrome,URL,setInterval(){},Image:class{async decode(){}}});
  vm.runInContext(focusSource,context);vm.runInContext(shortcutsSource,context);vm.runInContext(popupSource,context);
  await new Promise(resolve=>setImmediate(resolve));
  await vm.runInContext('refresh()',context);
  assert.equal(element('pet-name').textContent,'豆豆');
  element('open').listeners.click();
  const returned=new URL(opened[0].url);
  assert.equal(returned.searchParams.get('utm_source'),'pawplusme_extension');assert.equal(returned.searchParams.get('utm_medium'),'referral');assert.equal(returned.searchParams.get('utm_campaign'),'opensource');assert.equal(returned.searchParams.get('pet'),null);assert.equal(returned.searchParams.get('create'),'1');assert.equal(returned.searchParams.get('from'),'extension');assert.equal(returned.searchParams.get('lang'),'zh');assert.equal(returned.hash,'');
  state={};await vm.runInContext('refresh()',context);element('open').listeners.click();
  assert.equal(new URL(opened[1].url).searchParams.has('pet'),false);
  assert.equal(element('pet-identity').hidden,true);
});

test('the full96 generation contract is collectible only with all four 96-frame actions and all eight 96-frame headings',async()=>{
  const pack=fullPetFixture(manifest),app=worker({},pack);await app.settled();assert.equal((await app.send({action:'adopt',petId:id})).error,undefined);assert.equal(app.store.pet.animations.look.length,96);assert.equal(app.store.pet.runDirections.n.frames.length,96);
  const invalid=[{...pack,animations:{...pack.animations,sleep:[576]}},{...pack,runDirections:{...pack.runDirections,n:{frames:pack.runDirections.n.frames.slice(1),flip:false}}},{...pack,fps:{...pack.fps,look:0}}];
  for(const value of invalid){const rejected=worker({pet:{id:'previous'}},value);await rejected.settled();assert.match((await rejected.send({action:'adopt',petId:id})).error,/动作列表/);assert.equal(rejected.store.pet.id,'previous');}
});
