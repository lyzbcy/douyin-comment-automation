/**
 * scrape-video-stats.mjs
 *
 * Scrape video performance data from Douyin Creator Center using Playwright.
 * Cross-platform (Windows/Linux/macOS) — no AppleScript dependency.
 *
 * Flow:
 *   1. Launch persistent browser (reuse login session)
 *   2. Navigate to data-center/content page
 *   3. Wait for Garfish micro-frontend to load
 *   4. Switch to "投稿列表" tab
 *   5. Click "刷新数据" → wait
 *   6. Click "导出数据" → intercept download
 *   7. Parse xlsx → store in SQLite
 *
 * Usage:
 *   npm run scrape:stats [-- --headless]
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { getDb, closeDb } from "./lib/db.mjs";
import { normalizePercent } from "./lib/normalizers.mjs";

// ── Configuration ──────────────────────────────────────────────────────────

const DATA_CENTER_URL = "https://creator.douyin.com/creator-micro/data-center/content";
const USER_DATA_DIR = path.resolve(".playwright/douyin-profile");
const GARFISH_LOAD_TIMEOUT_MS = 20000;
const DOWNLOAD_TIMEOUT_MS = 60000;

const HEADLESS = process.argv.includes("--headless");

// charCode helpers for finding UI elements by Chinese text
function charCodesMatch(text, codes) {
  if (!text) return false;
  const chars = [...text.trim()];
  if (chars.length < codes.length) return false;
  for (let i = 0; i < chars.length - codes.length + 1; i++) {
    let match = true;
    for (let j = 0; j < codes.length; j++) {
      if (chars[i + j].charCodeAt(0) !== codes[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

// 投稿列表 = 25237,31295,21015,34920
const CHAR_CODES_SUBMISSION_LIST = [25237, 31295, 21015, 34920];
// 刷新数据 = 21047,26032,25968,25454
const CHAR_CODES_REFRESH_DATA = [21047, 26032, 25968, 25454];
// 导出数据 = 23548, 20986, 25968, 25454
const CHAR_CODES_EXPORT_DATA = [23548, 20986, 25968, 25454];

// ── Helpers ────────────────────────────────────────────────────────────────

async function waitForGarfishLoad(page, timeoutMs = GARFISH_LOAD_TIMEOUT_MS) {
  console.log("[scrape] Waiting for Garfish micro-frontend to load...");
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const loaded = await page.evaluate(() => {
      // Check for Garfish app containers with real content (not just placeholders)
      const containers = document.querySelectorAll("[id*='garfish']");
      for (const c of containers) {
        if (c.innerText && c.innerText.length > 200) return true;
      }
      // Also check for typical data-center elements
      const tabs = document.querySelectorAll('[role="tab"], .semi-tabs-tab');
      if (tabs.length >= 2) return true;
      return false;
    }).catch(() => false);

    if (loaded) {
      console.log("[scrape] Garfish loaded successfully");
      return true;
    }
    await page.waitForTimeout(500);
  }

  // Check if we're stuck in degraded mode (login expired)
  const bodyLen = await page.evaluate(() => document.body.innerText.length).catch(() => 0);
  if (bodyLen < 200) {
    throw new Error(
      `Garfish failed to load after ${timeoutMs}ms (body length: ${bodyLen}). ` +
      "This likely means the login session has expired. Please re-login."
    );
  }

  console.warn(`[scrape] Garfish load timeout (${timeoutMs}ms), proceeding anyway...`);
  return false;
}

async function clickElementByCharCodes(page, charCodes, label, timeoutMs = 10000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const clicked = await page.evaluate((codes) => {
      const elements = document.querySelectorAll("div, button, span, a, li, tab");
      for (const el of elements) {
        const text = (el.textContent || "").trim();
        if (!text) continue;
        const chars = [...text];
        for (let i = 0; i < chars.length - codes.length + 1; i++) {
          let match = true;
          for (let j = 0; j < codes.length; j++) {
            if (chars[i + j].charCodeAt(0) !== codes[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            el.click();
            return text.slice(0, 40);
          }
        }
      }
      return null;
    }, charCodes).catch(() => null);

    if (clicked) {
      console.log(`[scrape] Clicked "${label}": "${clicked}"`);
      return true;
    }
    await page.waitForTimeout(500);
  }

  console.warn(`[scrape] Could not find "${label}" element within ${timeoutMs}ms`);
  return false;
}

async function interceptExportDownload(page, triggerClick) {
  console.log("[scrape] Waiting for export download...");

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: DOWNLOAD_TIMEOUT_MS }),
    triggerClick(),
  ]);

  const suggestedName = download.suggestedFilename();
  console.log(`[scrape] Download triggered: ${suggestedName}`);

  // Check for JSON error (login expired - Mode A)
  if (suggestedName.endsWith(".json") || suggestedName.endsWith(".txt")) {
    const tmpPath = await download.path();
    if (tmpPath) {
      try {
        const content = fs.readFileSync(tmpPath, "utf8");
        const parsed = JSON.parse(content);
        if (parsed?.BaseResp?.StatusCode === 8) {
          throw new Error("Login session expired (Mode A: JSON error response). Please re-login.");
        }
      } catch (parseErr) {
        if (parseErr.message.includes("Login session expired")) throw parseErr;
      }
    }
    throw new Error(`Expected xlsx download but got: ${suggestedName}`);
  }

  // Save to temp location
  const savePath = path.resolve("data/latest-export.xlsx");
  await download.saveAs(savePath);
  console.log(`[scrape] Saved download to: ${savePath}`);
  return savePath;
}

// ── xlsx parsing (lightweight, no external dependency) ─────────────────────

/**
 * Parse xlsx using built-in Node.js capabilities.
 * Uses a dynamic import of 'xlsx' if available, otherwise falls back to
 * reading the file as a zip and parsing XML sheets.
 */
