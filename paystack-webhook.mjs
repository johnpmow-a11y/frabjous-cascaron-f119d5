import crypto from 'node:crypto';
import { createDeliveryOrder } from './_delivery-helper.mjs';
import { createConsignmentJob } from './_consignment-helper.mjs';
const reply = (statusCode, body = 'ok') => ({ statusCode, body });
export async function handler(event) {
  if (event.httpMethod !== 'POST') return reply(405, 'method not allowed');
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const supabase = process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !supabase || !service) return reply(503, 'not configured');
  if (!secret.startsWith('sk_live_')) return reply(503, 'live Paystack secret key required; test keys disabled');
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
    // Service purchases are recorded separately and must never credit the wallet.
    const serviceLookup = await fetch(`${supabase}/rest/v1/service_payments?select=reference,amount_kobo,currency,status,service,details,customer_id&reference=eq.${encodeURIComponent(reference)}&limit=1`, { headers: { apikey: service, Authorization: `Bearer ${service}` } });
    const serviceRows = serviceLookup.ok ? await serviceLookup.json() : [];
    if (serviceRows?.length) {
      const order = serviceRows[0];
      if (Number(order.amount_kobo) !== Number(tx.amount) || String(order.currency).toUpperCase() !== String(tx.currency).toUpperCase()) return reply(400, 'service payment amount mismatch');
      if (order.status === 'pending') {
        const update = await fetch(`${supabase}/rest/v1/service_payments?reference=eq.${encodeURIComponent(reference)}&status=eq.pending`, {
          method: 'PATCH', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'paid', paystack_transaction_id: String(tx.id), paystack_channel: String(tx.channel || ''), paid_at: tx.paid_at || tx.paidAt || new Date().toISOString() })
        });
        if (!update.ok) return reply(500, 'service payment update failed');
      }
      if (order.service === 'International Gift Delivery') {
        let details={}; try { details=JSON.parse(order.details||'{}'); } catch { return reply(400,'invalid delivery details'); }
        try { await createDeliveryOrder({supabase,serviceKey:service,reference,customerId:order.customer_id,amountKobo:Number(order.amount_kobo),details}); } catch (e) { return reply(500,'delivery order creation failed'); }
      }
      if (order.service === 'Create Your Consignment Box Video') {
        let details={}; try { details=JSON.parse(order.details||'{}'); } catch { return reply(400,'invalid consignment details'); }
        try { await createConsignmentJob({supabase,serviceKey:service,reference,customerId:order.customer_id,details,paidAt:tx.paid_at||tx.paidAt}); } catch (e) { return reply(500,'consignment job creation failed'); }
      }
      return reply(200, 'service payment verified');
    }
    const rpc = await fetch(`${supabase}/rest/v1/rpc/bt_paystack_credit_deposit`, {
      method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_reference: reference, p_transaction_id: String(tx.id), p_channel: String(tx.channel || ''), p_paid_at: tx.paid_at || tx.paidAt || new Date().toISOString(), p_amount_kobo: Number(tx.amount), p_currency: String(tx.currency || '') })
    });
    if (!rpc.ok) return reply(500, 'wallet credit failed');
    return reply(200, 'credited');
  } catch (error) { return reply(500, 'webhook processing error'); }
}
