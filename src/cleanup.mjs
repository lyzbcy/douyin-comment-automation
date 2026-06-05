#!/usr/bin/env node
/**
 * cleanup.mjs — 清理旧数据
 *
 * 用法：
 *   node src/cleanup.mjs [options]
 *
 * 选项：
 *   --days <n>   保留天数（默认 30）
 *   --help       显示帮助
 *
 * 清理内容：
 *   - comment-images/ 目录下的所有图片
 *   - SQLite 中超过 N 天的已回复评论、视频快照、追踪数据
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cleanupOldData } from './lib/db-ops.mjs';
import { closeDb } from './lib/db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Parse args
let days = 30;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--days' && process.argv[i + 1]) {
    days = parseInt(process.argv[++i], 10);
    if (isNaN(days) || days < 1) {
      console.error('ERROR: --days 必须是正整数');
      process.exit(1);
    }
  } else if (process.argv[i] === '--help' || process.argv[i] === '-h') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf-8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, ''));
    process.exit(0);
  }
}

console.log(`[cleanup] 清理 ${days} 天前的数据...`);

// 1. 清理评论图片
const imageDir = path.join(PROJECT_ROOT, 'comments-output', 'comment-images');
let imagesCleaned = 0;
if (fs.existsSync(imageDir)) {
  const files = fs.readdirSync(imageDir);
  for (const f of files) {
    fs.unlinkSync(path.join(imageDir, f));
    imagesCleaned++;
  }
}
if (imagesCleaned > 0) {
  console.log(`[cleanup] 已清理 ${imagesCleaned} 张评论图片`);
} else {
  console.log('[cleanup] 评论图片目录为空');
}

// 2. 清理 SQLite
const cleaned = cleanupOldData(days);
const total = cleaned.comments + cleaned.videoStats + cleaned.videoTracking + cleaned.trackingMeta;
console.log(
  `[cleanup] 数据库清理完成，共删除 ${total} 条` +
  `（评论 ${cleaned.comments}，视频快照 ${cleaned.videoStats}，` +
  `追踪点 ${cleaned.videoTracking}，追踪元 ${cleaned.trackingMeta}）`
);

// 3. VACUUM if significant cleanup
if (total > 100) {
  console.log('[cleanup] 正在压缩数据库...');
  const { getDb } = await import('./lib/db.mjs');
  getDb().exec('VACUUM');
  console.log('[cleanup] 数据库压缩完成');
}

closeDb();
console.log('[cleanup] 完成');
