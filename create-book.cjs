const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const contexts = browser.contexts();
  const page = contexts[0].pages()[0];
  
  // 自动处理dialog
  page.on('dialog', async dialog => {
    console.log('DIALOG:', dialog.type(), dialog.message());
    await dialog.accept().catch(() => {});
  });
  
  await page.goto('https://fanqienovel.com/main/writer/book-manage', { waitUntil: 'networkidle', timeout: 15000 });
  await new Promise(r => setTimeout(r, 1000));
  
  // 拦截所有 history 变化
  await page.evaluate(() => {
    const origPush = history.pushState;
    history.pushState = function() {
      console.log('PUSHSTATE:', JSON.stringify(arguments));
      window.__routeChange = JSON.stringify(Array.from(arguments).map(a => String(a).substring(0, 200)));
      return origPush.apply(this, arguments);
    };
    const origReplace = history.replaceState;
    history.replaceState = function() {
      console.log('REPLACESTATE:', JSON.stringify(arguments));
      return origReplace.apply(this, arguments);
    };
    window.addEventListener('popstate', () => {
      window.__routeChange = 'popstate: ' + location.href;
    });
  });
  
  // 监听网络请求
  const networkLog = [];
  page.on('request', req => {
    const url = req.url();
    if (!url.includes('mssdk') && !url.includes('.js') && !url.includes('.css') && !url.includes('.png')) {
      networkLog.push(`${req.method()} ${url.substring(0, 120)}`);
    }
  });
  
  // 用Playwright click
  console.log('Clicking .write-button with Playwright...');
  await page.locator('.write-button').click({ timeout: 5000 }).catch(e => console.log('Click error:', e.message));
  
  await new Promise(r => setTimeout(r, 3000));
  
  // 检查路由变化
  const routeChange = await page.evaluate(() => window.__routeChange).catch(() => null);
  console.log('Route change:', routeChange);
  console.log('URL:', page.url());
  console.log('Network log:', networkLog.join('\n'));
  
  // 可能这个按钮只是在一个已经打开的创建表单上需要滚动到
  // 看看完整页面高度
  const scrollInfo = await page.evaluate(() => ({
    scrollHeight: document.body.scrollHeight,
    clientHeight: document.body.clientHeight,
    scrollTop: document.body.scrollTop,
  }));
  console.log('Scroll info:', JSON.stringify(scrollInfo));
  
  // 滚动到底部看看有没有隐藏的内容
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise(r => setTimeout(r, 1000));
  
  const bottomText = await page.evaluate(() => document.body.innerText.substring(1500));
  console.log('Bottom text:', bottomText.substring(0, 500));
  
  await browser.close();
})().catch(e => console.error(e.message));
