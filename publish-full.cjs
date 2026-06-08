const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages()[0];
  
  // 先点"下一步"进入发布设置流程
  console.log('点下一步...');
  await page.evaluate(() => {
    // 移除所有遮罩
    document.querySelectorAll('.arco-modal-mask').forEach(e => e.remove());
    document.querySelectorAll('.arco-modal-wrapper').forEach(e => { e.style.pointerEvents = 'auto'; });
  });
  
  // 找到页面主体区域里的"下一步"按钮（不是弹窗里的）
  const nextBtns = await page.$$eval('button', els => els.map((e, i) => ({
    index: i,
    text: e.textContent?.trim(),
    disabled: e.disabled,
    rect: e.getBoundingClientRect().top
  })).filter(b => b.text === '下一步'));
  console.log('下一步按钮:', JSON.stringify(nextBtns));
  
  // 点最上面的下一步按钮
  if (nextBtns.length > 0) {
    await page.click('button:has-text("下一步")', { force: true });
    console.log('点了下一步');
  }
  
  await new Promise(r => setTimeout(r, 3000));
  
  // 检查弹出的内容
  const modals = await page.$$eval('[class*="modal"], [class*="dialog"]', els => 
    els.map(e => ({ text: e.textContent?.substring(0, 200), visible: e.offsetHeight > 0 }))
      .filter(m => m.visible && m.text)
  );
  console.log('弹窗:', JSON.stringify(modals.map(m => m.text?.substring(0, 100))));
  
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 800));
  console.log('Body:', bodyText.substring(500));
  
  await page.screenshot({ path: '/tmp/fanqie-next-step.png' });
  
  await browser.close();
})().catch(e => console.error(e.message));
