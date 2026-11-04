import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';

const paths=['dist/extension/popup.html','dist/extension/popup.js','dist/extension/pet-i18n.js','dist/extension/pet-focus.js','dist/extension/pet-shortcuts.js'];
const sources=Object.fromEntries(await Promise.all(paths.map(async path=>[path,await readFile(new URL(`../${path}`,import.meta.url),'utf8')])));
const pet={id:'c1b45038-d146-4f42-af1f-c0955d750294',name:'小伴',revision:'fast',image:'data:image/png;base64,fixture',columns:16,cellSize:192,animations:{look:[0]}};
const otherPet={...pet,id:'301a04f4-2c98-4111-a5e3-502919b41761',name:'豆豆',revision:'v2',image:'data:image/png;base64,other'};
const quiet={phase:'quiet',quietUntil:Date.now()+3_600_000,dueAt:0,cycle:0};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

async function popup({store={pet,enabled:true,mode:'follow',focus:quiet},stopError=null,startError=null,previewError=null,waitForStart,pets=store.pet?[store.pet]:[],libraryError=null,selectError=null,waitForSelect,writeError=null,waitForWrite}={}){
  const state=structuredClone(store),elements=new Map(),messages=[],writes=[],listeners=[];let closed=0,serial=0;
  function node(attributes={}){
    return {attributes,listeners:new Map(),children:[],textContent:'',hidden:Object.hasOwn(attributes,'hidden'),disabled:Object.hasOwn(attributes,'disabled'),
      append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=[...nodes];},
      addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(handler);},
      setAttribute(key,value){this.attributes[key]=String(value);},getAttribute(key){return this.attributes[key]??null;},
      getContext:()=>({clearRect(){},drawImage(){}}),focus(){},blur(){}};
  }
  for(const match of sources['dist/extension/popup.html'].matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){
    const attributes={};for(const attr of match[0].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attributes[attr[1]]=attr[2]??'';
    elements.set(match[1],node(attributes));
  }
  const root=node({'data-pet-app':'xiaoban'});
  const document={documentElement:root,getElementById:id=>elements.get(id)||null,createElement:()=>node(),
    querySelectorAll(selector){const attribute=selector.slice(1,-1);return [...elements.values()].filter(element=>element.getAttribute(attribute)!=null);}};
  let context;
  const chrome={runtime:{id:'fixture',async sendMessage(message){
    messages.push(structuredClone(message));
    if(message.action==='list-pets')return libraryError?{error:libraryError}:{ok:true,pets:pets.map(({id,name,revision})=>({id,name,revision})),activePetId:state.pet?.id||null};
    if(message.action==='select-pet'){
      if(waitForSelect)await waitForSelect;
      if(selectError)return{error:selectError};
      const selected=pets.find(p=>p.id===message.petId);if(!selected)return{error:'未找到这只宠物，请重新接回。'};
      state.pet=structuredClone(selected);state.enabled=true;state.mode='look';state.focus=structuredClone(context.PetFocus.transition(state.focus,{type:'stop'}));
      for(const listener of listeners)listener({pet:{newValue:structuredClone(state.pet)}},'local');
      return{ok:true,pet:{id:state.pet.id,name:state.pet.name,revision:state.pet.revision}};
    }
    if(message.action==='focus-start'){
      if(waitForStart)await waitForStart;
      if(startError)return{error:startError};
      state.focus=structuredClone(context.PetFocus.transition(state.focus,{type:'start'}));state.enabled=true;
      for(const listener of listeners)listener({focus:{newValue:structuredClone(state.focus)}},'local');
    }
    if(message.action==='focus-preview'){
      if(previewError)return{error:previewError};
      state.focus=structuredClone(context.PetFocus.transition(state.focus,{type:'preview'}));state.enabled=true;
      for(const listener of listeners)listener({focus:{newValue:structuredClone(state.focus)}},'local');
    }
    if(message.action==='focus-stop'){
      if(stopError)return{error:stopError};
      state.focus=structuredClone(context.PetFocus.transition(state.focus,{type:'stop'}));
      for(const listener of listeners)listener({focus:{newValue:structuredClone(state.focus)}},'local');
    }
    return{ok:true,focus:structuredClone(state.focus)};
  }},tabs:{create(){}},storage:{onChanged:{addListener:listener=>listeners.push(listener)},local:{
    async get(){return structuredClone(state);},async set(values){writes.push(structuredClone(values));if(waitForWrite)await waitForWrite;if(writeError)throw new Error(writeError);Object.assign(state,structuredClone(values));for(const listener of listeners)listener(Object.fromEntries(Object.entries(values).map(([key,newValue])=>[key,{newValue}])),'local');}
  }}};
  context=vm.createContext({...configGlobals(),document,chrome,URL,crypto:{randomUUID:()=>`recall-${++serial}`},close(){closed++;},location:new URL('chrome-extension://fixture/popup.html'),navigator:{languages:['zh']},Image:class{async decode(){}},localStorage:{getItem(){return null;},setItem(){}},history:{replaceState(){}},setInterval(){},addEventListener(){}});
  for(const path of ['dist/extension/pet-i18n.js','dist/extension/pet-focus.js','dist/extension/pet-shortcuts.js','dist/extension/popup.js'])vm.runInContext(sources[path],context);
  await flush();await flush();
  const recall=elements.get('recall');
  async function clickRecall(){assert.ok(recall,'the popup provides an explicit recall button');for(const handler of recall.listeners.get('click')||[])await handler({target:recall});await flush();}
  async function selectPet(id){const select=elements.get('pet-select');assert.ok(select,'the popup provides a pet picker');select.value=id;for(const handler of select.listeners.get('change')||[])await handler({target:select});await flush();}
  async function click(id){const button=elements.get(id);for(const handler of button.listeners.get('click')||[])await handler({target:button});await flush();}
  return{state,elements,messages,writes,context,recall,clickRecall,selectPet,click,closed:()=>closed};
}

