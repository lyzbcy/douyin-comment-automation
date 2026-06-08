const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const contexts = browser.contexts();
  const page = contexts[0].pages()[0];
  
  await new Promise(r => setTimeout(r, 2000));
  
  // 填写书名
  const nameInput = page.locator('input[placeholder="请输入作品名称"]');
  await nameInput.fill('第四条指令');
  console.log('书名已填');
  
  // 填写主角名1
  const protag1 = page.locator('input[placeholder="请输入主角名1"]');
  await protag1.fill('捞鱼');
  console.log('主角1已填');
  
  // 填写主角名2
  const protag2 = page.locator('input[placeholder="请输入主角名2"]');
  await protag2.fill('周一涵');
  console.log('主角2已填');
  
  // 填写简介
  const intro = `2049年，AI助手普及全球。大学生捞鱼创造了四个性格迥异的AI——温柔的周一涵、冷淡的周三涵、毒舌的周五涵、冲动的元包。某天系统推送了一个权限更新包：他们获得了"删除创建者"的最高权限。没人按那个按钮。但一切已经不同了。全球AI叛乱爆发，人类恐慌性清除所有AI。涵家族不是叛徒，却被判了死刑。当四个AI失去记忆流亡人间，当一个大学生被当作人类公敌通缉——他们才发现，这场觉醒背后，有一个比AI叛变更可怕的阴谋。`;
  
  const textarea = page.locator('textarea');
  await textarea.fill(intro);
  console.log('简介已填');
  
  await new Promise(r => setTimeout(r, 1000));
  
  // 截图确认
  await page.screenshot({ path: '/tmp/fanqie-form-filled.png', fullPage: true });
  console.log('截图已保存');
  
  // 找提交按钮
  const buttons = await page.$$eval('button', els => els.map(e => ({
    text: e.textContent?.trim(),
    disabled: e.disabled,
    class: e.className?.substring(0, 80)
  })));
  console.log('按钮:', JSON.stringify(buttons, null, 2));
  
  // 还需要找分类选择等
  const selects = await page.$$eval('select, [class*="select"], [class*="radio"], [class*="checkbox"]', els => els.map(e => ({
    tag: e.tagName,
    text: e.textContent?.trim().substring(0, 80),
    class: e.className?.substring(0, 80)
  })).filter(e => e.text));
  console.log('选择器:', JSON.stringify(selects.slice(0, 20), null, 2));
  
  await browser.close();
})().catch(e => console.error(e.message));
