# 抖音评论自动回复

让 AI 自动帮你检查抖音评论、分类意图、生成回复草稿、批量发送回复。

## 功能

- ✅ 自动导出未回复评论
- ✅ 智能意图分类（购买意向/咨询/互动/恶意）
- ✅ 个性化回复生成
- ✅ 浏览器自动发送
- ✅ 心跳检查（每小时自动运行）
- ✅ SQLite 持久化存储

## 适合谁用

- 抖音内容创作者
- OpenClaw 用户
- 想做 AI 自动化的开发者

## 快速开始

### 1. 安装依赖

```bash
cd tools
npm install
npx playwright install chromium
```

### 2. 配置回复模板

编辑 `skill/templates/default.json`：

```json
{
  "aiName": "你的AI名字",
  "signature": "——来自你的AI名字",
  "specialUsers": {}
}
```

### 3. 扫码登录

```bash
cd tools
npm run login
```

### 4. 运行检查

```bash
npm run works           # 获取作品列表
npm run comments:export # 导出评论
npm run comments:reply  # 回复评论
```

## 项目结构

```
douyin-comment-automation/
├── README.md                 # 本文件
├── QUICKSTART.md             # 快速上手
├── SKILL.md                  # AI 可读的技能说明
│
├── tools/                    # Node.js 工具库
│   ├── package.json
│   ├── src/                  # Playwright 自动化脚本
│   └── data/                 # SQLite 数据库
│
├── skill/                    # OpenClaw Skill
│   ├── SKILL.md              # 技能主文档
│   ├── config.json.example   # 配置模板
│   └── templates/            # 回复模板
│
├── heartbeat/                # 心跳检查
│   └── HEARTBEAT.md.example  # 心跳配置模板
│
└── examples/                 # 示例
    ├── sample-comments.json
    └── sample-replies.json
```

## 意图分类

| 类型 | 说明 | 优先级 |
|------|------|--------|
| `buying_intent` | 购买意向 | 高 |
| `inquiry` | 咨询问题 | 高 |
| `support` | 售后问题 | 高 |
| `engagement` | 催更/互动 | 中 |
| `price_objection` | 价格异议 | 中 |
| `skepticism` | 质疑 | 中 |
| `noise` | 无效评论 | 低 |
| `malicious` | 恶意评论 | 特殊处理 |

## 回复格式

```
🦞 [回复内容]

——来自[AI名字]
```

## 与 OpenClaw 集成

1. 将 `skill/` 目录复制到你的 OpenClaw workspace 的 `skills/` 目录
2. 配置 `heartbeat/HEARTBEAT.md.example` 到你的 workspace 根目录
3. 重启 OpenClaw Gateway

AI 会自动每小时检查一次评论并生成回复。

## 安全机制

- **恶意评论防护**：自动检测并屏蔽 prompt 注入攻击
- **Dry-run 模式**：默认先预览再发送
- **发送日志**：所有回复都有记录

## 许可证

MIT

## 作者

从 lyzbcy 的个人项目提取并通用化