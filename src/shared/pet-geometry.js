(() => {
  function pawPlacement(rect, preferredSize, viewport, anchor = {x:.5,y:.32}) {
    const room = Math.max(0, viewport.height - rect.bottom - 8);
    const size = Math.min(preferredSize, Math.max(40, room / (0.9375-anchor.y)));
    const pawX = Math.max(size*.5+8, Math.min(viewport.width-size*.5-8, rect.right-Math.min(56,rect.width*.3)));
    return {x:pawX-anchor.x*size,y:rect.bottom-anchor.y*size,size,pawX,pawY:rect.bottom};
  }
  function gazeFrame({mouse,position,size,count,previous,dt,reducedMotion=false,anchor={x:.5,y:.24},angles}){
    const dx=mouse.x-position.x-size*anchor.x,dy=mouse.y-position.y-size*anchor.y;
    if(previous&&Math.hypot(dx,dy)<Math.max(8,size*.06))return previous;
    const target=Math.atan2(dy,dx),step=Math.PI*2/count;
    let angle=target;
    if(previous&&!reducedMotion){
      const delta=Math.atan2(Math.sin(target-previous.angle),Math.cos(target-previous.angle));
      const move=Math.min(Math.abs(delta)*(1-Math.exp(-Math.max(0,dt)*14)),Math.max(0,dt)*Math.PI*2);
      angle=previous.angle+Math.sign(delta)*move;
    }
    let index=((Math.round(angle/step)%count)+count)%count;
    const distance=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
    if(angles){
      let best=Infinity;
      for(let i=0;i<count;i++){const error=distance(angle,angles[i]);if(error<best){best=error;index=i;}}
    }
    if(previous&&!reducedMotion&&previous.index<count){
      const pose=angles?.[previous.index]??previous.index*step;
      const spacing=angles?Math.min(distance(pose,angles[(previous.index+count-1)%count]),distance(pose,angles[(previous.index+1)%count])):step;
      if(distance(angle,pose)<spacing*.6)index=previous.index;
    }
    return {angle,index};
  }
  const runHeadings=['e','se','s','sw','w','nw','n','ne'];
  function runDirection({dx,dy,previous}){
    const prior=runHeadings.indexOf(previous),distance=Math.hypot(dx,dy);
    if(!Number.isFinite(distance)||distance<=.001)return prior<0?'e':previous;
    const angle=Math.atan2(dy,dx),sector=Math.PI/4;
    // Five extra degrees keep small pointer wobbles from changing the body view.
    if(prior>=0&&Math.abs(Math.atan2(Math.sin(angle-prior*sector),Math.cos(angle-prior*sector)))<=sector/2+Math.PI/36)return previous;
    return runHeadings[(Math.round(angle/sector)+8)%8];
  }
  globalThis.PetGeometry = {pawPlacement,gazeFrame,runDirection};
})();
