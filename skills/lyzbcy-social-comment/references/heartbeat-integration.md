# lyzbcy-social-comment 接入说明

推荐接法：

1. `npm run works` 获取最新作品
2. `npm run comments:export -- "作品标题"` 导出未回复评论
3. 调用 `skills/lyzbcy-social-comment/SKILL.md` 的规则生成 `replyMessage`
4. `npm run comments:reply -- ./comments-output/unreplied-comments.json` 执行批量回复
5. 读取 `comments-output/reply-comments-result.json` 核验结果

## 重要原则

- 只基于 `unreplied-comments.json` 触发自动回复
- 不要拿 `all-comments` 直接做自动回复依据
- 判断不清楚是否已回复时，宁可不回
- 登录失效、页面异常、内存不足时停止自动回复

## 推荐给 HEARTBEAT 的规则

- 每小时最多检查一次
- 有未回复评论才继续
- 回复前先做风险过滤
- 回复后必须读结果文件再汇报
