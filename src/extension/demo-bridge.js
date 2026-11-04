(() => {
  const origin=globalThis.PawPlusMeConfig.siteOrigin;
  const debug=globalThis.document?.documentElement?.dataset;
  if(debug)debug.petBridgeBuild='recall-3';
  const petIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  let identitySequence=0,lastSelectionToken;
  const validToken=token=>typeof token==='string'&&token.length>0&&token.length<=128;
  addEventListener('message',async event=>{
    if(event.source!==window||event.origin!==origin||event.data?.channel!=='pet-companion-page')return;
    const {action,petId,name,locale,mode,requestId,gift}=event.data;
    if(!['companion-status','adopt','set-language','set-mode'].includes(action)||typeof requestId!=='string'||!requestId||requestId.length>64)return;
    if(action==='adopt'&&typeof petId!=='string')return;
    const reply=result=>window.postMessage({channel:'pet-companion-extension',requestId,...result},origin);
    try{
      let claimToken;
      if(action==='adopt'&&(origin.startsWith('https:')||gift===true)){
        const response=await fetch(`${origin}/api/claim-ticket`,{method:'POST',credentials:'include',headers:{'content-type':'application/json','X-Pet-Demo':'1'},body:JSON.stringify({petId})});
        if(!response.ok)throw new Error('领取授权未完成，请重新登录生成页后继续。');
        claimToken=(await response.json()).token;
        if(typeof claimToken!=='string'||!claimToken||claimToken.length>4096)throw new Error('领取授权未完成。');
      }
      chrome.runtime.sendMessage({action,petId,name,locale,mode,...(claimToken?{claimToken}:{})},response=>{
        reply(chrome.runtime.lastError?{error:'插件已更新，请刷新本页后继续接回。',code:'reload-required'}:response||{error:'插件没有回应，请重新打开插件后再试。'});
      });
    }catch{
      reply(origin.startsWith('https:')||gift===true?{error:'领取授权未完成，请重新登录生成页后继续。',code:'claim-required'}:{error:'插件已更新，请刷新本页后继续接回。',code:'reload-required'});
    }
  });
  chrome.storage?.onChanged?.addListener(async(changes,area)=>{
    if(area==='local'&&changes.shortcuts)window.postMessage({channel:'pet-companion-extension',action:'shortcuts-changed',shortcuts:changes.shortcuts.newValue},origin);
    if(area==='local'&&['zh','en','es','ja'].includes(changes.locale?.newValue))window.postMessage({channel:'pet-companion-extension',action:'language-changed',locale:changes.locale.newValue},origin);
    const selectedToken=changes.petSelectionToken?.newValue;
    if(area==='local'&&validToken(selectedToken)&&selectedToken!==changes.petSelectionToken.oldValue&&selectedToken!==lastSelectionToken){
      const sequence=++identitySequence;
      let pet=changes.pet?.newValue;
      if(!pet)try{({pet}=await chrome.storage.local.get(['pet']));}catch{return;}
      if(sequence!==identitySequence)return;
      if(petIdPattern.test(pet?.id)){
        lastSelectionToken=selectedToken;
        const identity={id:pet.id,name:typeof pet.name==='string'?pet.name.trim().slice(0,24)||'小伴':'小伴',revision:typeof pet.revision==='string'?pet.revision.slice(0,128):''};
        window.postMessage({channel:'pet-companion-extension',action:'selected',token:selectedToken,pet:identity},origin);
      }
    }
    const token=changes.recallToken?.newValue;
    if(area==='local'&&typeof token==='string'&&token.length>0&&token.length<=128&&token!==changes.recallToken.oldValue){
      if(debug)debug.petBridgeRecallSeen=token;
      const sequence=++identitySequence;
      let pet;try{({pet}=await chrome.storage.local.get(['pet']));}catch{if(debug)debug.petBridgeRecallError='storage-read-failed';return;}
      if(sequence!==identitySequence)return;
      const identity=petIdPattern.test(pet?.id)?{petId:pet.id,name:typeof pet.name==='string'?pet.name.trim().slice(0,24)||'小伴':'小伴'}:{};
      if(debug){debug.petBridgeRecallSent=token;debug.petBridgeRecallPet=identity.petId||'';debug.petBridgeRecallError='';}
      window.postMessage({channel:'pet-companion-extension',action:'recalled',token,...identity},origin);
    }
  });
  window.postMessage({channel:'pet-companion-extension',action:'ready',protocol:1},origin);
})();
