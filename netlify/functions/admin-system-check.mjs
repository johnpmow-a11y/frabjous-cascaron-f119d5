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
async function readJson(url,options={}){
  const response=await fetch(url,{...options,cache:'no-store',signal:AbortSignal.timeout(12000)});
  const data=await response.json().catch(()=>null);
  return {response,data};
}
function supplierError(label,status,data){
  if(status===401||status===403)return label+' rejected its API key. Check the matching key in Netlify.';
  const detail=data?.message||data?.error||data?.detail;
  return detail?String(detail):label+' returned an unexpected response (HTTP '+status+').';
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
    const {response,data}=await readJson(supabase+'/rest/v1/rpc/bt_admin_personal_wallet_get',{
      method:'POST',
      headers:serviceKey.startsWith('sb_secret_')?{apikey:serviceKey,'Content-Type':'application/json'}:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},
      body:JSON.stringify({p_token:token})
    });
    if(!response.ok){
      const msg=String(data?.message||data?.error||'Database request failed.');
      if(response.status===401||response.status===403||/invalid api key/i.test(msg))throw Error('Supabase rejected SUPABASE_SERVICE_ROLE_KEY. Set the current service_role key for this exact project in Netlify.');
      if(response.status===404||/function .* does not exist/i.test(msg))throw Error('Admin Wallet RPC is missing. Apply supabase/migrations/20261114_admin_universal_wallet.sql.');
      if(/ADMIN_SESSION_EXPIRED/.test(msg))throw Error('Admin login session has expired. Sign in again.');
      throw Error(msg);
    }
    return 'Connected; the Admin Wallet RPC exists and verified this admin session.';
  }));

  // Supplier checks are only allowed after the database verifies the admin session.
  if(checks[0]?.status!=='ok'){
    return json(200,{ok:false,checked:1,failed:1,checks,notice:'Admin authentication or Supabase failed. Supplier API keys were not tested.'});
  }

  checks.push(await probe('Push notification subscription table',async()=>{
    const {response,data}=await readJson(supabase+'/rest/v1/ads_manager_push_subscriptions?select=id&limit=1',{
      headers:serviceKey.startsWith('sb_secret_')?{apikey:serviceKey}:{apikey:serviceKey,Authorization:'Bearer '+serviceKey}
    });
    if(!response.ok){
      const msg=String(data?.message||data?.error||'');
      if(response.status===401||response.status===403||/invalid api key/i.test(msg))throw Error('Supabase rejected the server API key.');
      if(response.status===404||/does not exist/i.test(msg))throw Error('Push subscription table is missing. Apply the push-subscriptions SQL migration.');
      throw Error(msg||'Could not check push subscriptions.');
    }
    return 'Table exists. Background delivery still requires customer device permission and a saved subscription.';
  }));

  checks.push(await probe('UltraSMS API key + catalogue',async()=>{
    const key=process.env.ULTRA_SMS_API_KEY;
    if(!key)throw Error('ULTRA_SMS_API_KEY is missing in Netlify.');
    const {response,data}=await readJson('https://ultrasmsin.com/api/v1/services',{
      headers:{Authorization:'Bearer '+key,Accept:'application/json'}
    });
    if(!response.ok)throw Error(supplierError('UltraSMS',response.status,data));
    if(!Array.isArray(data?.services))throw Error('UltraSMS responded, but did not return the services catalogue expected by the live integration. Check the API key and provider account response.');
    return 'Key accepted by the same /services endpoint used by the live Admin Wallet integration; '+data.services.length+' services returned.';
  }));

  checks.push(await probe('Rediprofiles API key + catalogue',async()=>{
    const key=process.env.REDIPROFILES_API_KEY;
    if(!key)throw Error('REDIPROFILES_API_KEY is missing in Netlify.');
    const {response,data}=await readJson('https://rediprofiles.com/api/v1/services/?currency=ngn',{
      headers:{'X-API-Key':key,'X-Currency':'NGN',Accept:'application/json'}
    });
    if(!response.ok)throw Error(supplierError('Rediprofiles',response.status,data));
    const services=Array.isArray(data)?data:Array.isArray(data?.services)?data.services:Array.isArray(data?.results)?data.results:null;
    if(!services)throw Error('Rediprofiles responded, but its payload did not match the catalogue format used by the live integration.');
    return 'Key accepted by the same NGN services endpoint used by the live integration; '+services.length+' products returned.';
  }));

  checks.push(await probe('Shadow OTP API key + catalogue',async()=>{
    const key=process.env.SHADOW_OTP_API_KEY;
    if(!key)throw Error('SHADOW_OTP_API_KEY is missing in Netlify.');
    const endpoint='https://shadowotp.com/stubs/email_handler.php';
    const request=async params=>{
      const u=new URL(endpoint);u.searchParams.set('api_key',key);
      for(const [name,value] of Object.entries(params))u.searchParams.set(name,String(value));
      return readJson(u);
    };
    const [servicesResult,domainsResult]=await Promise.all([
      request({action:'getEmailServices',domain:'gmail.com'}),
      request({action:'getEmailDomains'})
    ]);
    for(const {response,data} of [servicesResult,domainsResult]){
      if(!response.ok)throw Error(supplierError('Shadow OTP',response.status,data));
      if(String(data?.status)!=='200')throw Error(data?.message||data?.error||'Shadow OTP did not authorize the catalogue request. Check SHADOW_OTP_API_KEY and supplier account status.');
    }
    const services=Array.isArray(servicesResult.data?.services)?servicesResult.data.services:null;
    const domains=Array.isArray(domainsResult.data?.domains)?domainsResult.data.domains:null;
    if(!services||!domains)throw Error('Shadow OTP authorized the request but returned an unexpected catalogue format.');
    return 'Key accepted by both catalogue actions used by the live integration; '+services.length+' Gmail services and '+domains.length+' domains returned.';
  }));

  checks.push(await probe('SnappyDigits API key + account and boosting catalogues',async()=>{
    const key=process.env.SNAPPYDIGITS_API_KEY;
    if(!key)throw Error('SNAPPYDIGITS_API_KEY is missing in Netlify.');
    const headers={Authorization:'Bearer '+key,Accept:'application/json'};
    const [accountsResult,boostsResult]=await Promise.all([
      readJson('https://snappydigits.com/api/v1/services',{headers}),
      readJson('https://snappydigits.com/api/v1/smm/services',{headers})
    ]);
    for(const [label,result] of [['account',accountsResult],['boost',boostsResult]]){
      if(!result.response.ok||result.data?.ok===false){
        if(result.response.status===401||result.response.status===403)throw Error('SnappyDigits rejected SNAPPYDIGITS_API_KEY.');
        throw Error('SnappyDigits '+label+' catalogue failed (HTTP '+result.response.status+').');
      }
      if(!Array.isArray(result.data?.services))throw Error('SnappyDigits '+label+' catalogue returned an unexpected response.');
    }
    return 'Key accepted by both catalogue endpoints used by the live integration; '+accountsResult.data.services.length+' account services and '+boostsResult.data.services.length+' boosting services returned.';
  }));

  checks.push(await probe('Gmail email configuration',async()=>{
    if(!process.env.GMAIL_USER||!process.env.GMAIL_APP_PASSWORD)throw Error('GMAIL_USER or GMAIL_APP_PASSWORD is missing in Netlify. Existing email sending configuration has not been changed.');
    return 'Both Gmail settings are present. This read-only check does not send an email or change the existing mail configuration.';
  }));

  checks.push(await probe('Locker Card encryption key',async()=>{
    const key=String(process.env.CARD_DATA_ENCRYPTION_KEY||'');
    if(!/^[a-f0-9]{64}$/i.test(key))throw Error('CARD_DATA_ENCRYPTION_KEY is missing or is not 64 hexadecimal characters. Do not replace it casually: existing encrypted card records depend on this exact key.');
    return 'Encryption key has the required AES-256 format. Existing encrypted records were not read or modified.';
  }));

  checks.push(await probe('Paystack live secret key',async()=>{
    const key=process.env.PAYSTACK_SECRET_KEY;
    if(!key||!key.startsWith('sk_live_'))throw Error('PAYSTACK_SECRET_KEY is missing or is not a live secret key.');
    const {response,data}=await readJson('https://api.paystack.co/balance',{
      headers:{Authorization:'Bearer '+key,Accept:'application/json'}
    });
    if(!response.ok||!data?.status)throw Error(response.status===401||response.status===403?'Paystack rejected PAYSTACK_SECRET_KEY.':data?.message||'Paystack live-key check failed.');
    return 'Live key accepted by Paystack. No payment or transfer was created.';
  }));

  checks.push(await probe('UltraSMS webhook signature secret',async()=>{
    const secret=String(process.env.ULTRA_SMS_WEBHOOK_SECRET||'');
    if(!secret)throw Error('ULTRA_SMS_WEBHOOK_SECRET is missing. Incoming SMS status webhooks cannot be authenticated without it.');
    return 'Webhook signing secret is present. No webhook was sent or changed.';
  }));

  checks.push(await probe('UltraSMS customer pricing setting',async()=>{
    const raw=process.env.ULTRA_SMS_MARKUP_PERCENT;
    const markup=raw===undefined||raw===''?3:Number(raw);
    if(!Number.isFinite(markup)||markup<0||markup>500)throw Error('ULTRA_SMS_MARKUP_PERCENT must be between 0 and 500. If unset, the app uses its built-in 3% default.');
    return 'Markup setting is valid ('+markup+'%).';
  }));

  checks.push(await probe('Exchange-rate settings',async()=>{
    const ultra=Number(process.env.ULTRA_SMS_USD_NGN_RATE);
    const shadow=Number(process.env.SHADOW_OTP_PKR_NGN_RATE);
    const missing=[];
    if(!Number.isFinite(ultra)||ultra<=0)missing.push('ULTRA_SMS_USD_NGN_RATE');
    if(!Number.isFinite(shadow)||shadow<=0||shadow>100)missing.push('SHADOW_OTP_PKR_NGN_RATE');
    if(missing.length)throw Error('Missing or invalid Netlify setting(s): '+missing.join(', ')+'.');
    return 'UltraSMS USD→NGN and Shadow OTP PKR→NGN rates are present and within allowed ranges.';
  }));

  checks.push(await probe('Web push VAPID configuration',async()=>{
    const pub=process.env.VAPID_PUBLIC_KEY,priv=process.env.VAPID_PRIVATE_KEY;
    if(!pub||!priv)throw Error('VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY is missing.');
    const subject=process.env.VAPID_SUBJECT||'mailto:trustdansan@gmail.com';
    if(!/^mailto:\S+@\S+$/.test(subject))throw Error('VAPID_SUBJECT must be a valid mailto: address.');
    webpush.setVapidDetails(subject,pub,priv);
    return 'VAPID values pass library format validation. Key-pair matching and real device delivery are not verified by this read-only check.';
  }));

  const failed=checks.filter(x=>x.status==='error').length;
  return json(200,{ok:failed===0,checked:checks.length,failed,checks,notice:'Read-only checks only. No deposits, purchases, messages, or customer data were changed.'});
}
