# Dutchkem Ventures ServiceMart
## Full Deployment Guide

---

## QUICK START

### Step 1 — Supabase Setup
1. Go to https://supabase.com → Create a new project
2. Go to **SQL Editor** → paste contents of `supabase-schema.sql` → Run
3. Go to **Storage** → bucket `payment-proofs` is already created by the SQL
4. Copy your **Project URL** and **anon/public key** from Project Settings > API

### Step 2 — Connect Supabase to index.html
Open `index.html` and add these two lines just before `</head>`:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
  const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
  const SUPABASE_ANON_KEY = 'your-anon-key-here';
  const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
</script>
```

Replace the mock auth functions in `index.html` with real Supabase calls (see below).

### Step 3 — Netlify Deployment
1. Push project to GitHub
2. Go to https://app.netlify.com → New Site from Git
3. Set build settings: Build command = (empty), Publish directory = `.`
4. Add Environment Variables in Netlify Dashboard > Site Settings > Environment:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   ← NEVER expose in frontend
   ALLOWED_ORIGIN=https://your-site.netlify.app
   ```
5. Deploy!

### Step 4 — Create Your Admin Account
1. Sign up on the live site with `admin@dutchkem.com`
2. In Supabase SQL Editor run:
   ```sql
   UPDATE public.profiles SET role = 'admin' WHERE email = 'admin@dutchkem.com';
   ```

---

## REAL SUPABASE AUTH INTEGRATION

Replace the mock `handleAuth()` function in `index.html` with:

```javascript
// SIGN UP
async function signUp(email, password, fullName) {
  const { data, error } = await supabaseClient.auth.signUp({
    email, password,
    options: { data: { full_name: fullName } }
  });
  if (error) throw error;
  return data;
}

// SIGN IN
async function signIn(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// SIGN OUT
async function signOut() {
  await supabaseClient.auth.signOut();
}

// GET SESSION
async function getSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session;
}
```

---

## FILE STRUCTURE

```
dutchkem-servicemart/
├── index.html                          ← Main frontend (single file app)
├── supabase-schema.sql                 ← Run in Supabase SQL Editor
├── netlify.toml                        ← Netlify config
├── package.json                        ← Node dependencies
├── README.md                           ← This file
└── netlify/
    └── functions/
        ├── verify-payment.js           ← Admin: verify/reject payments
        ├── submit-payment.js           ← User: submit proof of payment
        └── generate-output.js         ← Deliver service documents
```

---

## NETLIFY FUNCTIONS — CALLING FROM FRONTEND

```javascript
// Get JWT token for API calls
async function getAuthToken() {
  const session = await getSession();
  return session?.access_token;
}

// Submit payment proof
async function submitToBackend(paymentData) {
  const token = await getAuthToken();
  const res = await fetch('/.netlify/functions/submit-payment', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(paymentData)
  });
  return res.json();
}

// Admin: verify payment
async function adminVerifyPayment(paymentId, action, notes) {
  const token = await getAuthToken();
  const res = await fetch('/.netlify/functions/verify-payment', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentId, action, adminNotes: notes })
  });
  return res.json();
}
```

---

## PAYMENT ACCOUNT (Display Only)

| Field | Value |
|-------|-------|
| Bank | OPay |
| Account Number | **812116102** |
| Account Name | **Oladotun Alabi** |

**No payment APIs used.** Manual verification only.

---

## SERVICE PRICING

| Service | Price (₦) |
|---------|-----------|
| Business Registration | ₦15,000 |
| Legal Document Drafting | ₦20,000 |
| Business Plan Writing | ₦25,000 |
| Financial Projections | ₦18,000 |
| Brand Strategy & Naming | ₦12,000 |
| Business Proposal Writing | ₦16,000 |
| Market Research Report | ₦22,000 |
| HR Documents & Policies | ₦14,000 |

**Bundle Discount:** Select 3 or more services → **20% OFF** automatically

---

## SECURITY NOTES

- Service Role Key (`SUPABASE_SERVICE_ROLE_KEY`) MUST only be in Netlify env vars, NEVER in frontend HTML
- All Netlify Functions verify JWT before processing any request
- RLS policies enforce data isolation at database level
- Storage bucket is private; only authenticated owners can access their files
- Rate limiting: 10 requests/minute per user per function
- All admin actions logged to `audit_log` table with IP and user agent

---

## SUPPORT
Built by Dutchkem Ventures ServiceMart — One Platform. 8 Services. Your Business Solution.
