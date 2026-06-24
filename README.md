# MWE Codex 插件共享市场

一个由中央 GitHub 仓库驱动的 Codex 插件共享市场。当前仓库只保留已确定的 Perspective UI 方案，默认 registry 从空列表开始，方便真实测试插件分享、审核、合并和同步。

## 本地服务

开发预览可以直接启动本地 Node 服务：

```bash
PORT=4173 node server.mjs
```

持久化访问使用 Docker Compose。网页提交功能需要一个能创建 issue 的 GitHub token，可以放在 shell 环境或本地 `.env` 中：

```bash
cp .env.example .env
# 编辑 .env，填入 GITHUB_TOKEN，并设置 MARKETPLACE_ADMIN_PASSWORD 或 ADMIN_PASSWORD
docker compose up -d --build
```

服务默认监听：

```text
http://127.0.0.1:8787
```

容器名：

```text
marvel-local-server-mwe-codex-marketplace
```

## 用户级 systemd 服务

安装并启动本地持久服务：

```bash
mkdir -p ~/.config/systemd/user
cp deploy/mwe-codex-marketplace.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now mwe-codex-marketplace.service
```

## Cloudflare Tunnel

本地 web 容器在 `127.0.0.1:8787`，Compose 也提供了可选的 Cloudflare Tunnel profile。创建持久 tunnel 后，将 hostname 指向：

```text
http://mwe-codex-marketplace:80
```

然后用外部环境变量启动，不要把 token 写进仓库：

```bash
export CLOUDFLARE_TUNNEL_TOKEN='...'
docker compose --profile tunnel up -d --build
```

更多说明见 [deploy/cloudflare-tunnel.md](deploy/cloudflare-tunnel.md)。

## 中央仓库模型

核心文件：

- `marketplace/submissions/*.json`：用户提交的 GitHub 仓库链接，新提交默认 `reviewing`。
- `marketplace/plugins/*.json`：审核通过后的插件源记录。
- `marketplace/snapshots/*`：自动审核通过后复制进中央仓库的可安装插件快照，供 Codex marketplace 使用。
- `registry/plugins.json`：网页读取的展示 registry，由脚本生成。
- `marketplace.json`：网页和调试用的市场快照，由脚本生成。
- `.agents/plugins/marketplace.json`：Codex CLI/Desktop 识别的 marketplace manifest，由脚本生成。
- `scripts/marketplace.mjs`：提交、审核、拒绝、管理员移除、同步、校验的统一 CLI。

完整设计见 [docs/central-repository.md](docs/central-repository.md)。

## 测试分享插件

当前 registry 可以从空列表开始。用户在网页 `/submit` 填入 GitHub 仓库链接后，站点后端会自动创建或复用追踪 issue；用户不需要跳转到 GitHub 手动创建 issue。issue 创建后，GitHub Action 会按规则自动审核、同步并提交到 `main`。也可以本地模拟一条提交：

```bash
node scripts/marketplace.mjs submit https://github.com/owner/codex-plugin --note "插件说明" --by @alice
node scripts/marketplace.mjs sync
```

同步后网页会显示 `reviewing / pending` 状态。维护者审核通过并补齐 metadata：

```bash
node scripts/marketplace.mjs approve <submission-id> \
  --name demo-plugin \
  --display-name "Demo Plugin" \
  --description "源仓库 summary 的中文翻译" \
  --author owner \
  --category "Developer Tools" \
  --version 0.1.0 \
  --release-tag v0.1.0 \
  --tags Demo,Codex \
  --capabilities Skill,Guidance \
  --by @maintainer
node scripts/marketplace.mjs sync
```

审核通过后网页、`marketplace.json` 和 `.agents/plugins/marketplace.json` 会显示 `verified / synced`。每个已验证插件都会提供插件 GitHub 链接和 `codex plugin add plugin-name@codex-community` 的单插件安装命令。删除已收录插件、删除失败上传请求、或对失败上传请求进行管理员手动通过，都需要网页提交管理员密码；密码由容器环境变量 `MARKETPLACE_ADMIN_PASSWORD` 或 `ADMIN_PASSWORD` 提供，只在服务端校验，不会写入 GitHub issue。

## 自动审核规则

`node scripts/marketplace.mjs auto-review <submission-id|github-url>` 会克隆公开 GitHub 仓库并检查：

- 根目录或 `plugins/*` 子目录存在 `.codex-plugin/plugin.json`。
- `name`、`version`、`author`、`interface.displayName`、`interface.category`、`interface.capabilities` 有效。
- `version` 使用 SemVer。
- 插件目录包含 `README.md`。
- manifest 声明的 `skills` 和 `mcpServers` 路径真实存在。

规则通过后会自动生成 `marketplace/plugins/<plugin>.json`，同步 registry，并在 GitHub Action 中直接提交到 `main`，让网页和 Codex marketplace 快照一起更新。

## 校验与测试

```bash
node scripts/marketplace.mjs validate
node scripts/marketplace.mjs sync --check
node scripts/test-marketplace-flow.mjs
```

`test-marketplace-flow.mjs` 会复制一份临时仓库到 `/tmp`，测试提交链接、审核通过、同步 registry 和生成 `marketplace.json` 的完整闭环，不会污染真实 registry。

## GitHub 集成

- `server.mjs`：网页提交 API，校验 GitHub URL、去重并代创建追踪 issue。
- `.github/ISSUE_TEMPLATE/plugin-submission.yml`：维护者兜底使用的 issue 表单。
- `.github/workflows/marketplace-validate.yml`：PR / main 分支校验 marketplace 源文件和生成文件。
- `.github/workflows/marketplace-auto-review.yml`：从 issue 标题/正文或评论提取仓库链接，自动审核、同步并提交到 `main`。
