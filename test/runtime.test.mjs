import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';

const context=vm.createContext({...configGlobals(),});
vm.runInContext(await readFile(new URL('../dist/extension/pet-geometry.js',import.meta.url),'utf8'),context);
const {pawPlacement}=context.PetGeometry;

test('gaze uses the head anchor, supports dense frames and preserves above-left/right coordinates',()=>{
  assert.equal(typeof context.PetGeometry.gazeFrame,'function','head-relative gaze selector is required');
  const pick=mouse=>context.PetGeometry.gazeFrame({mouse,position:{x:100,y:100},size:200,count:64,dt:.016,reducedMotion:true});
  const left=pick({x:180,y:110}),right=pick({x:220,y:110});
  assert.ok(left.angle<-Math.PI/2);assert.ok(right.angle>-Math.PI/2);
  assert.ok(left.index<48&&left.index>32);assert.ok(right.index>48&&right.index<64);
  assert.equal(pick({x:400,y:148}).index,0);assert.equal(pick({x:200,y:400}).index,16);
  const legacy=context.PetGeometry.gazeFrame({mouse:{x:0,y:148},position:{x:100,y:100},size:200,count:8,dt:.016,reducedMotion:true});assert.equal(legacy.index,4);
});

test('gaze near the head stays stable and traverses the short path across the left boundary',()=>{
  assert.equal(typeof context.PetGeometry.gazeFrame,'function');
  const previous={angle:Math.PI-.02,index:32},base={position:{x:100,y:100},size:200,count:64,dt:.016,previous};
  const still=context.PetGeometry.gazeFrame({...base,mouse:{x:202,y:146}});assert.equal(still.angle,previous.angle);assert.equal(still.index,previous.index);
  const across=context.PetGeometry.gazeFrame({...base,mouse:{x:0,y:144}});assert.ok(across.angle>previous.angle);assert.ok(across.angle-previous.angle<.04);
  const turn=context.PetGeometry.gazeFrame({...base,mouse:{x:400,y:148}});assert.ok(Math.abs(turn.angle-previous.angle)<=.016*Math.PI*2+1e-8);
  const reduced=context.PetGeometry.gazeFrame({...base,mouse:{x:400,y:148},reducedMotion:true});assert.ok(Math.abs(reduced.angle)<1e-8);
});

test('gaze sector hysteresis prevents tiny cursor motion from toggling two adjacent poses',()=>{
  assert.equal(typeof context.PetGeometry.gazeFrame,'function');
  const angle=Math.PI/32*.52,previous={angle:0,index:0};
  const picked=context.PetGeometry.gazeFrame({mouse:{x:200+150*Math.cos(angle),y:148+150*Math.sin(angle)},position:{x:100,y:100},size:200,count:64,dt:1,previous});
  assert.equal(picked.index,0);
});

test('video gaze uses calibrated directions instead of assuming an evenly paced model turn',()=>{
  const angle=4.65;
  const picked=context.PetGeometry.gazeFrame({mouse:{x:200+150*Math.cos(angle),y:148+150*Math.sin(angle)},position:{x:100,y:100},size:200,count:9,dt:1,reducedMotion:true,angles:[0,.2,1,2,3,4,4.6,5,5.6]});
  assert.equal(picked.index,6);
});

test('rear-view front paws attach to lower textbox border while hind feet stay below',()=>{
  const rect={left:300,right:940,top:350,bottom:450,width:640,height:100};
  const p=pawPlacement(rect,170,{width:1440,height:1000},{x:.5,y:.32});
  assert.equal(p.y+p.size*.32,rect.bottom);
  assert.ok(p.y+p.size*.9375>rect.bottom+90);
  assert.ok(p.pawX>=rect.left&&p.pawX<=rect.right);
});

test('paw contact follows input scrolling and sizes down to fit below a low field',()=>{
  const a={left:20,right:370,top:300,bottom:410,width:350};
  const p=pawPlacement(a,170,{width:390,height:600});
  const moved=pawPlacement({...a,top:220,bottom:330},170,{width:390,height:600});
  assert.equal(p.pawY-moved.pawY,80);
  const low=pawPlacement({...a,bottom:550},170,{width:390,height:600});
  assert.ok(low.size<170);
  assert.ok(low.y+low.size*.9375<=592.001);
});
