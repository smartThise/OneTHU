/** Native-only bridge for private calendar records; never a model tool. */
import { fileRead, fileWrite, fileDelete, session } from '../lib/clients.js';
import { isCliTransferBusy, sharedAccountGuard, sharedRuntimeRequest, usesSharedRuntime } from '../lib/sharedRuntime.js';
const names=['caldav.cfg','caldav.local','caldav.cache'] as const;
type Document={content:string|null;revision:string};
const documents=new Map<string,Document>();
let preparing:Promise<void>|undefined,preparedOwner='';
export async function prepareSharedCalendar(){
  if(!usesSharedRuntime()||session.state!=='ready')return;
  if(preparedOwner===session.username)return;
  if(preparing){await preparing;if(preparedOwner===session.username)return;}
  const owner=session.username;
  const pending=(async()=>{
    const guard=await sharedAccountGuard(owner);
    const saved=await fileRead("caldav.shared-base",{strict:true});
    const base=saved?JSON.parse(saved):null;
    for(const name of names){
      const content=await fileRead(name,{strict:true});
      const result=await sharedRuntimeRequest<Document>('dataBootstrap',{...guard,name,content,...(base?.owner===owner&&Object.hasOwn(base.documents??{},name)?{baseContent:base.documents[name]}:{})});
      if(session.username!==owner)throw new Error('CLI_SHARED_SESSION_CHANGED');
      documents.set(name,result);
    }preparedOwner=owner;
  })();preparing=pending;
  try{await pending;}finally{if(preparing===pending)preparing=undefined;}
}
export async function readCalendarDocument(name:string):Promise<string|null>{
  if(!usesSharedRuntime()||session.state!=='ready')return fileRead(name,{strict:true});
  await prepareSharedCalendar();
  const guard=await sharedAccountGuard(session.username);
  const document=await sharedRuntimeRequest<Document>('dataRead',{...guard,name});
  documents.set(name,document);return document.content;
}
export async function writeCalendarDocument(name:string,content:string|null){
  if(isCliTransferBusy())throw new Error("CLI_TRANSFER_BUSY");
  if(!usesSharedRuntime()||session.state!=='ready')return content===null?fileDelete(name,{strict:true}):fileWrite(name,content,{strict:true});
  await prepareSharedCalendar();
  const document=documents.get(name);if(!document)throw new Error('APP_DATA_NOT_LOADED');
  const guard=await sharedAccountGuard(session.username);
  documents.set(name,await sharedRuntimeRequest<Document>('dataWrite',{...guard,name,content,revision:document.revision}));
}
export async function exportCalendarToApp(){
  const owner=session.username;const baseline:Record<string,string|null>={};
  for(const name of names){const content=await readCalendarDocument(name);baseline[name]=content;if(content===null)await fileDelete(name,{strict:true});else await fileWrite(name,content,{strict:true});}
  if(session.username!==owner)throw new Error("CLI_SHARED_SESSION_CHANGED");
  await fileWrite("caldav.shared-base",JSON.stringify({owner,documents:baseline}),{strict:true});
}

if(typeof window!=="undefined")window.addEventListener("onethu-cli-installation",()=>{preparedOwner="";documents.clear();});
