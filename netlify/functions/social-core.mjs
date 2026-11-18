import {sendPush} from './_push.mjs';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
function headers(key,extra={}){return {apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),...extra};}
async function db(path,options={}){const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)throw new Error('Social service is not configured.');const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:headers(key,{'Content-Type':'application/json',...(options.headers||{})})});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.message||data.error||'Social request failed.');return data;}
async function signedRead(path){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;const r=await fetch(`${u}/storage/v1/object/sign/aam-social-media/${path}`,{method:'POST',headers:headers(k,{'Content-Type':'application/json'}),body:JSON.stringify({expiresIn:1800})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Could not load custom wallpaper.');const p=d.signedURL||d.signedUrl||'';return /^https?:\/\//i.test(p)?p:u+(p.startsWith('/storage/v1/')?p:'/storage/v1'+(p.startsWith('/')?p:'/'));}
async function session(token){if(!uuid.test(token))return null;const rows=await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);return rows[0]||null;}
async function rpc(name,args){return db(`rpc/${name}`,{method:'POST',body:JSON.stringify(args)});}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 try{
  if(event.httpMethod==='GET'){
   const q=event.queryStringParameters||{},token=String(q.token||''),s=await session(token);
   if(!s)return json(401,{error:'Please log in again.'});
   const [balance,profile,prefs]=await Promise.all([
    db(`aam_coin_balances?select=balance_coins&customer_id=eq.${encodeURIComponent(s.customer_id)}&limit=1`),
    db(`aam_social_profiles?select=customer_id,display_name,bio,avatar_path,is_private,comments_enabled,referral_code,adult_confirmed_at&customer_id=eq.${encodeURIComponent(s.customer_id)}&limit=1`),
    db(`aam_social_preferences?select=notification_sound,chat_wallpaper,custom_wallpaper_path,profile_view_notifications,follow_notifications,like_notifications,comment_notifications,share_notifications,message_notifications,profile_update_notifications&customer_id=eq.${encodeURIComponent(s.customer_id)}&limit=1`)
   ]);
   const preferences=prefs[0]||{notification_sound:1,chat_wallpaper:'default'};if(preferences.custom_wallpaper_path)preferences.custom_wallpaper_url=await signedRead(preferences.custom_wallpaper_path);const currentProfile=profile[0]||null;if(currentProfile?.avatar_path)currentProfile.avatar_url=await signedRead(currentProfile.avatar_path);return json(200,{coin_balance:Number(balance[0]?.balance_coins||0),profile:currentProfile,preferences});
  }
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
  const b=JSON.parse(event.body||'{}'),token=String(b.token||''),action=String(b.action||'');
  const currentSession=await session(token);if(!currentSession)return json(401,{error:'Your session has expired. Please log in again.'});
  if(action==='update_avatar'){const path=String(b.avatar_path||''),followers=await db(`aam_social_follows?select=followed_id&follower_id=eq.${encodeURIComponent(currentSession.customer_id)}`);const result=await rpc('aam_social_update_avatar',{p_token:token,p_avatar_path:path});await Promise.allSettled(followers.map(x=>sendPush({role:'customer',customerId:x.followed_id,title:'Profile picture updated',body:'A creator you follow updated their profile picture.',eventType:'profile_update'})));return json(200,result);}
  if(action==='update_profile')return json(200,await rpc('aam_social_update_profile',{p_token:token,p_display_name:String(b.display_name||''),p_bio:String(b.bio||''),p_is_private:!!b.is_private,p_comments_enabled:b.comments_enabled!==false}));
  if(action==='update_preferences')return json(200,await rpc('aam_social_update_preferences',{p_token:token,p_sound:Number(b.notification_sound||1),p_wallpaper:String(b.chat_wallpaper||'default'),p_custom_wallpaper_path:b.custom_wallpaper_path||null}));
  if(action==='update_notification_preferences')return json(200,await rpc('aam_social_update_notification_preferences',{p_token:token,p_profile_views:b.profile_view_notifications!==false,p_follows:b.follow_notifications!==false,p_likes:b.like_notifications!==false,p_comments:b.comment_notifications!==false,p_shares:b.share_notifications!==false,p_messages:b.message_notifications!==false,p_profile_updates:b.profile_update_notifications!==false}));
  if(action==='confirm_age')return json(200,await rpc('aam_social_confirm_age',{p_token:token}));
  if(action==='follow'){
   if(!uuid.test(String(b.target_customer_id||'')))return json(400,{error:'Choose a valid profile.'});
   const result=await rpc('aam_social_follow',{p_token:token,p_target:b.target_customer_id});if(result.new_follow)await sendPush({role:'customer',customerId:b.target_customer_id,title:'New follower',body:'Someone followed your profile.',eventType:'follow'}).catch(()=>{});return json(200,result);
  }
  if(action==='apply_referral'){
   const code=String(b.referral_code||'').trim().slice(0,32);
   return json(200,await rpc('aam_social_apply_referral',{p_token:token,p_referral_code:code}));
  }
  if(action==='unlock_video'){
   if(!uuid.test(String(b.post_id||'')))return json(400,{error:'Choose a valid video.'});
   return json(200,await rpc('aam_social_unlock_video',{p_token:token,p_post_id:b.post_id}));
  }
  return json(400,{error:'Unsupported social action.'});
 }catch(e){const message=String(e.message||'Could not complete this social action.');const status=/insufficient coins/i.test(message)?402:/session expired/i.test(message)?401:400;return json(status,{error:message});}
}
