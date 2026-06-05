/**
 * video-prediction.mjs
 *
 * Video play-count prediction model (v3 同期对比模型).
 * Ported from TzFilm's Python implementation to Node.js.
 *
 * Algorithm:
 *   predicted_final = current_plays × median_multiplier × CTR_adj × engagement_adj × duration_adj
 *
 * Where:
 *   - median_multiplier: from historical videos at the same publish age
 *   - CTR/engagement/duration adjustments: quality percentile comparison
 *
 * CLI:
 *   npm run predict -- --init --title "视频标题"
 *   npm run predict -- --title "视频标题"
 *   npm run predict -- --latest
 *   npm run predict -- --growth
 */

import process from "node:process";
import { getDb, closeDb } from "./lib/db.mjs";

// ── Tier definitions ───────────────────────────────────────────────────────

const PREDICTION_TIERS = [
  { label: "💎 10万+", min: 100000 },
  { label: "🥇 5-10万", min: 50000 },
  { label: "🥈 2-5万", min: 20000 },
  { label: "🥉 1-2万", min: 10000 },
  { label: "📦 <1万", min: 0 },
];

function getTierLabel(plays) {
  for (const tier of PREDICTION_TIERS) {
    if (plays >= tier.min) return tier.label;
  }
  return "📦 <1万";
}

function getConfidence(hoursSincePublish) {
  if (hoursSincePublish < 2) return 0.25;
  if (hoursSincePublish < 6) return 0.50;
  if (hoursSincePublish < 12) return 0.70;
  if (hoursSincePublish < 24) return 0.85;
  return 0.90;
}

// ── Data helpers ───────────────────────────────────────────────────────────

function getLatestStatsForVideo(title) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM video_stats
    WHERE title = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `).get(title);
}

function getAllFinalStats() {
  const db = getDb();
  // Get the latest stats snapshot for each video
  return db.prepare(`
    SELECT v1.* FROM video_stats v1
    INNER JOIN (
      SELECT title, MAX(timestamp) as max_ts
      FROM video_stats GROUP BY title
    ) v2 ON v1.title = v2.title AND v1.timestamp = v2.max_ts
    WHERE v1.status NOT IN ('自见', '私密', '未通过', '审核中', '已删除')
      AND v1.plays > 0
  `).all();
}

function getTrackingHistory(title) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM video_tracking
    WHERE video_title = ?
    ORDER BY checkpoint_time ASC
  `).all(title);
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function hoursBetween(d1, d2) {
  return Math.max(0, (d2 - d1) / (1000 * 60 * 60));
}

// ── Prediction core ────────────────────────────────────────────────────────

/**
 * Calculate the "same-period multiplier" from historical videos.
 * For each historical video, find its stats at a similar publish age
 * and compute: final_plays / plays_at_that_age.
 */
function calculateSamePeriodMultipliers(targetHours) {
  const allFinals = getAllFinalStats();
  const db = getDb();
  const multipliers = [];

  for (const video of allFinals) {
    const publishDate = parseDate(video.publish_date);
    if (!publishDate) continue;

    const statsAtAge = db.prepare(`
      SELECT * FROM video_stats
      WHERE title = ?
      ORDER BY ABS(
        (julianday(timestamp) - julianday(?))  * 24 - ?
      ) ASC
      LIMIT 1
    `).get(video.title, video.publish_date, targetHours);

    if (!statsAtAge || statsAtAge.plays <= 0) continue;

    const statsDate = parseDate(statsAtAge.timestamp);
    if (!statsDate) continue;

    const actualHours = hoursBetween(publishDate, statsDate);
    // Only use if within ±30% of target hours
    if (actualHours < targetHours * 0.5 || actualHours > targetHours * 1.5) continue;

    const multiplier = video.plays / statsAtAge.plays;
    if (multiplier > 0.5 && multiplier < 50) {
      multipliers.push(multiplier);
    }
  }

  return multipliers;
}

