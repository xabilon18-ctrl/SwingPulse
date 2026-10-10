const assert = require('node:assert/strict');
const live = require('../webapp/static/js/modules/live-prices.js');
const client = require('../webapp/static/js/modules/data-client.js');
(async () => {
  let response={}, failures=0, updates=0;
  const controller=live.create({url:'https://example.test/live',getQuotes:()=>({q:{Bitcoin:{y:'BTC-USD'}}}),getVisibleNames:()=>['Bitcoin'],isActive:()=>true,onUpdate:()=>updates++,onUnavailable:()=>failures++,timeoutMs:5,fetcher:async(_,options)=>{
    if(response==='timeout')return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
    return {ok:response!=='http-error',json:async()=>response};
  }});
  await controller.poll();assert.equal(controller.lastReceivedAt,0);assert.equal(failures,1);
  response='http-error';await controller.poll();assert.equal(controller.lastReceivedAt,0);
  response={'BTC-USD':[123,1000]};await controller.poll();assert.equal(controller.quotes.Bitcoin.p,123);assert.equal(updates,1);
  response={'BTC-USD':[50,900]};await controller.poll();assert.equal(controller.quotes.Bitcoin.p,123,'Older quote must not replace a newer print');
  response='timeout';await controller.poll();assert.equal(controller.busy,false,'Timeout releases polling lock');
  const oldFetch=global.fetch;
  try {
    global.fetch=(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
    await assert.rejects(client.request('https://example.test/data',{},5));
    global.fetch=async()=>({ok:false,status:503});assert.equal(await client.fetchJson('https://example.test/data',null),null);
  }finally{global.fetch=oldFetch;}
  console.log('PASS: quote failures, bounded requests, polling recovery and no timestamp regression');
})().catch(e=>{console.error(e);process.exitCode=1});
