(() => {
  'use strict';
  const t=(source,params={})=>globalThis.PetI18n?.t(source,params)??source.replace(/\{(\w+)\}/g,(match,key)=>params[key]??match);
  const MINUTE=60_000;
  const empty=()=>({phase:'off',dueAt:0,quietUntil:0,cycle:0});
  const waiting=(minutes,now)=>({phase:'waiting',dueAt:now+minutes*MINUTE,quietUntil:0,cycle:now+minutes*MINUTE});
  function advance(input,now=Date.now()){
    const state=input&&['off','waiting','mischief','caught','quiet'].includes(input.phase)?input:empty();
    if(state.phase==='waiting'){
      if(!Number.isFinite(state.dueAt)||state.dueAt<=0)return empty();
      if(now>=state.dueAt)return {...state,phase:'mischief'};
    }
    if(state.phase==='quiet'){
      if(!Number.isFinite(state.quietUntil)||state.quietUntil<=0)return empty();
      if(now>=state.quietUntil)return waiting(25,now);
    }
    return state;
  }
  function transition(input,event,now=Date.now()){
    const state=advance(input,now);
    if(event.type==='start')return waiting(25,now);
    if(event.type==='stop'){
      if(event.cycle!==undefined&&(state.phase!=='caught'||event.cycle!==state.cycle))return state;
      return empty();
    }
    if(event.type==='preview')return {phase:'mischief',dueAt:now,quietUntil:0,cycle:now};
    if(event.type==='tick')return state;
    if(event.cycle!==state.cycle)return state;
    if(event.type==='catch'&&state.phase==='mischief')return {...state,phase:'caught'};
    if(state.phase!=='caught')return state;
    if(event.type==='later25')return waiting(25,now);
    if(event.type==='later50')return waiting(50,now);
    if(event.type==='today'){
      const nextDay=new Date(now);nextDay.setHours(24,0,0,0);
      return {phase:'quiet',dueAt:0,quietUntil:nextDay.getTime(),cycle:0};
    }
    return state;
  }
  function deadline(state){return state?.phase==='waiting'?state.dueAt:state?.phase==='quiet'?state.quietUntil:0;}
  function restore(storage,key,now=Date.now()){
    let input;try{input=JSON.parse(storage.getItem(key));}catch{}
    const state=advance(input,now);
    try{storage.setItem(key,JSON.stringify(state));}catch{}
    return state;
  }
  function clock(state,now=Date.now()){
    if(state?.phase!=='waiting')return state?.phase==='quiet'?t('今天休息'):state?.phase==='off'?'25:00':t('到时间啦');
    const seconds=Math.max(0,Math.ceil((state.dueAt-now)/1000));
    return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  }
  function message(state){
    return t({off:'专心一会儿，25分钟后让它来找你。',waiting:'它先安静退场。到点后，按住宠物抓住它。',mischief:'它开始挠页面啦！抓痕只是临时效果，抓住它就收拾干净。',caught:'抓住啦！在宠物旁选下一次见面的时间。',quiet:'今天不再来打扰，明天再开始新的25分钟。'}[state?.phase]||'');
  }
  globalThis.PetFocus={MINUTE,empty,advance,transition,deadline,restore,clock,message};
})();
