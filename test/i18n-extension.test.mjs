import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';

const sources=Object.fromEntries(await Promise.all(['dist/extension/pet-i18n.js','dist/extension/pet-focus.js','dist/extension/pet-geometry.js','dist/extension/pet-shortcuts.js','dist/extension/pet-runtime.js','dist/extension/content.js','dist/extension/popup.js','dist/extension/popup.html','dist/extension/manifest.json'].map(async path=>[path,await readFile(new URL(`../${path}`,import.meta.url),'utf8')])));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const pet={id:'64bcddbc-c205-4b4c-b384-c2b3418ff22c',name:'豆豆',revision:'r1',image:'data:image/png;base64,fixture',cellSize:192,columns:4,rows:5,animations:{look:[0,1,2,3,4,5,6,7],run:[8],sleep:[9],peek:[10]}};

function surface({own=false,locale='zh',store={}}={}){
  const elements=new Map(),windowListeners=new Map(),documentListeners=new Map(),storageListeners=[],writes=[];
  const ctx={clearRect(){},drawImage(){},save(){},restore(){},translate(){},scale(){}};
  function element(tag='div'){
    return {tagName:tag.toUpperCase(),style:{},dataset:{},attributes:{},children:[],listeners:new Map(),textContent:'',offsetWidth:210,
      append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=[...nodes];},remove(){this.removed=true;},contains(node){return this.children.includes(node);},
      setAttribute(key,value){this.attributes[key]=String(value);},getAttribute(key){return this.attributes[key]??null;},
      addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(handler);},
      emit(type){for(const handler of this.listeners.get(type)||[])handler({type,target:this});},
      attachShadow(){return this.shadow=element('shadow');},getContext:()=>ctx,getBoundingClientRect:()=>({width:280,height:180}),focus(){},setPointerCapture(){}};
  }
  function byId(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);}
  const root=element('html');root.lang=own?'zh-CN':'fr';if(own)root.setAttribute('data-pet-app','xiaoban');
  const language=byId('language');language.setAttribute('data-pet-language','');language.setAttribute('data-pet-i18n-aria-label','语言');
  const staticCopy=byId('static-copy');staticCopy.textContent='住在浏览器里的小伙伴';staticCopy.setAttribute('data-pet-i18n','住在浏览器里的小伙伴');
  let foreignQueries=0,foreignWrites=0;
  const document={documentElement:root,hidden:false,activeElement:null,hasFocus:()=>true,getElementById:byId,createElement:element,addEventListener(type,handler){documentListeners.set(type,handler);},
    querySelectorAll(selector){if(!own){foreignQueries++;throw new Error('must not scan the host page');}const attribute=selector.slice(1,-1);return [...elements.values()].filter(node=>node.getAttribute(attribute)!=null);}};
  const state=structuredClone(store),chrome={runtime:{id:'fixture',async sendMessage(message){if(message?.action==='list-pets')return{ok:true,pets:state.pet?[{id:state.pet.id,name:state.pet.name,revision:state.pet.revision}]:[],activePetId:state.pet?.id||null};return{ok:true,focus:state.focus};}},tabs:{opened:[],create(value){this.opened.push(value);}},storage:{onChanged:{addListener:fn=>storageListeners.push(fn)},local:{
    async get(){return structuredClone(state);},async set(values){writes.push(structuredClone(values));const changes={};for(const[key,value]of Object.entries(values)){changes[key]={oldValue:state[key],newValue:structuredClone(value)};state[key]=structuredClone(value);}for(const handler of storageListeners)handler(changes,'local');}
  }}};
  const location=new URL(own?'chrome-extension://fixture/popup.html':'https://example.test/page');
  const sandbox={...configGlobals(),document,chrome,location,URL,navigator:{languages:[locale]},innerWidth:390,innerHeight:700,AbortController,
    performance:{now:()=>100},requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout:()=>1,clearTimeout(){},setInterval(){},
    ResizeObserver:class{observe(){}disconnect(){}},Image:class{async decode(){}},
    localStorage:{getItem(){if(!own)foreignWrites++;return null;},setItem(){if(!own)foreignWrites++;}},history:{replaceState(){}},
    addEventListener(type,handler){if(!windowListeners.has(type))windowListeners.set(type,[]);windowListeners.get(type).push(handler);},
    dispatchEvent(event){for(const handler of windowListeners.get(event.type)||[])handler(event);return true;},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}
  };
  const context=vm.createContext(sandbox);
  vm.runInContext(sources['dist/extension/pet-i18n.js'],context);vm.runInContext(sources['dist/extension/pet-focus.js'],context);vm.runInContext(sources['dist/extension/pet-geometry.js'],context);vm.runInContext(sources['dist/extension/pet-shortcuts.js'],context);
  return{context,document,documentListeners,root,byId,language,staticCopy,state,chrome,writes,stats:()=>({foreignQueries,foreignWrites})};
}

