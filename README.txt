BUSINESS TOOLS — FULL AUDIT BUILD

WHAT WAS CHECKED
- Customer registration remains name + four-digit code.
- Admin login remains the existing admin password.
- Existing Supabase project URL and publishable key are retained.
- Existing email function, package.json, and netlify.toml are preserved byte-for-byte from the prior email-ready package.
- Customer requests are stored in Admin History; Customer History contains administrator messages only.
- Customer can delete their own administrator messages. Admin can delete individual records, a customer's history, or a customer account.
- Admin can open a separate private message box for each customer.
- Admin can publish/clear bank information; customer requests wait 15 seconds before showing published information or unavailable status.
- After the second unsuccessful bank-information attempt, the existing support email is sent using the preserved Netlify function, then the site waits another 15 seconds and checks bank information again.
- Customer service form no longer shows the wording “Add Funds / Submit Request”; Facebook Page uses “Create Page” and other service forms use “Submit Request”.
- Existing service prices, gift-card totals, and ADS card visual were preserved. The ADS PIN remains fictional-only and is never stored or transmitted. The FB area remains a test-profile form and does not collect passwords or 2FA codes; real passwords, 2FA codes, or bank PINs are not collected.
- Admin dashboard includes per-customer website lock/unlock and subscription-request controls after the included SQL migration is applied.

SUBSCRIPTION PLANS
- 1 week: NGN 3,800
- 2 weeks: NGN 7,600
- 3 weeks: NGN 11,400
- 4 weeks: NGN 15,200
A locked customer can select a plan and confirm. After 15 seconds, the site displays the admin-published bank information or “Bank Not Available”. The request appears in Admin Dashboard. The admin must verify payment and unlock that specific customer. Unlocking lasts for the selected number of weeks.

IMPORTANT: DATABASE STEP REQUIRED
The lock/subscription feature needs the SQL migration in:
supabase/migrations/20261106_align_subscription_rpc_responses.sql
The lock tables and base RPCs have already been installed in this project during this chat. Before deploying this recovered website build, run supabase/migrations/20261106_align_subscription_rpc_responses.sql once in the SAME Supabase project. It aligns the subscription request and admin access RPC response shapes with this website. Do not rerun the earlier base migration.

EMAIL PRESERVATION
The Netlify function file netlify/functions/send-email.mjs is byte-for-byte identical to the previous email-ready package. package.json and netlify.toml are also preserved. Keep the existing Netlify environment variables GMAIL_USER and GMAIL_APP_PASSWORD unchanged. Deploy the COMPLETE project folder, not only public/index.html, so Netlify publishes the existing email function.

DEPLOY
Deploy the complete folder contents: public/index.html, package.json, netlify.toml, netlify/functions/send-email.mjs. Keep the supabase folder with the migration for reference. Use the existing Netlify site and retain its existing environment variables.

VERIFICATION LIMITS
- JavaScript syntax and package structure are checked locally.
- The intended Supabase project is not authorized to the connected Supabase tool, so the migration was not applied remotely. Apply the included SQL once in the existing project before deploying this build.
- Live email delivery and two-device behavior cannot be verified from this workspace because private Netlify settings and the live site are not accessible here. The email implementation itself was preserved byte-for-byte.


RECOVERED WEBSITE BUILD
This package was recovered from the BUSINESS TOOLS files already uploaded in the earlier conversation. The customer login now calls the existing login_customer RPC and handles its locked response token. Subscription prices match the agreed NGN 3,800 / 7,600 / 11,400 / 15,200 plans. The periodic customer-session check also recognizes SUBSCRIPTION_REQUIRED.

PAYSTACK WALLET DEPOSITS — NEW, NOT YET LIVE
- Customer dashboard includes Add Funds and Payment History.
- Customer can choose Bank Transfer or ATM / Card Payment and enter an amount from ₦2,100 to ₦100,000.
- The checkout is initialized server-side and redirects to Paystack-hosted checkout. Card details are entered at Paystack, never on ADS Manager.
- Paystack webhook verifies its HMAC signature and re-verifies the transaction with Paystack before crediting the wallet.
- Wallet credits are idempotent by unique payment reference. The customer sees their own balance/history; admin sees customer wallet balances only.
- No card PAN, CVV, ATM PIN, OTP or 2FA value is stored by ADS Manager.

