const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages()[0];
  
  // 先忽略全部检测提示
  console.log('[1] 点忽略全部...');
  await page.click('button:has-text("忽略全部")', { force: true }).catch(() => console.log('没找到忽略全部'));
  await new Promise(r => setTimeout(r, 2000));
  
  // 清遮罩
  await page.evaluate(() => {
    document.querySelectorAll('.arco-modal-mask').forEach(e => e.remove());
    document.querySelectorAll('.arco-modal-wrapper').forEach(e => { e.style.pointerEvents = 'auto'; });
  });
  
  // 点"下一步"重新进入发布流程
  console.log('[2] 点下一步...');
  await page.locator('button:has-text("下一步")').first().click({ force: true });
  await new Promise(r => setTimeout(r, 3000));
  
  // 处理弹窗
  let buttons = await page.$$eval('button', els => els.map(e => ({
    text: e.textContent?.trim().substring(0, 20),
    disabled: e.disabled,
    visible: e.offsetHeight > 0
  })).filter(b => b.visible && b.text));
  console.log('[2] 按钮:', JSON.stringify(buttons));
  
  // 点提交（如果有错别字检测）
  const submitBtn = await page.$('button:has-text("提交")');
  if (submitBtn) {
    console.log('[3] 点提交...');
    await submitBtn.click({ force: true });
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // 点确定（如果有确认弹窗）
  const confirmStep = await page.$('button:has-text("确定")');
  if (confirmStep) {
    console.log('[4] 点确定...');
    await confirmStep.click({ force: true });
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // 选AI使用"是"
  await page.evaluate(() => {
    const labels = document.querySelectorAll('label.arco-radio');
    for (const l of labels) {
      if (l.textContent?.trim() === '是' && l.offsetHeight > 0) {
        l.click();
        return;
      }
    }
  });
  console.log('[5] 选了是');
  await new Promise(r => setTimeout(r, 1000));
  
  // 清遮罩再点确认发布
  await page.evaluate(() => {
    document.querySelectorAll('.arco-modal-mask').forEach(e => e.remove());
    document.querySelectorAll('.arco-modal-wrapper').forEach(e => { e.style.pointerEvents = 'auto'; });
  });
  
  console.log('[6] 点确认发布...');
  await page.click('button:has-text("确认发布")', { force: true }).catch(() => {});
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent?.trim() === '确认发布' && b.offsetHeight > 0) b.click();
    }
  });
  
  await new Promise(r => setTimeout(r, 8000));
  
  console.log('URL:', page.url());
  if (page.url().includes('chapter-manage')) {
    console.log('✅ 发布成功！');
  } else {
    const text = await page.evaluate(() => document.body.innerText.substring(0, 300));
    console.log('页面:', text.substring(0, 200));
    
    buttons = await page.$$eval('button', els => els.map(e => ({
      text: e.textContent?.trim().substring(0, 20),
      visible: e.offsetHeight > 0
    })).filter(b => b.visible && b.text));
    console.log('当前按钮:', JSON.stringify(buttons));
  }
  
  await page.screenshot({ path: '/tmp/fanqie-v6.png' });
  
  await browser.close();
})().catch(e => console.error(e.message));
