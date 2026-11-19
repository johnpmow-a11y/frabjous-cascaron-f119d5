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
   const [rows,posts,comments,groupMembers,coinSales,videoEarnings,coinBalances]=await Promise.all([db('aam_social_admin_profile?select=display_name,avatar_path,follower_count,is_verified&id=eq.true&limit=1'),db('aam_social_posts?select=id,media_type,caption,created_at,author_role&order=created_at.desc&limit=30'),db('aam_social_comments?select=id,post_id,customer_id,body,created_at&order=created_at.desc&limit=60'),db('aam_chat_group_members?select=customer_id,group_role,joined_at&conversation_id=eq.a0000000-0000-4000-8000-000000000001&order=joined_at.desc&limit=500'),db('aam_social_coin_payments?select=amount_kobo,coin_amount,paid_at&status=eq.paid'),db('aam_social_video_earnings?select=amount_naira,created_at'),db('aam_coin_balances?select=free_coins,purchased_coins')]);
   const ids=[...new Set(comments.map(c=>c.customer_id))],profiles=ids.length?await db('aam_social_profiles?select=customer_id,display_name&customer_id=in.('+ids.join(',')+')'):[],pm=new Map(profiles.map(p=>[p.customer_id,p.display_name]));
   const memberIds=groupMembers.map(m=>m.customer_id),memberRows=memberIds.length?await db('customers?select=id,name&id=in.('+memberIds.join(',')+')'):[],memberNames=new Map(memberRows.map(m=>[m.id,m.name]));
   const coinAccounting={verified_coin_sales_naira:coinSales.reduce((n,x)=>n+Number(x.amount_kobo||0)/100,0),verified_coins_sold:coinSales.reduce((n,x)=>n+Number(x.coin_amount||0),0),video_earnings_naira:videoEarnings.reduce((n,x)=>n+Number(x.amount_naira||0),0),free_coins_outstanding:coinBalances.reduce((n,x)=>n+Number(x.free_coins||0),0),purchased_coins_outstanding:coinBalances.reduce((n,x)=>n+Number(x.purchased_coins||0),0)};return json(200,{coin_accounting:coinAccounting,profile:rows[0]||{display_name:'All Ads Manager',follower_count:0,is_verified:true},posts,comments:comments.map(c=>({...c,creator_name:pm.get(c.customer_id)||'Creator'})),group_members:groupMembers.map(m=>({customer_id:m.customer_id,name:memberNames.get(m.customer_id)||'Customer',group_role:m.group_role,joined_at:m.joined_at}))});
  }
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
  const b=JSON.parse(event.body||'{}'),token=String(b.token||'');if(!await adminSession(token))return json(401,{error:'Administrator login required.'});
  if(b.action==='group_set_admin'){if(!uuid.test(String(b.customer_id||'')))return json(400,{error:'Choose a valid group member.'});const result=await db('rpc/aam_chat_group_set_admin',{method:'POST',body:JSON.stringify({p_customer_id:b.customer_id,p_make_admin:!!b.make_admin})});return json(200,result);}
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
  if(b.action==='sign_thumbnail_upload'){
   const path=`thumbnails/admin/${randomUUID()}.jpg`,u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
   const r=await fetch(`${u}/storage/v1/object/upload/sign/aam-social-media/${path}`,{method:'POST',headers:h(k,{'Content-Type':'application/json'}),body:'{}'});
   const d=await r.json().catch(()=>({}));if(!r.ok)return json(502,{error:d.message||'Could not prepare Professional Video preview.'});
   return json(200,{path,token:d.token});
  }
  if(b.action==='publish_post'){
   const path=String(b.media_path||''),mime=String(b.mime_type||''),ext=mimeExt[mime];
   const thumb=String(b.thumbnail_path||'');
   if(!ext||!path.startsWith('admin/')||path.includes('..')||(thumb&&(!thumb.startsWith('thumbnails/admin/')||thumb.includes('..'))))return json(400,{error:'Invalid administrator media.'});
   const rows=await db('aam_social_posts',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify([{customer_id:null,author_role:'admin',media_type:mime.startsWith('video/')?'video':'image',media_path:path,thumbnail_path:thumb||null,caption:String(b.caption||'').trim().slice(0,2200),moderation_status:'published',is_locked:mime.startsWith('video/')&&b.is_locked===true}])});
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
