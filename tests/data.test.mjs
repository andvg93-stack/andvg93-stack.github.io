import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const readJson = async (name) =>
  JSON.parse(await readFile(new URL(`../public/data/${name}`, import.meta.url), 'utf8'));

test('el paquete territorial cumple los contratos básicos', async () => {
  const municipalities = await readJson('huila-municipios.geojson');
  const frontier = await readJson('cafe-frontier.geojson');
  const snapshots = await readJson('simulation-snapshots.json');
  const manifest = await readJson('model-manifest.json');

  assert.equal(municipalities.features.length, 37);
  assert.equal(snapshots.snapshots.length, 120);
  assert.ok(frontier.features.length > 250);
  assert.equal(manifest.checks.expansionInsideRunap, 0);
  assert.equal(manifest.checks.indicesWithinRange, true);
  assert.equal(snapshots.snapshots[0].date, '2026-01-01');
  assert.equal(snapshots.snapshots.at(-1).date, '2035-12-01');
});

test('todos los índices permanecen entre 0 y 100', async () => {
  const { snapshots } = await readJson('simulation-snapshots.json');
  for (const snapshot of snapshots) {
    for (const key of ['waterIndex', 'soilIndex', 'biodiversityIndex', 'resilienceIndex']) {
      assert.ok(snapshot[key] >= 0 && snapshot[key] <= 100, `${key} fuera de rango`);
    }
  }
});

test('los datos esenciales pesan menos de 8 MB', async () => {
  const directory = new URL('../public/data/', import.meta.url);
  const files = await readdir(directory);
  let bytes = 0;
  for (const file of files) bytes += (await stat(new URL(file, directory))).size;
  assert.ok(bytes < 8 * 1024 * 1024, `Paquete demasiado grande: ${bytes} bytes`);
});

