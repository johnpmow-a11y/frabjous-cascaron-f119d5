import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261118090200_social_rewards_and_video_unlocks.sql');
const professionalVideo=read('supabase/migrations/20261118110000_professional_video_only_coin_unlocks.sql');
const notifications=read('supabase/migrations/20261118090500_social_notification_preferences_and_profile_views.sql');
const feed=read('netlify/functions/social-feed.mjs');
const discover=read('netlify/functions/social-discover.mjs');
const chat=read('netlify/functions/social-chat.mjs');
const index=read('public/index.html');
const ui=read('public/social.js');
const checks=[
 ['video unlock charges exactly one coin',/balance_coins\s*=\s*balance_coins\s*-\s*1/.test(migration)&&/['\"]video_view['\"]\s*,\s*-1/.test(migration)],
 ['video unlocks are per customer and post',/primary key\s*\(customer_id,\s*post_id\)/i.test(migration)],
 ['only admin Professional Videos require a coin',professionalVideo.includes("if v_post.author_role <> 'admin'")&&feed.includes("p.author_role==='admin'")],
 ['customer videos are always playable without an unlock',feed.includes("p.author_role!=='admin'||unlocked.has(p.id)")],
 ['Professional Video debit is atomic and costs one coin',professionalVideo.includes('balance_coins=balance_coins-1')&&professionalVideo.includes('balance_coins>=1')&&professionalVideo.includes("'coins_charged',1")],
 ['referral code field exists at registration',index.includes('newCustomerReferral')&&index.includes("action:'apply_referral'")],
 ['social dock has exactly four destinations',/\['home'.*\['upload'.*\['chat'.*\['profile'/s.test(ui)],
 ['locked feed responses omit raw storage paths',feed.includes('media_path,thumbnail_path,customer_id,...publicPost')],
 ['creator discovery omits raw media paths',discover.includes('{media_path,...publicPost}=post')&&discover.includes('const {avatar_path,...publicProfile}=p')],
 ['chat responses omit raw media paths',chat.includes('const {media_path,...publicMessage}=m')],
 ['notification preferences filter in-app alerts',notifications.includes('before insert on public.aam_social_notifications')&&notifications.includes('profile_update_notifications')],
 ['profile views count unique viewers',/primary key\s*\(profile_key,viewer_id\)/i.test(notifications)],
 ['admin social controls are linked from dashboard',index.includes('adminSocialPanel()')],
 ['coin balance remains a separate social table',/create table if not exists public\.aam_coin_balances/.test(read('supabase/migrations/20261118090000_social_feed_coins_foundation.sql'))],
 ['community group auto-provisions existing and new customers',/aam_chat_provision_community_member/.test(read('supabase/migrations/20261118100000_community_group_chat.sql'))&&/after insert on public\.customers/.test(read('supabase/migrations/20261118100000_community_group_chat.sql'))],
 ['community group roles are separate from platform admin',/aam_chat_group_members/.test(read('supabase/migrations/20261118100000_community_group_chat.sql'))&&/group_set_admin/.test(read('netlify/functions/social-admin.mjs'))],
 ['direct chats exclude the shared group',/conversation_type='direct'/.test(read('supabase/migrations/20261118100100_direct_chat_group_separation.sql'))],
 ['community group appears in customer chat list',/is_group:true/.test(chat)&&/Community/.test(ui)]
];
let failed=0;
for(const [name,ok] of checks){console.log((ok?'PASS':'FAIL')+' '+name);if(!ok)failed++;}
if(failed)process.exitCode=1;
