# 快速上手

5 分钟启动抖音评论自动回复。

## 步骤 1：安装

```bash
cd tools
npm install
npx playwright install chromium
```

## 步骤 2：配置

编辑 `skill/templates/default.json`：

```json
{
  "aiName": "你的AI名字",
  "signature": "——来自你的AI名字"
}
```

## 步骤 3：登录

```bash
npm run auth
```

浏览器会打开，扫码登录抖音创作者中心。

## 步骤 4：测试

```bash
# 查看作品列表
npm run works

# 导出第一条作品的评论
npm run comments:export -- "你的作品标题"

# 查看 JSON
cat comments-output/unreplied-comments.json
```

## 步骤 5：AI 回复

将 `skill/` 目录放到你的 OpenClaw workspace，然后对 AI 说：

> "检查一下我的抖音评论"

AI 会自动：
1. 导出评论
2. 分类意图
3. 生成回复
4. 询问是否发送

## 常见问题

**Q: 登录失败怎么办？**
A: 手动打开浏览器登录创作者中心，再运行脚本。

**Q: 评论导出为空？**
A: 确保作品有评论，且账号已登录。

**Q: 回复没发送？**
A: 检查 `reply-comments-result.json` 的错误信息。