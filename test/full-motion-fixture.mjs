// Synthetic asset metadata only: no photographs, generator prompts or supplier code.
export function fullPetFixture(pet){
  const sequence=start=>Array.from({length:96},(_,i)=>start+i);
  const physical={e:sequence(96),se:sequence(192),s:sequence(288),ne:sequence(384),n:sequence(480)};
  const directions=['e','se','s','sw','w','nw','n','ne'];
  return {...pet,motionProfile:'full-96-eight-way-v1',requiredLookFrames:96,requiredMotionFrames:96,requiredRunDirections:8,
    schemaVersion:3,columns:16,rows:48,cellSize:192,
    animations:{look:sequence(0),run:physical.e,sleep:sequence(576),peek:sequence(672)},
    runDirections:Object.fromEntries(directions.map(name=>[name,{frames:[...physical[{w:'e',sw:'se',nw:'ne'}[name]||name]],flip:['w','sw','nw'].includes(name)}])),
    fps:{look:24,run:24,sleep:24,peek:24},motion:'continuous-video',
    motionActions:['look','run','run_se','run_s','run_ne','run_n','sleep','peek'],motionProvider:'fixture',
    gaze:{frames:96,anchor:{x:.5,y:.24},angles:sequence(0).map(i=>i*Math.PI/48),approximate:true,reviewed:false}};
}
