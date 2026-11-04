import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';

const runtimeSource=await readFile(new URL('../dist/extension/pet-runtime.js',import.meta.url),'utf8');
const geometrySource=await readFile(new URL('../dist/extension/pet-geometry.js',import.meta.url),'utf8');
function fixture(){
  let now=0,nextTimer=0,nextFrame=0,draws=0;
  const timers=new Map(),frames=new Map(),windowListeners=new Map(),documentListeners=new Map();
  const ctx={clearRect(){},drawImage(){draws++;},save(){},restore(){},translate(){},scale(){}};
  const element=()=>({style:{},dataset:{},listeners:new Map(),children:[],attributes:{},append(...nodes){this.children.push(...nodes);},remove(){},contains(node){return this.children.includes(node);},setAttribute(k,v){this.attributes[k]=v;},addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);},attachShadow(){return this.shadow=element();},getContext:()=>ctx,getBoundingClientRect:()=>({width:280,height:180}),setPointerCapture(id){this.captured=id;},releasePointerCapture(id){if(this.captured===id)this.captured=null;},focus(){}});
  const body={closest:()=>null};
  const document={documentElement:element(),hidden:false,hasFocus:()=>true,createElement:element,activeElement:null,addEventListener(type,fn){if(!documentListeners.has(type))documentListeners.set(type,[]);documentListeners.get(type).push(fn);}};
  const context=vm.createContext({...configGlobals(),document,innerWidth:1200,innerHeight:900,AbortController,ResizeObserver:class{observe(){}disconnect(){}},performance:{now:()=>now},requestAnimationFrame(fn){const id=++nextFrame;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),addEventListener(type,fn){if(!windowListeners.has(type))windowListeners.set(type,[]);windowListeners.get(type).push(fn);}});
  vm.runInContext(geometrySource,context);vm.runInContext(runtimeSource,context);
  const manifest={cellSize:192,columns:8,motion:'continuous-video',fps:{run:24,sleep:24,peek:24},animations:{look:[0,1,2,3,4,5,6,7],run:Array.from({length:33},(_,i)=>8+i),sleep:Array.from({length:24},(_,i)=>41+i),peek:[65,66]}};
  const app=new context.PetCompanion({manifest,image:{},position:{x:200,y:200}});
  function fire(surface,type,extra={}){const event={type,target:body,clientX:272,clientY:272,pointerId:7,pointerType:'mouse',button:0,isPrimary:true,defaultPrevented:false,detail:1,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};for(const fn of(surface==='window'?windowListeners:surface==='document'?documentListeners:surface.listeners).get(type)||[])fn(event);return event;}
  function advance(ms,{paint=false}={}){now+=ms;for(const[id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}if(paint){const queued=[...frames];frames.clear();for(const [,fn]of queued)fn(now);}}
  const input={isConnected:true,matches:()=>true,contains:()=>false,getBoundingClientRect:()=>({left:500,right:800,top:200,bottom:250,width:300,height:50})};
  return {app,fire,advance,frames,timers,document,input,now:()=>now,draws:()=>draws};
}

test('pause keeps the current frame visible and resumes sleep without skipping paused time',()=>{
  const s=fixture();s.app.setMode('sleep');s.advance(0,{paint:true});s.advance(100,{paint:true});
  const frame=s.app.frame,draws=s.draws(),position=[s.app.x,s.app.y];
  s.app.setPaused(true);assert.equal(s.frames.size,0);assert.equal(s.app.root.style.display,'block');
  s.advance(5050,{paint:true});s.app.tick(s.now());
  assert.equal(s.app.frame,frame);assert.equal(s.draws(),draws);assert.deepEqual([s.app.x,s.app.y],position);assert.equal(s.frames.size,0);
  s.app.setPaused(false);assert.equal(s.frames.size,1);s.advance(0,{paint:true});
  assert.equal(s.app.frame,frame,'resume starts at the same animation phase');
  s.advance(42,{paint:true});assert.equal(s.app.frame,frame+1);
});

test('pausing before the first animation frame still paints a visible pet once',()=>{
  const s=fixture();assert.equal(s.draws(),0);s.app.setPaused(true);
  assert.ok(s.draws()>0);assert.ok(Number.isInteger(s.app.frame));assert.equal(s.frames.size,0);
  const draws=s.draws();s.app.setPaused(true);assert.equal(s.draws(),draws);
});

test('pause cancels pending and active grabs and ignores input, auto chase and modifier keys',()=>{
  const s=fixture();s.app.setMode('follow');s.advance(0,{paint:true});
  s.fire('document','pointerdown');assert.equal(s.timers.size,1);
  s.app.setPaused(true);assert.equal(s.timers.size,0);s.advance(300);assert.ok(!s.app.drag);
  s.fire('window','keydown',{altKey:true});assert.equal(s.app.canvas.style.pointerEvents,'none');
  s.fire(s.app.canvas,'pointerdown',{altKey:true});assert.ok(!s.app.drag);
  s.app.inspectInput(s.input,'input');assert.ok(!s.app.peek);
  s.app.setMode('auto');const mouse={...s.app.mouse};
  s.fire('document','pointermove',{clientX:900,clientY:700});s.fire('document','pointerdown');
  assert.deepEqual({...s.app.mouse},mouse);assert.ok(!s.app.chaseUntil);assert.equal(s.frames.size,0);
  s.app.setPaused(false);s.app.setMode('follow');s.fire('document','pointerdown');s.advance(220);
  assert.ok(s.app.drag);assert.equal(s.app.canvas.captured,7);
  s.app.setPaused(true);assert.ok(!s.app.drag);assert.equal(s.app.canvas.captured,null);
  const position=[s.app.x,s.app.y];s.fire('document','pointermove',{clientX:1000,clientY:800});
  assert.deepEqual([s.app.x,s.app.y],position);
});

test('tab visibility and focus reminders cannot restart a paused animation',()=>{
  const s=fixture();s.advance(0,{paint:true});s.app.setPaused(true);
  s.document.hidden=true;s.fire('document','visibilitychange');assert.equal(s.app.root.style.display,'none');
  s.advance(1000);s.document.hidden=false;s.fire('document','visibilitychange');s.fire('window','focus');
  assert.equal(s.app.root.style.display,'block');assert.equal(s.frames.size,0);
  s.app.setFocusState({phase:'mischief',cycle:1});assert.equal(s.frames.size,0);assert.equal(s.app.canvas.style.pointerEvents,'none');
  const draws=s.draws();s.advance(2000);s.app.tick(s.now());assert.equal(s.draws(),draws);
  s.app.setVisible(false);s.app.setPaused(false);assert.equal(s.frames.size,0);
  s.app.setVisible(true);assert.equal(s.frames.size,1);
});

test('pause freezes auto idle and in-flight pose transitions as well as the animation phase',()=>{
  const s=fixture();s.advance(1000,{paint:true});
  s.app.poseTransition={frame:s.app.frame,flip:false,start:900};
  s.app.setPaused(true);s.advance(20000);s.app.setPaused(false);
  assert.equal(s.app.poseTransition.start,20900);
  s.advance(0,{paint:true});assert.equal(s.app.state,'look','paused wall time does not count as idle');
  s.advance(12001,{paint:true});assert.equal(s.app.state,'sleep');
});
