const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages()[0];
  
  console.log('URL:', page.url());
  
  // 看所有按钮
  const buttons = await page.$$eval('button', els => els.map(e => ({
    text: e.textContent?.trim().substring(0, 20),
    disabled: e.disabled,
    visible: e.offsetHeight > 0
  })).filter(b => b.visible && b.text));
  console.log('可见按钮:', JSON.stringify(buttons, null, 2));
  
  // 看看有没有radio选项（是/否 AI使用）
  const radios = await page.$$eval('[class*="radio"], [class*="Radio"]', els => els.map(e => ({
    text: e.textContent?.trim().substring(0, 20),
    class: e.className?.substring(0, 60)
  })).filter(r => r.text));
  console.log('Radio:', JSON.stringify(radios, null, 2));
  
  await page.screenshot({ path: '/tmp/fanqie-state2.png' });
  
  await browser.close();
})().catch(e => console.error(e.message));
