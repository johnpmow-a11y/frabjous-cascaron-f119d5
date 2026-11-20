import {createHash} from 'node:crypto';

const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
const h=(key,extra={})=>({apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),...extra});

async function db(path,options={}){
 const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!u||!k)throw new Error('Social storage is not configured.');
 const r=await fetch(`${u}/rest/v1/${path}`,{...options,headers:h(k,{'Content-Type':'application/json',...(options.headers||{})})});
 const d=await r.json().catch(()=>[]);
 if(!r.ok)throw new Error(d.message||d.error||'Social database request failed.');
 return d;
}
function stableId(id){
 const x=createHash('sha256').update('aam-dailymotion:'+id).digest('hex').slice(0,32).split('');
 x[12]='5';x[16]=((parseInt(x[16],16)&3)|8).toString(16);
 const s=x.join('');
 return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);
}
async function getPrivateToken(){
 if(process.env.DAILYMOTION_ACCESS_TOKEN)return process.env.DAILYMOTION_ACCESS_TOKEN;
 const id=process.env.DAILYMOTION_CLIENT_ID||process.env.DAILYMOTION_API_KEY;
 const secret=process.env.DAILYMOTION_CLIENT_SECRET||process.env.DAILYMOTION_API_SECRET;
 if(!id||!secret)return '';
 const body=new URLSearchParams({grant_type:'client_credentials',client_id:id,client_secret:secret,scope:'video.read'});
 const r=await fetch('https://oauth2.dailymotion.com/v2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body,signal:AbortSignal.timeout(10000)});
 const d=await r.json().catch(()=>({}));
 if(!r.ok||!d.access_token)throw new Error(d.error_description||d.error||'Dailymotion authentication failed.');
 return String(d.access_token);
}
function mapVideo(v){
 const id=String(v.video_id||v.id||'').trim();
 if(!id||!id.split('').every(ch=>/[a-z0-9]/i.test(ch)))return null;
 if(v.is_explicit===true||v.explicit===true||v.is_published===false||String(v.visibility||'public')!=='public'||v.embedding?.enable_embed===false)return null;
 const title=String(v.title||'Video').trim().slice(0,180);
 const description=String(v.description||'').trim().slice(0,1800);
 const thumbnail=String(v.thumbnail?.h720_url||v.thumbnail?.h480_url||v.thumbnail_720_url||v.thumbnail_480_url||'').trim();
 let created=v.created_at||v.published_at||v.created_time||null;
 const createdNumber=Number(created);
 if(typeof created==='number'||(String(created||'').trim()!==''&&Number.isFinite(createdNumber)&&String(created).trim()===String(createdNumber)))created=new Date(createdNumber*1000).toISOString();
 else if(created){const date=new Date(created);created=Number.isFinite(date.getTime())?date.toISOString():null;}
 return {id,title,description,thumbnail,created_at:created||new Date().toISOString()};
}
async function fetchDailymotionVideos(){
 let accessToken='';
 try{accessToken=await getPrivateToken();}
 catch(error){if(!process.env.DAILYMOTION_PUBLIC_API_KEY&&!process.env.DAILYMOTION_API_KEY)throw error;}
 if(accessToken){
  let profileId=String(process.env.DAILYMOTION_PROFILE_ID||'').trim();
  if(!profileId){
   const me=await fetch('https://api.dailymotion.com/v2/me?fields=profiles.profile_id,profiles.name',{headers:{Authorization:`Bearer ${accessToken}`,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
   const m=await me.json().catch(()=>({}));
   if(!me.ok)throw new Error(m.message||'Could not read the Dailymotion profile.');
   profileId=String(m.profiles?.[0]?.profile_id||'');
  }
  if(!profileId)throw new Error('Set DAILYMOTION_PROFILE_ID for this Dailymotion account.');
  const url=new URL(`https://api.dailymotion.com/v2/profiles/${encodeURIComponent(profileId)}/videos`);
  url.searchParams.set('page_size','20');url.searchParams.set('sort','-created_at');url.searchParams.set('visibility','public');url.searchParams.set('is_explicit','false');
  url.searchParams.set('fields','video_id,title,description,created_at,published_at,is_published,is_explicit,visibility,embedding.enable_embed,thumbnail.h720_url,thumbnail.h480_url');
  const r=await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.message||d.error||'Dailymotion could not load videos.');
  return (d.list||d.data||d.items||[]).map(mapVideo).filter(Boolean);
 }
 const apiKey=process.env.DAILYMOTION_PUBLIC_API_KEY||process.env.DAILYMOTION_API_KEY;
 if(!apiKey)return null;
 const url=new URL('https://api.dailymotion.com/videos');
 url.searchParams.set('api_key',apiKey);url.searchParams.set('fields','id,title,description,thumbnail_720_url,thumbnail_480_url,created_time,explicit,url,channel');
 url.searchParams.set('sort','recent');url.searchParams.set('limit','20');
 const r=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(d.error?.message||d.error_description||d.message||'Dailymotion could not load videos.');
 return (d.list||d.data||[]).map(mapVideo).filter(Boolean);
}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
 try{
  const q=event.queryStringParameters||{},token=String(q.token||'');
  if(!uuid.test(token))return json(401,{error:'Please log in again.'});
  const sessions=await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
  if(!sessions[0])return json(401,{error:'Please log in again.'});
  const adult=await db(`aam_social_profiles?select=adult_confirmed_at&customer_id=eq.${encodeURIComponent(sessions[0].customer_id)}&limit=1`);
  if(!adult[0]?.adult_confirmed_at)return json(403,{error:'Confirm that you are 18 or older to continue.'});
  const videos=await fetchDailymotionVideos();
  if(videos===null)return json(200,{configured:false,inserted:0});
  if(!videos.length)return json(200,{configured:true,inserted:0});
  const rows=videos.map(v=>({
   id:stableId(v.id),customer_id:null,author_role:'admin',media_type:'video',
   media_path:'dailymotion/'+v.id,thumbnail_path:v.thumbnail||null,
   caption:(v.title+(v.description?' · '+v.description:'')).slice(0,2200),
   post_kind:'feed',moderation_status:'published',is_locked:false,created_at:v.created_at
  }));
  await db('aam_social_posts?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(rows)});
  return json(200,{configured:true,inserted:rows.length});
 }catch(error){
  console.error('Dailymotion feed sync failed:',error.message);
  return json(200,{configured:true,inserted:0,error:'Dailymotion feed is temporarily unavailable.'});
 }
}
