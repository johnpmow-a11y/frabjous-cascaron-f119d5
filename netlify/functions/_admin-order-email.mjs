import nodemailer from 'nodemailer';

const ADMIN_INBOX = 'trustdansan@gmail.com';

export async function sendAdminOrderEmail({customerName='Customer',customerId='',service='Customer order',details='',amount=null,reference='',status='Order submitted',pictures=[]}) {
  const user=process.env.GMAIL_USER;
  const password=process.env.GMAIL_APP_PASSWORD;
  if(!user||!password) throw new Error('Existing Gmail settings are not configured.');
  const detailText=typeof details==='string'?details:JSON.stringify(details??{},null,2);
  const text=[
    'ALL ADS MANAGER — CUSTOMER ORDER',
    '',
    'Status: '+String(status),
    'Customer: '+String(customerName),
    'Customer ID: '+String(customerId),
    'Service: '+String(service),
    'Amount: '+(Number.isFinite(Number(amount))?'₦'+Number(amount).toLocaleString('en-NG'):'Not provided'),
    'Payment / order reference: '+String(reference||'Not assigned'),
    '',
    'CUSTOMER SUBMITTED INFORMATION',
    detailText.slice(0,12000)
  ].join('\n');
  const transporter=nodemailer.createTransport({
    service:'gmail',
    auth:{user,pass:String(password).replace(/\s+/g,'')}
  });
  await transporter.sendMail({
    from:{name:'All Ads Manager — Order Alerts',address:user},
    to:ADMIN_INBOX,
    subject:'All Ads Manager: '+String(status)+' — '+String(service),
    text,
    attachments:(Array.isArray(pictures)?pictures.slice(0,3):[]).map((picture,index)=>{const match=String(picture?.data||'').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);if(!match)return null;const filename=String(picture.name||'ad-attachment-'+(index+1)+'.jpg').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100);return {filename,content:match[1],encoding:'base64',contentType:'image/jpeg'};}).filter(Boolean)
  });
  return true;
}
