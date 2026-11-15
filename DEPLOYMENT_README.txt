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
- SHADOW_OTP_API_KEY
- SHADOW_OTP_PKR_NGN_RATE
Preserve any additional variables already configured for other services. Never put service-role keys, payment secrets, Gmail app passwords or supplier API keys in public browser code.

REQUIRED DATABASE MIGRATIONS FOR THIS UPDATE
Apply these files in order, once each, in the existing Supabase project ftwhcqrtmfxdzokmudvu:
0. supabase/migrations/20261113_secure_customer_code_recovery.sql
   Removes the old unsafe username-only password-reset function.
1. supabase/migrations/20261115_customer_contact_emails.sql
   Creates the registered customer email store used for account recovery.
2. supabase/migrations/20261115_fix_customer_email_validation.sql
   Corrects email-address validation so valid addresses can be saved.
3. supabase/migrations/20261115_secure_email_password_recovery.sql
   Adds hashed, one-time six-digit email reset codes, expiry, attempt limits and secure four-digit code reset.
4. supabase/migrations/20261115_disable_wallet_withdrawals.sql
   Revokes all customer and admin RPC access to wallet withdrawal functions. Customers cannot withdraw wallet funds.
5. supabase/migrations/20261115_delivery_custom_gift_message.sql
   Adds the optional personalized message field for gift delivery orders.
6. supabase/migrations/20261115_admin_assisted_password_recovery.sql
   Adds administrator-only four-digit customer code reset after admin-session validation.
7. supabase/migrations/20261115_private_customer_media_messages.sql
   Creates private customer-specific image/video message records.

Do NOT apply supabase/migrations/20261113_wallet_withdrawals.sql. If it was applied previously, migration 4 above disables its withdrawal functions. Do not rerun historical migrations or reset the database.

PASSWORD RECOVERY
Customer login remains username plus four-digit code. Email is NOT used for password recovery; it remains available for administrator announcements and customer History notifications only. The customer recovery screen directs the customer to contact the administrator. In Admin > Customers, use Reset 4-Digit Code only after independently verifying the account owner. The reset RPC requires a valid administrator session, hashes the new four-digit code, and invalidates the customer's existing sessions. The previous email-OTP recovery handler and historical migration may remain in the repository/database but are no longer called by the customer interface.

WALLET
Customers can add funds and view payment history. There is no customer withdrawal feature. Existing balances and wallet transaction history are preserved.

PAYMENTS
Add Funds remains server-initialized through Paystack and supports NGN 100–3,000,000. The UI shows one 15-second preparation state. Do not claim real-money settlement is verified until the live Netlify deployment, Paystack webhook and actual live transaction have been checked.

ADMIN SUPPLIER PURCHASES
The administrator can use the separate Admin Wallet to purchase any active UltraSMS verification service/country/server at the supplier's converted cost, with no customer markup. Ready-made social-media accounts can be purchased from the Rediprofiles catalogue at supplier price, also without customer markup. These purchases use administrator funds, not customer wallet balances. Live supplier purchases still require valid API keys, live supplier stock and sufficient Admin Wallet balance.

ULTRASMS
The official UltraSMS API returns supplier prices as USD cents. The catalogue converts them to naira using ULTRA_SMS_USD_NGN_RATE and applies the agreed 3% markup. The order endpoint rechecks price and stock before purchase. WhatsApp verification numbers are temporary activations, not permanent numbers or monthly rentals. Facebook, TikTok and Zangi remain separate services.

EMAIL
Only the visible support-email branding was changed to All Ads Manager. The Gmail/Nodemailer transport and GMAIL_USER / GMAIL_APP_PASSWORD configuration are unchanged.

SECURITY AND CUSTOMER ACCOUNTS
Customer accounts remain name/username plus a four-digit code. Registered email is for administrator announcements and customer History notifications only. Forgotten-code recovery is administrator-assisted after identity verification; never enable public username-only password changes.


APP INSTALLATION
The website is configured as an installable Progressive Web App (PWA) using display mode standalone. Customers can add it to their phone home screen on supported browsers. This hides the normal browser address bar when launched as an installed web app, but the phone operating system can still switch apps or minimize it. Google Play Store and Apple App Store distribution are not included in this Netlify website package; they require a separate native/TWA wrapper, store developer accounts, store assets, policy compliance and review.

SERVICE LABELS
Customer menu labels include TikTok Dollar Funding and NextPlace Login. The NextPlace customer email field is the address to receive the login after fulfilment. Facebook Phone requests collect business email, Facebook Page/Ad Account ID, whether 2FA is enabled, total amount and payment method. Never request or store Facebook passwords or 2FA codes.

BUILD AND VERIFICATION
The GitHub Actions workflow .github/workflows/verify-package.yml checks JavaScript syntax for Netlify functions and the inline browser application, then packages the complete repository as All-Ads-Manager-Complete.zip. A successful source build does not prove the live Netlify, Supabase, Paystack, Gmail or supplier systems are working; those require deployment and real environment checks.
