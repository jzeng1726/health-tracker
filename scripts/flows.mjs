import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await browser.newContext({ viewport: { width: 1360, height: 2200 } })).newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem('range', JSON.stringify({ preset: 'All' })));
await page.goto('http://localhost:1420/#quick'); await page.waitForTimeout(3000);
// endurance entry: Static holds, 80 lb, time 1:30
const endForm = page.locator('form', { hasText: 'Endurance entry' });
await endForm.locator('input[type=date]').fill('2026-09-25');
await endForm.locator('input[list]').fill('Static holds');
await endForm.locator('input[type=number]').first().fill('80');
await endForm.locator('input[placeholder^="1:30"]').fill('1:30');
console.log('time hint:', await endForm.locator('#time-hint').innerText());
await endForm.locator('button.btn.primary').click(); await page.waitForTimeout(2500);
console.log('toast:', await page.locator('.toast').innerText().catch(() => 'none'));
// bodyweight
const bw = page.locator('form', { hasText: 'Morning weight' });
await bw.locator('input[type=date]').fill('2026-09-25');
await bw.locator('input[type=number]').fill('159.8');
await bw.locator('button.btn.primary').click(); await page.waitForTimeout(2500);
console.log('toast:', await page.locator('.toast').innerText().catch(() => 'none'));
// conflict path: same date again with different value
await bw.locator('input[type=number]').fill('160.4');
await bw.locator('button.btn.primary').click(); await page.waitForTimeout(1500);
console.log('conflict:', await bw.locator('.hint.bad').innerText().catch(() => 'none'));
// date the plank
await page.goto('http://localhost:1420/#review'); await page.waitForTimeout(1200);
const plank = page.locator('.review-item', { hasText: 'Plank — no date' });
await plank.locator('input[type=date]').fill('2026-09-05');
await plank.locator('button', { hasText: 'Save date' }).click(); await page.waitForTimeout(1000);
await page.goto('http://localhost:1420/#endurance'); await page.waitForTimeout(1200);
await page.locator('.chip', { hasText: 'Static Holds' }).click(); await page.waitForTimeout(600);
await page.locator('summary').first().click();
await page.screenshot({ path: 'shots/flow-holds.png', fullPage: true });
console.log('holds table:', (await page.locator('details table').first().innerText()).replace(/\t/g, ' | '));
await page.locator('.chip', { hasText: 'Timed' }).click(); await page.waitForTimeout(600);
await page.locator('summary').first().click();
console.log('timed table:', (await page.locator('details table').first().innerText()).replace(/\t/g, ' | '));
await page.goto('http://localhost:1420/#bodyweight'); await page.waitForTimeout(1200);
console.log('bw tile:', await page.locator('.card').first().innerText());
await page.goto('http://localhost:1420/#settings'); await page.waitForTimeout(1200);
console.log('files:', (await page.locator('table').first().innerText()).replace(/\t/g, ' | '));
console.log('errors', errors);
await browser.close();
