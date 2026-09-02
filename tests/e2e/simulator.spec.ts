import { expect, test, type Page } from '@playwright/test';

async function openLocal(page: Page) {
  await page.goto('/?basemap=local');
  await expect(page.getByTestId('timeline-slider')).toBeVisible();
  await expect(page.getByTestId('local-territory-map')).toBeVisible();
}

async function hoverMunicipality(page: Page, municipality: string) {
  const path = page
    .getByTestId('municipality-hit-layer')
    .locator(`[data-municipality="${municipality}"]`);
  const point = await path.evaluate((element) => {
    const svg = element.closest('svg')!;
    const rect = svg.getBoundingClientRect();
    const [minX, minY, width, height] = svg
      .getAttribute('viewBox')!
      .split(' ')
      .map(Number);
    const scale = Math.min(rect.width / width, rect.height / height);
    const offsetX = (rect.width - width * scale) / 2;
    const offsetY = (rect.height - height * scale) / 2;
    return {
      x: rect.left + offsetX + (Number(element.getAttribute('data-hit-x')) - minX) * scale,
      y: rect.top + offsetY + (Number(element.getAttribute('data-hit-y')) - minY) * scale,
    };
  });
  await page.getByRole('img', { name: /Mapa vectorial local del Huila/ }).dispatchEvent('pointermove', {
    bubbles: true,
    clientX: point.x,
    clientY: point.y,
    pointerId: 1,
    pointerType: 'mouse',
  });
}

test('inicia en 2026, reproduce, pausa y conserva el mes', async ({ page }) => {
  await openLocal(page);
  const slider = page.getByTestId('timeline-slider');
  await expect(slider).toHaveValue('0');
  await expect(page.getByTestId('timeline-date')).toContainText('enero de 2026');

  await page.getByTestId('play-toggle').click();
  await page.waitForTimeout(1000);
  const movingMonth = Number(await slider.inputValue());
  expect(movingMonth).toBeGreaterThan(0);

  await page.getByTestId('play-toggle').click();
  const pausedMonth = await slider.inputValue();
  await page.waitForTimeout(600);
  await expect(slider).toHaveValue(pausedMonth);
});

test('permite seleccionar cualquier mes y mantiene mapa e indicadores sincronizados', async ({ page }) => {
  await openLocal(page);
  const slider = page.getByTestId('timeline-slider');
  await slider.fill('60');
  await expect(slider).toHaveValue('60');
  await expect(page.getByTestId('map-month')).toContainText('60');
  await expect(page.getByTestId('metric-co2')).not.toContainText('0.0 kt');

  await slider.press('ArrowRight');
  await expect(slider).toHaveValue('61');
  await slider.press('Home');
  await expect(slider).toHaveValue('0');
  await slider.press('End');
  await expect(slider).toHaveValue('119');
});

test('se detiene en 2035 y reinicia al volver a reproducir', async ({ page }) => {
  await openLocal(page);
  const slider = page.getByTestId('timeline-slider');
  await slider.press('End');
  await expect(page.getByTestId('play-toggle')).toHaveAttribute('aria-label', 'Reiniciar simulación');
  await page.getByTestId('play-toggle').click();
  await page.waitForTimeout(500);
  expect(Number(await slider.inputValue())).toBeLessThan(119);
});

test('funciona con todas las solicitudes externas bloqueadas', async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  await openLocal(page);
  await expect(page.getByText('Fondo local')).toBeVisible();
  await expect(page.getByRole('img', { name: /Mapa vectorial local del Huila/ })).toBeVisible();
});

test('desplaza el mapa móvil con una sola transformación por cuadro', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLocal(page);
  const map = page.getByRole('img', { name: /Mapa vectorial local del Huila/ });
  const content = page.locator('.svg-map-content');
  const box = await map.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width * 0.55;
  const startY = box!.y + box!.height * 0.42;
  const initialViewBox = await map.getAttribute('viewBox');

  await map.dispatchEvent('pointerdown', {
    bubbles: true,
    clientX: startX,
    clientY: startY,
    pointerId: 7,
    pointerType: 'touch',
  });
  for (let step = 1; step <= 12; step += 1) {
    await map.dispatchEvent('pointermove', {
      bubbles: true,
      clientX: startX + step * 4,
      clientY: startY + step * 2,
      pointerId: 7,
      pointerType: 'touch',
    });
  }
  await page.evaluate(() => new Promise(requestAnimationFrame));

  await expect(map).toHaveAttribute('viewBox', initialViewBox ?? '');
  await expect(content).toHaveClass(/is-panning/);
  expect(await content.evaluate((element) => (element as SVGGElement).style.transform)).toContain('translate');

  await map.dispatchEvent('pointerup', {
    bubbles: true,
    clientX: startX + 48,
    clientY: startY + 24,
    pointerId: 7,
    pointerType: 'touch',
  });
  await expect(map).not.toHaveAttribute('viewBox', initialViewBox ?? '');
  await expect(content).not.toHaveClass(/is-panning/);
  expect(await content.evaluate((element) => (element as SVGGElement).style.transform)).toBe('');
});

test('muestra los cauces y rotula los ríos principales', async ({ page }) => {
  await openLocal(page);
  const waterways = page.getByTestId('waterways-layer').locator('path');
  await expect(waterways).toHaveCount(245);
  await expect(page.getByTestId('waterway-labels').locator('text')).toHaveCount(8);
  await expect(page.getByTestId('waterway-labels')).toContainText('Río Magdalena');
  await expect(waterways.first()).toHaveCSS('stroke-width', '1.55px');
});

