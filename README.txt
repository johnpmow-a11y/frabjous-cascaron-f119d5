ALL ADS MANAGER — PROJECT NOTES

This file is a short project overview. For deployment steps, migration order, and environment-variable guidance, follow DEPLOYMENT_README.txt. If older notes conflict with that file, DEPLOYMENT_README.txt is authoritative.

BRAND AND CUSTOMER ACCOUNTS
- Product name: All Ads Manager. Customer-facing service labels use ADS, not “demo”.
- Customer login remains username/name plus a four-digit code. Email is not the login credential; a registered email address is used for customer-controlled code recovery and account communications.
- The existing Supabase customer/admin session model is retained. Do not replace it with Supabase Auth or change the working login flow.
- Existing customer history, administrator messages, support inbox, gift delivery, consignment jobs, ready-made account orders, and service modules are retained.
- The legacy browser storage key businessTools_demo_v1 is intentionally retained internally to protect existing browser-side data. It is not a customer-facing brand.

WALLET AND PAYMENTS
- Add Funds accepts NGN 100 through NGN 3,000,000.
- Add Funds displays one 15-second preparation state before calling the server-side Paystack initializer.
- Card details are entered only on Paystack. Do not collect or store card numbers, CVV, PIN, OTP, or 2FA codes in this application.
- Paystack webhook and wallet-credit logic remain server-side. Keep the existing live Paystack and Netlify settings.
- Customer wallet withdrawals are disabled. Do not apply the historical 20261113_wallet_withdrawals.sql migration.
- Do not describe live settlement as verified unless it has been tested against the live Paystack dashboard and deployed Netlify site.

CUSTOMER SECURITY
- Username-only code reset is disabled because a username alone does not prove account ownership.
- Customers recover their four-digit code through the registered email address using a time-limited six-digit code, as described in DEPLOYMENT_README.txt.
- The administrator cannot reset customer codes through an admin reset control or RPC. Do not restore username-only code changes.

ULTRASMS AND OTHER SERVICES
- The UltraSMS API key stays server-side in Netlify as ULTRA_SMS_API_KEY.
- The current UltraSMS catalogue returns supplier prices as USD cents. The catalogue converts them to NGN using ULTRA_SMS_USD_NGN_RATE and applies the agreed 3% markup.
- UltraSMS numbers are temporary verification activations, not permanent numbers or monthly rentals.
- Facebook, TikTok and Zangi remain separate branded services and are not replaced by the UltraSMS catalogue.

EMAIL
- The existing Gmail/Nodemailer transport and GMAIL_USER / GMAIL_APP_PASSWORD environment variable names are unchanged.
- Only visible sender name, subject and message branding may be updated. Do not replace the working email configuration.

READY-MADE ACCOUNTS
- The ready-made account catalogue and order flow use the configured supplier integration.
- Actual profile photos and account metadata can only be displayed when supplied by the provider. Do not claim an item is in stock unless the current supplier catalogue confirms it.

DEPLOYMENT AND VERIFICATION
- Deploy the complete project root, including public/, netlify/functions/, package.json, netlify.toml, and supabase/ files. Do not upload only public/ because server functions are required.
- Keep existing Netlify environment variables and secrets. Never put service-role keys, Paystack secret keys, Gmail app passwords, or supplier API keys in browser code.
- Repository source changes do not automatically apply SQL to Supabase or deploy to Netlify. Apply only migrations identified as required in DEPLOYMENT_README.txt, and only if not already applied.
- GitHub Actions checks JavaScript syntax and packages the project. A successful source build does not prove the live Netlify, Supabase, Paystack, Gmail, push-notification or supplier systems work; those require deployment and live checks.


2026-11-20 mobile and social application update
- New Supabase migrations are included in supabase/migrations. Apply the new 20261120101500, 20261120103000 and 20261120104000 migrations in timestamp order before deploying this version.
- Cloudflare Stream video uploads require CLOUDFLARE_API_TOKEN. CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_STREAM_CUSTOMER_CODE may be set when supplied by the Cloudflare account.
- Audius sound search accepts AUDIUS_API_KEY or AUDIUS_BEARER_TOKEN. Keep these values in Netlify environment variables; never place secret values in browser code.
- Customer and administrator video posts use Cloudflare Stream. Customer and administrator sound search uses the Audius sound API.
- Customer Manager Promotions are now in-app feed placements. An administrator reviews the advert and sets its Money Coin price; after payment, the promoted post appears in the All Ads Manager feed for the requested duration. This does not require an external advertising provider.
- Facebook and TikTok campaigns outside All Ads Manager still require the advertiser's own platform authorization and approved API access.
- The mobile app uses the standalone PWA shell. iOS web-push notifications use the iPhone's notification sound; custom sounds can be played while the app is open.
