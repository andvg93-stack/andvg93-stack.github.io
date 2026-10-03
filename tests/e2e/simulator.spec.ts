import { expect, test, type Page } from '@playwright/test';

async function openLocal(page: Page) {
  await page.goto('/?basemap=local');
  await expect(page.getByTestId('timeline-slider')).toBeVisible();
  await expect(page.getByTestId('local-territory-map')).toBeVisible();
  await expect(page.getByTestId('active-surface')).toHaveAttribute('d', /^M/);
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

test('abril y mayo de 2035 muestran el balance gradual recalculado', async ({ page }) => {
  await openLocal(page);
  const slider = page.getByTestId('timeline-slider');
  await slider.fill('111');
  await expect(page.locator('.territory-balance > div').first()).toContainText('155.965');
  await slider.fill('112');
  await expect(page.locator('.territory-balance > div').first()).toContainText('155.996');
  await expect(page.locator('.territory-balance > div').nth(2)).toContainText('14.400');
  await expect(page.getByTestId('timeline-date')).toContainText('mayo de 2035');
});

test('funciona con todas las solicitudes externas bloqueadas', async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  await openLocal(page);
  await expect(page.getByText('Fondo local')).toBeVisible();
  await expect(page.getByRole('img', { name: /Mapa vectorial local del Huila/ })).toBeVisible();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`el mapa sigue el arrastre sin desaparecer a ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openLocal(page);
    const map = page.getByRole('img', { name: /Mapa vectorial local del Huila/ });
    const point = async () => map.evaluate((svg) => {
      const marker = svg.querySelector('[data-municipality="Pitalito"]')!;
      const p = new DOMPoint(Number(marker.getAttribute('data-hit-x')), Number(marker.getAttribute('data-hit-y')));
      const ctm = svg.querySelector<SVGGElement>('.svg-map-content')!.getScreenCTM()!;
      const pos = p.matrixTransform(ctm);
      return { x: pos.x, y: pos.y };
    });
    const bounds = await map.boundingBox();
    const initialView = await map.getAttribute('viewBox');
    const start = { x: bounds!.x + bounds!.width * 0.42, y: bounds!.y + bounds!.height * 0.45 };
    const before = await point();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 60, start.y + 35, { steps: 12 });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const during = await point();
    expect(during.x - before.x).toBeCloseTo(60, 0);
    expect(during.y - before.y).toBeCloseTo(35, 0);
    await page.screenshot({ path: `outputs/playwright/drag-${viewport.width}.png` });
    await page.mouse.up();
    const after = await point();
    expect(after.x).toBeCloseTo(during.x, 0);
    expect(after.y).toBeCloseTo(during.y, 0);
    await expect(map).not.toHaveAttribute('viewBox', initialView!);
    await expect(page.locator('.svg-map-content')).not.toHaveAttribute('transform');
    await page.getByRole('button', { name: 'Restablecer vista del Huila' }).click();
    await expect(map).toHaveAttribute('viewBox', initialView!);
    await page.getByRole('button', { name: 'Acercar mapa', exact: true }).click();
    const zoomed = await point();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 30, start.y + 20, { steps: 8 });
    await page.mouse.up();
    const moved = await point();
    expect(moved.x - zoomed.x).toBeCloseTo(-30, 0);
    expect(moved.y - zoomed.y).toBeCloseTo(20, 0);
    await hoverMunicipality(page, 'Pitalito');
    await expect(page.locator('.local-map-tooltip strong')).toHaveText('Pitalito');
  });
}

test('gesto táctil real desplaza el mapa y se recupera al cancelar', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await openLocal(page);
  const map = page.getByRole('img', { name: /Mapa vectorial local del Huila/ });
  const box = await map.boundingBox();
  const initial = await map.getAttribute('viewBox');
  const client = await context.newCDPSession(page);
  const x = box!.x + box!.width * 0.4, y = box!.y + box!.height * 0.5;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 45, y: y + 25 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(map).not.toHaveAttribute('viewBox', initial!);
  await expect(page.locator('.svg-map-content')).not.toHaveAttribute('transform');
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(page.locator('.svg-map-content')).not.toHaveClass(/is-panning/);
  await context.close();
});

test('muestra los cauces y rotula los ríos principales', async ({ page }) => {
  await openLocal(page);
  const waterways = page.getByTestId('waterways-layer').locator('path');
  await expect(waterways).toHaveCount(245);
  await expect(page.getByTestId('waterway-labels').locator('text')).toHaveCount(8);
  await expect(page.getByTestId('waterway-labels')).toContainText('Río Magdalena');
  await expect(waterways.first()).toHaveCSS('stroke-width', '1.55px');
});

test('distingue superficies continuas de expansión y retiro sin filtros costosos', async ({ page }) => {
  await openLocal(page);
  await expect(page.getByTestId('expansion-surface')).toHaveAttribute('d', '');
  await expect(page.getByTestId('retired-surface')).toHaveAttribute('d', '');
  await page.getByTestId('timeline-slider').press('End');
  for (const id of ['active-surface', 'expansion-surface', 'retired-surface']) {
    await expect(page.getByTestId(id)).toHaveAttribute('d', /^M/);
  }
  await expect(page.locator('feGaussianBlur, feTurbulence, .blob-connection')).toHaveCount(0);
  await expect(page.getByTestId('retired-surface')).toHaveCSS('fill', /retirement-hatch/);
  await expect(page.locator('.surface-baseline')).toHaveAttribute('d', /^M/);
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
  await slider.fill('15');
  await page.getByTestId('play-toggle').click();
  await page.waitForTimeout(70);
  const firstMonth = Number(await blobs.getAttribute('data-visual-month'));
  const firstRoughness = await page.getByTestId('expansion-surface').getAttribute('d');
  await page.waitForTimeout(130);
  const secondMonth = Number(await blobs.getAttribute('data-visual-month'));
  const secondRoughness = await page.getByTestId('expansion-surface').getAttribute('d');
  expect(secondMonth).toBeGreaterThan(firstMonth);
  expect(secondRoughness).not.toBe(firstRoughness);

  await page.getByTestId('play-toggle').click();
  const pausedMonth = await blobs.getAttribute('data-visual-month');
  const pausedRoughness = await blobs.innerHTML();
  await page.waitForTimeout(350);
  await expect(blobs).toHaveAttribute('data-visual-month', pausedMonth ?? '');
  expect(await blobs.innerHTML()).toBe(pausedRoughness);
});

test('volver a una fecha reconstruye exactamente el mismo estado orgánico', async ({ page }) => {
  await openLocal(page);
  const slider = page.getByTestId('timeline-slider');
  const blobs = page.getByTestId('coffee-blob-layer');
  await slider.fill('60');
  const initialState = await blobs.evaluate((element) => ({
    month: element.getAttribute('data-visual-month'),
    paths: Array.from(element.querySelectorAll('path')).map((node) => node.getAttribute('d')),
  }));
  await slider.fill('30');
  await slider.fill('60');
  const reconstructedState = await blobs.evaluate((element) => ({
    month: element.getAttribute('data-visual-month'),
    paths: Array.from(element.querySelectorAll('path')).map((node) => node.getAttribute('d')),
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
