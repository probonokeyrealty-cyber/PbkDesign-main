import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

const busUrl = new URL('./event-bus/streams.mjs', import.meta.url).href;
const factoryUrl = new URL('./redis-client.mjs', import.meta.url).href;
function run(source) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

test('disabled and memory event buses never load the Redis SDK', () => {
  run(`import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    registerHooks({resolve(s,c,next){if(s==='redis')throw Error('Disabled bus eagerly loaded Redis');return next(s,c);}});
    process.env.PBK_REDIS_URL='redis://sample.invalid';
    const {createEventBus,publishEvent}=await import(${JSON.stringify(busUrl)});
    for(const mode of ['disabled','memory']){
      const bus=createEventBus({mode,redisUrl:'redis://sample.invalid'});
      const result=await publishEvent('lead.created',{leadId:'sample-only'},'sample-only',{bus});
      if(mode==='disabled'){
        assert.equal(result.result,'event_bus_disabled');
        assert.equal(result.skipped,true);
        assert.equal(bus.memoryQueue.length,0);
      }else{
        assert.equal(result.ok,true);
        assert.equal(result.mode,'memory');
        assert.equal(bus.memoryQueue.length,1);
        assert.deepEqual(bus.memoryQueue[0].payload,{leadId:'sample-only'});
        assert.equal(bus.memoryQueue[0].source,'sample-only');
        assert.equal(bus.memoryQueue[0].id,result.eventId);
      }
    }`);
});

test('bridge and event bus use the same deferred synchronous client factory', () => {
  for (const [file, relative] of [['openclaw-local-server.mjs', './redis-client.mjs'], ['event-bus/streams.mjs', '../redis-client.mjs']]) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(source.includes(`import { createRedisClient } from '${relative}';`));
    assert.doesNotMatch(source, /import\s+[^;]+\s+from\s+['"]redis['"]/);
  }
});

test('factory loads Redis once on demand and forwards options without connecting', () => {
  run(`import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    let resolutions=0, loads=0;
    const fixture=${JSON.stringify(new URL('./fixtures/redis-client-load-fixture.cjs', import.meta.url).href)};
    registerHooks({
      resolve(s,c,next){if(s==='redis'){resolutions++;return {url:fixture,shortCircuit:true};}return next(s,c);},
      load(u,c,next){if(u===fixture){loads++;return {format:'commonjs',source:'module.exports={createClient:options=>({options,connected:false})}',shortCircuit:true};}return next(u,c);}
    });
    const {createRedisClient}=await import(${JSON.stringify(factoryUrl)});
    assert.equal(resolutions,0);assert.equal(loads,0);
    const options={url:'redis://sample.invalid',disableOfflineQueue:true,socket:{reconnectStrategy:false}};
    const first=createRedisClient(options), second=createRedisClient(options);
    assert.equal(first.options,options);assert.equal(second.options,options);
    assert.equal(first.connected,false);assert.equal(loads,1);
    assert.ok(first && typeof first.then==='undefined','Factory remains synchronous');`);
});

test('client construction failures propagate instead of reporting a healthy fallback', () => {
  run(`import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    registerHooks({resolve(s,c,next){if(s==='redis')throw Error('Sample SDK load failure');return next(s,c);}});
    const {createRedisClient}=await import(${JSON.stringify(factoryUrl)});
    assert.throws(()=>createRedisClient({}),/Sample SDK load failure/);`);
});

test('full isolated bridge starts without loading disabled Redis under the original deadline', async () => {
  const bridge = await startIsolatedBridge({
    entry: fileURLToPath(new URL('./fixtures/bridge-smoke-disabled-redis-probe.mjs', import.meta.url)),
  });
  try {
    const response = await bridge.fetch(bridge.origin + '/health');
    assert.equal(response.status, 200);
    await response.body.cancel();
  } finally { await bridge.stop(); }
});
