const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages()[0];
  
  // 清遮罩
  await page.evaluate(() => {
    document.querySelectorAll('.arco-modal-mask').forEach(e => e.remove());
    document.querySelectorAll('.arco-modal-wrapper').forEach(e => { e.style.pointerEvents = 'auto'; });
  });
  
  // 点确定
  console.log('点确定...');
  await page.click('button:has-text("确定")', { force: true });
  await new Promise(r => setTimeout(r, 3000));
  
  let buttons = await page.$$eval('button', els => els.map(e => ({
    text: e.textContent?.trim().substring(0, 20),
    disabled: e.disabled,
    visible: e.offsetHeight > 0
  })).filter(b => b.visible && b.text));
  console.log('按钮:', JSON.stringify(buttons));
  
  // 看看有没有AI使用的radio
  let radios = await page.$$eval('label.arco-radio', els => els.map(e => ({
    text: e.textContent?.trim(),
    visible: e.offsetHeight > 0
  })).filter(r => r.visible));
  console.log('Radios:', JSON.stringify(radios));
  
  // 如果有"是"选上
  for (const radio of ['是', '否']) {
    const clicked = await page.evaluate((t) => {
      const labels = document.querySelectorAll('label.arco-radio');
      for (const l of labels) {
        if (l.textContent?.trim() === t && l.offsetHeight > 0) {
          l.click();
          return true;
        }
      }
      return false;
    }, radio);
    if (clicked) console.log(`选了 ${radio}`);
  }
  
  // 找确认发布
  const hasConfirm = await page.$('button:has-text("确认发布")');
  if (hasConfirm) {
    console.log('找到确认发布，点击...');
    await page.evaluate(() => {
      document.querySelectorAll('.arco-modal-mask').forEach(e => e.remove());
      document.querySelectorAll('.arco-modal-wrapper').forEach(e => { e.style.pointerEvents = 'auto'; });
    });
    await page.click('button:has-text("确认发布")', { force: true });
    await new Promise(r => setTimeout(r, 5000));
    
    console.log('URL:', page.url());
    const text = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('结果:', text.substring(0, 300));
  } else {
    console.log('还没到确认发布步骤');
    // 看完整弹窗内容
    const modalText = await page.evaluate(() => {
      const modals = document.querySelectorAll('[class*="modal-content"], [class*="dialog-content"], [class*="modal-body"]');
      return Array.from(modals).map(m => m.textContent?.substring(0, 200)).filter(t => t);
    });
    console.log('弹窗内容:', JSON.stringify(modalText));
  }
  
  await page.screenshot({ path: '/tmp/fanqie-v4.png' });
  
  await browser.close();
})().catch(e => console.error(e.message));
