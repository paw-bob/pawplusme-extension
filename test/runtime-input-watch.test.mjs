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
  const ctx={clearRect(){},drawImage(){},save(){},restore(){},translate(){},scale(){}};
  const add=(map,type,fn)=>{if(!map.has(type))map.set(type,[]);map.get(type).push(fn);};
  const element=()=>({
    style:{},dataset:{},listeners:new Map(),children:[],attributes:{},isConnected:true,
    append(...nodes){this.children.push(...nodes);},remove(){this.isConnected=false;},
    contains(node){return node===this||this.children.some(child=>child===node||child.contains?.(node));},
    setAttribute(key,value){this.attributes[key]=value;},getAttribute(key){return this.attributes[key]??null;},
    addEventListener(type,fn){add(this.listeners,type,fn);},
    removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(value=>value!==fn));},
    attachShadow(){return this.shadow=element();},getContext:()=>ctx,
    getBoundingClientRect:()=>({left:300,right:700,top:180,bottom:240,width:400,height:60}),
    setPointerCapture(id){this.captured=id;},releasePointerCapture(id){if(this.captured===id)this.captured=null;},focus(){}
  });
  const root=element(),body={closest:()=>null};
  const document={documentElement:root,hidden:false,hasFocus:()=>true,activeElement:null,createElement:element,
    addEventListener(type,fn){add(documentListeners,type,fn);}};
  const context=vm.createContext({...configGlobals(),document,innerWidth:1200,innerHeight:900,AbortController,
    ResizeObserver:class{observe(){}disconnect(){}},performance:{now:()=>now},
    requestAnimationFrame:()=>1,cancelAnimationFrame(){},
    setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},
    clearTimeout:id=>timers.delete(id),addEventListener(type,fn){add(windowListeners,type,fn);}});
  vm.runInContext(geometrySource,context);vm.runInContext(runtimeSource,context);
  const manifest={cellSize:192,columns:8,motion:'continuous-video',fps:{run:24,sleep:24,peek:24},
    animations:{look:[0,1,2,3,4,5,6,7],run:[8,9,10,11],sleep:[12,13],peek:[14,15]}};
  const app=new context.PetCompanion({manifest,image:{},position:{x:300,y:200},onModeChange:mode=>modes.push(mode)});
  function fire(surface,type,extra={}){
    const event={type,target:body,relatedTarget:null,clientX:450,clientY:210,pointerId:7,pointerType:'mouse',button:0,isPrimary:true,defaultPrevented:false,detail:1,
      preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
    for(const fn of(surface==='window'?windowListeners:surface==='document'?documentListeners:surface.listeners).get(type)||[])fn(event);
    return event;
  }
  function step(ms=16){now+=ms;for(const[id,timer]of[...timers])if(timer.at<=now){timers.delete(id);timer.fn();}app.tick(now);}
  function field(kind='textarea'){
    const node=element(),allowed=kind!=='password';
    Object.assign(node,{tagName:kind==='contenteditable'?'DIV':kind==='textarea'?'TEXTAREA':'INPUT',type:kind==='password'?'password':kind==='input'?'text':undefined,isContentEditable:kind==='contenteditable',
      matches:()=>allowed,closest(){return allowed?this:null;},getClientRects(){return this.isConnected?[this.getBoundingClientRect()]:[];}});
    for(const name of ['value','textContent','innerText','innerHTML'])Object.defineProperty(node,name,{get(){assert.fail('input interaction must never read '+name);}});
    return node;
  }
  function activate(node,type='focusin'){
    document.activeElement=node;fire('document',type,{target:node});
    for(let i=0;i<150&&app.state!=='peek';i++)step();
  }
  function leave(node){
    const event={target:node,relatedTarget:body,clientX:850,clientY:350};
    fire(node,'pointerleave',event);fire('document','pointerleave',event);fire('document','pointerout',event);fire('document','pointermove',event);
  }
  return {app,fire,step,field,activate,leave,document,modes,body};
}

test('ordinary text fields and contenteditable enter real peek motion without reading text',()=>{
  for(const kind of ['input','textarea','contenteditable']){
    const s=fixture(),field=s.field(kind);s.activate(field);
    assert.equal(s.app.state,'peek',kind+' focus must use the actual peek animation');
    assert.ok(s.app.manifest.animations.peek.includes(Number(s.app.root.dataset.frame)));
    assert.equal(s.app.peek,field);
    s.fire('document','input',{target:field});s.step();assert.equal(s.app.state,'peek');
  }
  const s=fixture(),password=s.field('password');s.activate(password);assert.ok(!s.app.peek);assert.notEqual(s.app.state,'peek');
});

