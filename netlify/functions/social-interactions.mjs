import {sendPush} from './_push.mjs';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
const headers=(key,extra={})=>({apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),...extra});
async function db(path,options={}){const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)throw new Error('Social service is not configured.');const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:headers(key,{'Content-Type':'application/json',...(options.headers||{})})});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.message||data.error||'Social request failed.');return data;}
async function session(token){if(!uuid.test(token))return null;const rows=await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);return rows[0]||null;}
async function rpc(name,args){return db(`rpc/${name}`,{method:'POST',body:JSON.stringify(args)});}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 try{
  const b=event.httpMethod==='GET'?event.queryStringParameters||{}:JSON.parse(event.body||'{}');
  const token=String(b.token||''),s=await session(token);if(!s)return json(401,{error:'Please log in again.'});
  const age=await db(`aam_social_profiles?select=adult_confirmed_at&customer_id=eq.${s.customer_id}&limit=1`);if(!age[0]?.adult_confirmed_at)return json(403,{error:'Confirm that you are 18 or older first.'});
  if(event.httpMethod==='GET'){
   const post=String(b.post_id||'');if(!uuid.test(post))return json(400,{error:'Choose a valid post.'});
   const postRows=await db(`aam_social_posts?select=customer_id,comments_enabled&id=eq.${post}&moderation_status=eq.published&limit=1`);
   if(!postRows.length)return json(404,{error:'Post is unavailable.'});
   if(postRows[0].comments_enabled===false)return json(200,{comments:[],like_count:0,liked:false,comments_disabled:true});
   if(postRows[0].customer_id){const owner=await db(`aam_social_profiles?select=is_private&customer_id=eq.${postRows[0].customer_id}&limit=1`);if(owner[0]?.is_private){const rel=await db(`aam_social_follows?select=follower_id&follower_id=eq.${s.customer_id}&followed_id=eq.${postRows[0].customer_id}&limit=1`);if(!rel.length&&postRows[0].customer_id!==s.customer_id)return json(403,{error:'This profile is private.'});}}
   const [comments,likes,mine]=await Promise.all([
    db(`aam_social_comments?select=id,customer_id,body,created_at&post_id=eq.${post}&order=created_at.asc&limit=100`),
    db(`aam_social_likes?select=customer_id&post_id=eq.${post}`),
    db(`aam_social_likes?select=customer_id&post_id=eq.${post}&customer_id=eq.${s.customer_id}&limit=1`)
   ]);
   const ids=[...new Set(comments.map(c=>c.customer_id))];
   const profiles=ids.length?await db(`aam_social_profiles?select=customer_id,display_name,avatar_path&customer_id=in.(${ids.join(',')})`):[];
   const map=new Map(profiles.map(p=>[p.customer_id,p]));
   return json(200,{comments:comments.map(c=>({...c,creator:map.get(c.customer_id)||{display_name:'Creator'}})),like_count:likes.length,liked:mine.length>0});
  }
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
  const post=String(b.post_id||'');if(!uuid.test(post))return json(400,{error:'Choose a valid post.'});
  const targetRows=await db(`aam_social_posts?select=customer_id&id=eq.${post}&moderation_status=eq.published&limit=1`),recipient=targetRows[0]?.customer_id;
  if(b.action==='like'){const result=await rpc('aam_social_toggle_like',{p_token:token,p_post_id:post});if(result.liked&&recipient&&recipient!==s.customer_id)await sendPush({role:'customer',customerId:recipient,title:'New like',body:'Someone liked your post.'}).catch(()=>{});return json(200,result);}
  if(b.action==='comment'){const result=await rpc('aam_social_add_comment',{p_token:token,p_post_id:post,p_body:String(b.body||'')});if(recipient&&recipient!==s.customer_id)await sendPush({role:'customer',customerId:recipient,title:'New comment',body:'Someone commented on your post.'}).catch(()=>{});return json(200,result);}
  return json(400,{error:'Unsupported social interaction.'});
 }catch(e){return json(/session expired/i.test(e.message)?401:400,{error:e.message||'Could not complete that action.'});}
}
