import { randomUUID } from 'node:crypto';
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const env = () => ({ secret: process.env.PAYSTACK_SECRET_KEY, supabase: process.env.SUPABASE_URL, service: process.env.SUPABASE_SERVICE_ROLE_KEY });
async function sb(path, options = {}) {
  const { supabase, service } = env();
  const response = await fetch(`${supabase}/rest/v1/${path}`, { ...options, headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || 'Database request failed');
  return data;
}
export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const { secret, supabase, service } = env();
  if (!secret || !supabase || !service) return json(503, { error: 'Payment service is not configured yet.' });
  try {
    const body = JSON.parse(event.body || '{}');
    const token = String(body.token || '');
    const email = String(body.email || '').trim().toLowerCase();
    const method = String(body.method || '');
    const amount = Number(body.amount);
    if (!/^[0-9a-f-]{36}$/i.test(token)) return json(401, { error: 'Please log in again.' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: 'Enter a valid email address for your payment receipt.' });
    if (!Number.isInteger(amount) || amount < 100 || amount > 3000000) return json(400, { error: 'Choose an amount from ₦100 to ₦3,000,000.' });
    if (!['bank_transfer', 'card'].includes(method)) return json(400, { error: 'Choose Bank Transfer or ATM/Card.' });
    const sessions = await sb(`customer_sessions?select=customer_id,expires_at&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
    if (!sessions?.length) return json(401, { error: 'Your session has expired. Please log in again.' });
    const customerId = sessions[0].customer_id;
    const reference = `ads${Date.now()}${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await sb('wallet_deposits', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ reference, customer_id: customerId, amount_kobo: amount * 100, currency: 'NGN', method, email, status: 'pending' }]) });
    const origin = event.headers.origin || `https://${event.headers.host}`;
    const payload = {
      email, amount: String(amount * 100), currency: 'NGN', reference,
      channels: method === 'card' ? ['card'] : ['bank_transfer'],
      callback_url: `${origin}/payment-return.html`,
      metadata: { customer_id: customerId, product: 'ADS Manager wallet deposit', payment_method: method }
    };
    const ps = await fetch('https://api.paystack.co/transaction/initialize', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await ps.json();
    if (!ps.ok || !result.status || !result.data?.authorization_url) {
      await sb(`wallet_deposits?reference=eq.${encodeURIComponent(reference)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'initialization_failed' }) });
      return json(502, { error: result.message || 'Paystack could not start this payment.' });
    }
    return json(200, { authorization_url: result.data.authorization_url, reference });
  } catch (error) {
    return json(500, { error: error.message || 'Could not start payment.' });
  }
}
