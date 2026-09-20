import { readFileSync } from 'node:fs';

// Serve terminates HTTPS on the tailnet and proxies to our loopback listener.
// An explicit origin list avoids wildcard Host/Origin trust and DNS rebinding.
export function tailnetOrigins(values:unknown):string[]{
  if(!Array.isArray(values)||values.length>8)throw new Error('tailnetOrigins must be an array of at most 8 HTTPS origins');
  return [...new Set(values.map(value=>{
    if(typeof value!=='string')throw new Error('Invalid tailnet origin');
    const url=new URL(value);
    if(url.protocol!=='https:'||!url.hostname.endsWith('.ts.net')||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Use an exact HTTPS *.ts.net origin without a path');
    return url.origin;
  }))];
}
export function loadAccess(path:URL){
  try{return tailnetOrigins(JSON.parse(readFileSync(path,'utf8')).tailnetOrigins);}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
}
export function allowedRequest(host:string|undefined,origin:string|undefined,site:string|undefined,port:number,remoteOrigins:string[]){
  const origins=[`http://127.0.0.1:${port}`,`http://localhost:${port}`,...remoteOrigins];
  if(!host||!origins.some(o=>new URL(o).host===host))return 'HOST';
  if((origin&&!origins.includes(origin))||site==='cross-site')return 'ORIGIN';
  return null;
}