function median(arr) {
  if (!arr.length) return 1;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * p / 100) - 1);
  return sorted[idx];
}

/**
 * Quality adjustment: compare current video's metrics against historical percentiles.
 * Returns a multiplier (0.8 ~ 1.2) for each dimension.
 */
function calculateQualityAdjustment(currentCtr, currentEngagement, currentAvgDuration, allFinals) {
  const historicalCtrs = allFinals.map((v) => v.ctr).filter((v) => v > 0);
  const historicalEngagements = allFinals.map((v) => {
    const total = v.likes + v.comments + v.shares + v.favorites;
    return v.plays > 0 ? total / v.plays : 0;
  }).filter((v) => v > 0);
  const historicalDurations = allFinals.map((v) => v.avg_duration_sec).filter((v) => v > 0);

  function scoreAdjustment(value, p25, p75) {
    if (value >= p75) return 1.2;
    if (value <= p25) return 0.8;
    return 1.0;
  }

  const ctrAdj = scoreAdjustment(
    currentCtr,
    percentile(historicalCtrs, 25),
    percentile(historicalCtrs, 75)
  );
  const engAdj = scoreAdjustment(
    currentEngagement,
    percentile(historicalEngagements, 25),
    percentile(historicalEngagements, 75)
  );
  const durAdj = scoreAdjustment(
    currentAvgDuration,
    percentile(historicalDurations, 25),
    percentile(historicalDurations, 75)
  );

  return { ctrAdj, engAdj, durAdj };
}

/**
 * Run the full prediction for a video.
 */
function predictVideo(videoTitle) {
  const latestStats = getLatestStatsForVideo(videoTitle);
  if (!latestStats) {
    return { error: `No stats found for "${videoTitle}". Run scrape:stats first.` };
  }

  const publishDate = parseDate(latestStats.publish_date);
  const now = new Date();
  const hoursSincePublish = publishDate ? hoursBetween(publishDate, now) : 0;

  const currentPlays = latestStats.plays || 0;
  const currentCtr = latestStats.ctr || 0;
  const currentAvgDuration = latestStats.avg_duration_sec || 0;
  const currentEngagement = currentPlays > 0
    ? (latestStats.likes + latestStats.comments + latestStats.shares + latestStats.favorites) / currentPlays
    : 0;

  // Same-period multiplier
  const multipliers = calculateSamePeriodMultipliers(hoursSincePublish);
  const medianMultiplier = median(multipliers);

  // Quality adjustments
  const allFinals = getAllFinalStats();
  const { ctrAdj, engAdj, durAdj } = calculateQualityAdjustment(
    currentCtr, currentEngagement, currentAvgDuration, allFinals
  );

  // Final prediction
  const predictedFinal = Math.round(
    currentPlays * medianMultiplier * ctrAdj * engAdj * durAdj
  );

  const confidence = getConfidence(hoursSincePublish);
  const playsPerHour = hoursSincePublish > 0 ? currentPlays / hoursSincePublish : 0;
  const tier = getTierLabel(predictedFinal);

  // Get tracking meta
  const db = getDb();
  const meta = db.prepare(`
    SELECT * FROM video_tracking_meta WHERE video_title = ?
  `).get(videoTitle);

  const baselinePlays = meta?.baseline_plays || 0;
  const cumulativeGrowth = currentPlays - baselinePlays;

  return {
    videoTitle,
    publishDate: latestStats.publish_date,
    hoursSincePublish: Math.round(hoursSincePublish * 10) / 10,
    currentStats: {
      plays: currentPlays,
      likes: latestStats.likes,
      comments: latestStats.comments,
      shares: latestStats.shares,
      favorites: latestStats.favorites,
      ctr: currentCtr,
      avgDuration: currentAvgDuration,
      engagementRate: Math.round(currentEngagement * 10000) / 10000,
    },
    prediction: {
      predictedFinalPlays: predictedFinal,
      tier,
      confidence,
      medianMultiplier: Math.round(medianMultiplier * 100) / 100,
      adjustments: { ctr: ctrAdj, engagement: engAdj, duration: durAdj },
      sampleSize: multipliers.length,
    },
    tracking: {
      playsPerHour: Math.round(playsPerHour * 10) / 10,
      cumulativeGrowth,
      baselinePlays,
      active: meta?.tracking_active === 1,
    },
  };
}

