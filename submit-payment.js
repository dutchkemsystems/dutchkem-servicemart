// netlify/functions/submit-payment.js
// ============================================================
// DUTCHKEM VENTURES — Submit Payment Request
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const rateLimitMap = new Map();
function checkRateLimit(userId) {
  const now = Date.now(); const window = 60000; const max = 10;
  if (!rateLimitMap.has(userId)) { rateLimitMap.set(userId, {count:1,start:now}); return true; }
  const e = rateLimitMap.get(userId);
  if (now - e.start > window) { rateLimitMap.set(userId, {count:1,start:now}); return true; }
  if (e.count >= max) return false;
  e.count++; return true;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({error:'Method not allowed'}) };

  const token = (event.headers.authorization || '').replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { statusCode: 401, headers, body: JSON.stringify({error:'Unauthorized'}) };

  if (!checkRateLimit(user.id)) return { statusCode: 429, headers, body: JSON.stringify({error:'Rate limit exceeded'}) };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers, body: JSON.stringify({error:'Invalid JSON'}) }; }

  const { businessName, serviceIds, serviceNames, totalNgn, discountNgn, hasBundleDiscount, txnReference } = body;

  if (!serviceIds?.length || !totalNgn) {
    return { statusCode: 400, headers, body: JSON.stringify({error:'serviceIds and totalNgn are required'}) };
  }

  // Generate reference
  const ref = 'DV-' + Math.random().toString(36).substring(2,10).toUpperCase();

  const { data, error: insertError } = await supabase
    .from('payment_requests')
    .insert({
      user_id: user.id,
      reference_code: ref,
      business_name: businessName,
      agent_names: serviceIds,
      service_names: serviceNames,
      amount_ngn: totalNgn + (discountNgn || 0),
      discount_ngn: discountNgn || 0,
      total_ngn: totalNgn,
      has_bundle_discount: hasBundleDiscount || false,
      txn_reference: txnReference,
      status: 'proof_uploaded'
    })
    .select()
    .single();

  if (insertError) return { statusCode: 500, headers, body: JSON.stringify({error: insertError.message}) };

  // Audit log
  await supabase.from('audit_log').insert({
    action: 'PAYMENT_SUBMITTED',
    target_user_id: user.id,
    target_payment_id: data.id,
    metadata: { reference: ref, total: totalNgn }
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, reference: ref, paymentId: data.id })
  };
};
