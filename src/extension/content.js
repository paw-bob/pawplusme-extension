(() => {
  const debug=globalThis.document?.documentElement?.dataset;
  if(debug)debug.petContentBuild='recall-3';
  // The demo already renders its own companion; avoid showing it twice there.
  if (location.origin === globalThis.PawPlusMeConfig.siteOrigin && ['/', '/index.html', '/gift', '/gift.html'].includes(location.pathname)) return;
  let companion, currentId, generation = 0, focusTimeout,recallReady=false,lastRecallToken,pendingRecallToken,shortcuts=PetShortcuts.defaults();
  async function focusMessage(type,cycle){
    const response=await chrome.runtime.sendMessage({action:`focus-${type}`,cycle});
    if(response?.error)throw new Error(response.error);
    if(response?.focus)companion?.setFocusState(response.focus);
    return response;
  }
  async function sync() {
    const version = ++generation;
    const { pet, enabled = true, mode = 'auto', size = 144, focus=PetFocus.empty(),locale,recallToken,shortcuts:storedShortcuts } = await chrome.storage.local.get(['pet','enabled','mode','size','focus','locale','shortcuts','recallToken']);
    if (version !== generation) return;
    if(recallReady&&typeof recallToken==='string'&&recallToken.length>0&&recallToken.length<=128&&recallToken!==lastRecallToken){pendingRecallToken=recallToken;if(debug)debug.petContentRecallSeen='seen';}
    recallReady=true;lastRecallToken=recallToken;
    if(['zh','en','es','ja'].includes(locale))globalThis.PetI18n?.setLocale(locale,{persist:false,updateURL:false});
    shortcuts=PetShortcuts.normalize(storedShortcuts);
    clearTimeout(focusTimeout);
    if (!pet || !enabled) { companion?.destroy(); companion = null; currentId = null; pendingRecallToken=null;return; }
    const revision=`${pet.id}:${pet.revision||pet.motion||''}:${pet.image.length}`;
    if (revision !== currentId || !companion) {
      const image = new Image(); image.src = pet.image;
      try { await image.decode(); } catch { return; }
      if (version !== generation) return;
      companion?.destroy(); companion = new PetCompanion({ manifest: pet, image, size,onModeChange:mode=>chrome.storage.local.set({mode}),onHide:()=>chrome.storage.local.set({enabled:false}),onCatch:({cycle})=>focusMessage('catch',cycle),onFocusChoice:({type,cycle})=>focusMessage(type,cycle) }); currentId = revision;
    }
    if(companion.mode!==mode)companion.setMode(mode); companion.setSize(size);companion.setFocusState(focus);
    if(pendingRecallToken){companion.recall();if(debug)debug.petContentRecallApplied='applied';pendingRecallToken=null;}
    const deadline=PetFocus.deadline(focus);
    if(deadline)focusTimeout=setTimeout(()=>focusMessage('get').then(sync).catch(()=>{}),Math.max(100,Math.min(2_147_483_647,deadline-Date.now()+30)));
  }
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && ['pet','enabled','mode','size','focus','locale','shortcuts','recallToken'].some(key => key in changes)) sync(); });
  for(const event of ['focus','pageshow'])addEventListener(event,()=>focusMessage('get').then(sync).catch(()=>{}));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)focusMessage('get').then(sync).catch(()=>{});});
  PetShortcuts.bind({getBindings:()=>shortcuts,enabled:()=>!!companion,onAction:action=>chrome.storage.local.set({mode:PetShortcuts.modeForAction(action,companion.mode)})});
  focusMessage('get').catch(()=>{});
  sync();
})();
