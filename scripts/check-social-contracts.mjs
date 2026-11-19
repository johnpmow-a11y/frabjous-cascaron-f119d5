import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261119130000_separate_social_coin_balances_and_earnings.sql');
const core=read('netlify/functions/social-core.mjs');
const feed=read('netlify/functions/social-feed.mjs');
const discover=read('netlify/functions/social-discover.mjs');
const admin=read('netlify/functions/social-admin.mjs');
const create=read('netlify/functions/social-coin-create.mjs');
const verify=read('netlify/functions/social-coin-verify.mjs');
const webhook=read('netlify/functions/paystack-webhook.mjs');
const ui=read('public/social.js');
const index=read('public/index.html');
const support=read('netlify/functions/support.mjs');
const media=read('netlify/functions/customer-media-messages.mjs');
const adminMessage=read('netlify/functions/admin-customer-message.mjs');
const consignment=read('netlify/functions/consignment.mjs');
const editing=read('netlify/functions/media-edit-orders.mjs');
const delivery=read('netlify/functions/delivery-orders.mjs');
const checks=[
 ['coin balances are split into free and purchased',/free_coins bigint/.test(migration)&&/purchased_coins bigint/.test(migration)&&/balance_coins = free_coins \+ purchased_coins/.test(migration)],
 ['new customers receive 10 free coins',/values\(new\.id,10,10,0\)/.test(migration)&&/10 free starter viewing coins/.test(migration)],
 ['legacy balances are preserved as free, not treated as cash',/Legacy combined balances are preserved as FREE coins/.test(migration)&&/purchased_coins = 0/.test(migration)],
 ['follow rewards are 35 and 60 free coins',/free_coins=public\.aam_coin_balances\.free_coins\+35/.test(migration)&&/free_coins=public\.aam_coin_balances\.free_coins\+60/.test(migration)],
 ['referral reward is 500 free coins',/free_coins=public\.aam_coin_balances\.free_coins\+500/.test(migration)],
 ['Paystack-verified purchases credit purchased coins only',/aam_social_credit_coin_purchase/.test(migration)&&/purchased_coins=purchased_coins\+v_payment\.coin_amount/.test(migration)],
 ['one-time video unlock spends free coins before purchased coins',/if coalesce\(v_free,0\)>0 then/.test(migration)&&/purchased_coins=purchased_coins-1/.test(migration)],
 ['admin earnings are created only when a purchased coin is spent',/if v_paid_spent=1 then/.test(migration)&&/insert into public\.aam_social_video_earnings/.test(migration)],
 ['only administrator-marked videos are paid; API and customer videos are free',/p\.media_type==='video'&&p\.is_locked===true&&!unlocked\.has\(p\.id\)/.test(feed)&&/is_locked:admin&&type==='video'/.test(feed)&&/if not coalesce\(v_post\.is_locked,false\) then/.test(migration)],
 ['only administrator videos explicitly marked paid are locked',admin.includes("is_locked:mime.startsWith('video/')&&b.is_locked===true")&&/API-sourced videos and customer-uploaded videos are free/.test(ui)],
 ['admin and customer profiles respect the paid-video flag',/post\.is_locked===true/.test(discover)&&/media_url:locked\?null/.test(discover)],
 ['customer API returns both balances separately',/free_coin_balance/.test(core)&&/purchased_coin_balance/.test(core)],
 ['coin purchase starts only at ₦500 and requires live Paystack',/amount<500/.test(create)&&/sk_live_/.test(create)&&/transaction\/initialize/.test(create)],
 ['coin verification confirms amount and currency before credit',/transaction\/verify/.test(verify)&&/status!=='success'/.test(verify)&&/p_amount_kobo/.test(verify)],
 ['Paystack webhook handles coin purchases idempotently',/aam_social_coin_payments/.test(webhook)&&/aam_social_credit_coin_purchase/.test(webhook)],
 ['customer UI offers enabled coin packages from 500',/amounts=\[500,1000,2000/.test(ui)&&/AAMSocial\.buyCoins\(/.test(ui)&&!ui.includes('Coming soon')],
 ['customer UI displays free and purchased balances',/Free coins:/.test(ui)&&/Purchased coins:/.test(ui)],
 ['admin UI displays verified coin sales and paid-video earnings',/coin_accounting/.test(admin)&&/video_earnings_naira/.test(ui)],
 ['optional referral code is applied after signup',/newCustomerReferral/.test(index)&&/action:'apply_referral'/.test(index)],
 ['customer signup requires and saves an email address',/id="newCustomerEmail"/.test(index)&&/bt_customer_set_email/.test(index)&&/bt_customer_email_get/.test(index)],
 ['customer history is redesigned and shows the saved account email',/YOUR ACCOUNT ACTIVITY/.test(index)&&/esc\(c\.email\|\|"Email not available"\)/.test(index)&&/aam-history-item/.test(index)],
 ['customer History shows sender names without admin or customer role labels',/sender_name/.test(index)&&!/Customer History|Support team message|Your support request|Account update\\b|administrator confirmation/i.test(index.slice(index.indexOf('async function historyPage(){'),index.indexOf('async function requestNetflixCode',index.indexOf('async function historyPage(){'))))],
 ['social discovery uses friend language for people',/Find friends/.test(ui)&&/No friends found/.test(ui)&&/View friend/.test(ui)],
 ['customer support and History avoid admin/customer role labels',/send it to our support team/.test(index)&&/Your code request was sent\./.test(index)&&/Awaiting verification/.test(index)&&/sender_name/.test(index)&&!/send it to the administrator|Awaiting administrator verification|Customer History|Support team message/.test(index.slice(index.indexOf('function supportPage(){'),index.indexOf('function adminSupportInbox(){'))+index.slice(index.indexOf('async function historyPage(){'),index.indexOf('async function requestNetflixCode',index.indexOf('async function historyPage(){'))))],
 ['social customer screens identify people as friends',/Find friends/.test(ui)&&/No friends found/.test(ui)&&/View friend/.test(ui)&&!/another creator|creator profile/i.test(ui)],
 ['message APIs provide display names instead of role labels',/sender_name:m.sender_role==='admin'\?'All Ads Manager':myName/.test(support)&&/sender_name:'All Ads Manager'/.test(media)],
 ['private text messages email the saved customer address using existing Gmail settings',/emailCustomer\(customerId,message\)/.test(read('netlify/functions/admin-customer-message.mjs'))&&/GMAIL_USER/.test(read('netlify/functions/admin-customer-message.mjs'))&&/customer_contact_emails/.test(read('netlify/functions/admin-customer-message.mjs'))],
 ['order status updates attempt customer email without changing email configuration',/Order-status email failed/.test(support)&&/customer_contact_emails/.test(support)&&/GMAIL_USER/.test(support)],
 ['social coins remain separate from tools wallet',/Your tools wallet is separate/.test(ui)],
 ['private messages email the saved customer address',/emailCustomer\(customerId,message\)/.test(adminMessage)&&/customer_contact_emails/.test(adminMessage)&&/GMAIL_APP_PASSWORD/.test(adminMessage)],
 ['consignment video completion emails the customer',/emailCustomer\(row.customer_id/.test(consignment)&&/GMAIL_APP_PASSWORD/.test(consignment)],
 ['media editing status emails the customer',/Editing-order status email failed/.test(editing)&&/customer_contact_emails/.test(editing)],
 ['delivery status emails the customer',/Delivery-status email failed/.test(delivery)&&/customer_contact_emails/.test(delivery)],
 ['Facebook and TikTok open provider-gated campaign workspaces instead of old fixed-price forms',/adCampaignWorkspace\('facebook'\)/.test(index)&&/adCampaignWorkspace\('tiktok'\)/.test(index)&&/Partner connection pending/.test(index)&&/CAMPAIGN CREATION NOT AVAILABLE YET/.test(index)],
 ['Snapchat has a separate clearly unconnected campaign workspace',/adCampaignWorkspace\('snapchat'\)/.test(index)&&/Provider connection not confirmed/.test(index)],
 ['admin paid-video checkbox is connected to the upload request',ui.includes('id="aamAdminLockVideo" type="checkbox"')&&ui.includes("is_locked:file.type.startsWith('video/')&&!!document.getElementById('aamAdminLockVideo')?.checked")],
 ['API-sourced and customer-uploaded videos are clearly free',/API-sourced videos, customer-uploaded videos and all pictures are always free/.test(ui)&&/Only administrator videos specifically marked as paid cost 1 coin/.test(ui)]
 ['Zangi Ads and TikTok Dollar Funding remain available',/serviceForm\('Zangi Ads'\)/.test(index)&&/serviceForm\('TikTok Dollar Funding'\)/.test(index)]
];
let failed=0;
for(const [name,ok] of checks){console.log((ok?'PASS ':'FAIL ')+name);if(!ok)failed++;}
if(failed)process.exitCode=1;
