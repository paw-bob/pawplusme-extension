import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';

const runtimeSource=await readFile(new URL('../dist/extension/pet-runtime.js',import.meta.url),'utf8');
const geometrySource=await readFile(new URL('../dist/extension/pet-geometry.js',import.meta.url),'utf8');
function fixture(){
  let now=0,nextTimer=0;
  const timers=new Map(),windowListeners=new Map(),documentListeners=new Map(),modes=[];
  const add=(map,type,fn,options={})=>{if(!map.has(type))map.set(type,[]);map.get(type).push({fn,signal:options.signal});};
  const ctx={clearRect(){},drawImage(){},save(){},restore(){},translate(){},scale(){}};
  const element=()=>({style:{},dataset:{},listeners:new Map(),children:[],attributes:{},isConnected:true,
    append(...nodes){this.children.push(...nodes);},remove(){this.isConnected=false;},contains(node){return node===this||this.children.includes(node);},
    setAttribute(k,v){this.attributes[k]=v;},addEventListener(type,fn,options){add(this.listeners,type,fn,options);},
    attachShadow(){return this.shadow=element();},getContext:()=>ctx,getBoundingClientRect:()=>({width:280,height:180}),
    setPointerCapture(id){this.captured=id;},releasePointerCapture(id){if(this.captured===id)this.captured=null;},focus(){}});
  const body={closest:()=>null};
  const document={documentElement:element(),hidden:false,focused:true,hasFocus(){return this.focused;},createElement:element,activeElement:body,
    addEventListener(type,fn,options){add(documentListeners,type,fn,options);}};
  const context=vm.createContext({...configGlobals(),document,innerWidth:1200,innerHeight:900,AbortController,
    ResizeObserver:class{observe(){}disconnect(){}},performance:{now:()=>now},requestAnimationFrame:()=>1,cancelAnimationFrame(){},
    setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),
    addEventListener(type,fn,options){add(windowListeners,type,fn,options);}});
  vm.runInContext(geometrySource,context);vm.runInContext(runtimeSource,context);
  const manifest={cellSize:192,columns:8,motion:'continuous-video',fps:{run:24,sleep:24,peek:24},animations:{look:[0,1,2,3,4,5,6,7],run:[8,9,10,11],sleep:[12,13],peek:[14,15]}};
  const app=new context.PetCompanion({manifest,image:{},position:{x:200,y:200},onModeChange:mode=>modes.push(mode)});
  function fire(surface,type,extra={}){
    const event={type,target:body,key:'Escape',clientX:272,clientY:272,pointerId:7,pointerType:'mouse',button:0,isPrimary:true,defaultPrevented:false,detail:1,
      preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
    for(const item of(surface==='window'?windowListeners:surface==='document'?documentListeners:surface.listeners).get(type)||[])if(!item.signal?.aborted)item.fn(event);
    return event;
  }
  function step(ms=16){now+=ms;for(const[id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}app.tick(now);}
  const input={isConnected:true,matches:()=>true,contains:()=>false,getBoundingClientRect:()=>({left:500,right:800,top:200,bottom:250,width:300,height:50})};
  for(const key of ['value','textContent','innerText','innerHTML'])Object.defineProperty(input,key,{get(){assert.fail('Esc must not read '+key);}});
  return {app,fire,step,timers,modes,document,input};
}

test('Escape stops following once, keeps the pet in place, and leaves the host key event untouched',()=>{
  const s=fixture();s.app.setMode('follow');s.fire('document','pointermove',{clientX:1000,clientY:700});s.step();assert.equal(s.app.state,'run');
  const event=s.fire('window','keydown'),point=[s.app.x,s.app.y];
  assert.equal(s.app.mode,'look');assert.deepEqual(s.modes,['look']);assert.equal(event.defaultPrevented,false);assert.equal(event.stopped,undefined);
  s.fire('document','pointermove',{clientX:50,clientY:50});s.step();assert.deepEqual([s.app.x,s.app.y],point);assert.equal(s.app.state,'look');
  s.fire('window','keydown');assert.deepEqual(s.modes,['look'],'repeat Esc after stopping is a no-op');
});

test('Escape cancels both pending long presses and captured drags before returning to Watch',()=>{
  for(const active of [false,true]){
    const s=fixture();s.app.setMode('follow');s.fire('document','pointerdown');assert.ok(s.app.pendingGrab);
    if(active){s.step(220);assert.ok(s.app.drag);assert.equal(s.app.canvas.captured,7);}
    s.fire('window','keydown');assert.equal(s.app.mode,'look');assert.ok(!s.app.pendingGrab);assert.ok(!s.app.drag);assert.equal(s.timers.size,0);
    if(active)assert.equal(s.app.canvas.captured,null);
    s.step(250);s.fire('document','pointerup');assert.ok(!s.app.drag);assert.deepEqual(s.modes,['look']);
  }
});

test('Escape clears an input approach without reading the field or preventing its normal key handling',()=>{
  const s=fixture();s.app.setMode('follow');s.document.activeElement=s.input;s.fire('document','input',{target:s.input});assert.equal(s.app.peek,s.input);
  const event=s.fire('window','keydown',{target:s.input});assert.equal(s.app.peek,null);assert.equal(s.app.mode,'look');assert.deepEqual(s.modes,['look']);
  assert.equal(event.defaultPrevented,false);assert.equal(event.stopped,undefined);
});

test('modified, repeated, composed, handled and other keys do not stop following',()=>{
  for(const extra of [{key:'Enter'},{repeat:true},{isComposing:true},{defaultPrevented:true},{altKey:true},{ctrlKey:true},{metaKey:true},{shiftKey:true}]){
    const s=fixture();s.app.setMode('follow');const event=s.fire('window','keydown',extra);
    assert.equal(s.app.mode,'follow');assert.deepEqual(s.modes,[]);assert.equal(event.defaultPrevented,extra.defaultPrevented===true);assert.equal(event.stopped,undefined);
  }
});

test('hidden, paused, unfocused, destroyed and reminder pets ignore Escape',()=>{
  const preparations=[s=>s.app.setVisible(false),s=>{s.document.hidden=true;},s=>{s.document.focused=false;},s=>{s.app.shown=false;},s=>s.app.setPaused(true),s=>s.app.destroy(),...['waiting','quiet','mischief','caught'].map(phase=>s=>s.app.setFocusState({phase,cycle:1}))];
  for(const prepare of preparations){
    const s=fixture();s.app.setMode('follow');prepare(s);s.fire('window','keydown');assert.equal(s.app.mode,'follow');assert.deepEqual(s.modes,[]);
  }
  for(const mode of ['auto','look','sleep']){const s=fixture();s.app.setMode(mode);s.fire('window','keydown');assert.equal(s.app.mode,mode);assert.deepEqual(s.modes,[]);}
});
