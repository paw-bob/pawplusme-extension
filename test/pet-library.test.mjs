import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {configGlobals} from './extension-fixture.mjs';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../dist/extension/pet-library.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// A small IDB protocol fixture, not a real browser database. Transactions stage
// writes until complete and can abort after successful individual requests.
function indexedDBFixture(){
  const databases=new Map(),reads=[],waiting=[];
  let pauseCommits=false,blocked=false,failure;
  const factory={
    open(name,version){
      const request={};
      setImmediate(()=>{
        if(blocked){request.onblocked?.();return;}
        let database=databases.get(name),created=!database;
        if(created){database={version,stores:new Map()};databases.set(name,database);}
        const connection={objectStoreNames:{contains:key=>database.stores.has(key)},close(){},
          createObjectStore(key){database.stores.set(key,new Map());},
          transaction(names,mode){
            names=Array.isArray(names)?names:[names];
            const writes=mode==='readwrite',staged=new Map(names.map(key=>[key,writes?new Map(database.stores.get(key)):database.stores.get(key)]));
            let pending=0,aborted=false,scheduled=false;
            const transaction={error:null,objectStore(key){
              const operation=(kind,fn)=>{
                const request={};pending++;
                setImmediate(()=>{
                  if(aborted)return;
                  if(failure?.store===key&&failure?.operation===kind){
                    transaction.error=new Error(failure.message);failure=null;aborted=true;
                    request.error=transaction.error;request.onerror?.();transaction.onerror?.();transaction.onabort?.();return;
                  }
                  request.result=fn(staged.get(key));reads.push({store:key,operation:kind});
                  request.onsuccess?.();pending--;
                  if(!pending&&!scheduled){scheduled=true;const complete=()=>{
                    if(aborted)return;
                    if(writes)for(const [key,value]of staged)database.stores.set(key,value);
                    transaction.oncomplete?.();
                  };if(pauseCommits)waiting.push(complete);else setImmediate(complete);}
                });
                return request;
              };
              return {get:id=>operation('get',store=>structuredClone(store.get(id))),getAll:()=>operation('getAll',store=>structuredClone([...store.values()])),
                put:value=>operation('put',store=>{store.set(value.id,structuredClone(value));return value.id;}),delete:id=>operation('delete',store=>store.delete(id))};
            }};
            return transaction;
          }
        };
        request.result=connection;
        if(created)request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
    reads,
    fail(store,operation,message='quota exceeded'){failure={store,operation,message};},
    pause(){pauseCommits=true;},
    resume(){pauseCommits=false;for(const complete of waiting.splice(0))complete();},
    block(value){blocked=value;}
  };
  return factory;
}
function library(factory=indexedDBFixture()){
  const context=vm.createContext({...configGlobals(),indexedDB:factory,Promise,Error});vm.runInContext(source,context);
  return {api:context.PetLibrary,factory};
}
const pet=(id,name=id,revision='r1')=>({id,name,revision,image:'data:image/png;base64,'+'a'.repeat(1024),columns:8,rows:20,cellSize:192,animations:{look:[0,1],run:[2,3],sleep:[4,5],peek:[6,7]}});
const plain=value=>JSON.parse(JSON.stringify(value));

test('archives full pets by id, lists only small metadata, and persists across library instances',async()=>{
  const {api,factory}=library(),first=pet('first','Milo'),second=pet('second','Luna');
  await api.put(first);await api.put(second);
  assert.deepEqual(plain(await api.get('first')),first);
  factory.reads.length=0;
  assert.deepEqual(plain(await api.list()),[{id:'first',name:'Milo',revision:'r1'},{id:'second',name:'Luna',revision:'r1'}]);
  assert.ok(factory.reads.every(item=>item.store==='pet-metadata'),'listing must not load the full pet images');
  const reopened=api.create({indexedDB:factory});
  assert.deepEqual(plain(await reopened.get('second')),second);
  assert.equal(await reopened.get('absent'),null);
});

test('upserts an existing id without duplicating the pet and removes both records',async()=>{
  const {api}=library();await api.put(pet('same','Old'));await api.put(pet('same','New','r2'));
  assert.deepEqual(plain(await api.list()),[{id:'same',name:'New',revision:'r2'}]);
  assert.equal((await api.get('same')).revision,'r2');
  await api.remove('same');assert.deepEqual(plain(await api.list()),[]);assert.equal(await api.get('same'),null);
});

test('a put resolves only after the transaction completes',async()=>{
  const {api,factory}=library();await api.list();factory.pause();
  let saved=false;const saving=api.put(pet('pending')).then(()=>{saved=true;});
  await tick();await tick();await tick();assert.equal(saved,false);
  factory.resume();await saving;assert.equal(saved,true);assert.equal((await api.get('pending')).id,'pending');
});

test('an aborted metadata write keeps both the previous pet and its metadata',async()=>{
  const {api,factory}=library();await api.put(pet('same','Original','r1'));
  factory.fail('pet-metadata','put');
  await assert.rejects(api.put(pet('same','Replacement','r2')),error=>error.code==='PET_LIBRARY_WRITE_FAILED');
  assert.equal((await api.get('same')).name,'Original');
  assert.deepEqual(plain(await api.list()),[{id:'same',name:'Original',revision:'r1'}]);
});

test('failed reads have a stable friendly error and blocked opens can recover',async()=>{
  const {api,factory}=library();await api.put(pet('one'));factory.fail('pet-metadata','getAll','read failed');
  await assert.rejects(api.list(),error=>error.code==='PET_LIBRARY_READ_FAILED'&&!error.message.includes('read failed'));
  const other=indexedDBFixture();other.block(true);const blocked=api.create({indexedDB:other});
  await assert.rejects(blocked.list(),error=>error.code==='PET_LIBRARY_READ_FAILED');
  other.block(false);assert.deepEqual(plain(await blocked.list()),[]);
});

test('invalid pets and unavailable IndexedDB fail without writing anything',async()=>{
  const {api,factory}=library();await assert.rejects(api.put({id:''}),error=>error.code==='PET_LIBRARY_WRITE_FAILED');
  assert.deepEqual(factory.reads,[]);
  const unavailable=api.create({indexedDB:null});
  await assert.rejects(unavailable.get('one'),error=>error.code==='PET_LIBRARY_READ_FAILED');
  await assert.rejects(unavailable.put(pet('one')),error=>error.code==='PET_LIBRARY_WRITE_FAILED');
});
