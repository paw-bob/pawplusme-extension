import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';
const runtime=await readFile(new URL('../dist/extension/pet-runtime.js',import.meta.url),'utf8'),geometry=await readFile(new URL('../dist/extension/pet-geometry.js',import.meta.url),'utf8');
function fixture(){
  let rafs=0,listeners=0,disconnects=0,releases=0;const draws=[];
  const ctx={clearRect(){},save(){},restore(){},translate(){},scale(){},drawImage(image,...args){draws.push({image,args});}};
  const element=()=>({style:{},dataset:{},append(){},remove(){},contains:()=>false,setAttribute(){},addEventListener(){listeners++;},attachShadow:()=>element(),getContext:()=>ctx,getBoundingClientRect:()=>({width:280,height:180}),releasePointerCapture(){releases++;},focus(){}});
  const document={documentElement:element(),hidden:false,activeElement:null,hasFocus:()=>true,createElement:element,addEventListener(){listeners++;}};
  const context=vm.createContext({...configGlobals(),document,innerWidth:1200,innerHeight:900,AbortController,ResizeObserver:class{observe(){}disconnect(){disconnects++;}},performance:{now:()=>0},requestAnimationFrame(){rafs++;return rafs;},cancelAnimationFrame(){},addEventListener(){listeners++;},clearTimeout(){}});
  vm.runInContext(geometry,context);vm.runInContext(runtime,context);
  const manifest={cellSize:192,columns:8,rows:8,motion:'continuous-video',animations:{look:[0,1,2,3],run:Array.from({length:24},(_,index)=>index+4),sleep:[28,29,30,31],peek:[32,33,34,35]},fps:{run:24,sleep:24,peek:24}},image={id:'old'};
  const app=new context.PetCompanion({manifest,image,position:{x:200,y:220}});
  return {app,manifest,image,draws,counts:()=>({rafs,listeners,disconnects,releases})};
}
const replacement=old=>({...old,columns:16,rows:48,animations:{...old.animations,run:Array.from({length:96},(_,index)=>index+96)},gaze:{angles:[0,1,2,3]}});

test('setAssets preserves the same companion, placement, mode, focus, peek and normalized run phase without new listeners or RAF',()=>{
  const r=fixture(),app=r.app,manifest=replacement(r.manifest),image={id:'new'},focus={phase:'caught',cycle:7},peek={isConnected:true};
  Object.assign(app,{x:321,y:234,size:160,renderSize:132,mode:'follow',visible:false,focusState:focus,peek,attachedPeek:peek,peekUntil:12345,runCursor:24*7.375,runHeading:'ne',gaze:{index:3,angle:2},frame:0,flipped:false,phase:712,animationName:'peek'});
  const root=app.root,counts=r.counts();assert.equal(typeof app.setAssets,'function');app.setAssets({manifest,image});
  assert.equal(app.root,root);assert.equal(app.manifest,manifest);assert.equal(app.image,image);
  for(const [key,value]of Object.entries({x:321,y:234,size:160,renderSize:132,mode:'follow',visible:false,peekUntil:12345,phase:712,animationName:'peek',runHeading:'ne'}))assert.equal(app[key],value,key);
  assert.equal(app.focusState,focus);assert.equal(app.peek,peek);assert.equal(app.attachedPeek,peek);assert.equal(app.runCursor,96*7.375);assert.equal(app.gaze,null);assert.equal(app.frame,undefined);
  assert.deepEqual(r.counts(),counts);
});

test('setAssets redraws equal frame indices with the new image and keeps the existing sleep clock',()=>{
  const r=fixture(),app=r.app;app.setMode('sleep');app.tick(0);const phase=app.phase,frame=app.frame,image={id:'replacement'};
  app.setAssets({manifest:replacement(r.manifest),image});assert.equal(app.phase,phase);app.tick(0);assert.equal(app.frame,frame);assert.equal(r.draws.at(-1).image,image);
  app.tick(125);assert.equal(app.frame,r.manifest.animations.sleep[3]);
});

test('asset replacement can cancel a capture without changing mode or clearing an attached input',()=>{
  const r=fixture(),app=r.app,peek={isConnected:true};Object.assign(app,{mode:'follow',drag:{pointerId:8,returnToWatch:true},peek,attachedPeek:peek,peekUntil:20000});
  app.setAssets({manifest:replacement(r.manifest),image:{}});assert.equal(app.drag,null);assert.equal(app.mode,'follow');assert.equal(app.peek,peek);assert.equal(app.attachedPeek,peek);assert.equal(app.peekUntil,20000);assert.equal(r.counts().releases,1);
});

test('invalid assets cannot replace an existing image or manifest',()=>{
  const r=fixture();assert.throws(()=>r.app.setAssets({manifest:{animations:{run:[]}},image:{}}));assert.equal(r.app.manifest,r.manifest);assert.equal(r.app.image,r.image);
});
