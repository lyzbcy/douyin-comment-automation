const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const contexts = browser.contexts();
  const page = contexts[0].pages()[0];
  
  await page.goto('http://111.231.25.152/vnc/vnc.html?autoconnect=true&host=111.231.25.152&port=80&path=vnc/websockify', { waitUntil: 'domcontentloaded', timeout: 10000 });
  await new Promise(r => setTimeout(r, 5000));
  
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('Body:', bodyText);
  
  // 检查有没有连接错误
  const statusText = await page.evaluate(() => {
    const status = document.getElementById('noVNC_status');
    return status?.textContent || 'no status element';
  });
  console.log('noVNC status:', statusText);
  
  await page.screenshot({ path: '/tmp/novnc-test.png' });
  
  await browser.close();
})().catch(e => console.error(e.message));
