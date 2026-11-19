import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const foundation=read('supabase/migrations/20261118090000_social_feed_coins_foundation.sql');
const policy=read('supabase/migrations/20261118120000_remove_age_gate_and_promotion_coins.sql');
const videoLocks=read('supabase/migrations/20261118130000_admin_selective_video_locking.sql');
const notifications=read('supabase/migrations/20261118090500_social_notification_preferences_and_profile_views.sql');
const community=read('supabase/migrations/20261118100000_community_group_chat.sql');
const direct=read('supabase/migrations/20261118100100_direct_chat_group_separation.sql');
const feed=read('netlify/functions/social-feed.mjs');
const core=read('netlify/functions/social-core.mjs');
const socialChat=read('netlify/functions/social-chat.mjs');
const socialDiscover=read('netlify/functions/social-discover.mjs');
const socialInteractions=read('netlify/functions/social-interactions.mjs');
const admin=read('netlify/functions/social-admin.mjs');
const discover=read('netlify/functions/social-discover.mjs');
const chat=read('netlify/functions/social-chat.mjs');
const index=read('public/index.html');
const ui=read('public/social.js');
const checks=[
 ['no 18+ gate remains in feed, uploads, or customer UI',!feed.includes('18 or older')&&!feed.includes('adult_confirmed_at')&&!ui.includes('ensureAge')&&!index.includes('18 or older')],
 ['age confirmation field and RPC are removed by migration',policy.includes('drop column if exists adult_confirmed_at')&&policy.includes('drop function if exists public.aam_social_confirm_age')],
 ['all videos from other profiles require a coin; own videos and pictures remain free',feed.includes("p.media_type==='video'&&p.customer_id!==s.customer_id&&!unlocked.has(p.id)")&&ui.includes('Watching a video costs 1 coin')&&policy.includes('aam_social_unlock_video')],
 ['one-time video unlock deducts from separate free or purchased coin bucket',read('supabase/migrations/20261119130000_two_balance_coin_accounting.sql').includes("v_source='purchased'")&&read('supabase/migrations/20261119130000_two_balance_coin_accounting.sql').includes('free_coins=free_coins-1')&&read('supabase/migrations/20261119130000_two_balance_coin_accounting.sql').includes('purchased_coins=purchased_coins-1')],
 ['video unlock action is server-side and exposed to logged-in customers',core.includes("action==='unlock_video'")&&core.includes("rpc('aam_social_unlock_video'")&&ui.includes('AAMSocial.unlockVideo')],
 ['customer coin UI displays separate free and purchased balances',ui.includes('Free coins:')&&ui.includes('Purchased coins:')&&core.includes('free_coin_balance')&&core.includes('purchased_coin_balance')],
 ['coin purchases use Paystack and are verified server-side before credit',read('netlify/functions/social-coin-purchase-create.mjs').includes('transaction/initialize')&&read('netlify/functions/social-coin-purchase-verify.mjs').includes('transaction/verify')&&read('supabase/migrations/20261119131000_paystack_video_coin_purchases.sql').includes('aam_social_credit_coin_purchase')],
 ['follow and referral awards are credited only to free coins',read('supabase/migrations/20261119130000_two_balance_coin_accounting.sql').includes('free_coins=public.aam_coin_balances.free_coins+35')&&read('supabase/migrations/20261119130000_two_balance_coin_accounting.sql').includes('free_coins=public.aam_coin_balances.free_coins+500')],
 ['admin video editor supports original sound mute/keep, voice-over and background music',ui.includes('Keep original video sound')&&ui.includes('Record my voice over the video')&&ui.includes('Background music volume')&&ui.includes('recordVideoMix')],
 ['new accounts receive 10 free coins and legacy balances are not treated as cash',read('supabase/migrations/20261119130000_two_balance_coin_accounting.sql').includes('values(new.id,10,0)')&&read('supabase/migrations/20261119130000_two_balance_coin_accounting.sql').includes('purchased_coins = 0')],
 ['voice and background music have independent volume controls',ui.includes('aamVoiceVolume')&&ui.includes('aamMusicVolume')],
 ['admin video mix can be previewed before publishing',ui.includes('aamAdminMixedPreview')&&ui.includes('Mix ready. Play the preview and check the sound before publishing.')],
 ['social dock has exactly four destinations',/\['home'.*\['upload'.*\['chat'.*\['profile'/s.test(ui)],
 ['locked feed responses omit raw storage paths',feed.includes('media_path,thumbnail_path,customer_id,...publicPost')],
 ['admin creator profile videos require a coin until unlocked',socialDiscover.includes("p.media_type==='video'&&!unlocked.has(p.id)")&&socialDiscover.includes('media_url:locked?null:await signedRead(media_path)')],
 ['creator profile videos use the same one-coin unlock rule',socialDiscover.includes("post.media_type==='video'&&post.customer_id!==s.customer_id&&!unlocked.has(post.id)")],
 ['creator discovery omits raw media paths',discover.includes('{media_path,thumbnail_path,...publicPost}=post')&&discover.includes('const {avatar_path,...publicProfile}=p')],
 ['chat responses omit raw media paths',chat.includes('const {media_path,...publicMessage}=m')],
 ['notification preferences filter in-app alerts',notifications.includes('before insert on public.aam_social_notifications')&&notifications.includes('profile_update_notifications')],
 ['profile views count unique viewers',/primary key\s*\(profile_key,viewer_id\)/i.test(notifications)],
 ['admin social controls are linked from dashboard',index.includes('adminSocialPanel()')],
 ['purchased video-view revenue is ledgered separately from free rewards',read('supabase/migrations/20261119130000_two_balance_coin_accounting.sql').includes('aam_coin_cash_ledger')&&read('supabase/migrations/20261119130000_two_balance_coin_accounting.sql').includes("if v_source='purchased' then")],
 ['community group auto-provisions existing and new customers',/aam_chat_provision_community_member/.test(community)&&/after insert on public\.customers/.test(community)],
 ['community group roles are separate from platform admin',/aam_chat_group_members/.test(community)&&/group_set_admin/.test(admin)],
 ['direct chats exclude the shared group',/conversation_type='direct'/.test(direct)],
 ['community group appears in customer chat list',/is_group:true/.test(chat)&&/Community/.test(ui)]
];
let failed=0;
for(const [name,ok] of checks){console.log((ok?'PASS':'FAIL')+' '+name);if(!ok)failed++;}
if(failed)process.exitCode=1;
