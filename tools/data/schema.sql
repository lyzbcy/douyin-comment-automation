-- 抖音评论数据库结构
-- 用于持久化评论和回复记录

CREATE TABLE IF NOT EXISTS comments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    work_title    TEXT NOT NULL,           -- 作品标题
    username      TEXT NOT NULL,           -- 评论用户名
    comment_text  TEXT NOT NULL,           -- 评论内容
    reply_message TEXT,                    -- 回复内容
    comment_time  TEXT NOT NULL DEFAULT '', -- 评论时间
    reply_count   INTEGER NOT NULL DEFAULT 0, -- 回复次数
    UNIQUE(work_title, username, comment_text)
);

-- 索引（可选，加速查询）
CREATE INDEX IF NOT EXISTS idx_comments_work_title ON comments(work_title);
CREATE INDEX IF NOT EXISTS idx_comments_username ON comments(username);
CREATE INDEX IF NOT EXISTS idx_comments_reply_count ON comments(reply_count);
