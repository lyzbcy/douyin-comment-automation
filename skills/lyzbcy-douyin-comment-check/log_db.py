#!/usr/bin/env python3
"""
回复日志 SQLite 数据库存储。
单文件、零配置、自动清理，用于记录每条回复的生成来源和结果。
"""
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

SH_TZ = ZoneInfo("Asia/Shanghai")
BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "reply_logs.db"
LOG_RETENTION_DAYS = 30  # 30天后自动清理旧日志，控制空间


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=OFF")
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """初始化数据库表结构，幂等。"""
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS reply_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            type TEXT NOT NULL,
            username TEXT DEFAULT '',
            comment_text TEXT DEFAULT '',
            work_title TEXT DEFAULT '',
            reply_message TEXT DEFAULT '',
            attempt INTEGER DEFAULT 0,
            success INTEGER DEFAULT 0,
            duration_ms INTEGER DEFAULT 0,
            error_reason TEXT DEFAULT '',
            model TEXT DEFAULT ''
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_reply_logs_timestamp
        ON reply_logs(timestamp)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_reply_logs_type
        ON reply_logs(type)
    """)
    conn.commit()
    conn.close()


def log_reply(
    type_: str,
    username: str = "",
    comment_text: str = "",
    work_title: str = "",
    reply_message: str = "",
    attempt: int = 0,
    success: bool = True,
    duration_ms: int = 0,
    error_reason: str = "",
    model: str = "",
):
    """写入一条回复日志。"""
    try:
        conn = _get_conn()
        conn.execute(
            """INSERT INTO reply_logs
               (timestamp, type, username, comment_text, work_title,
                reply_message, attempt, success, duration_ms, error_reason, model)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                datetime.now(SH_TZ).isoformat(),
                type_,
                username,
                comment_text,
                work_title,
                reply_message,
                attempt,
                1 if success else 0,
                int(duration_ms),
                error_reason[:500] if error_reason else "",
                model,
            ),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass  # 日志失败绝不能影响主流程


def cleanup_old_logs():
    """删除超过保留期的旧日志，控制 SQLite 文件大小。"""
    try:
        conn = _get_conn()
        cutoff = datetime.now(SH_TZ) - timedelta(days=LOG_RETENTION_DAYS)
        cutoff_str = cutoff.isoformat()
        conn.execute("DELETE FROM reply_logs WHERE timestamp < ?", (cutoff_str,))
        conn.execute("VACUUM")  # 回收磁盘空间
        conn.close()
    except Exception:
        pass


def get_recent_stats(hours: int = 24):
    """获取最近 N 小时的统计摘要（供前端展示/审计）。"""
    conn = _get_conn()
    cutoff = (datetime.now(SH_TZ) - timedelta(hours=hours)).isoformat()
    rows = conn.execute(
        """SELECT type, COUNT(*) as cnt, 
                  SUM(success) as success_cnt, 
                  ROUND(AVG(duration_ms)) as avg_ms
           FROM reply_logs 
           WHERE timestamp > ?
           GROUP BY type
           ORDER BY cnt DESC""",
        (cutoff,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# 启动时自动初始化
init_db()