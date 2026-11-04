(() => {
  'use strict';
  const actions=Object.freeze(['auto','look','follow','sleep']);
  const modeForAction=(action,currentMode)=>action==='follow'&&currentMode==='follow'?'look':action;
  const weak='请使用至少两个修饰键与字母或数字组合。';
  function defaults(){return Object.fromEntries(actions.map((action,i)=>[action,{code:`Digit${i+1}`,alt:true,shift:true,ctrl:false,meta:false}]));}
  function clean(value){return value&&typeof value==='object'?{code:value.code,alt:value.alt===true,shift:value.shift===true,ctrl:value.ctrl===true,meta:value.meta===true}:null;}
  function valid(binding){return !!binding&&/^(Key[A-Z]|Digit[0-9])$/.test(binding.code)&&[binding.alt,binding.ctrl,binding.meta,binding.shift].filter(Boolean).length>=2&&(binding.alt||binding.ctrl||binding.meta);}
  function reserved(binding){return !binding.alt&&binding.shift&&(binding.ctrl||binding.meta)&&/^Key[NWTQJICBHO]$/.test(binding.code)||binding.meta&&binding.shift&&/^Digit[345]$/.test(binding.code);}
  function key(binding){return `${binding.code}:${+binding.ctrl}${+binding.alt}${+binding.shift}${+binding.meta}`;}
  function validate(values){
    const seen=new Set();
    for(const action of actions){const value=values?.[action];if(value==null)continue;const binding=clean(value);if(!valid(binding))return weak;if(reserved(binding))return '这个组合由浏览器保留，请换一个。';const id=key(binding);if(seen.has(id))return '快捷键重复，请换一个组合。';seen.add(id);}
    return null;
  }
  function normalize(values){
    const result=defaults();if(values&&typeof values==='object')for(const action of actions)if(Object.hasOwn(values,action))result[action]=values[action]===null?null:clean(values[action]);
    return validate(result)?defaults():result;
  }
  function format(binding){if(!binding)return '';return [binding.ctrl&&'Ctrl',binding.alt&&'Alt',binding.shift&&'Shift',binding.meta&&'Meta',String(binding.code).replace(/^(Key|Digit)/,'')].filter(Boolean).join(' + ');}
  function fromEvent(event){
    if(event.repeat||event.isComposing||event.defaultPrevented||event.getModifierState?.('AltGraph'))return null;
    const count=[event.ctrlKey,event.altKey,event.shiftKey,event.metaKey].filter(Boolean).length;if(count<2)return null;
    const target=event.composedPath?.()[0]||event.target;if(target?.type==='password'||target?.closest?.('input[type="password"]'))return null;
    const binding={code:event.code,ctrl:!!event.ctrlKey,alt:!!event.altKey,shift:!!event.shiftKey,meta:!!event.metaKey};return valid(binding)&&!reserved(binding)?binding:null;
  }
  function bind({target=globalThis.document,getBindings=defaults,onAction,enabled=()=>true,signal}){
    const handler=event=>{
      if(!enabled())return;const binding=fromEvent(event);if(!binding)return;
      const values=normalize(getBindings()),action=actions.find(name=>values[name]&&key(values[name])===key(binding));if(!action)return;
      const result=onAction(action);if(result===false)return;result?.catch?.(()=>{});event.preventDefault?.();event.stopPropagation?.();
    };
    target.addEventListener('keydown',handler,signal?{signal}:undefined);return()=>target.removeEventListener('keydown',handler);
  }
  globalThis.PetShortcuts={actions,modeForAction,defaults,normalize,validate,format,fromEvent,bind};
})();
