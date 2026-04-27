// netlify/functions/verify-payment.js
// ============================================================
// DUTCHKEM VENTURES — Verify Payment (Admin Only)
// - Verifies Supabase JWT
// - Rate limits: 10 req/min per user
// - Logs all actions to audit_log table
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-side only

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Rate limit store (in-memory for demo; use Redis/DB in production)
const rateLimitMap = new Map();

function checkRateLimit(userId) {
  const now = Date.now();
  const window = 60 * 1000; // 1 minute
  const maxRequests = 10;
  
  if (!rateLimitMap.has(userId)) {
    rateLimitMap.set(userId, { count: 1, start: now });
    return true;
  }
  
  const entry = rateLimitMap.get(userId);
  if (now - entry.start > window) {
    rateLimitMap.set(userId, { count: 1, start: now });
    return true;
  }
  
  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

async function logAuditAction(adminId, action, targetPaymentId, ip, ua, metadata) {
  await supabase.from('audit_log').insert({
    admin_id: adminId,
    action,
    target_payment_id: targetPaymentId,
    ip_address: ip,
    user_agent: ua,
    metadata
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // 1. Extract JWT
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Missing authorization token' }) };
  }
  const token = authHeader.split(' ')[1];

  // 2. Verify JWT with Supabase
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  }

  // 3. Check admin role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin access required' }) };
  }

  // 4. Rate limiting
  if (!checkRateLimit(user.id)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many requests. Please wait a minute.' }) };
  }

  // 5. Parse body
  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  const { paymentId, action, adminNotes } = body; // action: 'verify' | 'reject'
  if (!paymentId || !['verify','reject'].includes(action)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'paymentId and action (verify|reject) are required' }) };
  }

  // 6. Fetch the payment request
  const { data: payment, error: fetchError } = await supabase
    .from('payment_requests')
    .select('*')
    .eq('id', paymentId)
    .single();

  if (fetchError || !payment) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Payment request not found' }) };
  }

  if (!['pending','proof_uploaded'].includes(payment.status)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Cannot ${action} a payment with status: ${payment.status}` }) };
  }

  // 7. Update status
  const newStatus = action === 'verify' ? 'verified' : 'rejected';
  const { error: updateError } = await supabase
    .from('payment_requests')
    .update({
      status: newStatus,
      admin_notes: adminNotes || null,
      verified_by: user.id,
      verified_at: new Date().toISOString()
    })
    .eq('id', paymentId);

  if (updateError) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to update payment status' }) };
  }

  // 8. Audit log
  const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
  const ua = event.headers['user-agent'] || 'unknown';
  await logAuditAction(user.id, `PAYMENT_${action.toUpperCase()}`, paymentId, ip, ua, {
    previousStatus: payment.status,
    newStatus,
    adminNotes
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      message: `Payment successfully ${newStatus}`,
      paymentId,
      status: newStatus
    })
  };
};
