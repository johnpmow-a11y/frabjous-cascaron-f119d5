import nodemailer from "nodemailer";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

const json=(statusCode,payload)=>({statusCode,headers:{
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store",
  "Access-Control-Allow-Origin":process.env.URL?`https://${new URL(process.env.URL).host}`:"*",
  "Access-Control-Allow-Headers":"Content-Type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
},body:JSON.stringify(payload)});

async function db(path,options={}) {
  const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!key)throw new Error("Password recovery database is not configured.");
  const response=await fetch(`${base}/rest/v1/${path}`,{...options,headers:{
    apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json",
    ...(options.headers||{})
  }});
  const raw=await response.text();let data;try{data=raw?JSON.parse(raw):null}catch{data=raw}
  if(!response.ok)throw new Error(data?.message||data?.hint||"Password recovery database request failed.");
  return data;
}
function digest(code,key){return createHmac("sha256",key).update(String(code)).digest("hex");}
function validUsername(value){return /^[A-Za-z0-9_. -]{2,40}$/.test(String(value||"").trim());}
async function sendCode(to,code,name){
  const user=process.env.GMAIL_USER,pass=process.env.GMAIL_APP_PASSWORD;
  if(!user||!pass)throw new Error("The existing Gmail email settings are not configured.");
  const transporter=nodemailer.createTransport({service:"gmail",auth:{user,pass:String(pass).replace(/\\s+/g,"")}});
  await transporter.sendMail({
    from:{name:"All Ads Manager Account Security",address:user},
    to,subject:"All Ads Manager — Your password reset code",
    text:`Hello ${name||"Customer"},

Your All Ads Manager password reset code is: ${code}

This code expires in 10 minutes and can only be used once. If you did not request this reset, ignore this email. Never share this code with anyone.

All Ads Manager Support`
  });
}
export async function handler(event){
  if(event.httpMethod==="OPTIONS")return json(204,{});
  if(event.httpMethod!=="POST")return json(405,{ok:false,error:"Use POST."});
  let body;try{body=JSON.parse(event.body||"{}")}catch{return json(400,{ok:false,error:"Invalid request."})}
  const action=String(body.action||""),username=String(body.username||"").trim();
  if(!validUsername(username))return json(400,{ok:false,error:"Enter the username used for your account."});
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key)return json(500,{ok:false,error:"Password recovery is not configured."});
  try{
    const customers=await db(`customers?select=id,name&name=ilike.${encodeURIComponent(username)}&limit=1`);
    const customer=customers?.[0];
    if(action==="request"){
      if(customer){
        const emails=await db(`customer_contact_emails?select=email&customer_id=eq.${encodeURIComponent(customer.id)}&limit=1`);
        const email=emails?.[0]?.email;
        if(email){
          const previous=await db(`customer_password_reset_requests?select=created_at&customer_id=eq.${encodeURIComponent(customer.id)}&limit=1`);
          const last=previous?.[0]?.created_at?Date.parse(previous[0].created_at):0;
          if(!last||Date.now()-last>=60000){
            const code=String(randomInt(100000,1000000));
            const expires=new Date(Date.now()+10*60*1000).toISOString();
            await db("customer_password_reset_requests?on_conflict=customer_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify([{customer_id:customer.id,otp_hash:digest(code,key),expires_at:expires,attempts:0,created_at:new Date().toISOString()}])});
            await sendCode(email,code,customer.name);
          }
        }
      }
      return json(200,{ok:true,message:"If this username has a registered email address, a reset code has been sent. Check your inbox and spam folder."});
    }
    if(action==="complete"){
      const otp=String(body.otp||"").trim(),newCode=String(body.newCode||"");
      if(!/^\\d{6}$/.test(otp))return json(400,{ok:false,error:"Enter the six-digit reset code sent to your email."});
      if(!/^\\d{4}$/.test(newCode))return json(400,{ok:false,error:"Your new security code must contain exactly four digits."});
      if(!customer)return json(400,{ok:false,error:"The reset code is incorrect or expired. Request a new code."});
      const rows=await db(`customer_password_reset_requests?select=otp_hash,expires_at,attempts&customer_id=eq.${encodeURIComponent(customer.id)}&limit=1`);
      const reset=rows?.[0];
      if(!reset||Date.parse(reset.expires_at)<=Date.now()||Number(reset.attempts)>=5)return json(400,{ok:false,error:"The reset code is incorrect or expired. Request a new code."});
      const expected=Buffer.from(String(reset.otp_hash),"hex"),actual=Buffer.from(digest(otp,key),"hex");
      if(expected.length!==actual.length||!timingSafeEqual(expected,actual)){
        await db(`customer_password_reset_requests?customer_id=eq.${encodeURIComponent(customer.id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({attempts:Number(reset.attempts)+1})});
        return json(400,{ok:false,error:"The reset code is incorrect or expired. Check the code and try again."});
      }
      const result=await db("rpc/bt_customer_password_reset_complete",{method:"POST",body:JSON.stringify({p_customer_id:customer.id,p_new_code:newCode})});
      return json(200,{ok:true,session:result,message:"Your security code has been changed successfully."});
    }
    return json(400,{ok:false,error:"Unsupported password recovery action."});
  }catch(error){
    console.error("All Ads Manager password recovery:",error?.message||error);
    return json(500,{ok:false,error:"We could not complete password recovery. Please try again later."});
  }
}
