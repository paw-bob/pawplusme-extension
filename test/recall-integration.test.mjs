import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';

const runtimeSource=await readFile(new URL('../dist/extension/pet-runtime.js',import.meta.url),'utf8');
const contentSource=await readFile(new URL('../dist/extension/content.js',import.meta.url),'utf8');
const bridgeSource=await readFile(new URL('../dist/extension/demo-bridge.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('runtime recall clears timer, input and drag state and returns the pet inside the viewport',()=>{
  const frames=new Map();let serial=0,clears=0,disconnects=0;
  const context=vm.createContext({...configGlobals(),innerWidth:390,innerHeight:600,document:{hidden:false,hasFocus:()=>true},performance:{now:()=>500},requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id),clearTimeout(){}});
  vm.runInContext(runtimeSource,context);
  const app=Object.create(context.PetCompanion.prototype);
  Object.assign(app,{size:144,renderSize:200,x:-1000,y:5000,mode:'sleep',focusState:{phase:'quiet',cycle:5},visible:false,shown:false,root:{dataset:{},style:{}},canvas:{style:{},setAttribute(){},releasePointerCapture(){}},focusPanel:{style:{}},resizeObserver:{disconnect(){disconnects++;},observe(){}},effects:{clear(){clears++;}},peek:{},attachedPeek:{},drag:{pointerId:7},pendingGrab:{timer:1},dragModifier:true});
  assert.equal(typeof app.recall,'function');assert.equal(app.recall(),true);
  assert.equal(app.mode,'look');assert.equal(app.focusState.phase,'off');assert.equal(app.visible,true);assert.equal(app.shown,true);assert.equal(app.root.style.display,'block');
  assert.equal(app.peek,null);assert.equal(app.attachedPeek,null);assert.equal(app.drag,null);assert.equal(app.pendingGrab,null);assert.equal(app.dragModifier,false);
  assert.equal(app.renderSize,144);assert.ok(app.x>=0&&app.x+app.renderSize<=390);assert.ok(app.y>=8&&app.y+app.renderSize<=600);
  assert.equal(app.root.dataset.focusPhase,'off');assert.ok(clears>0&&disconnects>0);assert.equal(frames.size,1);
  const field={matches:()=>true,isConnected:true};app.inspectInput(field,'focusin');assert.equal(app.peek,null,'popup-close focus restoration must not immediately replace recalled Watch with peek');
  app.inspectInput(field,'input');assert.equal(app.peek,field,'real typing after recall still peeks immediately');
  app.x=-900;app.y=-900;app.recall();assert.ok(app.x>=0&&app.y>=8);assert.equal(frames.size,1,'repeated recall does not start a second render loop');
});

async function content({enabled=true,recallToken='old-request',decode}={}){
  const state={enabled,recallToken,pet:{id:'fixture-pet',image:'data:image/png;base64,fixture',revision:'r1'},focus:{phase:'off'},mode:'look',size:144},listeners=[],instances=[];
  class Companion{constructor(options){this.mode='auto';this.recalled=0;this.options=options;instances.push(this);}setMode(value){this.mode=value;}setSize(){}setFocusState(value){this.focus=value;}recall(){this.recalled++;}destroy(){this.destroyed=true;}}
  const context=vm.createContext({...configGlobals(),location:new URL('https://example.test/'),chrome:{runtime:{async sendMessage(){return{};}},storage:{local:{async get(){return structuredClone(state);}},onChanged:{addListener:fn=>listeners.push(fn)}}},PetFocus:{empty:()=>({phase:'off'}),deadline:()=>0},PetShortcuts:{defaults:()=>({}),normalize:value=>value,bind(){}},PetCompanion:Companion,Image:class{async decode(){if(decode)await decode;}},setTimeout:()=>1,clearTimeout(){},addEventListener(){},document:{documentElement:{dataset:{}},hidden:false,addEventListener(){}}});
  vm.runInContext(contentSource,context);await flush();await flush();
  async function change(values){Object.assign(state,values);const changes=Object.fromEntries(Object.entries(values).map(([key,newValue])=>[key,{newValue}]));for(const listener of listeners)listener(changes,'local');await flush();await flush();}
  return{instances,state,change,debug:context.document.documentElement.dataset};
}

test('content consumes each new recall once and never replays a token saved before page load',async()=>{
  const page=await content();assert.equal(page.instances.length,1);const pet=page.instances[0];assert.equal(pet.recalled,0);
  await page.change({recallToken:'request-1'});assert.equal(pet.recalled,1);
  assert.equal(page.debug.petContentRecallSeen,'seen');assert.equal(page.debug.petContentRecallApplied,'applied');assert.ok(!JSON.stringify(page.debug).includes('request-1'),'ordinary page diagnostics never expose the cross-page recall token');
  await page.change({recallToken:'request-1',size:150});assert.equal(pet.recalled,1);
  await page.change({recallToken:'request-2'});assert.equal(pet.recalled,2);assert.equal(page.instances.length,1);
});

test('recall creates a manually hidden pet before consuming the request',async()=>{
  const page=await content({enabled:false});assert.equal(page.instances.length,0);
  await page.change({enabled:true,mode:'look',recallToken:'request-new'});assert.equal(page.instances.length,1);assert.equal(page.instances[0].recalled,1);
});

