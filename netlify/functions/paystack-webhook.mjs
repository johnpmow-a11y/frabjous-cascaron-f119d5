import crypto from 'node:crypto';
const reply = (statusCode, body = 'ok') => ({ statusCode, body });
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
    const adminDeposit = await fetch(`${supabase}/rest/v1/admin_wallet_deposits?select=reference&reference=eq.${encodeURIComponent(reference)}&limit=1`, { headers });
    const adminRows = await adminDeposit.json().catch(() => []);
    const isAdminDeposit = adminDeposit.ok && Array.isArray(adminRows) && adminRows.length > 0;
    const rpcName = isAdminDeposit ? 'bt_admin_wallet_credit_deposit_webhook' : 'bt_paystack_credit_deposit';
    const rpc = await fetch(`${supabase}/rest/v1/rpc/${rpcName}`, {
      method: 'POST', headers,
      body: JSON.stringify({ p_reference: reference, p_transaction_id: String(tx.id), p_channel: String(tx.channel || ''), p_paid_at: tx.paid_at || tx.paidAt || new Date().toISOString(), p_amount_kobo: Number(tx.amount), p_currency: String(tx.currency || '') })
    });
    if (!rpc.ok) return reply(500, isAdminDeposit ? 'admin wallet credit failed' : 'customer wallet credit failed');
    return reply(200, isAdminDeposit ? 'admin wallet credited' : 'customer wallet credited');
  } catch (error) { return reply(500, 'webhook processing error'); }
}
