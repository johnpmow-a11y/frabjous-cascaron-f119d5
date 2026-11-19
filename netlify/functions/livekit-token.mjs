import crypto from 'node:crypto';

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  },
  body: JSON.stringify(body)
});

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const b64url = value => Buffer.from(value).toString('base64url');

function signLiveKitToken(apiKey, apiSecret, customerId, roomName) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT', kid: apiKey };
  const payload = {
    iss: apiKey,
    sub: customerId,
    nbf: now - 5,
    iat: now,
    exp: now + 10 * 60,
    video: {
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    }
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.createHmac('sha256', apiSecret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

async function supabase(path, options = {}) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('Supabase server configuration is missing.');
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data.message || data.error || 'Database request failed.');
  return data;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });

  try {
    const body = JSON.parse(event.body || '{}');
    const sessionToken = String(body.token || '');
    const callId = String(body.call_id || '');
    if (!uuid.test(sessionToken) || !uuid.test(callId)) {
      return json(400, { error: 'A valid login session and call ID are required.' });
    }

    const nowIso = new Date().toISOString();
    const sessions = await supabase(
      `customer_sessions?select=customer_id&token=eq.${encodeURIComponent(sessionToken)}&expires_at=gt.${encodeURIComponent(nowIso)}&limit=1`
    );
    const session = sessions[0];
    let identity = session?.customer_id || '';
    if (!identity) {
      const admins = await supabase(
        `admin_sessions?select=token&token=eq.${encodeURIComponent(sessionToken)}&expires_at=gt.${encodeURIComponent(nowIso)}&limit=1`
      );
      if (!admins.length) return json(401, { error: 'Please log in again.' });
      const adminHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
      const adminCalls = await supabase(
        `aam_calls?select=id,caller_role,admin_session_hash,status&id=eq.${encodeURIComponent(callId)}&caller_role=eq.admin&admin_session_hash=eq.${adminHash}&status=eq.active&limit=1`
      );
      if (!adminCalls.length) return json(403, { error: 'This administrator session is not authorised for the call.' });
      identity = `admin-${adminHash.slice(0, 24)}`;
    } else {
      // A customer must be explicitly accepted before a room token is issued.
      const participants = await supabase(
        `aam_call_participants?select=call_id,customer_id,status,call:aam_calls!inner(id,status)&call_id=eq.${encodeURIComponent(callId)}&customer_id=eq.${encodeURIComponent(identity)}&status=eq.accepted&call.status=eq.active&limit=1`
      );
      if (!participants.length) return json(403, { error: 'You are not an active participant in this call.' });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !livekitUrl) {
      return json(503, { error: 'LiveKit server configuration is incomplete.' });
    }
    if (!/^wss:\/\//i.test(livekitUrl)) {
      return json(503, { error: 'LIVEKIT_URL must be a secure WebSocket URL.' });
    }

    const roomName = `aam-call-${callId}`;
    const accessToken = signLiveKitToken(apiKey, apiSecret, identity, roomName);
    return json(200, { token: accessToken, url: livekitUrl, room_name: roomName, expires_in: 600 });
  } catch (error) {
    return json(500, { error: error.message || 'Could not create a call access token.' });
  }
}
