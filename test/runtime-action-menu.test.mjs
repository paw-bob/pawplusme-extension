import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';

const runtimeSource=await readFile(new URL('../dist/extension/pet-runtime.js',import.meta.url),'utf8');
const geometrySource=await readFile(new URL('../dist/extension/pet-geometry.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({width=1200,height=900,position={x:200,y:200},onModeChange,onFocusChoice,onHide}={}){
  let now=0,nextTimer=0,nextFrame=0,document;
  const timers=new Map(),frames=new Map(),windowListeners=new Map(),documentListeners=new Map(),modes=[],focusEvents=[],hides=[];
  const add=(map,type,fn,options={})=>{if(!map.has(type))map.set(type,[]);map.get(type).push({fn,signal:options.signal});};
  const context2d={clearRect(){},drawImage(){},save(){},restore(){},translate(){},scale(){}};
  const dataKey=name=>name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
  function element(tag='div'){
    const node={tagName:tag.toUpperCase(),style:{},dataset:{},attributes:{},listeners:new Map(),children:[],parentNode:null,isConnected:true,textContent:'',hidden:false,
      append(...nodes){for(const child of nodes){this.children.push(child);child.parentNode=this;}},
      remove(){this.isConnected=false;if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);},
      contains(candidate){return candidate===this||this.children.some(child=>child.contains?.(candidate));},
      setAttribute(name,value){this.attributes[name]=String(value);if(name.startsWith('data-'))this.dataset[dataKey(name)]=String(value);},
      getAttribute(name){return name.startsWith('data-')&&Object.hasOwn(this.dataset,dataKey(name))?this.dataset[dataKey(name)]:this.attributes[name]??null;},
      removeAttribute(name){delete this.attributes[name];if(name.startsWith('data-'))delete this.dataset[dataKey(name)];},
      addEventListener(type,fn,options){add(this.listeners,type,fn,options);},
      attachShadow(){this.shadowRoot=element('#shadow-root');this.shadowRoot.host=this;return this.shadow=this.shadowRoot;},
      getContext:()=>context2d,
      matches(selector){return selector.split(',').some(part=>{part=part.trim();if(part==='[contenteditable]')return this.getAttribute('contenteditable')!=null;const role=/^\[role="([^"]+)"\]$/.exec(part);if(role)return this.getAttribute('role')===role[1];const data=/^\[(data-[\w-]+)(?:="([^"]+)")?\]$/.exec(part);if(data)return this.getAttribute(data[1])!=null&&(data[2]===undefined||this.getAttribute(data[1])===data[2]);return this.tagName===part.toUpperCase();});},
      closest(selector){for(let item=this;item;item=item.parentNode){if(item.matches?.(selector))return item;}return null;},
      getBoundingClientRect(){
        const isMenu=this.getAttribute('data-pet-action-menu')!=null;
        const rectWidth=isMenu?Math.min(280,width-16):this.tagName==='CANVAS'?144:280;
        const rectHeight=isMenu?40:this.tagName==='CANVAS'?144:180;
        const left=Number.parseFloat(this.style.left)||0,top=Number.parseFloat(this.style.top)||0;
        return {left,top,right:left+rectWidth,bottom:top+rectHeight,width:rectWidth,height:rectHeight};
      },
      focus(){document.activeElement=this;fire(this,'focus',{target:this});},
      blur(){if(document.activeElement===this)document.activeElement=document.body;fire(this,'blur',{target:this});},
      setPointerCapture(id){this.captured=id;},releasePointerCapture(id){if(this.captured===id)this.captured=null;}}
    return node;
  }
  const body=element('body'),html=element('html');html.append(body);
  document={body,documentElement:html,hidden:false,focused:true,activeElement:body,hasFocus(){return this.focused;},createElement:element,
    addEventListener(type,fn,options){add(documentListeners,type,fn,options);}};
  const context=vm.createContext({...configGlobals(),document,innerWidth:width,innerHeight:height,AbortController,console,
    ResizeObserver:class{observe(){}disconnect(){}},performance:{now:()=>now},
    requestAnimationFrame(fn){const id=++nextFrame;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout(fn,delay=0){const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),
    addEventListener(type,fn,options){add(windowListeners,type,fn,options);}});
  vm.runInContext(geometrySource,context);vm.runInContext(runtimeSource,context);
  const manifest={cellSize:192,columns:8,motion:'continuous-video',fps:{run:24,sleep:24,peek:24},animations:{look:[0,1,2,3,4,5,6,7],run:[8,9,10,11],sleep:[12,13,14,15],peek:[16,17]}};
  const app=new context.PetCompanion({manifest,image:{},position,
    onModeChange(mode){modes.push(mode);return onModeChange?.(mode);},
    onFocusChoice(event){focusEvents.push(structuredClone(event));return onFocusChoice?.(event);},
    onHide(){hides.push(true);return onHide?.();}});
  function fire(surface,type,extra={}){
    const event={type,target:body,clientX:app?.x+72,clientY:app?.y+72,pointerId:7,pointerType:'mouse',button:0,isPrimary:true,defaultPrevented:false,detail:1,
      preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
    event.composedPath??=()=>{const result=[];for(let node=event.target;node;node=node.parentNode||node.host)result.push(node);return result;};
    const listeners=(surface==='window'?windowListeners:surface==='document'?documentListeners:surface.listeners).get(type)||[];
    const results=[];for(const {fn,signal}of listeners)if(!signal?.aborted)results.push(fn(event));
    return {event,results};
  }
  function advance(ms,{paint=false}={}){
    now+=ms;for(const[id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}
    if(paint){const queued=[...frames];frames.clear();for(const [,fn]of queued)fn(now);}
  }
  function walk(node){return [node,...node.children.flatMap(walk),...(node.shadowRoot?walk(node.shadowRoot):[])];}
  function menu(){return walk(html).find(node=>node.getAttribute('data-pet-action-menu')!=null);}
  function button(action){const node=walk(menu()||html).find(node=>node.getAttribute('data-pet-action')===action);assert.ok(node,`missing ${action} button`);return node;}
  async function click(action){const {results}=fire(button(action),'click',{target:button(action)});await Promise.all(results);await flush();}
  const shown=()=>{const host=menu();return !!host&&!host.hidden&&host.style.display!=='none';};
  const hover=(extra={})=>fire('document','pointermove',extra).event;
  return {app,document,body,element,fire,advance,menu,button,click,shown,hover,timers,frames,modes,focusEvents,hides};
}

test('hover exposes five actions while the pet remains click-through and underlying controls are respected',()=>{
  const s=fixture();assert.equal(s.shown(),false);assert.equal(s.app.canvas.style.pointerEvents,'none');
  const pageButton=s.element('button');const overControl=s.hover({target:pageButton});
  assert.equal(s.shown(),false);assert.equal(overControl.defaultPrevented,false);
  const event=s.hover();assert.equal(s.shown(),true);assert.equal(event.defaultPrevented,false);assert.equal(s.app.canvas.style.pointerEvents,'none');
  for(const action of ['follow','look','timer','sleep','hide'])assert.ok(s.button(action));
  assert.ok(s.menu().shadowRoot,'host-page selectors must not style the action buttons');
});

test('hover parks Follow without changing its mode, and leaving the menu resumes following after the close grace',()=>{
  const s=fixture();s.app.setMode('follow');s.hover();const point=[s.app.x,s.app.y];
  s.advance(50,{paint:true});assert.deepEqual([s.app.x,s.app.y],point);assert.equal(s.app.mode,'follow');assert.equal(s.app.state,'look');assert.ok(s.frames.size);
  s.hover({clientX:1000,clientY:700});s.advance(100,{paint:true});assert.equal(s.shown(),true);assert.deepEqual([s.app.x,s.app.y],point);
  s.hover({target:s.menu(),clientX:272,clientY:170});s.advance(200);assert.equal(s.shown(),true,'crossing the gap into the toolbar keeps it open');
  s.hover({clientX:1000,clientY:700});s.advance(181,{paint:true});assert.equal(s.shown(),false);assert.notDeepEqual([s.app.x,s.app.y],point);assert.equal(s.app.state,'run');
});

test('the normal Follow cursor lane near the feet does not open the menu, while head/body hover still parks the pet',()=>{
  const s=fixture();s.app.setMode('follow');
  s.hover({clientX:s.app.x+120,clientY:s.app.y+s.app.renderSize-14});
  assert.equal(s.shown(),false,'the normal Follow cursor is within the frame near its bottom, not a deliberate pet hover');
  const before=[s.app.x,s.app.y];s.advance(50,{paint:true});assert.notDeepEqual([s.app.x,s.app.y],before);assert.equal(s.app.state,'run');
  s.hover({clientX:s.app.x+72,clientY:s.app.y+60});assert.equal(s.shown(),true);
  const parked=[s.app.x,s.app.y];s.advance(50,{paint:true});assert.deepEqual([s.app.x,s.app.y],parked);assert.equal(s.app.mode,'follow');
});

test('leaving the browser content area closes a mouse-hover menu even when no further pointermove or blur arrives',()=>{
  const s=fixture();s.app.setMode('follow');s.hover();assert.equal(s.shown(),true);
  s.fire('document','pointerout',{relatedTarget:s.element('span')});s.advance(181);assert.equal(s.shown(),true,'ordinary child-to-child transitions do not count as leaving the page');
  s.fire('document','pointerout',{relatedTarget:null,clientX:-1});s.advance(181);assert.equal(s.shown(),false);
});

test('Follow, Watch and Nap selections close the toolbar and persist through the existing mode callback',async()=>{
  const s=fixture();
  for(const [action,mode]of [['follow','follow'],['look','look'],['sleep','sleep']]){
    s.hover();await s.click(action);assert.equal(s.app.mode,mode);assert.equal(s.modes.at(-1),mode);assert.equal(s.shown(),false);
  }
  s.hover();assert.equal(s.button('sleep').getAttribute('aria-pressed'),'true');
  s.advance(0,{paint:true});const frame=s.app.frame;s.advance(100,{paint:true});assert.equal(s.app.state,'sleep');assert.ok(s.frames.size);assert.notEqual(s.app.frame,frame,'Nap continues animating while its menu is open');
});

test('Timer starts once through the existing focus callback and disables re-entry while pending',async()=>{
  let resolve;const response=new Promise(r=>resolve=r),s=fixture({onFocusChoice:()=>response});
  s.hover();const pending=s.click('timer');pending.catch(()=>{});await flush();
  assert.deepEqual(s.focusEvents,[{type:'start'}]);assert.equal(s.shown(),false);
  s.hover();assert.equal(s.shown(),false,'pending operations cannot reopen the toolbar');
  await s.click('timer');assert.equal(s.focusEvents.length,1);resolve();await pending;
  s.hover();assert.equal(s.shown(),true);
});

test('Hide uses its parent callback, and a failed action remains visible with a retryable message',async()=>{
  const hidden=fixture();hidden.hover();await hidden.click('hide');assert.deepEqual(hidden.hides,[true]);assert.equal(hidden.app.visible,false);assert.equal(hidden.shown(),false);assert.equal(hidden.app.root.style.display,'none');
  const failed=fixture({onHide:async()=>{throw Error('storage unavailable');}});failed.hover();await failed.click('hide');
  assert.equal(failed.app.visible,true);assert.equal(failed.app.root.style.display,'block');assert.equal(failed.shown(),true);assert.ok(failed.app.actionStatus.textContent);
  const modes=fixture({onModeChange:async()=>{throw Error('storage unavailable');}});modes.hover();await modes.click('follow');assert.equal(modes.app.mode,'auto');assert.equal(modes.shown(),true);assert.ok(modes.app.actionStatus.textContent);
});

test('dragging, pausing, hiding and reminder states close the toolbar and cannot reopen it',()=>{
  const preparations=[s=>s.app.setPaused(true),s=>s.app.setVisible(false),s=>s.app.startDrag({clientX:272,clientY:272,pointerId:7},true),...['waiting','quiet','mischief','caught'].map(phase=>s=>s.app.setFocusState({phase,cycle:1}))];
  for(const prepare of preparations){const s=fixture();s.hover();assert.equal(s.shown(),true);prepare(s);assert.equal(s.shown(),false);s.hover();assert.equal(s.shown(),false);}
  const blurred=fixture();blurred.hover();blurred.document.focused=false;blurred.fire('window','blur');assert.equal(blurred.shown(),false);blurred.hover();assert.equal(blurred.shown(),false);
});

test('keyboard focus opens the toolbar, and Escape dismisses it without consuming the host page key',()=>{
  const s=fixture();assert.equal(s.app.canvas.tabIndex,0);s.app.canvas.focus();assert.equal(s.shown(),true);
  const {event}=s.fire('window','keydown',{key:'Escape',target:s.app.canvas});assert.equal(s.shown(),false);assert.equal(event.defaultPrevented,false);assert.equal(event.stopped,undefined);
});

test('menu placement stays inside narrow viewport edges and destruction removes its host and timers',()=>{
  for(const position of [{x:0,y:8},{x:176,y:336}]){
    const s=fixture({width:320,height:480,position});s.hover();const rect=s.menu().getBoundingClientRect();
    assert.ok(rect.left>=0);assert.ok(rect.right<=320);assert.ok(rect.top>=0);assert.ok(rect.bottom<=480);
    if(position.y===8)assert.ok(rect.top>=position.y+144,'a top-edge pet places its menu below');
    s.hover({clientX:10,clientY:470});assert.ok(s.timers.size);const host=s.menu();s.app.destroy();assert.equal(host.isConnected,false);assert.equal(s.menu(),undefined);assert.equal(s.timers.size,0);assert.equal(s.frames.size,0);
    s.hover();assert.equal(s.shown(),false);
  }
});
