/**
 * feishu-sync.mjs
 *
 * Sync video data to Feishu (Lark) Bitable (多维表格).
 *
 * Supports three tables:
 *   1. 视频数据总览 — latest snapshot of all videos
 *   2. 最新作品追踪 — time-series data for actively tracked videos
 *   3. 账号总览 — follower count + daily new followers
 *
 * Configuration via environment variables:
 *   FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_BASE_TOKEN,
 *   FEISHU_TABLE_OVERVIEW, FEISHU_TABLE_TRACKING, FEISHU_TABLE_ACCOUNT
 *
 * Usage:
 *   npm run sync:feishu
 */

import process from "node:process";
import { BaseSync } from "./base-sync.mjs";
import { getDb, closeDb } from "../lib/db.mjs";

// ── Feishu API constants ───────────────────────────────────────────────────

const FEISHU_BASE_URL = "https://open.feishu.cn/open-apis";
const TOKEN_URL = `${FEISHU_BASE_URL}/auth/v3/tenant_access_token/internal`;
const TOKEN_TTL_MS = 50 * 60 * 1000; // 50 minutes (tokens expire in 1 hour)

// Filtered statuses (private / under review / deleted)
const EXCLUDED_STATUSES = new Set(["自见", "私密", "未通过", "审核中", "已删除"]);

// ── FeishuSync implementation ──────────────────────────────────────────────

class FeishuSync extends BaseSync {
  constructor(config) {
    super(config);
    this._token = null;
    this._tokenExpiresAt = 0;
  }

  async authenticate() {
    const { appId, appSecret } = this.config;
    if (!appId || !appSecret) {
      throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET are required");
    }

    // Reuse cached token if still valid
    if (this._token && Date.now() < this._tokenExpiresAt) {
      this.authenticated = true;
      return;
    }

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Feishu auth failed (${response.status}): ${body}`);
    }

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(`Feishu auth error: ${data.msg || JSON.stringify(data)}`);
    }

    this._token = data.tenant_access_token;
    this._tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
    this.authenticated = true;
    console.log("[feishu] ✅ Authenticated successfully");
  }

  /**
   * Make an authenticated Feishu API request.
   */
  async _apiRequest(method, urlPath, body = null) {
    await this.ensureAuth();

    const url = `${FEISHU_BASE_URL}${urlPath}`;
    const headers = {
      Authorization: `Bearer ${this._token}`,
      "Content-Type": "application/json",
    };

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Feishu API error (${response.status}): ${text}`);
    }

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(`Feishu API error: code=${data.code} msg=${data.msg}`);
    }
    return data.data;
  }

  async fetchExistingRecords(tableId, keyField) {
    const { baseToken } = this.config;
    const result = new Map();
    let pageToken = "";

    do {
      const params = new URLSearchParams({
        page_size: "500",
      });
      if (pageToken) params.set("page_token", pageToken);

      const data = await this._apiRequest(
        "GET",
        `/bitable/v1/apps/${baseToken}/tables/${tableId}/records?${params}`
      );

      for (const item of data?.items || []) {
        const key = item.fields?.[keyField];
        if (key) result.set(key, item);
      }

      pageToken = data?.page_token || "";
    } while (pageToken);

    return result;
  }

  async upsertRecords(tableId, records, keyField) {
    const { baseToken } = this.config;
    const existing = await this.fetchExistingRecords(tableId, keyField);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    // Batch create and update (Feishu supports batch operations, max 500)
    const BATCH_SIZE = 100;
    const toCreate = [];
    const toUpdate = [];

    for (const record of records) {
      const key = record[keyField];
      if (!key) {
        skipped++;
        continue;
      }

      const existingRecord = existing.get(key);
      if (existingRecord) {
        toUpdate.push({
          record_id: existingRecord.record_id,
          fields: record,
        });
      } else {
        toCreate.push({ fields: record });
      }
    }

    // Batch create
    for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
      const batch = toCreate.slice(i, i + BATCH_SIZE);
      try {
        await this._apiRequest(
          "POST",
          `/bitable/v1/apps/${baseToken}/tables/${tableId}/records/batch_create`,
          { records: batch }
        );
        created += batch.length;
      } catch (err) {
        console.warn(`[feishu] Batch create failed: ${err.message}`);
        skipped += batch.length;
      }
    }

    // Batch update
    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
      const batch = toUpdate.slice(i, i + BATCH_SIZE);
      try {
        await this._apiRequest(
          "POST",
          `/bitable/v1/apps/${baseToken}/tables/${tableId}/records/batch_update`,
          { records: batch }
        );
        updated += batch.length;
      } catch (err) {
        console.warn(`[feishu] Batch update failed: ${err.message}`);
        skipped += batch.length;
      }
    }

    return { created, updated, skipped };
  }
}

// ── Data extraction from SQLite ────────────────────────────────────────────

