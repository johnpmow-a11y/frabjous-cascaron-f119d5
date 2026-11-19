import {sendPush} from './_push.mjs';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const env=()=>({secret:process.env.PAYSTACK_SECRET_KEY,supabase:process.env.SUPABASE_URL,service:process.env.SUPABASE_SERVICE_ROLE_KEY});
function h(key){return {apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}), 'Content-Type':'application/json'};}
async function db(path,options={}){const {supabase,service}=env();const r=await fetch(`${supabase}/rest/v1/${path}`,{...options,headers:{...h(service),...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||d.error||'Coin payment verification failed.');return d;}
export async function handler(event){
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
 const {secret,supabase,service}=env();if(!secret||!supabase||!service)return json(503,{error:'Payment service is not configured.'});
 if(!secret.startsWith('sk_live_'))return json(503,{error:'Live Paystack verification is required.'});
 const reference=String(event.queryStringParameters?.reference||''),token=String(event.queryStringParameters?.token||'');
 if(!reference||!/^[0-9a-f-]{36}$/i.test(token))return json(400,{error:'Missing payment reference or login session.'});
 try{
  const sessions=await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
  if(!sessions.length)return json(401,{error:'Please log in again.'});
  const payments=await db(`aam_social_coin_payments?select=customer_id,amount_kobo,coin_amount,status&reference=eq.${encodeURIComponent(reference)}&limit=1`);
  if(!payments.length||payments[0].customer_id!==sessions[0].customer_id)return json(404,{error:'Coin payment not found for this account.'});
  if(payments[0].status==='paid')return json(200,{status:'success',already_credited:true,coins:payments[0].coin_amount});
  const response=await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,{headers:{Authorization:`Bearer ${secret}`}});
  const verified=await response.json().catch(()=>({})),tx=verified.data;
  if(!response.ok||!verified.status||tx?.status!=='success')return json(200,{status:'pending',message:'Payment is not confirmed yet.'});
  if(Number(tx.amount)!==Number(payments[0].amount_kobo)||String(tx.currency).toUpperCase()!=='NGN')return json(400,{error:'Paystack amount or currency mismatch.'});
  const credited=await db('rpc/aam_social_credit_coin_purchase',{method:'POST',body:JSON.stringify({p_reference:reference,p_transaction_id:String(tx.id),p_channel:String(tx.channel||''),p_paid_at:tx.paid_at||tx.paidAt||new Date().toISOString(),p_amount_kobo:Number(tx.amount),p_currency:String(tx.currency||'')})});
  if(credited?.credited)await sendPush({role:'customer',customerId:sessions[0].customer_id,title:'Coins purchased successfully',body:`${payments[0].coin_amount.toLocaleString('en-NG')} viewing coins have been added to your purchased balance.`,url:'/'}).catch(()=>{});
  return json(200,{status:'success',coins:payments[0].coin_amount,credited});
 }catch(e){return json(500,{error:e.message||'Could not verify coin payment.'});}
}
