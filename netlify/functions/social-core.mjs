const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
function headers(key,extra={}){return {apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),...extra};}
async function db(path,options={}){const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)throw new Error('Social service is not configured.');const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:headers(key,{'Content-Type':'application/json',...(options.headers||{})})});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.message||data.error||'Social request failed.');return data;}
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
    db(`aam_social_preferences?select=notification_sound,chat_wallpaper&customer_id=eq.${encodeURIComponent(s.customer_id)}&limit=1`)
   ]);
   return json(200,{coin_balance:Number(balance[0]?.balance_coins||0),profile:profile[0]||null,preferences:prefs[0]||{notification_sound:1,chat_wallpaper:'default'}});
  }
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
  const b=JSON.parse(event.body||'{}'),token=String(b.token||''),action=String(b.action||'');
  if(!await session(token))return json(401,{error:'Your session has expired. Please log in again.'});
  if(action==='update_profile')return json(200,await rpc('aam_social_update_profile',{p_token:token,p_display_name:String(b.display_name||''),p_bio:String(b.bio||''),p_is_private:!!b.is_private,p_comments_enabled:b.comments_enabled!==false}));
  if(action==='update_preferences')return json(200,await rpc('aam_social_update_preferences',{p_token:token,p_sound:Number(b.notification_sound||1),p_wallpaper:String(b.chat_wallpaper||'default')}));
  if(action==='confirm_age')return json(200,await rpc('aam_social_confirm_age',{p_token:token}));
  if(action==='follow'){
   if(!uuid.test(String(b.target_customer_id||'')))return json(400,{error:'Choose a valid profile.'});
   return json(200,await rpc('aam_social_follow',{p_token:token,p_target:b.target_customer_id}));
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
