const assert=require('node:assert/strict');
const ctx=require('../webapp/static/js/modules/trend-context.js');
const row={instrument_name:'X',close:110,ma_500:100};
// Clusters read the 1H setup since 4H was removed (2026-11-04).
function feed(levels,other={}){return {workflow:{'1H':{X:{direction:'UPTREND',setup:{atr:4,price:101,previousClose:99,high:102,low:98,levels,...other}}}}};}
const level=(id,value)=>({id,tf:id[0],value,previous:value});
let channels=feed([level('W250',100),level('M50',100.8)]);
let result=ctx.clusters(row,channels,0.25);
assert.equal(result.zones.length,1,'Weekly + Monthly without Daily qualifies');
assert.equal(result.zones[0].state,'crossed');
assert.equal(result.zones[0].crossTimeframe,true);
assert.equal(ctx.matchesCluster(row,channels,'crossed',0.25),true);
assert.equal(ctx.clusters(row,channels,0.1).zones.length,0,'Tight setting changes membership');
channels=feed([level('D50',100),level('W250',100.8),level('M50',101.6)]);
assert.ok(ctx.clusters(row,channels,0.25).zones.every(z=>z.width<=1),'No chaining into overly broad zone');
channels=feed([level('W250',100),level('M50',100.8)],{price:99,previousClose:98,high:100.5,low:98});
assert.equal(ctx.clusters(row,channels).zones[0].state,'rejected');
assert.equal(ctx.clusters(row,feed([],{atr:null})).available,false);
assert.equal(ctx.matchesCluster(row,{},'any'),false);
channels.workflow['1H'].X.swingDirection='DOWNTREND';
assert.equal(ctx.context(row,channels).h1Relation,'minor','Minor opportunity is allowed before native MA500 crossing');
assert.equal(ctx.clusters(row,{workflow:{'4H':{X:{setup:{atr:4,price:101,levels:[level('W250',100),level('M50',100.8)]}}}}}).available,false,'a 4H setup is no longer read');
console.log('PASS: cross-timeframe clusters, bounded widths, crossings, rejections and minor-swing visibility');