test('prominent timer starts without opening settings and a second click cannot restart a running timer',async()=>{
  const p=await popup();const button=p.elements.get('focus-quick-start');
  assert.equal(button.disabled,false);assert.equal(p.elements.get('focus-settings').open,undefined);
  await p.click('focus-quick-start');
  assert.equal(p.messages.filter(m=>m.action==='focus-start').length,1);assert.equal(p.state.focus.phase,'waiting');
  const dueAt=p.state.focus.dueAt;assert.equal(button.disabled,true);assert.equal(button.textContent,'计时中');assert.equal(p.elements.get('focus-quick-clock').textContent,'25:00');
  await p.click('focus-quick-start');assert.equal(p.state.focus.dueAt,dueAt);assert.equal(p.messages.filter(m=>m.action==='focus-start').length,1);
  assert.equal(p.elements.get('focus-settings').open,undefined);assert.equal(p.closed(),0);
  await p.click('focus-start');assert.equal(p.messages.filter(m=>m.action==='focus-start').length,2,'explicit restart remains in the original settings');
});

test('successful Try it now closes the popup so the focused webpage can show the reminder',async()=>{
  const p=await popup();await p.click('focus-preview');
  assert.equal(p.state.focus.phase,'mischief');assert.equal(p.messages.filter(m=>m.action==='focus-preview').length,1);
  assert.equal(p.closed(),1,'the preview must return focus to the webpage');
  assert.equal(p.elements.get('focus-settings').open,undefined);
});

test('failed Try it now keeps the popup open with a retryable error',async()=>{
  const p=await popup({previewError:'定时连接失败，请重新打开插件。'});await p.click('focus-preview');
  assert.equal(p.state.focus.phase,'quiet');assert.equal(p.closed(),0);
  assert.equal(p.elements.get('focus-quick-status').hidden,false);assert.equal(p.elements.get('focus-controls').disabled,false);
});

test('quick timer blocks overlapping starts, restores controls after failure, and requires an adopted pet',async()=>{
  let resolve;const waiting=new Promise(r=>resolve=r),p=await popup({waitForStart:waiting});
  const first=p.click('focus-quick-start');await flush();
  assert.equal(p.elements.get('focus-quick-start').disabled,true);assert.equal(p.elements.get('focus-controls').disabled,true);assert.equal(p.elements.get('pet-select').disabled,true);
  await p.click('focus-quick-start');resolve();await first;assert.equal(p.messages.filter(m=>m.action==='focus-start').length,1);
  const failed=await popup({startError:'定时连接失败，请重新打开插件。'});await failed.click('focus-quick-start');
  assert.equal(failed.elements.get('focus-quick-start').disabled,false);assert.equal(failed.elements.get('focus-quick-status').hidden,false);assert.equal(failed.state.focus.phase,'quiet');
  const empty=await popup({store:{enabled:true}});assert.equal(empty.elements.get('focus-quick-start').disabled,true);await empty.click('focus-quick-start');assert.equal(empty.messages.some(m=>m.action==='focus-start'),false);
});

