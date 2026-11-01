const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../webapp/static/js/app.js'),'utf8');
const fn=name=>{const a=source.indexOf('  function '+name+'(');assert.ok(a>=0,name);return source.slice(a,source.indexOf('\n  }\n',a)+4);};
const c=vm.createContext({timeframe:'D',reel:{tzoom:new Map(),pan:new Map(),lockY:new Map()},savedViews:{},
 REEL_MIN_WINDOW_BARS:10,REEL_FUTURE_FRAC:.9,REEL_Y_ZOOM_MAX:24,REEL_EXTRAP_BARS:100,
 reelRange:()=>0,reelStockView:()=>null,reelDefaultBars:()=>520,reelRightPadBars:()=>12,bundleLastClose:b=>b.c.at(-1),viewKey:n=>n+'|D'});
for(const name of ['reelSlice','reelMaxBars','reelViewportSlice','reelWindowBars','reelPanOf','reelSetPan','reelParseTs','reelBarTimes',
 'reelBarIndexForDate','reelDateForBarIndex','reelDefaultEntry','reelViewCapture','reelViewSeedTime','reelZoomLimitHint','reelApplyTZoom','reelApplyPinch']) vm.runInContext(fn(name),c);
const n=1000,ts=Array.from({length:n},(_,i)=>new Date(Date.UTC(2023,0,1)+i*864e5).toISOString().slice(0,10));
const bundle={t:ts,o:ts.map((_,i)=>100+i),h:ts.map((_,i)=>102+i),l:ts.map((_,i)=>99+i),c:ts.map((_,i)=>101+i),
 p:[50,250,500],mi:[0,100,500,999],m:[[100,200,600,1099],[90,190,590,1089],[80,180,580,1079]]};
const pristine=JSON.stringify(bundle),host={getBoundingClientRect:()=>({width:1000}),closest:()=>false};
const ctx={bundle,name:'GOLD',sc:{lo:50,hi:1200},L:{},plotPx:700};
assert.equal(c.reelWindowBars(bundle,'GOLD'),520,'opening unchanged');
c.reel.tzoom.set('GOLD',n);
assert.equal(c.reelApplyTZoom(host,ctx,{bars:n},900*Math.log(2)),true);
assert.equal(c.reelWindowBars(bundle,'GOLD'),2000,'zoom continues beyond all loaded candles');
let b=c.reelViewportSlice(bundle,2000,0);
assert.equal(b.c.length,n);assert.equal(b._from,-1000);assert.equal(b._lead,1000);
assert.equal(b.c[0],bundle.c[0]);assert.equal(b.c.at(-1),bundle.c.at(-1));
assert.equal(c.reelBarIndexForDate(b,ts[500]),1500,'date anchored drawing follows the corresponding real candle');
assert.equal(c.reelDateForBarIndex(b,1500),ts[500]);
const entry=c.reelDefaultEntry(b);assert.equal(entry.t,ts[750]);assert.equal(entry.t2,ts[850],'new entry marker remains on real candles after compression');
const emptyDate=c.reelDateForBarIndex(b,10);
assert.ok(Math.abs(c.reelBarIndexForDate(b,emptyDate)-10)<.001,'drawing anchors round trip in empty slots');
for(let i=0;i<12;i++)c.reelApplyTZoom(host,ctx,{bars:c.reelWindowBars(bundle,'GOLD')},900);
assert.equal(c.reelWindowBars(bundle,'GOLD'),8000,'bounded after repeated compression');
c.reelApplyTZoom(host,ctx,{bars:8000},-200);assert.ok(c.reelWindowBars(bundle,'GOLD')<8000,'reverse immediately leaves stop');
for(const width of [10,100,1000,2000,8000]){
 c.reel.tzoom.set('GOLD',width);
 for(const pan of [-1e6,-width*.5,0,1e6]){
  c.reelSetPan('GOLD',pan,bundle);const v=c.reelViewportSlice(bundle,width,c.reelPanOf('GOLD',bundle));
  assert.ok(v.c.length>=Math.min(2,n),'never pan away from all real history');
  assert.ok(v._lead+v.c.length<=width+1,'real candles remain within viewport');
  for(let i=0;i<v.c.length;i+=77) assert.ok(Math.abs(c.reelBarIndexForDate(v,v.t[i])-(i+v._lead))<1e-6);
 }
}
c.reel.tzoom.set('GOLD',2400);c.reelSetPan('GOLD',-400,bundle);
ctx.b=c.reelViewportSlice(bundle,2400,c.reelPanOf('GOLD',bundle));host._reelCtx=ctx;
const saved=c.reelViewCapture(host);assert.equal(saved.lead,1000);c.savedViews['GOLD|D']=saved;
c.reel.tzoom.clear();c.reel.pan.clear();c.reelViewSeedTime('GOLD',bundle);
assert.equal(c.reelWindowBars(bundle,'GOLD'),2400);assert.equal(c.reelPanOf('GOLD',bundle),-400);
assert.equal(c.reelViewportSlice(bundle,2400,-400)._lead,1000);
// Legacy v2 frames without leading blank space keep their first real date.
c.savedViews['GOLD|D']={v:2,start:ts[200],slots:500,lo:50,hi:1200};c.reel.tzoom.clear();c.reel.pan.clear();c.reelViewSeedTime('GOLD',bundle);
assert.equal(c.reelViewportSlice(bundle,500,c.reelPanOf('GOLD',bundle)).t[0],ts[200]);
c.reel.tzoom.set('GOLD',1000);c.reelApplyPinch(host,ctx,{bars:1000,dx0:200,dy0:0},[{x:0,y:0},{x:100,y:0}]);
assert.equal(c.reelWindowBars(bundle,'GOLD'),2000,'phone horizontal pinch has same enlarged extent');
assert.equal(c.reel.lockY.size,0,'horizontal pinch does not change price scale');
c.reelApplyTZoom(host,ctx,{bars:2000},NaN);assert.equal(c.reelWindowBars(bundle,'GOLD'),2000);
const geometry=require('../webapp/static/js/modules/grid-geometry.js');
b=c.reelViewportSlice(bundle,8000,0);
const grid=geometry.timeGrid(b,'D',{barTimes:c.reelBarTimes,getDivision:()=>({parts:1,code:'Y'})});
assert.ok(grid.some(g=>g.fi>0&&g.fi<1000),'date guides reach leading empty time slots');
assert.equal(JSON.stringify({...bundle,_bt:undefined}),pristine,'no history download, padding or mutation');
console.log('PASS: bounded virtual time extent, repeated zoom/reversal, pan, date anchors, saved/legacy views, phone pinch and extended grid');
