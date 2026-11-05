import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';
const focusSource=await readFile(new URL('../dist/extension/pet-focus.js',import.meta.url),'utf8');
const i18nSource=await readFile(new URL('../dist/extension/pet-i18n.js',import.meta.url),'utf8');
const shortcutsSource=await readFile(new URL('../dist/extension/pet-shortcuts.js',import.meta.url),'utf8');
const backgroundSource=await readFile(new URL('../dist/extension/background.js',import.meta.url),'utf8');

function worker(store,alarms,clock){
  const listeners={messages:[],changed:[],alarm:[],startup:[],installed:[]};
  const event=name=>({addListener:fn=>listeners[name].push(fn)});
  class FakeDate extends Date{constructor(...args){super(...(args.length?args:[clock.now]));}static now(){return clock.now;}}
  let context;
  const chrome={
    runtime:{onMessage:event('messages'),onStartup:event('startup'),onInstalled:event('installed'),getURL:path=>`chrome-extension://fixture/${path}`},
    storage:{onChanged:event('changed'),local:{
      async get(keys){return Object.fromEntries(keys.filter(key=>key in store).map(key=>[key,structuredClone(store[key]) ]));},
      async set(values){const changes={};for(const [key,value]of Object.entries(values)){changes[key]={oldValue:store[key],newValue:structuredClone(value)};store[key]=structuredClone(value);}listeners.changed.forEach(fn=>fn(changes,'local'));}
    }},
    alarms:{onAlarm:event('alarm'),async get(name){return alarms.get(name);},async create(name,{when}){alarms.set(name,{name,scheduledTime:when});},async clear(name){return alarms.delete(name);}}
  };
  context=vm.createContext({...configGlobals(),chrome,Date:FakeDate,URL,console,Uint8Array,btoa,importScripts:(...names)=>{for(const name of names){assert.ok(['site-config.js','pet-i18n.js','pet-focus.js','pet-shortcuts.js','pet-library.js'].includes(name));if(name!=='pet-library.js'&&name!=='site-config.js')vm.runInContext(name==='pet-i18n.js'?i18nSource:name==='pet-shortcuts.js'?shortcutsSource:focusSource,context);}}});
  vm.runInContext(backgroundSource,context);
  const settled=()=>vm.runInContext('focusQueue',context);
  async function send(type,cycle,sender={url:'https://example.test/',tab:{id:1}}){
    return new Promise(resolve=>{listeners.messages.forEach(fn=>fn({action:`focus-${type}`,cycle},sender,resolve));});
  }
  return{send,settled,chrome,async alarm(){listeners.alarm.forEach(fn=>fn({name:'pet-focus-reminder'}));await settled();}};
}

test('extension alarms restore deadlines after worker restart and serialize stale multi-tab choices',async()=>{
  const clock={now:new Date(2026,10,1,12).getTime()},store={pet:{id:'test'},enabled:true},alarms=new Map();
  let app=worker(store,alarms,clock);await app.settled();
  const started=await app.send('start');const dueAt=clock.now+25*60_000;
  assert.equal(started.focus.dueAt,dueAt);assert.equal(alarms.get('pet-focus-reminder').scheduledTime,dueAt);
  clock.now+=10*60_000;alarms.clear();app=worker(store,alarms,clock);await app.settled();
  assert.equal(store.focus.dueAt,dueAt);assert.equal(alarms.get('pet-focus-reminder').scheduledTime,dueAt);
  clock.now=dueAt;await app.alarm();assert.equal(store.focus.phase,'mischief');
  await Promise.all([app.send('catch',dueAt),app.send('catch',dueAt,{url:'https://other.test/',tab:{id:2}})]);
  assert.equal(store.focus.phase,'caught');clock.now+=5000;
  const [a,b]=await Promise.all([app.send('later25',dueAt),app.send('later50',dueAt)]);
  assert.equal(a.focus.dueAt,clock.now+25*60_000);assert.equal(b.focus.dueAt,a.focus.dueAt);
  assert.equal(store.focus.phase,'waiting');assert.equal(alarms.get('pet-focus-reminder').scheduledTime,a.focus.dueAt);
  const denied=await app.send('preview',null,{url:'chrome-extension://other/popup.html'});assert.ok(denied.error);
});

test('today quiet survives restart, resumes next day, and display-off cancels timer',async()=>{
  const clock={now:new Date(2026,10,1,23,50).getTime()},store={pet:{id:'test'},enabled:true},alarms=new Map();
  let app=worker(store,alarms,clock);await app.settled();
  const playing=await app.send('preview');await app.send('catch',playing.focus.cycle);await app.send('today',playing.focus.cycle);
  const until=store.focus.quietUntil;assert.equal(store.focus.phase,'quiet');assert.equal(alarms.get('pet-focus-reminder').scheduledTime,until);
  app=worker(store,alarms,clock);await app.settled();assert.equal(store.focus.phase,'quiet');
  clock.now=until;await app.alarm();assert.equal(store.focus.dueAt,until+25*60_000);
  await app.chrome.storage.local.set({enabled:false});await app.settled();assert.equal(store.focus.phase,'off');assert.equal(alarms.size,0);
});

test('dismissed caught rounds persist across worker restart and stale closes cannot cancel a newer timer',async()=>{
  const clock={now:new Date(2026,10,2,12).getTime()},store={pet:{id:'test'},enabled:true},alarms=new Map();
  let app=worker(store,alarms,clock);await app.settled();
  const playing=await app.send('preview');await app.send('catch',playing.focus.cycle);
  assert.equal((await app.send('stop',playing.focus.cycle)).focus.phase,'off');
  app=worker(store,alarms,clock);await app.settled();assert.equal(store.focus.phase,'off');assert.equal(alarms.size,0);
  clock.now+=1000;const started=await app.send('start');await app.send('stop',playing.focus.cycle);
  assert.deepEqual(store.focus,structuredClone(started.focus));assert.equal(alarms.get('pet-focus-reminder').scheduledTime,started.focus.dueAt);
});

test('stopping no-more-today clears its alarm and prevents a stale alarm from recalling mischief',async()=>{
  const clock={now:new Date(2026,10,2,12).getTime()},store={pet:{id:'test'},enabled:true},alarms=new Map();
  let app=worker(store,alarms,clock);await app.settled();
  const playing=await app.send('preview');await app.send('catch',playing.focus.cycle);await app.send('today',playing.focus.cycle);
  assert.equal(store.focus.phase,'quiet');assert.equal(alarms.size,1);
  const stopped=await app.send('stop');assert.equal(stopped.focus.phase,'off');assert.equal(alarms.size,0);
  clock.now+=24*60*60_000;await app.alarm();assert.equal(store.focus.phase,'off');
  app=worker(store,alarms,clock);await app.settled();assert.equal(store.focus.phase,'off');assert.equal(alarms.size,0);
});
