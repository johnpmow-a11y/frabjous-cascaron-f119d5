import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store, private'},body:JSON.stringify(body)});
async function db(path,options={}){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw new Error('Locker Card database is not configured.');const r=await fetch(`${u}/rest/v1/${path}`,{...options,headers:{apikey:k,...( k.startsWith('sb_secret_') ? {} : {Authorization:`Bearer ${k}`}),'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>[]);if(!r.ok)throw new Error(d.message||'Locker Card database request failed.');return d;}
function key(){const v=String(process.env.CARD_DATA_ENCRYPTION_KEY||'');if(!/^[a-f0-9]{64}$/i.test(v))throw new Error('Set CARD_DATA_ENCRYPTION_KEY to a random 64-character hexadecimal key.');return Buffer.from(v,'hex');}
function encrypt(value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);const out=Buffer.concat([c.update(value,'utf8'),c.final()]);return {encrypted_card_data:out.toString('base64'),card_iv:iv.toString('base64'),card_auth_tag:c.getAuthTag().toString('base64')};}
function decrypt(row){const d=createDecipheriv('aes-256-gcm',key(),Buffer.from(row.card_iv,'base64'));d.setAuthTag(Buffer.from(row.card_auth_tag,'base64'));return Buffer.concat([d.update(Buffer.from(row.encrypted_card_data,'base64')),d.final()]).toString('utf8');}
async function session(token,admin){if(!/^[0-9a-f-]{36}$/i.test(token))return null;const table=admin?'admin_sessions':'customer_sessions';const rows=await db(`${table}?select=${admin?'token':'customer_id'}&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);return rows[0]||null;}
function mask(n){return n.length>10?n.slice(0,6)+'*'.repeat(n.length-10)+n.slice(-4):'*'.repeat(n.length);}
function maskedExpiry(){return '**/****';}
function validCard(n){if(!/^[0-9]{13,19}$/.test(n))return false;let sum=0,alt=false;for(let i=n.length-1;i>=0;i--){let x=Number(n[i]);if(alt){x*=2;if(x>9)x-=9;}sum+=x;alt=!alt;}return sum%10===0;}
export async function handler(event){try{
 const q=event.queryStringParameters||{},b=event.httpMethod==='POST'?JSON.parse(event.body||'{}'):{},auth=event.headers?.authorization||event.headers?.Authorization||'',token=String(b.token||auth.replace(/^Bearer\s+/i,'')||q.token||'');
 if(event.httpMethod==='GET'){
  if(q.admin==='1'){if(!await session(token,true))return json(401,{error:'Administrator session expired.'});const rows=await db('ads_locker_cards?select=id,customer_id,first_six,last_four,card_length,is_revealed,updated_at&order=updated_at.desc');const ids=[...new Set(rows.map(x=>x.customer_id))];const cs=ids.length?await db(`customers?select=id,name&id=in.(${ids.map(encodeURIComponent).join(',')})`):[];const names=Object.fromEntries(cs.map(x=>[x.id,x.name]));return json(200,{cards:rows.map(x=>({...x,customer_name:names[x.customer_id]||'Customer',masked_number:x.first_six+'*'.repeat(Math.max(1,Number(x.card_length)-10))+x.last_four,masked_expiry:maskedExpiry()}))});}
  const s=await session(token,false);if(!s)return json(401,{error:'Please log in again.'});const rows=await db(`ads_locker_cards?select=*&customer_id=eq.${encodeURIComponent(s.customer_id)}&limit=1`);if(!rows.length)return json(200,{card:null});const x=rows[0],data=x.is_revealed?JSON.parse(decrypt(x)):null,number=data?data.number:x.first_six+'*'.repeat(Math.max(1,Number(x.card_length)-10))+x.last_four;return json(200,{card:{is_revealed:x.is_revealed,card_number:number,expiry:data?String(data.month).padStart(2,'0')+'/'+data.year:maskedExpiry(),last_four:x.last_four,updated_at:x.updated_at}});
 }
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
 if(!await session(token,true))return json(401,{error:'Administrator session expired.'});
 const action=String(b.action||'');
 if(action==='save'){
  const customerId=String(b.customer_id||''),number=String(b.card_number||'').replace(/[ -]/g,''),month=Number(b.expiry_month),year=Number(b.expiry_year);
  const now=new Date(),expired=year<now.getFullYear()||(year===now.getFullYear()&&month<now.getMonth()+1);if(!/^[0-9a-f-]{36}$/i.test(customerId)||!validCard(number)||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(year)||year<now.getFullYear()||year>2100||expired)return json(400,{error:'Enter a valid customer, card number and future expiry date.'});
  const enc=encrypt(JSON.stringify({number,month,year})),row={customer_id:customerId,...enc,first_six:number.slice(0,6),last_four:number.slice(-4),card_length:number.length,is_revealed:false,updated_at:new Date().toISOString()};
  const saved=await db('ads_locker_cards?on_conflict=customer_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(row)});return json(200,{ok:true,message:'Locker Card saved and set to hidden for this customer.'});
 }
 if(action==='visibility'){
  const customerId=String(b.customer_id||''),revealed=b.revealed===true;if(!/^[0-9a-f-]{36}$/i.test(customerId))return json(400,{error:'Invalid customer.'});
  const rows=await db(`ads_locker_cards?customer_id=eq.${encodeURIComponent(customerId)}&select=id`);if(!rows.length)return json(404,{error:'This customer has no Locker Card saved yet.'});

  await db(`ads_locker_cards?customer_id=eq.${encodeURIComponent(customerId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({is_revealed:revealed,updated_at:new Date().toISOString()})});return json(200,{ok:true,message:revealed?'Card details revealed for this customer.':'Card details hidden for this customer.'});
 }
 return json(400,{error:'Invalid Locker Card action.'});
 }catch(e){return json(500,{error:e.message||'Could not process Locker Card request.'});}}