test('agrupa la frontera en tres blobs orgánicos sin mostrar círculos individuales', async ({ page }) => {
  await openLocal(page);
  await page.getByTestId('timeline-slider').press('End');
  await expect(page.getByTestId('coffee-blob-layer')).toBeVisible();
  await expect(page.getByTestId('active-blob')).toHaveAttribute('filter', 'url(#coffee-active-blob)');
  await expect(page.getByTestId('expansion-blob')).toHaveAttribute('filter', 'url(#coffee-expansion-blob)');
  await expect(page.getByTestId('retired-blob')).toHaveAttribute('filter', 'url(#coffee-retired-blob)');
  await expect(page.locator('filter[id^="coffee-"][id$="-blob"]')).toHaveCount(3);
  await expect(page.getByTestId('frontier-hit-layer')).toHaveCount(0);
  expect(await page.locator('.svg-frontier--initial, .svg-frontier--expansion, .svg-frontier--retired').count()).toBe(0);
  expect(await page.getByTestId('active-blob').locator('[data-connected-to]').count()).toBeGreaterThan(0);
});

test('mantiene los detalles territoriales sobre las geometrías agrupadas', async ({ page }) => {
  await openLocal(page);
  await hoverMunicipality(page, 'Pitalito');
  await expect(page.locator('.local-map-tooltip')).toBeVisible();
  await expect(page.locator('.local-map-tooltip')).toContainText('Pitalito');
  await expect(page.locator('.local-map-tooltip')).toContainText('Aptitud dominante:');
  await expect(page.locator('.local-map-tooltip')).toContainText('Confianza espacial dominante:');
});

test('resuelve el municipio real bajo el cursor en todo el departamento', async ({ page }) => {
  await openLocal(page);
  const hitLayer = page.getByTestId('municipality-hit-layer');
  await expect(hitLayer.locator('[data-municipality]')).toHaveCount(37);
  const municipalities = await hitLayer.locator('[data-municipality]').evaluateAll((markers) =>
    markers.map((marker) => marker.getAttribute('data-municipality') ?? ''),
  );

  for (const municipality of municipalities) {
    await hoverMunicipality(page, municipality);
    await expect(page.locator('.local-map-tooltip strong')).toHaveText(municipality);
  }
});

test('la geometría evoluciona de forma continua y se congela al pausar', async ({ page }) => {
  await openLocal(page);
  const slider = page.getByTestId('timeline-slider');
  const blobs = page.getByTestId('coffee-blob-layer');
  await slider.fill('14');
  await page.getByTestId('play-toggle').click();
  await page.waitForTimeout(70);
  const firstMonth = Number(await blobs.getAttribute('data-visual-month'));
  const firstRoughness = await blobs.getAttribute('data-roughness');
  await page.waitForTimeout(130);
  const secondMonth = Number(await blobs.getAttribute('data-visual-month'));
  const secondRoughness = await blobs.getAttribute('data-roughness');
  expect(secondMonth).toBeGreaterThan(firstMonth);
  expect(secondRoughness).not.toBe(firstRoughness);

  await page.getByTestId('play-toggle').click();
  const pausedMonth = await blobs.getAttribute('data-visual-month');
  const pausedRoughness = await blobs.getAttribute('data-roughness');
  await page.waitForTimeout(350);
  await expect(blobs).toHaveAttribute('data-visual-month', pausedMonth ?? '');
  await expect(blobs).toHaveAttribute('data-roughness', pausedRoughness ?? '');
});

test('volver a una fecha reconstruye exactamente el mismo estado orgánico', async ({ page }) => {
  await openLocal(page);
  const slider = page.getByTestId('timeline-slider');
  const blobs = page.getByTestId('coffee-blob-layer');
  await slider.fill('60');
  const initialState = await blobs.evaluate((element) => ({
    month: element.getAttribute('data-visual-month'),
    roughness: element.getAttribute('data-roughness'),
    progress: Array.from(element.querySelectorAll('[data-progress]')).map((node) => node.getAttribute('data-progress')),
  }));
  await slider.fill('30');
  await slider.fill('60');
  const reconstructedState = await blobs.evaluate((element) => ({
    month: element.getAttribute('data-visual-month'),
    roughness: element.getAttribute('data-roughness'),
    progress: Array.from(element.querySelectorAll('[data-progress]')).map((node) => node.getAttribute('data-progress')),
  }));
  expect(reconstructedState).toEqual(initialState);
});

test('mantiene al menos 30 fps durante la reproducción', async ({ page }) => {
  await openLocal(page);
  await page.getByTestId('play-toggle').click();
  const framesPerSecond = await page.evaluate(() => new Promise<number>((resolve) => {
    const startedAt = performance.now();
    let frames = 0;
    const sample = (now: number) => {
      frames += 1;
      if (now - startedAt >= 900) {
        resolve((frames * 1000) / (now - startedAt));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  expect(framesPerSecond).toBeGreaterThanOrEqual(30);
});

test('reduce la deformación a pasos mensuales cuando el sistema lo solicita', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLocal(page);
  await page.getByTestId('timeline-slider').fill('14');
  await page.getByTestId('play-toggle').click();
  await page.waitForTimeout(180);
  const visualMonth = await page.getByTestId('coffee-blob-layer').getAttribute('data-visual-month');
  expect(visualMonth).toMatch(/^\d+\.000$/);
});

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`captura estable ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openLocal(page);
    await page.getByTestId('timeline-slider').press('End');
    await page.screenshot({
      path: `outputs/playwright/cafe-2035-${viewport.name}.png`,
      fullPage: viewport.name === 'mobile',
    });
    await expect(page.getByRole('heading', { name: 'CAFÉ 2035 · HUILA' })).toBeVisible();
  });
}