test('focus time remains numeric and stable while its copy changes across English, Spanish and Japanese',()=>{
  const {context}=surface(),focus=context.PetFocus;
  const state=focus.transition(focus.empty(),{type:'start'},1_000),before=JSON.stringify(state);
  const expectations=[['en','Off for today','Time’s up!'],['es','Descanso por hoy','¡Se acabó el tiempo!'],['ja','今日はお休み','時間だよ！']];
  const messages=[];
  for(const[locale,quiet,due]of expectations){
    context.PetI18n.setLocale(locale,{persist:false,updateURL:false});
    assert.equal(focus.clock(state,61_000),'24:00');assert.equal(focus.clock({phase:'quiet'}),quiet);assert.equal(focus.clock({phase:'caught'}),due);
    messages.push(focus.message(state));assert.notEqual(messages.at(-1),'它先安静退场。到点后，按住宠物抓住它。');
    assert.equal(JSON.stringify(state),before);assert.equal(focus.deadline(state),1_501_000);
  }
  assert.equal(new Set(messages).size,3);
});

test('normal follow clicks pass through, Alt enables dragging, and blur releases the modifier',()=>{
  const s=surface();vm.runInContext(sources['dist/extension/pet-runtime.js'],s.context);
  const app=new s.context.PetCompanion({manifest:pet,image:{}});app.setMode('follow');
  assert.equal(app.canvas.style.pointerEvents,'none','following pet must not capture page clicks');
  s.context.dispatchEvent({type:'keydown',key:'Alt',altKey:true,shiftKey:false,ctrlKey:false,metaKey:false});
  assert.equal(app.canvas.style.pointerEvents,'auto');
  s.context.dispatchEvent({type:'keyup',key:'Alt',altKey:false});assert.equal(app.canvas.style.pointerEvents,'none');
  s.context.dispatchEvent({type:'keydown',key:'Alt',altKey:true});s.context.dispatchEvent({type:'blur'});assert.equal(app.canvas.style.pointerEvents,'none');
  app.setFocusState({phase:'mischief',cycle:12});assert.equal(app.canvas.style.pointerEvents,'auto','focus reminder can still be caught');
  app.setFocusState({phase:'off'});assert.equal(app.canvas.style.pointerEvents,'none');
});

test('pet renders no head chatter while keeping the actionable catch dialog',()=>{
  const s=surface();vm.runInContext(sources['dist/extension/pet-runtime.js'],s.context);
  const app=new s.context.PetCompanion({manifest:pet,image:{}});app.tick(116);
  assert.ok(app.root.shadow.children.every(node=>!node.textContent),'head chatter must not render');
  app.setFocusState({phase:'caught',cycle:12});assert.equal(app.focusDialog.getAttribute('role'),'dialog');assert.equal(app.focusButtons.length,3);
});

test('live language changes update the catch menu and labels without changing pet activity',()=>{
  const s=surface();vm.runInContext(sources['dist/extension/pet-runtime.js'],s.context);
  const app=new s.context.PetCompanion({manifest:pet,image:{}});
  app.setMode('follow');app.setFocusState({phase:'caught',cycle:1234,dueAt:1234});app.tick(116);
  const before={x:app.x,y:app.y,mode:app.mode,phase:app.phase,focus:JSON.stringify(app.focusState),image:app.image};
  const expectations=[['en','Caught me! Take a break?','In 25 minutes'],['es','¡Me atrapaste! ¿Descansamos?','Dentro de 25 minutos'],['ja','つかまっちゃった。ひとやすみする？','25分後に']];
  for(const[locale,title,choice]of expectations){
    s.context.PetI18n.setLocale(locale,{persist:false,updateURL:false});
    assert.equal(app.focusTitle.textContent,title);assert.equal(app.focusButtons[0].textContent,choice);
    assert.ok(app.root.shadow.children.every(node=>!node.textContent));
    assert.equal(app.canvas.getAttribute('aria-label'),s.context.PetI18n.t('陪伴宠物，跟随时长按或按住Alt拖动'));
    assert.deepEqual({x:app.x,y:app.y,mode:app.mode,phase:app.phase,focus:JSON.stringify(app.focusState),image:app.image},before);
  }
  assert.equal(s.root.lang,'fr');assert.equal(s.staticCopy.textContent,'住在浏览器里的小伙伴');assert.deepEqual(s.stats(),{foreignQueries:0,foreignWrites:0});
});