test('Stop following is exposed beside recall only while the adopted pet is in Follow',async()=>{
  const html=sources['dist/extension/popup.html'];assert.match(html,/id="stop-follow"[^>]*data-pet-i18n="停止跟随"/);
  assert.ok(html.indexOf('id="stop-follow"')<html.indexOf('id="controls"'),'stop is outside collapsed controls');
  const following=await popup();assert.equal(following.elements.get('stop-follow').hidden,false);assert.equal(following.elements.get('stop-follow').disabled,false);
  for(const mode of ['auto','look','sleep']){
    const p=await popup({store:{pet,mode,enabled:true,focus:quiet}});assert.equal(p.elements.get('stop-follow').hidden,true);await p.click('stop-follow');assert.deepEqual(p.writes,[]);
  }
  const empty=await popup({store:{mode:'follow',enabled:true}});assert.equal(empty.elements.get('stop-follow').hidden,true);assert.equal(empty.elements.get('stop-follow').disabled,true);
});

test('Stop following writes only Watch and preserves the pet, timer, visibility and position settings',async()=>{
  const store={pet,enabled:false,mode:'follow',size:180,focus:{phase:'waiting',dueAt:Date.now()+60_000,quietUntil:0,cycle:1},recallToken:'previous-recall',position:{x:200,y:300}};
  const p=await popup({store}),before=structuredClone(p.state),messageCount=p.messages.length;
  await p.click('stop-follow');
  assert.deepEqual(p.writes,[{mode:'look'}]);assert.deepEqual(p.state,{...before,mode:'look'});
  assert.equal(p.elements.get('mode').value,'look');assert.equal(p.elements.get('stop-follow').hidden,true);assert.equal(p.closed(),0);
  assert.ok(p.messages.slice(messageCount).every(message=>message.action==='list-pets'),'stopping Follow must not reset the timer or recall the pet');
});

test('Stop following prevents duplicate writes and conflicting pet or timer actions until saving settles',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;}),p=await popup({pets:[pet,otherPet],waitForWrite:gate});
  const first=p.click('stop-follow');await flush();
  for(const id of ['stop-follow','recall','controls','focus-controls','focus-quick-start','pet-select'])assert.equal(p.elements.get(id).disabled,true,id);
  await p.click('stop-follow');await p.click('focus-quick-start');await p.selectPet(otherPet.id);await p.clickRecall();
  assert.deepEqual(p.writes,[{mode:'look'}]);assert.ok(!p.messages.some(message=>['focus-start','focus-stop','select-pet'].includes(message.action)));
  release();await first;assert.equal(p.state.mode,'look');assert.equal(p.state.pet.id,pet.id);assert.equal(p.elements.get('stop-follow').hidden,true);assert.equal(p.elements.get('recall').disabled,false);
});

test('a failed Stop following save keeps Follow active and presents a retryable error',async()=>{
  const p=await popup({writeError:'停止跟随失败，请重试。'}),before=structuredClone(p.state);
  await p.click('stop-follow');assert.deepEqual(p.state,before);assert.equal(p.elements.get('mode').value,'follow');assert.equal(p.elements.get('stop-follow').hidden,false);assert.equal(p.elements.get('stop-follow').disabled,false);
  assert.equal(p.elements.get('status').textContent,'停止跟随失败，请重试。');assert.equal(p.closed(),0);
});

test('Stop following waits for pet selection or timer requests but does not interfere with their result',async()=>{
  for(const operation of ['select','timer']){
    let release;const gate=new Promise(resolve=>{release=resolve;}),p=await popup({pets:[pet,otherPet],...(operation==='select'?{waitForSelect:gate}:{waitForStart:gate})});
    const pending=operation==='select'?p.selectPet(otherPet.id):p.click('focus-quick-start');await flush();
    assert.equal(p.elements.get('stop-follow').disabled,true);await p.click('stop-follow');assert.deepEqual(p.writes,[]);
    release();await pending;
    assert.equal(p.state.mode,operation==='select'?'look':'follow');assert.equal(p.elements.get('stop-follow').hidden,operation==='select');assert.equal(p.elements.get('stop-follow').disabled,false);
  }
});

