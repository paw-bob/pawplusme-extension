import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../dist/extension/pet-runtime.js',import.meta.url),'utf8');
const geometrySource=await readFile(new URL('../dist/extension/pet-geometry.js',import.meta.url),'utf8');
function runtime({placement={x:710,y:390,size:72,pawX:746,pawY:413.04},width=800,height=600}={}){
  const element={isConnected:true};
  let selections=0,clears=0,destroyed=0,focused=true;
  const marks=[],layer={strike(target,point){assert.equal(target,element);marks.push(point);},clear(){clears++;marks.length=0;},destroy(){destroyed++;this.clear();}};
  const context=vm.createContext({...configGlobals(),
    innerWidth:width,innerHeight:height,performance:{now:()=>0},requestAnimationFrame:()=>1,cancelAnimationFrame(){},
    document:{hidden:false,hasFocus:()=>focused},
    PetMischief:{createLayer:()=>layer,pickTarget(){selections++;return{element,placement};},place:()=>placement}
  });
  vm.runInContext(geometrySource,context);vm.runInContext(source,context);
  const app=Object.create(context.PetCompanion.prototype);
  Object.assign(app,{
    manifest:{cellSize:192,columns:4,animations:{look:[0,1,2,3,4,5,6,7],run:[8],sleep:[9],peek:[10,11]},fps:{peek:24}},
    size:144,renderSize:144,x:626,y:430,mouse:{x:200,y:200},mode:'auto',focusState:{phase:'off'},visible:true,shown:false,
    lastTime:0,lastActivity:0,phase:0,onState(){},reduceMotion:true,
    root:{style:{},dataset:{},remove(){}},canvas:{style:{},setAttribute(){}},bubble:{textContent:'',style:{}},
    focusPanel:{style:{},getBoundingClientRect:()=>({width:280,height:180}),remove(){}},focusButtons:[{focus(){}}],
    actionMenu:{style:{},remove(){}},
    ctx:{clearRect(){}},drawFrame(){},abort:{abort(){}},resizeObserver:{disconnect(){}}
  });
  const advance=()=>{for(let now=16;now<=4000;now+=16)app.tick(now);};
  return{app,placement,marks,advance,stats:()=>({selections,clears,destroyed}),blur(){focused=false;app.syncVisibility();}};
}

test('pet reaches a small edge target, strikes twice at its paws and does not mutate cached geometry',()=>{
  const r=runtime(),before={...r.placement};
  r.app.setFocusState({phase:'mischief',cycle:1});r.advance();
  assert.equal(r.stats().selections,1,'target queries do not run every frame');
  assert.equal(r.marks.length,2);assert.deepEqual(r.placement,before);
  assert.equal(r.app.root.dataset.mischiefAction,'scratch');
  assert.ok(Math.abs(r.app.x-before.x)<1);assert.equal(r.app.renderSize,72);
  for(const point of r.marks){assert.ok(Math.abs(point.x-before.pawX)<10);assert.equal(point.y,before.pawY-2);assert.equal(point.size,before.size);}
  r.app.setFocusState({phase:'caught',cycle:1});
  assert.equal(r.marks.length,0);assert.equal(r.app.canvas.style.transform,'');
  assert.equal(r.app.focusPanel.style.display,'block');
});

test('hiding, losing document focus and destroying the pet clear all owned marks immediately',()=>{
  for(const action of ['hide','blur','destroy']){
    const r=runtime();r.app.setFocusState({phase:'mischief',cycle:1});r.advance();assert.equal(r.marks.length,2);
    if(action==='hide')r.app.setVisible(false);
    if(action==='blur')r.blur();
    if(action==='destroy')r.app.destroy();
    assert.equal(r.marks.length,0,action);
    if(action==='destroy')assert.equal(r.stats().destroyed,1);
    else assert.equal(r.app.root.style.display,'none');
  }
});

test('a low textbox-height paragraph is reachable using its paw geometry without an extra roaming inset',()=>{
  const placement={x:146.9805,y:458.5882,size:138.0392,pawX:216,pawY:500};
  const r=runtime({placement,width:390,height:600});
  r.app.setFocusState({phase:'mischief',cycle:1});r.advance();
  assert.equal(r.marks.length,2);
  assert.ok(Math.abs(r.app.y-placement.y)<1);
});
