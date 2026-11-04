import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';
const runtimeSource=await readFile(new URL('../dist/extension/pet-runtime.js',import.meta.url),'utf8');
const geometrySource=await readFile(new URL('../dist/extension/pet-geometry.js',import.meta.url),'utf8');
function fixture(){
  let now=0,nextTimer=0;const timers=new Map(),windowListeners=new Map(),documentListeners=new Map(),modes=[],catches=[];
  const ctx={clearRect(){},drawImage(){},save(){},restore(){},translate(){},scale(){}};
  const element=()=>({style:{},dataset:{},listeners:new Map(),children:[],attributes:{},append(...nodes){this.children.push(...nodes);},remove(){},contains(node){return this.children.includes(node);},setAttribute(k,v){this.attributes[k]=v;},addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);},attachShadow(){return this.shadow=element();},getContext:()=>ctx,getBoundingClientRect:()=>({width:280,height:180}),setPointerCapture(id){this.captured=id;},releasePointerCapture(id){if(this.captured===id)this.captured=null;},focus(){}});
  const root=element(),body={closest:()=>null},document={documentElement:root,hidden:false,hasFocus:()=>true,createElement:element,activeElement:null,addEventListener(type,fn){if(!documentListeners.has(type))documentListeners.set(type,[]);documentListeners.get(type).push(fn);}};
  const context=vm.createContext({...configGlobals(),document,innerWidth:1200,innerHeight:900,AbortController,ResizeObserver:class{observe(){}disconnect(){}},performance:{now:()=>now},requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),addEventListener(type,fn){if(!windowListeners.has(type))windowListeners.set(type,[]);windowListeners.get(type).push(fn);}});
  vm.runInContext(geometrySource,context);vm.runInContext(runtimeSource,context);
  const manifest={cellSize:192,columns:8,motion:'continuous-video',fps:{run:24,sleep:24,peek:24},animations:{look:[0,1,2,3,4,5,6,7],run:Array.from({length:33},(_,i)=>8+i),sleep:[41,42],peek:[43,44]}};
  const app=new context.PetCompanion({manifest,image:{},position:{x:200,y:200},onModeChange:mode=>modes.push(mode),onCatch:value=>catches.push(value)});app.setMode('follow');
  function fire(surface,type,extra={}){const event={type,target:body,clientX:272,clientY:320,pointerId:7,pointerType:'mouse',button:0,isPrimary:true,defaultPrevented:false,detail:1,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=true;},...extra};for(const fn of(surface==='window'?windowListeners:surface==='document'?documentListeners:surface.listeners).get(type)||[])fn(event);return event;}
  function advance(ms){now+=ms;for(const[id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}}
  return{app,fire,advance,modes,catches,document,timers};
}

test('a short follow press passes through without grabbing or changing mode',()=>{
  const s=fixture(),down=s.fire('document','pointerdown');s.advance(120);const up=s.fire('document','pointerup');s.advance(200);
  assert.ok(!s.app.drag);assert.equal(s.app.mode,'follow');assert.equal(s.app.canvas.style.pointerEvents,'none');assert.equal(down.defaultPrevented,false);assert.equal(up.defaultPrevented,false);assert.equal(s.fire('document','click').defaultPrevented,false);assert.deepEqual(s.modes,[]);
});

test('holding the followed pet captures dragging and releasing returns to look once',()=>{
  const s=fixture(),start={x:s.app.x,y:s.app.y};s.fire('document','pointerdown');s.advance(219);assert.ok(!s.app.drag);s.advance(1);
  assert.ok(s.app.drag,'a 220ms hold on the pet must grab it');assert.equal(s.app.canvas.captured,7);assert.equal(s.app.canvas.style.pointerEvents,'auto');
  s.fire('document','pointermove',{clientX:372,clientY:400});assert.equal(s.app.x,start.x+100);assert.equal(s.app.y,start.y+80);
  s.fire('document','pointerup',{clientX:372,clientY:400});assert.ok(!s.app.drag);assert.equal(s.app.mode,'look');assert.equal(s.app.canvas.style.pointerEvents,'none');assert.equal(s.app.canvas.captured,null);assert.deepEqual(s.modes,['look']);
  s.fire('document','pointerup',{clientX:372,clientY:400});assert.deepEqual(s.modes,['look']);
  assert.equal(s.fire('document','click',{clientX:372,clientY:400}).defaultPrevented,true,'release click must not activate the underlying page');
  s.fire('document','pointerdown',{clientX:372,clientY:400});assert.equal(s.fire('document','click',{clientX:372,clientY:400}).defaultPrevented,false,'the next ordinary click is still usable');
});

test('controls, editable fields, other pointers and text-selection movements do not start a grab',()=>{
  for(const extra of [{target:{closest:()=>({tagName:'BUTTON'})}},{clientX:700,clientY:700},{button:2},{isPrimary:false},{pointerType:'touch'}]){
    const s=fixture();const down=s.fire('document','pointerdown',extra);s.advance(300);assert.ok(!s.app.drag);assert.equal(down.defaultPrevented,false);assert.equal(s.app.mode,'follow');
  }
  const shadow=fixture();shadow.fire('document','pointerdown',{composedPath:()=>[{closest:()=>({tagName:'INPUT'})}]});shadow.advance(300);assert.ok(!shadow.app.drag,'a field inside a shadow root is a page control');
  const select=fixture();select.fire('document','pointerdown');const move=select.fire('document','pointermove',{clientX:290});select.advance(300);assert.ok(!select.app.drag);assert.equal(move.defaultPrevented,false);
});

test('interruption cleans pending and active grabs without changing the chosen mode',()=>{
  for(const active of [false,true])for(const type of ['pointercancel','blur','hidden','destroy','mode']){
    const s=fixture();s.fire('document','pointerdown');if(active){s.advance(220);assert.ok(s.app.drag);}
    if(type==='pointercancel')s.fire('document',type);
    if(type==='blur')s.fire('window',type);
    if(type==='hidden')s.app.setVisible(false);
    if(type==='destroy')s.app.destroy();
    if(type==='mode')s.app.setMode('sleep');
    s.advance(300);assert.ok(!s.app.drag,`${active}/${type}`);assert.equal(s.timers.size,0);assert.equal(s.app.canvas.style.pointerEvents,'none');assert.deepEqual(s.modes,[]);
  }
});

test('focus reminder catch and direct Alt dragging keep their existing behavior',()=>{
  const s=fixture();s.app.setMode('sleep');s.fire('window','keydown',{altKey:true});s.fire(s.app.canvas,'pointerdown');assert.ok(s.app.drag);s.fire('document','pointerup');assert.equal(s.app.mode,'look');assert.deepEqual(s.modes,['look']);
  s.app.setFocusState({phase:'mischief',cycle:31});s.fire(s.app.canvas,'pointerdown');assert.ok(s.app.drag);s.fire('document','pointerup');assert.equal(s.catches.length,1);assert.equal(s.catches[0].cycle,31);assert.deepEqual(s.modes,['look']);
});
