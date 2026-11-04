importScripts('site-config.js','pet-i18n.js','pet-focus.js','pet-shortcuts.js','pet-library.js');
const BASE = globalThis.PawPlusMeConfig.siteOrigin;
const LOCALES=['zh','en','es','ja'];
const preferredLocale=value=>LOCALES.includes(value)?value:globalThis.PetI18n?.getLocale()||'zh';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FOCUS_ALARM='pet-focus-reminder';
let focusQueue=Promise.resolve();
function updateFocus(type='tick',cycle){
  focusQueue=focusQueue.catch(()=>{}).then(async()=>{
    const {focus,pet,enabled=true}=await chrome.storage.local.get(['focus','pet','enabled']);
    if(['start','preview'].includes(type)&&!pet)throw new Error('请先导入一只宠物，再开启定时。');
    const next=PetFocus.transition(focus,{type:!enabled&&!['start','preview'].includes(type)?'stop':type,cycle});
    if(JSON.stringify(next)!==JSON.stringify(focus))await chrome.storage.local.set({focus:next});
    if(['start','preview'].includes(type)&&!enabled)await chrome.storage.local.set({enabled:true});
    const when=PetFocus.deadline(next);
    if(when){const alarm=await chrome.alarms.get(FOCUS_ALARM);if(!alarm||Math.abs(alarm.scheduledTime-when)>100)await chrome.alarms.create(FOCUS_ALARM,{when});}
    else await chrome.alarms.clear(FOCUS_ALARM);
    return {ok:true,focus:next};
  });
  return focusQueue;
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!message?.action?.startsWith('focus-'))return;
  const type=message.action.slice(6);
  const allowed=['get','start','preview','catch','later25','later50','today','stop'];
  let fromPage=false;try{fromPage=!!sender.tab&&['http:','https:'].includes(new URL(sender.url).protocol);}catch{}
  if(!allowed.includes(type)||sender.url!==chrome.runtime.getURL('popup.html')&&!fromPage){respond({error:'此定时操作来源不允许。'});return;}
  updateFocus(type==='get'?'tick':type,message.cycle).then(respond).catch(error=>respond({error:error.message}));return true;
});
const restoreFocus=()=>updateFocus().catch(error=>console.warn('宠物定时恢复失败：',error.message));
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===FOCUS_ALARM)restoreFocus();});
chrome.runtime.onStartup.addListener(restoreFocus);chrome.runtime.onInstalled.addListener(restoreFocus);
chrome.runtime.onInstalled.addListener(async details=>{
  if(details?.reason==='install'){
    const {locale}=await chrome.storage.local.get(['locale']);
    const url=new URL('/',BASE);url.searchParams.set('welcome','1');url.searchParams.set('lang',preferredLocale(locale));
    for(const [key,value] of Object.entries(globalThis.PawPlusMeConfig.campaign))url.searchParams.set(key,value);
    url.hash='bring-home';chrome.tabs.create({url:url.href});
  }
});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.enabled?.newValue===false)updateFocus('stop').catch(()=>{});});
restoreFocus();

function readRunDirections(manifest){
  if(!Object.hasOwn(manifest,'runDirections'))return null;
  const directions=['e','se','s','sw','w','nw','n','ne'],source=manifest.runDirections,result={};
  if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).length!==directions.length||Object.keys(source).some(name=>!directions.includes(name)))throw new Error('动作列表无效。');
  for(const name of directions){
    if(!Object.hasOwn(source,name))throw new Error('动作列表无效。');
    const entry=source[name],frames=entry?.frames;
    if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.keys(entry).length!==2||Object.keys(entry).some(key=>!['frames','flip'].includes(key))||typeof entry.flip!=='boolean'||!Array.isArray(frames)||frames.length<2||frames.length>96||frames.some(frame=>!Number.isInteger(frame)||frame<0||frame>=manifest.columns*manifest.rows))throw new Error('动作列表无效。');
    result[name]={frames:[...frames],flip:entry.flip};
  }
  return result;
}

