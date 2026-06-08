const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const contexts = browser.contexts();
  const page = contexts[0].pages()[0];
  
  // 先确认当前页面
  await page.goto('https://fanqienovel.com/main/writer/book-manage', { waitUntil: 'networkidle', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  
  // 点击创建新书按钮
  await page.locator('.write-button').click({ force: true });
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('点击创建新书后');
  
  // 找"创建书本"按钮并点击
  const buttons = await page.$$eval('button, span, div, a', els => 
    els.map(e => ({ text: e.textContent?.trim(), tag: e.tagName, class: e.className?.substring(0, 80) }))
      .filter(e => e.text && (e.text.includes('创建书本') || e.text.includes('创建作品')))
  );
  console.log('找到的按钮:', JSON.stringify(buttons, null, 2));
  
  // 尝试点击"创建书本"
  const clicked = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.textContent?.trim() === '创建书本' && el.offsetHeight > 0) {
        el.click();
        return 'clicked: ' + el.tagName + '.' + el.className?.substring(0, 50);
      }
    }
    return 'not found';
  });
  console.log('创建书本:', clicked);
  
  await new Promise(r => setTimeout(r, 3000));
  
  // 截图看看结果
  await page.screenshot({ path: '/tmp/fanqie-create-book-form.png', fullPage: true });
  console.log('截图已保存');
  
  // 检查表单元素
  const inputs = await page.$$eval('input, textarea, select', els => els.map(e => ({
    tag: e.tagName,
    type: e.type,
    placeholder: e.placeholder,
    value: e.value,
    name: e.name,
    visible: e.offsetHeight > 0
  })).filter(e => e.visible));
  console.log('表单元素:', JSON.stringify(inputs, null, 2));
  
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('页面文本:', bodyText.substring(1500));
  
  await browser.close();
})().catch(e => console.error(e.message));
