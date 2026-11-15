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
    <button class="btn" onclick="serviceForm('Netflix Login')">NETFLIX LOGIN</button>
    <button class="btn" onclick="serviceForm('International Gift Delivery')">INTERNATIONAL GIFT DELIVERY</button>
    <button class="btn secondary" onclick="myDeliveryOrdersPage()">MY GIFT DELIVERIES / TRACKING</button>
    <button class="btn" onclick="consignmentForm()">CREATE YOUR CONSIGNMENT BOX VIDEO</button>
    <button class="btn secondary" onclick="myConsignmentJobsPage()">MY CONSIGNMENT BOX VIDEOS</button>
    <button class="btn" onclick="serviceForm('Zangi Ads')">ZANGI ADS</button>
    <button class="btn" onclick="adsScreen()">FUND FACEBOOK ADS</button>
    <button class="btn" onclick="ultraSmsPage()">📱 Virtual Verification Numbers</button>`;
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


/* TikTok Funding updates — amount list, itemized 79% fee, and customer-specific card delivery. */
(function(){
  const amountOptions=[5000,10000,25000,30000,35000,40000,45000,50000];
  const originalServiceForm=window.serviceForm;
  window.serviceForm=function(service){
    if(service!=="TikTok Funding")return originalServiceForm.apply(this,arguments);
    if(!guard())return;
    const options=amountOptions.map(n=>'<option value="'+n+'">'+money(n)+'</option>').join('');
    shell('<button class="btn secondary back" onclick="profile()">← Back</button><div class="form"><span class="eyebrow">TIKTOK ADS FUNDING</span><h2>Dollar Card for TikTok</h2><p class="muted">Choose the amount of TikTok funding you want to receive. Charges and total payable are shown before you continue.</p><label>Amount to receive</label><select id="ttAmount" onchange="updateTikTokFundingQuote()">'+options+'</select><div id="ttQuote" class="payment-note" style="margin:14px 0"></div><button class="btn" onclick="submitTikTokFunding()">Continue</button></div>');
    updateTikTokFundingQuote();
  };
  window.updateTikTokFundingQuote=function(){
    const amount=Number(document.getElementById('ttAmount')?.value||5000);
    const charges=Math.round(amount*0.79),total=amount+charges;
    const q=document.getElementById('ttQuote');
    if(q)q.innerHTML='<strong>TikTok funding:</strong> '+money(amount)+'<br><strong>TikTok charges / tax / service fee:</strong> '+money(charges)+'<br><strong>Total payable:</strong> '+money(total);
  };
  window.submitTikTokFunding=async function(){
    if(!guard()||window.ttFundingSubmitting)return;
    const amount=Number(document.getElementById('ttAmount')?.value||0);
    if(!amountOptions.includes(amount))return toast('Choose one of the available funding amounts.');
    const charges=Math.round(amount*0.79),price=amount+charges;
    window.ttFundingSubmitting=true;
    const details={funding_amount:amount,manager_charges:charges,total_payable:price,fulfilment:'Dollar Card for TikTok will be made available by the administrator in this customer account.'};
    try{
      const saved=await recordAdmin({service:'TikTok Funding',details:JSON.stringify(details,null,2),price,status:'Awaiting payment'});
      const record=(store.records||[]).find(x=>x.service==='TikTok Funding'&&x.customerId===current()&&x.price===price&&x.paymentStatus==='Not verified');
      if(record)sessionStorage.setItem('btTikTokFundingRecord',String(record.id));
      window.ttFundingSubmitting=false;
      bankFlow({service:'TikTok Funding',details:JSON.stringify(details),price,status:'Awaiting payment verification'});
    }catch(e){window.ttFundingSubmitting=false;toast(e.message||'Could not save your TikTok funding request.');}
  };

  const oldAdminRows=window.adminRowsGrouped;
  window.adminRowsGrouped=function(rows){
    const html=oldAdminRows.apply(this,arguments);
    setTimeout(()=>{
      document.querySelectorAll('.admin-group .history-item').forEach(card=>{
        if(!card.querySelector('strong')?.textContent?.includes('TikTok Funding'))return;
        if(card.querySelector('.tt-admin-reveal'))return;
        const idLine=card.querySelector('.muted')?.textContent||'';
        const match=idLine.match(/BT-[^\s·]+/);
        const id=match?.[0];
        const customerName=card.closest('.admin-group')?.querySelector('summary strong')?.textContent||'';
        const customerId=Object.values(store.customers||{}).find(c=>c.name===customerName)?.id;
        if(!id||!customerId)return;
        const b=document.createElement('button');
        b.className='btn tt-admin-reveal';b.style.marginTop='10px';b.textContent='Display Dollar Card to this customer';
        b.onclick=()=>window.adminDisplayTikTokCard(customerId,id);
        card.appendChild(b);
      });
    },0);
    return html;
  };
  window.adminDisplayTikTokCard=async function(customerId,recordId){
    const number=prompt('Enter the Dollar Card number for this customer (middle digits will be masked until display):','5078 7290 6737 3878');
    if(number===null)return;
    const cvv=prompt('Enter the CVV for this customer:','587');if(cvv===null)return;
    const expiry=prompt('Enter the expiry date (MM/YY):','11/30');if(expiry===null)return;
    if(!number.trim()||!cvv.trim()||!expiry.trim())return toast('Complete all card details before publishing.');
    const payload={kind:'tiktok_dollar_card',recordId,number:number.trim(),cvv:cvv.trim(),expiry:expiry.trim(),revealed:true,updatedAt:new Date().toISOString()};
    try{
      await rpc('bt_admin_publish_note',{p_token:sessionStorage.getItem('btAdminToken'),p_customer_id:customerId,p_note:JSON.stringify(payload)});
      await rpc('bt_admin_update_record',{p_token:sessionStorage.getItem('btAdminToken'),p_customer_id:customerId,p_record_id:recordId,p_status:'Dollar Card displayed'});
      toast('Dollar Card displayed only in this customer’s History.');
      await admin();
    }catch(e){toast(e.message||'Could not display the card to this customer.');}
  };
  const oldHistoryPage=window.historyPage;
  window.historyPage=async function(){
    await oldHistoryPage.apply(this,arguments);
    const c=me();if(!c)return;
    const notes=store.notes[c.id]||[];
    const cards=notes.map(n=>{try{return JSON.parse(n.text||'')}catch(e){return null}}).filter(x=>x?.kind==='tiktok_dollar_card'&&x.revealed);
    if(!cards.length)return;
    const card=cards[cards.length-1];
    const number=String(card.number||'').replace(/\s/g,'');
    const masked=number.length>8?number.slice(0,4)+' **** **** '+number.slice(-4):'**** **** ****';
    const node=document.createElement('section');node.className='profile-card';node.style.marginTop='18px';
    node.innerHTML='<span class="eyebrow">TIKTOK FUNDING</span><h2>Dollar Card for TikTok</h2><div class="sim-card"><div class="sim-card-top"><strong>VERVE</strong><span>VIRTUAL DOLLAR CARD</span></div><div class="sim-chip">▦</div><div class="sim-number">'+esc(masked)+'</div><div class="sim-card-bottom"><span>CVV: '+esc(card.cvv)+'</span><span>EXP: '+esc(card.expiry)+'</span></div></div><p class="muted">The administrator has made this card available to your account.</p>';
    const main=document.querySelector('main.container');if(main)main.appendChild(node);
  };
})();