test('Stop following and its Escape hint are available in all popup languages',async()=>{
  const hint='跟随时长按抓住，松开看鼠标；也可按住 Alt 拖动。Esc 停止跟随。';
  assert.ok(sources['dist/extension/popup.html'].includes(`data-pet-i18n="${hint}"`));
  const p=await popup();
  for(const locale of ['en','es','ja']){
    p.context.PetI18n.setLocale(locale,{persist:false,updateURL:false});
    assert.equal(p.context.PetI18n.t('停止'),{en:'Stop',es:'Detener',ja:'停止'}[locale]);
    for(const key of ['停止跟随','Esc 停止跟随','跟随中 · Esc 停止跟随','停止跟随失败，请重试。',hint])assert.notEqual(p.context.PetI18n.t(key),key,`${locale}: ${key}`);
  }
});

test('shortcut overview shows saved bindings and Edit opens the original settings',async()=>{
  const p=await popup(),hint=p.elements.get('shortcut-hint-follow'),input=p.elements.get('shortcut-follow');
  assert.equal(hint.textContent,'Alt + Shift + 3');
  for(const handler of input.listeners.get('keydown')||[])handler({key:'G',code:'KeyG',altKey:true,shiftKey:true,preventDefault(){},stopPropagation(){}});
  assert.equal(input.value,'Alt + Shift + G');assert.equal(hint.textContent,'Alt + Shift + 3','unsaved draft is not advertised as active');
  await p.click('shortcut-save');assert.equal(hint.textContent,'Alt + Shift + G');
  await p.click('edit-shortcuts');assert.equal(p.elements.get('shortcut-settings').open,true);assert.equal(p.elements.get('focus-settings').open,undefined);
});

test('quiet pet can be recalled from the main popup without reopening its timer section',async()=>{
  const html=sources['dist/extension/popup.html'];assert.ok(html.indexOf('id="recall"')>=0&&html.indexOf('id="recall"')<html.indexOf('id="controls"'),'recall is visible outside collapsed settings');
  const p=await popup();assert.equal(p.recall.hidden,false);assert.equal(p.recall.disabled,false);
  await p.clickRecall();
  assert.ok(p.messages.some(message=>message.action==='focus-stop'));
  assert.deepEqual(p.writes.at(-1),{enabled:true,mode:'look',recallToken:'recall-1'});assert.equal(p.closed(),1);
  assert.equal(p.state.focus.phase,'off');assert.equal(p.state.focus.quietUntil,0);assert.equal(p.state.focus.dueAt,0);
  assert.equal(p.state.enabled,true);assert.equal(p.state.mode,'look');assert.deepEqual(p.state.pet,pet);
  assert.equal(p.recall.hidden,false,'recall stays available even while the pet is already visible');
});

test('recall also re-enables a pet hidden with Show on web pages',async()=>{
  const p=await popup({store:{pet,enabled:false,mode:'sleep',focus:{phase:'off',dueAt:0,quietUntil:0,cycle:0}}});
  assert.equal(p.recall.hidden,false);await p.clickRecall();
  assert.equal(p.state.enabled,true);assert.equal(p.state.mode,'look');assert.equal(p.state.focus.phase,'off');assert.equal(p.recall.hidden,false);
});

test('recall remains visible for every companion state and is disabled before importing a pet',async()=>{
  const active=await popup({store:{pet,enabled:true,focus:{phase:'off',dueAt:0,quietUntil:0,cycle:0}}});assert.equal(active.recall.hidden,false);assert.equal(active.recall.disabled,false);
  const empty=await popup({store:{enabled:true,focus:quiet}});assert.equal(empty.recall.hidden,false);assert.equal(empty.recall.disabled,true);
});

test('a failed stop keeps quiet state and does not enable or change the pet mode',async()=>{
  const p=await popup({stopError:'Failed to fetch'});await p.clickRecall();
  assert.equal(p.state.focus.phase,'quiet');assert.equal(p.state.mode,'follow');assert.deepEqual(p.writes,[]);
  assert.equal(p.recall.disabled,false);assert.equal(p.recall.hidden,false);assert.equal(p.closed(),0);
  assert.equal(p.elements.get('status').textContent,p.context.PetI18n.error('Failed to fetch','召唤失败，请重新打开插件再试。'),'failure replaces the normal status with a localized error');
});

test('recall label is available in all supported languages',async()=>{
  assert.match(sources['dist/extension/popup.html'],/id="recall"[^>]*data-pet-i18n="召唤回来"/);
  const p=await popup(),labels=[];
  for(const locale of ['zh','en','es','ja']){p.context.PetI18n.setLocale(locale,{persist:false,updateURL:false});const label=p.context.PetI18n.t('召唤回来');assert.ok(label);if(locale!=='zh')assert.notEqual(label,'召唤回来');labels.push(label);}
  assert.equal(new Set(labels).size,4);
});


