ALL ADS MANAGER — NETLIFY DEPLOY PACKAGE

This archive contains the runtime website and Netlify Functions only:
- public/
- netlify/functions/
- netlify.toml
- package.json

IMPORTANT
1. Do not run SQL from this deployment archive. No database migrations are included.
2. Keep the existing Supabase project, customer login, admin login, and working Gmail settings unchanged.
3. Existing Netlify environment variables must be preserved. Required runtime variables used by this build include:
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   PAYSTACK_SECRET_KEY (must be a LIVE sk_live_ key for live payments)
   ULTRA_SMS_API_KEY
   ULTRA_SMS_USD_NGN_RATE
   ULTRA_SMS_WEBHOOK_SECRET
   GMAIL_USER
   GMAIL_APP_PASSWORD
4. PAYSTACK_PUBLIC_KEY is not read by these server functions; preserve any existing frontend configuration if present.
5. Do not enable customer sales for a new service until live Paystack settlement and the real provider fulfilment path have been tested.

DEPLOYMENT
Deploy the entire archive's extracted project root through a Git-connected Netlify site or the Netlify CLI. A static-only upload of public/ is NOT sufficient because it omits server functions. Do not create a second Netlify site unless intentionally migrating.

DATABASE
The Supabase setup SQL from the previous step is separate and was reported successful. This archive intentionally omits all SQL migrations because the migration folder contained old/conflicting scripts. Before launch, verify the existing lock/subscription, wallet, service_payments, and UltraSMS database objects with read-only checks; do not bulk-run old migrations.

VERIFICATION LIMITS
Local JavaScript syntax checks passed for all Netlify function files and the inline website script. This does not verify live Supabase, Netlify, Gmail, Paystack, UltraSMS, storage uploads, supplier fulfilment, or courier delivery.
