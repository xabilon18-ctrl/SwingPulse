const assert=require('node:assert/strict');
const r=require('../webapp/static/js/modules/chart-readability.js');
assert.deepEqual(r.levels.map(x=>x[1]),['Thin','Medium','Thick']);
assert.equal(7*r.nativeScale(3),7,'original MA thickness remains Thick');
assert.ok(r.nativeScale(1)<r.nativeScale(2)&&r.nativeScale(2)<r.nativeScale(3));
for(const d of [{kind:'channel',weight:2},{kind:'channel',weight:3},{kind:'hline',bold:true},{kind:'entry',bold:false}]) {
 const before=JSON.stringify(d);assert.equal(r.drawingAttrs(d),'','legacy renderer retained');
 assert.equal(JSON.stringify(d),before,'read does not migrate or overwrite saved drawing');
 assert.match(r.drawingAttrs({...d,strokeWeight:1}),/data-stroke="1"/,'explicit Thin overrides old bold');
}
assert.equal(r.drawingLevel({kind:'hline',bold:true}),3);
assert.equal(r.drawingLevel({kind:'channel',weight:2}),2);
const tall=r.ticks(48,73,r.axisTarget(620));
assert.ok(tall.includes(62)&&tall.includes(68),'tall SILVER-sized range gains intermediate prices');
assert.ok(r.ticks(48,73,r.axisTarget(480)).includes(62.5),'medium plot uses 2.5 nice steps');
assert.ok(tall.length>r.ticks(48,73,6).length);
for(const height of [120,200,320,480,620,800,1100]) {
 const levels=r.ticks(48,73,r.axisTarget(height));
 for(let i=1;i<levels.length;i++)assert.ok((levels[i]-levels[i-1])/25*height>=43.9,'safe label spacing');
}
assert.deepEqual(r.ticks(3,3,20),[]);assert.deepEqual(r.ticks(NaN,10,10),[]);
const precise=r.axisLabels(1000,1000.1,20,v=>v.toFixed(0),v=>v,1,NaN);
assert.equal(precise.length,1,'no duplicate labels in tight saved zoom');
const shown=r.axisLabels(50,75,12,String,v=>v*20,1,65);
assert.ok(!shown.includes(65),'current-price badge has clear space');
// Solid MAs since 2026-11-07: heavier with the period, Thin is the default.
assert.ok(r.nativeWidth('fast',1)<r.nativeWidth('mid',1)&&r.nativeWidth('mid',1)<r.nativeWidth('anchor',1),'MA50 < MA250 < MA500');
assert.equal(r.nativeWidth('anchor'),r.nativeWidth('anchor',1),'unset weight is Thin');
for(const role of ['fast','mid','anchor'])assert.ok(r.nativeWidth(role,1)<r.nativeWidth(role,2)&&r.nativeWidth(role,2)<r.nativeWidth(role,3));
// Bold round levels: 85..125 by 5 -> 90,100,110,120; 1..9 by 1 -> 5; 2.5 steps -> 5s.
const bold=(lo,hi,want)=>{const m=r.majorStep(lo,hi,want);return r.ticks(lo,hi,want).filter(v=>r.isMajor(v,m));};
assert.deepEqual(bold(84,126,9),[90,100,110,120]);assert.deepEqual(bold(84,126,4),[100],"10 steps bold the 50s");
assert.deepEqual(bold(0.5,9.5,9),[5]);
assert.deepEqual(bold(48,73,10),[50,55,60,65,70]);
assert.ok(bold(0.0091,0.0109,9).includes(0.01),'float-safe on small prices');
console.log('PASS: solid MA weights, bold round levels, native maximum, three weights, legacy preservation, 2.5 ticks, responsive density, precision and badge spacing');
