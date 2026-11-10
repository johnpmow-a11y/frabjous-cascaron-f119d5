import { randomBytes } from 'node:crypto';
export async function createDeliveryOrder({supabase,serviceKey,reference,customerId,amountKobo,details}){
 const q=`${supabase}/rest/v1/ads_delivery_orders?select=id,tracking_code&payment_reference=eq.${encodeURIComponent(reference)}&limit=1`;
 const existing=await fetch(q,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}});
 if(!existing.ok)throw new Error('Could not check gift delivery order.');
 const prior=await existing.json();if(prior.length)return prior[0].tracking_code;
 const tracking='ADM-'+randomBytes(8).toString('hex').toUpperCase();
 const row={payment_reference:reference,customer_id:customerId,tracking_code:tracking,recipient_name:details.recipient_name,recipient_phone:details.recipient_phone,destination_country:details.country,destination_region:details.region,delivery_address:details.address,item:details.item,delivery_speed:details.delivery_speed,amount_kobo:amountKobo,status:'processing'};
 const r=await fetch(`${supabase}/rest/v1/ads_delivery_orders`,{method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify([row])});
 if(!r.ok){const e=await r.json().catch(()=>({}));if(e.code==='23505')return tracking;throw new Error(e.message||'Could not create gift delivery order.');}const saved=await r.json();return saved?.[0]?.tracking_code||tracking;
}
