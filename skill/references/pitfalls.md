# 踩坑记录

遇到异常时查阅此文件。每条格式：现象 → 根因 → 修复。

---

## #1 登录态过期的两种模式

**模式 A（近期过期）：** 服务器返回 JSON 错误文件 `{"BaseResp":{"StatusCode":8,"StatusMessage":"用户未登录"}}`，Playwright 下载事件正常触发，但拿到的不是 xlsx。

**模式 B（深度过期）：** 服务器不返回任何文件，`waitForEvent('download')` 永远不触发，最终超时。

**降级模式：** Garfish 微前端停止初始化，页面只显示导航栏（约 66 字符）。

| 现象 | 根因 |
|---|---|
| 导出超时，无文件下载 | 模式 B：深度过期 |
| 下载到 JSON 而非 xlsx | 模式 A：近期过期 |
| 页面只有 66 字符的导航文本 | Garfish 降级（同属过期） |

**修复：** 检测到上述任何现象时，立即停止任务并汇报「需要手动登录」。不要重试。

## #2 Garfish 微前端 DOM 隔离

**问题：** `document.body.innerText` 在 Garfish 容器内只返回导航栏内容。

**修复：**
- 始终用 `document.querySelectorAll` 在 `document` 层级查找元素
- 不要依赖 `document.body.innerText` 做页面状态判断
- 容器 ID 后缀每次刷新都变（`#garfish_app_for_*`），不要硬编码

## #3 页面导航到 Home

**问题：** 登录后 Chrome 可能落在 `/creator-micro/home`。

**修复：** 不能只 `reload`，必须先设 URL 再 reload：
```javascript
await page.goto('https://creator.douyin.com/creator-micro/data-center/content');
await page.reload({ waitUntil: 'networkidle' });
```

## #4 评论分页控件隐藏

**问题：** 「未回复」模式下分页控件可能不可见。

**修复：** 先切到「全部评论」让分页控件显示，翻完页再切回「未回复」。`tryAdvancePageForReply` 已自动处理。

| 现象 | 根因 |
|---|---|
| 未回复列表只采集了第一页 | 分页控件被隐藏 |
| 日志 `switching to all-comments filter for pagination` | 正常：正在绕过限制 |

## #5 Playwright 持久化 Profile

**问题：** 清空 `.playwright/douyin-profile` 后登录态丢失。

**修复：** 不要清空/删除/替换该目录。Chrome 更新后可能需重新登录。重置前先备份。

## #6 ALTER TABLE 列顺序 Bug

**问题：** `ALTER TABLE ADD COLUMN` 总在末尾添加，`INSERT VALUES` 不带列名时数据错位。

**修复：** 始终用显式列名：
```sql
INSERT INTO video_stats (title, plays, likes) VALUES (?, ?, ?);  -- ✅
INSERT INTO video_stats VALUES (?, ?, ?, ?);                       -- ❌
```

## #7 旧作品没有评论状态过滤下拉框

**现象：** `waitForCommentStatusFilter` 超时。

**修复：** `collectComments` 已内置容错——5 秒内找不到过滤器，降级采集前 10 条。无需手动处理。

## #8 回复发送按钮不可点击

**根因：** 内容为空/违禁词/风控/网络延迟。

**修复：** `waitForReplySendReady` 自动轮询等待（最多 `replyTimeoutMs` 毫秒）。超时则记录失败继续下一条。
