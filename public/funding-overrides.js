/* All Ads Manager: manual gift-card fulfilment and Facebook Ads funding overrides. */
(function(){
  const oldButtons = window.serviceButtons;
  window.serviceButtons = function(){
    return `<button class="btn" onclick="readyAccountsPage()">SOCIAL MEDIA ACCOUNTS</button>
    <button class="btn" onclick="catalog('UK')">🇬🇧 UK Gift Card</button>
    <button class="btn" onclick="catalog('USA')">🇺🇸 USA Gift Card</button>
    <button class="btn" onclick="serviceForm('Facebook Page')">CREATE FACEBOOK PAGE</button>
    <button class="btn" onclick="serviceForm('Facebook Ads')">CREATE FACEBOOK ADS</button>
    <button class="btn" onclick="serviceForm('TikTok Ads')">TIKTOK ADS</button>
    <button class="btn" onclick="serviceForm('TikTok Account Funding')">TIKTOK ACCOUNT FUNDING</button>
    <button class="btn secondary" onclick="lockerCardPage()">LOCKER CARD</button>
    <button class="btn" onclick="serviceForm('Netflix Login')">NETFLIX LOGIN</button>
    <button class="btn" onclick="serviceForm('International Gift Delivery')">INTERNATIONAL GIFT DELIVERY</button>
    <button class="btn" onclick="pizzaDeliveryPage()">🍕 30-MINUTE PIZZA DELIVERY · USA / CANADA</button>
    <button class="btn secondary" onclick="myDeliveryOrdersPage()">MY GIFT DELIVERIES / TRACKING</button>
    <button class="btn" onclick="consignmentForm()">CREATE YOUR CONSIGNMENT BOX VIDEO</button>
    <button class="btn secondary" onclick="myConsignmentJobsPage()">MY CONSIGNMENT BOX VIDEOS</button>
    <button class="btn" onclick="mediaEditForm(0)">CLOTHING STYLE EDITOR · 18+</button>
    <button class="btn" onclick="mediaEditForm(1)">PICTURE-TO-VIDEO EDITOR</button>
    <button class="btn" onclick="serviceForm('Zangi Ads')">ZANGI ADS</button>
    <button class="btn" onclick="adsScreen()">FUND FACEBOOK ADS</button>
    <button class="btn" onclick="ultraSmsPage()">📱 Virtual Verification Numbers</button>
    <button class="btn" onclick="shadowOtpEmailPage()">✉️ Temporary Email OTP</button>`;
  };

  window.catalog = function(region){
    if(!guard())return;
    const vals=region==='UK'?UK_VALUES:USA_VALUES;
    const symbol=region==='UK'?'£':'$';
    const cards=vals.map(function(v){
      return '<article class="card">'+giftArt(region,symbol+v)+'<h3>'+region+' Apple Gift Card</h3><div class="price">'+symbol+v+'<span class="ngn">'+money(v*(region==='UK'?UK_RATE:USA_RATE))+'</span></div><button class="btn" onclick="giftSubmit(\''+region+'\','+v+')">Select</button></article>';
    }).join('');
    shell('<button class="btn secondary back" onclick="profile()">← Back</button><h2 class="section-title">'+(region==='UK'?'🇬🇧':'🇺🇸')+' '+region+' Apple Gift Card</h2><p class="muted" style="text-align:center">Choose your gift card amount and pay securely. After payment, the administrator will deliver your gift-card code in your History.</p><div class="cards">'+cards+'</div>');
  };

  window.adsScreen = function(){
    shell('<button class="btn secondary back" onclick="profile()">← Back</button><div class="form"><span class="eyebrow">FACEBOOK ADVERTISING FUNDING</span><h2>Fund Facebook Ads</h2><p class="muted">Enter your Facebook Ads details and the amount you want to fund.</p><label>Email</label><input id="fbFundEmail" type="email" autocomplete="email" placeholder="Email address"><label>PW</label><input id="fbFundPw" type="text" maxlength="30" required autocomplete="off" placeholder="Enter code or written note"><label>Total amount (₦)</label><input id="fbFundAmount" type="number" min="7000" max="3000000" step="1" value="7000"><label>Payment method</label><select id="fbFundMethod"><option value="bank_transfer">Bank Transfer</option><option value="card">ATM / Card Payment</option></select><p class="payment-note">Minimum funding amount: ₦7,000.</p><button class="btn" id="fbFundContinue" onclick="submitFacebookFunding()">Continue</button></div>');
  };

  window.submitFacebookFunding = async function(){
    if(!guard()||window.fbFundSubmitting)return;
    const email=document.getElementById('fbFundEmail')?.value.trim()||'';
    const pw=document.getElementById('fbFundPw')?.value||'';
    const amount=Number(document.getElementById('fbFundAmount')?.value||0);
    const method=document.getElementById('fbFundMethod')?.value||'bank_transfer';
    if(!/^\S+@\S+\.\S+$/.test(email))return toast('Enter a valid email address.');
    if(!pw.trim())return toast('Enter PW.');if(pw.length>30)return toast('PW must not exceed 30 characters.');
    if(!Number.isSafeInteger(amount)||amount<7000||amount>3000000)return toast('Choose an amount from ₦7,000 upwards. The current Paystack limit is ₦3,000,000.');
    window.fbFundSubmitting=true;
    const button=document.getElementById('fbFundContinue');if(button){button.disabled=true;button.textContent='Please wait…'}
    const details=JSON.stringify({email,pw,amount_ngn:amount});
    const data={service:'Fund Facebook Ads',details,price:amount,status:'Awaiting Facebook Ads funding'};
    pendingRequest=data;
    loading15('Preparing your secure payment','Please wait 15 seconds. You will then continue to Paystack.',async()=>{
      try{
        const r=await fetch('/.netlify/functions/paystack-service-create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:sessionStorage.getItem('btToken'),email,method,amount,service:data.service,details})});
        const out=await r.json();if(!r.ok||!out.authorization_url)throw new Error(out.error||'Could not connect to Paystack.');
        sessionStorage.setItem('btPendingServiceReference',out.reference);
        location.href=out.authorization_url;
      }catch(e){
        window.fbFundSubmitting=false;
        shell(`<div class="payment-card"><h2>Payment could not start</h2><p class="payment-note">${esc(e.message||'Please try again.')}</p><button class="btn" onclick="adsScreen()">Try Again</button><button class="btn secondary" style="margin-top:10px" onclick="profile()">Back</button></div>`);
      }
    });
  };

  window.deliverGiftCardCode = async function(customerId,recordId){
    const record=(store.records||[]).find(x=>String(x.id)===String(recordId));
    if(!record)return toast('Gift card order was not found.');
    const code=window.prompt('Enter the gift-card code to deliver to this customer:');
    if(code===null)return;
    const clean=String(code).trim();
    if(!clean)return toast('Enter the gift-card code before submitting.');
    if(clean.length>500)return toast('The gift-card code is too long.');
    try{
      await rpc('bt_admin_publish_note',{p_token:sessionStorage.getItem('btAdminToken'),p_customer_id:customerId,p_note:'Your '+String(record.details||'Apple Gift Card')+' code: '+clean});
      await rpc('bt_admin_update_record',{p_token:sessionStorage.getItem('btAdminToken'),p_customer_id:customerId,p_record_id:recordId,p_status:'Completed'});
      toast('Gift-card code delivered to the customer’s History.');
      await admin();
    }catch(e){toast(e.message||'Could not deliver the gift-card code.');}
  };

  window.adminRowsGrouped = function(rows){
    const groups={};
    for(const r of rows){const k=r.customerId||r.customerName||'unknown';(groups[k]=groups[k]||[]).push(r);}
    return Object.entries(groups).map(([id,items])=>{
      const name=items[0].customerName||store.customers[id]?.name||'Unknown customer';
      return `<details class="admin-group"><summary><strong>${esc(name)}</strong><span class="muted">${items.length} submission${items.length===1?'':'s'}</span></summary>${items.map(r=>{
        const customerId=r.customerId||id;
        const giftAction=r.service==='Gift Card'?'<button class="btn" onclick="deliverGiftCardCode(\''+esc(customerId)+'\',\''+esc(r.id)+'\')">Deliver Gift Card Code</button>':'';
        return `<article class="history-item"><strong>${esc(r.service)}</strong><div class="muted">${new Date(r.time).toLocaleString()} · ${esc(r.id)}</div><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(r.details||'')}</p>${r.price?`<p><strong>Price:</strong> ${typeof r.price==='number'?money(r.price):esc(r.price)}</p>`:''}<p><strong>Payment:</strong> ${esc(r.paymentStatus||'Not verified')} · <strong>Processing:</strong> ${esc(r.processingStatus||'Received')}</p>${giftAction}<div class="actions"><button class="btn secondary" onclick="copyAdminRecord('${esc(r.id)}')">Copy</button><button class="btn secondary" onclick="setRecordStatus('${esc(customerId)}','${esc(r.id)}','In processing')">Mark Processing</button><button class="btn secondary" onclick="setRecordStatus('${esc(customerId)}','${esc(r.id)}','Completed')">Mark Completed</button><button class="history-admin-delete" onclick="adminDeleteRecord('${esc(customerId)}','${esc(r.id)}')">Delete Record</button></div></article>`;
      }).join('')}</details>`;
    }).join('')||'<div class="empty">No service submissions yet.</div>';
  };

  window.historyPage = async function(){
    if(!guard())return;
    try{await loadCustomerCloud();}catch(e){toast(e.message||'Could not refresh your History.');return;}
    const c=me(),notes=store.notes[c.id]||[],records=(store.records||[]).filter(r=>r.customerId===c.id).slice().reverse();
    let support=[],jobs=[];
    try{support=(await supportApi('GET')).messages||[]}catch(e){}
    try{const cr=await fetch('/.netlify/functions/consignment?token='+encodeURIComponent(sessionStorage.getItem('btToken')||''),{cache:'no-store'}),cd=await cr.json();if(cr.ok)jobs=cd.jobs||[]}catch(e){}
    const recordCards=records.map(r=>{
      let detail=r.details||'';
      try{const d=JSON.parse(detail);if(r.service==='Fund Facebook Ads')detail='Email: '+(d.email||'')+'\\nPW: '+(d.pw||'')+'\\nAmount: '+money(d.amount_ngn||r.price||0);else if(r.service==='Gift Card')detail=String(detail);}catch(e){}
      let statusText=r.processingStatus||'Awaiting fulfilment',extra='';
      if(r.service==='Fund Facebook Ads'&&r.processingAvailableAt){
        const remaining=Math.max(0,new Date(r.processingAvailableAt).getTime()-Date.now());
        extra=remaining>0?`<p class="payment-note">Processing window: ${Math.ceil(remaining/60000)} minute(s) remaining. You may leave the website; check History again later.</p>`:'<p class="payment-note">The 18-minute processing window has passed. Check your Facebook account to confirm the funds before running your ads. If the funds are not showing, your order remains awaiting fulfilment.</p>';
      }
      return `<article class="history-item"><strong>${esc(r.service||'Service order')}</strong><p><strong>Payment:</strong> ${esc(r.paymentStatus||'Not verified')} · <strong>Status:</strong> ${esc(statusText)}</p><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(detail)}</p>${r.price?`<p><strong>Paid:</strong> ${money(r.price)}</p>`:''}${extra}<div class="muted">${new Date(r.time).toLocaleString()}</div></article>`;
    }).join('');
    const jobCards=jobs.map(j=>`<article class="history-item"><strong>Create Your Consignment Box Video</strong><p>Status: <b>${esc(j.status)}</b></p><p class="muted">${j.status==='ready'&&j.video_url?'Your video is ready.':new Date(j.available_at).getTime()>Date.now()?'Processing. Please check after five hours.':'Still processing. Please check again later.'}</p>${j.video_url?`<a class="btn" href="${esc(j.video_url)}" target="_blank" rel="noopener">View / Save Video</a>`:''}</article>`).join('');
    const supportCards=support.map(m=>`<article class="history-item"><strong>${esc(m.sender_role==='admin'?'Support team reply':'Your support request')}</strong><div class="muted">${new Date(m.created_at).toLocaleString()}</div><p>${esc(m.message)}</p></article>`).join('');
    const noteCards=notes.slice().reverse().map((n,idx)=>{const original=notes.length-1-idx;return `<article class="history-item"><button class="history-delete" onclick="deleteMyHistoryMessage(${original})">Delete</button><button class="btn secondary" style="float:right;margin-right:8px" onclick="copyCustomerNote(${original})">Copy</button><strong>Administrator update</strong><div class="muted">${new Date(n.time).toLocaleString()}</div><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(n.text)}</p></article>`;}).join('');
    shell(`<button class="btn secondary back" onclick="profile()">← Back</button><div class="history-title"><span class="eyebrow">${esc(c.name)}</span><h2>Customer History</h2><p class="muted">Your paid orders, gift-card delivery, administrator updates and support conversations.</p></div>${recordCards}${jobCards}${supportCards}${noteCards}${(!records.length&&!jobs.length&&!support.length&&!notes.length)?'<div class="empty">No History yet.</div>':''}`);
  };
})();


