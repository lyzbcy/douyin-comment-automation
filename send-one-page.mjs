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

for (let idx = 0; idx < pages.length; idx++) {
  const replyText = pages[idx];
  console.log(`Sending page ${idx+1}/${pages.length}...`);
  
  // Click reply via JS
  const clicked = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.children.length === 0 && el.textContent?.trim() === 'vivikiki') {
        let c = el;
        for (let i = 0; i < 10; i++) { c = c.parentElement; if (!c) break; }
        if (c) {
          const btns = c.querySelectorAll('*');
          for (const b of btns) {
            if (b.textContent?.trim() === '回复' && b.offsetParent !== null && b.children.length === 0) {
              b.click(); return true;
            }
          }
        }
      }
    }
    return false;
  });
  if (!clicked) { console.log("FAIL: no reply button"); await browser.close(); process.exit(1); }
  await page.waitForTimeout(1500);
  
  const input = await page.waitForSelector('div[contenteditable="true"]', { timeout: 5000 });
  await input.fill(replyText);
  await page.waitForTimeout(800);
  
  const sent = await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent?.trim() === '发送' && b.offsetParent !== null) { b.click(); return true; }
    }
    return false;
  });
  if (!sent) { console.log("FAIL: no send button"); await browser.close(); process.exit(1); }
  
  console.log(`Page ${idx+1} done!`);
  if (idx < pages.length - 1) await page.waitForTimeout(6000);
}

const log = { lastSendTime: new Date().toISOString(), lastSendDate: new Date().toISOString().split('T')[0], diaryDate: "2026-05-18" };
fs.writeFileSync(path.resolve("comments-output/diary-send-log.json"), JSON.stringify(log, null, 2));
console.log("All done! Log updated.");
await browser.close();
