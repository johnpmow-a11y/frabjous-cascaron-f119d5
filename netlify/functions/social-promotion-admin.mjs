const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
const h=(key,extra={})=>({apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),...extra});
async function db(path,options={}){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw new Error('Promotion admin service is not configured.');const r=await fetch(`${u}/rest/v1/${path}`,{...options,headers:h(k,{'Content-Type':'application/json',...(options.headers||{})})});const d=await r.json().catch(()=>[]);if(!r.ok)throw new Error(d.message||d.error||'Promotion admin request failed.');return d;}
async function adminSession(token){if(!uuid.test(token))return null;const rows=await db(`admin_sessions?select=token&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);return rows[0]||null;}
async function signedRead(path){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;const r=await fetch(`${u}/storage/v1/object/sign/aam-social-media/${path}`,{method:'POST',headers:h(k,{'Content-Type':'application/json'}),body:JSON.stringify({expiresIn:1800})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Could not load promotion picture.');const p=d.signedURL||d.signedUrl||'';return /^https?:\\/\\//i.test(p)?p:u+(p.startsWith('/storage/v1/')?p:'/storage/v1'+(p.startsWith('/')?p:'/'));}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 try{
  if(event.httpMethod==='GET'){
   const token=String(event.queryStringParameters?.token||'');if(!await adminSession(token))return json(401,{error:'Administrator login required.'});
   const rows=await db('aam_social_promotions?select=*&order=created_at.desc&limit=200');
   const ids=[...new Set(rows.map(x=>x.customer_id))];
   const profiles=ids.length?await db('aam_social_profiles?select=customer_id,display_name,avatar_path&customer_id=in.('+ids.join(',')+')'):[];
   const names=new Map(profiles.map(x=>[x.customer_id,x.display_name||'Customer']));
   const items=await Promise.all(rows.map(async x=>({...x,customer_name:names.get(x.customer_id)||'Customer',media_url:await signedRead(x.media_path)})));
   return json(200,{promotions:items,provider_connected:false});
  }
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
  const b=JSON.parse(event.body||'{}');if(!await adminSession(String(b.token||'')))return json(401,{error:'Administrator login required.'});
  if(!uuid.test(String(b.promotion_id||'')))return json(400,{error:'Choose a valid promotion.'});
  if(b.action==='set_price'){
   const price=Number(b.price_coins);if(!Number.isSafeInteger(price)||price<1||price>100000000)return json(400,{error:'Enter a valid Money Coin price.'});
   const rows=await db(`aam_social_promotions?id=eq.${b.promotion_id}&status=eq.pending_review&provider_status=eq.ready`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({price_coins:price,status:'awaiting_payment',admin_note:String(b.admin_note||'').trim().slice(0,500),updated_at:new Date().toISOString()})});
   if(!rows.length)return json(409,{error:'This promotion is no longer awaiting review.'});
   return json(200,{updated:true,status:'awaiting_payment',price_coins:price});
  }
  if(b.action==='reject'){
   const rows=await db(`aam_social_promotions?id=eq.${b.promotion_id}&status=eq.pending_review`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'rejected',admin_note:String(b.admin_note||'Promotion was not approved.').trim().slice(0,500),updated_at:new Date().toISOString()})});
   if(!rows.length)return json(409,{error:'This promotion is no longer awaiting review.'});
   return json(200,{updated:true,status:'rejected'});
  }
  return json(400,{error:'Unsupported promotion administration action.'});
 }catch(e){return json(400,{error:e.message||'Could not update promotion.'});}
}
