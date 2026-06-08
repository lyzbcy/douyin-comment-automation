const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages()[0];
  
  // 清理遮罩
  await page.evaluate(() => {
    document.querySelectorAll('.arco-modal-mask').forEach(e => e.remove());
    document.querySelectorAll('.arco-modal-wrapper').forEach(e => { e.style.pointerEvents = 'auto'; });
  });
  
  // 步骤1: 点"下一步"（从编辑器进入发布设置）
  console.log('[1] 点下一步...');
  await page.locator('button:has-text("下一步")').first().click({ force: true });
  await new Promise(r => setTimeout(r, 3000));
  
  // 检查弹出了什么
  let bodyText = await page.evaluate(() => document.body.innerText.substring(0, 1500));
  console.log('[1] 页面:', bodyText.substring(0, 300));
  
  // 找所有可见按钮
  let buttons = await page.$$eval('button', els => els.map(e => ({
    text: e.textContent?.trim().substring(0, 20),
    disabled: e.disabled,
    visible: e.offsetHeight > 0
  })).filter(b => b.visible && b.text));
  console.log('[1] 按钮:', JSON.stringify(buttons));
  
  // 步骤2: 可能有错别字检测弹窗，点提交/忽略
  const submitBtn = await page.$('button:has-text("提交")');
  if (submitBtn) {
    console.log('[2] 点提交...');
    await submitBtn.click({ force: true });
    await new Promise(r => setTimeout(r, 2000));
    
    // 可能还有"仅基础检测"选项
    const basicCheck = await page.evaluate(() => {
      const all = document.querySelectorAll('*');
      for (const el of all) {
        if (el.textContent?.trim() === '仅基础检测' && el.offsetHeight > 0) {
          el.click();
          return true;
        }
      }
      return false;
    });
    console.log('[2] 仅基础检测:', basicCheck);
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // 步骤3: 检查"是否使用AI"
  const aiYes = await page.evaluate(() => {
    const labels = document.querySelectorAll('label.arco-radio');
    for (const l of labels) {
      if (l.textContent?.trim() === '是') {
        l.click();
        return true;
      }
    }
    return false;
  });
  console.log('[3] AI选是:', aiYes);
  
  // 步骤4: 点确认发布
  await page.evaluate(() => {
    document.querySelectorAll('.arco-modal-mask').forEach(e => e.remove());
    document.querySelectorAll('.arco-modal-wrapper').forEach(e => { e.style.pointerEvents = 'auto'; });
  });
  
  const confirmBtn = await page.$('button:has-text("确认发布")');
  if (confirmBtn) {
    console.log('[4] 点确认发布...');
    await confirmBtn.click({ force: true });
    await new Promise(r => setTimeout(r, 5000));
    
    console.log('[4] URL:', page.url());
    bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('[4] 结果:', bodyText.substring(0, 300));
  } else {
    console.log('[4] 没找到确认发布按钮，截图排查');
    buttons = await page.$$eval('button', els => els.map(e => ({
      text: e.textContent?.trim().substring(0, 20),
      disabled: e.disabled,
      visible: e.offsetHeight > 0
    })).filter(b => b.visible && b.text));
    console.log('[4] 当前按钮:', JSON.stringify(buttons));
  }
  
  await page.screenshot({ path: '/tmp/fanqie-publish-result.png' });
  
  await browser.close();
})().catch(e => console.error(e.message));
