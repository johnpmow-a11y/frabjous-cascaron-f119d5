const json=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(b)});
export async function handler(event){if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});return json(501,{error:'Rediprofiles admin order lookup is not enabled until its official order API is verified.'})}
