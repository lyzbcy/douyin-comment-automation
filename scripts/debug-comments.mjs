import fs from 'fs';
import { launchPersistentPage, DEFAULT_COMMENT_PAGE_URL, DEFAULT_USER_DATA_DIR } from '../src/douyin-browser.mjs';
import { ensureCommentPageReady } from '../src/lib/comment-page.mjs';
import { findTargetWorkWithRetry } from '../src/lib/works-panel.mjs';

const { context, page } = await launchPersistentPage({ userDataDir: DEFAULT_USER_DATA_DIR, headless: true });
try {
  await ensureCommentPageReady(page, DEFAULT_COMMENT_PAGE_URL, { navigationTimeoutMs: 60000, uiTimeoutMs: 30000 });
  
  await findTargetWorkWithRetry(page, { workTitle: '后天见～', selectWhenMatched: true, timeoutMs: 25000, idleMs: 2000, uiTimeoutMs: 15000 });
  await page.waitForTimeout(2000);

  // 获取第一个评论行的 operations 区域完整 HTML
  const opsHTML = await page.evaluate(() => {
    const ops = document.querySelectorAll('.operations-WFV7Am');
    const results = [];
    for (const op of ops) {
      const container = op.closest('.container-sXKyMs');
      const uname = container?.querySelector('.username-aLgaNB')?.textContent || '';
      if (uname === '🎀星星布丁🎀' || uname === '糕冷茄子🍆' || uname === '小泽又沐春风') {
        results.push({
          username: uname,
          operationsHTML: op.innerHTML,
          operationItems: Array.from(op.querySelectorAll('.item-M3fSkJ')).map(item => ({
            text: item.textContent.trim(),
            class: item.className
          }))
        });
      }
    }
    return results;
  });
  
  console.log('Operations HTML:', JSON.stringify(opsHTML, null, 2));

  // 也看看有没有 "回复" 文字作为独立的可点击元素
  const replyCheck = await page.evaluate(() => {
    const all = document.querySelectorAll('.item-M3fSkJ');
    const results = [];
    for (const el of all) {
      const text = el.textContent.trim();
      if (text === '回复' || text.includes('回复')) {
        results.push({
          text: text,
          rect: el.getBoundingClientRect(),
          visible: el.offsetWidth > 0 && el.offsetHeight > 0,
          class: el.className
        });
      }
    }
    return results;
  });
  
  console.log('\n回复按钮:', JSON.stringify(replyCheck, null, 2));
  
  // 检查所有 .item-M3fSkJ 的文本内容
  const allItems = await page.evaluate(() => {
    const items = document.querySelectorAll('.item-M3fSkJ');
    return Array.from(items).slice(0, 30).map(el => ({
      text: el.textContent.trim().slice(0, 30),
      visible: el.offsetWidth > 0 && el.offsetHeight > 0,
      container: el.closest('.container-sXKyMs')?.querySelector('.username-aLgaNB')?.textContent || ''
    }));
  });
  
  console.log('\n所有 .item-M3fSkJ:', JSON.stringify(allItems, null, 2));

} catch(e) {
  console.error('ERROR:', e.message);
} finally {
  await context.close();
}
