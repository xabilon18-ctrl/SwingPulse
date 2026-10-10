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
const disk=new Map(),env={USER_DATA:{get:async k=>disk.get(k)??null,put:async(k,v)=>disk.set(k,v)}};
async function put(body){return worker.fetch(new Request('https://worker/sync?user=zabs',{method:'PUT',headers:{Authorization:'Bearer test-token'},body:JSON.stringify(body)}),env);}
assert.equal((await put(old)).status,200);assert.equal((await put(incoming)).status,200);
const stored=JSON.parse(disk.get('zabs'));assert.equal(stored.channels.B.D[0].p1,3);
assert.equal(JSON.parse(disk.get('zabs:prev')).channels.A.D[0].p1,1);
console.log('PASS: authenticated saved-work merging, newer charts and grids, deletion tombstones, retained server backup');
