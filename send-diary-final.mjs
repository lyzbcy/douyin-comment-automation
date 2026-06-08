import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const profileDir = path.resolve(".playwright/douyin-profile");
const COMMENT_URL = "https://creator.douyin.com/creator-micro/interactive/comment";
const pages = JSON.parse(fs.readFileSync("/tmp/diary_pages.json", "utf-8"));

const browser = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});

const page = browser.pages()[0] || await browser.newPage();
await page.goto(COMMENT_URL, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(3000);

// Find the vivikiki username element
const vivikikiEl = await page.waitForSelector('.username-aLgaNB', { timeout: 10000 })
  .catch(() => null);
if (!vivikikiEl) {
  console.log("FAIL: vivikiki not found");
  await browser.close();
  process.exit(1);
}

// Get the parent comment container
const commentRow = await vivikikiEl.evaluateHandle(el => {
  let p = el;
  for (let i = 0; i < 15; i++) {
    p = p.parentElement;
    if (!p) break;
    // Check if this container has action buttons like "回复|删除|举报"
    if (p.textContent?.includes('删除') && p.textContent?.includes('举报')) return p;
  }
  return el.parentElement;
});

// Hover over the comment row to reveal the "回复" button
console.log("Hovering over vivikiki's comment...");
await commentRow.asElement().hover();
await page.waitForTimeout(1000);

// Now try to find the 回复 button
const replyClicked = await page.evaluate((el) => {
  const btns = el.querySelectorAll('*');
  for (const b of btns) {
    const t = b.textContent?.trim();
    if (t === '回复' && b.children.length === 0 && b.offsetParent !== null) {
      b.click();
      return true;
    }
  }
  return false;
}, commentRow.asElement());

if (!replyClicked) {
  console.log("FAIL: no reply button after hover");
  // Try data-codex-reply-action attribute
  const codexClicked = await page.evaluate((el) => {
    const btn = el.querySelector('[data-codex-reply-action]');
    if (btn) { btn.click(); return true; }
    return false;
  }, commentRow.asElement());
  if (!codexClicked) {
    await page.screenshot({ path: "/tmp/diary-debug-hover.png" });
    await browser.close();
    process.exit(1);
  }
}

console.log("Reply button clicked!");
await page.waitForTimeout(2000);

// Now send each page
for (let idx = 0; idx < pages.length; idx++) {
  const replyText = pages[idx];
  console.log(`Sending page ${idx+1}/${pages.length}...`);
  
  // If not first page, need to click reply again
  if (idx > 0) {
    await commentRow.asElement().hover();
    await page.waitForTimeout(1000);
    await page.evaluate((el) => {
      const btns = el.querySelectorAll('*');
      for (const b of btns) {
        if (b.textContent?.trim() === '回复' && b.children.length === 0 && b.offsetParent !== null) {
          b.click(); return;
        }
      }
    }, commentRow.asElement());
    await page.waitForTimeout(1500);
  }
  
  const input = await page.waitForSelector('div[contenteditable="true"]', { timeout: 5000 });
  await input.fill(replyText);
  await page.waitForTimeout(800);
  
  const sent = await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent?.trim() === '发送' && b.offsetParent !== null) { b.click(); return true; }
    }
    return false;
  });
  if (!sent) { console.log("FAIL: send"); await browser.close(); process.exit(1); }
  
  console.log(`Page ${idx+1} sent!`);
  if (idx < pages.length - 1) await page.waitForTimeout(6000);
}

const log = { lastSendTime: new Date().toISOString(), lastSendDate: new Date().toISOString().split('T')[0], diaryDate: "2026-05-18" };
fs.writeFileSync(path.resolve("comments-output/diary-send-log.json"), JSON.stringify(log, null, 2));
console.log("All done!");
await browser.close();
