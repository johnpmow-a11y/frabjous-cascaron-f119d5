import {randomUUID} from 'node:crypto';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
function headers(key,extra={}){return {apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),...extra};}
async function db(path){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw new Error('Social storage is not configured.');const r=await fetch(`${u}/rest/v1/${path}`,{headers:headers(k)});const d=await r.json().catch(()=>[]);if(!r.ok)throw new Error(d.message||'Could not verify your session.');return d;}
async function accountId(apiToken){if(process.env.CLOUDFLARE_ACCOUNT_ID)return process.env.CLOUDFLARE_ACCOUNT_ID;const r=await fetch('https://api.cloudflare.com/client/v4/accounts?per_page=50',{headers:{Authorization:`Bearer ${apiToken}`,Accept:'application/json'},signal:AbortSignal.timeout(10000)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error('Set CLOUDFLARE_ACCOUNT_ID in Netlify. The video API token cannot read the account list.');const rows=Array.isArray(d.result)?d.result:[];if(rows.length===1)return rows[0].id;if(rows.length>1)throw new Error('Set CLOUDFLARE_ACCOUNT_ID in Netlify because this Cloudflare login has more than one account.');throw new Error('Could not find a Cloudflare account. Set CLOUDFLARE_ACCOUNT_ID in Netlify.');}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
 try{
  const b=JSON.parse(event.body||'{}'),token=String(b.token||''),role=b.role==='admin',mime=String(b.mime_type||'');
  if(!['video/mp4','video/quicktime','video/webm'].includes(mime))return json(400,{error:'Choose an MP4, MOV or WebM video.'});
  if(!uuid.test(token))return json(401,{error:'Please log in again.'});
  const sessions=await db(`${role?'admin_sessions':'customer_sessions'}?select=${role?'token':'customer_id'}&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
  if(!sessions[0])return json(401,{error:'Please log in again.'});
  const customerId=role?null:sessions[0].customer_id;
  if(!role){const adult=await db(`aam_social_profiles?select=adult_confirmed_at&customer_id=eq.${encodeURIComponent(customerId)}&limit=1`);if(!adult[0]?.adult_confirmed_at)return json(403,{error:'Confirm that you are 18 or older to continue.'});}
  const apiToken=process.env.CLOUDFLARE_API_TOKEN;if(!apiToken)return json(503,{error:'CLOUDFLARE_API_TOKEN is missing from Netlify environment variables.'});
  const account=await accountId(apiToken),owner=role?'aam-admin':customerId;
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/stream/direct_upload`,{method:'POST',headers:{Authorization:`Bearer ${apiToken}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({maxDurationSeconds:600,allowedOrigins:[],creator:owner,requireSignedURLs:false,meta:{app:'AllAdsManager',owner_id:owner,filename:String(b.filename||'video').slice(0,180)}}),signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.success||!data.result?.uid||!data.result?.uploadURL){const message=data.errors?.map(x=>x.message).filter(Boolean).join(' ')||'Cloudflare could not create a video upload.';return json(502,{error:message});}
  const uid=String(data.result.uid),mediaPath=role?`admin/cloudflare/${uid}`:`${customerId}/cloudflare/${uid}`;
  return json(200,{provider:'cloudflare',uid,upload_url:data.result.uploadURL,media_path:mediaPath});
 }catch(error){return json(502,{error:error.message||'Cloudflare video upload is temporarily unavailable.'});}
}