test('demo bridge forwards recall identity without image data, replay or invalid values',async()=>{
  const replies=[],listeners=[],pet={id:'30000000-0000-4000-8000-000000000001',name:'  Milo  ',image:'PRIVATE_IMAGE_DATA'};
  const context=vm.createContext({...configGlobals(),window:{postMessage:(data,origin)=>replies.push({data,origin})},chrome:{runtime:{},storage:{local:{async get(keys){assert.deepEqual(structuredClone(keys),['pet']);return{pet};}},onChanged:{addListener:fn=>listeners.push(fn)}}},addEventListener(){}});
  vm.runInContext(bridgeSource,context);
  await listeners[0]({recallToken:{oldValue:'old',newValue:'request-1'}},'local');
  assert.deepEqual(structuredClone(replies.at(-1).data),{channel:'pet-companion-extension',action:'recalled',token:'request-1',petId:pet.id,name:'Milo'});assert.ok(!JSON.stringify(replies).includes('PRIVATE_IMAGE_DATA'));
  assert.equal(replies.at(-1).data.action,'recalled');assert.equal(replies.at(-1).data.token,'request-1');assert.equal(replies.at(-1).origin,'http://127.0.0.1:4318');
  const count=replies.length;
  for(const change of [{oldValue:'request-1',newValue:'request-1'},{newValue:''},{newValue:42},{newValue:'x'.repeat(129)}])listeners[0]({recallToken:change},'local');
  listeners[0]({recallToken:{newValue:'request-2'}},'sync');assert.equal(replies.length,count);
});


test('a concurrent sync while image decode is pending cannot swallow the recall token',async()=>{
  let finish;const decode=new Promise(resolve=>{finish=resolve;}),page=await content({enabled:false,decode});
  await page.change({enabled:true,recallToken:'request-decode'});
  await page.change({locale:'en'});finish();await flush();await flush();
  assert.equal(page.instances.length,1);assert.equal(page.instances[0].recalled,1);
  await page.change({size:150});assert.equal(page.instances[0].recalled,1);
});


test('a newer bridge recall supersedes a slower identity lookup',async()=>{
  const listeners=[],replies=[],pending=[];
  const context=vm.createContext({...configGlobals(),window:{postMessage:data=>replies.push(data)},chrome:{runtime:{},storage:{local:{get:()=>new Promise(resolve=>pending.push(resolve))},onChanged:{addListener:fn=>listeners.push(fn)}}},addEventListener(){}});
  vm.runInContext(bridgeSource,context);
  const old=listeners[0]({recallToken:{newValue:'request-old'}},'local'),current=listeners[0]({recallToken:{newValue:'request-new'}},'local');
  assert.equal(pending.length,2);
  pending[1]({pet:{id:'30000000-0000-4000-8000-000000000002',name:'New'}});await current;
  pending[0]({pet:{id:'30000000-0000-4000-8000-000000000001',name:'Old'}});await old;
  assert.equal(replies.filter(reply=>reply.action==='recalled').length,1);assert.equal(replies.at(-1).petId,'30000000-0000-4000-8000-000000000002');assert.equal(replies.at(-1).token,'request-new');
});

test('bridge sends a selected pet identity once without image, library or authorization data',async()=>{
  const listeners=[],replies=[],pet={id:'30000000-0000-4000-8000-000000000002',name:'  New friend  ',revision:'r2',image:'PRIVATE_IMAGE_DATA',claimToken:'PRIVATE_CLAIM',pets:['PRIVATE_LIBRARY']};
  const context=vm.createContext({...configGlobals(),window:{postMessage:(data,origin)=>replies.push({data,origin})},chrome:{runtime:{},storage:{local:{async get(){return{pet};}},onChanged:{addListener:fn=>listeners.push(fn)}}},addEventListener(){}});
  vm.runInContext(bridgeSource,context);
  await listeners[0]({petSelectionToken:{oldValue:'before',newValue:'selection-B'},pet:{newValue:pet}},'local');
  assert.deepEqual(structuredClone(replies.at(-1)),{data:{channel:'pet-companion-extension',action:'selected',token:'selection-B',pet:{id:pet.id,name:'New friend',revision:'r2'}},origin:'http://127.0.0.1:4318'});
  assert.ok(!JSON.stringify(replies).includes('PRIVATE_'));
  const count=replies.length;
  for(const change of [{oldValue:'selection-B',newValue:'selection-B'},{newValue:'selection-B'},{newValue:''},{newValue:42},{newValue:'x'.repeat(129)}])await listeners[0]({petSelectionToken:change},'local');
  await listeners[0]({petSelectionToken:{newValue:'selection-C'}},'sync');
  assert.equal(replies.length,count);
});

test('a fast selected change suppresses a previous slow recall identity lookup',async()=>{
  const listeners=[],replies=[],pending=[];
  const context=vm.createContext({...configGlobals(),window:{postMessage:data=>replies.push(data)},chrome:{runtime:{},storage:{local:{get:()=>new Promise(resolve=>pending.push(resolve))},onChanged:{addListener:fn=>listeners.push(fn)}}},addEventListener(){}});
  vm.runInContext(bridgeSource,context);
  const old=listeners[0]({recallToken:{newValue:'request-old'}},'local');
  await listeners[0]({petSelectionToken:{newValue:'selection-new'},pet:{newValue:{id:'30000000-0000-4000-8000-000000000002',name:'New',revision:'r2'}}},'local');
  pending[0]({pet:{id:'30000000-0000-4000-8000-000000000001',name:'Old'}});await old;
  assert.equal(replies.filter(reply=>['selected','recalled'].includes(reply.action)).length,1);
  assert.equal(replies.at(-1).action,'selected');assert.equal(replies.at(-1).pet.id,'30000000-0000-4000-8000-000000000002');
});
