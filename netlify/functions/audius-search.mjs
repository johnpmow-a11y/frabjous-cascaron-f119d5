const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
async function db(path){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw new Error('Social storage is not configured.');const r=await fetch(`${u}/rest/v1/${path}`,{headers:{apikey:k,...(k.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${k}`)}});const d=await r.json().catch(()=>[]);if(!r.ok)throw new Error(d.message||'Could not verify your session.');return d;}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
 try{
  const q=event.queryStringParameters||{},token=String(q.token||''),query=String(q.q||'').trim().slice(0,100);
  if(!uuid.test(token))return json(401,{error:'Please log in again.'});
  const sessions=await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
  if(!sessions[0])return json(401,{error:'Please log in again.'});
  const adult=await db(`aam_social_profiles?select=adult_confirmed_at&customer_id=eq.${encodeURIComponent(sessions[0].customer_id)}&limit=1`);
  if(!adult[0]?.adult_confirmed_at)return json(403,{error:'Confirm that you are 18 or older to continue.'});
  if(query.length<2)return json(200,{tracks:[]});
  const apiKey=process.env.AUDIUS_API_KEY,bearer=process.env.AUDIUS_BEARER_TOKEN;
  if(!apiKey&&!bearer)return json(503,{error:'Audius sound search is not configured.'});
  const url=new URL('https://api.audius.co/v1/tracks/search');url.searchParams.set('query',query);url.searchParams.set('limit','20');url.searchParams.set('app_name','AllAdsManager');
  const headers={Accept:'application/json'};if(apiKey)headers['x-api-key']=apiKey;if(bearer)headers.Authorization=`Bearer ${bearer}`;
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(12000)}),data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.errors?.[0]?.message||data?.error||'Audius could not search for this sound.');
  const tracks=(Array.isArray(data.data)?data.data:[]).map(t=>({id:String(t.id||''),title:String(t.title||'Untitled').slice(0,180),artist:String(t.user?.name||t.artist_name||'Audius artist').slice(0,120),artwork:t.artwork?.['480x480']||t.artwork?.['150x150']||t.artwork?.['1000x1000']||null,stream_url:`https://api.audius.co/v1/tracks/${encodeURIComponent(t.id)}/stream?app_name=AllAdsManager`})).filter(t=>t.id);
  return json(200,{tracks});
 }catch(error){return json(502,{error:error.message||'Sound search is temporarily unavailable.'});}
}