// ── Database operations ────────────────────────────────────────────────────

function initTracking(videoTitle) {
  const db = getDb();
  const latestStats = getLatestStatsForVideo(videoTitle);

  if (!latestStats) {
    console.error(`❌ No stats found for "${videoTitle}". Run scrape:stats first.`);
    return false;
  }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO video_tracking_meta (video_title, publish_date, tracking_started, baseline_plays, tracking_active)
    VALUES (?, ?, ?, ?, 1)
  `).run(videoTitle, latestStats.publish_date, now, latestStats.plays || 0);

  console.log(`✅ Tracking initialized for "${videoTitle}"`);
  console.log(`   Baseline plays: ${latestStats.plays}`);
  console.log(`   Publish date: ${latestStats.publish_date}`);
  return true;
}

function saveTrackingCheckpoint(prediction) {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO video_tracking
      (video_title, publish_date, checkpoint_time, hours_since_publish,
       plays, likes, comments, shares, favorites, ctr5s, avg_duration_sec,
       engagement_rate, plays_per_hour, cumulative_growth,
       predicted_final_plays, predicted_tier, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    prediction.videoTitle,
    prediction.publishDate,
    now,
    prediction.hoursSincePublish,
    prediction.currentStats.plays,
    prediction.currentStats.likes,
    prediction.currentStats.comments,
    prediction.currentStats.shares,
    prediction.currentStats.favorites,
    prediction.currentStats.ctr,
    prediction.currentStats.avgDuration,
    prediction.currentStats.engagementRate,
    prediction.tracking.playsPerHour,
    prediction.tracking.cumulativeGrowth,
    prediction.prediction.predictedFinalPlays,
    prediction.prediction.tier,
    prediction.prediction.confidence
  );
}

function deactivateTracking(videoTitle) {
  const db = getDb();
  db.prepare(`
    UPDATE video_tracking_meta SET tracking_active = 0 WHERE video_title = ?
  `).run(videoTitle);
  console.log(`⏹ Tracking deactivated for "${videoTitle}"`);
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { action: "predict" };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--init":
        result.action = "init";
        break;
      case "--latest":
        result.action = "latest";
        break;
      case "--growth":
        result.action = "growth";
        break;
      case "--stop":
        result.action = "stop";
        break;
      case "--title":
        result.title = args[++i];
        break;
      case "--all":
        result.all = true;
        break;
    }
  }
  return result;
}

function printPrediction(result) {
  console.log(`\n━━━ ${result.videoTitle} ━━━`);
  console.log(`  发布: ${result.publishDate} (${result.hoursSincePublish}h ago)`);
  console.log(`  当前播放: ${result.currentStats.plays.toLocaleString()}`);
  console.log(`  互动数据: 👍${result.currentStats.likes} 💬${result.currentStats.comments} 🔗${result.currentStats.shares} ⭐${result.currentStats.favorites}`);
  console.log(`  CTR: ${(result.currentStats.ctr * 100).toFixed(1)}%  均时长: ${result.currentStats.avgDuration.toFixed(1)}s`);
  console.log(`  互动率: ${(result.currentStats.engagementRate * 100).toFixed(2)}%`);
  console.log("");
  console.log(`  🔮 预测最终播放: ${result.prediction.predictedFinalPlays.toLocaleString()}`);
  console.log(`  📊 预测层级: ${result.prediction.tier}`);
  console.log(`  🎯 置信度: ${(result.prediction.confidence * 100).toFixed(0)}%`);
  console.log(`  📈 同期倍率: ${result.prediction.medianMultiplier}x (样本: ${result.prediction.sampleSize})`);
  console.log(`  ⚡ 修正系数: CTR=${result.prediction.adjustments.ctr} 互动=${result.prediction.adjustments.engagement} 时长=${result.prediction.adjustments.duration}`);
  console.log(`  🚀 速度: ${result.tracking.playsPerHour} plays/h  累计增长: +${result.tracking.cumulativeGrowth}`);
}

function printGrowth(videoTitle) {
  const history = getTrackingHistory(videoTitle);
  if (!history.length) {
    console.log(`No tracking history for "${videoTitle}"`);
    return;
  }

  console.log(`\n━━━ Growth Curve: ${videoTitle} ━━━`);
  console.log("  Time                  | Plays    | Predicted  | Tier         | Conf");
  console.log("  " + "─".repeat(70));

  for (const row of history) {
    const time = new Date(row.checkpoint_time).toLocaleString("zh-CN", { hour12: false });
    console.log(
      `  ${time.padEnd(22)}| ${String(row.plays).padStart(8)} | ${String(row.predicted_final_plays).padStart(10)} | ${(row.predicted_tier || "").padEnd(12)} | ${(row.confidence * 100).toFixed(0)}%`
    );
  }
}

function main() {
  const args = parseArgs();

  try {
    switch (args.action) {
      case "init": {
        if (!args.title) {
          console.error("Usage: npm run predict -- --init --title \"视频标题\"");
          process.exitCode = 1;
          return;
        }
        initTracking(args.title);
        // Run initial prediction
        const result = predictVideo(args.title);
        if (result.error) {
          console.error(`❌ ${result.error}`);
          process.exitCode = 1;
          return;
        }
        saveTrackingCheckpoint(result);
        printPrediction(result);
        break;
      }

      case "predict": {
        if (args.all || !args.title) {
          // Predict all active tracking videos
          const db = getDb();
          const activeVideos = db.prepare(`
            SELECT video_title FROM video_tracking_meta WHERE tracking_active = 1
          `).all();

          if (!activeVideos.length) {
            console.log("No actively tracked videos. Use --init --title to start tracking.");
            return;
          }

          for (const { video_title } of activeVideos) {
            const result = predictVideo(video_title);
            if (result.error) {
              console.warn(`⚠️ ${video_title}: ${result.error}`);
              continue;
            }
            saveTrackingCheckpoint(result);
            printPrediction(result);

            // Auto-deactivate if confidence >= 90%
            if (result.prediction.confidence >= 0.90) {
              console.log(`  ℹ️ Confidence ≥90%, consider stopping tracking.`);
            }
          }
        } else {
          const result = predictVideo(args.title);
          if (result.error) {
            console.error(`❌ ${result.error}`);
            process.exitCode = 1;
            return;
          }
          // Save checkpoint if tracking is active
          if (result.tracking.active) {
            saveTrackingCheckpoint(result);
          }
          printPrediction(result);
        }
        break;
      }

      case "latest": {
        const db = getDb();
        const activeVideos = db.prepare(`
          SELECT video_title FROM video_tracking_meta WHERE tracking_active = 1
        `).all();

        if (!activeVideos.length) {
          console.log("No actively tracked videos.");
          return;
        }

        for (const { video_title } of activeVideos) {
          const result = predictVideo(video_title);
          if (!result.error) printPrediction(result);
        }
        break;
      }

      case "growth": {
        if (!args.title) {
          console.error("Usage: npm run predict -- --growth --title \"视频标题\"");
          process.exitCode = 1;
          return;
        }
        printGrowth(args.title);
        break;
      }

      case "stop": {
        if (!args.title) {
          console.error("Usage: npm run predict -- --stop --title \"视频标题\"");
          process.exitCode = 1;
          return;
        }
        deactivateTracking(args.title);
        break;
      }
    }
  } finally {
    closeDb();
  }
}

main();
