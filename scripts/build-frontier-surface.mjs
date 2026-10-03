/** Visual mesh only. Does not change model hectares, indicators or source data. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { monthAtProgress } from '../lib/simulation/temporal-progress.mjs';

const read = (name) => JSON.parse(readFileSync(`public/data/${name}`, 'utf8'));
const municipalities = read('huila-municipios.geojson').features;
const protectedAreas = read('huila-areas-protegidas.geojson').features;
const features = read('cafe-frontier.geojson').features;
const step = 0.0018;
const origin = [-76.72, -3.94];
const width = Math.ceil(2.4 / step) + 1;
const ringContains = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
const prepare = (feature) => {
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const points = polygons.flat(2);
  return { polygons, bounds: points.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]) };
};
const contains = (shape, x, y) => x >= shape.bounds[0] && y >= shape.bounds[1] && x <= shape.bounds[2] && y <= shape.bounds[3] && shape.polygons.some((p) => ringContains(x, y, p[0]) && !p.slice(1).some((r) => ringContains(x, y, r)));
const protectedShapes = protectedAreas.map(prepare);
const municipalitiesByName = new Map(municipalities.map((f) => [f.properties.MpNombre, prepare(f)]));
const occupied = new Map();
const byMunicipality = new Map();
const key = (x, y) => y * width + x;
const point = (x, y) => [origin[0] + x * step, -(origin[1] + y * step)];

// Correlated, stationary variation creates broad lobes and narrow indentations.
// This is illustrative texture, not a DEM or a measured land-cover surface.
const cost = (x, y) => 1.4 + 0.55 * Math.sin(x * 0.29 + Math.sin(y * 0.13) * 2) + 0.5 * Math.cos(y * 0.23 - x * 0.11);
class Heap {
  items = [];
  push(value) {
    let i = this.items.length; this.items.push(value);
    while (i > 0) { const p = (i - 1) >> 1; if (this.items[p].cost <= value.cost) break; this.items[i] = this.items[p]; i = p; }
    this.items[i] = value;
  }
  pop() {
    const first = this.items[0], last = this.items.pop();
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let c = i * 2 + 1;
        if (c + 1 < this.items.length && this.items[c + 1].cost < this.items[c].cost) c++;
        if (this.items[c].cost >= last.cost) break;
        this.items[i] = this.items[c]; i = c;
      }
      this.items[i] = last;
    }
    return first;
  }
}
const sorted = [...features].sort((a, b) => a.properties.startMonth - b.properties.startMonth || a.properties.id.localeCompare(b.properties.id));
let unplaced = 0;
for (const feature of sorted) {
  const p = feature.properties;
  const ring = feature.geometry.coordinates[0].slice(0, -1);
  const cx = ring.reduce((s, v) => s + v[0], 0) / ring.length;
  const cy = -ring.reduce((s, v) => s + v[1], 0) / ring.length;
  const tx = Math.round((cx - origin[0]) / step), ty = Math.round((cy - origin[1]) / step);
  const shape = municipalitiesByName.get(p.municipality);
  if (!shape) throw new Error(`Missing municipality ${p.municipality}`);
  const validCache = new Map();
  const valid = (x, y) => {
    const id = key(x, y);
    if (validCache.has(id)) return validCache.get(id);
    const [lng, lat] = point(x, y);
    const allowed = contains(shape, lng, lat) && !protectedShapes.some((s) => contains(s, lng, lat));
    validCache.set(id, allowed); return allowed;
  };
  const previous = byMunicipality.get(p.municipality) ?? [];
  let seed = null;
  if (previous.length) {
    let nearest = Infinity;
    for (const cell of previous) {
      if ((p.origin === 'expansion' && cell.start >= p.startMonth) || cell.retire <= p.startMonth) continue;
      const distance = Math.hypot(cell.x - tx, cell.y - ty) * step * 111;
      if (distance > 2 || distance >= nearest) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!occupied.has(key(cell.x + dx, cell.y + dy)) && valid(cell.x + dx, cell.y + dy)) {
          seed = [cell.x + dx, cell.y + dy]; nearest = distance;
        }
      }
    }
  }
  // A distant expansion remains an independent island.
  for (let radius = 0; !seed && radius < 90; radius++) {
    for (let dy = -radius; dy <= radius && !seed; dy++) for (let dx = -radius; dx <= radius && !seed; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      if (!occupied.has(key(tx + dx, ty + dy)) && valid(tx + dx, ty + dy)) seed = [tx + dx, ty + dy];
    }
  }
  if (!seed) { unplaced++; continue; }
  const hectaresPerNode = (step * 111) ** 2 * 100;
  const target = Math.max(5, Math.round(p.hectares / hectaresPerNode));
  const heap = new Heap();
  heap.push({ x: seed[0], y: seed[1], cost: 0 });
  const visited = new Set();
  const cells = [];
  while (heap.items.length && cells.length < target) {
    const current = heap.pop(), id = key(current.x, current.y);
    if (visited.has(id)) continue;
    visited.add(id);
    if (occupied.has(id) || !valid(current.x, current.y)) continue;
    const cell = { x: current.x, y: current.y, start: p.startMonth, retire: p.retireMonth ?? 999 };
    cells.push(cell); occupied.set(id, cell);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const x = current.x + dx, y = current.y + dy;
      // Directional cost gives extended patches instead of radial disks.
      const directional = Math.abs(dy - dx * 0.55) * 0.85;
      heap.push({ x, y, cost: current.cost + Math.hypot(dx, dy) * cost(x, y) + directional });
    }
  }
  cells.forEach((cell, index) => {
    const rank = (index + 0.5) / cells.length;
    cell.entry = p.origin === 'initial' ? -1 : monthAtProgress(rank, p.startMonth, p.entryEndMonth ?? p.startMonth + 1);
    const fraction = p.retirementFraction ?? 1;
    const retirementRank = (1 - rank) / fraction;
    cell.exit = p.retireMonth == null || retirementRank >= 1 ? 999
      : monthAtProgress(retirementRank, p.retirementStartMonth ?? p.retireMonth - 1, p.retireMonth);
  });
  previous.push(...cells); byMunicipality.set(p.municipality, previous);
}
if (unplaced) throw new Error(`${unplaced} features could not be placed`);
const nodes = [...occupied.values()].sort((a, b) => a.y - b.y || a.x - b.x).map((c) => [c.x, c.y, +c.entry.toFixed(5), +c.exit.toFixed(5)]);
writeFileSync('public/data/frontier-surface.json', JSON.stringify({ version: 1, step, origin, nodes, note: 'Malla visual sintética: crecimiento contiguo con exclusión IGAC/RUNAP. No representa lotes ni cobertura observada. No cambia el modelo.' }));
const manifest = read('model-manifest.json');
manifest.files = manifest.files.filter((f) => f.name !== 'frontier-surface.json');
manifest.files.push({ name: 'frontier-surface.json', sha256: createHash('sha256').update(readFileSync('public/data/frontier-surface.json')).digest('hex') });
manifest.checks.visualSurfaceNodes = nodes.length;
writeFileSync('public/data/model-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Visual surface: ${nodes.length} nodes; ${features.length} source features; no model changes.`);
