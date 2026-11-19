import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261119130000_separate_social_coin_balances_and_earnings.sql');
const core=read('netlify/functions/social-core.mjs');
const feed=read('netlify/functions/social-feed.mjs');
const discover=read('netlify/functions/social-discover.mjs');
const admin=read('netlify/functions/social-admin.mjs');
const chat=read('netlify/functions/social-chat.mjs');
const notifications=read('netlify/functions/social-notifications.mjs');
const create=read('netlify/functions/social-coin-create.mjs');
const verify=read('netlify/functions/social-coin-verify.mjs');
const coinCreate=create;
const coinVerify=verify;
const webhook=read('netlify/functions/paystack-webhook.mjs');
const ui=read('public/social.js');
const avatarLab=read('public/avatar-lab.js');
const liveAvatar=read('public/aam-livekit-avatar.js');
const voiceChanger=read('public/aam-livekit-voice.js');
const avatarChargeMigration=read('supabase/migrations/20261119220000_livekit_photo_avatar_coin_charge.sql');
const avatarNotices=read('public/third-party-notices.html');
const avatarLabHtml=read('public/avatar-lab.html');
const index=read('public/index.html');
const support=read('netlify/functions/support.mjs');
const media=read('netlify/functions/customer-media-messages.mjs');
const adminMessage=read('netlify/functions/admin-customer-message.mjs');
const consignment=read('netlify/functions/consignment.mjs');
const editing=read('netlify/functions/media-edit-orders.mjs');
const delivery=read('netlify/functions/delivery-orders.mjs');
const promotionMigration=read('supabase/migrations/20261119160000_manager_promotion_campaigns.sql');
const promotions=read('netlify/functions/social-promotions.mjs');
const promotionAdmin=read('netlify/functions/social-promotion-admin.mjs');
const liveCalls=read('netlify/functions/livekit-calls.mjs');
const liveToken=read('netlify/functions/livekit-token.mjs');
const adminLiveCalls=read('netlify/functions/admin-livekit-calls.mjs');
const adminCallMigration=read('supabase/migrations/20261119190000_admin_livekit_call_identity.sql');
const liveMigration=read('supabase/migrations/20261119100000_livekit_call_tables.sql');
const activeCallMigration=read('supabase/migrations/20261119200000_livekit_one_active_call_per_customer.sql');
const adminActiveCallMigration=read('supabase/migrations/20261119210000_livekit_one_active_call_per_admin.sql');
const callSetupBundle=read('supabase/ALL_ADS_MANAGER_CALLS_SETUP.sql');
const checks=[
 ['coin balances are split into free and purchased',/free_coins bigint/.test(migration)&&/purchased_coins bigint/.test(migration)&&/balance_coins = free_coins \+ purchased_coins/.test(migration)],
 ['new customers receive 30 free coins',migration.includes('values(new.id,30,30,0)')&&migration.includes('30 free starter viewing coins')],
 ['one-time video unlock spends Money Coins before Free Coins',migration.includes('if coalesce(v_paid,0)>0 then')&&migration.indexOf('if coalesce(v_paid,0)>0 then')<migration.indexOf('else',migration.indexOf('if coalesce(v_paid,0)>0 then'))&&migration.includes('purchased_coins=purchased_coins-1')&&migration.includes('free_coins=free_coins-1')],
 ['legacy balances are preserved as free, not treated as cash',/Legacy combined balances are preserved as FREE coins/.test(migration)&&/purchased_coins = 0/.test(migration)],
 ['all existing customers receive a zeroed coin balance row when missing',/insert into public\.aam_coin_balances\(customer_id,balance_coins,free_coins,purchased_coins\)[\s\S]*?select c\.id,0,0,0 from public\.customers c[\s\S]*?on conflict\(customer_id\) do nothing/.test(migration)],
 ['follow rewards are 35 and 60 free coins',/free_coins=public\.aam_coin_balances\.free_coins\+35/.test(migration)&&/free_coins=public\.aam_coin_balances\.free_coins\+60/.test(migration)],
 ['referral reward is 500 free coins',/free_coins=public\.aam_coin_balances\.free_coins\+500/.test(migration)],
 ['Paystack-verified purchases credit purchased coins only',/aam_social_credit_coin_purchase/.test(migration)&&/purchased_coins=purchased_coins\+v_payment\.coin_amount/.test(migration)],
 ['coin credit RPC rejects failed or initialization-failed payment rows',/v_payment\.status<>'pending'/.test(migration)&&/Coin payment is not pending and cannot be credited/.test(migration)],
 ['admin earnings are created only when a purchased coin is spent',/if v_paid_spent=1 then/.test(migration)&&/insert into public\.aam_social_video_earnings/.test(migration)],
 ['only administrator-marked videos are paid; API and customer videos are free',/p\.media_type==='video'&&p\.is_locked===true&&!unlocked\.has\(p\.id\)/.test(feed)&&/is_locked:admin&&type==='video'/.test(feed)&&/coalesce\(v_post\.author_role,'customer'\) <> 'admin' or not coalesce\(v_post\.is_locked,false\) then/.test(migration)],
 ['signup referral is retained until after 18+ confirmation',/setItem\('aamPendingReferral',referral\)/.test(index)&&/getItem\('aamPendingReferral'\);if\(pending\)/.test(ui)&&/action:'apply_referral'/.test(ui)],
 ['social feed, discovery, chat, notifications and coin checkout enforce server-side 18+ confirmation',/if\(!await adultConfirmed\(s\.customer_id\)\)return json\(403/.test(feed)&&/adultConfirmed\(s\.customer_id\)/.test(discover)&&/adultConfirmed\(s\.customer_id\)/.test(chat)&&/adultConfirmed\(s\.customer_id\)/.test(notifications)&&/adultConfirmed\(sessions\[0\]\.customer_id\)/.test(coinCreate)&&/adultConfirmed\(sessions\[0\]\.customer_id\)/.test(coinVerify)&&/action!=='confirm_age'&&!await adultConfirmed/.test(core)],
 ['public creator identity replaces admin-role display names with the app brand',/function publicAdminName\(value\)/.test(feed)&&/function publicAdminName\(value\)/.test(discover)&&/name:p\.author_role==='admin'\?publicAdminName\(admin\.display_name\)/.test(feed)&&/name:publicAdminName\(admin\.display_name\)/.test(discover)&&/display_name:publicAdminName\(admin\.display_name\)/.test(discover)],
 ['customer-facing social posting guidance does not expose admin wording for paid videos',!/administrator videos|admin videos/i.test(ui)],
 ['admin creator profile displays real likes from its loaded posts instead of a fabricated count',/likes:likes\.length/.test(discover)&&/\+formatCount\(d\.likes\|\|0\)\+' likes on recent posts/.test(ui)&&!/3\.5K likes/.test(ui)],
 ['admin coin accounting paginates all sales, earnings and customer balances beyond 1000 rows',/async function dbAll\(path,pageSize=1000\)/.test(admin)&&/Range:`\$\{offset\}-\$\{offset\+pageSize-1\}`/.test(admin)&&/dbAll\('aam_social_coin_payments/.test(admin)&&/dbAll\('aam_social_video_earnings/.test(admin)&&/dbAll\('aam_coin_balances/.test(admin)],
 ['18+ confirmation RPC uses valid paired PostgreSQL dollar quotes',/create or replace function public\.aam_social_confirm_age\(p_token uuid\)[\s\S]*?as \$\$\s+declare v_customer uuid;[\s\S]*?return jsonb_build_object\('confirmed',true\);\s+end;\s+\$\$;/.test(migration)],
 ['18+ screen loads before requesting the protected social feed',/const d=await api\('\/\.netlify\/functions\/social-core'\)/.test(ui)&&/const f=await api\('\/\.netlify\/functions\/social-feed'\)/.test(ui)&&ui.indexOf('if\(!d\.profile\?\.adult_confirmed_at\)')<ui.indexOf("const f=await api('/.netlify/functions/social-feed')")],
 ['customer can explicitly confirm 18+ before social features',/action==='confirm_age'/.test(core)&&/aam_social_confirm_age/.test(core)&&/create or replace function public\.aam_social_confirm_age[\s\S]*?as \$\$[\s\S]*?end;\s*\$\$;/.test(migration)&&/AAMSocial\.confirmAdult/.test(ui)&&/I confirm I am 18 or older/.test(ui)],
 ['follow, referral and paid-video unlock require adult confirmation',/Confirm that you are 18 or older first/.test(migration)&&/Confirm that you are 18 or older to continue/.test(migration)],
 ['only administrator-authored videos can ever be paid',/coalesce\(v_post\.author_role,'customer'\) <> 'admin' or not coalesce\(v_post\.is_locked,false\)/.test(migration)],
 ['feed only marks admin-authored videos as paid',/p\.author_role==='admin'&&p\.media_type==='video'&&p\.is_locked===true/.test(feed)],
 ['paid administrator videos appear as paid cards inside the normal Home feed and unlock in place',/const visible=posts\.filter\(p=>p\.author_role==='admin'/.test(feed)&&/\.map\(postCard\)\.join\(''\)/.test(ui)&&/Paid video/.test(ui)&&!/Paid administrator video|Paid admin video|Administrator video/.test(ui)&&/Watch for 1 coin \(₦1\)/.test(ui)&&/notice\(d\.already_unlocked\?/.test(ui)&&/home\(\);\}catch\(e\)/.test(ui)],
 ['only administrator videos explicitly marked paid are locked',admin.includes("is_locked:mime.startsWith('video/')&&b.is_locked===true")&&/Pictures, API-sourced videos and friends’ uploaded videos are free to view/.test(ui)],
 ['admin and customer profiles respect the paid-video flag',/post\.is_locked===true/.test(discover)&&/media_url:locked\?null/.test(discover)],
 ['customer API returns Free Coins and Money Coins separately',/free_coin_balance/.test(core)&&/money_coin_balance/.test(core)],
 ['coin purchase starts only at ₦500 and requires live Paystack',/amount<500/.test(create)&&/sk_live_/.test(create)&&/transaction\/initialize/.test(create)],
 ['coin verification confirms amount and currency before credit',/transaction\/verify/.test(verify)&&/status!=='success'/.test(verify)&&/p_amount_kobo/.test(verify)],
 ['Paystack webhook handles coin purchases idempotently',/aam_social_coin_payments/.test(webhook)&&/aam_social_credit_coin_purchase/.test(webhook)],
 ['Paystack webhook verifies the returned transaction reference',/String\(tx\?\.reference \|\| ''\) !== String\(reference\)/.test(webhook)],
 ['customer UI offers enabled coin packages from 500',/amounts=\[500,1000,2000/.test(ui)&&/AAMSocial\.buyCoins\(/.test(ui)&&!ui.includes('Coming soon')],
 ['customer UI displays Free Coins and Money Coins separately',/Free coins:/.test(ui)&&/Money Coins:/.test(ui)],
 ['admin UI displays verified coin sales and paid-video earnings',/coin_accounting/.test(admin)&&/video_earnings_naira/.test(ui)],
 ['optional referral code is applied after signup',/newCustomerReferral/.test(index)&&/setItem\('aamPendingReferral',referral\)/.test(index)&&/action:'apply_referral'/.test(ui)],
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
 ['API-sourced and customer-uploaded videos are clearly free',/Pictures, API-sourced videos and friends’ uploaded videos are free to view/.test(ui)&&/Only videos marked as paid cost 1 coin/.test(ui)],
 ['Zangi Ads and TikTok Dollar Funding remain available',/serviceForm\('Zangi Ads'\)/.test(index)&&/serviceForm\('TikTok Dollar Funding'\)/.test(index)],
 ['admin feed never invents engagement counts',!/like_count:p\.author_role==='admin'\?3500/.test(feed)&&/like_count:likes\.filter\(x=>x\.post_id===p\.id\)\.length/.test(feed)],
 ['admin creator profile never invents engagement counts',!/like_count:3500/.test(discover)&&/like_count:likeCounts\.get\(p\.id\)\|\|0/.test(discover)],
 ['support replies are saved to History before best-effort email notification',support.indexOf("const rows=await db('ads_manager_support_messages'")<support.indexOf("await mail(original[0].customer_email,'ALL ADS MANAGER — Support Reply'")&&/Support reply email failed/.test(support)&&/Reply saved to customer History/.test(support)],
 ['Manager Promotion has its own campaign records and review states',/create table if not exists public\.aam_social_promotions/.test(promotionMigration)&&/pending_review/.test(promotionMigration)&&/awaiting_payment/.test(promotionMigration)],
 ['Manager Promotion payments deduct purchased Money Coins only',/select purchased_coins into v_money/.test(promotionMigration)&&/purchased_coins=purchased_coins-v_p\.price_coins/.test(promotionMigration)&&/Free Coins cannot be used for promotion/.test(promotionMigration)],
 ['Manager Promotion submission does not debit coins before approved pricing',/No coins have been deducted/.test(promotionMigration)&&/status<>'awaiting_payment'/.test(promotionMigration)],
 ['Manager Promotion API validates customer sessions and secures image uploads',/customerSession\(token\)/.test(promotions)&&/promotions\/\$\{s\.customer_id\}/.test(promotions)&&/aam_social_promotion_create/.test(promotions)&&/aam_social_promotion_pay/.test(promotions)],
 ['Manager Promotion admin pricing requires an authenticated admin session',/adminSession\(String\(b\.token/.test(promotionAdmin)&&/action==='set_price'/.test(promotionAdmin)&&/status:'awaiting_payment'/.test(promotionAdmin)&&/action==='reject'/.test(promotionAdmin)],
 ['customer profile exposes Manager Promotion and its Money-Coin-only balance',/AAMSocial\.openPromotion\(\)/.test(ui)&&/Promotion Balance/.test(ui)&&/Free Coins are not accepted/.test(ui)],
 ['administrator dashboard exposes promotion review and approval is provider-gated',/AAMSocial\.openAdminPromotions\(\)/.test(ui)&&/provider_status==='ready'/.test(ui)&&/provider_status=eq\.ready/.test(promotionAdmin)],
 ['promotion payment cannot proceed before provider readiness',/v_p\.provider_status<>'ready'/.test(promotionMigration)&&/Free Coins cannot be used for promotion/.test(promotionMigration)],
 ['LiveKit call creation requires two 18+ confirmed customers and an existing direct chat',/adult_confirmed_at/.test(liveCalls)&&/conversation_type=eq\.direct/.test(liveCalls)&&/You can only call someone you have a private chat with/.test(liveCalls)],
 ['LiveKit room tokens are issued only to accepted active call participants',/status=eq\.accepted/.test(liveToken)&&/call\.status=eq\.active/.test(liveToken)&&/LIVEKIT_URL must be a secure WebSocket URL/.test(liveToken)],
 ['LiveKit call records are protected by RLS and service-role-only access',/enable row level security/.test(liveMigration)&&/revoke all on public\.aam_calls from anon, authenticated/.test(liveMigration)&&/grant all on public\.aam_call_participants to service_role/.test(liveMigration)],
 ['customer private chat exposes audio/video call controls and incoming-call polling',/function callPanelHtml\(\)/.test(ui)&&/AAMSocial\.startCall/.test(ui)&&/AAMSocial\.acceptCall/.test(ui)&&/livekit-calls/.test(ui)&&/livekit-token/.test(ui)],
 ['administrator calls use a separate verified admin identity, not a customer impersonation',/caller_id drop not null/.test(adminCallMigration)&&/caller_role text not null default 'customer'/.test(adminCallMigration)&&/admin_session_hash/.test(adminCallMigration)&&/caller_id is null/.test(adminCallMigration)&&/admin_sessions/.test(adminLiveCalls)&&/admin_session_hash/.test(liveToken)],
 ['administrator can start and end audio/video calls from customer management',/AAMSocial\.startAdminCall/.test(index)&&/startAdminCall\(customerId/.test(ui)&&/admin-livekit-calls/.test(ui)&&/action==='end'/.test(adminLiveCalls)]
,
 ['incoming calls are polled globally so administrator calls reach customers outside an open chat',/async function pollCalls\(\)\{if\(!customer\(\)\|\|!token\(\)\|\|document\.hidden\|\|aamCallListInFlight\)return;aamCallListInFlight=true;/.test(ui)&&/aamGlobalCallPollTimer=setInterval\(\(\)=>\{if\(customer\(\)&&token\(\)&&!document\.hidden&&!window\.aamActiveChatId\)pollCalls\(\);\},3000\)/.test(ui)&&/All Ads Manager is calling you/.test(ui)],
 ['administrator call status checks send the session token in a POST body, not a URL',/event\.httpMethod!=='POST'/.test(adminLiveCalls)&&/action==='status'/.test(adminLiveCalls)&&/adminCallAction\('status',aamCurrentCallId\)/.test(ui)&&!ui.includes("admin-livekit-calls?call_id=")],
 ['customer call polling sends the session token in a POST body, not a URL',/event\.httpMethod !== 'POST'/.test(liveCalls)&&/action === 'list'/.test(liveCalls)&&/livekit-calls','POST',\{action:'list'\}/.test(ui)],
 ['unanswered administrator calls expire after 45 seconds and close their invitation',/Date\.now\(\)-new Date\(calls\[0\]\.created_at\)\.getTime\(\)>45000/.test(adminLiveCalls)&&/status:'missed'/.test(adminLiveCalls)&&/status:'ended'/.test(adminLiveCalls)&&/status=in\.\(invited,accepted\)/.test(adminLiveCalls)],
 ['failed administrator LiveKit connections close the server call and clear stale admin call state',/if\(authToken\)\{aamAdminCallMode=false;aamAdminCallToken=null;if\(aamAdminCallPollTimer\)/.test(ui)&&/if\(!aamCurrentCallId\|\|!aamLiveKitRoom\)return/.test(ui)],
 ['database migration enforces one active call per customer and closes stale participant rows',/create unique index if not exists aam_call_participants_one_active_call_per_customer_idx/.test(activeCallMigration)],
 ['missed, declined and ended calls close all remaining active participant rows',/status=in\.\(invited,accepted\)/.test(liveCalls)&&/Close the other participant's active row too/.test(liveCalls)&&/status=in\.\(invited,accepted\)/.test(adminLiveCalls)],
 ['global and chat call polling cannot overlap slow requests',/aamCallListInFlight=false/.test(ui)&&/document\.hidden\|\|aamCallListInFlight\)return;aamCallListInFlight=true/.test(ui)&&/finally\{aamCallListInFlight=false;\}/.test(ui)],
 ['customer call API rejects calls when either person already has an active invitation or call',/existingCall = await db/.test(liveCalls)&&/customer_id=in\.\(\$\{encodeURIComponent\(customerId\)\},\$\{encodeURIComponent\(targetId\)\}\)/.test(liveCalls)&&/This customer is already in another call/.test(liveCalls)],
 ['administrator call API prevents overlapping admin calls and calls to busy customers',/existingAdminCall=await db/.test(adminLiveCalls)&&/existingCustomerCall=await db/.test(adminLiveCalls)],
 ['customer and administrator call buttons block rapid duplicate call creation',/aamCallStarting=false/.test(ui)&&/if\(aamCallStarting\|\|aamCurrentCallId\)return notice\('End the current call before starting another\.'\)/.test(ui)&&/finally\{aamCallStarting=false;\}/.test(ui)],
 ['database active-call uniqueness conflicts return HTTP 409 instead of server errors',/error\.code = data\.code \|\| ''/.test(liveCalls)&&/error\.code === '23505'\) return json\(409/.test(liveCalls)],
 ['unexpected LiveKit disconnect closes the server-side call for both customers and admins',/RoomEvent\.Disconnected,\(\)=>\{if\(aamCurrentCallId===callId\)/.test(ui)&&/if\(authToken\)adminCallAction\('end',callId\)/.test(ui)&&/else callAction\('end',callId\)/.test(ui)&&/async function endCall\(\)\{const id=aamCurrentCallId;aamCurrentCallId=null;/.test(ui)],
 ['administrator calls have a database-enforced one-active-call limit and friendly conflict response',/aam_calls_one_active_call_per_admin_idx/.test(adminActiveCallMigration)&&/error\.code=d\.code\|\|''/.test(adminLiveCalls)&&/e\.code==='23505'\)return json\(409/.test(adminLiveCalls)],
 ['incoming call answers are protected against rapid duplicate taps and overlapping calls',/async function acceptCall\(id,type='audio'\)\{if\(aamCallStarting\|\|aamCallConnecting\|\|aamCurrentCallId\)return notice\('End the current call before answering another\.'\)/.test(ui)&&/finally\{aamCallStarting=false;\}\}/.test(ui)],
 ['one-run Supabase call setup bundles all five migrations in dependency order',callSetupBundle.indexOf('create table if not exists public.aam_calls')<callSetupBundle.indexOf('caller_identity_check')&&callSetupBundle.includes('aam_call_participants_one_active_call_per_customer_idx')&&callSetupBundle.includes('aam_calls_one_active_call_per_admin_idx')&&callSetupBundle.includes('aam_social_charge_call_avatar')&&callSetupBundle.includes('call_avatar_purchase')&&callSetupBundle.includes('Apply the All Ads Manager social coin-balance migrations before running this calling setup.')&&(callSetupBundle.match(/\bbegin;/gi)||[]).length===1&&(callSetupBundle.match(/\bcommit;/gi)||[]).length===1],
 ['Wireface avatar lab creates a local photo face and applies it to a full-body character',avatarLab.includes('createCharacter(file')&&avatarLab.includes('figure.face.useCharacter(character')&&avatarLab.includes('buildCharacter(bodyStyle')&&avatarLab.includes('vision_bundle.mjs')&&avatarLab.includes('face_landmarker.task')],
 ['Wireface avatar lab uses live microphone audio for lip sync and voice-reactive body gestures',avatarLab.includes('figure.face.listenTo(audioContext, micStream)')&&avatarLab.includes('figure?.update(dt, elapsed)')&&avatarLabHtml.includes('does not yet mirror your real-world body or hand poses')],
 ['Wireface avatar lab saves and reloads multiple photo characters locally',avatarLab.includes('indexedDB.open(DB_NAME, 1)')&&avatarLab.includes('exportCharacter(character)')&&avatarLab.includes('loadCharacter(row.character)')&&avatarLabHtml.includes('Saved avatars on this device')],
 ['LiveKit video calls can select and switch among locally saved photo avatars without another avatar charge',ui.includes('aamCallSavedAvatar')&&ui.includes('listCallSavedAvatars')&&ui.includes('useSavedCallAvatar')&&liveAvatar.includes('savedCharacter ? await loadCharacter(savedCharacter)')&&liveAvatar.includes('async setSavedCharacter(data)')&&/aamCallAvatarController\.setSavedCharacter\(savedAvatar\.character\)/.test(ui)],
 ['saved avatar controls are hidden and reset when the LiveKit call ends or disconnects',/savedAvatarSelect\.style\.display='none';savedAvatarSelect\.value='';/.test(ui)&&ui.includes("const savedAvatarSelect=document.getElementById('aamCallSavedAvatar')")],
 ['customer photo avatars require 1,500 purchased Money Coins and never spend Free Coins',avatarChargeMigration.includes('purchased_coins')&&avatarChargeMigration.includes('< 1500')&&avatarChargeMigration.includes('purchased_coins = purchased_coins - 1500')&&avatarChargeMigration.includes('call_avatar_purchase')&&avatarChargeMigration.includes('unique(call_id, customer_id)')],
 ['photo avatar charges are limited to an accepted participant in an active video call',/c\.status = 'active'/.test(avatarChargeMigration)&&/c\.call_type = 'video'/.test(avatarChargeMigration)&&/p\.status = 'accepted'/.test(avatarChargeMigration)&&/p\.customer_id = v_customer/.test(avatarChargeMigration)],
 ['customer avatar coins are charged only after the avatar publishes successfully, and a failed payment tears down the uncharged avatar',/await controller\.publish\(\);if\(!aamAdminCallMode&&aamCallAvatarPaidCallId!==aamCurrentCallId\)\{const payment=await callAction\('avatar_payment'/.test(ui)&&/if\(controller\)await controller\.stop\(\{restoreCamera:true\}\)/.test(ui)],
 ['LiveKit avatar payment endpoint requires an authenticated customer session',/action === 'avatar_payment'/.test(liveCalls)&&/rpc\/aam_social_charge_call_avatar/.test(liveCalls)&&/currentCustomer\(String\(body\.token/.test(liveCalls)],
 ['LiveKit calls offer original, female-style, male-style, echo and robot voice processing',voiceChanger.includes("female: { pitch: 4")&&voiceChanger.includes("male: { pitch: -3")&&voiceChanger.includes('SoundTouchNode')&&ui.includes('ensureCallVoiceControls()')&&ui.includes('aamCallVoiceStyle')],
 ['voice effects restore the original microphone when disabled and stop on call end',voiceChanger.includes('unpublishTrack(outputTrack)')&&voiceChanger.includes('publishTrack(originalTrack')&&ui.includes('aamCallVoiceController.stop({restoreMic:false})')&&/voiceStyle\.value='natural';voiceStyle\.style\.display='none'/.test(ui)],
 ['voice effects preserve microphone mute and unmute state without replacing the active processed track',voiceChanger.includes('setMuted(nextMuted)')&&voiceChanger.includes('get isMuted()')&&voiceChanger.includes('originalTrack.mediaStreamTrack.enabled = !muted')&&ui.includes('aamCallVoiceController.setMuted(muted)')&&voiceChanger.includes('isMicrophoneEnabled')],
 ['LiveKit photo avatars use the Wireface 3D body kit and voice-driven mouth and gesture animation',liveAvatar.includes("buildCharacter(style === 'walter'")&&liveAvatar.includes('next.face.useCharacter(currentPhotoCharacter')&&liveAvatar.includes('figure.face.listenTo(audioContext, micStream)')&&liveAvatar.includes('figure?.update(dt, elapsed)')&&liveAvatar.includes('publishTrack(videoTrack')],
 ['photo avatars use on-device pose and hand landmarks to animate torso, arms, legs, knees and fingers',liveAvatar.includes('PoseLandmarker')&&liveAvatar.includes('HandLandmarker')&&liveAvatar.includes('detectForVideo')&&liveAvatar.includes('addLegRigs')&&liveAvatar.includes('kneeFlex')&&liveAvatar.includes('addFingerRigs')],
 ['body tracking is optional with explicit camera consent and the raw camera track is unpublished while the avatar is sent',/window\.confirm\('Use your camera locally/.test(ui)&&liveAvatar.includes('unpublishTrack(cameraLocalTrack, !trackBody)')&&liveAvatar.includes('bodyTrackingEnabled')],
 ['avatar camera rollback marks the original track restored after the fallback camera is enabled',liveAvatar.includes("setCameraEnabled(true).catch(() => {}); cameraUnpublished = false;")],
 ['avatar shutdown does not stop the live microphone track used by the ongoing call',!liveAvatar.includes('micStream?.getTracks().forEach(track => track.stop())')&&liveAvatar.includes('Never stop its underlying track here')],
 ['customer photo avatar is charged once per call, administrator avatar is free, and photos can be switched',/!aamAdminCallMode&&aamCallAvatarPaidCallId!==aamCurrentCallId/.test(ui)&&/aamCallAvatarController\.setPhoto\(file\)/.test(ui)&&/Add photo avatar · Free/.test(ui)&&/aamCallAvatarPaidCallId=null/.test(ui)],
 ['avatar callers can choose a male or female 3D body for their uploaded photograph',/option value="sarah">Female avatar/.test(ui)&&/option value="walter">Male avatar/.test(ui)&&/async setBodyStyle\(style\)/.test(liveAvatar)&&/buildFigure\(nextStyle/.test(liveAvatar)],
 ['avatar runtime is pinned to the no-charge commercial-use Wireface release with third-party notices',liveAvatar.includes('8bb0b00649eb65013e7785859c4b9b59169e1178')&&avatarNotices.includes('Wireface SDK Licence 1.0')&&avatarNotices.includes('Apache License')&&avatarNotices.includes('Three.js MIT License')]];
let failed=0;
for(const [name,ok] of checks){console.log((ok?'PASS ':'FAIL ')+name);if(!ok)failed++;}
if(failed)process.exitCode=1;
