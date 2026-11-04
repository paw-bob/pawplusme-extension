(() => {
  'use strict';
  const DATABASE='pawplusme-pets',PETS='pets',METADATA='pet-metadata';
  const messages={read:'宠物列表暂时无法读取，请重新打开插件。',write:'宠物暂时无法保存，请检查浏览器存储空间后重试。'};
  const failure=type=>Object.assign(new Error(messages[type]),{code:`PET_LIBRARY_${type.toUpperCase()}_FAILED`});
  const validId=id=>typeof id==='string'&&id.length>0&&id.length<=128;
  const metadata=pet=>({id:pet.id,name:typeof pet.name==='string'&&pet.name?pet.name:'小伴',revision:typeof pet.revision==='string'?pet.revision:''});

  function create({indexedDB=globalThis.indexedDB}={}){
    let databasePromise;
    function open(){
      if(!indexedDB?.open)return Promise.reject(new Error('IndexedDB unavailable'));
      if(!databasePromise){
        databasePromise=new Promise((resolve,reject)=>{
          const request=indexedDB.open(DATABASE,1);let failed=false;
          request.onupgradeneeded=()=>{
            const database=request.result;
            for(const store of [PETS,METADATA])if(!database.objectStoreNames.contains(store))database.createObjectStore(store,{keyPath:'id'});
          };
          request.onerror=()=>{failed=true;reject(request.error);};
          request.onblocked=()=>{failed=true;reject(new Error('IndexedDB blocked'));};
          request.onsuccess=()=>{
            const database=request.result;
            if(failed){database.close();return;}
            database.onversionchange=()=>{database.close();databasePromise=null;};
            resolve(database);
          };
        });
        databasePromise.catch(()=>{databasePromise=null;});
      }
      return databasePromise;
    }
    async function run(stores,mode,perform){
      const type=mode==='readonly'?'read':'write';
      try{
        const database=await open();
        return await new Promise((resolve,reject)=>{
          const transaction=database.transaction(stores,mode);let result;
          transaction.oncomplete=()=>resolve(result);
          transaction.onerror=transaction.onabort=()=>reject(transaction.error);
          try{perform(transaction,value=>{result=value;});}
          catch(error){try{transaction.abort();}catch{}reject(error);}
        });
      }catch{throw failure(type);}
    }
    return Object.freeze({
      list(){return run([METADATA],'readonly',(transaction,done)=>{
        const request=transaction.objectStore(METADATA).getAll();
        request.onsuccess=()=>done(request.result.filter(pet=>pet&&validId(pet.id)).map(metadata));
      });},
      get(id){return run([PETS],'readonly',(transaction,done)=>{
        const request=transaction.objectStore(PETS).get(id);
        request.onsuccess=()=>done(request.result??null);
      });},
      async put(pet){
        if(!pet||typeof pet!=='object'||!validId(pet.id))throw failure('write');
        return run([PETS,METADATA],'readwrite',transaction=>{
          transaction.objectStore(PETS).put(pet);
          transaction.objectStore(METADATA).put(metadata(pet));
        });
      },
      remove(id){return run([PETS,METADATA],'readwrite',transaction=>{
        transaction.objectStore(PETS).delete(id);
        transaction.objectStore(METADATA).delete(id);
      });}
    });
  }
  globalThis.PetLibrary=Object.freeze({...create(),create});
})();
