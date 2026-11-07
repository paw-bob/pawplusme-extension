import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';
const scope=vm.createContext({...configGlobals(),});
vm.runInContext(await readFile(new URL('../dist/extension/pet-focus.js',import.meta.url),'utf8'),scope);
const {PetFocus:F}=scope,now=new Date(2026,10,1,12).getTime();

test('closing a caught round stops only that round and remains off after storage restore',()=>{
  const caught=F.transition(F.transition(null,{type:'preview'},now),{type:'catch',cycle:now},now);
  const closed=F.transition(caught,{type:'stop',cycle:caught.cycle},now+1);
  assert.equal(closed.phase,'off');assert.equal(F.deadline(closed),0);
  let saved=JSON.stringify(closed);
  assert.equal(F.restore({getItem:()=>saved,setItem:(_key,value)=>saved=value},'focus',now+1000).phase,'off');
  const waiting=F.transition(closed,{type:'start'},now+2000);
  assert.deepEqual(F.transition(waiting,{type:'stop',cycle:caught.cycle},now+3000),waiting,'a stale close must not cancel a new timer');
  assert.equal(F.transition(waiting,{type:'stop'},now+3000).phase,'off','explicit Turn off timer still stops any timer');
});

test('starts a real 25-minute deadline and restores elapsed time without restarting it',()=>{
  const state=F.transition(null,{type:'start'},now);
  assert.equal(state.dueAt,now+25*60_000);assert.equal(F.clock(state,now),'25:00');
  const restored=JSON.parse(JSON.stringify(state));
  assert.equal(F.advance(restored,now+24*60_000).phase,'waiting');
  assert.equal(F.advance(restored,state.dueAt).phase,'mischief');
  assert.equal(F.advance(F.advance(restored,state.dueAt),now+50*60_000).phase,'mischief');
});
test('only catching the current round unlocks choices, and snoozes begin when selected',()=>{
  const playing=F.transition(null,{type:'preview'},now);
  assert.equal(F.transition(playing,{type:'later25',cycle:playing.cycle},now+1000).phase,'mischief');
  assert.equal(F.transition(playing,{type:'catch',cycle:playing.cycle-1},now).phase,'mischief');
  const caught=F.transition(playing,{type:'catch',cycle:playing.cycle},now+1000);
  assert.equal(caught.phase,'caught');
  const next=F.transition(caught,{type:'later25',cycle:caught.cycle},now+5000);
  assert.equal(next.dueAt,now+5000+25*60_000);
  assert.equal(F.transition(caught,{type:'later50',cycle:caught.cycle},now+5000).dueAt,now+5000+50*60_000);
  assert.equal(F.transition(next,{type:'later50',cycle:caught.cycle},now+6000),next,'stale panels must not reset a newer round');
});
test('today stays quiet through refresh and starts a new 25 minutes after local midnight',()=>{
  const caught=F.transition(F.transition(null,{type:'preview'},now),{type:'catch',cycle:now},now);
  const quiet=F.transition(caught,{type:'today',cycle:caught.cycle},now);
  const midnight=new Date(2026,10,2).getTime();
  assert.equal(quiet.quietUntil,midnight);assert.equal(F.deadline(quiet),midnight);
  assert.equal(F.advance(JSON.parse(JSON.stringify(quiet)),midnight-1).phase,'quiet');
  const next=F.advance(quiet,midnight+60_000);
  assert.equal(next.phase,'waiting');assert.equal(next.dueAt,midnight+26*60_000);
  assert.equal(F.transition(next,{type:'stop'},midnight+60_000).phase,'off');
});

test('opening after midnight persists the new deadline before a subsequent page refresh',()=>{
  const midnight=new Date(2026,10,2).getTime();
  const data=new Map([['focus',JSON.stringify({phase:'quiet',dueAt:0,quietUntil:midnight,cycle:0})]]);
  const storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
  const opened=F.restore(storage,'focus',midnight+5*60_000);
  assert.equal(opened.phase,'waiting');assert.equal(opened.dueAt,midnight+30*60_000);
  assert.equal(JSON.parse(storage.getItem('focus')).dueAt,opened.dueAt);
  const refreshed=F.restore(storage,'focus',midnight+5*60_000+8000);
  assert.equal(refreshed.dueAt,opened.dueAt,'refresh must preserve the first restored deadline');
});
