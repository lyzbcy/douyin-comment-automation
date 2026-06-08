const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const contexts = browser.contexts();
  const page = contexts[0].pages()[0];
  
  // 选男频
  await page.click('label:has-text("男频")');
  console.log('男频已选');
  await new Promise(r => setTimeout(r, 1000));
  
  // 选择标签
  await page.click('.select-view');
  await new Promise(r => setTimeout(r, 1500));
  
  // 查看标签选项
  const tagOptions = await page.$$eval('[class*="tag"], [class*="option"], [class*="item"]', els => 
    els.map(e => e.textContent?.trim()).filter(t => t && t.length < 10).slice(0, 30)
  );
  console.log('标签选项:', tagOptions);
  
  // 找科幻/系统/逆袭/群像/热血等标签
  const tagsToSelect = ['科幻', '系统', '逆袭', '群像', '热血'];
  for (const tag of tagsToSelect) {
    const found = await page.evaluate((t) => {
      const all = document.querySelectorAll('*');
      for (const el of all) {
        if (el.textContent?.trim() === t && el.offsetHeight > 0 && el.tagName !== 'BODY') {
          el.click();
          return true;
        }
      }
      return false;
    }, tag);
    console.log(`标签 "${tag}": ${found ? '已选' : '未找到'}`);
    await new Promise(r => setTimeout(r, 500));
  }
  
  await new Promise(r => setTimeout(r, 1000));
  
  // 截图确认
  await page.screenshot({ path: '/tmp/fanqie-tags-selected.png', fullPage: true });
  console.log('标签选择截图已保存');
  
  // 点立即创建
  await page.click('button:has-text("立即创建")');
  console.log('已点击立即创建');
  
  await new Promise(r => setTimeout(r, 5000));
  
  // 检查结果
  console.log('URL:', page.url());
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 1500));
  console.log('页面文本:', bodyText.substring(0, 800));
  
  await page.screenshot({ path: '/tmp/fanqie-after-create.png', fullPage: true });
  console.log('创建后截图已保存');
  
  await browser.close();
})().catch(e => console.error(e.message));