test('content storage language updates reuse the existing pet and preserve the focus deadline on a foreign page',async()=>{
  const focus={phase:'waiting',dueAt:Date.now()+1_200_000,quietUntil:0,cycle:123};
  const s=surface({locale:'en',store:{pet,enabled:true,mode:'follow',size:144,focus,locale:'en'}}),instances=[];
  vm.runInContext(sources['dist/extension/pet-runtime.js'],s.context);
  const Companion=s.context.PetCompanion;
  s.context.PetCompanion=class extends Companion{constructor(options){super(options);instances.push(this);}};
  vm.runInContext(sources['dist/extension/content.js'],s.context);await flush();
  assert.equal(instances.length,1);const app=instances[0],root=app.root;
  for(const locale of ['es','ja']){
    await s.chrome.storage.local.set({locale});await flush();
    assert.equal(instances.length,1);assert.equal(app.root,root);assert.equal(app.destroyed,false);
    assert.equal(s.context.PetI18n.getLocale(),locale);assert.deepEqual(structuredClone(app.focusState),focus);assert.equal(app.mode,'follow');
  }
  assert.equal(s.state.pet.name,'豆豆');assert.equal(s.root.lang,'fr');assert.deepEqual(s.stats(),{foreignQueries:0,foreignWrites:0});
});

test('hover Hide disables the extension globally and popup recall restores the saved pet',async()=>{
  const s=surface({store:{pet,enabled:true,mode:'look',focus:{phase:'off'},locale:'en'}}),options=[],instances=[];
  vm.runInContext(sources['dist/extension/pet-runtime.js'],s.context);const Runtime=s.context.PetCompanion;
  s.context.PetCompanion=class extends Runtime{constructor(value){super(value);options.push(value);instances.push(this);}};
  vm.runInContext(sources['dist/extension/content.js'],s.context);await flush();
  await options[0].onHide();await flush();
  assert.equal(s.state.enabled,false);assert.equal(instances[0].destroyed,true);assert.deepEqual(s.state.pet,pet);
  await s.chrome.storage.local.set({enabled:true,mode:'look',recallToken:'after-hover-hide'});await flush();
  assert.equal(instances.length,2);assert.equal(instances[1].mode,'look');assert.equal(instances[1].shown,true);assert.equal(instances[1].destroyed,false);assert.deepEqual(s.state.pet,pet);
});

test('hover Timer uses the existing background start action without changing or downloading the pet',async()=>{
  const s=surface({store:{pet,enabled:true,mode:'look',focus:{phase:'off'}}}),options=[],messages=[];
  vm.runInContext(sources['dist/extension/pet-runtime.js'],s.context);const Runtime=s.context.PetCompanion;
  s.context.PetCompanion=class extends Runtime{constructor(value){super(value);options.push(value);}};
  const send=s.chrome.runtime.sendMessage.bind(s.chrome.runtime);s.chrome.runtime.sendMessage=async message=>{messages.push(message);return send(message);};
  vm.runInContext(sources['dist/extension/content.js'],s.context);await flush();messages.length=0;
  await options[0].onFocusChoice({type:'start'});
  assert.equal(messages.length,1);assert.equal(messages[0].action,'focus-start');assert.equal(messages[0].cycle,undefined);assert.deepEqual(s.state.pet,pet);assert.deepEqual(s.writes,[]);
});

test('content focus callbacks reject background errors while initial get failures remain handled',async()=>{
  const s=surface({store:{pet,enabled:true,mode:'look',focus:{phase:'off'}}}),options=[],messages=[];
  vm.runInContext(sources['dist/extension/pet-runtime.js'],s.context);const Runtime=s.context.PetCompanion;
  s.context.PetCompanion=class extends Runtime{constructor(value){super(value);options.push(value);}};
  s.chrome.runtime.sendMessage=async message=>{messages.push(message);return{error:'Timer storage unavailable'};};
  vm.runInContext(sources['dist/extension/content.js'],s.context);await flush();
  assert.equal(messages[0].action,'focus-get');assert.equal(options.length,1);
  await assert.rejects(options[0].onFocusChoice({type:'start'}),/Timer storage unavailable/);
  assert.equal(messages.at(-1).action,'focus-start');assert.deepEqual(s.state.focus,{phase:'off'});assert.deepEqual(s.writes,[]);
});

