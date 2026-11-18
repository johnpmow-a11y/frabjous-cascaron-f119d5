import {randomUUID} from 'node:crypto';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
const headers=(key,extra={})=>({apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),...extra});
async function db(path,options={}){const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)throw new Error('Chat service is not configured.');const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:headers(key,{'Content-Type':'application/json',...(options.headers||{})})});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.message||data.error||'Chat request failed.');return data;}
async function session(token){if(!uuid.test(token))return null;const rows=await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);return rows[0]||null;}
async function signedRead(path){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;const r=await fetch(`${u}/storage/v1/object/sign/aam-social-media/${path}`,{method:'POST',headers:headers(k,{'Content-Type':'application/json'}),body:JSON.stringify({expiresIn:1800})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Could not load chat media.');const p=d.signedURL||d.signedUrl||'';return /^https?:\/\//i.test(p)?p:u+(p.startsWith('/storage/v1/')?p:'/storage/v1'+(p.startsWith('/')?p:'/'));}
async function rpc(name,args){return db(`rpc/${name}`,{method:'POST',body:JSON.stringify(args)});}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 try{
  const b=event.httpMethod==='GET'?event.queryStringParameters||{}:JSON.parse(event.body||'{}'),token=String(b.token||''),s=await session(token);
  if(!s)return json(401,{error:'Please log in again.'});
  if(event.httpMethod==='GET'){
   const conv=String(b.conversation_id||'');
   if(conv){
    if(!uuid.test(conv))return json(400,{error:'Invalid conversation.'});
    const part=await db(`aam_chat_participants?select=conversation_id&conversation_id=eq.${conv}&customer_id=eq.${s.customer_id}&limit=1`);
    if(!part.length)return json(404,{error:'Conversation not found.'});
    const messages=await db(`aam_chat_messages?select=id,sender_id,message_type,body,media_path,shared_post_id,created_at&conversation_id=eq.${conv}&order=created_at.asc&limit=100`);
    const reads=messages.length?await db(`aam_chat_message_reads?select=message_id,customer_id,read_at&message_id=in.(${messages.map(m=>m.id).join(',')})`):[];
    const ids=[...new Set(messages.map(m=>m.sender_id))];
    const profiles=ids.length?await db(`aam_social_profiles?select=customer_id,display_name,avatar_path&customer_id=in.(${ids.join(',')})`):[];
    const pm=new Map(profiles.map(p=>[p.customer_id,p]));
    await rpc('aam_chat_mark_read',{p_token:token,p_conversation:conv});
    return json(200,{messages:await Promise.all(messages.map(async m=>({...m,media_url:m.media_path?await signedRead(m.media_path):null,creator:pm.get(m.sender_id)||{display_name:'Creator'},read_by:reads.filter(r=>r.message_id===m.id)})))});
   }
   const parts=await db(`aam_chat_participants?select=conversation_id,last_seen_at&customer_id=eq.${s.customer_id}`);
   if(!parts.length)return json(200,{conversations:[]});
   const ids=parts.map(p=>p.conversation_id);
   const [conversations,messages,allParts]=await Promise.all([
    db(`aam_chat_conversations?select=id,updated_at&id=in.(${ids.join(',')})&order=updated_at.desc`),
    db(`aam_chat_messages?select=id,conversation_id,sender_id,message_type,body,created_at&conversation_id=in.(${ids.join(',')})&order=created_at.desc`),
    db(`aam_chat_participants?select=conversation_id,customer_id,last_seen_at&conversation_id=in.(${ids.join(',')})`)
   ]);
   const otherIds=[...new Set(allParts.filter(p=>p.customer_id!==s.customer_id).map(p=>p.customer_id))];
   const profiles=otherIds.length?await db(`aam_social_profiles?select=customer_id,display_name,avatar_path&customer_id=in.(${otherIds.join(',')})`):[];
   const pm=new Map(profiles.map(p=>[p.customer_id,p]));
   return json(200,{conversations:conversations.map(c=>({ ...c,other:allParts.filter(p=>p.conversation_id===c.id&&p.customer_id!==s.customer_id).map(p=>({...pm.get(p.customer_id),last_seen_at:p.last_seen_at}))[0]||{},last_message:messages.find(m=>m.conversation_id===c.id)||null }))});
  }
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
  if(b.action==='sign_voice_upload'){
   const mime=String(b.mime_type||'audio/webm');if(!['audio/webm','audio/mp4'].includes(mime))return json(400,{error:'Unsupported voice-note format.'});
   const ext=mime==='audio/mp4'?'m4a':'webm',path=`${s.customer_id}/voice/${randomUUID()}.${ext}`,u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
   const r=await fetch(`${u}/storage/v1/object/upload/sign/aam-social-media/${path}`,{method:'POST',headers:headers(k,{'Content-Type':'application/json'}),body:'{}'});
   const d=await r.json().catch(()=>({}));if(!r.ok)return json(502,{error:d.message||'Could not prepare the voice note.'});
   return json(200,{path,token:d.token});
  }
  if(b.action==='start'){if(!uuid.test(String(b.target_customer_id||'')))return json(400,{error:'Choose a valid profile.'});return json(200,await rpc('aam_chat_start',{p_token:token,p_target:b.target_customer_id}));}
  if(b.action==='send'){
   if(!uuid.test(String(b.conversation_id||'')))return json(400,{error:'Invalid conversation.'});
   return json(200,await rpc('aam_chat_send',{p_token:token,p_conversation:b.conversation_id,p_body:String(b.body||''),p_type:String(b.message_type||'text'),p_media_path:b.media_path||null,p_shared_post:b.shared_post_id||null}));
  }
  return json(400,{error:'Unsupported chat action.'});
 }catch(e){return json(/session expired/i.test(e.message)?401:400,{error:e.message||'Could not complete that chat action.'});}
}
