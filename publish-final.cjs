const { chromium } = require('playwright');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const p = b.contexts()[0].pages()[0];
  
  const click = async (text) => {
    await p.evaluate((t) => {
      document.querySelectorAll('.arco-modal-mask').forEach(e => e.remove());
      document.querySelectorAll('.arco-modal-wrapper').forEach(e => { e.style.pointerEvents = 'auto'; });
      const btns = document.querySelectorAll('button');
      for (const b of btns) { if (b.textContent?.trim() === t && b.offsetHeight > 0) { b.click(); return true; } }
      return false;
    }, text);
  };
  
  // 忽略全部
  await click('忽略全部');
  await p.waitForTimeout(1000);
  
  // 下一步
  await click('下一步');
  console.log('下一步');
  await p.waitForTimeout(3000);
  
  // 提交
  await click('提交');
  console.log('提交');
  await p.waitForTimeout(2000);
  
  // 确定
  await click('确定');
  console.log('确定');
  await p.waitForTimeout(2000);
  
  // 选是
  await p.evaluate(() => {
    const labels = document.querySelectorAll('label.arco-radio');
    for (const l of labels) { if (l.textContent?.trim() === '是' && l.offsetHeight > 0) { l.click(); break; } }
  });
  console.log('选是');
  await p.waitForTimeout(1000);
  
  // 确认发布
  await click('确认发布');
  console.log('确认发布');
  await p.waitForTimeout(8000);
  
  console.log('URL:', p.url());
  if (p.url().includes('chapter-manage')) {
    console.log('✅ 发布成功!');
  } else {
    const btns = await p.evaluate(() => Array.from(document.querySelectorAll('button')).filter(b=>b.offsetHeight>0).map(b=>b.textContent?.trim()).filter(t=>t).slice(0,10));
    console.log('当前按钮:', JSON.stringify(btns));
  }
  
  await b.close();
})().catch(e => console.error(e.message));
