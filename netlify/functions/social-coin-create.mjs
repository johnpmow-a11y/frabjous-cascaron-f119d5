import { randomUUID } from 'node:crypto';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const env=()=>({secret:process.env.PAYSTACK_SECRET_KEY,supabase:process.env.SUPABASE_URL,service:process.env.SUPABASE_SERVICE_ROLE_KEY});
function h(key){return {apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),'Content-Type':'application/json'};}
async function db(path,options={}){const {supabase,service}=env();const r=await fetch(`${supabase}/rest/v1/${path}`,{...options,headers:{...h(service),...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||d.error||'Could not prepare coin payment.');return d;}
async function adultConfirmed(customerId){const rows=await db(`aam_social_profiles?select=adult_confirmed_at&customer_id=eq.${encodeURIComponent(customerId)}&limit=1`);return !!rows[0]?.adult_confirmed_at;}
export async function handler(event){
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
 const {secret,supabase,service}=env();
 if(!secret||!supabase||!service)return json(503,{error:'Payment service is not configured.'});
 if(!secret.startsWith('sk_live_'))return json(503,{error:'Live Paystack payments are required.'});
 try{
  const b=JSON.parse(event.body||'{}'),token=String(b.token||''),email=String(b.email||'').trim().toLowerCase(),amount=Number(b.amount),method=String(b.method||'');
  if(!/^[0-9a-f-]{36}$/i.test(token))return json(401,{error:'Please log in again.'});
  if(!/^\S+@\S+\.\S+$/.test(email))return json(400,{error:'Enter a valid email for your Paystack receipt.'});
  if(!Number.isSafeInteger(amount)||amount<500||amount>3000000)return json(400,{error:'Coin purchases start at ₦500.'});
  if(!['card','bank_transfer'].includes(method))return json(400,{error:'Choose Bank Transfer or ATM/Card.'});
  const sessions=await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
  if(!sessions.length)return json(401,{error:'Your session has expired.'});
  if(!await adultConfirmed(sessions[0].customer_id))return json(403,{error:'Confirm that you are 18 or older to continue.'});
  const customerId=sessions[0].customer_id,reference=`aamcoin${Date.now()}${randomUUID().replace(/-/g,'').slice(0,14)}`;
  await db('aam_social_coin_payments',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify([{customer_id:customerId,reference,amount_kobo:amount*100,coin_amount:amount,payment_method:method,status:'pending'}])});
  const host=String(event.headers.host||'').toLowerCase();
  if(!host||! /^[a-z0-9.-]+(?::[0-9]+)?$/.test(host))throw new Error('Payment return host is not configured.');
  const callbackUrl=`https://${host}/coin-payment-return.html`;
  const ps=await fetch('https://api.paystack.co/transaction/initialize',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({email,amount:String(amount*100),currency:'NGN',reference,channels:method==='card'?['card']:['bank_transfer'],callback_url:callbackUrl,metadata:{customer_id:customerId,product:'All Ads Manager Social Coins',coins:amount}})});
  const result=await ps.json().catch(()=>({}));
  if(!ps.ok||!result.status||!result.data?.authorization_url){
   await db(`aam_social_coin_payments?reference=eq.${encodeURIComponent(reference)}`,{method:'PATCH',body:JSON.stringify({status:'initialization_failed'})});
   return json(502,{error:result.message||'Paystack could not start this payment.'});
  }
  return json(200,{authorization_url:result.data.authorization_url,reference,coins:amount});
 }catch(e){return json(500,{error:e.message||'Could not start coin purchase.'});}
}