test('popup creates a new pet in the selected language while preserving the adopted pet and focus',async()=>{
  const focus={phase:'waiting',dueAt:Date.now()+1_200_000,quietUntil:0,cycle:123};
  const s=surface({own:true,locale:'en',store:{pet,enabled:true,focus,locale:'en'}});
  vm.runInContext(sources['dist/extension/popup.js'],s.context);await flush();
  for(const locale of ['en','es','ja']){
    s.language.value=locale;s.language.emit('change');await flush();
    assert.equal(s.state.locale,locale);assert.equal(s.context.PetI18n.getLocale(),locale);assert.equal(s.byId('open').textContent,s.context.PetI18n.t('创建新宠物'));
    assert.notEqual(s.byId('open').textContent,'创建新宠物','the create entry is translated');
    if(locale==='en')assert.equal(s.byId('open').textContent,'Create a new pet');
    assert.equal(s.byId('return-hint').textContent,s.context.PetI18n.t('上传一张照片，制作新的小伙伴。'));
    assert.equal(s.byId('pet-name').textContent,'豆豆');assert.deepEqual(s.state.focus,focus);
    const writesBefore=s.writes.length;
    s.byId('open').emit('click');const url=new URL(s.chrome.tabs.opened.at(-1).url);
    assert.equal(url.searchParams.get('lang'),locale);assert.equal(url.searchParams.get('create'),'1');assert.equal(url.searchParams.has('pet'),false);assert.equal(url.searchParams.get('from'),'extension');assert.equal(url.hash,'');
    assert.deepEqual(s.state.pet,pet);assert.deepEqual(s.state.focus,focus);assert.equal(s.writes.length,writesBefore,'opening creation never overwrites the adopted pet or timer');
  }
  assert.ok(s.writes.some(value=>value.locale==='es'));assert.ok(s.writes.some(value=>value.locale==='ja'));
});

test('popup offers the same fresh creation entry before a pet is adopted',async()=>{
  const s=surface({own:true,locale:'zh',store:{enabled:true,locale:'zh'}});
  vm.runInContext(sources['dist/extension/popup.js'],s.context);await flush();
  assert.equal(s.byId('open').textContent,'创建新宠物');
  assert.equal(s.byId('controls').disabled,true);
  s.byId('open').emit('click');const url=new URL(s.chrome.tabs.opened.at(-1).url);
  assert.equal(url.searchParams.get('create'),'1');assert.equal(url.searchParams.get('lang'),'zh');assert.equal(url.searchParams.has('pet'),false);assert.equal(url.hash,'');
  assert.equal(s.state.pet,undefined);assert.deepEqual(s.writes,[]);
});

test('Chrome metadata is localized in all four languages without expanding permissions',async()=>{
  const manifest=JSON.parse(sources['dist/extension/manifest.json']);
  assert.equal(manifest.version,JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version);assert.equal(manifest.default_locale,'en');
  assert.deepEqual(manifest.permissions,['storage','alarms']);assert.deepEqual(manifest.host_permissions,['https://www.pawplusme.com/*']);
  assert.equal(manifest.content_scripts[0].js[0],'site-config.js');assert.equal(manifest.content_scripts[0].js[1],'pet-i18n.js');
  const keys=[manifest.name,manifest.description,manifest.action.default_title].map(value=>/^__MSG_(.+)__$/.exec(value)?.[1]);
  assert.ok(keys.every(Boolean));
  for(const locale of ['en','zh_CN','es','ja']){
    const messages=JSON.parse(await readFile(new URL(`../dist/extension/_locales/${locale}/messages.json`,import.meta.url),'utf8'));
    for(const key of keys)assert.ok(messages[key]?.message,`${locale} metadata contains ${key}`);
  }
  const html=sources['dist/extension/popup.html'];assert.match(html,/data-pet-app="xiaoban"/);assert.match(html,/data-pet-language/);
  assert.doesNotMatch(html,/<label[^>]*data-pet-i18n=[^>]*>\s*<input/,'translation markers never replace a checkbox parent');
});


