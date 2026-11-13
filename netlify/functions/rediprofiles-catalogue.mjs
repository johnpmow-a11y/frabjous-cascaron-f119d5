// All Ads Manager — read-only Rediprofiles catalogue.
// The supplier key is read only from Netlify server-side environment variables.
const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  },
  body: JSON.stringify(body)
});

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { ok: false, error: "Method not allowed." });
  }

  const apiKey = process.env.REDIPROFILES_API_KEY;
  if (!apiKey) {
    return json(503, {
      ok: false,
      error: "Rediprofiles is not connected yet. Add REDIPROFILES_API_KEY to Netlify environment variables."
    });
  }

  const base = "https://rediprofiles.com/api/v1";
  const options = {
    method: "GET",
    headers: {
      "X-API-Key": apiKey,
      "X-Currency": "NGN",
      "Accept": "application/json"
    },
    signal: AbortSignal.timeout(15000)
  };

  try {
    const [servicesResponse, categoriesResponse] = await Promise.all([
      fetch(`${base}/services/?currency=ngn`, options),
      fetch(`${base}/categories/`, options)
    ]);

    const servicesPayload = await servicesResponse.json().catch(() => null);
    const categoriesPayload = await categoriesResponse.json().catch(() => null);

    if (!servicesResponse.ok) {
      return json(servicesResponse.status, {
        ok: false,
        error: servicesResponse.status === 401 || servicesResponse.status === 403
          ? "Rediprofiles rejected the API key. Check the key in Netlify."
          : "Rediprofiles could not return the account catalogue."
      });
    }

    const services = Array.isArray(servicesPayload)
      ? servicesPayload
      : Array.isArray(servicesPayload?.services)
        ? servicesPayload.services
        : Array.isArray(servicesPayload?.results)
          ? servicesPayload.results
          : [];

    const categories = categoriesResponse.ok
      ? (Array.isArray(categoriesPayload)
          ? categoriesPayload
          : Array.isArray(categoriesPayload?.categories)
            ? categoriesPayload.categories
            : [])
      : [];

    // Customer price = supplier price + 50% + ₦800.
    const pricedServices = services.map(item => {
      const supplierValue = item.price_ngn ?? (String(item.currency || "").toUpperCase() === "NGN" ? item.price : null);
      const supplierPrice = Number(supplierValue);
      if (!Number.isFinite(supplierPrice) || supplierPrice <= 0) return item;
      return {
        ...item,
        supplier_price_ngn: supplierPrice,
        customer_price_ngn: Math.round(supplierPrice * 1.5 + 800)
      };
    });

    return json(200, {
      ok: true,
      services: pricedServices,
      categories,
      currency: "NGN",
      pricing_rule: "supplier price + 50% + ₦800",
      count: pricedServices.length
    });
  } catch (error) {
    return json(502, {
      ok: false,
      error: "Could not reach Rediprofiles. Please try again shortly."
    });
  }
}
