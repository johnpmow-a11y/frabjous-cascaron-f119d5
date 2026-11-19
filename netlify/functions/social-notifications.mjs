const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
const headers=(key,extra={})=>({apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),...extra});
async function db(path,options={}){const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)throw new Error('Notifications are not configured.');const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:headers(key,{'Content-Type':'application/json',...(options.headers||{})})});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.message||data.error||'Notification request failed.');return data;}
async function signedRead(path){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;const r=await fetch(`${u}/storage/v1/object/sign/aam-social-media/${path}`,{method:'POST',headers:headers(k,{'Content-Type':'application/json'}),body:JSON.stringify({expiresIn:1800})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Could not load notification avatar.');const p=d.signedURL||d.signedUrl||'';return /^https?:\/\//i.test(p)?p:u+(p.startsWith('/storage/v1/')?p:'/storage/v1'+(p.startsWith('/')?p:'/'));}
async function session(token){if(!uuid.test(token))return null;const rows=await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);return rows[0]||null;}
async function adultConfirmed(customerId){const rows=await db(`aam_social_profiles?select=adult_confirmed_at&customer_id=eq.${encodeURIComponent(customerId)}&limit=1`);return !!rows[0]?.adult_confirmed_at;}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 try{
  const b=event.httpMethod==='GET'?event.queryStringParameters||{}:JSON.parse(event.body||'{}'),s=await session(String(b.token||''));
  if(!s)return json(401,{error:'Please log in again.'});
  if(!await adultConfirmed(s.customer_id))return json(403,{error:'Confirm that you are 18 or older to continue.'});
  if(event.httpMethod==='GET'){
   const rows=await db(`aam_social_notifications?select=id,actor_id,event_type,post_id,message_id,title,body,read_at,created_at&recipient_id=eq.${s.customer_id}&order=created_at.desc&limit=60`);
   const ids=[...new Set(rows.map(n=>n.actor_id).filter(Boolean))];
   const profiles=ids.length?await db(`aam_social_profiles?select=customer_id,display_name,avatar_path&customer_id=in.(${ids.join(',')})`):[];
   const map=new Map(profiles.map(p=>[p.customer_id,p]));
   const notifications=await Promise.all(rows.map(async n=>{const actor=map.get(n.actor_id)||null;if(!actor)return {...n,actor:null};const {avatar_path,...publicActor}=actor;return {...n,actor:{...publicActor,avatar_url:avatar_path?await signedRead(avatar_path):null}};}));
   return json(200,{notifications,unread_count:rows.filter(n=>!n.read_at).length});
  }
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
  const ids=Array.isArray(b.ids)?b.ids.filter(x=>uuid.test(String(x))):[];
  let path=`aam_social_notifications?recipient_id=eq.${s.customer_id}&read_at=is.null`;
  if(ids.length)path+=`&id=in.(${ids.join(',')})`;
  const result=await db(path,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({read_at:new Date().toISOString()})});
  return json(200,{marked_read:result.length});
 }catch(e){return json(/session expired/i.test(e.message)?401:400,{error:e.message||'Could not load notifications.'});}
}
