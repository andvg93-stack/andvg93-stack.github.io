import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { prepareSurface, surfacePaths } from '../lib/simulation/frontier-surface.ts';

const data = { origin: [0, 0], step: 0.01, nodes: [
  [2, 2, -1, 5.4], [3, 2, -1, 999], [4, 2, 2.3, 999], [5, 2, 2.7, 999], [30, 30, 2.5, 999],
] };

test('contours join neighbors, retain distant islands and have no expansion at baseline', () => {
  const mesh = prepareSurface(data);
  assert.equal(mesh.chunks.length, 2);
  const initial = surfacePaths(mesh, 0);
  assert.equal(initial.expansion, '');
  assert.equal(initial.retired, '');
  assert.equal(initial.persistent.match(/M/g).length, 1);
  const future = surfacePaths(mesh, 3);
  assert.equal(future.expansion.match(/M/g).length, 2);
});

test('fractional time changes the advancing edge and seeking restores exact geometry', () => {
  const mesh = prepareSurface(data);
  const a = surfacePaths(mesh, 2.29);
  const b = surfacePaths(mesh, 2.31);
  assert.notEqual(a.expansion, b.expansion);
  surfacePaths(mesh, 7);
  assert.deepEqual(surfacePaths(mesh, 2.29), a);
  assert.notEqual(surfacePaths(mesh, 5.39).retired, surfacePaths(mesh, 5.41).retired);
});

test('cached quiet intervals equal a cold calculation after an event', () => {
  const mesh = prepareSurface(data);
  surfacePaths(mesh, 2);
  surfacePaths(mesh, 5);
  for (const month of [7, 3.2, 1, 5.5, 119, 0]) {
    assert.deepEqual(surfacePaths(mesh, month), surfacePaths(prepareSurface(data), month));
  }
});

test('real mesh contains finite, unique nodes and preserves the reference outline', () => {
  const source = JSON.parse(readFileSync(new URL('../public/data/frontier-surface.json', import.meta.url)));
  assert.equal(new Set(source.nodes.map(([x,y]) => `${x}:${y}`)).size, source.nodes.length);
  assert.ok(source.nodes.every((node) => node.every(Number.isFinite)));
  const mesh = prepareSurface(source);
  const baseline = surfacePaths(mesh, 0, true).persistent;
  const final = surfacePaths(mesh, 119);
  assert.ok(final.expansion && final.retired);
  assert.equal(surfacePaths(mesh, 119, true).persistent, baseline);
  assert.ok(!Object.values(final).join('').includes('NaN'));
});
