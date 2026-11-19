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
Apply the following in the existing Supabase project ftwhcqrtmfxdzokmudvu, only if not already applied:
0. supabase/migrations/20261113_secure_customer_code_recovery.sql
   Removes the unsafe username-only password-reset function.
1. supabase/migrations/20261115_customer_only_email_password_recovery.sql
   Creates/repairs registered customer email storage and secure six-digit email reset codes; expires codes after 10 minutes; limits attempts; resets the customer's four-digit code; and DROPS the administrator customer-code reset function.
2. supabase/migrations/20261115_disable_wallet_withdrawals.sql
   Revokes wallet withdrawal functions.
3. supabase/migrations/20261115_delivery_custom_gift_message.sql
   Adds the optional personalized gift message.
4. supabase/migrations/20261115_private_customer_media_messages.sql
   Creates private customer-specific image/video message records.

The consolidated customer-only recovery migration replaces the older separate customer-contact-email and secure-email-recovery migrations for this deployment. Do not run both sets unnecessarily. Do not rerun historical migrations or reset the database.

Do NOT apply supabase/migrations/20261113_wallet_withdrawals.sql. If it was applied previously, migration 2 above disables its withdrawal functions. Do not rerun historical migrations or reset the database.

SOCIAL APPLICATION DATABASE MIGRATIONS
The social feed, 18+ confirmation, profiles, follows, coins, paid-video unlocks, chats, notifications and admin social dashboard also require the following migrations, applied in this exact timestamp order after the customer/account foundation above. Apply each only if it has not already been applied; do not skip an earlier dependency:
1. supabase/migrations/20261118090000_social_feed_coins_foundation.sql
2. supabase/migrations/20261118090100_social_customer_init.sql
3. supabase/migrations/20261118090200_social_rewards_and_video_unlocks.sql
4. supabase/migrations/20261118090300_social_interactions_chat_rpc.sql
5. supabase/migrations/20261118090400_social_notification_preferences.sql
6. supabase/migrations/20261118090500_social_notification_preferences_and_profile_views.sql
7. supabase/migrations/20261118100000_community_group_chat.sql
8. supabase/migrations/20261118100100_direct_chat_group_separation.sql
9. supabase/migrations/20261118110000_professional_video_only_coin_unlocks.sql
10. supabase/migrations/20261118120000_remove_age_gate_and_promotion_coins.sql
11. supabase/migrations/20261118130000_admin_selective_video_locking.sql
12. supabase/migrations/20261118150000_one_time_video_earnings_ledger.sql
13. supabase/migrations/20261119130000_separate_social_coin_balances_and_earnings.sql
The last migration restores the explicit 18+ confirmation timestamp/RPC, separates free and purchased viewing coins, and creates the current one-time paid-video unlock and earnings accounting. It must run after the preceding social migrations. The earlier age-gate-removal migration is retained in the ordered history; the final migration restores the current 18+ confirmation mechanism. Do not apply only the final migration to a database missing the earlier social foundation.

PASSWORD RECOVERY
Customer login remains username plus four-digit code. If a customer forgets the code, they enter their username and request a six-digit code sent to the email address saved on that customer's account. The code expires after 10 minutes and is limited to five attempts. The customer enters the emailed code and chooses a new four-digit code. The customer controls this process. The administrator has NO reset button or reset RPC. Existing Gmail sending environment variables GMAIL_USER and GMAIL_APP_PASSWORD are preserved and must be configured for the reset email to send.


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
Customer accounts remain username plus four-digit code. Registered email is used for customer-controlled password recovery by six-digit email code, as well as the existing administrator announcements and customer History notifications. Administrators cannot change customer passwords or four-digit codes. Never enable username-only password changes.

PUSH NOTIFICATIONS
The server-side push flow can notify the administrator about new customer support messages and newly confirmed service payments. Customers can receive notifications for administrator replies, published account notes, service-order status changes, confirmed service payments, successful wallet deposits, delivery status changes, completed editing orders, completed Consignment Box Videos, incoming UltraSMS verification codes/status events, and incoming ShadowOTP email verification codes. The notification subscription is tied to the existing customer/admin login session. This is source-level functionality only until deployed and tested with real device subscriptions. For iPhone, install the website using Add to Home Screen on a supported iOS version and grant notification permission; ordinary Safari tabs do not provide the same installed-web-app push experience. System notification sound follows device notification settings.

APP INSTALLATION
The website is configured as an installable Progressive Web App (PWA) using display mode standalone. Customers can add it to their phone home screen on supported browsers. This hides the normal browser address bar when launched as an installed web app, but the phone operating system can still switch apps or minimize it. Google Play Store and Apple App Store distribution are not included in this Netlify website package; they require a separate native/TWA wrapper, store developer accounts, store assets, policy compliance and review.

SERVICE LABELS
Customer menu labels include TikTok Dollar Funding and NextPlace Login. The NextPlace customer email field is the address to receive the login after fulfilment. Facebook Phone requests collect business email, Facebook Page/Ad Account ID, whether 2FA is enabled, total amount and payment method. Never request or store Facebook passwords or 2FA codes.

BUILD AND VERIFICATION
The GitHub Actions workflow .github/workflows/verify-package.yml checks JavaScript syntax for Netlify functions and the inline browser application, then packages the complete repository as All-Ads-Manager-Complete.zip. A successful source build does not prove the live Netlify, Supabase, Paystack, Gmail or supplier systems are working; those require deployment and real environment checks.
