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

test('hidden or unfocused pets cannot start a new follow grab at their old position',()=>{
  for(const reason of ['hidden-pet','hidden-document','unfocused-document']){
    const s=fixture();
    if(reason==='hidden-pet')s.app.setVisible(false);
    if(reason==='hidden-document'){s.document.hidden=true;s.fire('document','visibilitychange');}
    if(reason==='unfocused-document')s.document.hasFocus=()=>false;
    const down=s.fire('document','pointerdown');s.advance(300);s.fire('document','pointerup');
    assert.ok(!s.app.drag,reason+' must not create an active drag');
    assert.equal(s.app.mode,'follow',reason+' must not switch modes on a page press');
    assert.deepEqual(s.modes,[],reason+' must not persist a false grab release');
    assert.equal(s.timers.size,0,reason+' must not leave a pending timer');
    assert.equal(s.app.canvas.style.pointerEvents,'none',reason+' must preserve click-through');
    assert.equal(down.defaultPrevented,false,reason+' must not swallow the page press');
  }
});

test('shown and focused follow pets still enter the held-grab path',()=>{
  const s=fixture();s.fire('document','pointerdown');s.advance(220);
  assert.ok(s.app.drag,'the normal visible path remains available');
  s.fire('document','pointerup');assert.equal(s.app.mode,'look');assert.deepEqual(s.modes,['look']);
});
