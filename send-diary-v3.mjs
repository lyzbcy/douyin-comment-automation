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

// Find all "查看X条回复" buttons and click the one near vivikiki
console.log("Expanding vivikiki's replies...");

// First find the vivikiki comment container by searching for the comment text
const expanded = await page.evaluate(() => {
  const replyBtns = document.querySelectorAll('.reply-list-QwXCb_');
  for (const btn of replyBtns) {
    // Walk up to find if this is near vivikiki
    let parent = btn;
    for (let i = 0; i < 15; i++) {
      parent = parent.parentElement;
      if (!parent) break;
      if (parent.textContent?.includes('vivikiki') && parent.textContent?.includes('ai，那就是马上没有工作咯')) {
        btn.click();
        return btn.textContent?.trim();
      }
    }
  }
  return null;
});
console.log("Expanded:", expanded);
await page.waitForTimeout(2000);

// Now after expanding, check the DOM structure for the reply input
// In Douyin comment management, clicking "回复" on a comment opens an input inline
// Let me look for the comment row and its action buttons more carefully

// Find the specific comment row for vivikiki
const commentInfo = await page.evaluate(() => {
  const allUsernames = document.querySelectorAll('.username-aLgaNB');
  for (const u of allUsernames) {
    if (u.textContent?.trim() === 'vivikiki') {
      // Go up to find the comment container
      let p = u;
      for (let i = 0; i < 8; i++) {
        p = p.parentElement;
        if (!p) break;
      }
      // Now find all leaf elements with short text
      const leaves = [];
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_ELEMENT);
      let node;
      while (node = walker.nextNode()) {
        if (node.children.length === 0 || node.childNodes.length === 1 && node.childNodes[0].nodeType === 3) {
          const text = node.textContent?.trim();
          if (text && text.length < 30) {
            const rect = node.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              leaves.push({ text, tag: node.tagName, class: node.className?.substring(0, 50), y: Math.round(rect.y) });
            }
          }
        }
      }
      return { leaves: leaves.slice(0, 30) };
    }
  }
  return null;
});
console.log("vivikiki comment info:", JSON.stringify(commentInfo, null, 2));

// Try a different approach: use the comment action area
// In the Douyin creator comment management, the reply action is a clickable text inside the comment item
// Let me try clicking directly using coordinates

// Get vivikiki comment area position
const vivikikiBox = await page.evaluate(() => {
  const els = document.querySelectorAll('.username-aLgaNB');
  for (const el of els) {
    if (el.textContent?.trim() === 'vivikiki') {
      // Find the comment-content-text element nearby
      let p = el.parentElement;
      for (let i = 0; i < 5; i++) { p = p.parentElement; if (!p) break; }
      const commentText = p?.querySelector('.comment-content-text-JvmAKq');
      if (commentText) {
        const rect = commentText.getBoundingClientRect();
        return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, text: commentText.textContent };
      }
    }
  }
  return null;
});
console.log("Comment text position:", vivikikiBox);

await page.screenshot({ path: "/tmp/diary-debug-expanded.png" });
console.log("Screenshot saved");

await browser.close();
