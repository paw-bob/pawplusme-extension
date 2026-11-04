import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';
const geometrySource=await readFile(new URL('../dist/extension/pet-geometry.js',import.meta.url),'utf8');
const runtimeSource=await readFile(new URL('../dist/extension/pet-runtime.js',import.meta.url),'utf8');
const names=['e','se','s','sw','w','nw','n','ne'];
function geometry(){const context=vm.createContext({...configGlobals(),});vm.runInContext(geometrySource,context);return context.PetGeometry;}
function fixture({directional=true,lengths={},flips={},position={x:1000,y:1000}}={}){
  let now=0,mirrored=false;const draws=[],stack=[],events=new Map();
  const context2d={clearRect(){},save(){stack.push(mirrored);},restore(){mirrored=stack.pop();},translate(){},scale(x){mirrored=x<0;},drawImage(_image,sx,sy){draws.push({frame:sy/192*8+sx/192,flip:mirrored});}};
  const element=()=>({style:{},dataset:{},children:[],append(...nodes){this.children.push(...nodes);},remove(){},contains(node){return this.children.includes(node);},closest(){return null;},setAttribute(){},addEventListener(){},attachShadow(){return element();},getContext:()=>context2d,getBoundingClientRect:()=>({width:280,height:180}),focus(){}});
  const document={documentElement:element(),hidden:false,activeElement:null,hasFocus:()=>true,createElement:element,addEventListener(type,fn){if(!events.has(type))events.set(type,[]);events.get(type).push(fn);}};
  const context=vm.createContext({...configGlobals(),document,innerWidth:3000,innerHeight:2400,AbortController,ResizeObserver:class{observe(){}disconnect(){}},performance:{now:()=>now},requestAnimationFrame:()=>1,cancelAnimationFrame(){},addEventListener(){},setTimeout(){},clearTimeout(){}});
  vm.runInContext(geometrySource,context);vm.runInContext(runtimeSource,context);
  let next=128;const runDirections=Object.fromEntries(names.map(name=>{const frames=Array.from({length:lengths[name]||24},()=>next++);return[name,{frames,flip:flips[name]??['sw','w','nw'].includes(name)}];}));
  const manifest={cellSize:192,columns:8,rows:Math.ceil(next/8),motion:'continuous-video',animations:{look:Array.from({length:64},(_,i)=>i),run:Array.from({length:24},(_,i)=>64+i),sleep:[88,89,90,91],peek:[92,93]},fps:{run:24,sleep:24,peek:24},...(directional?{runDirections}:{})};
  const app=new context.PetCompanion({manifest,image:{},position});
  const step=ms=>{now+=ms;app.tick(now);};
  function target(x,y){for(const handler of events.get('pointermove')||[])handler({clientX:x+app.size/2,clientY:y+app.size-14});}
  function arrive(dx,dy){const x=app.x+dx,y=app.y+dy;app.setMode('follow');target(x,y);app.hideActionMenu();/* Isolate locomotion; hover pause is covered by runtime-action-menu. */for(let i=0;i<600&&Math.hypot(x-app.x,y-app.y)>1e-6;i++)step(16);assert.ok(Math.hypot(x-app.x,y-app.y)<1e-6,'test pet reaches its target');return draws.at(-1);}
  return{app,manifest,draws,step,target,arrive};
}

test('run direction maps actual screen vectors to all eight headings',()=>{
  const select=geometry().runDirection;assert.equal(typeof select,'function');
  for(const [index,name]of names.entries()){
    const angle=index*Math.PI/4;assert.equal(select({dx:Math.cos(angle),dy:Math.sin(angle)}),name);
  }
  assert.equal(select({dx:0,dy:0,previous:'nw'}),'nw');
  assert.equal(select({dx:0,dy:0}),'e');
});

