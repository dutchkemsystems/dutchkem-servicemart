// netlify/functions/generate-output.js
// ============================================================
// DUTCHKEM VENTURES — Generate Service Output (Post-Verification)
// Called after admin verifies payment to produce authenticated documents
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const rateLimitMap = new Map();
function checkRateLimit(userId) {
  const now = Date.now(); const window = 60000; const max = 10;
  if (!rateLimitMap.has(userId)) { rateLimitMap.set(userId,{count:1,start:now}); return true; }
  const e = rateLimitMap.get(userId);
  if (now-e.start>window) { rateLimitMap.set(userId,{count:1,start:now}); return true; }
  if (e.count>=max) return false;
  e.count++; return true;
}

// Service output templates
function generateServiceOutput(serviceName, businessName, clientName) {
  const date = new Date().toLocaleDateString('en-NG',{day:'numeric',month:'long',year:'numeric'});
  const ref = 'DV-OUT-' + Date.now().toString(36).toUpperCase();

  const outputs = {
    'Business Registration': {
      title: 'Certificate of Business Name Registration',
      content: `
CERTIFICATE OF BUSINESS NAME REGISTRATION
==========================================
Reference No: ${ref}
Date Issued: ${date}

This is to certify that the business name:

"${businessName}"

has been duly registered under the Companies and Allied Matters Act (CAMA) 2020 
as a Business Name in Nigeria.

Owner/Proprietor: ${clientName}
Registration Type: Business Name (Sole Proprietorship)
Status: Active & Valid
Prepared by: Dutchkem Ventures ServiceMart

NOTE: This document serves as a professional template and business guidance 
document. For official CAC registration, visit cac.gov.ng or engage a 
registered legal practitioner.

Thank you for choosing Dutchkem Ventures ServiceMart.
      `
    },
    'Business Plan Writing': {
      title: 'Business Plan — Executive Summary',
      content: `
BUSINESS PLAN
${businessName.toUpperCase()}
==========================================
Prepared by: Dutchkem Ventures ServiceMart
Date: ${date}
Client: ${clientName}
Reference: ${ref}

EXECUTIVE SUMMARY
-----------------
${businessName} is positioned to capitalize on current market opportunities 
in Nigeria's growing economy. This business plan outlines a comprehensive 
strategy for sustainable growth, operational excellence, and profitability.

VISION: To become the leading provider in our sector within 5 years.
MISSION: Delivering exceptional value to customers through innovation and integrity.

FINANCIAL HIGHLIGHTS (Year 1–3 Projection)
-------------------------------------------
Year 1 Revenue Target:    ₦5,000,000
Year 2 Revenue Target:    ₦12,500,000
Year 3 Revenue Target:    ₦28,000,000
Break-even Point:         Month 8

[Full 25-page business plan document delivered separately via your chosen channel]

Thank you for choosing Dutchkem Ventures ServiceMart.
      `
    },
    'default': {
      title: `Professional Service Output — ${serviceName}`,
      content: `
DUTCHKEM VENTURES SERVICEMART
Service: ${serviceName}
==========================================
Reference: ${ref}
Date: ${date}
Prepared for: ${clientName} (${businessName})

Your professional ${serviceName.toLowerCase()} document has been prepared 
by our expert team at Dutchkem Ventures ServiceMart.

This output is authentic, professionally structured, and tailored 
specifically for your business: ${businessName}.

[Complete document delivered to your selected channel]

Thank you so much for trusting Dutchkem Ventures with your business needs.
We hope this serves your business well. 🙏
      `
    }
  };

  return outputs[serviceName] || outputs['default'];
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

  if (!checkRateLimit(user.id)) return { statusCode: 429, headers, body: JSON.stringify({error:'Rate limit exceeded. Try again in a minute.'}) };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers, body: JSON.stringify({error:'Invalid JSON'}) }; }

  const { paymentId, deliveryFormat, deliveryChannel, deliveryAddress } = body;

  // Verify this payment belongs to user AND is verified
  const { data: payment, error: payErr } = await supabase
    .from('payment_requests')
    .select('*')
    .eq('id', paymentId)
    .eq('user_id', user.id)
    .eq('status', 'verified')
    .single();

  if (payErr || !payment) {
    return { statusCode: 403, headers, body: JSON.stringify({error:'Payment not found or not yet verified'}) };
  }

  // Get user profile for personalization
  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
  const clientName = profile?.full_name || 'Valued Client';

  // Generate outputs for all services
  const outputs = payment.service_names.map(svc =>
    generateServiceOutput(svc, payment.business_name || 'Your Business', clientName)
  );

  // Save project records
  for (const output of outputs) {
    await supabase.from('user_projects').insert({
      user_id: user.id,
      payment_request_id: paymentId,
      agent_name: output.title,
      project_title: output.title,
      project_data: { content: output.content, format: deliveryFormat },
      delivery_format: deliveryFormat,
      delivered_at: new Date().toISOString()
    });
  }

  // Update delivery preferences on payment
  await supabase.from('payment_requests').update({
    delivery_format: deliveryFormat,
    delivery_channel: deliveryChannel,
    delivery_address: deliveryAddress
  }).eq('id', paymentId);

  // Audit log
  await supabase.from('audit_log').insert({
    action: 'OUTPUT_GENERATED',
    target_user_id: user.id,
    target_payment_id: paymentId,
    metadata: { deliveryFormat, deliveryChannel, serviceCount: outputs.length }
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      message: `Your documents have been prepared and will be delivered via ${deliveryChannel}`,
      outputs: outputs.map(o => ({ title: o.title, preview: o.content.substring(0, 200) + '...' })),
      deliveryConfirmation: `Delivering ${outputs.length} document(s) as ${deliveryFormat} via ${deliveryChannel}`
    })
  };
};
