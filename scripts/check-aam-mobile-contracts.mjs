import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(path, 'utf8');
const index = read('public/index.html');
const social = read('public/social.js');
const socialCss = read('public/social.css');
const documentEditor = read('public/document-editor.js');
const documentCss = read('public/document-editor.css');
const avatar = read('public/aam-livekit-avatar.js');
const feed = read('netlify/functions/social-feed.mjs');
const discover = read('netlify/functions/social-discover.mjs');
const dailymotion = read('netlify/functions/dailymotion-feed.mjs');
const audius = read('netlify/functions/audius-search.mjs');
const cloudflare = read('netlify/functions/cloudflare-stream-create.mjs');
const adminCalls = read('netlify/functions/admin-livekit-calls.mjs');
const promotions = read('netlify/functions/social-promotions.mjs');
const profileMigration = read('supabase/migrations/20261120110000_aam_social_public_profile_id.sql');
const manifest = read('public/manifest.webmanifest');
const serviceWorker = read('public/sw.js');

const checks = [];
function check(name, condition) {
  assert.ok(condition, name);
  checks.push(name);
}

const giftStart = index.indexOf('const deliveryGiftCatalog=');
const giftEnd = index.indexOf('const giftDeliveryCountries', giftStart);
const giftCatalog = index.slice(giftStart, giftEnd);
const women = (giftCatalog.match(/gender:["']Woman["']/g) || []).length;
const men = (giftCatalog.match(/gender:["']Man["']/g) || []).length;

check('gift catalogue has at least 100 women gift choices', women >= 100);
check('gift catalogue has at least 100 men gift choices', men >= 100);
check('gift gallery filters by recipient gender and search', index.includes("p.gender===gender&&(!query"));
check('gift gallery is internally scrollable and lazy-loads images', index.includes('max-height:58vh') && index.includes('loading="lazy" decoding="async" fetchpriority="low"'));
check('gift gender change clears the previous search', index.includes("search=document.getElementById('deliveryGiftSearch');if(search)search.value=''"));
check('gift selection uses safe data-index handlers', index.includes('chooseDeliveryGiftFromButton(this)') && index.includes('negotiateGiftFromButton(this)'));
check('international gift country list is present', index.includes('const giftDeliveryCountries='));
check('11-digit numeric public profile ID migration exists', /start with 10000000000/.test(profileMigration) && /maxvalue 99999999999/.test(profileMigration));

check('six main app tabs are in the requested order', social.includes("['home','⌂','Home'],['status','◉','Status'],['upload','＋','Post'],['chat','◌','Chat'],['tools','▦','Tools'],['profile','●','Profile']"));
check('mobile navigation uses six columns', socialCss.includes('repeat(6,minmax(0,1fr))'));
check('Tools contains dashboard, funding, histories, support and Document Studio', social.includes('Add Funds') && social.includes('Payment History') && social.includes('Contact Support') && social.includes("documentEditorStart?.('produce')") && social.includes("documentEditorStart?.('upload')"));
check('Social Media UK and Social Media Accounts UK remain visible', index.includes('SOCIAL MEDIA UK') && index.includes('SOCIAL MEDIA ACCOUNTS UK'));
check('TikTok Dollar Card, Facebook Ads and TikTok Ads remain available', index.includes('TIKTOK DOLLAR CARD') && index.includes('FACEBOOK ADS') && index.includes('TIKTOK ADS'));
check('customer tools stay inside the app shell', index.includes('window.AAMSocial?.showToolPage?.(html)') && social.includes('function showToolPage(html)'));
check('tool screens keep phone back navigation', social.includes('aamToolPopstateBound') && social.includes('aamToolPageActive'));
check('admin access uses a four-second hold', social.includes('4000') && social.includes('is-holding'));
check('customer UI suppresses accidental text selection', socialCss.includes('-webkit-touch-callout:none') && socialCss.includes('-webkit-user-select:none'));

check('Document Studio retries failed editing libraries', documentEditor.includes('script.dataset.aamFailed') && documentEditor.includes('libPromise=null'));
check('Document Studio autosaves after idle time', documentEditor.includes('requestIdleCallback') && documentEditor.includes('},950);'));
check('Document Studio supports phone back navigation', documentEditor.includes('function leaveStudio()') && documentEditor.includes('aamDocumentPopstateBound'));
check('tapping a text object opens its editing field', documentEditor.includes("field.focus({preventScroll:true})"));
check('Document Studio tracks the iPhone visual viewport', documentEditor.includes('function syncDocumentViewport()') && documentEditor.includes('visualViewport'));
check('Overview television has a curved-screen treatment', documentCss.includes('.doc-tv{') && documentCss.includes('perspective(1200px)'));

check('Dailymotion reads the existing public/private key names', dailymotion.includes('DAILYMOTION_PRIVATE_API_KEY') && dailymotion.includes('DAILYMOTION_PRIVATE_API_SECRET') && dailymotion.includes('DAILYMOTION_PUBLIC_API_KEY') && dailymotion.includes('DAILYMOTION_PUBLIC_API_SECRET'));
check('Dailymotion requests account and video read scopes', dailymotion.includes("scope:'account.read video.read'"));
check('Dailymotion feed imports only public non-explicit embeddable videos', dailymotion.includes("url.searchParams.set('visibility','public')") && dailymotion.includes("url.searchParams.set('is_explicit','false')") && dailymotion.includes('embedding?.enable_embed===false'));
check('Dailymotion import avoids duplicate posts', dailymotion.includes('aam_social_posts?select=id&id=in.(') && dailymotion.includes('if(!freshRows.length)'));
check('Home feed renders Dailymotion player videos', feed.includes('function dailymotionId') && feed.includes('dailymotionPlayer(dmId)') && social.includes("p.video_provider==='dailymotion'"));
check('Home refresh imports Dailymotion content', social.includes('syncDailymotionFeed') && social.includes('/.netlify/functions/dailymotion-feed'));
check('Audius uses the existing sound API key and bearer token', audius.includes('process.env.AUDIUS_API_KEY') && audius.includes('process.env.AUDIUS_BEARER_TOKEN'));
check('Cloudflare Stream uses the existing video API token', cloudflare.includes('process.env.CLOUDFLARE_API_TOKEN') && cloudflare.includes('/stream/direct_upload'));

check('video-call camera and microphone start independently', social.includes('Promise.allSettled([room.localParticipant.setMicrophoneEnabled(true)'));
check('remote call video is muted for reliable iPhone autoplay', social.includes("el.muted=true;el.classList.add('aam-call-remote-video')"));
check('connected call status no longer overwrites permission warnings', social.includes("textContent==='Connecting…'"));
check('administrator call screen receives customer name and avatar', adminCalls.includes('target_customer:{display_name:targetName,avatar_url:targetAvatar') && social.includes('targetPhoto'));
check('call ringtone and in-app notification tones share unlocked audio', social.includes('unlockCallRingtone') && social.includes('playNotificationSound'));
check('mobile avatar tracking is performance tuned', avatar.includes('mobileDevice ? 1 : 1.5') && avatar.includes('mobileDevice ? 150 : 100') && avatar.includes('handLandmarker') && avatar.includes('faceLandmarker'));

check('customer dashboard repairs older customer IDs', index.includes('if(customer&&!customer.id)customer.id=id'));
check('customer history sources load concurrently with timeouts', index.includes('Promise.allSettled([withTimeout(supportApi'));
check('customer history uses time-only labels', index.includes('function clockTime(value)') && index.includes('clockTime(o.created_at||Date.now())'));
check('in-app promotion mode does not depend on a third-party network', promotions.includes("provider_ready:true") && promotions.includes("promotion_mode:'in_app'"));
check('PWA manifest opens as a standalone application', /"display"\s*:\s*"standalone"/.test(manifest));
check('service worker supports push notifications', serviceWorker.includes('showNotification'));

console.log('All Ads Manager contract checks passed: ' + checks.length);
console.log('Gift catalogue counts: ' + women + ' women, ' + men + ' men.');
