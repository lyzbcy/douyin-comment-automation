const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages()[0];
  
  // 清遮罩
  await page.evaluate(() => {
    document.querySelectorAll('.arco-modal-mask').forEach(e => e.remove());
    document.querySelectorAll('.arco-modal-wrapper').forEach(e => { e.style.pointerEvents = 'auto'; });
  });
  
  // 只选"是"（AI使用）
  const clickedYes = await page.evaluate(() => {
    const labels = document.querySelectorAll('label.arco-radio');
    for (const l of labels) {
      if (l.textContent?.trim() === '是') {
        // 确认这是AI使用那个radio组里的
        const parent = l.closest('[class*="modal"], [class*="dialog"], [class*="popup"]');
        if (parent || l.getBoundingClientRect().top < 500) {
          l.click();
          return 'clicked at top: ' + Math.round(l.getBoundingClientRect().top);
        }
      }
    }
    // fallback: 点击所有"是"
    let count = 0;
    labels.forEach(l => { if (l.textContent?.trim() === '是') { l.click(); count++; } });
    return 'clicked ' + count + ' 个是';
  });
  console.log('选是:', clickedYes);
  
  await new Promise(r => setTimeout(r, 1000));
  
  // 再清遮罩
  await page.evaluate(() => {
    document.querySelectorAll('.arco-modal-mask').forEach(e => e.remove());
    document.querySelectorAll('.arco-modal-wrapper').forEach(e => { e.style.pointerEvents = 'auto'; });
  });
  
  // 点确认发布（用force和evaluate双保险）
  console.log('点击确认发布...');
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent?.trim() === '确认发布' && b.offsetHeight > 0) {
        b.click();
        b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      }
    }
    return false;
  });
  
  await page.click('button:has-text("确认发布")', { force: true }).catch(() => {});
  
  await new Promise(r => setTimeout(r, 8000));
  
  console.log('URL:', page.url());
  
  // 检查是否跳转到章节管理
  if (page.url().includes('chapter-manage')) {
    console.log('✅ 发布成功！跳转到章节管理页面');
  } else {
    const text = await page.evaluate(() => document.body.innerText.substring(0, 300));
    console.log('页面:', text);
    
    // 检查是否有错误提示
    const errors = await page.evaluate(() => {
      const all = document.querySelectorAll('[class*="error"], [class*="warn"], [class*="toast"]');
      return Array.from(all).map(e => e.textContent?.trim()).filter(t => t).join('; ');
    });
    console.log('错误提示:', errors);
  }
  
  await page.screenshot({ path: '/tmp/fanqie-v5-result.png' });
  
  await browser.close();
})().catch(e => console.error(e.message));