test('leaving an input returns follow mode to watch once even while keyboard focus stays in the field',()=>{
  const s=fixture(),field=s.field();s.app.setMode('follow');s.activate(field);assert.equal(s.app.state,'peek');
  s.leave(field);s.step();
  assert.equal(s.document.activeElement,field,'the pointer leave does not blur the host text field');
  assert.ok(!s.app.peek,'watch must clear the old attachment instead of waiting for its timer');
  assert.equal(s.app.mode,'look');assert.equal(s.app.state,'look');assert.deepEqual(s.modes,['look']);
  s.leave(field);s.step();assert.deepEqual(s.modes,['look'],'duplicate leave events cannot persist duplicate mode changes');
  s.fire('document','input',{target:field});for(let i=0;i<150&&s.app.state!=='peek';i++)s.step();
  assert.equal(s.app.state,'peek','typing again starts a new interaction');
});

test('focus moving inside an editable keeps peek, while external focusout returns to watch',()=>{
  const s=fixture(),field=s.field('contenteditable'),inside={closest:()=>field};field.children.push(inside);s.app.setMode('follow');s.activate(field);
  s.document.activeElement=inside;s.fire('document','focusout',{target:field,relatedTarget:inside});s.step();
  assert.equal(s.app.state,'peek');assert.equal(s.app.peek,field);assert.deepEqual(s.modes,[]);
  s.document.activeElement=s.body;s.fire('document','focusout',{target:inside,relatedTarget:s.body});s.step();
  assert.ok(!s.app.peek);assert.equal(s.app.mode,'look');assert.equal(s.app.state,'look');assert.deepEqual(s.modes,['look']);
  s.activate(field,'input');assert.equal(s.app.state,'peek','the same editable remains reusable after focus changes');
});

test('a disconnected field or hidden pet cannot keep a stale input attachment alive',()=>{
  for(const reason of ['removed','hidden-pet','hidden-document']){
    const s=fixture(),field=s.field();s.activate(field);assert.equal(s.app.state,'peek');
    if(reason==='removed'){field.isConnected=false;s.step();}
    else if(reason==='hidden-pet')s.app.setVisible(false);
    else{s.document.hidden=true;s.fire('document','visibilitychange');}
    assert.ok(!s.app.peek,reason+' must clear its attachment');
    if(reason==='hidden-pet')s.app.setVisible(true);
    if(reason==='hidden-document'){s.document.hidden=false;s.fire('document','visibilitychange');}
    s.step();assert.notEqual(s.app.state,'peek',reason+' must not reattach merely because the old activeElement remains');
  }
});

test('Alt dragging from follow releases into watch and blur clears capture without a false mode callback',()=>{
  const s=fixture();s.app.setMode('follow');s.fire('window','keydown',{altKey:true});
  s.fire(s.app.canvas,'pointerdown',{clientX:350,clientY:230});assert.ok(s.app.drag);assert.equal(s.app.canvas.captured,7);
  s.fire('document','pointermove',{clientX:430,clientY:260});assert.equal(s.app.x,380);assert.equal(s.app.y,230);
  s.fire('document','pointerup',{clientX:430,clientY:260});assert.equal(s.app.mode,'look');assert.deepEqual(s.modes,['look']);assert.equal(s.app.canvas.captured,null);
  const interrupted=fixture();interrupted.app.setMode('follow');interrupted.fire('window','keydown',{altKey:true});interrupted.fire(interrupted.app.canvas,'pointerdown');assert.ok(interrupted.app.drag);
  interrupted.fire('window','blur');assert.ok(!interrupted.app.drag);assert.equal(interrupted.app.canvas.captured,null);assert.equal(interrupted.app.canvas.style.pointerEvents,'none');assert.deepEqual(interrupted.modes,[]);
});

test('recall ignores popup focus restoration while a new page click or typing still starts peek',()=>{
  const s=fixture(),field=s.field();s.activate(field);assert.equal(s.app.state,'peek');
  s.app.recall();s.step();assert.equal(s.app.state,'look');
  s.fire('document','focusin',{target:field});s.step();assert.equal(s.app.peek,null);assert.equal(s.app.state,'look');
  assert.equal(s.app.root.dataset.lastInputEvent,'focusin-suppressed');
  s.fire('document','pointerdown',{target:field});s.activate(field);assert.equal(s.app.state,'peek','a new deliberate input click ends focus suppression');
  s.app.recall();s.activate(field,'input');assert.equal(s.app.state,'peek','typing never waits for the suppression interval');
});
