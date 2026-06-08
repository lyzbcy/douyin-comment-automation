const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages()[0];
  
  console.log('URL:', page.url());
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 800));
  console.log('Body:', bodyText);
  
  // 看看有没有发布成功的按钮
  const buttons = await page.$$eval('button', els => els.map(e => ({
    text: e.textContent?.trim(),
    disabled: e.disabled
  })).filter(b => b.text));
  console.log('按钮:', JSON.stringify(buttons, null, 2));
  
  await browser.close();
})().catch(e => console.error(e.message));
