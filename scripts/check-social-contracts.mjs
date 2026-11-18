import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const foundation=read('supabase/migrations/20261118090000_social_feed_coins_foundation.sql');
const policy=read('supabase/migrations/20261118120000_remove_age_gate_and_promotion_coins.sql');
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
 ['all social videos and pictures are free to view',feed.includes('locked_video:false')&&feed.includes('media_url:await signedRead(p.media_path)')&&!ui.includes('Professional Video locked')],
 ['Promotion Coins are only for promotion',ui.includes('Promotion Coin packages')&&ui.includes('used only to promote your posts and profile')&&policy.includes('promotion only')],
 ['Promotion Coin packages show Nigerian values and stay disabled until payment approval',ui.includes('amounts=[100,200,500,1000,2000,5000,10000,20000,50000,100000,200000]')&&ui.includes('type="button" disabled')&&ui.includes('Your existing tools wallet is separate.')],
 ['follow and referral actions cannot mint Promotion Coins',policy.includes("'promotion_coins_earned',0")&&policy.includes('promotion_coins_are_purchase_only')],
 ['admin video editor supports original sound mute/keep, voice-over and background music',ui.includes('Keep original video sound')&&ui.includes('Record my voice over the video')&&ui.includes('Background music volume')&&ui.includes('recordVideoMix')],
 ['voice and background music have independent volume controls',ui.includes('aamVoiceVolume')&&ui.includes('aamMusicVolume')],
 ['admin video mix can be previewed before publishing',ui.includes('aamAdminMixedPreview')&&ui.includes('Finished mix ready. Play the preview, then publish.')],
 ['social dock has exactly four destinations',/\['home'.*\['upload'.*\['chat'.*\['profile'/s.test(ui)],
 ['locked feed responses omit raw storage paths',feed.includes('media_path,thumbnail_path,customer_id,...publicPost')],
 ['creator discovery omits raw media paths',discover.includes('{media_path,...publicPost}=post')&&discover.includes('const {avatar_path,...publicProfile}=p')],
 ['chat responses omit raw media paths',chat.includes('const {media_path,...publicMessage}=m')],
 ['notification preferences filter in-app alerts',notifications.includes('before insert on public.aam_social_notifications')&&notifications.includes('profile_update_notifications')],
 ['profile views count unique viewers',/primary key\s*\(profile_key,viewer_id\)/i.test(notifications)],
 ['admin social controls are linked from dashboard',index.includes('adminSocialPanel()')],
 ['Promotion Coin balance remains separate from existing tools wallet',/create table if not exists public\.aam_coin_balances/.test(foundation)&&ui.includes('Your existing tools wallet is separate.')],
 ['community group auto-provisions existing and new customers',/aam_chat_provision_community_member/.test(community)&&/after insert on public\.customers/.test(community)],
 ['community group roles are separate from platform admin',/aam_chat_group_members/.test(community)&&/group_set_admin/.test(admin)],
 ['direct chats exclude the shared group',/conversation_type='direct'/.test(direct)],
 ['community group appears in customer chat list',/is_group:true/.test(chat)&&/Community/.test(ui)]
];
let failed=0;
for(const [name,ok] of checks){console.log((ok?'PASS':'FAIL')+' '+name);if(!ok)failed++;}
if(failed)process.exitCode=1;
