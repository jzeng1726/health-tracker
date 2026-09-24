import { chromium } from 'playwright';
const out = process.argv[2] || 'shots';
const theme = process.argv[3] || 'light';
const pages = (process.argv[4] || 'dashboard,bodyweight,strength,endurance,quick,review,settings').split(',');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1360, height: Number(process.env.H || 900) }, colorScheme: theme });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => localStorage.setItem('range', JSON.stringify({ preset: 'All' })));
for (const p of pages) {
  await page.goto(`http://localhost:1420/#${p}`);
  await page.waitForTimeout(p === pages[0] ? 3500 : 1500);
  await page.screenshot({ path: `${out}/${theme}-${p}.png`, fullPage: true });
}
console.log('errors:', JSON.stringify(errors.slice(0, 10), null, 1));
await browser.close();
