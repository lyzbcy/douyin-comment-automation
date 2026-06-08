#!/usr/bin/env node
/**
 * scrape-video-stats-v2.mjs
 *
 * Scrape video stats by intercepting the /janus/douyin/creator/pc/work_list API.
 * Uses pagination to get ALL videos.
 * Stores complete data (plays, likes, comments, shares, favorites) into video_stats table.
 *
 * Usage:
 *   npm run scrape:stats2 [-- --headless]
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { getDb, closeDb } from "./lib/db.mjs";

const CONTENT_MANAGE_URL = "https://creator.douyin.com/creator-micro/content/manage";
const USER_DATA_DIR = path.resolve(".playwright/douyin-profile");
const HEADLESS = process.argv.includes("--headless");

function storeVideoStats(allItems) {
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
      const stats = item.statistics || {};
      const title = item.item_title || item.desc || `untitled-${item.aweme_id || item.item_id}`;
      const createTime = item.create_time
        ? new Date(Number(item.create_time) * 1000).toISOString().slice(0, 16).replace("T", " ")
        : "";
      const duration = item.video?.duration ? Number(item.video.duration) / 1000 : 0;
      const statusValue = item.status_value || item.status?.status || 0;
      const statusText = statusValue === 2 ? "公开" : statusValue === 3 ? "私密" : statusValue === 5 ? "自见" : String(statusValue);

      insert.run(
        now,
        title,
        createTime,
        stats.play_count || 0,
        duration,
        0, // ctr — not available from this API
        0, // finish_rate — not available from this API
        stats.digg_count || 0,
        stats.comment_count || 0,
        stats.share_count || 0,
        stats.collect_count || 0,
        0, // danmaku
        statusText,
        0, // profile_visits
        0  // follower_gain
      );
    }
  });

  insertBatch(allItems);
  console.log(`[scrape-v2] Stored ${allItems.length} video stats records at ${now}`);
  return allItems.length;
}

async function main() {
  console.log(`[scrape-v2] Starting (headless: ${HEADLESS})`);
  fs.mkdirSync("data", { recursive: true });

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: HEADLESS,
    viewport: { width: 1400, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();

  const allItems = [];
  let totalExpected = 0;

  // Intercept work_list API responses
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("/janus/douyin/creator/pc/work_list")) {
      try {
        const data = await response.json();
        const items = data.aweme_list || [];
        totalExpected = data.total || 0;
        allItems.push(...items);
        console.log(`[scrape-v2] Got ${items.length} items (total: ${allItems.length}/${totalExpected}, has_more: ${data.has_more})`);
      } catch (e) {
        console.warn(`[scrape-v2] Failed to parse work_list response: ${e.message}`);
      }
    }
  });

  try {
    console.log("[scrape-v2] Navigating to content management...");
    await page.goto(CONTENT_MANAGE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(10000);

    // Scroll down to trigger pagination loading
    let scrollAttempts = 0;
    const maxScrollAttempts = 30;

    while (scrollAttempts < maxScrollAttempts) {
      const beforeCount = allItems.length;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
      scrollAttempts++;

      if (allItems.length >= totalExpected && totalExpected > 0) {
        console.log(`[scrape-v2] All ${totalExpected} items loaded`);
        break;
      }

      if (allItems.length === beforeCount && scrollAttempts > 3) {
        // No new items after scrolling, might be done or stuck
        console.log(`[scrape-v2] No new items after scroll (${scrollAttempts}), stopping`);
        break;
      }

      if (scrollAttempts % 5 === 0) {
        console.log(`[scrape-v2] Scroll attempt ${scrollAttempts}, items: ${allItems.length}/${totalExpected}`);
      }
    }

    // Deduplicate by item_id
    const seen = new Set();
    const uniqueItems = allItems.filter((item) => {
      const id = item.aweme_id || item.item_id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    console.log(`\n[scrape-v2] Collected ${uniqueItems.length} unique videos (raw: ${allItems.length})`);

    // Save raw data
    fs.writeFileSync("data/work_list_all.json", JSON.stringify(uniqueItems, null, 2));

    // Store in database
    const count = storeVideoStats(uniqueItems);
    console.log(`\n[scrape-v2] ✅ Done! Stored ${count} video records.`);

    // Print summary
    const topVideos = uniqueItems
      .map((item) => ({
        title: (item.item_title || item.desc || "").slice(0, 40),
        plays: item.statistics?.play_count || 0,
        likes: item.statistics?.digg_count || 0,
        comments: item.statistics?.comment_count || 0,
        shares: item.statistics?.share_count || 0,
        favorites: item.statistics?.collect_count || 0,
      }))
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 5);

    console.log("\n📊 Top 5 videos:");
    for (const v of topVideos) {
      console.log(
        `  ${v.title} → plays:${v.plays} 👍${v.likes} 💬${v.comments} 🔗${v.shares} ⭐${v.favorites}`
      );
    }
  } catch (error) {
    console.error(`\n[scrape-v2] ❌ Failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await context.close();
    closeDb();
  }
}

main();
