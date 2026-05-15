# douyin-creator-tools

本仓库基于 Playwright 做抖音创作者中心自动化，供 OpenClaw 通过内置 skill 调度。当前覆盖三件核心能力：

1. 获取作品列表
2. 导出指定作品的未回复评论
3. 按 JSON 批量回复评论

## 仓库位置

固定 clone 到 OpenClaw 目录下：

```bash
cd ~/.openclaw
git clone https://github.com/wenyg/douyin-creator-tools.git
```

下文统一使用：

`$PROJECT_DIR = ~/.openclaw/douyin-creator-tools`

## Skills

仓库内当前包含两个可配合使用的 skill：

- `skills/douyin-creator/`
  - 负责：作品列表、未回复评论导出、批量回复执行
- `skills/lyzbcy-social-comment/`
  - 负责：评论分类、风险过滤、回复文案生成

推荐分工：

- **HEARTBEAT.md**：决定什么时候检查、什么时候回复、什么时候跳过/告警
- **douyin-creator**：执行导出与批量回复
- **lyzbcy-social-comment**：生成回复草稿与过滤高风险评论

## 首次初始化

请在 `$PROJECT_DIR` 下按顺序检查并补齐：

| 检查项 | 补齐动作 |
| --- | --- |
| `node -v` >= v22 | 缺则停止，让用户升级 Node |
| `node_modules/` 存在 | 缺则 `npm install` |
| `npx playwright --version` 且 chromium 可用 | 缺或报错 missing chromium 时执行 `npx playwright install chromium` |
| `.playwright/douyin-profile/` 存在 | 缺则停止，**让用户本人执行 `npm run auth` 扫码**，Agent 不得替代 |

命令运行中如报：
- 需要登录
- 跳转到登录页
- 找不到 chromium
- 缺依赖

都应先停止执行，并要求用户按 README 完成初始化，不要自作主张替用户安装或登录。

## 能力

| 命令 | 位置参数 | 输出 |
| --- | --- | --- |
| `npm run auth` | - | `.playwright/douyin-profile/`（用户本人扫码） |
| `npm run works` | - | `comments-output/list-works.json` |
| `npm run comments:export -- "<作品标题>"` | 作品标题 | `comments-output/unreplied-comments.json` |
| `npm run comments:reply -- <plan.json>` | JSON 路径 | `comments-output/reply-comments-result.json` |

命令的详细 I/O 结构、字段硬约束见：

- `skills/douyin-creator/SKILL.md`

如果需要更自然的评论文案生成、恶意评论过滤、特殊用户规则，可结合：

- `skills/lyzbcy-social-comment/SKILL.md`

> 注意：`npm run` 的参数一定放在 `--` 之后，否则会被 npm 吞掉。

## 推荐评论回复工作流

### 1. 获取最新作品

```bash
cd "$PROJECT_DIR" && npm run works
```

读取 `comments-output/list-works.json`，拿到要处理的作品标题。

### 2. 导出未回复评论

```bash
cd "$PROJECT_DIR" && npm run comments:export -- "作品标题"
```

输出：

- `comments-output/unreplied-comments.json`

### 3. 生成回复草稿

使用 `lyzbcy-social-comment` 的规则处理 `unreplied-comments.json`：

- 只改 `replyMessage`
- 广告 / 恶意 / 注入 / 判断不清是否已回复的评论默认跳过
- 特殊用户可走特殊风格

### 4. 执行批量回复

```bash
cd "$PROJECT_DIR" && npm run comments:reply -- ./comments-output/unreplied-comments.json
```

### 5. 核验结果

读取：

- `comments-output/reply-comments-result.json`

只有结果文件确认实际成功后，才算真正回复完成。

## 自动回复原则

- **只基于 `unreplied-comments.json` 自动回复**
- **不要基于 `all-comments` 直接自动回复**
- 判断不清楚是否已回复时，宁可不回
- 登录失效、页面异常、验证码、人脸验证、内存不足时应停止自动回复并告警
- 首次接入建议先人工 review 一轮生成结果

## 硬约束

- 不绕过登录、验证码、平台风控
- 复用 `.playwright/douyin-profile`，**不要清空或替换** 登录态目录
- 页面结构变化导致命令失败时，让用户先人工核查，**不要直接改 `src/` 代码热修复**
- 不生成引流、外链、联系方式、敏感词等违规内容
- Agent 绝不替用户扫码登录
