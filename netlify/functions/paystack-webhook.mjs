import crypto from 'node:crypto';
const reply = (statusCode, body = 'ok') => ({ statusCode, body });
export async function handler(event) {
  if (event.httpMethod !== 'POST') return reply(405, 'method not allowed');
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const supabase = process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !supabase || !service) return reply(503, 'not configured');
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
    const rpc = await fetch(`${supabase}/rest/v1/rpc/bt_paystack_credit_deposit`, {
      method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_reference: reference, p_transaction_id: String(tx.id), p_channel: String(tx.channel || ''), p_paid_at: tx.paid_at || tx.paidAt || new Date().toISOString(), p_amount_kobo: Number(tx.amount), p_currency: String(tx.currency || '') })
    });
    if (!rpc.ok) return reply(500, 'wallet credit failed');
    return reply(200, 'credited');
  } catch (error) { return reply(500, 'webhook processing error'); }
}