function getVideoOverviewRecords() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT v1.* FROM video_stats v1
    INNER JOIN (
      SELECT title, MAX(timestamp) as max_ts
      FROM video_stats GROUP BY title
    ) v2 ON v1.title = v2.title AND v1.timestamp = v2.max_ts
    WHERE v1.status NOT IN ('自见', '私密', '未通过', '审核中', '已删除')
    ORDER BY v1.timestamp DESC
  `).all();

  return rows.map((r) => ({
    标题: r.title,
    发布日期: r.publish_date || "",
    播放量: r.plays || 0,
    平均播放时长: r.avg_duration_sec || 0,
    点击率: Math.round((r.ctr || 0) * 10000) / 100,
    完播率: Math.round((r.finish_rate || 0) * 10000) / 100,
    点赞数: r.likes || 0,
    评论数: r.comments || 0,
    分享数: r.shares || 0,
    收藏数: r.favorites || 0,
    弹幕数: r.danmaku || 0,
    状态: r.status || "公开",
    主页访问: r.profile_visits || 0,
    新增粉丝: r.follower_gain || 0,
    更新时间: r.timestamp,
  }));
}

function getTrackingRecords() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT vt.*, vtm.baseline_plays, vtm.tracking_active
    FROM video_tracking vt
    INNER JOIN video_tracking_meta vtm ON vt.video_title = vtm.video_title
    WHERE vtm.tracking_active = 1
    ORDER BY vt.checkpoint_time DESC
  `).all();

  return rows.map((r) => ({
    视频标题: r.video_title,
    发布日期: r.publish_date || "",
    检查时间: r.checkpoint_time,
    发布时长h: Math.round(r.hours_since_publish * 10) / 10,
    播放量: r.plays || 0,
    点赞: r.likes || 0,
    评论: r.comments || 0,
    分享: r.shares || 0,
    收藏: r.favorites || 0,
    CTR: Math.round((r.ctr5s || 0) * 10000) / 100,
    均时长: r.avg_duration_sec || 0,
    互动率: Math.round((r.engagement_rate || 0) * 10000) / 100,
    每小时播放: Math.round(r.plays_per_hour * 10) / 10,
    累计增长: r.cumulative_growth || 0,
    预测最终播放: r.predicted_final_plays || 0,
    预测层级: r.predicted_tier || "",
    置信度: Math.round((r.confidence || 0) * 100),
  }));
}

function getAccountOverviewRecords() {
  const db = getDb();
  // Aggregate from latest video_stats snapshot
  const latest = db.prepare(`
    SELECT
      SUM(follower_gain) as total_follower_gain,
      SUM(profile_visits) as total_profile_visits,
      MAX(timestamp) as last_update
    FROM video_stats v1
    INNER JOIN (
      SELECT title, MAX(timestamp) as max_ts
      FROM video_stats GROUP BY title
    ) v2 ON v1.title = v2.title AND v1.timestamp = v2.max_ts
  `).get();

  return [{
    指标: "账号总览",
    今日新增粉丝: latest?.total_follower_gain || 0,
    主页总访问: latest?.total_profile_visits || 0,
    更新时间: latest?.last_update || new Date().toISOString(),
  }];
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const config = {
    appId: process.env.FEISHU_APP_ID || "",
    appSecret: process.env.FEISHU_APP_SECRET || "",
    baseToken: process.env.FEISHU_BASE_TOKEN || "",
    tableOverview: process.env.FEISHU_TABLE_OVERVIEW || "",
    tableTracking: process.env.FEISHU_TABLE_TRACKING || "",
    tableAccount: process.env.FEISHU_TABLE_ACCOUNT || "",
  };

  // Validate config
  const missing = [];
  if (!config.appId) missing.push("FEISHU_APP_ID");
  if (!config.appSecret) missing.push("FEISHU_APP_SECRET");
  if (!config.baseToken) missing.push("FEISHU_BASE_TOKEN");

  if (missing.length) {
    console.error(`❌ Missing environment variables: ${missing.join(", ")}`);
    console.error("Set them in .env or export them before running.");
    process.exitCode = 1;
    return;
  }

  const sync = new FeishuSync(config);

  try {
    // Table 1: Video overview
    if (config.tableOverview) {
      const overviewRecords = getVideoOverviewRecords();
      await sync.syncTable("视频数据总览", config.tableOverview, overviewRecords, "标题");
    } else {
      console.log("[feishu] Skipping 视频数据总览 (FEISHU_TABLE_OVERVIEW not set)");
    }

    // Table 2: Tracking time-series
    if (config.tableTracking) {
      const trackingRecords = getTrackingRecords();
      await sync.syncTable("最新作品追踪", config.tableTracking, trackingRecords, "视频标题");
    } else {
      console.log("[feishu] Skipping 最新作品追踪 (FEISHU_TABLE_TRACKING not set)");
    }

    // Table 3: Account overview
    if (config.tableAccount) {
      const accountRecords = getAccountOverviewRecords();
      await sync.syncTable("账号总览", config.tableAccount, accountRecords, "指标");
    } else {
      console.log("[feishu] Skipping 账号总览 (FEISHU_TABLE_ACCOUNT not set)");
    }

    console.log("\n[feishu] ✅ Sync complete!");
  } catch (error) {
    console.error(`\n[feishu] ❌ Sync failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

main();
