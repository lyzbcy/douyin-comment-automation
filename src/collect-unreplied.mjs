#!/usr/bin/env node
/**
 * collect-unreplied.mjs — 逐作品采集抖音未回复评论
 *
 * 用法：
 *   node src/collect-unreplied.mjs [options]
 *
 * 选项：
 *   --works <path>    作品列表 JSON 路径（默认 comments-output/list-works.json）
 *   --out <path>      输出文件路径（默认 comments-output/unreplied-latest.json）
 *   --limit <n>       每个作品最多采集条数（默认 50）
 *   --max-works <n>   最多检查作品数（默认 10）
 *   --headless        无头模式运行（默认启用）
 *   --no-headless     显示浏览器窗口（调试用）
 *
 * 输出：
 *   - stdout：逐作品采集进度
 *   - 文件：JSON 格式的未回复评论列表
 *
 * 退出码：
 *   0  正常完成
 *   1  参数错误或文件系统错误
 *   2  登录态失效（需手动登录）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { launchPersistentPage, DEFAULT_COMMENT_PAGE_URL, DEFAULT_USER_DATA_DIR } from './douyin-browser.mjs';
import { ensureCommentPageReady } from './lib/comment-page.mjs';
import { findTargetWorkWithRetry } from './lib/works-panel.mjs';
import { collectComments } from './lib/comment-ops.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { headless: true, limit: 50, maxWorks: 10 };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--works') args.worksPath = argv[++i];
    else if (arg === '--out') args.outPath = argv[++i];
    else if (arg === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (arg === '--max-works') args.maxWorks = parseInt(argv[++i], 10);
    else if (arg === '--headless') args.headless = true;
    else if (arg === '--no-headless') args.headless = false;
    else if (arg === '--help' || arg === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf-8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, ''));
      process.exit(0);
    }
  }
  args.worksPath = args.worksPath || path.join(PROJECT_ROOT, 'comments-output', 'list-works.json');
  args.outPath = args.outPath || path.join(PROJECT_ROOT, 'comments-output', 'unreplied-latest.json');
  return args;
}

// ---------------------------------------------------------------------------
// Login check — robust multi-signal detection
// ---------------------------------------------------------------------------
function isLoginExpired(pageUrl) {
  return /\/login|\/passport|\/passport[-_]/i.test(pageUrl);
}

/**
 * Robust login check: verifies the page is actually on the creator center
 * by looking for the "选择作品" button, not just checking the URL.
 * Returns true only if we're confident the login has expired.
 */
async function isLoginExpiredRobust(page, options = {}) {
  const url = page.url();

  // Fast check: obvious login/passport redirect
  if (isLoginExpired(url)) {
    // Double-check: wait briefly for potential redirect back
    await page.waitForTimeout(2000);
    const urlAfter = page.url();
    if (isLoginExpired(urlAfter)) {
      // URL still points to login — confirm by checking DOM
      const hasLoginElement = await page.evaluate(() => {
        const text = (document.body.innerText || '').toLowerCase();
        return text.includes('扫码登录') || text.includes('账号登录') ||
               text.includes('密码登录') || !!document.querySelector('input[type="password"]');
      });
      if (hasLoginElement) return true;
    }
  }

  // Check for key creator center elements
  const hasCreatorElements = await page.evaluate(() => {
    return !!document.querySelector('[role="button"][class*="select"], button[class*="select"]') ||
           document.body.innerText.includes('选择作品') ||
           document.body.innerText.includes('评论管理');
  });

  if (hasCreatorElements) return false;

  // Neither login page nor creator center — page may still be loading
  // Wait and retry once
  await page.waitForTimeout(3000);
  const retryHasCreator = await page.evaluate(() => {
    return document.body.innerText.includes('选择作品') ||
           document.body.innerText.includes('评论管理');
  });

  return !retryHasCreator;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);

  // Validate works file
  if (!fs.existsSync(args.worksPath)) {
    console.error(`ERROR: 作品列表不存在: ${args.worksPath}`);
    console.error('请先运行: npm run works -- --headless');
    process.exit(1);
  }

  const worksData = JSON.parse(fs.readFileSync(args.worksPath, 'utf-8'));
  const works = worksData.works || [];
  const checkCount = Math.min(args.maxWorks, works.length);

  console.log(`共 ${works.length} 个作品，本次检查前 ${checkCount} 个`);

  const { context, page } = await launchPersistentPage({
    userDataDir: DEFAULT_USER_DATA_DIR,
    headless: args.headless,
  });

  const allUnreplied = [];
  let loginExpired = false;

  try {
    await ensureCommentPageReady(page, DEFAULT_COMMENT_PAGE_URL, {
      navigationTimeoutMs: 60000,
      uiTimeoutMs: 30000,
    });

    // Check login status after navigation (robust multi-signal)
    if (await isLoginExpiredRobust(page)) {
      console.error('LOGIN_EXPIRED: 登录态已失效，请手动登录');
      loginExpired = true;
      return;
    }

    for (let i = 0; i < checkCount; i++) {
      const title = works[i].title || '';
      const short = title.length > 25 ? title.slice(0, 25) + '...' : title;
      process.stdout.write(`[${i + 1}/${checkCount}] ${short}: `);

      try {
        await findTargetWorkWithRetry(page, {
          workTitle: title,
          selectWhenMatched: true,
          timeoutMs: 25000,
          idleMs: 2000,
          uiTimeoutMs: 15000,
        });
        await page.waitForTimeout(1500);

        const comments = await collectComments(page, {
          limit: args.limit,
          timeoutMs: 30000,
          idleMs: 3000,
          uiTimeoutMs: 8000,
        });

        if (comments.length > 0) {
          console.log(`${comments.length}条未回复`);
          for (const c of comments) {
            const text = (c.commentText || '').slice(0, 50);
            allUnreplied.push({
              username: c.username,
              commentText: c.commentText,
              work: short,
              workFull: title,
            });
            console.log(`    @${c.username}: ${text}`);
          }
        } else {
          console.log('✅ 无未回复');
        }
      } catch (e) {
        // Check for login expiration in error messages (strict patterns only)
        if (/StatusCode[^0-9]*8\b|用户未登录|session.*expired|登录.*过期|登录.*失效/i.test(e.message)) {
          console.error('LOGIN_EXPIRED: 登录态已失效');
          loginExpired = true;
          break;
        }
        console.log(`跳过(${e.message.slice(0, 40)})`);
      }
    }

    console.log('\n=== 汇总 ===');
    console.log(`未回复评论: ${allUnreplied.length} 条`);

    // Ensure output directory exists
    const outDir = path.dirname(args.outPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    fs.writeFileSync(
      args.outPath,
      JSON.stringify({ count: allUnreplied.length, comments: allUnreplied }, null, 2)
    );
    console.log(`已写入: ${args.outPath}`);
  } catch (e) {
    if (/StatusCode[^0-9]*8\b|用户未登录|session.*expired|登录.*过期|登录.*失效/i.test(e.message)) {
      console.error('LOGIN_EXPIRED: 登录态已失效，请手动登录');
      loginExpired = true;
    } else {
      console.error('ERROR:', e.message);
    }
  } finally {
    await context.close();
    if (loginExpired) process.exit(2);
  }
}

main();
