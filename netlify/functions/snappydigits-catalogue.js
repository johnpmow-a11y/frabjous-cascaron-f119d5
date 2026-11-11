// Read-only SnappyDigits catalogue check.
// The API key is read only from Netlify's server-side environment variables.
exports.handler = async function (event) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: { ...headers, Allow: "GET" }, body: JSON.stringify({ ok: false, error: "Method not allowed." }) };
  }

  const apiKey = process.env.SNAPPYDIGITS_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: "SNAPPYDIGITS_API_KEY is not configured in Netlify." }) };
  }

  const base = "https://snappydigits.com/api/v1";
  const requestOptions = {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  };

  try {
    const [accountsResponse, boostsResponse] = await Promise.all([
      fetch(`${base}/services`, requestOptions),
      fetch(`${base}/smm/services`, requestOptions)
    ]);

    const [accounts, boosts] = await Promise.all([
      accountsResponse.json(),
      boostsResponse.json()
    ]);

    if (!accountsResponse.ok || accounts?.ok === false) {
      return { statusCode: accountsResponse.status || 502, headers, body: JSON.stringify({ ok: false, source: "account_catalogue", error: "SnappyDigits did not return the account catalogue. Check the API key and supplier account." }) };
    }
    if (!boostsResponse.ok || boosts?.ok === false) {
      return { statusCode: boostsResponse.status || 502, headers, body: JSON.stringify({ ok: false, source: "boost_catalogue", error: "SnappyDigits did not return the boosting catalogue. Check the API key and supplier account." }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        accountServices: Array.isArray(accounts.services) ? accounts.services : [],
        boostServices: Array.isArray(boosts.services) ? boosts.services : [],
        counts: {
          accountServices: Array.isArray(accounts.services) ? accounts.services.length : 0,
          boostServices: Array.isArray(boosts.services) ? boosts.services.length : 0
        }
      })
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ ok: false, error: "Could not reach SnappyDigits. Please try again later." })
    };
  }
};
