import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('warmed musical analysis: bounded quantum cost and heap, reusable feature storage', t => {
  const result = JSON.parse(execFileSync(process.execPath, ['--expose-gc', 'scripts/analysis-benchmark.js'], { encoding: 'utf8' }));
  t.diagnostic(JSON.stringify(result));
  assert.ok(result.averageMs < .15, `average ${result.averageMs} ms`);
  assert.ok(result.maxMs < 128 / 48000 * 1000, `quantum ${result.maxMs} ms`);
  assert.equal(result.spikes, 0, 'no quantum over 0.5 ms after warm-up');
  assert.ok(result.retainedGrowth < 128 * 1024, `retained heap ${result.retainedGrowth}`);
  assert.ok(result.peakGrowth < 128 * 1024, `transient heap ${result.peakGrowth}`);
  assert.equal(result.sampledAllocationBytes, 0, 'no sampled analysis allocations after warm-up, including collected objects');
  assert.equal(result.reused, true);
});