REQUIRED BEFORE TESTING PAYMENTS
1. Run supabase/migrations/20261106_paystack_wallet.sql in the existing Supabase project ftwhcqrtmfxdzokmudvu. Do not run it in a different project.
2. In Netlify Site configuration > Environment variables, set PAYSTACK_SECRET_KEY to the Paystack TEST secret key, SUPABASE_URL to https://ftwhcqrtmfxdzokmudvu.supabase.co, and SUPABASE_SERVICE_ROLE_KEY to the service-role key for that SAME Supabase project. Keep the service-role key private; never put it in public/index.html.
3. In Paystack test dashboard, set the webhook URL to https://YOUR-NETLIFY-SITE/.netlify/functions/paystack-webhook and enable charge.success. Use test mode while testing.
4. Deploy the complete project folder. Test both methods with Paystack test credentials. Real customer payments require live-mode approval and live credentials.

IMPORTANT: This workspace cannot configure your Netlify account, add private environment variables, apply SQL to the remote Supabase project, or verify real payment settlement. Do not treat the payment integration as live until those steps and end-to-end tests are completed. The existing send-email.mjs, package.json and netlify.toml have been preserved unchanged.

LOCKED-ACCOUNT LOGIN ALIGNMENT
------------------------------
This package includes:
  supabase/migrations/20261106_lock_login_alignment.sql

Run this migration in the existing Supabase SQL Editor AFTER the original
business_tools_customer_lock_subscriptions.sql migration and the existing
subscription response alignment migration. It aligns the website's login call
with bt_customer_login and uses the restricted subscription_token for locked
customers. It also saves the subscription amount using the existing plan prices.

PAYMENT LIMITS
--------------
Customer Add Funds accepts NGN 100 through NGN 3,000,000. The browser and
Paystack server function both validate this range. The wallet SQL stores the
corresponding amounts in kobo.

TEST STATUS
-----------
JavaScript syntax checks passed for the inline website script and the three
Paystack Netlify functions. ZIP integrity check passed. The existing
netlify/functions/send-email.mjs file was preserved unchanged.
Live Paystack settlement, webhook delivery, live Supabase RPC execution,
service fulfilment, and end-to-end customer/admin testing have NOT been
verified from this package build. Do not treat sample/preview service forms as
live fulfilled services or charge customers for a service until its fulfilment
and server-side wallet order debit are implemented and tested.

ULTRA SMS LIVE CATALOGUE — NEW CONNECTION
-----------------------------------------
The latest package now includes a server-side Netlify function:
  netlify/functions/ultra-sms-catalog.mjs

It uses the private Netlify environment variable ULTRA_SMS_API_KEY and calls
Ultra SMS from the server only. The API key is never sent to the browser.
The customer dashboard now includes “Virtual Verification Numbers”. It loads:
- The supplier's current service list (for example WhatsApp, Telegram, Google,
  if those services are returned for this account).
- The supplier's current supported countries.
- Current prices and available stock by server for the selected service/country.
- The Ultra SMS account balance.

After adding ULTRA_SMS_API_KEY in Netlify, redeploy the complete package so the
new function is published. The catalogue is read-only in this build: it does
NOT yet place customer orders, debit the ADS Manager wallet, or deliver OTPs.
Do not collect payment for a verification number until the order flow, customer
wallet debit, refund handling, and order ownership have been implemented and
tested. Ultra SMS numbers are temporary activations (normally up to 20 minutes),
not permanent number purchases or monthly rentals. A phone number is assigned
only after an order succeeds; the catalogue shows live stock counts, not a list
of individual phone numbers in advance.

Ultra SMS service names are verification services, not account sales. If the
provider returns a Google service, that is a Google verification SMS option;
it does not provide Gmail accounts or Gmail inboxes.

Official API docs: https://ultrasmsin.com/reseller/docs
