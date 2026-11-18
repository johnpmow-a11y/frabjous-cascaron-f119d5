import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261118090200_social_rewards_and_video_unlocks.sql');
const notifications=read('supabase/migrations/20261118090500_social_notification_preferences_and_profile_views.sql');
const feed=read('netlify/functions/social-feed.mjs');
const discover=read('netlify/functions/social-discover.mjs');
const chat=read('netlify/functions/social-chat.mjs');
const index=read('public/index.html');
const ui=read('public/social.js');
const checks=[
 ['video unlock charges exactly one coin',/balance_coins\s*=\s*balance_coins\s*-\s*1/.test(migration)&&/['\"]video_view['\"]\\s*,\\s*-1/.test(migration)],
 ['video unlocks are per customer and post',/primary key\s*\(customer_id,\s*post_id\)/i.test(migration)],
 ['referral code field exists at registration',index.includes('newCustomerReferral')&&index.includes("action:'apply_referral'")],
 ['social dock has exactly four destinations',/\['home'.*\['upload'.*\['chat'.*\['profile'/s.test(ui)],
 ['locked feed responses omit raw storage paths',feed.includes('media_path,thumbnail_path,customer_id,...publicPost')],
 ['creator discovery omits raw media paths',discover.includes('const {media_path,...publicPost}=post')],
 ['chat responses omit raw media paths',chat.includes('const {media_path,...publicMessage}=m')],
 ['notification preferences filter in-app alerts',notifications.includes('before insert on public.aam_social_notifications')&&notifications.includes('profile_update_notifications')],
 ['profile views count unique viewers',/primary key\s*\(profile_key,viewer_id\)/i.test(notifications)],
 ['admin social controls are linked from dashboard',index.includes('adminSocialPanel()')],
 ['coin balance remains a separate social table',/create table if not exists public\.aam_coin_balances/.test(read('supabase/migrations/20261118090000_social_feed_coins_foundation.sql'))]
];
let failed=0;
for(const [name,ok] of checks){console.log((ok?'PASS':'FAIL')+' '+name);if(!ok)failed++;}
if(failed)process.exitCode=1;
