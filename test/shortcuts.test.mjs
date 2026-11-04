import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';
const context=vm.createContext({...configGlobals(),});vm.runInContext(await readFile(new URL('../dist/extension/pet-shortcuts.js',import.meta.url),'utf8'),context);
const api=context.PetShortcuts,plain=value=>JSON.parse(JSON.stringify(value));
const event=(overrides={})=>({code:'Digit3',altKey:true,shiftKey:true,ctrlKey:false,metaKey:false,target:{type:'text'},preventDefault(){this.prevented=true;},stopPropagation(){},...overrides});

test('repeating the follow action stops it while other mode choices remain explicit',()=>{
  assert.equal(api.modeForAction('follow','follow'),'look');
  for(const current of ['auto','look','sleep'])assert.equal(api.modeForAction('follow',current),'follow');
  for(const mode of ['auto','look','sleep'])assert.equal(api.modeForAction(mode,mode),mode);
});

test('default action shortcuts and custom bindings normalize without keeping unrelated fields',()=>{
  const defaults=api.defaults();assert.equal(api.format(defaults.follow),'Alt + Shift + 3');
  const custom=api.normalize({follow:{code:'KeyG',ctrl:true,shift:true,secret:'discard'}});assert.equal(api.format(custom.follow),'Ctrl + Shift + G');assert.equal(custom.follow.secret,undefined);assert.equal(api.format(custom.sleep),'Alt + Shift + 4');
  const disabled=api.normalize({...defaults,sleep:null});assert.equal(disabled.sleep,null);assert.equal(api.validate(disabled),null);
});

test('duplicate, weak and browser-reserved combinations are rejected before saving',()=>{
  const defaults=api.defaults();assert.match(api.validate({...defaults,sleep:defaults.follow}),/重复/);
  assert.match(api.validate({...defaults,look:{code:'KeyG',ctrl:true}}),/修饰键/);
  assert.match(api.validate({...defaults,look:{code:'KeyW',ctrl:true,shift:true}}),/浏览器/);
  assert.deepEqual(plain(api.normalize({...defaults,look:{code:'KeyW',ctrl:true,shift:true}})),plain(defaults));
});

test('ordinary typing, passwords, composition and handled events are ignored without inspecting their key code',()=>{
  for(const overrides of [{altKey:false,shiftKey:false},{target:{type:'password'}},{isComposing:true},{repeat:true},{defaultPrevented:true},{getModifierState:name=>name==='AltGraph'}]){
    const e=event(overrides);Object.defineProperty(e,'code',{get(){assert.fail('must not inspect ordinary or private typing');}});assert.equal(api.fromEvent(e),null);
  }
});

test('binding follows live preferences and only prevents a handled pet action',()=>{
  let listener,bindings=api.defaults(),enabled=true;const actions=[];
  const target={addEventListener(type,handler){assert.equal(type,'keydown');listener=handler;},removeEventListener(){listener=null;}};
  const stop=api.bind({target,getBindings:()=>bindings,enabled:()=>enabled,onAction:action=>actions.push(action)});
  const first=event();listener(first);assert.deepEqual(actions,['follow']);assert.equal(first.prevented,true);
  bindings=api.normalize({...bindings,follow:{code:'KeyG',alt:true,shift:true}});
  const old=event();listener(old);assert.equal(old.prevented,undefined);listener(event({code:'KeyG'}));assert.deepEqual(actions,['follow','follow']);
  enabled=false;const off=event({code:'KeyG'});listener(off);assert.equal(off.prevented,undefined);stop();assert.equal(listener,null);
});
