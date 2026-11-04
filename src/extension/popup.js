const $ = id => document.getElementById(id);
const t=(source,params={})=>globalThis.PetI18n?.t(source,params)??source.replace(/\{(\w+)\}/g,(match,key)=>params[key]??match);
const errorText=(raw,fallback)=>globalThis.PetI18n?.error(raw,fallback)||raw||t(fallback);
let popupFocus=PetFocus.empty();
let currentPet,avatarRevision,shortcutDraft=PetShortcuts.defaults(),shortcutDirty=false;
let savedPets=[],switchingPet=false,switchError='',libraryError='',refreshGeneration=0;
let savedShortcuts=PetShortcuts.defaults(),focusBusy=false,stoppingFollow=false,currentMode='auto';
function renderPetSwitchStatus(){
  const message=switchingPet?t('正在切换宠物…'):switchError?errorText(switchError,'切换宠物失败，请重试。'):libraryError?errorText(libraryError,'无法读取宠物列表，请重新打开插件。'):'';
  $('pet-switch-status').textContent=message;$('pet-switch-status').hidden=!message;
}
function syncPetControls(){
  const busy=switchingPet||focusBusy||stoppingFollow;
  $('controls').disabled=$('recall').disabled=$('stop-follow').disabled=busy||!currentPet;
  $('stop-follow').hidden=!currentPet||currentMode!=='follow';
  $('focus-controls').disabled=busy||!currentPet;
  $('focus-quick-start').disabled=busy||!currentPet||popupFocus.phase==='waiting';
  $('pet-select').disabled=busy||!savedPets.length;
  for(const id of ['open','language','edit-shortcuts','shortcut-save','shortcut-reset',...PetShortcuts.actions.map(action=>`shortcut-${action}`)])$(id).disabled=busy;
}
function renderPetPicker(library){
  const items=Array.isArray(library?.pets)?library.pets:[];
  savedPets=[...new Map(items.filter(pet=>pet&&typeof pet.id==='string'&&pet.id).map(pet=>[pet.id,pet])).values()];
  if(currentPet&&!savedPets.some(pet=>pet.id===currentPet.id))savedPets.unshift(currentPet);
  const names=new Map();for(const pet of savedPets){const name=pet.name||'小伴';names.set(name,(names.get(name)||0)+1);}
  const options=savedPets.map(pet=>{const option=document.createElement('option'),name=pet.name||'小伴';option.value=pet.id;option.textContent=names.get(name)>1?`${name} · ${pet.id.slice(-6)}`:name;return option;});
  $('pet-select').replaceChildren(...options);$('pet-select').value=currentPet?.id||'';
  $('pet-switcher').hidden=!savedPets.length;renderPetSwitchStatus();syncPetControls();
}
$('pet-select').addEventListener('change',async event=>{
  const petId=event.target.value;
  if(switchingPet||focusBusy||stoppingFollow||!petId||petId===currentPet?.id){event.target.value=currentPet?.id||'';return;}
  switchingPet=true;switchError='';renderPetSwitchStatus();syncPetControls();
  try{
    const response=await chrome.runtime.sendMessage({action:'select-pet',petId});
    if(!response?.ok||response.error)throw new Error(response?.error||'切换宠物失败，请重试。');
    await refresh();
  }catch(error){switchError=error.message||'切换宠物失败，请重试。';event.target.value=currentPet?.id||'';}
  finally{switchingPet=false;renderPetSwitchStatus();syncPetControls();}
});
function renderShortcuts(){for(const action of PetShortcuts.actions){const input=$(`shortcut-${action}`);input.value=PetShortcuts.format(shortcutDraft[action])||t('未设置');$(`shortcut-hint-${action}`).textContent=PetShortcuts.format(savedShortcuts[action])||t('未设置');}}
$('edit-shortcuts').addEventListener('click',()=>{$('shortcut-settings').open=true;$('shortcut-auto').focus();});
for(const action of PetShortcuts.actions){
  const input=$(`shortcut-${action}`);
  input.addEventListener('focus',()=>{$('shortcut-status').textContent=t('请按下新的组合键。');});
  input.addEventListener('keydown',event=>{
    if(event.key==='Tab')return;
    event.preventDefault();event.stopPropagation();
    if(event.key==='Escape'){input.blur();$('shortcut-status').textContent='';return;}
    if(['Backspace','Delete'].includes(event.key)){shortcutDraft[action]=null;shortcutDirty=true;renderShortcuts();$('shortcut-status').textContent=t('尚未保存');return;}
    const candidate={code:event.code,alt:!!event.altKey,shift:!!event.shiftKey,ctrl:!!event.ctrlKey,meta:!!event.metaKey};
    if(!/^(Key[A-Z]|Digit[0-9])$/.test(candidate.code))return;
    const problem=PetShortcuts.validate({...shortcutDraft,[action]:candidate});
    if(problem){$('shortcut-status').textContent=t(problem);return;}
    shortcutDraft[action]=candidate;shortcutDirty=true;renderShortcuts();$('shortcut-status').textContent=t('尚未保存');
  });
}
$('shortcut-reset').addEventListener('click',()=>{shortcutDraft=PetShortcuts.defaults();shortcutDirty=true;renderShortcuts();$('shortcut-status').textContent=t('尚未保存');});
$('shortcut-save').addEventListener('click',async()=>{
  const problem=PetShortcuts.validate(shortcutDraft);if(problem){$('shortcut-status').textContent=t(problem);return;}
  try{await chrome.storage.local.set({shortcuts:PetShortcuts.normalize(shortcutDraft)});shortcutDirty=false;$('shortcut-status').textContent=t('快捷键已保存');}
  catch{$('shortcut-status').textContent=t('保存失败，请重试。');}
});
function renderFocus(){
  $('focus-clock').textContent=PetFocus.clock(popupFocus);$('focus-status').textContent=PetFocus.message(popupFocus);
  $('focus-start').textContent=t(popupFocus.phase==='off'?'25 分钟后再来找我':'重新开始 25 分钟');$('focus-stop').hidden=popupFocus.phase==='off';
  $('focus-quick-clock').textContent=PetFocus.clock(popupFocus);$('focus-quick-start').textContent=t(popupFocus.phase==='waiting'?'计时中':'开始');
  syncPetControls();
}
async function refresh() {
  const generation=++refreshGeneration;
  const [stored,library]=await Promise.all([
    chrome.storage.local.get(['pet','enabled','mode','size','focus','locale','shortcuts']),
    chrome.runtime.sendMessage({action:'list-pets'}).catch(error=>({error:error?.message||'无法读取宠物列表，请重新打开插件。'}))
  ]);
  if(generation!==refreshGeneration)return;
  const { pet, enabled = true, mode = 'auto', size = 144,focus,locale,shortcuts }=stored;
  if(['zh','en','es','ja'].includes(locale))globalThis.PetI18n?.setLocale(locale,{persist:false,updateURL:false});
  $('language').value=globalThis.PetI18n?.getLocale()||'zh';
  savedShortcuts=PetShortcuts.normalize(shortcuts);if(!shortcutDirty)shortcutDraft=PetShortcuts.normalize(shortcuts);renderShortcuts();
  currentPet=pet;currentMode=mode;
  libraryError=library?.error||(!Array.isArray(library?.pets)?'无法读取宠物列表，请重新打开插件。':'');
  renderPetPicker(library);
  popupFocus=focus||PetFocus.empty();renderFocus();
  const name=pet?.name||'小伴';
  $('status').textContent = pet ? t(enabled?'{name}已住进浏览器。打开或刷新普通网页，就能见到它。':'{name}正在休息，打开下方“在网页上显示”就能叫它回来。',{name}) : t('先在网站认识它。生成后点“接它回浏览器”，它就会住在这里。');
  $('pet-identity').hidden=!pet;$('pet-name').textContent=name;
  $('recall').hidden=false;
  $('open').textContent=t('创建新宠物');
  $('return-hint').textContent=t('上传一张照片，制作新的小伙伴。');
  const revision=pet?`${pet.id}:${pet.revision||''}:${pet.image?.length}`:'';
  if(pet&&revision!==avatarRevision){
    const image=new Image();image.src=pet.image;
    try{
      await image.decode();
      if(generation!==refreshGeneration||currentPet!==pet)return;
      const frame=pet.animations.look[0],canvas=$('pet-avatar'),context=canvas.getContext('2d');
      context.clearRect(0,0,96,96);
      context.drawImage(image,(frame%pet.columns)*pet.cellSize,Math.floor(frame/pet.columns)*pet.cellSize,pet.cellSize,pet.cellSize,0,0,96,96);
      avatarRevision=revision;
    }catch{}
  }
  $('pet-avatar').setAttribute('aria-label',t('{name}的头像',{name}));
  $('enabled').checked = enabled; $('mode').value = mode; $('size').value = size;syncPetControls();
}
$('open').addEventListener('click', () => {
  const url=new URL('/',globalThis.PawPlusMeConfig.siteOrigin);url.searchParams.set('from','extension');url.searchParams.set('create','1');url.searchParams.set('lang',globalThis.PetI18n?.getLocale()||'zh');
  for(const [key,value] of Object.entries(globalThis.PawPlusMeConfig.campaign))url.searchParams.set(key,value);
  chrome.tabs.create({url:url.href});
});
for (const key of ['enabled','mode','size']) $(key).addEventListener('change', e => chrome.storage.local.set({ [key]: key === 'enabled' ? e.target.checked : key === 'size' ? Number(e.target.value) : e.target.value }));
$('recall').addEventListener('click',async e=>{
  if(switchingPet||focusBusy||stoppingFollow||!currentPet)return;
  e.target.disabled=true;
  try{
    const response=await chrome.runtime.sendMessage({action:'focus-stop'});if(response.error)throw new Error(response.error);
    await chrome.storage.local.set({enabled:true,mode:'look',recallToken:crypto.randomUUID()});await refresh();globalThis.close?.();
  }catch(error){$('status').textContent=errorText(error.message,'召唤失败，请重新打开插件再试。');}
  finally{syncPetControls();}
});
$('stop-follow').addEventListener('click',async()=>{
  if(stoppingFollow||switchingPet||focusBusy||!currentPet||currentMode!=='follow')return;
  stoppingFollow=true;syncPetControls();
  try{await chrome.storage.local.set({mode:'look'});await refresh();}
  catch(error){$('status').textContent=errorText(error.message,'停止跟随失败，请重试。');}
  finally{stoppingFollow=false;syncPetControls();}
});
async function runFocus(type,{quick=false}={}){
  if(focusBusy||switchingPet||stoppingFollow||!currentPet||quick&&popupFocus.phase==='waiting')return;
  focusBusy=true;$('focus-quick-status').hidden=true;syncPetControls();
  try{const response=await chrome.runtime.sendMessage({action:`focus-${type}`});if(!response?.ok||response.error)throw new Error(response?.error||'定时连接失败，请重新打开插件。');await refresh();if(type==='preview')globalThis.close?.();}
  catch(error){const message=errorText(error.message,'定时连接失败，请重新打开插件。');$('focus-status').textContent=message;$('focus-quick-status').textContent=message;$('focus-quick-status').hidden=false;}
  finally{focusBusy=false;syncPetControls();}
}
for(const type of ['start','preview','stop'])$(`focus-${type}`).addEventListener('click',()=>runFocus(type));
$('focus-quick-start').addEventListener('click',()=>runFocus('start',{quick:true}));
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local')refresh();});
globalThis.addEventListener?.('pet-language-change',()=>{
  renderFocus();
  chrome.storage.local.set({locale:PetI18n.getLocale()}).then(refresh).catch(error=>{$('status').textContent=errorText(error.message,'操作未完成，请重试。');});
});
setInterval(renderFocus,1000);
chrome.runtime.sendMessage({action:'focus-get'}).then(()=>refresh()).catch(()=>{});
refresh();
