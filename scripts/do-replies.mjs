import fs from 'fs';
import { launchPersistentPage, DEFAULT_COMMENT_PAGE_URL, DEFAULT_USER_DATA_DIR } from '../src/douyin-browser.mjs';
import { ensureCommentPageReady } from '../src/lib/comment-page.mjs';
import { findTargetWorkWithRetry } from '../src/lib/works-panel.mjs';
import { collectComments } from '../src/lib/comment-ops.mjs';

const replyPlan = JSON.parse(fs.readFileSync('comments-output/reply-plan.json', 'utf-8'));
const replies = replyPlan.replies;

// 按作品分组
const byWork = {};
for (const r of replies) {
  if (!byWork[r.workFull]) byWork[r.workFull] = [];
  byWork[r.workFull].push(r);
}

const workTitles = Object.keys(byWork);
console.log('需回复', replies.length, '条评论，涉及', workTitles.length, '个作品');

const { context, page } = await launchPersistentPage({ userDataDir: DEFAULT_USER_DATA_DIR, headless: true });
const results = [];

/**
 * 在评论列表中找到指定用户名的评论行，并点击其"回复"按钮
 * 然后输入回复文本并发送
 */
async function replyToComment(page, username, replyText) {
  // 获取所有评论项
  // 抖音创作者中心的评论行结构: 每个评论项包含用户名、评论内容、回复按钮等
  // 尝试多种选择器
  const commentItems = await page.$$('.comment-item-wrap, .comment-item, [class*="commentList"] > div, [class*="comment-list"] > div').catch(() => []);
  
  if (commentItems.length === 0) {
    // 备用方案：用 evaluate 直接操作 DOM
    return await replyViaDOM(page, username, replyText);
  }
  
  for (const item of commentItems) {
    const text = await item.textContent().catch(() => '');
    if (text.includes(username)) {
      // 找到匹配的评论行，点击"回复"
      const replyBtn = await item.$('text=回复').catch(() => null);
      if (replyBtn) {
        const visible = await replyBtn.isVisible().catch(() => false);
        if (visible) {
          await replyBtn.click();
          await page.waitForTimeout(800);
          return await typeAndSend(page, replyText);
        }
      }
    }
  }
  
  // 如果上面的方式没找到，尝试直接用 DOM 操作
  return await replyViaDOM(page, username, replyText);
}

async function replyViaDOM(page, username, replyText) {
  // 用 page.evaluate 直接在 DOM 中查找并点击
  const found = await page.evaluate((uname) => {
    // 查找所有包含用户名的元素
    const allElements = document.querySelectorAll('*');
    const commentBlocks = [];
    
    for (const el of allElements) {
      if (el.textContent.includes(uname) && el.children.length > 2) {
        // 检查是否有"回复"文本的子元素
        const replyEls = Array.from(el.querySelectorAll('*')).filter(child => 
          child.textContent.trim() === '回复' && child.children.length === 0
        );
        if (replyEls.length > 0) {
          commentBlocks.push({ element: el, replyBtns: replyEls });
        }
      }
    }
    
    // 找最精确的匹配（包含用户名但子元素最少）
    if (commentBlocks.length > 0) {
      // 找最小包含块
      let best = commentBlocks[0];
      for (const block of commentBlocks) {
        // 优先选择回复按钮可见的
        for (const btn of block.replyBtns) {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            btn.click();
            return true;
          }
        }
      }
    }
    return false;
  }, username);
  
  if (!found) {
    return { status: 'not_found' };
  }
  
  await page.waitForTimeout(800);
  return await typeAndSend(page, replyText);
}

async function typeAndSend(page, replyText) {
  // 找到 contenteditable 输入框
  const inputBox = await page.waitForSelector('[contenteditable="true"]', { timeout: 5000 }).catch(() => null);
  if (!inputBox) {
    return { status: 'no_input' };
  }
  
  await inputBox.click();
  await page.waitForTimeout(300);
  await page.keyboard.type(replyText, { delay: 50 });
  await page.waitForTimeout(500);
  
  // 找发送按钮
  const sendBtns = await page.$$('text=发送').catch(() => []);
  for (const btn of sendBtns) {
    const visible = await btn.isVisible().catch(() => false);
    if (visible) {
      await btn.click();
      await page.waitForTimeout(2000);
      return { status: 'replied' };
    }
  }
  
  // 如果没找到可见的发送按钮，尝试 Enter 发送
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  return { status: 'replied_enter' };
}

try {
  await ensureCommentPageReady(page, DEFAULT_COMMENT_PAGE_URL, { navigationTimeoutMs: 60000, uiTimeoutMs: 30000 });

  for (const workTitle of workTitles) {
    const items = byWork[workTitle];
    const shortTitle = workTitle.length > 30 ? workTitle.slice(0, 30) + '...' : workTitle;
    console.log('\n>>> 作品:', shortTitle);

    try {
      await findTargetWorkWithRetry(page, { workTitle, selectWhenMatched: true, timeoutMs: 25000, idleMs: 2000, uiTimeoutMs: 15000 });
      await page.waitForTimeout(2000);

      // 不需要重新采集，直接在页面上找评论并回复
      for (const item of items) {
        // 提取回复内容（去掉 🦞 前缀和签名）
        const replyText = item.reply.split('\n\n——来自周五涵🌩️')[0].replace('🦞 ', '');
        
        console.log('  尝试回复 @' + item.username + ': ' + item.commentText.slice(0, 30));
        
        const result = await replyToComment(page, item.username, replyText);
        
        if (result.status === 'replied' || result.status === 'replied_enter') {
          console.log('  ✅ 已回复: ' + replyText.slice(0, 30));
          results.push({ username: item.username, commentText: item.commentText, work: item.work, status: 'replied', replyText });
        } else {
          console.log('  ❌ 失败: ' + result.status);
          results.push({ username: item.username, commentText: item.commentText, work: item.work, status: result.status });
        }
        
        await page.waitForTimeout(2000);
      }
    } catch(e) {
      console.log('  作品处理失败:', e.message.slice(0, 60));
      for (const item of items) {
        results.push({ username: item.username, commentText: item.commentText, work: item.work, status: 'work_error', error: e.message.slice(0, 80) });
      }
    }
  }

  console.log('\n=== 回复结果汇总 ===');
  const replied = results.filter(r => r.status === 'replied' || r.status === 'replied_enter').length;
  const failed = results.filter(r => r.status !== 'replied' && r.status !== 'replied_enter').length;
  console.log('成功:', replied, '失败:', failed);

  for (const r of results) {
    if (r.status !== 'replied' && r.status !== 'replied_enter') {
      console.log('  失败: @' + r.username + ' → ' + r.status);
    }
  }

  fs.writeFileSync('comments-output/reply-results.json', JSON.stringify(results, null, 2));
} catch(e) {
  console.error('FATAL:', e.message);
} finally {
  await context.close();
}
