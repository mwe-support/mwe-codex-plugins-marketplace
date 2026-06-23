# 中央仓库设计

MWE Codex 插件共享市场采用“静态 registry + GitHub 审核流”的中央仓库模型。网页、Codex Desktop 和 Codex CLI 都从同一个仓库读取市场数据。

## 目录职责

- `marketplace/submissions/*.json`：用户提交的 GitHub 仓库链接。新提交默认 `reviewing`，会在网页中显示为待审核插件。
- `marketplace/plugins/*.json`：审核通过后的插件源记录。这里是 registry 的上游事实来源。
- `marketplace/snapshots/*`：审核通过后的插件目录快照，`.agents/plugins/marketplace.json` 会把 Codex 安装源指向这里。
- `registry/plugins.json`：网页读取的展示 registry，由脚本生成，不手改。
- `marketplace.json`：网页和调试用的市场快照，由脚本生成，不手改。
- `.agents/plugins/marketplace.json`：Codex Desktop / CLI 可消费的 marketplace manifest，由脚本生成，不手改。
- `scripts/marketplace.mjs`：提交、审核、拒绝、同步、校验的统一入口。

## 状态机

1. 网页提交：用户提交 GitHub URL，`server.mjs` 调用 GitHub API 创建或复用追踪 issue。用户不需要跳转到 GitHub。
2. `sync`：网页 registry 包含 reviewing 提交，因此列表会显示“审核中 / 待同步”。
3. `auto-review`：Action 按规则克隆仓库、发现 `.codex-plugin/plugin.json`、验证 manifest/README/skills/mcp 路径，生成 `marketplace/plugins/<name>.json`，复制插件目录到 `marketplace/snapshots/<name>`，提交状态变为 `approved`。手动 `approve` 仍可作为兜底。
4. `sync`：registry 中该插件变为 `verified / synced`，同时写入 `marketplace.json` 和 `.agents/plugins/marketplace.json`。
5. `reject`：提交状态变为 `rejected`，不会进入展示 registry。

## 本地命令

```bash
node scripts/marketplace.mjs submit https://github.com/owner/codex-plugin --note "插件说明" --by @alice
node scripts/marketplace.mjs sync
node scripts/marketplace.mjs approve <submission-id> \
  --name demo-plugin \
  --display-name "Demo Plugin" \
  --description "源仓库 summary 的中文翻译" \
  --author owner \
  --category Developer Tools \
  --version 0.1.0 \
  --release-tag v0.1.0 \
  --tags Demo,Codex \
  --capabilities Skill,Guidance \
  --by @maintainer
node scripts/marketplace.mjs sync
```

## GitHub 自动审核

- 网页表单只收集 GitHub URL 和说明，后端代创建追踪 issue。
- Issue 表单仍保留给维护者兜底使用。
- `Marketplace Auto Review` Action 会从 issue 标题、issue 正文或 `/marketplace submit <url>` 评论提取仓库链接。
- Action 执行 `auto-review` 与 `sync --check`，规则通过后直接提交到 `main`。
- 合并后网页读取 `registry/plugins.json` 展示插件；Codex 读取 `.agents/plugins/marketplace.json` 同步插件。
- 规则失败时 Action 会在 issue 中评论失败原因，维护者可修复源仓库后重新编辑 issue、添加标签或评论命令触发。

## 同步边界

当前脚本会联网克隆公开 GitHub 仓库读取 `.codex-plugin/plugin.json`。Release/tag 推荐用于稳定分发；没有 Release 时可使用默认分支作为预览 ref。后续可以继续扩展为读取 GitHub Release 资产、校验二进制 checksum、展示权限风险评分。