test('popup saves, reloads, clears and resets action shortcuts while preserving an unsaved draft',async()=>{
  const s=surface({own:true,store:{pet,enabled:true,locale:'zh'}});
  vm.runInContext(sources['dist/extension/popup.js'],s.context);await flush();
  const input=s.byId('shortcut-follow');
  const key=code=>{for(const handler of input.listeners.get('keydown')||[])handler({key:code==='Delete'?'Delete':code.slice(-1),code,altKey:true,shiftKey:true,ctrlKey:false,metaKey:false,preventDefault(){},stopPropagation(){}});};
  key('KeyG');assert.equal(input.value,'Alt + Shift + G');
  await s.chrome.storage.local.set({mode:'sleep'});await flush();assert.equal(input.value,'Alt + Shift + G','unrelated refresh must preserve a draft');
  s.byId('shortcut-save').emit('click');await flush();assert.equal(s.state.shortcuts.follow.code,'KeyG');
  key('Digit2');assert.equal(input.value,'Alt + Shift + G','duplicate cannot replace the configured binding');
  key('Delete');s.byId('shortcut-save').emit('click');await flush();assert.equal(s.state.shortcuts.follow,null);
  const reopened=surface({own:true,store:s.state});vm.runInContext(sources['dist/extension/popup.js'],reopened.context);await flush();assert.equal(reopened.byId('shortcut-follow').value,'未设置');
  reopened.byId('shortcut-reset').emit('click');reopened.byId('shortcut-save').emit('click');await flush();assert.equal(reopened.state.shortcuts.follow.code,'Digit3');
});

test('content applies a changed shortcut immediately across pages without replacing the pet',async()=>{
  const s=surface({store:{pet,enabled:true,mode:'auto',locale:'zh'}}),instances=[];
  vm.runInContext(sources['dist/extension/pet-runtime.js'],s.context);const Companion=s.context.PetCompanion;
  s.context.PetCompanion=class extends Companion{constructor(options){super(options);instances.push(this);}};
  vm.runInContext(sources['dist/extension/content.js'],s.context);await flush();
  const send=code=>s.documentListeners.get('keydown')({code,key:code.slice(-1),altKey:true,shiftKey:true,ctrlKey:false,metaKey:false,preventDefault(){},stopPropagation(){}});
  send('Digit3');await flush();assert.equal(s.state.mode,'follow');assert.equal(instances[0].mode,'follow');
  send('Digit3');await flush();assert.equal(s.state.mode,'look');assert.equal(instances[0].mode,'look');assert.equal(instances.length,1);
  send('Digit3');await flush();assert.equal(s.state.mode,'follow');assert.equal(instances[0].mode,'follow');
  const custom=s.context.PetShortcuts.defaults();custom.sleep={code:'KeyS',alt:true,shift:true,ctrl:false,meta:false};await s.chrome.storage.local.set({shortcuts:custom});await flush();
  send('KeyS');await flush();assert.equal(s.state.mode,'sleep');assert.equal(instances[0].mode,'sleep');assert.equal(instances.length,1);
  send('Digit4');await flush();assert.equal(s.state.mode,'sleep');assert.deepEqual(s.stats(),{foreignQueries:0,foreignWrites:0});
});


test('released follow grab persists look mode across ordinary pages without replacing their pet',async()=>{
  const s=surface({store:{pet,enabled:true,mode:'follow',locale:'zh'}}),instances=[];
  vm.runInContext(sources['dist/extension/pet-runtime.js'],s.context);const Companion=s.context.PetCompanion;
  s.context.PetCompanion=class extends Companion{constructor(options){super(options);instances.push(this);}};
  vm.runInContext(sources['dist/extension/content.js'],s.context);await flush();
  assert.equal(instances[0].mode,'follow');await instances[0].onModeChange('look');await flush();
  assert.equal(s.state.mode,'look');assert.equal(instances[0].mode,'look');assert.equal(instances.length,1);assert.equal(s.state.pet.name,'豆豆');
});

test('Escape on an ordinary page persists Watch through extension storage without replacing the pet',async()=>{
  const s=surface({store:{pet,enabled:true,mode:'follow',locale:'en'}}),instances=[];
  vm.runInContext(sources['dist/extension/pet-runtime.js'],s.context);const Companion=s.context.PetCompanion;
  s.context.PetCompanion=class extends Companion{constructor(options){super(options);instances.push(this);}};
  vm.runInContext(sources['dist/extension/content.js'],s.context);await flush();
  const escape={type:'keydown',key:'Escape',preventDefault(){assert.fail('host Escape remains available');},stopPropagation(){assert.fail('host Escape remains available');}};
  s.context.dispatchEvent(escape);await flush();
  assert.equal(s.state.mode,'look');assert.equal(instances[0].mode,'look');assert.equal(instances.length,1);assert.equal(s.state.pet.name,pet.name);
  const count=s.writes.filter(value=>value.mode==='look').length;
  s.context.dispatchEvent(escape);await flush();assert.equal(s.writes.filter(value=>value.mode==='look').length,count);
});
