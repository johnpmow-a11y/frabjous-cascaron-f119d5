import {sendPush} from './_push.mjs';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
const h=(key,extra={})=>({apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),...extra});
async function db(path,options={}){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw new Error('Discovery is not configured.');const r=await fetch(`${u}/rest/v1/${path}`,{...options,headers:h(k,{'Content-Type':'application/json',...(options.headers||{})})});const d=await r.json().catch(()=>[]);if(!r.ok)throw new Error(d.message||d.error||'Discovery request failed.');return d;}
async function session(token){if(!uuid.test(token))return null;const rows=await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);return rows[0]||null;}
function publicAdminName(value){const name=String(value||'').trim();return !name||/\badmin(?:istrator)?\b/i.test(name)?'All Ads Manager':name;}
async function adultConfirmed(customerId){const rows=await db(`aam_social_profiles?select=adult_confirmed_at&customer_id=eq.${encodeURIComponent(customerId)}&limit=1`);return !!rows[0]?.adult_confirmed_at;}
function cloudflareUid(path){const match=String(path||'').match(/(?:^|\/)cloudflare\/([a-f0-9]{32})$/i);return match?.[1]||null;}
function cloudflarePlayer(uid){const code=String(process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE||'').trim();const base=code?'https://customer-'+code+'.cloudflarestream.com/'+uid+'/iframe':'https://iframe.videodelivery.net/'+uid;return base+'?autoplay=true&muted=true&controls=false&loop=true';}
function cloudflareThumbnail(uid){const code=String(process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE||'').trim();return code?'https://customer-'+code+'.cloudflarestream.com/'+uid+'/thumbnails/thumbnail.jpg?width=720&height=1280&fit=crop':'https://videodelivery.net/'+uid+'/thumbnails/thumbnail.jpg?width=720&height=1280&fit=crop';}
async function signedRead(path){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;const r=await fetch(`${u}/storage/v1/object/sign/aam-social-media/${path}`,{method:'POST',headers:h(k,{'Content-Type':'application/json'}),body:JSON.stringify({expiresIn:1800})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Could not load profile media.');const p=d.signedURL||d.signedUrl||'';return /^https?:\/\//i.test(p)?p:u+(p.startsWith('/storage/v1/')?p:'/storage/v1'+(p.startsWith('/')?p:'/'));}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 try{
  if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
  const q=event.queryStringParameters||{},token=String(q.token||''),s=await session(token);if(!s)return json(401,{error:'Please log in again.'});if(!await adultConfirmed(s.customer_id))return json(403,{error:'Confirm that you are 18 or older to continue.'});
  if(q.admin_profile==='1'){
   await db('aam_social_profile_views?on_conflict=profile_key,viewer_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({profile_key:'admin',viewer_id:s.customer_id,viewed_at:new Date().toISOString()})});
   await sendPush({role:'admin',title:'Creator profile view',body:'Someone viewed the All Ads Manager creator profile.'}).catch(()=>{});
   const adminRows=await db('aam_social_admin_profile?select=display_name,avatar_path,follower_count,is_verified&id=eq.true&limit=1'),admin=adminRows[0]||{display_name:'All Ads Manager',follower_count:0,is_verified:true};
   const posts=await db('aam_social_posts?select=id,media_type,media_path,thumbnail_path,caption,comments_enabled,created_at,is_locked&author_role=eq.admin&moderation_status=eq.published&order=created_at.desc&limit=30');
   const ids=posts.map(p=>p.id),inList=ids.length?'in.('+ids.join(',')+')':null;
   const [likes,comments,mine,unlocks]=inList?await Promise.all([
    db('aam_social_likes?select=post_id&post_id='+inList),
    db('aam_social_comments?select=post_id&post_id='+inList),
    db('aam_social_likes?select=post_id&customer_id=eq.'+s.customer_id+'&post_id='+inList),
    db('aam_social_video_unlocks?select=post_id&customer_id=eq.'+s.customer_id+'&post_id='+inList)
   ]):[[],[],[],[]];
   const liked=new Set(mine.map(x=>x.post_id)),unlocked=new Set(unlocks.map(x=>x.post_id)),likeCounts=new Map();for(const row of likes)likeCounts.set(row.post_id,(likeCounts.get(row.post_id)||0)+1);
   const viewRows=ids.length?await db('aam_social_post_views?select=post_id&post_id=in.('+ids.join(',')+')'):[],viewCounts=new Map();for(const row of viewRows)viewCounts.set(row.post_id,(viewCounts.get(row.post_id)||0)+1);const adminAvatar=admin.avatar_path?await signedRead(admin.avatar_path):null;const resultPosts=await Promise.all(posts.map(async p=>{const locked=p.media_type==='video'&&p.is_locked===true&&!unlocked.has(p.id),{media_path,thumbnail_path,...publicPost}=p,uid=cloudflareUid(media_path);return {...publicPost,like_count:likeCounts.get(p.id)||0,comment_count:comments.filter(x=>x.post_id===p.id).length,view_count:viewCounts.get(p.id)||0,liked:liked.has(p.id),follower_count:Number(admin.follower_count||0),following_count:0,verified:!!admin.is_verified,locked_video:locked,video_provider:uid?'cloudflare':null,media_url:locked?null:(uid?cloudflarePlayer(uid):await signedRead(media_path)),thumbnail_url:uid?cloudflareThumbnail(uid):(thumbnail_path?await signedRead(thumbnail_path):null),creator:{id:null,name:publicAdminName(admin.display_name),avatar_url:adminAvatar}};}));
   const profileViews=await db('aam_social_profile_views?select=viewer_id&profile_key=eq.admin');
   return json(200,{profile:{display_name:publicAdminName(admin.display_name),avatar_url:admin.avatar_path?await signedRead(admin.avatar_path):null,is_verified:!!admin.is_verified},followers:Number(admin.follower_count||0),following:0,likes:likes.length,profile_views:profileViews.length,posts:resultPosts});
  }
  const targetInput=String(q.profile_id||'');
  if(targetInput){
   let target=targetInput;
   if(/^\d{11}$/.test(targetInput)){const found=await db(`aam_social_profiles?select=customer_id&profile_id=eq.${encodeURIComponent(targetInput)}&limit=1`);target=found[0]?.customer_id||'';}
   if(!uuid.test(target))return json(404,{error:'Profile not found.'});
   const profiles=await db(`aam_social_profiles?select=customer_id,profile_id,display_name,bio,avatar_path,is_private,comments_enabled,referral_code&customer_id=eq.${target}&limit=1`);
   if(!profiles.length)return json(404,{error:'Profile not found.'});
   const p=profiles[0],following=await db(`aam_social_follows?select=follower_id&follower_id=eq.${s.customer_id}&followed_id=eq.${target}&limit=1`),isFollowing=following.length>0,allowed=!p.is_private||isFollowing||target===s.customer_id;
   if(target!==s.customer_id){await db('aam_social_profile_views?on_conflict=profile_key,viewer_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({profile_key:target,viewer_id:s.customer_id,viewed_at:new Date().toISOString()})});await db('aam_social_notifications',{method:'POST',body:JSON.stringify([{recipient_id:target,actor_id:s.customer_id,event_type:'profile_view',title:'Profile view',body:'Someone viewed your profile.'}])});await sendPush({role:'customer',customerId:target,title:'Profile view',body:'Someone viewed your profile.',eventType:'profile_view'}).catch(()=>{});}
   const [followers,followingCount,posts,unlocks,profileViews]=await Promise.all([
    db(`aam_social_follows?select=follower_id&followed_id=eq.${target}`),
    db(`aam_social_follows?select=followed_id&follower_id=eq.${target}`),
    allowed?db(`aam_social_posts?select=id,customer_id,media_type,media_path,thumbnail_path,caption,comments_enabled,created_at,is_locked&customer_id=eq.${target}&moderation_status=eq.published&order=created_at.desc&limit=30`):Promise.resolve([]),
    db(`aam_social_video_unlocks?select=post_id&customer_id=eq.${s.customer_id}`),
    db(`aam_social_profile_views?select=viewer_id&profile_key=eq.${target}`)
   ]);
   const unlocked=new Set(unlocks.map(x=>x.post_id)),postIds=posts.map(post=>post.id),postList=postIds.length?'in.('+postIds.join(',')+')':null;
   const [postLikes,postComments,myPostLikes,postViews]=postList?await Promise.all([db('aam_social_likes?select=post_id&post_id='+postList),db('aam_social_comments?select=post_id&post_id='+postList),db('aam_social_likes?select=post_id&customer_id=eq.'+s.customer_id+'&post_id='+postList),db('aam_social_post_views?select=post_id&post_id='+postList)]):[[],[],[],[]];
   const likeCounts=new Map(),viewCounts=new Map();for(const row of postLikes)likeCounts.set(row.post_id,(likeCounts.get(row.post_id)||0)+1);for(const row of postViews)viewCounts.set(row.post_id,(viewCounts.get(row.post_id)||0)+1);const likedSet=new Set(myPostLikes.map(row=>row.post_id));
   const {avatar_path,...publicProfile}=p,avatarUrl=avatar_path?await signedRead(avatar_path):null;
   const resultPosts=await Promise.all(posts.map(async post=>{const {media_path,thumbnail_path,...publicPost}=post,locked=post.media_type==='video'&&post.is_locked===true&&!unlocked.has(post.id),uid=cloudflareUid(media_path);return {...publicPost,like_count:likeCounts.get(post.id)||0,comment_count:postComments.filter(x=>x.post_id===post.id).length,view_count:viewCounts.get(post.id)||0,liked:likedSet.has(post.id),locked_video:locked,video_provider:uid?'cloudflare':null,media_url:locked?null:(uid?cloudflarePlayer(uid):await signedRead(media_path)),thumbnail_url:uid?cloudflareThumbnail(uid):(thumbnail_path?await signedRead(thumbnail_path):null),creator:{id:target,name:p.display_name||'Creator',avatar_url:avatarUrl}};}));
   return json(200,{profile:{...publicProfile,avatar_url:avatarUrl},is_following:isFollowing,followers:followers.length,following:followingCount.length,profile_views:profileViews.length,likes:postLikes.length,posts:resultPosts,private_locked:!allowed});
  }
  const term=String(q.q||'').trim().slice(0,40);if(term.length<2)return json(200,{profiles:[]});
  const profiles=/^\d{11}$/.test(term)?await db(`aam_social_profiles?select=customer_id,profile_id,display_name,bio,avatar_path,is_private&profile_id=eq.${encodeURIComponent(term)}&limit=25`):await db(`aam_social_profiles?select=customer_id,profile_id,display_name,bio,avatar_path,is_private&display_name=ilike.*${encodeURIComponent(term)}*&limit=25`);
  const ids=profiles.map(p=>p.customer_id).filter(id=>id!==s.customer_id);
  const follows=ids.length?await db(`aam_social_follows?select=followed_id&follower_id=eq.${s.customer_id}&followed_id=in.(${ids.join(',')})`):[];
  const set=new Set(follows.map(f=>f.followed_id));
  return json(200,{profiles:await Promise.all(profiles.filter(p=>p.customer_id!==s.customer_id).map(async p=>{const {avatar_path,...publicProfile}=p;return {...publicProfile,avatar_url:avatar_path?await signedRead(avatar_path):null,is_following:set.has(p.customer_id)};}))});
 }catch(e){return json(/session expired/i.test(e.message)?401:400,{error:e.message||'Could not load discovery.'});}
}
