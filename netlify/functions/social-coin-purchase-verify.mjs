import {sendPush} from './_push.mjs';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
function h(k){return {apikey:k,...(k.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${k}`})};}
export async function handler(event){
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
 const secret=process.env.PAYSTACK_SECRET_KEY,u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!secret||!secret.startsWith('sk_live_')||!u||!k)return json(503,{error:'Live Paystack verification is not configured.'});
 const reference=String(event.queryStringParameters?.reference||''),token=String(event.queryStringParameters?.token||'');
 if(!reference||!/^[0-9a-f-]{36}$/i.test(token))return json(400,{error:'Missing payment reference or login session.'});
 try{
  const headers={...h(k),'Content-Type':'application/json'};
  const [sr,pr]=await Promise.all([
   fetch(`${u}/rest/v1/customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`,{headers}),
   fetch(`${u}/rest/v1/aam_coin_purchase_payments?select=customer_id,amount_kobo,coins,status&reference=eq.${encodeURIComponent(reference)}&limit=1`,{headers})
  ]);
  const sessions=await sr.json(),payments=await pr.json();
  if(!sr.ok||!pr.ok||!sessions?.length)return json(401,{error:'Please log in again.'});
  if(!payments?.length||payments[0].customer_id!==sessions[0].customer_id)return json(404,{error:'Coin purchase not found for this account.'});
  if(payments[0].status==='success')return json(200,{status:'success',already_credited:true,coins:payments[0].coins});
  const vr=await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,{headers:{Authorization:`Bearer ${secret}`}}),verified=await vr.json(),tx=verified.data;
  if(!vr.ok||!verified.status||tx?.status!=='success')return json(200,{status:'pending',message:'Payment has not been confirmed yet.'});
  if(Number(tx.amount)!==Number(payments[0].amount_kobo)||String(tx.currency||'')!=='NGN')return json(400,{error:'Verified payment does not match the coin purchase.'});
  const cr=await fetch(`${u}/rest/v1/rpc/aam_social_credit_coin_purchase`,{method:'POST',headers,body:JSON.stringify({p_reference:reference,p_transaction_id:String(tx.id),p_amount_kobo:Number(tx.amount),p_currency:String(tx.currency),p_paid_at:tx.paid_at||new Date().toISOString()})});
  const credited=await cr.json().catch(()=>({}));
  if(!cr.ok)return json(500,{error:credited.message||'Payment was confirmed but coin credit failed.'});
  await sendPush({role:'customer',customerId:sessions[0].customer_id,title:'Video coins purchased',body:`${payments[0].coins} purchased coins have been added to your balance.`,url:'/'}).catch(()=>{});
  return json(200,{status:'success',coins:payments[0].coins,credited:credited.credited===true});
 }catch(e){return json(500,{error:e.message||'Could not verify coin purchase.'});}
}
