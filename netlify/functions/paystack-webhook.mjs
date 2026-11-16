import crypto from 'node:crypto';
import { sendPush } from './_push.mjs';
import { createDeliveryOrder } from './_delivery-helper.mjs';
import { createConsignmentJob } from './_consignment-helper.mjs';
const reply = (statusCode, body = 'ok') => ({ statusCode, body });

async function savePaidServiceOrder(customerId,reference,row,tx){
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY,base=process.env.SUPABASE_URL;
  const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
  const existingResponse=await fetch(`${base}/rest/v1/business_tools_customer_data?select=records&customer_id=eq.${encodeURIComponent(customerId)}&limit=1`,{headers});
  const existing=await existingResponse.json().catch(()=>[]);
  if(!existingResponse.ok)throw new Error('Could not load customer order history.');
  const records=Array.isArray(existing?.[0]?.records)?existing[0].records:[];
  const customerResponse=await fetch(`${base}/rest/v1/customers?select=name&id=eq.${encodeURIComponent(customerId)}&limit=1`,{headers});
  const customers=await customerResponse.json().catch(()=>[]);
  const paidAt=tx.paid_at||tx.paidAt||new Date().toISOString();
  const processingAvailableAt=row.service==='Fund Facebook Ads'?new Date(new Date(paidAt).getTime()+18*60*1000).toISOString():row.service==='TikTok Dollar Funding'?new Date(new Date(paidAt).getTime()+5*60*1000).toISOString():null;
  const paidRecord={id:`SVC-${reference}`,customerId,customerName:customers?.[0]?.name||'Customer',service:row.service,details:row.details||'',price:Number(row.amount_kobo)/100,time:paidAt,paymentStatus:'Paid',processingStatus:row.service==='Gift Card'?'Awaiting gift card fulfilment':row.service==='Fund Facebook Ads'?'Processing — 18-minute waiting period':row.service==='TikTok Dollar Funding'?'Processing — five-minute waiting period':'Awaiting fulfilment',processingAvailableAt,servicePaymentReference:reference};
  const i=records.findIndex(x=>x.servicePaymentReference===reference);
  if(i>=0)records[i]={...records[i],...paidRecord};else records.push(paidRecord);
  const url=existing.length?`${base}/rest/v1/business_tools_customer_data?customer_id=eq.${encodeURIComponent(customerId)}`:`${base}/rest/v1/business_tools_customer_data`;
  const saved=await fetch(url,{method:existing.length?'PATCH':'POST',headers:{...headers,Prefer:'return=minimal'},body:JSON.stringify(existing.length?{records}:[{customer_id:customerId,records}])});
  if(!saved.ok)throw new Error('Could not save the paid customer order.');
  return customers?.[0]?.name||'Customer';
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return reply(405, 'method not allowed');
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const supabase = process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !supabase || !service) return reply(503, 'not configured');
  if (!secret.startsWith('sk_live_')) return reply(503, 'live Paystack key required');
  const raw = event.body || '';
  const signature = event.headers['x-paystack-signature'] || event.headers['X-Paystack-Signature'];
  const expected = crypto.createHmac('sha512', secret).update(raw).digest('hex');
  if (!signature || Buffer.byteLength(signature) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return reply(401, 'invalid signature');
  try {
    const payload = JSON.parse(raw);
    if (payload.event !== 'charge.success') return reply(200, 'ignored');
    const reference = payload.data?.reference;
    if (!reference) return reply(200, 'missing reference');
    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${secret}` } });
    const verified = await verifyResponse.json();
    const tx = verified.data;
    if (!verifyResponse.ok || !verified.status || tx?.status !== 'success') return reply(400, 'transaction not successful');
    const headers = { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' };
    // Service payments use their own table and must never be sent to the wallet-credit RPC.
    const servicePaymentResponse=await fetch(`${supabase}/rest/v1/service_payments?select=customer_id,amount_kobo,status,service,details&reference=eq.${encodeURIComponent(reference)}&limit=1`,{headers});
    const servicePayments=await servicePaymentResponse.json().catch(()=>[]);
    if(!servicePaymentResponse.ok)return reply(500,'could not inspect service payment');
    if(Array.isArray(servicePayments)&&servicePayments.length){
      const order=servicePayments[0];
      if(Number(tx.amount)!==Number(order.amount_kobo)||String(tx.currency).toUpperCase()!=='NGN')return reply(400,'service payment amount or currency mismatch');
      const paidAt=tx.paid_at||tx.paidAt||new Date().toISOString();
      const updatedResponse=await fetch(`${supabase}/rest/v1/service_payments?reference=eq.${encodeURIComponent(reference)}&status=eq.pending`,{method:'PATCH',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify({status:'paid',paystack_transaction_id:String(tx.id),paystack_channel:String(tx.channel||''),paid_at:paidAt})});
      if(!updatedResponse.ok)return reply(500,'service payment update failed');
      const updated=await updatedResponse.json().catch(()=>[]);
      const newlyPaid=Array.isArray(updated)&&updated.length>0;
      // Re-run idempotent history/fulfilment helpers on webhook retries; only the
      // first successful status transition emits push notifications.
      const customerName=await savePaidServiceOrder(order.customer_id,reference,order,tx);
      if(order.service==='International Gift Delivery'||order.service==='Pizza Delivery'){
        let details={};try{details=JSON.parse(order.details||'{}')}catch{return reply(500,'invalid delivery details')}
        if(order.service==='Pizza Delivery'&&!['US','CA'].includes(String(details.country||'')))return reply(400,'pizza delivery country is invalid');
        await createDeliveryOrder({supabase,serviceKey:service,reference,customerId:order.customer_id,amountKobo:Number(order.amount_kobo),details});
      }
      if(order.service==='Create Your Consignment Box Video'){
        let details={};try{details=JSON.parse(order.details||'{}')}catch{return reply(500,'invalid consignment details')}
        await createConsignmentJob({supabase,serviceKey:service,reference,customerId:order.customer_id,details,paidAt});
      }
      if(newlyPaid){
        try{await sendPush({role:'admin',title:'Payment confirmed — new order',body:`${customerName} paid for ${order.service}.`,url:'/'});}catch(pushError){console.warn('Admin paid-order push failed:',pushError.message);}
        try{await sendPush({role:'customer',customerId:order.customer_id,title:'Payment confirmed',body:`Your payment for ${order.service} was successful. Your order is now in processing.`,url:'/'});}catch(pushError){console.warn('Customer paid-order push failed:',pushError.message);}
      }
      return reply(200,'service payment processed');
    }
    const adminDeposit = await fetch(`${supabase}/rest/v1/admin_wallet_deposits?select=reference&reference=eq.${encodeURIComponent(reference)}&limit=1`, { headers });
    const adminRows = await adminDeposit.json().catch(() => []);
    const isAdminDeposit = adminDeposit.ok && Array.isArray(adminRows) && adminRows.length > 0;
    const rpcName = isAdminDeposit ? 'bt_admin_wallet_credit_deposit_webhook' : 'bt_paystack_credit_deposit';
    const rpc = await fetch(`${supabase}/rest/v1/rpc/${rpcName}`, {
      method: 'POST', headers,
      body: JSON.stringify({ p_reference: reference, p_transaction_id: String(tx.id), p_channel: String(tx.channel || ''), p_paid_at: tx.paid_at || tx.paidAt || new Date().toISOString(), p_amount_kobo: Number(tx.amount), p_currency: String(tx.currency || '') })
    });
    if (!rpc.ok) return reply(500, isAdminDeposit ? 'admin wallet credit failed' : 'customer wallet credit failed');
    const creditResult = await rpc.json().catch(() => ({}));
    // The database RPC is idempotent. Only the request that actually credits
    // the wallet sends the notification, so webhook retries cannot spam users.
    if (!isAdminDeposit && creditResult?.alreadyCredited !== true) {
      try {
        const deposits = await fetch(`${supabase}/rest/v1/wallet_deposits?select=customer_id,amount_kobo&reference=eq.${encodeURIComponent(reference)}&limit=1`, { headers });
        const depositRows = await deposits.json().catch(() => []);
        if (deposits.ok && depositRows.length) {
          const amount = (Number(depositRows[0].amount_kobo) / 100).toLocaleString('en-NG');
          await sendPush({ role: 'customer', customerId: depositRows[0].customer_id, title: 'Wallet funded successfully', body: `Your wallet has been credited with ₦${amount}.`, url: '/' });
        }
      } catch (pushError) {
        console.warn('Wallet credit push failed:', pushError.message);
      }
    }
    return reply(200, isAdminDeposit ? 'admin wallet credited' : 'customer wallet credited');
  } catch (error) { return reply(500, 'webhook processing error'); }
}
