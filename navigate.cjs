const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const contexts = browser.contexts();
  const page = contexts[0].pages()[0];
  
  // 导航到作品管理页面
  await page.goto('https://fanqienovel.com/main/writer/book-manage', { waitUntil: 'networkidle', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('当前URL:', page.url());
  console.log('标题:', await page.title());
  
  // 截图确认页面状态
  await page.screenshot({ path: '/tmp/fanqie-book-manage-now.png' });
  console.log('截图已保存');
  
  await browser.close();
})().catch(e => console.error(e.message));
