(() => {
  'use strict';
  const t=(source,params={})=>globalThis.PetI18n?.t(source,params)??source.replace(/\{(\w+)\}/g,(match,key)=>params[key]??match);
  class PetCompanion {
    constructor({manifest,image,size=144,position,onState=()=>{},onModeChange=()=>{},onCatch=()=>{},onFocusChoice=()=>{},onHide=()=>{}}) {
      Object.assign(this,{manifest,image,size,onState,onModeChange,onCatch,onFocusChoice,onHide,mode:'auto',state:'',visible:true,shown:false,paused:false,destroyed:false,focusState:{phase:'off'}});
      this.x=position?.x??Math.max(0,innerWidth-size-36);this.y=position?.y??Math.max(0,innerHeight-size-28);
      this.renderSize=size;this.mouse={x:innerWidth/2,y:innerHeight/2};this.lastActivity=performance.now();
      this.lastTime=this.phase=this.lastActivity;this.abort=new AbortController();
      this.reduceMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false;
      const options={signal:this.abort.signal,passive:true};
      this.root=document.createElement('div');this.root.dataset.petCompanion='';
      Object.assign(this.root.style,{position:'fixed',left:'0',top:'0',width:`${size}px`,height:`${size}px`,zIndex:'2147483647',pointerEvents:'none',contain:'layout style',userSelect:'none',transformOrigin:'0 0',willChange:'transform'});
      this.canvas=document.createElement('canvas');this.canvas.width=this.canvas.height=384;
      this.canvas.setAttribute('aria-label',t('陪伴宠物，跟随时长按或按住Alt拖动'));this.canvas.setAttribute('role','img');
      this.canvas.tabIndex=0;
      Object.assign(this.canvas.style,{width:'100%',height:'100%',pointerEvents:'none',cursor:'default',touchAction:'none',display:'block',transformOrigin:'50% 93.75%'});
      this.ctx=this.canvas.getContext('2d');this.root.attachShadow({mode:'open'}).append(this.canvas);document.documentElement.append(this.root);
      document.addEventListener('pointermove',e=>{
        if(this.paused)return;
        this.mouse={x:e.clientX,y:e.clientY};this.lastActivity=performance.now();
        if(this.peek&&!this.drag){const r=this.peek.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)this.stopInput(true);}
        if(this.pendingGrab&&e.pointerId===this.pendingGrab.pointerId&&Math.hypot(e.clientX-this.pendingGrab.x,e.clientY-this.pendingGrab.y)>6)this.cancelPendingGrab();
        if(this.drag&&e.pointerId===this.drag.pointerId){e.preventDefault();this.x=e.clientX-this.drag.dx;this.y=e.clientY-this.drag.dy;this.clamp();}
        this.trackActionHover(e);
      },{signal:this.abort.signal,passive:false});
      for(const event of ['focusin','input'])document.addEventListener(event,e=>this.inspectInput(e.target,e.type),options);
      for(const event of ['pointerout','focusout'])document.addEventListener(event,e=>{
        if(this.paused)return;
        if(e.type==='pointerout'&&!e.relatedTarget)this.scheduleActionClose();
        if(this.peek&&(e.target===this.peek||this.peek.contains?.(e.target))&&e.relatedTarget!==this.peek&&!this.peek.contains?.(e.relatedTarget))this.stopInput(true);
      },{...options,capture:true});
      this.invalidateRect=()=>{this.rectDirty=true;this.scratchDirty=true;if(this.focusState.phase==='caught')this.positionFocusPanel();if(this.actionMenuOpen)this.positionActionMenu();};
      document.addEventListener('scroll',this.invalidateRect,{...options,capture:true});addEventListener('resize',this.invalidateRect,options);
      this.resizeObserver=new ResizeObserver(this.invalidateRect);
      document.addEventListener('pointerdown',e=>{
        if(this.paused)return;
        this.inputFocusBlockedUntil=0;
        this.suppressedClick=null;
        if(this.actionMenu&&(e.target===this.actionMenu||(e.composedPath?.()||[]).includes(this.actionMenu)))return;
        this.hideActionMenu();
        if(this.root.contains(e.target)||this.isPageControl(e))return;
        if(this.mode==='auto')this.chaseUntil=performance.now()+2300;this.lastActivity=performance.now();
        if(!this.shown||!this.visible||document.hidden||!document.hasFocus()||this.mode!=='follow'||this.focusState.phase!=='off'||e.defaultPrevented||e.button!==0||e.isPrimary===false||e.pointerType&&e.pointerType!=='mouse'||e.altKey||e.ctrlKey||e.metaKey)return;
        if(e.clientX<this.x||e.clientX>this.x+this.renderSize||e.clientY<this.y||e.clientY>this.y+this.renderSize)return;
        this.cancelPendingGrab();
        const pending={x:e.clientX,y:e.clientY,pointerId:e.pointerId};
        pending.timer=setTimeout(()=>{if(this.pendingGrab!==pending)return;this.pendingGrab=null;this.startDrag({clientX:pending.x,clientY:pending.y,pointerId:pending.pointerId},true);},220);
        this.pendingGrab=pending;
      },options);
      this.canvas.addEventListener('pointerdown',e=>{
        if(this.paused)return;
        if(e.button!==0||e.isPrimary===false||!this.dragModifier&&this.focusState.phase!=='mischief')return;
        e.preventDefault();this.startDrag(e,this.dragModifier&&this.focusState.phase==='off');
      },{signal:this.abort.signal});
      document.addEventListener('pointerup',e=>this.endDrag(e),options);
      document.addEventListener('pointercancel',e=>this.endDrag(e),options);
      this.canvas.addEventListener('lostpointercapture',()=>this.cancelDrag(),options);
      document.addEventListener('selectstart',e=>{if(this.drag)e.preventDefault();},{signal:this.abort.signal});
      document.addEventListener('click',e=>{
        const release=this.suppressedClick;this.suppressedClick=null;
        if(release&&e.detail!==0&&performance.now()<=release.until&&Math.hypot(e.clientX-release.x,e.clientY-release.y)<8){e.preventDefault();e.stopImmediatePropagation();}
      },{signal:this.abort.signal,capture:true});
      this.canvas.addEventListener('keydown',e=>{if(!this.paused&&this.focusState.phase==='mischief'&&['Enter',' '].includes(e.key)){e.preventDefault();this.onCatch({cycle:this.focusState.cycle});}},{signal:this.abort.signal});
      const modifier=e=>{this.dragModifier=!!(!this.paused&&e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey);this.syncPointerEvents();};
      addEventListener('keydown',modifier,options);addEventListener('keyup',modifier,options);
      addEventListener('keydown',e=>{
        if(e.key==='Escape')this.hideActionMenu();
        if(e.key!=='Escape'||e.repeat||e.isComposing||e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;
        if(this.destroyed||this.paused||!this.shown||!this.visible||document.hidden||!document.hasFocus()||this.mode!=='follow'||this.focusState.phase!=='off')return;
        // Observe Escape without consuming it; the host page can still close its own UI.
        this.setMode('look');this.onModeChange?.('look')?.catch?.(()=>{});
      },options);
      addEventListener('blur',()=>{this.dragModifier=false;this.cancelDrag();this.hideActionMenu();},options);
      this.createFocusPanel();
      this.createActionMenu();
      this.canvas.addEventListener('focus',()=>{this.actionKeyboardFocus=true;this.showActionMenu();},options);
      this.canvas.addEventListener('blur',()=>{this.actionKeyboardFocus=false;this.scheduleActionClose();},options);
      addEventListener('pet-language-change',()=>this.localize(),{signal:this.abort.signal});
      document.addEventListener('visibilitychange',()=>this.syncVisibility(),options);
      for(const event of ['focus','blur'])addEventListener(event,()=>this.syncVisibility(),options);
      this.syncVisibility();
    }
    isPageControl(event){
      return (event.composedPath?.()||[event.target]).some(node=>node?.closest?.('button,a,summary,input,textarea,select,[contenteditable],dialog,[role="button"],[role="link"],[role="textbox"]'));
    }
    cancelPendingGrab(){if(this.pendingGrab){clearTimeout(this.pendingGrab.timer);this.pendingGrab=null;}}
    startDrag(event,returnToWatch){
      this.cancelPendingGrab();if(this.paused||!this.shown||!this.visible||document.hidden||!document.hasFocus())return;
      this.hideActionMenu();
      this.drag={dx:event.clientX-this.x,dy:event.clientY-this.y,pointerId:event.pointerId,returnToWatch,catchCycle:this.focusState.phase==='mischief'?this.focusState.cycle:null};
      this.peek=null;this.syncPointerEvents();
      try{this.canvas.setPointerCapture(event.pointerId);}catch{}
    }
    cancelDrag(){
      this.cancelPendingGrab();const drag=this.drag;this.drag=null;
      if(drag)try{this.canvas.releasePointerCapture?.(drag.pointerId);}catch{}
      this.syncPointerEvents();
    }
    endDrag(event){
      if(this.pendingGrab?.pointerId===event.pointerId)this.cancelPendingGrab();
      if(!this.drag||this.drag.pointerId!==event.pointerId)return;
      const drag=this.drag;this.cancelDrag();this.lastActivity=performance.now();
      if(event.type!=='pointerup')return;
      this.suppressedClick={until:performance.now()+500,x:event.clientX,y:event.clientY};
      if(drag.catchCycle!=null)this.onCatch({cycle:drag.catchCycle});
      else if(drag.returnToWatch){this.setMode('look');this.onModeChange?.('look')?.catch?.(()=>{});}
    }
    createActionMenu(){
      this.actionMenu=document.createElement('div');this.actionMenu.dataset.petActionMenu='';
      Object.assign(this.actionMenu.style,{position:'fixed',zIndex:'2147483647',display:'none',width:'max-content',maxWidth:'calc(100vw - 16px)',pointerEvents:'auto'});
      const shadow=this.actionMenu.attachShadow({mode:'open'}),style=document.createElement('style');
      style.textContent=':host{font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#4c1c30}*{box-sizing:border-box}.actions{display:flex;flex-wrap:wrap;gap:2px;padding:4px;background:#fffdfd;border:1px solid #ddc5cf;border-radius:10px}button{flex:1 0 auto;min-height:32px;padding:6px 9px;border:0;border-radius:6px;background:transparent;color:#7d2047;font:inherit;white-space:nowrap;cursor:pointer}button:hover{background:#fff0f5}button[aria-pressed="true"]{background:#7d2047;color:#fffdfd}button:focus-visible{outline:2px solid #006fcc;outline-offset:1px}button:disabled{opacity:.5;cursor:wait}p{flex:1 0 100%;margin:2px 6px 4px;font-size:12px;color:#7d2047}::selection{background:#fbd8e6;color:#4c1c30}';
      const group=this.actionGroup=document.createElement('div');group.className='actions';group.setAttribute('role','group');group.setAttribute('aria-label',t('宠物操作'));
      this.actionKeys=['follow','look','timer','sleep','hide'];this.actionLabels=['跟随','注视','闹钟','小睡','隐藏'];
      this.actionButtons=this.actionKeys.map(action=>{const button=document.createElement('button');button.type='button';button.dataset.petAction=action;button.addEventListener('click',()=>this.choosePetAction(action),{signal:this.abort.signal});group.append(button);return button;});
      this.actionStatus=document.createElement('p');this.actionStatus.setAttribute('role','status');this.actionStatus.setAttribute('aria-live','polite');this.actionStatus.hidden=true;group.append(this.actionStatus);
      shadow.append(style,group);document.documentElement.append(this.actionMenu);
      this.actionMenu.addEventListener('pointerenter',()=>this.cancelActionClose(),{signal:this.abort.signal});
      this.actionMenu.addEventListener('pointerleave',()=>this.scheduleActionClose(),{signal:this.abort.signal});
      this.actionMenu.addEventListener('focusin',()=>{this.actionKeyboardFocus=true;this.cancelActionClose();},{signal:this.abort.signal});
      this.actionMenu.addEventListener('focusout',()=>{this.actionKeyboardFocus=false;this.scheduleActionClose();},{signal:this.abort.signal});
      this.renderActionMenu();
    }
    renderActionMenu(){
      if(!this.actionButtons)return;
      this.actionGroup.setAttribute('aria-label',t('宠物操作'));
      this.actionButtons.forEach((button,index)=>{const action=this.actionKeys[index];button.textContent=t(this.actionLabels[index]);button.disabled=!!this.actionMenuBusy;if(['follow','look','sleep'].includes(action))button.setAttribute('aria-pressed',String(this.mode===action));if(action==='timer')button.setAttribute('title',t('启动25分钟闹钟'));});
    }
    canShowActionMenu(){return !this.destroyed&&!this.paused&&this.shown&&this.visible&&!document.hidden&&document.hasFocus()&&this.focusState.phase==='off'&&!this.drag&&!this.pendingGrab&&!this.dragModifier&&!this.actionMenuBusy;}
    cancelActionClose(){if(this.actionCloseTimer!==undefined){clearTimeout(this.actionCloseTimer);this.actionCloseTimer=undefined;}}
    scheduleActionClose(){
      if(!this.actionMenuOpen||this.actionKeyboardFocus||this.actionCloseTimer!==undefined)return;
      this.actionCloseTimer=setTimeout(()=>{this.actionCloseTimer=undefined;if(!this.actionKeyboardFocus)this.hideActionMenu();},180);
    }
    trackActionHover(event){
      if(event.pointerType==='touch')return;
      if(!this.canShowActionMenu()){this.hideActionMenu();return;}
      const inMenu=event.target===this.actionMenu||(event.composedPath?.()||[]).includes(this.actionMenu);
      if(event.buttons>0&&!inMenu){this.hideActionMenu();return;}
      // Follow keeps the cursor 14px above the cell bottom; that strip is not an intentional body hover.
      const bottom=this.y+this.renderSize-(this.mode==='follow'?22:0);
      const inPet=event.clientX>=this.x&&event.clientX<=this.x+this.renderSize&&event.clientY>=this.y&&event.clientY<=bottom;
      if(inMenu||inPet&&!this.isPageControl(event)){this.cancelActionClose();this.showActionMenu();}else this.scheduleActionClose();
    }
    showActionMenu(message=''){
      if(!this.actionMenu||!this.canShowActionMenu())return false;
      this.cancelActionClose();this.actionMenuOpen=true;this.root.dataset.actionMenu='open';this.actionMenu.style.display='block';
      this.actionStatus.textContent=message;this.actionStatus.hidden=!message;this.renderActionMenu();this.positionActionMenu();return true;
    }
    hideActionMenu(){
      this.cancelActionClose();this.actionMenuOpen=false;this.actionKeyboardFocus=false;
      if(this.actionMenu)this.actionMenu.style.display='none';if(this.root)this.root.dataset.actionMenu='closed';
    }
    positionActionMenu(){
      if(!this.actionMenuOpen)return;
      const rect=this.actionMenu.getBoundingClientRect(),width=rect.width,height=rect.height;
      this.actionMenu.style.left=`${Math.max(8,Math.min(innerWidth-width-8,this.x+this.renderSize/2-width/2))}px`;
      const top=this.y-height-8>=8?this.y-height-8:this.y+this.renderSize+8;
      this.actionMenu.style.top=`${Math.max(8,Math.min(innerHeight-height-8,top))}px`;
    }
    async choosePetAction(action){
      if(this.actionMenuBusy||!this.canShowActionMenu()||!this.actionKeys.includes(action))return;
      const previousMode=this.mode;this.hideActionMenu();this.actionMenuBusy=true;this.renderActionMenu();
      try{
        if(['follow','look','sleep'].includes(action)){this.setMode(action);await this.onModeChange(action);}
        else if(action==='timer')await this.onFocusChoice({type:'start'});
        else {await this.onHide();if(!this.destroyed)this.setVisible(false);}
      }catch{
        this.actionMenuBusy=false;
        if(!this.destroyed){if(this.mode===action)this.setMode(previousMode);this.showActionMenu(t('操作未完成，请重试。'));}
      }finally{this.actionMenuBusy=false;if(!this.destroyed)this.renderActionMenu();}
    }
    createFocusPanel(){
      this.focusPanel=document.createElement('div');this.focusPanel.dataset.petFocusPanel='';
      Object.assign(this.focusPanel.style,{position:'fixed',zIndex:'2147483647',display:'none',width:'280px',maxWidth:'calc(100vw - 24px)',pointerEvents:'auto',contain:'layout style'});
      const shadow=this.focusPanel.attachShadow({mode:'open'}),style=document.createElement('style');
      style.textContent=':host{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#4c1c30}*{box-sizing:border-box}.panel{background:#fffdfd;border:1px solid #efd7e1;border-radius:12px;padding:17px}h2{font-size:17px;font-weight:600;line-height:1.4;margin:0 0 5px}p{font-size:12px;color:#805f6d;margin:0 0 13px}button{display:block;width:100%;min-height:42px;margin:7px 0 0;padding:8px 12px;border:1px solid #efd7e1;border-radius:7px;background:#fff7fa;color:#7d2047;font:inherit;text-align:left;cursor:pointer}button:first-of-type{background:#7d2047;border-color:#7d2047;color:#fffdf2}button:hover{filter:brightness(.96)}button:focus-visible{outline:3px solid #b83268;outline-offset:2px}button:disabled{opacity:.5;cursor:wait}::selection{background:#fbd8e6;color:#4c1c30}';
      this.focusDialog=document.createElement('section');this.focusDialog.className='panel';this.focusDialog.setAttribute('role','dialog');this.focusDialog.setAttribute('aria-labelledby','pet-focus-title');
      const title=this.focusTitle=document.createElement('h2');title.id='pet-focus-title';title.textContent=t('抓住啦，休息一下？');
      const copy=this.focusCopy=document.createElement('p');copy.textContent=t('下一次，什么时候再来找你？');this.focusDialog.append(title,copy);
      this.focusButtons=[];
      this.focusLabels=['再过 25 分钟','再过 50 分钟','今天不要来了'];
      for(const [index,type]of ['later25','later50','today'].entries()){
        const button=document.createElement('button');button.type='button';button.textContent=t(this.focusLabels[index]);
        button.addEventListener('click',async()=>{this.focusButtons.forEach(b=>b.disabled=true);try{await this.onFocusChoice({type,cycle:this.focusState.cycle});}finally{this.focusButtons.forEach(b=>b.disabled=false);}},{signal:this.abort.signal});
        this.focusButtons.push(button);this.focusDialog.append(button);
      }
      shadow.append(style,this.focusDialog);document.documentElement.append(this.focusPanel);
    }
    localize(){
      this.renderActionMenu();
      this.canvas.setAttribute('aria-label',t(this.focusState.phase==='mischief'?'抓住宠物':'陪伴宠物，跟随时长按或按住Alt拖动'));
      if(this.focusTitle)this.focusTitle.textContent=t('抓住啦，休息一下？');
      if(this.focusCopy)this.focusCopy.textContent=t('下一次，什么时候再来找你？');
      this.focusButtons?.forEach((button,index)=>{if(this.focusLabels?.[index])button.textContent=t(this.focusLabels[index]);});
      if(this.focusState.phase==='caught')this.positionFocusPanel();
    }
    positionFocusPanel(){
      if(!this.focusPanel||this.focusPanel.style.display==='none')return;
      const rect=this.focusPanel.getBoundingClientRect();
      this.focusPanel.style.left=`${Math.max(12,Math.min(innerWidth-rect.width-12,this.x+this.renderSize/2-rect.width/2))}px`;
      this.focusPanel.style.top=`${Math.max(12,Math.min(innerHeight-rect.height-12,this.y-rect.height-14))}px`;
    }
    setFocusState(state){
      const previous=this.focusState;this.focusState=state||{phase:'off'};
      if(this.focusState.phase!=='off')this.hideActionMenu();
      if(this.focusState.phase!==previous.phase)this.cancelDrag();
      if(this.focusState.phase==='mischief'&&(previous.phase!=='mischief'||previous.cycle!==state.cycle)){
        this.clearMischief();
        this.effects??=globalThis.PetMischief?.createLayer();
        this.mischiefSince=performance.now();this.drag=null;this.x=Math.max(8,innerWidth-this.size-30);this.y=Math.max(48,innerHeight-this.size-24);
      }
      else if(this.focusState.phase!=='mischief'&&previous.phase==='mischief')this.clearMischief();
      this.root.dataset.focusPhase=this.focusState.phase;
      const canCatch=this.focusState.phase==='mischief';this.canvas.setAttribute('role',canCatch?'button':'img');this.canvas.tabIndex=['off','mischief'].includes(this.focusState.phase)?0:-1;
      this.canvas.setAttribute('aria-label',t(canCatch?'抓住宠物':'陪伴宠物，跟随时长按或按住Alt拖动'));
      this.syncVisibility();
      if(this.focusState.phase==='caught'){
        this.positionFocusPanel();
        if(previous.phase!=='caught'&&this.shown)this.focusButtons[0].focus({preventScroll:true});
      }
    }
    syncVisibility(){
      const phase=this.focusState.phase;
      const show=this.visible&&!document.hidden&&!['waiting','quiet'].includes(phase)&&(phase==='off'||document.hasFocus());
      this.root.style.display=show?'block':'none';this.focusPanel.style.display=show&&phase==='caught'?'block':'none';
      if(show&&!this.shown&&!this.paused){this.lastTime=performance.now();this.raf=requestAnimationFrame(t=>this.tick(t));}
      else if(!show){this.hideActionMenu();cancelAnimationFrame(this.raf);this.clearMischief();this.stopInput();}
      this.shown=show;if(!show){this.dragModifier=false;this.cancelDrag();}this.syncPointerEvents();if(show&&phase==='caught')this.positionFocusPanel();
    }
    clearMischief(){
      this.effects?.clear();this.scratchTarget=null;this.scratchRound=-1;this.scratchDirty=true;this.scratchArrivedAt=null;this.scratchStrikes=0;
      if(this.canvas){this.canvas.style.transform='';this.pawTransform='';}
    }
    syncPointerEvents(){
      const interactive=!this.paused&&!!(this.drag||this.dragModifier||this.focusState.phase==='mischief');
      this.canvas.style.pointerEvents=interactive?'auto':'none';
      this.canvas.style.cursor=this.drag?'grabbing':interactive?'grab':'default';
    }
    inspectInput(target,reason) {
      if(this.paused)return;
      this.root.dataset.lastInputEvent=reason||'direct';
      if(reason==='focusin'&&performance.now()<(this.inputFocusBlockedUntil||0)){this.root.dataset.lastInputEvent='focusin-suppressed';return;}
      if(!this.shown||!this.visible||document.hidden||this.focusState.phase!=='off'||!target?.matches)return;
      if(!target.matches('textarea,input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="tel"],[contenteditable="true"],[contenteditable=""]'))target=target.closest?.('[contenteditable="true"],[contenteditable=""]');
      if(!target?.matches)return;
      if(!target.matches('textarea,input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="tel"],[contenteditable="true"],[contenteditable=""]'))return;
      if(this.mode==='sleep'){this.mode='look';this.onModeChange?.('look')?.catch?.(()=>{});}
      if(this.peek!==target){this.attachedPeek=null;this.resizeObserver.disconnect();this.resizeObserver.observe(target);}
      this.peek=target;this.peekUntil=performance.now()+6500;this.lastActivity=performance.now();this.rectDirty=true;
      // Only events and geometry. Never read form values, text or keystrokes.
    }
    stopInput(watch=false){
      if(!this.peek)return;
      this.peek=null;this.attachedPeek=null;this.peekRect=null;this.peekUntil=0;this.resizeObserver.disconnect();this.rectDirty=true;
      if(watch){const changed=this.mode!=='look';this.setMode('look');if(changed)this.onModeChange?.('look')?.catch?.(()=>{});}
    }
    setMode(mode){if(!['auto','look','follow','sleep'].includes(mode))return;if(mode!==this.mode)this.cancelDrag();this.hideActionMenu();this.mode=mode;this.renderActionMenu();this.stopInput();this.resizeObserver.disconnect();this.lastActivity=performance.now();}
    setAssets({manifest,image}){
      if(this.destroyed)return false;
      if(!image||!manifest?.animations?.run?.length)throw new TypeError('Invalid pet assets.');
      const oldLength=this.manifest.animations.run.length,newLength=manifest.animations.run.length;
      this.hideActionMenu();this.cancelDrag();this.manifest=manifest;this.image=image;
      this.runCursor=(this.runCursor||0)/Math.max(1,oldLength)*newLength;
      this.gaze=null;this.frame=undefined;this.flipped=undefined;this.poseTransition=null;this.rectDirty=true;this.scratchDirty=true;
      return true;
    }
    setSize(size){this.size=Math.max(72,Math.min(240,Number(size)||144));this.root.style.width=this.root.style.height=`${this.size}px`;this.rectDirty=true;this.clamp();}
    setVisible(visible){this.visible=visible;this.syncVisibility();}
    setPaused(paused){
      paused=!!paused;if(this.destroyed||paused===this.paused)return;
      const now=performance.now();
      if(paused){
        this.hideActionMenu();
        cancelAnimationFrame(this.raf);
        // A reduced-motion first render still needs one visible frame.
        if(this.frame===undefined&&this.shown)this.tick(now);
        this.paused=true;this.pausedAt=now;cancelAnimationFrame(this.raf);
        this.dragModifier=false;this.cancelDrag();
      }else{
        const elapsed=now-this.pausedAt;
        for(const key of ['phase','lastActivity','mischiefSince','scratchArrivedAt']){
          if(Number.isFinite(this[key]))this[key]+=now-Math.max(this.pausedAt,this[key]);
        }
        for(const key of ['chaseUntil','peekUntil'])if(this[key])this[key]+=elapsed;
        if(this.poseTransition)this.poseTransition.start+=now-Math.max(this.pausedAt,this.poseTransition.start);
        this.paused=false;this.pausedAt=undefined;this.lastTime=now;
        this.syncPointerEvents();
        if(this.shown)this.raf=requestAnimationFrame(t=>this.tick(t));
      }
    }
    recall(){
      if(this.destroyed)return false;
      this.root.dataset.recallAt=String(performance.now());this.root.dataset.recallCount=String((Number(this.root.dataset.recallCount)||0)+1);
      this.inputFocusBlockedUntil=performance.now()+1000;
      this.cancelDrag();this.stopInput();this.clearMischief();this.dragModifier=false;
      this.visible=true;this.renderSize=this.size;this.setMode('look');this.chaseUntil=0;
      this.x=Math.max(0,innerWidth-this.size-36);this.y=Math.max(8,innerHeight-this.size-28);this.clamp();
      this.gaze=null;this.frame=undefined;this.flipped=undefined;this.poseTransition=null;this.transform=undefined;
      this.root.style.transform=`translate3d(${this.x.toFixed(2)}px,${this.y.toFixed(2)}px,0) scale(1)`;
      this.setFocusState({phase:'off'});return true;
    }
    clamp(){this.x=Math.max(0,Math.min(innerWidth-this.renderSize,this.x));this.y=Math.max(8,Math.min(innerHeight-this.renderSize,this.y));}
    drawFrame(frame,alpha=1,flip=false){
      const cell=this.manifest.cellSize;this.ctx.save();this.ctx.globalAlpha=alpha;
      if(flip){this.ctx.translate(384,0);this.ctx.scale(-1,1);}
      this.ctx.drawImage(this.image,(frame%this.manifest.columns)*cell,Math.floor(frame/this.manifest.columns)*cell,cell,cell,0,0,384,384);this.ctx.restore();
    }
    tick(now){
      if(this.destroyed||!this.shown||this.paused)return;
      if(this.peek&&!this.peek.isConnected)this.stopInput(true);
      const dt=Math.min((now-this.lastTime)/1000,.05);this.lastTime=now;
      const previousX=this.x,previousY=this.y;
      let state='look',target=null,flip=false,placement,sprite,pawWave=0,mischiefAction='',scratchSize;
      const mischief=this.focusState.phase==='mischief';
      const focused=this.peek&&(document.activeElement===this.peek||this.peek.contains(document.activeElement));
      if(this.drag){state=mischief?'mischief':'look';sprite='look';}
      else if(this.focusState.phase==='caught'){state='caught';sprite='look';}
      else if(mischief){
        state='mischief';sprite='run';const seconds=(now-this.mischiefSince)/1000,beat=seconds%14,round=Math.floor(seconds/14);mischiefAction='roam';
        if(beat<6){
          if(this.scratchRound!==round){
            this.scratchRound=round;this.scratchArrivedAt=null;this.scratchStrikes=0;
            this.scratchTarget=globalThis.PetMischief?.pickTarget({size:this.size,anchor:this.manifest.peek?.pawAnchor,near:{x:this.x,y:this.y},last:this.lastScratchElement});
            this.lastScratchElement=this.scratchTarget?.element;this.scratchDirty=false;
          }
          if(this.scratchTarget&&this.scratchDirty){
            this.scratchTarget.placement=PetMischief.place(this.scratchTarget.element,this.size,this.manifest.peek?.pawAnchor);this.scratchDirty=false;
          }
          const spot=this.scratchTarget?.element.isConnected&&this.scratchTarget.placement;
          if(spot){
            target={x:spot.x,y:spot.y};scratchSize=spot.size;mischiefAction='approach';
            if(Math.hypot(spot.x-this.x,spot.y-this.y)<8){
              placement=spot;sprite='peek';mischiefAction='scratch';this.scratchArrivedAt??=now;
              const elapsed=now-this.scratchArrivedAt;
              if(this.scratchStrikes<2&&elapsed>=(this.scratchStrikes?780:200)){
                this.effects?.strike(this.scratchTarget.element,{x:spot.pawX+spot.size*(this.scratchStrikes ? .075 : -.075),y:spot.pawY-2,size:spot.size});this.scratchStrikes++;
              }
              const stroke=elapsed<550?(elapsed-100)/330:(elapsed-680)/330;
              if(!this.reduceMotion&&stroke>0&&stroke<1)pawWave=Math.sin(stroke*Math.PI);
            }
          }
          if(!target){target={x:this.mouse.x-this.size/2+45,y:this.mouse.y-this.size+25};sprite='look';}
        }else if(beat<10){
          const radius=Math.min(110,innerWidth*.2);target={x:this.mouse.x-this.size/2+Math.cos(seconds*1.3)*radius,y:this.mouse.y-this.size*.6+Math.sin(seconds*1.3)*65};
        }else{target={x:Math.floor(seconds/2)%2?12:innerWidth-this.size-12,y:innerHeight-this.size-20};}
        // Scratch placement already fits the paw and hind feet; a second inset can make it unreachable.
        if(target&&!scratchSize){target.x=Math.max(8,Math.min(innerWidth-this.size-8,target.x));if(!placement)target.y=Math.max(8,Math.min(innerHeight-this.size-12,target.y));}
      }
      else if(this.mode==='sleep')state='sleep';
      else if(this.actionMenuOpen)state='look';
      else if(this.peek?.isConnected&&(focused||now<this.peekUntil)){
        if(this.rectDirty||!this.peekRect){const r=this.peek.getBoundingClientRect();this.peekRect={left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};this.rectDirty=false;}
        placement=PetGeometry.pawPlacement(this.peekRect,this.size,{width:innerWidth,height:innerHeight},this.manifest.peek?.pawAnchor);
        target=placement;state='peek';
      }else if(this.mode==='auto'&&now-this.lastActivity>12000)state='sleep';
      else if(this.mode==='follow'||(this.mode==='auto'&&now<this.chaseUntil)){target={x:this.mouse.x-this.size/2,y:this.mouse.y-this.size+14};state='run';}
      const desiredSize=placement?.size??scratchSize??this.size;
      this.renderSize+=(desiredSize-this.renderSize)*(1-Math.exp(-dt*14));
      if(Math.abs(desiredSize-this.renderSize)<.1)this.renderSize=desiredSize;
      if(placement&&this.attachedPeek===this.peek){this.x=placement.x;this.y=placement.y;if(!mischief)state='peek';}
      else if(target){
        const dx=target.x-this.x,dy=target.y-this.y,distance=Math.hypot(dx,dy);flip=dx<0;
        if(distance>3){const speed=mischief?(Math.hypot(this.mouse.x-this.x-this.renderSize/2,this.mouse.y-this.y-this.renderSize/2)<100?90:250):Math.max(160,Math.min(550,distance*3));const step=Math.min(distance,dt*speed);this.x+=dx/distance*step;this.y+=dy/distance*step;if(!mischief)state='run';else sprite='run';}
        else{this.x=target.x;this.y=target.y;if(state==='run')state=distance>.001?'run':'look';}
      }
      if((state==='peek'||mischief&&sprite==='peek')&&placement){this.x=placement.x;this.y=placement.y;this.renderSize=placement.size;this.attachedPeek=this.peek;}
      else this.clamp();
      if(state==='run'&&Math.hypot(this.x-previousX,this.y-previousY)<=.001)state='look';
      if(state!==this.state){this.state=state;this.root.dataset.state=state;this.onState(state);}
      if(this.root.dataset.mischiefAction!==mischiefAction)this.root.dataset.mischiefAction=mischiefAction;
      const animationName=sprite||(state==='caught'?'look':state);
      const canBlend=!this.reduceMotion&&!this.drag&&!mischief&&['look','run'].includes(animationName);
      if(!canBlend)this.poseTransition=null;
      if(this.animationName!==animationName){
        this.poseTransition=canBlend&&['look','run'].includes(this.animationName)&&this.frame!==undefined?{frame:this.frame,flip:this.flipped,start:now}:null;
        this.phase=now;this.animationName=animationName;
      }
      const animation=this.manifest.animations[animationName];let frame,runEntry;
      if(animationName==='look'){
        this.gaze=PetGeometry.gazeFrame({mouse:this.mouse,position:{x:this.x,y:this.y},size:this.renderSize,count:animation.length,previous:this.gaze,dt,reducedMotion:this.reduceMotion,anchor:this.manifest.gaze?.anchor,angles:this.manifest.gaze?.angles});
        frame=animation[this.gaze.index];
      }else{
        this.gaze=null;
        const fps=this.manifest.fps?.[animationName]??(this.manifest.motion==='continuous-video'?24:0);
        if(animationName==='run'){
          const distance=this.drag?0:Math.hypot(this.x-previousX,this.y-previousY);
          this.runCursor=(this.runCursor||0)+distance*(fps||24)/Math.max(1,this.renderSize*2);
          if(this.manifest.runDirections){
            this.runHeading=PetGeometry.runDirection({dx:this.x-previousX,dy:this.y-previousY,previous:this.runHeading});
            runEntry=this.manifest.runDirections[this.runHeading];
          }
          if(Array.isArray(runEntry?.frames)&&runEntry.frames.length){
            const phase=(this.runCursor%animation.length)/animation.length;
            frame=runEntry.frames[Math.floor(phase*runEntry.frames.length)];
          }else{runEntry=null;frame=animation[Math.floor(this.runCursor)%animation.length];}
        }else frame=animation[fps?Math.floor((now-this.phase)*fps/1000)%animation.length:0];
      }
      const flipped=animationName==='run'&&(runEntry?runEntry.flip===true:flip);
      if(frame!==this.frame||flipped!==this.flipped||this.poseTransition){
        const mix=this.poseTransition?Math.min(1,Math.max(0,(now-this.poseTransition.start)/100)):1;
        this.ctx.clearRect(0,0,384,384);
        if(mix<1)this.drawFrame(this.poseTransition.frame,1-mix,this.poseTransition.flip);
        this.drawFrame(frame,mix,flipped);
        if(mix>=1)this.poseTransition=null;
        this.frame=frame;this.flipped=flipped;this.root.dataset.frame=frame;
      }
      const transform=`translate3d(${this.x.toFixed(2)}px,${this.y.toFixed(2)}px,0) scale(${(this.renderSize/this.size).toFixed(4)})`;
      if(transform!==this.transform){this.root.style.transform=transform;this.transform=transform;}
      const pawTransform=pawWave?`translate3d(${(pawWave*(this.scratchStrikes<2?-2:2)).toFixed(2)}px,${(-3*pawWave).toFixed(2)}px,0) rotate(${(.7*pawWave).toFixed(2)}deg)`:'';
      if(pawTransform!==this.pawTransform){this.canvas.style.transform=pawTransform;this.pawTransform=pawTransform;}
      if(placement&&(state==='peek'||sprite==='peek')){this.root.dataset.pawX=placement.pawX.toFixed(2);this.root.dataset.pawY=placement.pawY.toFixed(2);}
      this.raf=requestAnimationFrame(t=>this.tick(t));
    }
    destroy(){this.hideActionMenu();this.cancelDrag();this.destroyed=true;cancelAnimationFrame(this.raf);this.effects?.destroy();this.abort.abort();this.resizeObserver.disconnect();this.root.remove();this.focusPanel.remove();this.actionMenu.remove();}
  }
  globalThis.PetCompanion=PetCompanion;
})();
