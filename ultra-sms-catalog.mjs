const BASE = 'https://ultrasmsin.com/api/v1';
const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': process.env.URL ? `https://${new URL(process.env.URL).host}` : '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  },
  body: JSON.stringify(body)
});

async function upstream(path, key) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || `Ultra SMS returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET for the live catalogue.' });
  const token = String(event.queryStringParameters?.token || '');
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json(401, { error: 'Please log in to view the catalogue.' });
  const dbUrl = process.env.SUPABASE_URL, dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dbUrl || !dbKey) return json(503, { error: 'Supabase server settings are missing.' });
  const sessionCheck = await fetch(`${dbUrl}/rest/v1/customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`, { headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}` } });
  const sessionRows = sessionCheck.ok ? await sessionCheck.json() : [];
  if (!sessionRows.length) return json(401, { error: 'Your login session has expired.' });
  const key = process.env.ULTRA_SMS_API_KEY;
  if (!key) return json(503, { error: 'Ultra SMS is not configured on this Netlify site. Add ULTRA_SMS_API_KEY and redeploy.' });
  const service = 'wa'; // WhatsApp only, enforced on the server.
  const country = String(event.queryStringParameters?.country || 'NG').trim().toUpperCase().slice(0, 2);
  if (String(event.queryStringParameters?.service || 'wa') !== 'wa' || !/^[A-Z]{2}$/.test(country)) {
    return json(400, { error: 'Choose a valid service and two-letter country code.' });
  }
  try {
    const [servicesData, countriesData, pricesData] = await Promise.all([
      upstream('/services', key),
      upstream('/countries', key),
      upstream(`/prices?service=${encodeURIComponent(service)}&country=${encodeURIComponent(country)}`, key)
    ]);
    const services = Array.isArray(servicesData.services) ? servicesData.services : [];
    const countries = Array.isArray(countriesData.countries) ? countriesData.countries : [];
    const selected = services.find(x => x.code === service);
    const fx = Number(process.env.ULTRA_SMS_USD_NGN_RATE);
    const markup = 3;
    const pricingReady = Number.isFinite(fx) && fx > 0 && Number.isFinite(markup) && markup >= 0;
    const priced = (Array.isArray(pricesData.prices) ? pricesData.prices : []).map(x => ({
      ...x,
      customer_price_ngn: pricingReady && Number.isFinite(Number(x.price_cents))
        ? Math.round(Math.round(Number(x.price_cents) * fx) * (1 + markup / 100)) / 100 : null
    }));
    return json(200, {
      supplierConnected: true,
      services: services.filter(x => x.code === 'wa'),
      countries,
      prices: priced,
      pricingReady,
      currency: pricesData.currency || 'USD',
      selectedServiceName: selected?.name || service
    });
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 502;
    console.error('Ultra SMS catalogue request failed:', error.message);
    return json(status, { error: error.message || 'Could not contact Ultra SMS.' });
  }
}
