import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { Library } from '../src/store.ts';
import { createApp } from '../src/server.ts';
import { tailnetOrigins } from '../src/access.ts';

function raw(url:string,headers:Record<string,string>={},body?:string){return new Promise<{status:number}>((resolve,reject)=>{
  const req=request(url,{method:body?'POST':'GET',headers},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode!}));});req.on('error',reject);req.end(body);
});}

test('Serve origin can load assets and call APIs while foreign hosts/origins and forwarded-header spoofing stay rejected',async()=>{
  const origin='https://machine.example.ts.net:8443',library=new Library(':memory:'),app=createApp(library,[origin]);
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const port=(app.server.address() as {port:number}).port,local=`http://127.0.0.1:${port}`;
  try{
    assert.equal((await raw(local,{host:new URL(origin).host})).status,200);
    const post=(headers:Record<string,string>)=>raw(local+'/api/search',{'content-type':'application/json',...headers},'{}');
    assert.equal((await post({host:new URL(origin).host,origin,'sec-fetch-site':'same-origin'})).status,200);
    // Both backend Host modes are supported; Serve may keep or rewrite it.
    assert.equal((await post({origin})).status,200);
    for(const headers of [{host:'attacker.example',origin},{host:'machine.example.ts.net:9443',origin},{origin:'https://other.example.ts.net:8443'},{origin:'http://machine.example.ts.net:8443'},{origin,'sec-fetch-site':'cross-site'},{host:'attacker.example','x-forwarded-host':new URL(origin).host,'x-forwarded-proto':'https'}])assert.equal((await post(headers)).status,403);
    assert.equal((await raw(local+'/app/access.js',{host:new URL(origin).host})).status,404);
    assert.equal((await raw(local+'/config/access.json',{host:new URL(origin).host})).status,404);
    assert.throws(()=>tailnetOrigins(['https://machine.example.ts.net/path']));assert.throws(()=>tailnetOrigins(['https://evil.example']));
  }finally{app.close();app.server.closeAllConnections();await once(app.server,'close');library.close();}
});
