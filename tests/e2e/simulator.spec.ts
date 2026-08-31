import { expect, test, type Page } from '@playwright/test';

async function openLocal(page: Page) {
  await page.goto('/?basemap=local');
  await expect(page.getByTestId('timeline-slider')).toBeVisible();
  await expect(page.getByTestId('local-territory-map')).toBeVisible();
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

test('muestra los cauces y rotula los ríos principales', async ({ page }) => {
  await openLocal(page);
  const waterways = page.getByTestId('waterways-layer').locator('path');
  await expect(waterways).toHaveCount(245);
  await expect(page.getByTestId('waterway-labels').locator('text')).toHaveCount(8);
  await expect(page.getByTestId('waterway-labels')).toContainText('Río Magdalena');
  await expect(waterways.first()).toHaveCSS('stroke-width', '1.55px');
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
