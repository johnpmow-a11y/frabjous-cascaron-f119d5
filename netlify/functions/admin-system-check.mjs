import webpush from 'web-push';

const json=(statusCode,body)=>({
  statusCode,
  headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},
  body:JSON.stringify(body)
});

async function probe(name,run){
  try{
    const detail=await run();
    return {name,status:'ok',detail:detail||'Connected'};
  }catch(error){
    const message=String(error?.message||'Connection failed').replace(/https?:\/\/\S+/g,'[provider endpoint]');
    return {name,status:'error',detail:message.slice(0,220)};
  }
}

export async function handler(event){
  if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
  const token=String(event.queryStringParameters?.token||'');
  if(!/^[0-9a-f-]{36}$/i.test(token))return json(401,{error:'Admin session expired. Log in again.'});

  const supabase=process.env.SUPABASE_URL;
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const checks=[];

  checks.push(await probe('Supabase server key + Admin Wallet database',async()=>{
    if(!supabase||!serviceKey)throw Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in Netlify.');
    const response=await fetch(supabase+'/rest/v1/rpc/bt_admin_personal_wallet_get',{
      method:'POST',
      headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},
      body:JSON.stringify({p_token:token}),
      cache:'no-store',
      signal:AbortSignal.timeout(12000)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const msg=String(data.message||data.error||'Database request failed.');
      if(response.status===401||response.status===403||/invalid api key/i.test(msg))throw Error('Supabase rejected SUPABASE_SERVICE_ROLE_KEY. Replace it with the current service_role key for this exact project in Netlify.');
      if(response.status===404||/function .* does not exist/i.test(msg))throw Error('Admin Wallet SQL migration is missing. Apply supabase/migrations/20261114_admin_universal_wallet.sql.');
      throw Error(msg);
    }
    return 'Connected; Admin Wallet RPC exists and admin session is valid.';
  }));

  // Do not probe supplier credentials unless Supabase has confirmed this is a live admin session.
  if(checks[0]?.status!=='ok'){
    return json(200,{ok:false,checked:1,failed:1,checks,notice:'Admin authentication failed. No supplier API keys were tested.'});
  }

  checks.push(await probe('Push notification subscription table',async()=>{
    if(!supabase||!serviceKey)throw Error('Supabase server configuration is missing.');
    const r=await fetch(supabase+'/rest/v1/ads_manager_push_subscriptions?select=id&limit=1',{
      headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey},
      cache:'no-store',
      signal:AbortSignal.timeout(12000)
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok){
      const msg=String(d.message||d.error||'');
      if(r.status===401||r.status===403||/invalid api key/i.test(msg))throw Error('Supabase rejected the server API key.');
      if(r.status===404||/does not exist/i.test(msg))throw Error('Push subscription table is missing. Run the push-subscriptions SQL previously provided.');
      throw Error(msg||'Could not check push subscriptions.');
    }
    return 'Push subscription table exists; actual delivery depends on customer device permission and saved subscriptions.';
  }));

  checks.push(await probe('UltraSMS API key',async()=>{
    if(!process.env.ULTRA_SMS_API_KEY)throw Error('ULTRA_SMS_API_KEY is missing in Netlify.');
    const r=await fetch('https://ultrasmsin.com/api/v1/services',{headers:{Authorization:'Bearer '+process.env.ULTRA_SMS_API_KEY,Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(12000)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(r.status===401||r.status===403?'UltraSMS rejected ULTRA_SMS_API_KEY.':d.message||'UltraSMS catalogue request failed.');
    return 'Key accepted; service catalogue responded.';
  }));

  checks.push(await probe('Rediprofiles API key',async()=>{
    if(!process.env.REDIPROFILES_API_KEY)throw Error('REDIPROFILES_API_KEY is missing in Netlify.');
    const r=await fetch('https://rediprofiles.com/api/v1/services/?currency=ngn',{headers:{'X-API-Key':process.env.REDIPROFILES_API_KEY,'X-Currency':'NGN',Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(12000)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(r.status===401||r.status===403?'Rediprofiles rejected REDIPROFILES_API_KEY.':d.message||'Rediprofiles catalogue request failed.');
    return 'Key accepted; account catalogue responded.';
  }));

  checks.push(await probe('Shadow OTP API key',async()=>{
    if(!process.env.SHADOW_OTP_API_KEY)throw Error('SHADOW_OTP_API_KEY is missing in Netlify.');
    const u=new URL('https://shadowotp.com/stubs/email_handler.php');
    u.searchParams.set('api_key',process.env.SHADOW_OTP_API_KEY);
    u.searchParams.set('action','getEmailServices');
    u.searchParams.set('domain','gmail.com');
    const r=await fetch(u,{cache:'no-store',signal:AbortSignal.timeout(12000)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||String(d.status)==='401'||String(d.status)==='403'||/invalid api key|unauthori[sz]ed/i.test(String(d.message||d.error||'')))throw Error('Shadow OTP rejected SHADOW_OTP_API_KEY or could not authorize the catalogue request.');
    return 'Supplier catalogue responded; inspect catalogue status if no services are listed.';
  }));

  checks.push(await probe('Paystack live secret key',async()=>{
    const key=process.env.PAYSTACK_SECRET_KEY;
    if(!key||!key.startsWith('sk_live_'))throw Error('PAYSTACK_SECRET_KEY is missing or is not a live secret key.');
    const r=await fetch('https://api.paystack.co/balance',{headers:{Authorization:'Bearer '+key,Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(12000)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.status)throw Error(r.status===401||r.status===403?'Paystack rejected PAYSTACK_SECRET_KEY.':d.message||'Paystack live-key check failed.');
    return 'Live key accepted. No payment was created.';
  }));

  checks.push(await probe('Web push VAPID key pair',async()=>{
    const pub=process.env.VAPID_PUBLIC_KEY,priv=process.env.VAPID_PRIVATE_KEY;
    if(!pub||!priv)throw Error('VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY is missing.');
    webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:trustdansan@gmail.com',pub,priv);
    return 'Key format accepted. Actual device delivery still requires a saved subscription.';
  }));

  const failed=checks.filter(x=>x.status==='error').length;
  return json(200,{ok:failed===0,checked:checks.length,failed,checks,notice:'Read-only checks only. No deposits, purchases, messages, or customer data were changed.'});
}
