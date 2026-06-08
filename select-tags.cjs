const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const contexts = browser.contexts();
  const page = contexts[0].pages()[0];
  
  // 点击标签选择
  await page.click('.select-view');
  await new Promise(r => setTimeout(r, 2000));
  
  // 截图看当前状态
  await page.screenshot({ path: '/tmp/fanqie-tag-open.png' });
  
  // 直接用坐标点击标签下拉框里的选项
  // 先找到下拉框的位置和内容
  const dropdownInfo = await page.evaluate(() => {
    const selectEl = document.querySelector('.select-view');
    const rect = selectEl.getBoundingClientRect();
    
    // 找下拉弹出的标签列表
    const labels = document.querySelectorAll('.arco-checkbox, .arco-tag, [class*="tag-item"], [class*="check"]');
    const results = [];
    for (const el of labels) {
      const r = el.getBoundingClientRect();
      if (r.top > rect.bottom - 5 && r.top < rect.bottom + 400 && r.height > 0) {
        results.push({
          text: el.textContent?.trim().substring(0, 10),
          tag: el.tagName,
          class: el.className?.substring(0, 80),
          top: Math.round(r.top),
          left: Math.round(r.left),
          width: Math.round(r.width),
          height: Math.round(r.height)
        });
      }
    }
    return { selectRect: { top: Math.round(rect.top), left: Math.round(rect.left) }, items: results };
  });
  console.log('Dropdown info:', JSON.stringify(dropdownInfo, null, 2));
  
  await browser.close();
})().catch(e => console.error(e.message));
