import {deflateRawSync,inflateRawSync} from 'node:zlib';

const table=Uint32Array.from({length:256},(_,value)=>{
  for(let bit=0;bit<8;bit++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;
  return value>>>0;
});
const crc32=bytes=>{
  let value=0xffffffff;
  for(const byte of bytes)value=table[(value^byte)&255]^(value>>>8);
  return (value^0xffffffff)>>>0;
};
function safeName(name){
  if(typeof name!=='string'||!name||name.includes('\\')||name.includes('\0')||name.startsWith('/')||/^[a-z]:/i.test(name)||name.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error(`Unsafe ZIP path: ${name}`);
  return name;
}

// Fixed timestamps, UTF-8 names and Unix file modes keep archives identical on every OS.
export function createZip(input){
  const entries=[...(input instanceof Map?input:Object.entries(input))].sort(([a],[b])=>a<b?-1:a>b?1:0);
  if(entries.length>65535)throw new Error('ZIP64 archives are not supported.');
  const local=[],central=[],seen=new Set();let offset=0;
  for(const [rawName,rawBytes] of entries){
    const name=safeName(rawName),key=name.toLowerCase();
    if(seen.has(key))throw new Error(`Duplicate ZIP path: ${name}`);seen.add(key);
    const filename=Buffer.from(name),bytes=Buffer.from(rawBytes),compressed=deflateRawSync(bytes,{level:9}),crc=crc32(bytes);
    if(filename.length>65535||bytes.length>0xffffffff||compressed.length>0xffffffff||offset>0xffffffff)throw new Error('ZIP64 archives are not supported.');
    const header=Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(0x21,12);
    header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(filename.length,26);
    local.push(header,filename,compressed);
    const record=Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);record.writeUInt16LE(0x314,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(8,10);record.writeUInt16LE(0x21,14);
    record.writeUInt32LE(crc,16);record.writeUInt32LE(compressed.length,20);record.writeUInt32LE(bytes.length,24);record.writeUInt16LE(filename.length,28);record.writeUInt32LE((0o100644<<16)>>>0,38);record.writeUInt32LE(offset,42);
    central.push(record,filename);offset+=header.length+filename.length+compressed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  if(offset+directory.length>0xffffffff)throw new Error('ZIP64 archives are not supported.');
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}

// This bounded reader accepts the stored/deflated, regular-file ZIPs used by releases.
export function readZip(input){
  const bytes=Buffer.from(input),files=new Map(),seen=new Set();
  const fail=()=>{throw new Error('Invalid or unsupported ZIP archive.');};
  const range=(offset,size)=>{if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||offset+size>bytes.length)fail();};
  if(bytes.length<22)fail();
  let end=-1;
  for(let pos=bytes.length-22;pos>=Math.max(0,bytes.length-65557);pos--){
    if(bytes.readUInt32LE(pos)===0x06054b50&&pos+22+bytes.readUInt16LE(pos+20)===bytes.length){end=pos;break;}
  }
  if(end<0||bytes.readUInt16LE(end+4)!==0||bytes.readUInt16LE(end+6)!==0)fail();
  const count=bytes.readUInt16LE(end+10),directorySize=bytes.readUInt32LE(end+12),directoryOffset=bytes.readUInt32LE(end+16);
  if(count!==bytes.readUInt16LE(end+8)||directoryOffset+directorySize!==end)fail();
  let cursor=directoryOffset,total=0;
  for(let index=0;index<count;index++){
    range(cursor,46);if(bytes.readUInt32LE(cursor)!==0x02014b50)fail();
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),crc=bytes.readUInt32LE(cursor+16),compressedSize=bytes.readUInt32LE(cursor+20),size=bytes.readUInt32LE(cursor+24);
    const nameLength=bytes.readUInt16LE(cursor+28),extraLength=bytes.readUInt16LE(cursor+30),commentLength=bytes.readUInt16LE(cursor+32),localOffset=bytes.readUInt32LE(cursor+42);
    if((flags&~0x800)!==0||![0,8].includes(method)||bytes.readUInt16LE(cursor+34)!==0||size>64*1024*1024||(total+=size)>256*1024*1024)fail();
    range(cursor+46,nameLength+extraLength+commentLength);
    const rawName=bytes.subarray(cursor+46,cursor+46+nameLength),name=safeName(rawName.toString('utf8')),key=name.toLowerCase();
    if(!Buffer.from(name).equals(rawName)||seen.has(key))fail();seen.add(key);
    const mode=bytes.readUInt32LE(cursor+38)>>>16;
    if((mode&0o170000)!==0&&(mode&0o170000)!==0o100000)fail();
    range(localOffset,30);if(bytes.readUInt32LE(localOffset)!==0x04034b50||bytes.readUInt16LE(localOffset+6)!==flags||bytes.readUInt16LE(localOffset+8)!==method||bytes.readUInt32LE(localOffset+14)!==crc||bytes.readUInt32LE(localOffset+18)!==compressedSize||bytes.readUInt32LE(localOffset+22)!==size)fail();
    const localNameLength=bytes.readUInt16LE(localOffset+26),localExtraLength=bytes.readUInt16LE(localOffset+28),dataOffset=localOffset+30+localNameLength+localExtraLength;
    range(localOffset+30,localNameLength+localExtraLength);range(dataOffset,compressedSize);
    if(dataOffset+compressedSize>directoryOffset||!bytes.subarray(localOffset+30,localOffset+30+localNameLength).equals(rawName))fail();
    const compressed=bytes.subarray(dataOffset,dataOffset+compressedSize);
    let output;try{output=method===0?Buffer.from(compressed):inflateRawSync(compressed,{maxOutputLength:Math.max(1,size)});}catch{fail();}
    if(output.length!==size||crc32(output)!==crc)fail();files.set(name,output);
    cursor+=46+nameLength+extraLength+commentLength;
  }
  if(cursor!==end)fail();
  return files;
}
