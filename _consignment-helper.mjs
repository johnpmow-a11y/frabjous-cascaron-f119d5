export async function createConsignmentJob({supabase,serviceKey,reference,customerId,details,paidAt}){
 if(!details||!['Gold Bar','Other'].includes(details.goods_type)||!String(details.customer_full_name||'').trim()||String(details.home_address||'').trim().length<8||!/^\d{4}-\d{2}-\d{2}$/.test(String(details.date_of_birth||''))||!String(details.country_name||'').trim()||! /^[A-Z]{3,8}$/.test(String(details.currency_code||''))||!Array.isArray(details.items)||details.items.length<1||details.items.length>12||!String(details.photo_path||'').startsWith(`consignment-photos/${customerId}/`)||String(details.photo_path).includes('..'))throw new Error('Consignment details are incomplete or invalid.');
 if(details.goods_type==='Gold Bar'&&(!Number.isInteger(Number(details.gold_quantity))||Number(details.gold_quantity)<1||Number(details.gold_quantity)>10))throw new Error('Gold bar quantity must be from 1 to 10.');
 if(details.goods_type==='Other'&&!String(details.goods_other||'').trim())throw new Error('Please describe the other goods.');
 const q=`${supabase}/rest/v1/service_payments?select=details,status,customer_id,paid_at&reference=eq.${encodeURIComponent(reference)}&service=eq.${encodeURIComponent('Create Your Consignment Box Video')}&limit=1`;
 const check=await fetch(q,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}});if(!check.ok)throw new Error('Could not check the consignment payment.');const rows=await check.json();if(!rows.length||rows[0].customer_id!==customerId||rows[0].status!=='paid')throw new Error('Verified consignment payment not found.');
 let saved={};try{saved=JSON.parse(rows[0].details||'{}')}catch{}
 if(saved.processing_status)return;
 const paidTime=paidAt||rows[0].paid_at||new Date().toISOString();
 const updated={...details,processing_status:'processing',paid_at:paidTime,available_at:new Date(new Date(paidTime).getTime()+5*60*60*1000).toISOString()};
 const r=await fetch(`${supabase}/rest/v1/service_payments?reference=eq.${encodeURIComponent(reference)}&status=eq.paid`,{method:'PATCH',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({details:JSON.stringify(updated)})});
 if(!r.ok)throw new Error('Could not start the five-hour consignment processing job.');
}