test('each recall issues a fresh token so an already-visible pet can be found again',async()=>{
  const p=await popup({store:{pet,enabled:true,mode:'look',focus:{phase:'off',dueAt:0,quietUntil:0,cycle:0}}});
  await p.clickRecall();await p.clickRecall();
  assert.deepEqual(p.writes.map(write=>write.recallToken),['recall-1','recall-2']);assert.equal(p.closed(),2);assert.deepEqual(p.state.pet,pet);
});

test('popup lists saved pet names and switches without discarding the current popup or writing pet images',async()=>{
  const p=await popup({pets:[pet,otherPet]});
  const select=p.elements.get('pet-select');assert.ok(select);assert.equal(p.elements.get('pet-switcher').hidden,false);
  assert.deepEqual(select.children.map(option=>[option.value,option.textContent]),[[pet.id,pet.name],[otherPet.id,otherPet.name]]);
  assert.equal(select.value,pet.id);await p.selectPet(otherPet.id);
  assert.equal(p.state.pet.id,otherPet.id);assert.equal(p.elements.get('pet-name').textContent,otherPet.name);assert.equal(select.value,otherPet.id);
  assert.equal(p.state.focus.phase,'off');assert.equal(p.state.mode,'look');assert.deepEqual(p.writes,[]);assert.equal(p.closed(),0);
  assert.deepEqual(p.messages.filter(m=>m.action==='select-pet'),[{action:'select-pet',petId:otherPet.id}]);
});

test('pet switching disables conflicting controls until selection settles and leaves the current pet when it fails',async()=>{
  let release;const waitForSelect=new Promise(resolve=>{release=resolve;});
  const p=await popup({pets:[pet,otherPet],selectError:'切换宠物失败，请重试。',waitForSelect});
  const selected=p.selectPet(otherPet.id);await flush();
  for(const id of ['pet-select','controls','focus-controls','recall','open','language','shortcut-save'])assert.equal(p.elements.get(id).disabled,true,id);
  assert.equal(p.elements.get('pet-switch-status').textContent,'正在切换宠物…');
  release();await selected;
  assert.equal(p.state.pet.id,pet.id);assert.equal(p.state.mode,'follow');assert.equal(p.state.focus.phase,'quiet');
  assert.equal(p.elements.get('pet-select').value,pet.id);assert.equal(p.elements.get('pet-switch-status').textContent,'切换宠物失败，请重试。');
  for(const id of ['pet-select','controls','focus-controls','recall','open','language','shortcut-save'])assert.equal(p.elements.get(id).disabled,false,id);
  assert.deepEqual(p.writes,[]);assert.equal(p.closed(),0);
});

test('selecting the current pet does not reset its mode or timer, and no pet means no empty picker',async()=>{
  const p=await popup({pets:[pet,otherPet]});await p.selectPet(pet.id);
  assert.equal(p.messages.some(m=>m.action==='select-pet'),false);assert.equal(p.state.mode,'follow');assert.equal(p.state.focus.phase,'quiet');
  const empty=await popup({store:{enabled:true},pets:[]});assert.equal(empty.elements.get('pet-switcher').hidden,true);assert.equal(empty.elements.get('recall').disabled,true);
});

test('a failed library lookup preserves the current pet and all picker messages are localized',async()=>{
  const p=await popup({libraryError:'无法读取宠物列表，请重新打开插件。'});
  assert.equal(p.state.pet.id,pet.id);assert.equal(p.elements.get('pet-select').value,pet.id);
  assert.equal(p.elements.get('pet-switch-status').textContent,'无法读取宠物列表，请重新打开插件。');
  for(const locale of ['en','es','ja']){
    p.context.PetI18n.setLocale(locale,{persist:false,updateURL:false});
    for(const source of ['我的宠物','正在切换宠物…','切换宠物失败，请重试。','无法读取宠物列表，请重新打开插件。'])assert.notEqual(p.context.PetI18n.t(source),source,`${locale}: ${source}`);
  }
});

test('pets with the same nickname get distinct option labels without changing their saved names',async()=>{
  const sameName={...otherPet,name:pet.name};
  const p=await popup({pets:[pet,sameName]});
  assert.deepEqual(p.elements.get('pet-select').children.map(option=>option.textContent),[`${pet.name} · ${pet.id.slice(-6)}`,`${pet.name} · ${otherPet.id.slice(-6)}`]);
  await p.selectPet(sameName.id);assert.equal(p.state.pet.name,pet.name);assert.equal(p.elements.get('pet-name').textContent,pet.name);
});
