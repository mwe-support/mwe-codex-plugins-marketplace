# MWE Codex插件共享市场

MWE Codex插件共享市场是一个轻量的 Codex 插件分享网页。用户粘贴公开 GitHub 仓库链接后，服务端会读取仓库并检测是否包含可识别的 Codex 插件入口；检测通过的插件会写入 PostgreSQL，并在网页市场中近实时展示。

当前产品不使用中央 GitHub registry 仓库、GitHub issue 审核流或 GitHub Actions 同步快照。网页和 `/api/check` 是唯一的普通上传入口，PostgreSQL 是运行时状态源。

## 功能

- 粘贴公开 GitHub 仓库链接并触发服务端检测。
- 支持 `.codex-plugin/plugin.json`，也会宽松识别明显的 `skills/*/SKILL.md` 或 MCP 插件结构。
- 非关键问题会作为安全/结构提示显示，不会轻易让自动检测失败。
- 检测通过后立即出现在插件市场；检测失败会写入失败记录，不停留在待审核状态。
- 插件卡片提供两个复制动作：复制插件仓库链接、复制 `codex plugin add <插件仓库链接>` CLI 安装命令。
- 管理员可用 `MARKETPLACE_ADMIN_PASSWORD` 删除已收录插件。
- 前端交互源码在 `src/app.ts`，构建输出为 `app.js`。

## 本地开发

```bash
npm install
npm run build
PORT=8787 node server.mjs
```

打开 `http://127.0.0.1:8787/`。

## Docker Compose 运行

默认模板文件是 `docker-compose.yml`。默认 Web 镜像使用已经发布到 GHCR 的预构建镜像，不进行本地构建：

```bash
docker compose pull
docker compose up -d
```

服务地址：`http://127.0.0.1:8787/`。

PostgreSQL 会通过 compose 启动；Web 容器启动时会自动执行 `scripts/db-migrate.mjs`。

如需固定版本或切换镜像，可在 `.env` 设置：

```dotenv
MARKETPLACE_IMAGE=ghcr.io/mwe-support/mwe-codex-plugins-marketplace:4b22691
```

## Cloudflare Tunnel

1. 在 Cloudflare Zero Trust 创建 Tunnel。
2. 在 Tunnel 的 Public Hostname 中配置你的域名，并把 Service 指向 compose 内部服务：

```text
http://mwe-codex-marketplace:80
```

3. 把 Cloudflare tunnel token 放到本地 `.env`，不要提交：

```dotenv
CLOUDFLARE_TUNNEL_TOKEN=你的-token
```

4. 启动包含 tunnel 的 profile：

```bash
docker compose --profile tunnel up -d
```

检查 tunnel 日志：

```bash
docker logs marvel-local-server-mwe-codex-marketplace-tunnel
```

## GHCR 镜像

发布镜像名称：

```text
ghcr.io/mwe-support/mwe-codex-plugins-marketplace
```

推送 GHCR 需要当前 Docker 客户端已登录 `ghcr.io`，且账号对 `mwe-support/mwe-codex-plugins-marketplace` 有 package 写入权限。

## 环境变量

- `DATABASE_URL`：PostgreSQL 连接串。
- `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD`：compose 内置 PostgreSQL 配置。
- `SUBMISSION_RATE_LIMIT`：限流窗口内每个 IP 的提交次数，默认 `10`。
- `SUBMISSION_RATE_WINDOW_MS`：提交限流窗口，默认 `60000`，即 1 分钟。
- `PLUGIN_CLONE_TIMEOUT_MS`：单次仓库 clone 超时，默认 `45000`。
- `GITHUB_PROXY_PREFIX`：GitHub 官方 clone 失败后的 fallback 前缀，默认 `https://gh-proxy.com/`；设置为 `none` 可禁用。
- `GITHUB_HEALTH_REPOSITORY`：`/api/github-health` 默认探测仓库，默认 `https://github.com/upstash/context7`。
- `GITHUB_HEALTH_TIMEOUT_MS`：GitHub 健康检查超时，默认 `10000`。
- `MARKETPLACE_ADMIN_PASSWORD`：管理员删除插件的密码。
- `ADMIN_PASSWORD`：兼容旧部署的管理员密码变量。
- `CLOUDFLARE_TUNNEL_TOKEN`：可选 Cloudflare Tunnel token。
- `MARKETPLACE_IMAGE`：compose 使用的 Web 镜像名，默认 `ghcr.io/mwe-support/mwe-codex-plugins-marketplace:latest`。

普通用户上传插件不需要 `GITHUB_TOKEN` 或 `MARKETPLACE_GITHUB_REPOSITORY`。只有发布 GHCR 镜像或操作远端 GitHub 仓库时才需要外部 GitHub 权限。

## API

### `GET /api/health`

返回服务和数据库状态。

### `GET /api/market`

返回当前插件列表和最近检测记录。

### `GET /api/github-health`

只读 GitHub 访问健康检查，不写数据库，也不走提交限流。默认探测 `GITHUB_HEALTH_REPOSITORY`，也可传入 `repositoryUrl` 查询参数。

### `POST /api/check`

请求体：

```json
{
  "repositoryUrl": "https://github.com/owner/repo"
}
```

通过时返回 `status: "approved"` 和插件列表；失败时返回 `status: "failed"` 与失败原因，并在市场状态中保留失败记录。

### `DELETE /api/plugins/:name`

管理员删除已收录插件。请求体需要包含管理员密码：

```json
{
  "adminPassword": "...",
  "reason": "可选删除原因"
}
```

## 验证

```bash
npm run check
curl -sS http://127.0.0.1:8787/api/health
curl -sS -X POST http://127.0.0.1:8787/api/check \
  -H 'Content-Type: application/json' \
  --data '{"repositoryUrl":"https://github.com/callstackincubator/agent-skills"}'
```
