import {randomUUID} from 'node:crypto';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
function h(k){return {apikey:k,...(k.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${k}`})};}
async function db(path,options={}){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;const r=await fetch(`${u}/rest/v1/${path}`,{...options,headers:{...h(k),'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||d.error||'Database request failed.');return d;}
export async function handler(event){
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
 const secret=process.env.PAYSTACK_SECRET_KEY;
 if(!secret||!secret.startsWith('sk_live_'))return json(503,{error:'Live Paystack payments are required for coin purchases.'});
 try{
  const b=JSON.parse(event.body||'{}'),token=String(b.token||''),email=String(b.email||'').trim().toLowerCase(),amount=Number(b.amount);
  if(!/^[0-9a-f-]{36}$/i.test(token))return json(401,{error:'Please log in again.'});
  if(!/^\\S+@\\S+\\.\\S+$/.test(email))return json(400,{error:'Enter an email address for the Paystack receipt.'});
  if(!Number.isInteger(amount)||amount<500||amount>3000000)return json(400,{error:'Choose a coin package from ₦500 to ₦3,000,000.'});
  const sessions=await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
  if(!sessions.length)return json(401,{error:'Your session has expired. Please log in again.'});
  const customerId=sessions[0].customer_id,reference=`aamcoins${Date.now()}${randomUUID().replace(/-/g,'').slice(0,14)}`;
  await db('aam_coin_purchase_payments',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify([{reference,customer_id:customerId,amount_kobo:amount*100,coins:amount,status:'pending'}])});
  const origin=event.headers.origin||`https://${event.headers.host}`;
  const ps=await fetch('https://api.paystack.co/transaction/initialize',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({email,amount:String(amount*100),currency:'NGN',reference,channels:['card','bank_transfer'],callback_url:`${origin}/payment-return.html?coin_purchase=1`,metadata:{customer_id:customerId,product:'All Ads Manager video coins',coin_quantity:amount}})});
  const result=await ps.json();
  if(!ps.ok||!result.status||!result.data?.authorization_url){await db(`aam_coin_purchase_payments?reference=eq.${encodeURIComponent(reference)}`,{method:'PATCH',body:JSON.stringify({status:'failed'})});return json(502,{error:result.message||'Paystack could not start this coin purchase.'});}
  return json(200,{authorization_url:result.data.authorization_url,reference,coins:amount});
 }catch(e){return json(500,{error:e.message||'Could not start coin purchase.'});}
}