async function parseXlsx(filePath) {
  // Try using the 'xlsx' npm package if available
  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    console.log(`[scrape] Parsed ${rows.length} rows from sheet "${sheetName}"`);
    return rows;
  } catch (importErr) {
    console.warn("[scrape] 'xlsx' package not available, trying basic zip parse...");
  }

  // Fallback: basic zip-based xlsx parser using Node.js built-in zlib
  // This is a simplified parser that handles basic string cells
  const { createReadStream } = await import("node:fs");
  const zlib = await import("node:zlib");

  // For a proper fallback, we'd need to implement zip parsing.
  // For now, require the xlsx package.
  throw new Error(
    "xlsx package is required for parsing Excel files. " +
    "Install it with: npm install xlsx"
  );
}

function normalizeNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    // Handle "1.2万" format
    const wanMatch = value.match(/([\d.]+)\s*万/);
    if (wanMatch) return Math.round(parseFloat(wanMatch[1]) * 10000);
    const cleaned = value.replace(/[,%]/g, "").trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

function mapRowToStats(row) {
  // Column names may vary; try common patterns
  const title = row["作品标题"] || row["标题"] || row["视频标题"] || row["title"] || "";
  const publishDate = row["发布时间"] || row["发布日期"] || row["publish_date"] || "";
  const plays = normalizeNumber(row["播放量"] || row["播放数"] || row["plays"] || 0);
  const avgDuration = normalizeNumber(row["平均播放时长"] || row["平均播放时长(秒)"] || row["avg_duration"] || 0);
  const ctr = normalizePercent(row["点击率"] || row["5秒完播率"] || row["ctr"] || 0);
  const finishRate = normalizePercent(row["完播率"] || row["finish_rate"] || 0);
  const likes = normalizeNumber(row["点赞数"] || row["点赞"] || row["likes"] || 0);
  const comments = normalizeNumber(row["评论数"] || row["评论"] || row["comments"] || 0);
  const shares = normalizeNumber(row["分享数"] || row["分享"] || row["shares"] || 0);
  const favorites = normalizeNumber(row["收藏数"] || row["收藏"] || row["favorites"] || 0);
  const danmaku = normalizeNumber(row["弹幕数"] || row["弹幕"] || row["danmaku"] || 0);
  const status = row["状态"] || row["status"] || "公开";
  const profileVisits = normalizeNumber(row["主页访问"] || row["主页访问量"] || 0);
  const followerGain = normalizeNumber(row["新增粉丝"] || row["涨粉数"] || 0);

  return {
    title,
    publish_date: publishDate,
    plays,
    avg_duration_sec: avgDuration,
    ctr,
    finish_rate: finishRate,
    likes,
    comments,
    shares,
    favorites,
    danmaku,
    status,
    profile_visits: profileVisits,
    follower_gain: followerGain,
  };
}

// ── Database storage ───────────────────────────────────────────────────────

function storeVideoStats(rows) {
  const db = getDb();
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO video_stats
      (timestamp, title, publish_date, plays, avg_duration_sec, ctr, finish_rate,
       likes, comments, shares, favorites, danmaku, status, profile_visits, follower_gain)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertBatch = db.transaction((items) => {
    for (const item of items) {
      insert.run(
        now, item.title, item.publish_date, item.plays, item.avg_duration_sec,
        item.ctr, item.finish_rate, item.likes, item.comments, item.shares,
        item.favorites, item.danmaku, item.status, item.profile_visits, item.follower_gain
      );
    }
  });

  const mapped = rows.map(mapRowToStats).filter((r) => r.title);
  insertBatch(mapped);
  console.log(`[scrape] Stored ${mapped.length} video stats records at ${now}`);
  return mapped.length;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[scrape] Starting video stats scrape (headless: ${HEADLESS})`);

  fs.mkdirSync("data", { recursive: true });

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: HEADLESS,
    viewport: null,
    acceptDownloads: true,
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    // Navigate to data center
    console.log(`[scrape] Navigating to ${DATA_CENTER_URL}`);
    await page.goto(DATA_CENTER_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for Garfish to load
    await waitForGarfishLoad(page);

    // Switch to "投稿列表" tab
    await clickElementByCharCodes(page, CHAR_CODES_SUBMISSION_LIST, "投稿列表", 15000);
    await page.waitForTimeout(2000);

    // Click "刷新数据"
    const refreshed = await clickElementByCharCodes(page, CHAR_CODES_REFRESH_DATA, "刷新数据", 10000);
    if (refreshed) {
      console.log("[scrape] Waiting 4s after refresh...");
      await page.waitForTimeout(4000);
    }

    // Click "导出数据" and intercept download
    const filePath = await interceptExportDownload(page, async () => {
      await clickElementByCharCodes(page, CHAR_CODES_EXPORT_DATA, "导出数据", 10000);
    });

    // Parse and store
    const rows = await parseXlsx(filePath);
    const count = storeVideoStats(rows);

    console.log(`\n[scrape] ✅ Done! Scraped ${count} video records.`);

    // Clean up temp file
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore cleanup errors
    }
  } catch (error) {
    console.error(`\n[scrape] ❌ Failed: ${error.message}`);

    // Detect login expiry
    if (error.message.includes("expired") || error.message.includes("登录")) {
      console.error("[scrape] → Please re-login via: npm run auth");
    }

    process.exitCode = 1;
  } finally {
    await context.close();
    closeDb();
  }
}

main();
