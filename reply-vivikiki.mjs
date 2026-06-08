import { launchPersistentPage, DEFAULT_COMMENT_PAGE_URL, DEFAULT_USER_DATA_DIR } from './src/douyin-browser.mjs';
import { ensureCommentPageReady } from './src/lib/comment-page.mjs';

const { context, page } = await launchPersistentPage({ userDataDir: DEFAULT_USER_DATA_DIR, headless: true });

try {
  await ensureCommentPageReady(page, DEFAULT_COMMENT_PAGE_URL, { navigationTimeoutMs: 60000, uiTimeoutMs: 30000 });
  await page.waitForTimeout(3000);
  
  // Step 1: Find vivikiki's container and get reply button coords
  const coords = await page.evaluate(() => {
    const els = document.querySelectorAll('*');
    let target = null;
    for (const el of els) {
      if (el.childNodes.length <= 1 && el.textContent?.trim() === 'vivikiki' && el.children.length === 0) {
        target = el;
        break;
      }
    }
    if (!target) return null;
    
    let p = target;
    for (let i = 0; i < 10; i++) {
      p = p.parentElement;
      if (!p) return null;
      const spans = p.querySelectorAll('span, a');
      for (const s of spans) {
        if (s.textContent?.trim() === '回复') {
          const r = s.getBoundingClientRect();
          return { replyX: r.x + r.width/2, replyY: r.y + r.height/2, replyW: r.width };
        }
      }
    }
    return null;
  });
  
  if (!coords) { console.log('❌ 找不到回复按钮'); process.exit(1); }
  
  // Step 2: Click reply button
  await page.mouse.click(coords.replyX, coords.replyY);
  console.log('1. 点击回复按钮');
  await page.waitForTimeout(2000);
  
  // Step 3: Locate input box
  const inputBox = await page.evaluate(() => {
    const inputs = document.querySelectorAll('[contenteditable="true"]');
    if (inputs.length === 0) return null;
    const last = inputs[inputs.length - 1];
    const r = last.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  
  if (!inputBox) { console.log('❌ 输入框未出现'); process.exit(1); }
  console.log('2. 输入框位置:', JSON.stringify(inputBox));
  
  // Step 4: Click input to focus
  await page.mouse.click(inputBox.x + 10, inputBox.y + 10);
  await page.waitForTimeout(500);
  
  // Step 5: Type reply using keyboard (not fill) - fill might not trigger React events
  await page.keyboard.type('🦞 哈哈别担心，AI是来帮忙的不是来抢饭碗的～咱打工人还是很能打的 💪\n\n——来自周五涵🌩️', { delay: 30 });
  console.log('3. 已输入回复内容（keyboard.type）');
  await page.waitForTimeout(1000);
  
  // Step 6: Find and click send
  const sendCoords = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent?.trim() === '发送' && !b.disabled) {
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width/2, y: r.y + r.height/2 };
      }
    }
    return null;
  });
  
  if (sendCoords) {
    await page.mouse.click(sendCoords.x, sendCoords.y);
    console.log('4. 点击发送按钮');
  } else {
    // Try pressing Enter
    await page.keyboard.press('Enter');
    console.log('4. 按Enter发送');
  }
  
  await page.waitForTimeout(5000);
  
  // Step 7: Verify
  await page.screenshot({ path: '/tmp/douyin-final-verify.png', fullPage: false });
  const v = await page.evaluate(() => document.body.innerText);
  const ok = v.includes('🦞') || v.includes('打工人');
  console.log(ok ? '✅ 回复成功！' : '❌ 回复未显示');
  
} catch(e) {
  console.error('ERROR:', e.message);
} finally {
  await context.close();
}
