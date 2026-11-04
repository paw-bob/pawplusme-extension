import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';

const runtimeSource=await readFile(new URL('../dist/extension/pet-runtime.js',import.meta.url),'utf8');
const geometrySource=await readFile(new URL('../dist/extension/pet-geometry.js',import.meta.url),'utf8');
const runFrames=Array.from({length:33},(_,i)=>64+i);
const sleepFrames=Array.from({length:47},(_,i)=>97+i);

function runtime({size=144}={}){
  let now=0,currentFrame;
  const draws=[],windowListeners=new Map(),documentListeners=new Map();
  const listen=(map,type,fn)=>{if(!map.has(type))map.set(type,[]);map.get(type).push(fn);};
  const emit=(map,type,event={})=>{for(const fn of map.get(type)||[])fn({type,preventDefault(){},...event});};
  const context2d={save(){},restore(){},translate(){},scale(){},clearRect(){},
    drawImage(_image,sx,sy){currentFrame=sy/192*8+sx/192;draws.push(currentFrame);}};
  function element(tag='div'){
    const events=new Map();
    return {tagName:tag.toUpperCase(),style:{},dataset:{},children:[],attributes:{},
      append(...nodes){this.children.push(...nodes);},remove(){},contains(node){return this.children.includes(node);},closest(){return null;},
      setAttribute(key,value){this.attributes[key]=String(value);},getAttribute(key){return this.attributes[key]??null;},
      addEventListener(type,fn){listen(events,type,fn);},emit(type,event={}){emit(events,type,{target:this,...event});},
      attachShadow(){return this.shadow=element('shadow');},getContext:()=>context2d,setPointerCapture(){},releasePointerCapture(){},focus(){},
      getBoundingClientRect:()=>({width:280,height:180})};
  }
  const document={hidden:false,activeElement:null,hasFocus:()=>true,documentElement:element('html'),createElement:element,
    addEventListener(type,fn){listen(documentListeners,type,fn);}};
  const context=vm.createContext({...configGlobals(),document,innerWidth:5000,innerHeight:1600,performance:{now:()=>now},AbortController,
    requestAnimationFrame:()=>1,cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}},
    matchMedia:()=>({matches:false}),addEventListener(type,fn){listen(windowListeners,type,fn);}});
  vm.runInContext(geometrySource,context);vm.runInContext(runtimeSource,context);
  const manifest={cellSize:192,columns:8,rows:24,motion:'continuous-video',animations:{look:Array.from({length:64},(_,i)=>i),run:runFrames,sleep:sleepFrames,peek:[144,145]},fps:{run:24,sleep:24,peek:24}};
  const app=new context.PetCompanion({manifest,image:{},size,position:{x:100,y:200}});
  app.setMode('look');
  const step=ms=>{now+=ms;app.tick(now);};
  const elapsed=(ms,stepMs=20)=>{for(let left=ms;left>1e-7;){const chunk=Math.min(stepMs,left);step(chunk);left-=chunk;}};
  const target=(x,y=app.y)=>emit(documentListeners,'pointermove',{clientX:x+app.size/2,clientY:y+app.size-14});
  const followFar=()=>{app.setMode('follow');target(app.x+2000);};
  const lastRun=()=>draws.findLast(frame=>runFrames.includes(frame));
  const runIndex=()=>runFrames.indexOf(lastRun());
  function shortMove(distance){
    const destination=app.x+distance;app.setMode('follow');target(destination);
    for(let i=0;i<100&&Math.abs(app.x-destination)>1e-7;i++)step(16);
    assert.ok(Math.abs(app.x-destination)<1e-7,'fixture reaches its nearby target');
    return runIndex();
  }
  function dragBy(dx){
    emit(windowListeners,'keydown',{key:'Alt',altKey:true,ctrlKey:false,metaKey:false,shiftKey:false});
    const start={clientX:app.x+app.size/2,clientY:app.y+app.size/2,button:0,pointerId:1};
    app.canvas.emit('pointerdown',start);emit(documentListeners,'pointermove',{...start,target:app.canvas,clientX:start.clientX+dx});step(20);
    emit(documentListeners,'pointerup',{...start,target:app.canvas,clientX:start.clientX+dx});
    emit(windowListeners,'keyup',{key:'Alt',altKey:false,ctrlKey:false,metaKey:false,shiftKey:false});
  }
  return {app,draws,step,elapsed,target,followFar,lastRun,runIndex,shortMove,dragBy,frame:()=>currentFrame};
}

test('continuous sub-three-pixel follow movements still advance visible running feet',()=>{
  const r=runtime();r.app.setMode('follow');const start=r.app.x;
  for(let i=0;i<100;i++){r.target(r.app.x+2);r.step(16);}
  assert.ok(Math.abs(r.app.x-start-200)<1e-6,'the pet really travelled 200px');
  const legFrames=r.draws.filter(frame=>runFrames.includes(frame));
  assert.ok(new Set(legFrames).size>=4,`continued slow travel must visibly advance feet; observed ${legFrames.length} run draws`);
  assert.equal(r.app.state,'run');
  r.elapsed(64);assert.equal(r.app.state,'look','actual stationary arrival returns to watch');
});

test('a pet stopped by the viewport boundary watches instead of freezing in a run pose',()=>{
  const r=runtime();r.app.x=5000-r.app.size;r.app.setMode('follow');r.target(r.app.x+2000);
  const start={x:r.app.x,y:r.app.y};r.elapsed(320);
  assert.deepEqual({x:r.app.x,y:r.app.y},start,'the viewport clamp prevents actual travel');
  assert.equal(r.app.state,'look','no actual distance at the boundary means stopped/watch state');
  assert.ok(!runFrames.includes(r.frame()),'a stopped pet displays a watch pose rather than a frozen running foot');
});
