import {randomUUID} from 'node:crypto';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
const imageExt={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
const h=(key,extra={})=>({apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),...extra});
async function db(path,options={}){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw new Error('Promotion service is not configured.');const r=await fetch(`${u}/rest/v1/${path}`,{...options,headers:h(k,{'Content-Type':'application/json',...(options.headers||{})})});const d=await r.json().catch(()=>[]);if(!r.ok)throw new Error(d.message||d.error||'Promotion request failed.');return d;}
async function customerSession(token){if(!uuid.test(token))return null;const rows=await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);return rows[0]||null;}
async function signedRead(path){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;const r=await fetch(`${u}/storage/v1/object/sign/aam-social-media/${path}`,{method:'POST',headers:h(k,{'Content-Type':'application/json'}),body:JSON.stringify({expiresIn:1800})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Could not load promotion image.');const p=d.signedURL||d.signedUrl||'';return /^https?:\\/\\//i.test(p)?p:u+(p.startsWith('/storage/v1/')?p:'/storage/v1'+(p.startsWith('/')?p:'/'));}
async function adult(customerId){const rows=await db(`aam_social_profiles?select=adult_confirmed_at&customer_id=eq.${encodeURIComponent(customerId)}&limit=1`);return !!rows[0]?.adult_confirmed_at;}
async function rpc(name,args){return db(`rpc/${name}`,{method:'POST',body:JSON.stringify(args)});}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 try{
  const q=event.queryStringParameters||{},b=event.httpMethod==='POST'?JSON.parse(event.body||'{}'):{},token=String(event.httpMethod==='GET'?q.token||'':b.token||''),s=await customerSession(token);
  if(!s)return json(401,{error:'Please log in again.'});
  if(!await adult(s.customer_id))return json(403,{error:'Confirm that you are 18 or older to continue.'});
  if(event.httpMethod==='GET'){
   const [promotions,balances]=await Promise.all([
    db(`aam_social_promotions?select=id,promotion_type,title,description,media_path,destination_url,requested_days,price_coins,status,provider_status,admin_note,paid_at,created_at&customer_id=eq.${encodeURIComponent(s.customer_id)}&order=created_at.desc&limit=50`),
    db(`aam_coin_balances?select=balance_coins,free_coins,purchased_coins&customer_id=eq.${encodeURIComponent(s.customer_id)}&limit=1`)
   ]);
   const items=await Promise.all(promotions.map(async p=>({...p,media_url:await signedRead(p.media_path)})));
   const v=balances[0]||{};
   return json(200,{promotions:items,coin_balance:Number(v.balance_coins||0),free_coin_balance:Number(v.free_coins||0),money_coin_balance:Number(v.purchased_coins||0),promotion_balance:Number(v.purchased_coins||0),provider_ready:false});
  }
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
  const action=String(b.action||'');
  if(action==='sign_upload'){
   const ext=imageExt[String(b.mime_type||'')];if(!ext)return json(400,{error:'Choose a JPG, PNG or WebP advertisement picture.'});
   const path=`promotions/${s.customer_id}/${randomUUID()}.${ext}`,u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
   const r=await fetch(`${u}/storage/v1/object/upload/sign/aam-social-media/${path}`,{method:'POST',headers:h(k,{'Content-Type':'application/json'}),body:'{}'});
   const d=await r.json().catch(()=>({}));if(!r.ok)return json(502,{error:d.message||'Could not prepare promotion picture upload.'});
   return json(200,{path,token:d.token});
  }
  if(action==='create'){
   const path=String(b.media_path||'');
   if(!path.startsWith(`promotions/${s.customer_id}/`)||path.includes('..'))return json(400,{error:'Upload your advert picture first.'});
   const result=await rpc('aam_social_promotion_create',{p_token:token,promotion_type:String(b.promotion_type||''),p_title:String(b.title||''),p_description:String(b.description||''),p_media_path:path,p_destination_url:String(b.destination_url||''),p_requested_days:Number(b.requested_days||7)});
   return json(200,result);
  }
  if(action==='pay'){
   if(!uuid.test(String(b.promotion_id||'')))return json(400,{error:'Choose a valid promotion.'});
   return json(200,await rpc('aam_social_promotion_pay',{p_token:token,p_promotion_id:b.promotion_id}));
  }
  return json(400,{error:'Unsupported Manager Promotion action.'});
 }catch(e){const message=String(e.message||'Could not complete Manager Promotion.');const status=/insufficient money coins/i.test(message)?402:/session expired/i.test(message)?401:/not configured/i.test(message)?503:400;return json(status,{error:message});}
}
