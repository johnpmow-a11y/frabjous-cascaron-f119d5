import { randomUUID } from 'node:crypto';

const BASE = 'https://rediprofiles.com/api/v1';
const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  },
  body: JSON.stringify(body)
});

async function db(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server settings are missing.');
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || 'Database request failed.');
  return data;
}

async function rpc(name, args) {
  return db(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
}

async function supplier(path, apiKey, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'X-API-Key': apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function unwrapOrder(payload) {
  if (!payload || typeof payload !== 'object') return {};
  return payload.order || payload.data?.order || payload.data || payload;
}

function servicePriceNgn(item) {
  const value = item.price_ngn ?? (String(item.currency || '').toUpperCase() === 'NGN' ? item.price : null);
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

async function reconcile(externalRef, apiKey) {
  const result = await supplier(`/orders/?external_customer_ref=${encodeURIComponent(externalRef)}`, apiKey);
  if (!result.response.ok) return null;
  const payload = result.data;
  const rows = Array.isArray(payload) ? payload
    : Array.isArray(payload.orders) ? payload.orders
    : Array.isArray(payload.results) ? payload.results
    : payload.order ? [payload.order] : [];
  return rows[0] || null;
}

async function saveSupplierOrder(externalRef, order, raw) {
  const statusRaw = String(order.status || raw.status || 'processing').toLowerCase();
  const status = statusRaw === 'processing' ? 'pending'
    : ['pending', 'pre_ordered', 'completed', 'failed', 'refunded'].includes(statusRaw)
      ? statusRaw : 'pending';
  const supplierId = order.id ?? order.order_id ?? raw.order_id ?? null;
  const accountData = order.account_data ?? order.account ?? raw.account_data ?? null;
  await rpc('bt_rediprofiles_complete_order', {
    p_external_customer_ref: externalRef,
    p_supplier_order_id: supplierId == null ? null : String(supplierId),
    p_status: status,
    p_account_data: accountData,
    p_supplier_response: raw
  });
  if (status === 'failed' || status === 'refunded') {
    await rpc('bt_rediprofiles_refund_order', {
      p_external_customer_ref: externalRef,
      p_reason: `Supplier order status: ${status}`
    });
    return { status: 'refunded', account_data: null };
  }
  return { status, account_data: accountData };
}

export async function handler(event) {
  const apiKey = process.env.REDIPROFILES_API_KEY;
  if (!apiKey || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(503, { ok: false, error: 'Rediprofiles or Supabase is not configured.' });
  }

  if (event.httpMethod === 'GET') {
    try {
      const token = String(event.queryStringParameters?.token || '');
      if (!/^[0-9a-f-]{36}$/i.test(token)) return json(401, { ok: false, error: 'Please log in again.' });
      const orders = await rpc('bt_customer_rediprofiles_orders_get', { p_token: token });
      return json(200, { ok: true, orders: Array.isArray(orders) ? orders : [] });
    } catch (error) {
      const message = error.message || '';
      return json(message.includes('session') ? 401 : 500, {
        ok: false,
        error: message.includes('session') ? 'Your login session has expired.' : 'Could not load your account orders.'
      });
    }
  }

  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });

  let externalRef = null;
  try {
    const body = JSON.parse(event.body || '{}');
    const token = String(body.token || '');
    const serviceId = String(body.service_id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(token)) return json(401, { ok: false, error: 'Please log in again.' });
    if (!serviceId || serviceId.length > 80) return json(400, { ok: false, error: 'Choose a valid account product.' });

    const sessions = await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
    if (!sessions.length) return json(401, { ok: false, error: 'Your login session has expired.' });

    const catalogue = await supplier('/services/?currency=ngn', apiKey);
    if (!catalogue.response.ok) return json(502, { ok: false, error: 'Could not refresh the supplier catalogue. No money has been deducted.' });
    const services = Array.isArray(catalogue.data) ? catalogue.data
      : Array.isArray(catalogue.data.services) ? catalogue.data.services
      : Array.isArray(catalogue.data.results) ? catalogue.data.results : [];
    const item = services.find(x => String(x.id) === serviceId);
    if (!item || item.is_active === false || item.in_stock === false || Number(item.quantity_in_stock ?? item.stock ?? 0) < 1) {
      return json(409, { ok: false, error: 'This account is no longer available. Refresh the catalogue.' });
    }

    const supplierPrice = servicePriceNgn(item);
    if (supplierPrice === null) return json(502, { ok: false, error: 'The supplier did not provide a valid naira price. No money has been deducted.' });
    // Customer price = supplier price + 50% + ₦800.
    const supplierKobo = Math.round(supplierPrice * 100);
    const customerKobo = Math.round((supplierPrice * 1.5 + 800) * 100);
    if (!Number.isSafeInteger(supplierKobo) || !Number.isSafeInteger(customerKobo) || customerKobo <= 0) {
      return json(502, { ok: false, error: 'The supplier price is invalid.' });
    }

    externalRef = `adsrp-${Date.now()}-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const reserved = await rpc('bt_rediprofiles_reserve_order', {
      p_token: token,
      p_external_customer_ref: externalRef,
      p_supplier_service_id: serviceId,
      p_service_name: String(item.name || 'Ready-made account').slice(0, 180),
      p_supplier_price_kobo: supplierKobo,
      p_customer_price_kobo: customerKobo
    });

    let supplierResult;
    try {
      supplierResult = await supplier('/orders/', apiKey, {
        method: 'POST',
        headers: { 'Idempotency-Key': externalRef },
        body: JSON.stringify({
          service_id: /^\d+$/.test(serviceId) ? Number(serviceId) : serviceId,
          quantity: 1,
          external_customer_ref: externalRef
        })
      });
    } catch (networkError) {
      // A timeout can occur after the supplier accepted the order. Reconcile before retrying or refunding.
      const found = await reconcile(externalRef, apiKey).catch(() => null);
      if (found) {
        const saved = await saveSupplierOrder(externalRef, unwrapOrder(found), found);
        return json(200, { ok: true, order: { reference: externalRef, ...saved } });
      }
      await rpc('bt_rediprofiles_complete_order', {
        p_external_customer_ref: externalRef,
        p_supplier_order_id: null,
        p_status: 'pending',
        p_account_data: null,
        p_supplier_response: { reconciliation: 'pending', network_error: true }
      });
      return json(202, { ok: false, pending: true, reference: externalRef, message: 'Supplier confirmation is pending. Your wallet debit is held safely; do not place the order again.' });
    }

    if (!supplierResult.response.ok) {
      // A timeout or server error can happen after the supplier has accepted an order.
      // Reconcile by external_customer_ref before considering a refund.
      if (supplierResult.response.status >= 500 || supplierResult.response.status === 408) {
        const found = await reconcile(externalRef, apiKey).catch(() => null);
        if (found) {
          const saved = await saveSupplierOrder(externalRef, unwrapOrder(found), found);
          return json(200, { ok: true, order: { reference: externalRef, ...saved } });
        }
        await rpc('bt_rediprofiles_complete_order', {
          p_external_customer_ref: externalRef,
          p_supplier_order_id: null,
          p_status: 'pending',
          p_account_data: null,
          p_supplier_response: { reconciliation: 'pending', http_status: supplierResult.response.status }
        });
        return json(202, { ok: false, pending: true, reference: externalRef, message: 'Supplier confirmation is pending. Your wallet debit is held safely; do not place the order again.' });
      }

      await rpc('bt_rediprofiles_refund_order', {
        p_external_customer_ref: externalRef,
        p_reason: `Supplier rejected order (HTTP ${supplierResult.response.status})`
      });
      return json(502, { ok: false, refunded: true, error: supplierResult.data.message || supplierResult.data.error || 'The supplier rejected the order. Your wallet has been refunded.' });
    }

    const order = unwrapOrder(supplierResult.data);
    const saved = await saveSupplierOrder(externalRef, order, supplierResult.data);
    return json(200, {
      ok: true,
      order: {
        reference: externalRef,
        supplier_order_id: order.id ?? order.order_id ?? null,
        service_name: item.name || 'Ready-made account',
        price: customerKobo / 100,
        ...saved
      }
    });
  } catch (error) {
    const message = error.message || 'Could not complete the account order.';
    if (externalRef && (message.includes('INSUFFICIENT_WALLET_BALANCE') || message.includes('CUSTOMER_SESSION_EXPIRED'))) {
      return json(message.includes('CUSTOMER_SESSION_EXPIRED') ? 401 : 402, {
        ok: false,
        error: message.includes('CUSTOMER_SESSION_EXPIRED') ? 'Please log in again.' : 'Your wallet balance is insufficient.'
      });
    }
    console.error('Rediprofiles order error:', message);
    return json(500, { ok: false, error: 'The account order could not be completed. If your wallet was debited, contact support with the order reference.' , reference: externalRef });
  }
}