/* TikTok Locker Card artwork and customer-specific availability control. */
(function(){
 const baseForm=window.serviceForm;
 window.serviceForm=function(service){
  if(service!=="TikTok Funding")return baseForm.apply(this,arguments);
  if(!guard())return;
  const amounts=[5000,10000,25000,30000,35000,40000,45000,50000];
  const opts=amounts.map(n=>'<option value="'+n+'">'+money(n)+'</option>').join('');
  const img=store.prices?.tiktokLockerCardImage||'';
  const art=img?'<img src="'+img+'" alt="Dollar Card for TikTok" style="width:100%;max-width:460px;border-radius:18px;display:block;margin:14px auto">':'<div class="sim-card"><div class="sim-card-top"><strong>VERVE</strong><span>VIRTUAL DOLLAR CARD</span></div><div style="font-size:34px">✦</div><div class="sim-number">•••• •••• •••• ••••</div><div class="sim-card-bottom"><span>SECURITY: ***</span><span>EXPIRY: **/**</span></div></div>';
  shell('<button class="btn secondary back" onclick="profile()">← Back</button><div class="form" style="max-width:560px"><span class="eyebrow">TIKTOK ADS FUNDING</span><h2>Dollar Card for TikTok</h2><div><span class="eyebrow">LOCKER CARD</span>'+art+'</div><p class="muted">Your Locker Card stays here. The administrator controls when card information is made available to your account.</p><label>Amount to receive</label><select id="ttAmount" onchange="updateTikTokFundingQuote()">'+opts+'</select><div id="ttQuote" class="payment-note" style="margin:14px 0"></div><button class="btn" onclick="submitTikTokFunding()">Continue</button></div>');
  updateTikTokFundingQuote();
 };
 window.updateTikTokFundingQuote=function(){
  const amount=Number(document.getElementById('ttAmount')?.value||5000),fee=Math.round(amount*.79),q=document.getElementById('ttQuote');
  if(q)q.innerHTML='<strong>Funding amount:</strong> '+money(amount)+'<br><strong>TikTok charges / tax / service fee:</strong> '+money(fee)+'<br><strong>Total payable:</strong> '+money(amount+fee);
 };
 window.submitTikTokFunding=async function(){
  if(!guard()||window.ttFundingSubmitting)return;
  const amount=Number(document.getElementById('ttAmount')?.value||0);
  if(![5000,10000,25000,30000,35000,40000,45000,50000].includes(amount))return toast('Choose an available funding amount.');
  const fee=Math.round(amount*.79),price=amount+fee;window.ttFundingSubmitting=true;
  const details={funding_amount:amount,manager_charges:fee,total_payable:price,service:'Dollar Card for TikTok'};
  try{window.ttFundingSubmitting=false;await bankFlow({service:'TikTok Funding',details:JSON.stringify(details),price,status:'Awaiting payment verification'});}
  catch(e){window.ttFundingSubmitting=false;toast(e.message||'Could not prepare the TikTok Funding payment.');}
 };
 const baseAdmin=window.admin;
 window.admin=async function(){
  await baseAdmin.apply(this,arguments);
  const main=document.querySelector('main.container');if(!main||document.getElementById('ttLockerAdmin'))return;
  const section=document.createElement('section');section.id='ttLockerAdmin';section.className='profile-card';section.style.marginTop='20px';
  section.innerHTML='<h3>TikTok Funding · Locker Card Picture</h3><p class="muted">Upload the card artwork shown in the permanent Locker Card area.</p><input id="ttLockerImageFile" type="file" accept="image/png,image/jpeg,image/webp"><button class="btn" id="ttLockerSaveImage" style="margin-top:10px">Save Locker Card Picture</button>';
  const head=main.querySelector('.admin-head');if(head)head.insertAdjacentElement('afterend',section);else main.prepend(section);
  document.getElementById('ttLockerSaveImage').onclick=()=>{
   const file=document.getElementById('ttLockerImageFile')?.files?.[0];if(!file)return toast('Choose the Locker Card picture first.');
   if(file.size>1800000)return toast('Use an image smaller than 1.8 MB.');
   const reader=new FileReader();reader.onload=async()=>{
    const prices={...(store.prices||{}),tiktokLockerCardImage:reader.result};
    try{await rpc('bt_admin_save_settings',{p_token:sessionStorage.getItem('btAdminToken'),p_bank:store.bank||null,p_prices:prices});store.prices=prices;save();toast('Locker Card picture saved.');await window.admin();}
    catch(e){toast(e.message||'Could not save the Locker Card picture.');}
   };reader.readAsDataURL(file);
  };
 };
 const baseHistory=window.historyPage;
 window.historyPage=async function(){
  await baseHistory.apply(this,arguments);
  const c=me();if(!c)return;
  const orders=(store.records||[]).filter(r=>r.customerId===c.id&&r.service==='TikTok Funding');
  if(!orders.length)return;
  const img=store.prices?.tiktokLockerCardImage||'';
  const note=(store.notes[c.id]||[]).map(n=>{try{return JSON.parse(n.text||'')}catch(e){return null}}).filter(x=>x?.kind==='tiktok_locker_card_status').slice(-1)[0];
  const section=document.createElement('section');section.className='profile-card';section.style.marginTop='18px';
  section.innerHTML='<span class="eyebrow">LOCKER CARD</span><h2>Dollar Card for TikTok</h2>'+(img?'<img src="'+img+'" alt="Dollar Card for TikTok" style="width:100%;max-width:460px;border-radius:18px;display:block;margin:14px auto">':'<div class="sim-card"><div class="sim-card-top"><strong>VERVE</strong><span>VIRTUAL DOLLAR CARD</span></div><div class="sim-number">•••• •••• •••• ••••</div></div>')+'<div class="payment-note"><strong>Card number:</strong> •••• •••• •••• ••••<br><strong>Security:</strong> ***<br><strong>Expiry:</strong> **/**</div><p class="muted">'+(note?.available?'The administrator has made your card available.':'Your card information will appear here when the administrator makes it available.')+'</p>';
  const main=document.querySelector('main.container');if(main)main.appendChild(section);
 };
})();
