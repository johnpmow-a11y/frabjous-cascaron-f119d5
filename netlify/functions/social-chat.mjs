import {sendPush} from './_push.mjs';
import {randomUUID} from 'node:crypto';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
const headers=(key,extra={})=>({apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),...extra});
async function db(path,options={}){const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)throw new Error('Chat service is not configured.');const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:headers(key,{'Content-Type':'application/json',...(options.headers||{})})});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.message||data.error||'Chat request failed.');return data;}
async function session(token){if(!uuid.test(token))return null;const rows=await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);return rows[0]||null;}
async function adultConfirmed(customerId){const rows=await db(`aam_social_profiles?select=adult_confirmed_at&customer_id=eq.${encodeURIComponent(customerId)}&limit=1`);return !!rows[0]?.adult_confirmed_at;}
async function signedRead(path){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY,bucket=path.startsWith('voice/')?'aam-social-voice':'aam-social-media';const r=await fetch(`${u}/storage/v1/object/sign/${bucket}/${path}`,{method:'POST',headers:headers(k,{'Content-Type':'application/json'}),body:JSON.stringify({expiresIn:1800})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Could not load chat media.');const p=d.signedURL||d.signedUrl||'';return /^https?:\/\//i.test(p)?p:u+(p.startsWith('/storage/v1/')?p:'/storage/v1'+(p.startsWith('/')?p:'/'));}
async function rpc(name,args){return db(`rpc/${name}`,{method:'POST',body:JSON.stringify(args)});}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 try{
  const b=event.httpMethod==='GET'?event.queryStringParameters||{}:JSON.parse(event.body||'{}'),token=String(b.token||''),s=await session(token);
  if(!s)return json(401,{error:'Please log in again.'});
  if(!await adultConfirmed(s.customer_id))return json(403,{error:'Confirm that you are 18 or older to continue.'});
  if(event.httpMethod==='GET'){
   const conv=String(b.conversation_id||'');
   if(conv){
    if(!uuid.test(conv))return json(400,{error:'Invalid conversation.'});
    const part=await db(`aam_chat_participants?select=conversation_id&conversation_id=eq.${conv}&customer_id=eq.${s.customer_id}&limit=1`);
    if(!part.length)return json(404,{error:'Conversation not found.'});
    const [conversationRows,groupMember,otherParticipants]=await Promise.all([db(`aam_chat_conversations?select=id,conversation_type,title&id=eq.${conv}&limit=1`),db(`aam_chat_group_members?select=group_role&conversation_id=eq.${conv}&customer_id=eq.${s.customer_id}&limit=1`),db(`aam_chat_participants?select=customer_id,last_seen_at&conversation_id=eq.${conv}&customer_id=neq.${s.customer_id}`)]);
    const messages=await db(`aam_chat_messages?select=id,sender_id,message_type,body,media_path,shared_post_id,created_at&conversation_id=eq.${conv}&order=created_at.desc&limit=100`);
    messages.reverse();
    const reads=messages.length?await db(`aam_chat_message_reads?select=message_id,customer_id,read_at&message_id=in.(${messages.map(m=>m.id).join(',')})`):[];
    const ids=[...new Set([...messages.map(m=>m.sender_id),...otherParticipants.map(p=>p.customer_id)])];
    const profiles=ids.length?await db(`aam_social_profiles?select=customer_id,profile_id,display_name,bio,avatar_path&customer_id=in.(${ids.join(',')})`):[];
    const senderNames=new Map(profiles.map(p=>[p.customer_id,p]));
    const profileCards=await Promise.all(profiles.map(async p=>({...p,avatar_url:p.avatar_path?await signedRead(p.avatar_path):null})));const pm=new Map(profileCards.map(p=>[p.customer_id,p]));const groupMembers=await Promise.all(otherParticipants.map(async part=>({...pm.get(part.customer_id),last_seen_at:part.last_seen_at||null})));const otherId=otherParticipants[0]?.customer_id||null;
    await rpc('aam_chat_mark_read',{p_token:token,p_conversation:conv});
    return json(200,{conversation:conversationRows[0]||{id:conv,conversation_type:'direct',title:'Conversation'},other_customer_id:otherId,other_profile:otherId?pm.get(otherId)||null:null,other_last_seen_at:otherParticipants.find(p=>p.customer_id===otherId)?.last_seen_at||null,group_members:groupMembers,group_role:groupMember[0]?.group_role||null,messages:await Promise.all(messages.map(async m=>{const {media_path,...publicMessage}=m;return {...publicMessage,media_url:media_path?await signedRead(media_path):null,creator:pm.get(m.sender_id)||{display_name:'Friend'},read_by:reads.filter(r=>r.message_id===m.id)}}))});
   }
   const parts=await db(`aam_chat_participants?select=conversation_id,last_seen_at&customer_id=eq.${s.customer_id}`);
   if(!parts.length)return json(200,{conversations:[]});
   const ids=parts.map(p=>p.conversation_id);
   const [conversations,messages,allParts]=await Promise.all([
    db(`aam_chat_conversations?select=id,updated_at,conversation_type,title&id=in.(${ids.join(',')})&order=updated_at.desc`),
    db(`aam_chat_messages?select=id,conversation_id,sender_id,message_type,body,created_at&conversation_id=in.(${ids.join(',')})&order=created_at.desc`),
    db(`aam_chat_participants?select=conversation_id,customer_id,last_seen_at&conversation_id=in.(${ids.join(',')})`)
   ]);
   const groupIds=conversations.filter(c=>c.conversation_type==='group').map(c=>c.id);
   const memberships=groupIds.length?await db(`aam_chat_group_members?select=conversation_id,customer_id,group_role&conversation_id=in.(${groupIds.join(',')})`):[];
   const ownRoles=new Map(memberships.filter(m=>m.customer_id===s.customer_id).map(m=>[m.conversation_id,m.group_role]));
   const otherIds=[...new Set(allParts.filter(p=>p.customer_id!==s.customer_id).map(p=>p.customer_id))];
   const profiles=otherIds.length?await db(`aam_social_profiles?select=customer_id,profile_id,display_name,avatar_path,last_seen_at&customer_id=in.(${otherIds.join(',')})`):[];
   const profileCards=await Promise.all(profiles.map(async p=>({...p,avatar_url:p.avatar_path?await signedRead(p.avatar_path):null})));const pm=new Map(profileCards.map(p=>[p.customer_id,p]));
   return json(200,{conversations:conversations.map(c=>c.conversation_type==='group'?({...c,other:{display_name:c.title||'All Ads Manager Community',is_group:true,group_role:ownRoles.get(c.id)||'member',member_count:memberships.filter(m=>m.conversation_id===c.id).length,members:memberships.filter(m=>m.conversation_id===c.id).map(m=>({...pm.get(m.customer_id),group_role:m.group_role}))},last_message:messages.find(m=>m.conversation_id===c.id)||null}):({...c,other:allParts.filter(p=>p.conversation_id===c.id&&p.customer_id!==s.customer_id).map(p=>({...pm.get(p.customer_id),last_seen_at:p.last_seen_at}))[0]||{},last_message:messages.find(m=>m.conversation_id===c.id)||null}))});
  }
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
  if(b.action==='sign_media_upload'){
   const mime=String(b.mime_type||''),ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'}[mime];
   if(!ext)return json(400,{error:'Choose a supported image or video.'});
   const path=`${s.customer_id}/chat/${randomUUID()}.${ext}`,u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
   const r=await fetch(`${u}/storage/v1/object/upload/sign/aam-social-media/${path}`,{method:'POST',headers:headers(k,{'Content-Type':'application/json'}),body:'{}'});
   const d=await r.json().catch(()=>({}));if(!r.ok)return json(502,{error:d.message||'Could not prepare the attachment.'});
   return json(200,{path,token:d.token,message_type:mime.startsWith('video/')?'video':'image'});
  }
  if(b.action==='sign_voice_upload'){
   const mime=String(b.mime_type||'audio/webm');if(!['audio/webm','audio/mp4'].includes(mime))return json(400,{error:'Unsupported voice-note format.'});
   const ext=mime==='audio/mp4'?'m4a':'webm',path=`voice/${s.customer_id}/${randomUUID()}.${ext}`,u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
   const r=await fetch(`${u}/storage/v1/object/upload/sign/aam-social-voice/${path}`,{method:'POST',headers:headers(k,{'Content-Type':'application/json'}),body:'{}'});
   const d=await r.json().catch(()=>({}));if(!r.ok)return json(502,{error:d.message||'Could not prepare the voice note.'});
   return json(200,{path,token:d.token});
  }
  if(b.action==='touch'){if(!uuid.test(String(b.conversation_id||'')))return json(400,{error:'Invalid conversation.'});return json(200,await rpc('aam_chat_touch',{p_token:token,p_conversation:b.conversation_id}));}
  if(b.action==='start'){if(!uuid.test(String(b.target_customer_id||'')))return json(400,{error:'Choose a valid profile.'});return json(200,await rpc('aam_chat_start',{p_token:token,p_target:b.target_customer_id}));}
  if(b.action==='send'){
   if(!uuid.test(String(b.conversation_id||'')))return json(400,{error:'Invalid conversation.'});
   const recipients=await db(`aam_chat_participants?select=customer_id&conversation_id=eq.${b.conversation_id}&customer_id=neq.${s.customer_id}`);
   const result=await rpc('aam_chat_send',{p_token:token,p_conversation:b.conversation_id,p_body:String(b.body||''),p_type:String(b.message_type||'text'),p_media_path:b.media_path||null,p_shared_post:b.shared_post_id||null});
   await Promise.allSettled(recipients.map(x=>sendPush({role:'customer',customerId:x.customer_id,title:'New message',body:String(b.message_type==='voice'?'You received a voice note.':b.message_type==='shared_post'?'Someone shared a post with you.':b.message_type==='image'||b.message_type==='video'?'You received a media message.':b.body||'You have a new message.').slice(0,180),eventType:b.message_type==='shared_post'?'share':'message'})));
   return json(200,result);
  }
  return json(400,{error:'Unsupported chat action.'});
 }catch(e){return json(/session expired/i.test(e.message)?401:400,{error:e.message||'Could not complete that chat action.'});}
}
