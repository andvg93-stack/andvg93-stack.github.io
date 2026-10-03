export interface SurfaceData {
  step: number;
  origin: [number, number];
  nodes: [number, number, number, number][];
}

function prepareChunk(data: SurfaceData) {
  const columns = Math.max(...data.nodes.map((n) => n[0])) + 3;
  const lookup = new Map<number, number>();
  const squares = new Set<number>();
  data.nodes.forEach(([x, y], i) => {
    lookup.set(y * columns + x, i);
    for (const dx of [-1, 0]) for (const dy of [-1, 0]) squares.add((y + dy) * columns + x + dx);
  });
  const cells = [...squares].map((square) => ({
    x: square % columns, y: Math.floor(square / columns),
    ids: [square, square + 1, square + columns + 1, square + columns],
    indices: [square, square + 1, square + columns + 1, square + columns].map((id) => lookup.get(id) ?? -1),
  }));
  const cache = [new Map<string, string>(), new Map<string, string>(), new Map<string, string>()];
  const eventTimes = [new Set<number>(), new Set<number>(), new Set<number>()];
  for (const [, , entry, exit] of data.nodes) {
    if (entry >= 0) eventTimes[1].add(entry);
    if (exit <= 119) { eventTimes[0].add(exit); eventTimes[2].add(exit); }
  }
  return { ...data, columns, cells, cache, eventTimes: eventTimes.map((times) => [...times].sort((a,b) => a-b)) };
}
export function prepareSurface(data: SurfaceData) {
  const width = Math.max(...data.nodes.map((n) => n[0])) + 3;
  const remaining = new Map(data.nodes.map((n) => [n[1] * width + n[0], n]));
  const chunks: ReturnType<typeof prepareChunk>[] = [];
  while (remaining.size) {
    const seed = remaining.keys().next().value!;
    const queue = [seed];
    const nodes: SurfaceData['nodes'] = [];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i], node = remaining.get(id);
      if (!node) continue;
      nodes.push(node); remaining.delete(id);
      for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
        const next = id + dy * width + dx;
        if (remaining.has(next)) queue.push(next);
      }
    }
    chunks.push(prepareChunk({ ...data, nodes }));
  }
  return { chunks };
}
export type PreparedSurface = ReturnType<typeof prepareSurface>;
const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Marching squares: one shared contour per state, no feature-scale circles or filters. */
function chunkPaths(surface: ReturnType<typeof prepareChunk>, month: number, baseline = false) {
  const values = new Float32Array(surface.nodes.length);
  const outputs = ['', '', ''];
  for (let layer = 0; layer < (baseline ? 1 : 3); layer++) {
    const events = surface.eventTimes[layer];
    let low = 0, high = events.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (events[mid] <= month) low = mid + 1; else high = mid;
    }
    const moving = (events[low] ?? Infinity) - month < 1 / 24 || month - (events[low - 1] ?? -Infinity) < 1 / 24;
    const key = baseline ? 'baseline' : moving ? `time:${month}` : `stable:${low}`;
    const cached = surface.cache[layer].get(key);
    if (cached !== undefined) { outputs[layer] = cached; continue; }
    surface.nodes.forEach(([, , entry, exit], i) => {
      const arrived = entry < 0 ? 1 : clamp((month - entry) * 12 + 0.5);
      const gone = exit > 119 ? 0 : clamp((month - exit) * 12 + 0.5);
      values[i] = baseline ? (entry < 0 ? 1 : 0) : layer === 0 ? (entry < 0 ? 1 - gone : 0) : layer === 1 ? (entry >= 0 ? arrived * (1 - gone) : 0) : arrived * gone;
    });
    const adjacency = new Map<string, string[]>();
    const positions = new Map<string, [number, number]>();
    for (const {x, y, ids, indices} of surface.cells) {
      const a = indices[0] < 0 ? 0 : values[indices[0]];
      const b = indices[1] < 0 ? 0 : values[indices[1]];
      const c = indices[2] < 0 ? 0 : values[indices[2]];
      const d = indices[3] < 0 ? 0 : values[indices[3]];
      const mask = (a >= 0.5 ? 1 : 0) | (b >= 0.5 ? 2 : 0) | (c >= 0.5 ? 4 : 0) | (d >= 0.5 ? 8 : 0);
      if (mask === 0 || mask === 15) continue;
      const v = [a, b, c, d];
      const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
      const crossings: string[] = [];
      for (let e = 0; e < 4; e++) {
        const n = (e + 1) % 4;
        if ((v[e] >= 0.5) === (v[n] >= 0.5)) continue;
        const edge = `${Math.min(ids[e], ids[n])}:${Math.max(ids[e], ids[n])}`;
        const t = (0.5 - v[e]) / (v[n] - v[e]);
        positions.set(edge, [corners[e][0] + (corners[n][0] - corners[e][0]) * t, corners[e][1] + (corners[n][1] - corners[e][1]) * t]);
        crossings.push(edge);
      }
      // Saddle cells use a stable diagonal; no time-dependent topology randomness.
      if (crossings.length === 4 && v[0] >= 0.5) crossings.push(crossings.shift()!);
      for (let i = 0; i < crossings.length; i += 2) {
        const a = crossings[i], b = crossings[i + 1];
        adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
        adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
      }
    }
    const visited = new Set<string>();
    const fmt = (p: [number, number]) => `${(surface.origin[0] + p[0] * surface.step).toFixed(5)},${(surface.origin[1] + p[1] * surface.step).toFixed(5)}`;
    for (const start of adjacency.keys()) {
      if (visited.has(start)) continue;
      const ring: [number, number][] = [];
      let current: string | undefined = start;
      while (current && !visited.has(current)) {
        visited.add(current); ring.push(positions.get(current)!);
        current = adjacency.get(current)?.find((next) => !visited.has(next));
      }
      if (ring.length < 3) continue;
      const middle = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      outputs[layer] += `M${fmt(middle(ring.at(-1)!, ring[0]))}`;
      ring.forEach((p, i) => { outputs[layer] += `Q${fmt(p)} ${fmt(middle(p, ring[(i + 1) % ring.length]))}`; });
      outputs[layer] += 'Z';
    }
    surface.cache[layer].set(key, outputs[layer]);
    if (surface.cache[layer].size > 5) surface.cache[layer].delete(surface.cache[layer].keys().next().value!);
  }
  return { persistent: outputs[0], expansion: outputs[1], retired: outputs[2] };
}

export function surfacePaths(surface: PreparedSurface, month: number, baseline = false) {
  const parts = surface.chunks.map((chunk) => chunkPaths(chunk, month, baseline));
  return {
    persistent: parts.map((p) => p.persistent).join(''),
    expansion: parts.map((p) => p.expansion).join(''),
    retired: parts.map((p) => p.retired).join(''),
  };
}
