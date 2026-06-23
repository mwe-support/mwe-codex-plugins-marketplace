# 中央仓库设计

MWE Codex 插件共享市场采用“静态 registry + GitHub 审核流”的中央仓库模型。网页、Codex Desktop 和 Codex CLI 都从同一个仓库读取市场数据。

## 目录职责

- `marketplace/submissions/*.json`：用户提交的 GitHub 仓库链接。新提交默认 `reviewing`，会在网页中显示为待审核插件。
- `marketplace/plugins/*.json`：审核通过后的插件源记录。这里是 registry 的上游事实来源。
- `registry/plugins.json`：网页读取的展示 registry，由脚本生成，不手改。
- `marketplace.json`：Codex Desktop / CLI 可消费的市场入口文件，由脚本生成，不手改。
- `scripts/marketplace.mjs`：提交、审核、拒绝、同步、校验的统一入口。

## 状态机

1. `submit`：用户提交 GitHub URL，生成 `marketplace/submissions/<id>.json`，状态为 `reviewing`。
2. `sync`：网页 registry 包含 reviewing 提交，因此列表会显示“审核中 / 待同步”。
3. `approve`：维护者补齐源仓库 summary、版本、分类等字段，生成 `marketplace/plugins/<name>.json`，提交状态变为 `approved`。
4. `sync`：registry 中该插件变为 `verified / synced`，同时写入 `marketplace.json`。
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

## GitHub 审核建议

- Issue 表单只收集 GitHub URL 和说明。
- Action 先校验 URL、重复提交、manifest 路径、Release/tag、必要资产。
- 维护者审核通过后，在 PR 中新增或更新 `marketplace/plugins/<name>.json`。
- 合并到 `main` 后运行 `sync`，自动更新 `registry/plugins.json` 和 `marketplace.json`。

## 同步边界

当前脚本不联网抓取远端 Release，先保证中央仓库状态机可测。后续可以把 `approve` 阶段扩展为：读取 GitHub Release 中的 `.codex-plugin/plugin.json`，自动填充 `displayName`、`description`、`version`、`logo` 和 `capabilities`。
