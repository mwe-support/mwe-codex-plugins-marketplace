# MWE Codex 插件快享市场

这是一个轻量的 Codex 插件分享网页。用户只需要粘贴公开 GitHub 仓库链接，服务端会读取仓库并检测是否包含 Codex 插件入口；检测通过后，插件会写入 PostgreSQL 并实时显示在市场列表中。

当前版本不再使用中央 registry 仓库、GitHub issue 审核流或 GitHub Action 同步快照。网页本身就是分享入口和实时状态源。

## 功能

- 粘贴 GitHub 仓库链接并触发服务端检测。
- 支持 `.codex-plugin/plugin.json`，也会宽松识别明显的 `skills/*/SKILL.md` 或 MCP 插件结构。
- 非关键问题会作为安全/结构提示显示，不会轻易让自动检测失败。
- 检测通过后立即出现在插件市场。
- 检测失败会立刻写入失败记录，不再停留在待审核。
- 插件卡片提供复制仓库链接和复制 Codex CLI 安装命令。
- 前端交互源码在 `src/app.ts`，构建输出为 `app.js`。

## 本地开发

```bash
npm install
npm run build
PORT=8787 node server.mjs
```

打开 `http://127.0.0.1:8787/`。

## 容器运行

```bash
docker compose up -d --build mwe-codex-marketplace
```

服务地址：`http://127.0.0.1:8787/`。

PostgreSQL 会通过 compose 启动；容器启动时会自动执行 `scripts/db-migrate.mjs`。

## 环境变量

- `DATABASE_URL`：PostgreSQL 连接串。
- `SUBMISSION_RATE_LIMIT`：10 分钟内每个 IP 的提交次数，默认 `8`。
- `PLUGIN_CLONE_TIMEOUT_MS`：单次仓库 clone 超时，默认 `45000`。

不再需要 `GITHUB_TOKEN` 或 `MARKETPLACE_GITHUB_REPOSITORY` 来处理普通上传。

管理员删除已加入市场的插件时，需要设置 `MARKETPLACE_ADMIN_PASSWORD`，也兼容 `ADMIN_PASSWORD`。网页详情页会提供删除表单，服务端校验密码后直接从当前市场移除插件。

## API

### `GET /api/health`

返回服务和数据库状态。

### `GET /api/market`

返回当前插件列表和最近检测记录。

### `POST /api/check`

请求体：

```json
{
  "repositoryUrl": "https://github.com/owner/repo"
}
```

通过时返回 `status: "approved"` 和插件列表；失败时返回 `status: "failed"` 与失败原因，并在市场状态中保留失败记录。

## 验证

```bash
npm run check
curl -sS http://127.0.0.1:8787/api/health
curl -sS -X POST http://127.0.0.1:8787/api/check \
  -H 'Content-Type: application/json' \
  --data '{"repositoryUrl":"https://github.com/callstackincubator/agent-skills"}'
```
