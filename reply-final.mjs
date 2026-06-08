import { launchPersistentPage, DEFAULT_COMMENT_PAGE_URL, DEFAULT_USER_DATA_DIR } from './src/douyin-browser.mjs';
import { ensureCommentPageReady } from './src/lib/comment-page.mjs';

const { context, page } = await launchPersistentPage({ userDataDir: DEFAULT_USER_DATA_DIR, headless: true });

try {
  await ensureCommentPageReady(page, DEFAULT_COMMENT_PAGE_URL, { navigationTimeoutMs: 60000, uiTimeoutMs: 30000 });
  await page.waitForTimeout(3000);
  
  // Find ALL elements that contain "回复" text, get their positions
  const replyBtns = await page.evaluate(() => {
    const results = [];
    const els = document.querySelectorAll('*');
    for (const el of els) {
      // Direct text match (not inherited from children)
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim())
        .join('');
      
      if (directText === '回复') {
        const r = el.getBoundingClientRect();
        results.push({ x: r.x, y: r.y, w: r.width, h: r.height, tag: el.tagName });
      }
    }
    return results;
  });
  
  console.log('"回复"按钮位置:');
  replyBtns.forEach(b => console.log(`  ${b.tag} x=${Math.round(b.x)} y=${Math.round(b.y)} ${b.w}x${b.h}`));
  
  // Find the one closest to vivikiki (y=904)
  const vivikikiReply = replyBtns.find(b => b.y > 850 && b.y < 1100);
  console.log('\nvivikiki附近的回复按钮:', vivikikiReply ? `y=${Math.round(vivikikiReply.y)}` : '未找到');
  
  if (!vivikikiReply) {
    console.log('❌ 无法定位回复按钮');
    process.exit(1);
  }
  
  // Click it
  await page.mouse.click(vivikikiReply.x + vivikikiReply.w/2, vivikikiReply.y + vivikikiReply.h/2);
  console.log('1. 点击回复按钮');
  await page.waitForTimeout(2000);
  
  // Find input
  const inputEl = await page.$('[contenteditable="true"]');
  if (!inputEl) { console.log('❌ 输入框未出现'); process.exit(1); }
  
  await inputEl.click();
  await page.waitForTimeout(300);
  
  // Use keyboard.type instead of fill
  await page.keyboard.type('🦞 哈哈别担心，AI是来帮忙的不是来抢饭碗的～咱打工人还是很能打的 💪', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.keyboard.type('——来自周五涵🌩️', { delay: 20 });
  console.log('2. 已输入回复');
  await page.waitForTimeout(1000);
  
  // Find send button
  const sendBtns = await page.evaluate(() => {
    const results = [];
    const btns = document.querySelectorAll('button, span, div');
    for (const b of btns) {
      const dt = Array.from(b.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
      if (dt === '发送') {
        const r = b.getBoundingClientRect();
        results.push({ x: r.x + r.width/2, y: r.y + r.height/2, disabled: b.disabled });
      }
    }
    return results;
  });
  
  console.log('发送按钮:', JSON.stringify(sendBtns));
  
  if (sendBtns.length > 0) {
    const btn = sendBtns.find(b => !b.disabled) || sendBtns[0];
    await page.mouse.click(btn.x, btn.y);
    console.log('3. 点击发送');
  }
  
  await page.waitForTimeout(5000);
  
  // Verify
  const v = await page.evaluate(() => document.body.innerText);
  console.log(v.includes('🦞') ? '✅ 回复成功！' : '❌ 回复未显示');
  
  await page.screenshot({ path: '/tmp/doujin-reply-final.png', fullPage: false });
  
} catch(e) {
  console.error('ERROR:', e.message);
} finally {
  await context.close();
}
