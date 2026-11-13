ALL ADS MANAGER — COMPLETE NETLIFY PROJECT

Deploy the complete repository/project root, not only the public folder:
- public/ (customer website and public tracking/payment return pages)
- netlify/functions/ (server-side integrations)
- supabase/migrations/ (database migration history)
- package.json
- netlify.toml
- README.txt and this file

EXISTING CONFIGURATION — PRESERVE IT
Keep the existing Supabase project, customer/admin login model, Netlify site and working Gmail delivery settings. Do not replace working secrets or payment settings as part of this update.

The current integrations use the existing environment variables, including:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- PAYSTACK_SECRET_KEY (use the approved LIVE secret for real payments)
- ULTRA_SMS_API_KEY
- ULTRA_SMS_USD_NGN_RATE (current NGN per USD)
- ULTRA_SMS_WEBHOOK_SECRET, if the supplier callback is enabled
- GMAIL_USER
- GMAIL_APP_PASSWORD
Preserve any additional variables already configured for other services. Never put service-role keys, payment secrets, Gmail app passwords or supplier API keys in public browser code.

NEW DATABASE MIGRATIONS IN THIS UPDATE
Apply these two files once in the existing Supabase project ftwhcqrtmfxdzokmudvu:
1. supabase/migrations/20261113_secure_customer_code_recovery.sql
   Removes the unsafe public username-only four-digit code reset function. Knowing a username alone is not identity verification.
2. supabase/migrations/20261113_wallet_withdrawals.sql
   Adds wallet withdrawal requests, reserved wallet funds, administrator review, manual paid status and automatic wallet refund when a request is rejected.

Do not bulk-run every historical migration again. The existing wallet, customer/admin sessions, Rediprofiles and other service migrations are already part of the project history. Only apply the two new migrations above unless a separate migration is specifically required.

WITHDRAWAL PROCESS
Customers submit an amount and bank details. The amount is reserved from their wallet while the request is pending. The administrator must make the bank transfer outside the application, then mark the request Paid. Rejecting a pending request automatically refunds the reserved amount. This build does not initiate automatic bank transfers.

PAYMENTS
Add Funds remains server-initialized through Paystack and supports NGN 100–3,000,000. The UI shows one 15-second preparation state. Do not claim real-money settlement is verified until the live Netlify deployment, Paystack webhook and actual live transaction have been checked.

ULTRASMS
The official UltraSMS API returns supplier prices as USD cents. The catalogue converts them to naira using ULTRA_SMS_USD_NGN_RATE and applies the agreed 3% markup. The order endpoint rechecks price and stock before purchase. WhatsApp verification numbers are temporary activations, not permanent numbers or monthly rentals. Facebook, TikTok and Zangi remain separate services.

EMAIL
Only the visible support-email branding was changed to All Ads Manager. The Gmail/Nodemailer transport and GMAIL_USER / GMAIL_APP_PASSWORD configuration are unchanged.

SECURITY AND CUSTOMER ACCOUNTS
Customer accounts remain name/username plus a four-digit code, without requiring customer email. Do not restore a public username-only code reset. Forgotten-code recovery must be handled by the administrator after verifying the account owner.

BUILD AND VERIFICATION
The GitHub Actions workflow .github/workflows/verify-package.yml checks JavaScript syntax for Netlify functions and the inline browser application, then packages the complete repository as All-Ads-Manager-Complete.zip. A successful source build does not prove the live Netlify, Supabase, Paystack, Gmail or supplier systems are working; those require deployment and real environment checks.
