import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {mergeSavedWork} from '../src/saved-work-store.js';
const old={lastModified:100,notes:{A:'note'},channels:{A:{D:[{p1:1}],'1H':[{p1:2}]},B:{D:[{p1:3}]}},channelsMod:{'A|D':20,'A|1H':30,'B|D':50},chartPrefs:{version:1,grids:{D:{division:'Y',modifiedAt:25}}},watchlists:{lists:[],mod:30}};
const incoming={lastModified:110,channels:{A:{D:[{p1:9}],'1H':[{p1:7}]}},channelsMod:{'A|D':40,'A|1H':10},chartPrefs:{grids:{'4H':{division:'Q',modifiedAt:60},D:{division:'M',modifiedAt:10}}}};
const merged=mergeSavedWork(old,incoming);
assert.equal(merged.channels.A.D[0].p1,9);assert.equal(merged.channels.A['1H'][0].p1,2);
assert.equal(merged.channels.B.D[0].p1,3,'A save from one device preserves other charts');
assert.equal(merged.chartPrefs.grids.D.division,'Y');assert.equal(merged.chartPrefs.grids['4H'].division,'Q');
const deleted=mergeSavedWork(merged,{lastModified:120,channels:{A:{D:[]}},channelsMod:{'A|D':70}});
assert.deepEqual(deleted.channels.A.D,[]);
assert.deepEqual(mergeSavedWork(deleted,incoming).channels.A.D,[],'Older device cannot resurrect a deleted drawing');
const stale=mergeSavedWork(old,{lastModified:10,notes:{A:'older'},watchlists:{lists:[],mod:10}});
assert.equal(stale.notes.A,'note');assert.equal(stale.watchlists.mod,30);
// Exercise the actual authenticated handler and retained backup.
const disk=new Map(),env={USER_DATA:{get:async k=>disk.get(k)??null,put:async(k,v)=>disk.set(k,v),delete:async k=>disk.delete(k),list:async({prefix})=>({keys:[...disk.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name}))})}};
async function put(body){return worker.fetch(new Request('https://worker/sync?user=zabs',{method:'PUT',headers:{Authorization:'Bearer test-token'},body:JSON.stringify(body)}),env);}
// A device signs in (and so claims the account) before it syncs.
assert.equal((await worker.fetch(new Request('https://worker/sync/auth?user=zabs',{method:'POST',headers:{Authorization:'Bearer test-token'}}),env)).status,200);
assert.equal((await put(old)).status,200);assert.equal((await put(incoming)).status,200);
const stored=JSON.parse(disk.get('zabs'));assert.equal(stored.channels.B.D[0].p1,3);
assert.equal(JSON.parse(disk.get('zabs:prev')).channels.A.D[0].p1,1);
const stockEdit={chartPrefs:{version:2,stockGrids:{'4H':{division:'M',modifiedAt:300}}}};
const indexEdit={chartPrefs:{version:2,indexGrids:{'4H':{division:'H',modifiedAt:400}}}};
await put(stockEdit);await put(indexEdit);await put(incoming);
const groups=JSON.parse(disk.get('zabs')).chartPrefs;
assert.equal(groups.version,2);
assert.equal(groups.stockGrids['4H'].division,'M','Legacy clients preserve newer stock choices');
assert.equal(groups.indexGrids['4H'].division,'H','Independent index edits survive another device');
assert.equal(groups.grids['4H'].division,'Q');
assert.equal(mergeSavedWork({chartPrefs:groups},{chartPrefs:{stockGrids:{'4H':{division:'Y',modifiedAt:20}}}}).chartPrefs.stockGrids['4H'].division,'M');
// Energy and the other markets split out of 'grids' (2026-10-21) are kept, and
// a client that predates them (no energyGrids) cannot drop them.
const energy=mergeSavedWork({chartPrefs:groups},{chartPrefs:{version:2,energyGrids:{'4H':{division:'Y',modifiedAt:500}},cryptoGrids:{'4H':{division:'M',modifiedAt:500}}}}).chartPrefs;
assert.equal(energy.energyGrids['4H'].division,'Y');assert.equal(energy.cryptoGrids['4H'].division,'M');
assert.equal(mergeSavedWork({chartPrefs:energy},incoming).chartPrefs.energyGrids['4H'].division,'Y','Older clients preserve energy choices');
assert.deepEqual(mergeSavedWork({chartPrefs:{version:1,grids:{D:{division:'Y',modifiedAt:1}}}},{}).chartPrefs.energyGrids,{},'Split markets read grids at use, no copy');
// The Term division (Weekly/Monthly, 2026-10-19) survives the server merge.
assert.equal(mergeSavedWork({},{chartPrefs:{version:2,grids:{W:{division:'T',modifiedAt:5}}}}).chartPrefs.grids.W.division,'T');
// Notes merge note by note (review finding 2026-10-17: a stale device wiped
// another device's note edit because the newest whole notes map won).
const n0={lastModified:100,notes:{A:'phone edit',B:'old'},notesMod:{A:200}};
const laptop=mergeSavedWork(n0,{lastModified:300,notes:{A:'stale laptop copy',C:'laptop note'},notesMod:{A:150,C:290}});
assert.equal(laptop.notes.A,'phone edit','A newer stamp on the server is never overwritten by an older one');
assert.equal(laptop.notes.C,'laptop note');
assert.equal(laptop.notes.B,'old','A note the device has not loaded is not a deletion');
const gone=mergeSavedWork(laptop,{lastModified:310,notes:{},notesMod:{A:400}});
assert.equal(gone.notes.A,undefined,'A stamped absence is a deletion');
assert.equal(mergeSavedWork(gone,{lastModified:320,notes:{A:'resurrected'},notesMod:{A:390}}).notes.A,undefined,
  'An older device cannot resurrect a deleted note');
const legacy=mergeSavedWork(laptop,{lastModified:999,notes:{B:'legacy edit'}});
assert.equal(legacy.notes.B,'legacy edit','A cached older app still saves unstamped notes');
assert.equal(legacy.notes.A,'phone edit','but cannot erase stamped ones');
assert.equal(mergeSavedWork(laptop,{lastModified:999}).notes.C,'laptop note','A save without notes keeps them');
assert.ok(!Object.hasOwn(mergeSavedWork({},{notes:{constructor:'bad'},notesMod:{constructor:5}}).notes,'constructor'),'Prototype keys are refused');
for(const division of ['Y5','Y10'])assert.equal(mergeSavedWork({},{chartPrefs:{version:2,grids:{M:{division,modifiedAt:5}}}}).chartPrefs.grids.M.division,division,'Monthly five and ten years sync');
console.log('PASS: authenticated saved-work merging, newer charts and grids, deletion tombstones, retained server backup');
