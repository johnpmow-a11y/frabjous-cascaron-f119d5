const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
export async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  const secret = process.env.PAYSTACK_SECRET_KEY, supabase = process.env.SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !supabase || !service) return json(503, { error: 'Payment service is not configured yet.' });
  const reference = event.queryStringParameters?.reference || '';
  const token = event.queryStringParameters?.token || '';
  if (!reference || !/^[0-9a-f-]{36}$/i.test(token)) return json(400, { error: 'Missing payment reference or login session.' });
  try {
    const headers = { apikey: service, Authorization: `Bearer ${service}` };
    const sessionRes = await fetch(`${supabase}/rest/v1/customer_sessions?select=customer_id,expires_at&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`, { headers });
    const sessions = await sessionRes.json();
    if (!sessions?.length) return json(401, { error: 'Please log in again to view this payment.' });
    const depositRes = await fetch(`${supabase}/rest/v1/wallet_deposits?select=customer_id,amount_kobo,status&reference=eq.${encodeURIComponent(reference)}&limit=1`, { headers });
    const deposits = await depositRes.json();
    if (!deposits?.length || deposits[0].customer_id !== sessions[0].customer_id) return json(404, { error: 'Payment record not found for this account.' });
    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${secret}` } });
    const verified = await verifyResponse.json();
    const tx = verified.data;
    if (verifyResponse.ok && verified.status && tx?.status === 'success') {
      const credit = await fetch(`${supabase}/rest/v1/rpc/bt_paystack_credit_deposit`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_reference: reference, p_transaction_id: String(tx.id), p_channel: String(tx.channel || ''), p_paid_at: tx.paid_at || tx.paidAt || new Date().toISOString(), p_amount_kobo: Number(tx.amount), p_currency: String(tx.currency || '') }) });
      if (!credit.ok) return json(500, { error: 'Payment is confirmed but wallet update is pending. Please refresh shortly.' });
      return json(200, { status: 'success', message: 'Payment confirmed and your balance has been updated.' });
    }
    return json(200, { status: deposits[0].status, message: 'Payment is not confirmed yet. If you have just paid, wait a moment and refresh.' });
  } catch (error) { return json(500, { error: 'Could not verify payment right now.' }); }
}
