import { registerHooks } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    try { return nextResolve(`${specifier}.ts`, context); } catch {}
  }
  return nextResolve(specifier, context);
} });
const { TileStore, decodeTile } = await import('../src/refine/tiles.ts');
const { findGroup, binFor } = await import('../src/refine/groups.ts');
const { ApiError } = await import('../src/api/errors.ts');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const tile = (r,c) => ({tileRow:r,tileCol:c,originRow:r,originCol:c,rows:1,cols:1,values:'1',tremor:btoa(String.fromCharCode(80)),bins:'.',version:1});
const rules = {tremorThreshold:70,connectivity:4,minGroupSize:2,maxGroupSize:4,binning:{strategy:'DIGIT_SUM_MOD',order:['WO','FC','DR','MA']}};

test('tile decoding rejects malformed lengths', () => {
  assert.throws(() => decodeTile({...tile(0,0), values:'12'}));
  assert.equal(decodeTile(tile(0,0)).tremor[0],80);
});

test('concurrent tile consumers share a request; BFS crosses tiles', async () => {
  let requests=0;
  const store = new TileStore({rows:1,cols:3,tileSize:1,fetchTile:async(r,c)=>{requests++;await pause(5);return tile(r,c);}});
  try {
    await Promise.all([store.load(0,0),store.load(0,0)]);
    assert.equal(requests,1);
    const group=await findGroup(store,rules,{r:0,c:0},new AbortController().signal);
    assert.equal(group.size,3);assert.equal(group.bin,'MA');assert.equal(requests,3);
  } finally {store.suspend();}
});

test('bin selection follows strategy and server ordering', () => {
  assert.equal(binFor(6,3,rules),'DR');
  assert.equal(binFor(6,3,{...rules,binning:{strategy:'MAX_DIGIT_MOD',order:['MA','DR','FC','WO']}}),'WO');
});

test('429 cooldown applies when switching files', async () => {
  let firstRequests=0, secondRequests=0;
  const first=new TileStore({rows:1,cols:1,tileSize:1,fetchTile:async()=>{firstRequests++;throw new ApiError({status:429,code:'RATE_LIMITED',message:'wait',retryAfterMs:500});}});
  const second=new TileStore({rows:1,cols:1,tileSize:1,fetchTile:async(r,c)=>{secondRequests++;return tile(r,c);}});
  try {
    first.setWanted(['0:0']);await pause(180);assert.equal(firstRequests,1);
    first.suspend();second.setWanted(['0:0']);await pause(180);
    assert.equal(secondRequests,0,'new file must respect session cooldown');
    await pause(450);assert.equal(secondRequests,1,'request resumes after cooldown');
  } finally {first.suspend();second.suspend();}
});
