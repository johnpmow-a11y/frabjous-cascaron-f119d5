import {sendPush} from './_push.mjs';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
const h=(key,extra={})=>({apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),...extra});
async function db(path,options={}){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw new Error('Discovery is not configured.');const r=await fetch(`${u}/rest/v1/${path}`,{...options,headers:h(k,{'Content-Type':'application/json',...(options.headers||{})})});const d=await r.json().catch(()=>[]);if(!r.ok)throw new Error(d.message||d.error||'Discovery request failed.');return d;}
async function session(token){if(!uuid.test(token))return null;const rows=await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);return rows[0]||null;}
async function signedRead(path){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;const r=await fetch(`${u}/storage/v1/object/sign/aam-social-media/${path}`,{method:'POST',headers:h(k,{'Content-Type':'application/json'}),body:JSON.stringify({expiresIn:1800})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Could not load profile media.');const p=d.signedURL||d.signedUrl||'';return /^https?:\/\//i.test(p)?p:u+(p.startsWith('/storage/v1/')?p:'/storage/v1'+(p.startsWith('/')?p:'/'));}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 try{
  if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
  const q=event.queryStringParameters||{},token=String(q.token||''),s=await session(token);if(!s)return json(401,{error:'Please log in again.'});
  const age=await db(`aam_social_profiles?select=adult_confirmed_at&customer_id=eq.${s.customer_id}&limit=1`);
  if(!age[0]?.adult_confirmed_at)return json(403,{error:'Confirm that you are 18 or older first.'});
  const target=String(q.profile_id||'');
  if(target){
   if(!uuid.test(target))return json(400,{error:'Invalid profile.'});
   const profiles=await db(`aam_social_profiles?select=customer_id,display_name,bio,avatar_path,is_private,comments_enabled,referral_code&customer_id=eq.${target}&limit=1`);
   if(!profiles.length)return json(404,{error:'Profile not found.'});
   const p=profiles[0],following=await db(`aam_social_follows?select=follower_id&follower_id=eq.${s.customer_id}&followed_id=eq.${target}&limit=1`),isFollowing=following.length>0,allowed=!p.is_private||isFollowing||target===s.customer_id;
   if(target!==s.customer_id){await db('aam_social_notifications',{method:'POST',body:JSON.stringify([{recipient_id:target,actor_id:s.customer_id,event_type:'profile_view',title:'Profile view',body:'Someone viewed your profile.',eventType:'profile_view'}])});await sendPush({role:'customer',customerId:target,title:'Profile view',body:'Someone viewed your profile.'}).catch(()=>{});}
   const [followers,followingCount,posts,unlocks]=await Promise.all([
    db(`aam_social_follows?select=follower_id&followed_id=eq.${target}`),
    db(`aam_social_follows?select=followed_id&follower_id=eq.${target}`),
    allowed?db(`aam_social_posts?select=id,customer_id,media_type,media_path,caption,comments_enabled,created_at&customer_id=eq.${target}&moderation_status=eq.published&order=created_at.desc&limit=30`):Promise.resolve([]),
    db(`aam_social_video_unlocks?select=post_id&customer_id=eq.${s.customer_id}`)
   ]);
   const unlocked=new Set(unlocks.map(x=>x.post_id));
   const resultPosts=await Promise.all(posts.map(async post=>{const can=post.media_type!=='video'||target===s.customer_id||unlocked.has(post.id);return {...post,locked_video:post.media_type==='video'&&!can,media_url:can?await signedRead(post.media_path):null};}));
   return json(200,{profile:{...p,avatar_url:p.avatar_path?await signedRead(p.avatar_path):null},is_following:isFollowing,followers:followers.length,following:followingCount.length,posts:resultPosts,private_locked:!allowed});
  }
  const term=String(q.q||'').trim().slice(0,40);if(term.length<2)return json(200,{profiles:[]});
  const profiles=await db(`aam_social_profiles?select=customer_id,display_name,bio,avatar_path,is_private&display_name=ilike.*${encodeURIComponent(term)}*&limit=25`);
  const ids=profiles.map(p=>p.customer_id).filter(id=>id!==s.customer_id);
  const follows=ids.length?await db(`aam_social_follows?select=followed_id&follower_id=eq.${s.customer_id}&followed_id=in.(${ids.join(',')})`):[];
  const set=new Set(follows.map(f=>f.followed_id));
  return json(200,{profiles:await Promise.all(profiles.filter(p=>p.customer_id!==s.customer_id).map(async p=>({...p,avatar_url:p.avatar_path?await signedRead(p.avatar_path):null,is_following:set.has(p.customer_id)})))});
 }catch(e){return json(/session expired/i.test(e.message)?401:400,{error:e.message||'Could not load discovery.'});}
}
