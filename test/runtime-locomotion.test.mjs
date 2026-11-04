import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';

const runtimeSource=await readFile(new URL('../dist/extension/pet-runtime.js',import.meta.url),'utf8');
const geometrySource=await readFile(new URL('../dist/extension/pet-geometry.js',import.meta.url),'utf8');
const runFrames=Array.from({length:33},(_,i)=>64+i);
const sleepFrames=Array.from({length:47},(_,i)=>97+i);

function runtime({size=144,reduced=false}={}){
  let now=0,currentFrame;
  const draws=[],alphas=[],windowListeners=new Map(),documentListeners=new Map();
  const listen=(map,type,fn)=>{if(!map.has(type))map.set(type,[]);map.get(type).push(fn);};
  const emit=(map,type,event={})=>{for(const fn of map.get(type)||[])fn({type,preventDefault(){},...event});};
  const context2d={save(){},restore(){},translate(){},scale(){},clearRect(){},
    drawImage(_image,sx,sy){currentFrame=sy/192*8+sx/192;draws.push(currentFrame);alphas.push(this.globalAlpha??1);}};
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
    matchMedia:()=>({matches:reduced}),addEventListener(type,fn){listen(windowListeners,type,fn);}});
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
  return {app,draws,alphas,step,elapsed,target,followFar,lastRun,runIndex,shortMove,dragBy,frame:()=>currentFrame};
}

test('starting a run moves immediately at a constant size and briefly fades between poses',()=>{
  const r=runtime();r.step(16);const x=r.app.x,size=r.app.renderSize;
  r.followFar();r.step(16);assert.ok(r.app.x>x);assert.equal(r.app.renderSize,size);assert.match(r.app.root.style.transform,/scale\(1\.0000\)/);
  r.step(50);assert.ok(r.alphas.slice(-2).every(alpha=>alpha>0&&alpha<1),'both poses briefly contribute without scaling');
  const phase=r.app.runCursor;r.step(60);assert.equal(r.alphas.at(-1),1);assert.ok(r.app.runCursor>phase);
  r.app.setMode('look');r.step(16);r.step(50);assert.ok(r.alphas.slice(-2).every(alpha=>alpha>0&&alpha<1));
});

test('reduced motion, dragging and replacing an atlas skip pose fades',()=>{
  const reduced=runtime({reduced:true});reduced.step(16);reduced.followFar();reduced.step(16);reduced.step(50);assert.ok(reduced.alphas.every(alpha=>alpha===1));
  const r=runtime();r.step(16);r.followFar();r.step(16);r.app.drag={};const before=r.alphas.length;r.step(16);assert.ok(r.alphas.slice(before).every(alpha=>alpha===1));
  r.app.drag=null;r.followFar();r.step(16);r.app.setAssets({manifest:r.app.manifest,image:{newAtlas:true}});const changed=r.alphas.length;r.step(16);assert.ok(r.alphas.slice(changed).every(alpha=>alpha===1));
});

test('short follow bursts preserve leg progress instead of restarting the same first stride',()=>{
  const r=runtime(),ends=[];
  for(let i=0;i<6;i++){ends.push(r.shortMove(24));r.elapsed(200);}
  assert.ok(new Set(ends).size>=3,`separate short movements should advance through different leg poses; got ${ends.join(', ')}`);
});

test('equal travelled distance has the same leg pose despite different RAF intervals and a stationary pause',()=>{
  const uninterrupted=runtime(),paused=runtime();
  uninterrupted.followFar();uninterrupted.elapsed(400,20);
  paused.followFar();paused.elapsed(200,10);paused.app.setMode('look');paused.elapsed(1800,20);paused.followFar();paused.elapsed(200,40);
  assert.ok(Math.abs(uninterrupted.app.x-paused.app.x)<1e-6,'both pets travel exactly the same horizontal distance');
  assert.equal(paused.runIndex(),uninterrupted.runIndex(),'a pause and RAF partition must not rewind the run cycle');
});

test('faster movement advances more leg poses over the same elapsed time',()=>{
  const slow=runtime(),fast=runtime();
  slow.app.setMode('follow');slow.target(slow.app.x+50);
  fast.followFar();slow.elapsed(200,20);fast.elapsed(200,20);
  assert.ok(fast.app.x>slow.app.x+50,'the fixture exercises different actual travel speeds');
  assert.ok(fast.runIndex()>slow.runIndex(),`more distance should advance the gait farther; slow=${slow.runIndex()}, fast=${fast.runIndex()}`);
});

test('resized pets use the same gait phase for the same fraction of body distance',()=>{
  const pets=[88,176].map(size=>{
    const r=runtime();r.app.setSize(size);r.elapsed(1000,20);r.followFar();
    r.elapsed(size*.53/550*1000,10);
    assert.ok(Math.abs(r.app.x-100-size*.53)<1e-6,'the pet travels the requested fraction of its displayed size');
    return r;
  });
  assert.equal(pets[0].runIndex(),pets[1].runIndex(),'physical pixel size must not change footsteps per body length');
});

test('manually dragging the pet does not consume walking animation distance',()=>{
  const control=runtime(),dragged=runtime();
  control.followFar();control.elapsed(400,20);
  dragged.followFar();dragged.elapsed(200,20);const before=dragged.app.x;
  dragged.dragBy(1000);assert.ok(Math.abs(dragged.app.x-before-1000)<1e-6,'the fixture actually moves the pet by pointer drag');
  dragged.followFar();dragged.elapsed(200,20);
  assert.equal(dragged.runIndex(),control.runIndex(),'only the two running segments advance the gait, not the manual relocation');
});

test('sleep video keeps its original 24 FPS timing without any travelled distance',()=>{
  const r=runtime();r.app.setMode('sleep');r.step(1);assert.equal(r.frame(),sleepFrames[0]);
  const before={x:r.app.x,y:r.app.y};r.step(125);
  assert.equal(r.frame(),sleepFrames[3]);assert.deepEqual({x:r.app.x,y:r.app.y},before);
});
