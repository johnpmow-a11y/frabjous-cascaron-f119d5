ALL ADS MANAGER — PROJECT NOTES

Brand and customer experience
- Product name: All Ads Manager. Customer-facing service labels use ADS, not “demo”.
- Customer accounts remain username/name plus a four-digit code. Customer accounts do not require an email address.
- The existing Supabase customer/admin session model is retained; customer sessions expire according to the existing database policy.
- Existing customer history, administrator messages, support inbox, gift delivery, consignment jobs, Rediprofiles account orders, and service modules are retained.
- The legacy browser storage key businessTools_demo_v1 is intentionally retained internally so existing browser-side data is not lost. It is not a customer-facing label.

Wallet and Paystack
- Add Funds accepts NGN 100 through NGN 3,000,000.
- Add Funds displays one 15-second preparation state before calling the existing server-side Paystack initializer.
- Card details are entered only on Paystack. Do not collect or store card numbers, CVV, PIN, OTP, or 2FA codes in this application.
- The Paystack webhook and wallet-credit logic remain server-side. Do not replace existing Paystack keys or webhook settings during these UI changes.
- Do not describe live settlement as verified unless it has been tested against the live Paystack dashboard and the deployed Netlify site.

Withdrawals
- Customers can submit a withdrawal request with an amount and bank details.
- The amount is reserved from the customer's wallet when the request is accepted.
- An administrator must manually send the bank transfer and then mark the request Paid. This application does not initiate automatic bank transfers.
- If the administrator rejects a pending request, the reserved amount is automatically refunded to the customer's wallet.
- Apply supabase/migrations/20261113_wallet_withdrawals.sql once in the existing Supabase project before using withdrawals.

Customer security
- The username-only password/code reset function has been removed because a username alone does not prove account ownership.
- Apply supabase/migrations/20261113_secure_customer_code_recovery.sql once in the existing Supabase project. Customers needing a forgotten four-digit code must contact the administrator for identity verification and reset assistance.
- Do not restore a public username-only code reset.

UltraSMS WhatsApp verification
- The API key stays server-side in Netlify as ULTRA_SMS_API_KEY.
- The current official API catalogue returns supplier prices as USD cents (price_cents) and stock counts. The catalogue converts these to NGN using ULTRA_SMS_USD_NGN_RATE and applies the agreed 3% markup.
- Set ULTRA_SMS_USD_NGN_RATE to the current NGN-per-USD conversion rate in Netlify. If it is missing or invalid, customer purchase buttons remain disabled.
- The order endpoint rechecks the supplier price and stock before reserving wallet funds. Supplier price changes require refreshing the catalogue.
- UltraSMS numbers are temporary verification activations, not permanent numbers or monthly rentals. Use them only for accounts the customer is authorized to verify.
- Facebook, TikTok and Zangi remain separate branded services and are not replaced by the UltraSMS catalogue.

Email
- The existing Gmail/Nodemailer transport, support inbox, and GMAIL_USER / GMAIL_APP_PASSWORD environment variable names are unchanged.
- Only the visible sender name, subject and message branding were changed to All Ads Manager. Do not replace the working email configuration.

Netflix and ready-made accounts
- Netflix Login remains the existing manually priced service. It is not automatically connected to Rediprofiles Netflix stock.
- Ready-made account catalogue and order flow remain connected to Rediprofiles. Actual profile photos and account metadata can only be shown when supplied by the provider.
- Do not claim an item is in stock unless the current supplier catalogue confirms it.

Deployment
- Deploy the complete project folder to the existing Netlify site, including public/, netlify/functions/, package.json, netlify.toml, and supabase/migrations/.
- Keep the existing Netlify environment variables and secrets. Never put Supabase service-role keys, Paystack secret keys, Gmail app passwords or UltraSMS API keys in public browser code.
- Required server settings used by the current integrations include the existing Supabase URL/service-role key, Paystack secret, Gmail settings, ULTRA_SMS_API_KEY, and ULTRA_SMS_USD_NGN_RATE. Preserve any additional variables already configured for other services.
- After adding or changing Netlify environment variables, redeploy the site.

Verification limits
- Repository source changes do not automatically apply SQL to Supabase or deploy to Netlify.
- Apply the two new SQL migrations above in the existing Supabase project ftwhcqrtmfxdzokmudvu before using withdrawal and code-recovery changes.
- The live Netlify deployment, live Paystack settlement, Gmail delivery, supplier stock, and cross-device customer behavior must be checked on the actual deployed services. A local/source review is not proof of live operation.