test('run heading hysteresis resists a boundary wobble and takes an intentional turn',()=>{
  const select=geometry().runDirection;assert.equal(typeof select,'function');
  const vector=degrees=>({dx:Math.cos(degrees*Math.PI/180),dy:Math.sin(degrees*Math.PI/180)});
  assert.equal(select({...vector(24),previous:'e'}),'e');
  assert.equal(select({...vector(31),previous:'e'}),'se');
  assert.equal(select({...vector(21),previous:'se'}),'se');
  assert.equal(select({...vector(14),previous:'se'}),'e');
  assert.equal(select({...vector(-24),previous:'e'}),'e');
  assert.equal(select({...vector(-31),previous:'e'}),'ne');
});

test('runtime draws the supplied moving sequence for each of the eight headings',()=>{
  for(const [index,name]of names.entries()){
    const r=fixture(),angle=index*Math.PI/4,draw=r.arrive(Math.cos(angle)*160,Math.sin(angle)*160),entry=r.manifest.runDirections[name];
    assert.ok(entry.frames.includes(draw.frame),`${name} must use its own run sequence; drew ${draw.frame}`);
    assert.equal(draw.flip,entry.flip,name+' must use the declared mirroring');
    assert.ok(r.draws.filter(d=>entry.frames.includes(d.frame)).length>2,name+' advances real run frames');
  }
});

test('runtime bases heading on clamped displacement instead of the requested offscreen target',()=>{
  const r=fixture({position:{x:1000,y:8}});r.app.setMode('follow');r.target(2000,-1000);r.step(50);
  assert.equal(r.app.y,8);assert.ok(r.app.x>1000);
  assert.ok(r.manifest.runDirections.e.frames.includes(r.draws.at(-1).frame));
});

test('turns and stationary pauses preserve normalized stride phase across differently sized groups',()=>{
  const r=fixture({lengths:{n:48}}),east=r.arrive(75,0),eastEntry=r.manifest.runDirections.e;
  assert.equal(east.frame-eastEntry.frames[0],6);
  r.step(16);r.app.setMode('look');r.step(2000);
  const north=r.arrive(0,-1),northEntry=r.manifest.runDirections.n;
  assert.equal(north.frame-northEntry.frames[0],12,'a 48-frame group resumes the corresponding quarter-cycle instead of frame zero');
  const eastAgain=r.arrive(1,0);assert.equal(eastAgain.frame-eastEntry.frames[0],6,'turning back keeps the same stride phase');
});

test('declared direction flip overrides the old left/right target flip',()=>{
  const east=fixture({flips:{e:true}}),west=fixture({flips:{w:false}});
  assert.equal(east.arrive(75,0).flip,true);assert.equal(west.arrive(-75,0).flip,false);
});

test('legacy pets keep their original run sequence and horizontal mirroring without new metadata',()=>{
  const r=fixture({directional:false}),east=r.arrive(75,0),west=r.arrive(-75,0);
  assert.ok(r.manifest.animations.run.includes(east.frame));assert.equal(east.flip,false);
  assert.ok(r.manifest.animations.run.includes(west.frame));assert.equal(west.flip,true);
  r.app.setMode('sleep');r.step(1);const start=r.draws.at(-1).frame;r.step(125);assert.equal(r.draws.at(-1).frame,88+(start-88+3)%4);
});

test('directional small steps keep animating and resume the same stride after stopping',()=>{
  const r=fixture(),entry=r.manifest.runDirections.n;r.app.setMode('follow');
  for(let i=0;i<30;i++){r.target(r.app.x,r.app.y-2);r.step(16);}
  const moving=r.draws.filter(draw=>entry.frames.includes(draw.frame));
  assert.ok(new Set(moving.map(draw=>draw.frame)).size>=4,'two-pixel motion must advance through the north-facing leg poses');
  const before=moving.at(-1).frame-entry.frames[0];r.step(16);assert.equal(r.app.state,'look');r.step(2000);
  const resumed=r.arrive(0,-24);assert.ok(resumed.frame-entry.frames[0]>=before+1,'the north-facing stride resumes instead of restarting');
  r.app.setMode('sleep');r.step(1);const sleep=r.draws.at(-1).frame;r.step(125);assert.equal(r.draws.at(-1).frame,88+(sleep-88+3)%4);
});