function petIdentity(pet){
  return pet?{id:pet.id,name:pet.name||'小伴',revision:pet.revision||''}:null;
}
async function companionStatus(){
  const {pet,enabled=true,locale,shortcuts,petSelectionToken}=await chrome.storage.local.get(['pet','enabled','locale','shortcuts','petSelectionToken']);
  return {ok:true,protocol:1,version:chrome.runtime.getManifest?.().version||'0.4.0',pet:petIdentity(pet),enabled,locale:preferredLocale(locale),shortcuts:PetShortcuts.normalize(shortcuts),...(typeof petSelectionToken==='string'&&petSelectionToken.length>0&&petSelectionToken.length<=128?{petSelectionToken}:{})};
}
async function rememberCurrentPet(){
  const {pet}=await chrome.storage.local.get(['pet']);
  const saved=await PetLibrary.list();
  // The existing active cache is migrated once; newer saved revisions must not be rolled back.
  if(pet?.id&&typeof pet.image==='string'&&!saved.some(value=>value.id===pet.id))await PetLibrary.put(pet);
  return pet;
}
async function writeActivePet(values){
  try{await chrome.storage.local.set(values);}
  catch{throw new Error('宠物暂时无法保存，请检查浏览器存储空间后重试。');}
}
function selectSavedPet(pet){
  // Serialize timer state with its other handlers and publish one active-pet change.
  focusQueue=focusQueue.catch(()=>{}).then(async()=>{
    const {focus}=await chrome.storage.local.get(['focus']);
    await writeActivePet({pet,enabled:true,mode:'look',focus:PetFocus.transition(focus,{type:'stop'}),petSelectionToken:crypto.randomUUID()});
    try{await chrome.alarms.clear(FOCUS_ALARM);}catch(error){console.warn('宠物定时恢复失败：',error.message);}
    return companionStatus();
  });
  return focusQueue;
}
let adoptionQueue=Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['companion-status','adopt','adopt-latest','set-language','set-mode','list-pets','select-pet'].includes(message?.action)) return;
  const fromPopup = sender.url === chrome.runtime.getURL('popup.html');
  let fromDemo = false;
  try { fromDemo = new URL(sender.url).origin === BASE; } catch {}
  if (!fromPopup && !fromDemo) { respond({ error: '只允许从PawPlusMe生成页或插件操作。' }); return; }
  if(['list-pets','select-pet'].includes(message.action)&&!fromPopup){respond({error:'此操作只允许从插件弹窗发起。'});return;}
  if(message.action==='companion-status'){
    companionStatus().then(respond).catch(()=>respond({error:'暂时无法读取宠物，请重新打开插件。'}));return true;
  }
  adoptionQueue=adoptionQueue.catch(()=>{}).then(async () => {
    if(message.action==='list-pets'){
      const pet=await rememberCurrentPet();
      return {ok:true,pets:await PetLibrary.list(),activePetId:pet?.id||null};
    }
    if(message.action==='select-pet'){
      if(!UUID.test(message.petId))throw new Error('宠物编号无效。');
      const current=await rememberCurrentPet();
      if(current?.id===message.petId)return companionStatus();
      const pet=await PetLibrary.get(message.petId);
      if(!pet||pet.id!==message.petId||typeof pet.image!=='string')throw new Error('这只宠物尚未保存在插件里，请先从网站接回。');
      return selectSavedPet(pet);
    }
    if(message.locale!=null&&!LOCALES.includes(message.locale))throw new Error('语言设置无效。');
    if(message.action==='set-language'){
      if(!LOCALES.includes(message.locale))throw new Error('语言设置无效。');
      await chrome.storage.local.set({locale:message.locale});
      return companionStatus();
    }
    if(message.action==='set-mode'){
      if(!PetShortcuts.actions.includes(message.mode))throw new Error('互动模式无效。');
      await chrome.storage.local.set({mode:message.mode});return companionStatus();
    }
    let id = message.petId;
    const cloud=BASE.startsWith('https:')||!!message.claimToken;
    if(cloud&&(!fromDemo||!message.claimToken))throw new Error('请从生成页接回这只宠物。');
    const downloadOptions=cloud?{headers:{Authorization:`Bearer ${message.claimToken}`},credentials:'omit',redirect:'error'}:{};
    if (message.action === 'adopt-latest') {
      if (!fromPopup) throw new Error('此操作只允许从插件弹窗发起。');
      const response = await fetch(`${BASE}/api/latest`);
      if (!response.ok) throw new Error('无法读取本地 Demo。');
      id = (await response.json()).pet?.id;
      if (!id) throw new Error('请先打开 Demo 生成一只宠物。');
    }
    if (!UUID.test(id)) throw new Error('宠物编号无效。');
    const response = await fetch(`${BASE}/pets/${id}/pet.json`,downloadOptions);
    if (!response.ok) throw new Error('宠物还没准备好，请在生成完成后再导入。');
    const manifest = await response.json();
    const supportedGrid=manifest.schemaVersion===3?manifest.columns===16&&manifest.rows<=48:[4,8].includes(manifest.columns)&&manifest.rows<=60;
    if (!supportedGrid || !Number.isInteger(manifest.rows) || manifest.rows<1 || manifest.cellSize !== 192 || manifest.id !== id) throw new Error('宠物动作格式不受支持。');
    for (const name of ['look','run','sleep','peek']) {
      const frames = manifest.animations?.[name];
      if (!Array.isArray(frames) || frames.length<(name==='look'?8:1)||frames.length>96 || frames.some(n => !Number.isInteger(n) || n < 0 || n >=manifest.columns*manifest.rows)) throw new Error('动作列表无效。');
    }
    if(manifest.gaze&&(!manifest.gaze.anchor||!['x','y'].every(axis=>Number.isFinite(manifest.gaze.anchor[axis])&&manifest.gaze.anchor[axis]>=0&&manifest.gaze.anchor[axis]<=1)))throw new Error('动作列表无效。');
    const gazeAngles=manifest.gaze?.angles;
    if(gazeAngles&&(!Array.isArray(gazeAngles)||gazeAngles.length!==manifest.animations.look.length||gazeAngles.some((angle,i)=>!Number.isFinite(angle)||angle<0||angle>=Math.PI*2||i>0&&angle<=gazeAngles[i-1])))throw new Error('动作列表无效。');
    const runDirections=readRunDirections(manifest);
    if(manifest.motionProfile==='full-96-eight-way-v1'||manifest.requiredMotionFrames===96||manifest.requiredRunDirections===8){
      if(manifest.schemaVersion!==3||manifest.columns!==16||manifest.rows!==48||['look','run','sleep','peek'].some(name=>manifest.animations[name].length!==96||manifest.fps?.[name]!==24)||!runDirections||Object.values(runDirections).some(entry=>entry.frames.length!==96))throw new Error('动作列表无效。');
    }
    const imageResponse = await fetch(`${BASE}/pets/${id}/${['continuous-video','partial-video'].includes(manifest.motion)?'motion':'sheet'}.png`,downloadOptions);
    if (!imageResponse.ok || imageResponse.headers.get('content-type') !== 'image/png') throw new Error('动作 PNG 下载失败。');
    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    if (bytes.length > 6 * 1024 * 1024) throw new Error('动作 PNG 太大。');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    const name=Array.from((typeof message.name==='string'?message.name:manifest.name||'小伴').trim()).slice(0,24).join('')||'小伴';
    const pet = { id, name, revision:manifest.updatedAt||manifest.createdAt||'', columns:manifest.columns, rows:manifest.rows, cellSize:192, animations:manifest.animations, motion:manifest.motion, fps:manifest.fps, peek:manifest.peek, style:manifest.style,...(manifest.gaze?{gaze:manifest.gaze}:{}),...(runDirections?{runDirections}:{}), image:`data:image/png;base64,${btoa(binary)}` };
    const {mode='auto',size=144,locale}=await chrome.storage.local.get(['mode','size','locale']);
    await rememberCurrentPet();await PetLibrary.put(pet);
    await writeActivePet({ pet, enabled: true, mode, size, locale:preferredLocale(message.locale||locale) });
    await updateFocus('stop');
    return companionStatus();
  });
  adoptionQueue.then(respond).catch(error => respond({ error: error.message === 'Failed to fetch' ? '本地服务暂时连不上。启动后可继续接回，不用重新生成。' : error.message }));
  return true;
});
