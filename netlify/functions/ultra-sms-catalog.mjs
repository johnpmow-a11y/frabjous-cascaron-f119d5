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
    headers: { Authorization:`Bearer ${key}`, Accept: 'application/json' },
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
  const key = process.env.ULTRA_SMS_API_KEY;
  if (!key) return json(503, { error: 'Ultra SMS is not configured on this Netlify site. Add ULTRA_SMS_API_KEY and redeploy.' });
  const service = String(event.queryStringParameters?.service || 'wa').trim().slice(0, 30);
  const country = String(event.queryStringParameters?.country || 'NG').trim().toUpperCase().slice(0, 2);
  if (!/^[a-z0-9_-]+$/i.test(service) || !/^[A-Z]{2}$/.test(country)) {
    return json(400, { error: 'Choose a valid service and two-letter country code.' });
  }
  try {
    const [balance, servicesData, countriesData, serversData, pricesData] = await Promise.all([
      upstream('/balance', key),
      upstream('/services', key),
      upstream('/countries', key),
      upstream('/servers', key),
      upstream(`/prices?service=${encodeURIComponent(service)}&country=${encodeURIComponent(country)}`, key)
    ]);
    const services = Array.isArray(servicesData.services) ? servicesData.services : [];
    const countries = Array.isArray(countriesData.countries) ? countriesData.countries : [];
    const servers = Array.isArray(serversData.servers) ? serversData.servers : [];
    const selected = services.find(x => x.code === service);
    return json(200, {
      balance: { balance: balance.balance, currency: balance.currency || 'USD' },
      services,
      countries,
      servers,
      prices: (Array.isArray(pricesData.prices) ? pricesData.prices : []).map(row => {
        const fx = Number(process.env.ULTRA_SMS_USD_NGN_RATE);
        const supplierCents = Number(row.price_cents);
        const pricingReady = Number.isFinite(fx) && fx > 0 && Number.isSafeInteger(supplierCents) && supplierCents > 0;
        // price_cents is USD cents; multiplying by NGN/USD yields kobo.
        const markup = Number(process.env.ULTRA_SMS_MARKUP_PERCENT ?? 3);
        const baseNgn = Math.round(supplierCents * fx) / 100;
        const europeanCountries = new Set(['AL','AD','AT','BY','BE','BA','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT','XK','LV','LI','LT','LU','MT','MD','MC','ME','NL','MK','NO','PL','PT','RO','RU','SM','RS','SK','SI','ES','SE','CH','UA','VA','TR','GE','AM','AZ']);
        const fixedMarkupNgn = country === 'US' ? 3000 : country === 'GB' ? 4000 : country === 'CA' ? 2000 : country === 'NZ' ? 3800 : europeanCountries.has(country) ? 3800 : 1800;
        const customerPriceNgn = pricingReady ? Number((baseNgn + fixedMarkupNgn).toFixed(2)) : null;
        return { ...row, customer_price_ngn: customerPriceNgn, pricingReady };
      }),
      pricingReady: Number.isFinite(Number(process.env.ULTRA_SMS_USD_NGN_RATE)) && Number(process.env.ULTRA_SMS_USD_NGN_RATE) > 0,
      currency: pricesData.currency || balance.currency || 'USD',
      fxNgnPerUsd: Number(process.env.ULTRA_SMS_USD_NGN_RATE) || null,
      markupNgn: country === 'US' ? 3000 : country === 'GB' ? 4000 : country === 'CA' ? 2000 : country === 'NZ' ? 3800 : ['AL','AD','AT','BY','BE','BA','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT','XK','LV','LI','LT','LU','MT','MD','MC','ME','NL','MK','NO','PL','PT','RO','RU','SM','RS','SK','SI','ES','SE','CH','UA','VA','TR','GE','AM','AZ'].includes(country) ? 3800 : 1800,
      selectedServiceName: selected?.name || service
    });
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 502;
    console.error('Ultra SMS catalogue request failed:', error.message);
    return json(status, { error: error.message || 'Could not contact Ultra SMS.' });
  }
}
