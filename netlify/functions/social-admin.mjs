import {randomUUID} from 'node:crypto';
import {sendPush} from './_push.mjs';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
const mimeExt={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'};
const h=(key,extra={})=>({apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),...extra});
async function db(path,options={}){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw new Error('Admin social service is not configured.');const r=await fetch(`${u}/rest/v1/${path}`,{...options,headers:h(k,{'Content-Type':'application/json',...(options.headers||{})})});const d=await r.json().catch(()=>[]);if(!r.ok)throw new Error(d.message||d.error||'Admin social request failed.');return d;}
async function adminSession(token){if(!uuid.test(token))return null;const rows=await db(`admin_sessions?select=token&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);return rows[0]||null;}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 try{
  if(event.httpMethod==='GET'){
   const q=event.queryStringParameters||{};if(!await adminSession(String(q.token||'')))return json(401,{error:'Administrator login required.'});
   const [rows,posts,comments]=await Promise.all([db('aam_social_admin_profile?select=display_name,avatar_path,follower_count,is_verified&id=eq.true&limit=1'),db('aam_social_posts?select=id,media_type,caption,created_at,author_role&order=created_at.desc&limit=30'),db('aam_social_comments?select=id,post_id,customer_id,body,created_at&order=created_at.desc&limit=60')]);
   const ids=[...new Set(comments.map(c=>c.customer_id))],profiles=ids.length?await db('aam_social_profiles?select=customer_id,display_name&customer_id=in.('+ids.join(',')+')'):[],pm=new Map(profiles.map(p=>[p.customer_id,p.display_name]));
   return json(200,{profile:rows[0]||{display_name:'All Ads Manager',follower_count:0,is_verified:true},posts,comments:comments.map(c=>({...c,creator_name:pm.get(c.customer_id)||'Creator'}))});
  }
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
  const b=JSON.parse(event.body||'{}'),token=String(b.token||'');if(!await adminSession(token))return json(401,{error:'Administrator login required.'});
  if(b.action==='update_profile'){
   const name=String(b.display_name||'All Ads Manager').trim().slice(0,40),count=Number(b.follower_count);
   if(!name||!Number.isInteger(count)||count<0||count>100000000)return json(400,{error:'Enter a display name and follower count from 0 to 100,000,000.'});
   const rows=await db('aam_social_admin_profile?id=eq.true',{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({display_name:name,follower_count:count,updated_at:new Date().toISOString()})});
   return json(200,{saved:true,profile:rows[0]});
  }
  if(b.action==='sign_upload'){
   const mime=String(b.mime_type||''),ext=mimeExt[mime];if(!ext)return json(400,{error:'Choose a supported image or video.'});
   const path=`admin/${randomUUID()}.${ext}`,u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
   const r=await fetch(`${u}/storage/v1/object/upload/sign/aam-social-media/${path}`,{method:'POST',headers:h(k,{'Content-Type':'application/json'}),body:'{}'});
   const d=await r.json().catch(()=>({}));if(!r.ok)return json(502,{error:d.message||'Could not prepare admin media upload.'});
   return json(200,{path,token:d.token});
  }
  if(b.action==='publish_post'){
   const path=String(b.media_path||''),mime=String(b.mime_type||''),ext=mimeExt[mime];
   if(!ext||!path.startsWith('admin/')||path.includes('..'))return json(400,{error:'Invalid administrator media.'});
   const rows=await db('aam_social_posts',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify([{customer_id:null,author_role:'admin',media_type:mime.startsWith('video/')?'video':'image',media_path:path,caption:String(b.caption||'').trim().slice(0,2200),moderation_status:'published'}])});
   return json(200,{ok:true,post:rows[0]});
  }
  if(b.action==='delete_post'){
   if(!uuid.test(String(b.post_id||'')))return json(400,{error:'Invalid post.'});
   await db(`aam_social_posts?id=eq.${b.post_id}`,{method:'PATCH',body:JSON.stringify({moderation_status:'removed',updated_at:new Date().toISOString()})});
   return json(200,{deleted:true});
  }
  if(b.action==='delete_comment'){
   if(!uuid.test(String(b.comment_id||'')))return json(400,{error:'Invalid comment.'});
   await db(`aam_social_comments?id=eq.${b.comment_id}`,{method:'DELETE'});
   return json(200,{deleted:true});
  }
  if(b.action==='set_avatar'){
   const path=String(b.avatar_path||'');if(!path.startsWith('admin/')||path.includes('..'))return json(400,{error:'Invalid administrator avatar.'});
   await db('aam_social_admin_profile?id=eq.true',{method:'PATCH',body:JSON.stringify({avatar_path:path,updated_at:new Date().toISOString()})});
   const customers=await db('customers?select=id');if(customers.length){await db('aam_social_notifications',{method:'POST',body:JSON.stringify(customers.map(c=>({recipient_id:c.id,actor_id:null,event_type:'profile_update',title:'Creator picture updated',body:'All Ads Manager updated its creator picture.'})))});await Promise.allSettled(customers.map(c=>sendPush({role:'customer',customerId:c.id,title:'Creator picture updated',body:'All Ads Manager updated its creator picture.',eventType:'profile_update'})));}
   return json(200,{saved:true});
  }
  return json(400,{error:'Unsupported admin social action.'});
 }catch(e){return json(/administrator login required/i.test(e.message)?401:400,{error:e.message||'Could not complete admin social action.'});}
}
