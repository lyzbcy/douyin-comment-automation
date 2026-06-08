const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const contexts = browser.contexts();
  const page = contexts[0].pages()[0];
  
  // 在服务器本地直接访问noVNC
  await page.goto('http://localhost:6080/vnc_lite.html', { waitUntil: 'domcontentloaded', timeout: 10000 });
  await new Promise(r => setTimeout(r, 5000));
  
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 300));
  console.log('Body:', bodyText);
  
  await page.screenshot({ path: '/tmp/vnc-local-test.png' });
  
  await browser.close();
})().catch(e => console.error(e.message));
