# MWE Codex 插件共享市场

一个静态优先的 Codex 插件市场原型，采用 Perspective 版作为正式 UI。它包含插件发现、搜索筛选、详情页、提交页、安装指南、审核规则，以及中央仓库驱动的插件提交/审核/同步流程。

## 本地预览

```bash
python3 -m http.server 4173
```

然后打开 `http://localhost:4173`。

## 中央仓库模型

核心文件：

- `marketplace/submissions/*.json`：用户提交的 GitHub 仓库链接，新提交默认 `reviewing`。
- `marketplace/plugins/*.json`：审核通过后的插件源记录。
- `registry/plugins.json`：网页读取的展示 registry，由脚本生成。
- `marketplace.json`：Codex Desktop / Codex CLI 可读取的市场入口文件，由脚本生成。
- `scripts/marketplace.mjs`：提交、审核、拒绝、同步、校验的统一 CLI。

完整设计见 [docs/central-repository.md](docs/central-repository.md)。

## 本地审核流

```bash
# 1. 用户提交插件 GitHub 链接
node scripts/marketplace.mjs submit https://github.com/owner/codex-plugin --note "插件说明" --by @alice

# 2. 同步后网页会出现 reviewing / pending 状态
node scripts/marketplace.mjs sync

# 3. 维护者审核通过并补齐 metadata
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

# 4. 同步后网页和 marketplace.json 会显示 verified / synced
node scripts/marketplace.mjs sync
```

## 校验与测试

```bash
node scripts/marketplace.mjs validate
node scripts/marketplace.mjs sync --check
node scripts/test-marketplace-flow.mjs
```

`test-marketplace-flow.mjs` 会复制一份临时仓库到 `/tmp`，测试提交链接、审核通过、同步 registry 和生成 `marketplace.json` 的完整闭环，不会污染真实 registry。

## GitHub 集成

- `.github/ISSUE_TEMPLATE/plugin-submission.yml`：用户提交插件链接的 issue 表单。
- `.github/workflows/marketplace-validate.yml`：PR / main 分支校验 marketplace 源文件和生成文件。
- `.github/workflows/marketplace-submission-comment.yml`：维护者可在 issue 评论 `/marketplace submit https://github.com/owner/repo` 创建 reviewing 提交 PR。
