import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB_PATH = path.resolve("data/douyin-creator.db");

let _db = null;

export function getDb() {
  if (_db) {
    return _db;
  }

  const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      work_title    TEXT NOT NULL,
      username      TEXT NOT NULL,
      comment_text  TEXT NOT NULL,
      reply_message TEXT,
      comment_time  TEXT NOT NULL DEFAULT '2026-03-03',
      reply_count   INTEGER NOT NULL DEFAULT 0,
      UNIQUE(work_title, username, comment_text)
    )
  `);

  // 为旧版本数据库添加新列（列已存在时会抛异常，忽略即可）
  for (const migration of [
    "ALTER TABLE comments ADD COLUMN comment_time TEXT NOT NULL DEFAULT '2026-03-03'",
    "ALTER TABLE comments ADD COLUMN reply_count INTEGER NOT NULL DEFAULT 0"
  ]) {
    try {
      _db.exec(migration);
    } catch {
      // 列已存在，忽略
    }
  }

  // 迁移：截断已有长标题（超过15字的标题截取前15字）
  // 防止历史数据因标题过长导致匹配失败
  try {
    const truncateStmt = _db.prepare(`
      UPDATE comments SET work_title = SUBSTR(work_title, 1, 15)
      WHERE LENGTH(work_title) > 15
    `);
    const info = truncateStmt.run();
    if (info.changes > 0) {
      console.log(`[db] 已截断 ${info.changes} 条评论的长标题（保留前15字）`);
    }
  } catch {
    // 迁移失败不影响主流程
  }

  return _db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
