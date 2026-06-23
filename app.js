const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

const MARKETPLACE_REPOSITORY_URL = "https://github.com/mwe-support/mwe-codex-plugins-marketplace";
const MARKETPLACE_COMMAND = `codex plugin marketplace add ${MARKETPLACE_REPOSITORY_URL}`;
const ISSUE_BASE = `${MARKETPLACE_REPOSITORY_URL}/issues/new`;

let registry = { marketplace: {}, plugins: [] };
let state = {
  route: window.location.pathname,
  query: "",
  category: "全部",
  showOnlyVerified: false,
  submitTouched: false,
  submitLoading: false,
  submitSuccessUrl: "",
};

const statusLabel = {
  verified: "已验证",
  reviewing: "审核中",
  unverified: "未验证",
  synced: "已同步",
  pending: "待同步",
  failed: "同步失败",
};

const icon = (name, label = "") =>
  `<i data-lucide="${name}" class="icon" aria-hidden="true"></i>${label ? `<span>${label}</span>` : ""}`;

const formatDate = (value) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));

const formatShanghaiDateTime = (value) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));

const safe = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function navigate(path) {
  window.history.pushState({}, "", path);
  state.route = path;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3600);
}

async function copyText(value, label = "已复制") {
  try {
    await navigator.clipboard.writeText(value);
    showToast(label);
  } catch {
    showToast("复制失败，请手动选择文本");
  }
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("marketplace-theme", theme);
  renderIcons();
}

function currentTheme() {
  return localStorage.getItem("marketplace-theme") || "dark";
}

async function loadRegistry() {
  try {
    const response = await fetch("/registry/plugins.json", { cache: "no-store" });
    registry = await response.json();
  } catch {
    showToast("Registry 加载失败，正在显示空状态");
    registry = { marketplace: {}, plugins: [] };
  }
  render();
}

function categories() {
  return ["全部", ...new Set(registry.plugins.map((plugin) => plugin.category))];
}

function filteredPlugins() {
  const deferredQuery = state.query.trim().toLowerCase();
  return registry.plugins.filter((plugin) => {
    const haystack = [
      plugin.name,
      plugin.displayName,
      plugin.description,
      plugin.author,
      plugin.category,
      ...(plugin.tags || []),
    ]
      .join(" ")
      .toLowerCase();

    const matchesQuery = !deferredQuery || haystack.includes(deferredQuery);
    const matchesCategory = state.category === "全部" || plugin.category === state.category;
    const matchesVerified = !state.showOnlyVerified || plugin.verifiedStatus === "verified";
    return matchesQuery && matchesCategory && matchesVerified;
  });
}

function statusBadge(type, value) {
  return `<span class="status ${safe(value)}">${icon(
    value === "verified" || value === "synced" ? "badge-check" : value === "failed" ? "triangle-alert" : "clock-3"
  )}${safe(statusLabel[value] || value)}</span>`;
}

function tagList(items) {
  return (items || []).map((item) => `<span class="badge">${safe(item)}</span>`).join("");
}

function header() {
  const theme = currentTheme();
  const navItems = [
    ["/", "store", "市场"],
    ["/submit", "git-pull-request", "提交"],
    ["/install", "download", "安装"],
    ["/about", "shield-check", "规则"],
  ];
  const active = topLevelRoute();
  return `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="/" data-link aria-label="返回插件市场首页">
          <span class="brand-mark logo-mark"><img src="/assets/mwe-logo.png" alt="" width="28" height="28" /></span>
          <span>MWE Codex插件共享市场</span>
        </a>
        <nav class="nav" aria-label="主导航">
          ${navItems
            .map(
              ([href, iconName, label]) => `
                <a class="nav-link" href="${href}" data-link ${
                  active === href ? 'aria-current="page"' : ""
                }>${icon(iconName, label)}</a>
              `
            )
            .join("")}
        </nav>
        <div class="top-actions">
          <button class="icon-button" type="button" data-theme-toggle aria-label="${
            theme === "dark" ? "切换到浅色模式" : "切换到暗色模式"
          }">
            ${icon(theme === "dark" ? "sun" : "moon")}
          </button>
          <a class="button secondary" href="/install" data-link>${icon("monitor", "Codex Desktop")}</a>
        </div>
      </div>
    </header>
  `;
}

function topLevelRoute() {
  if (state.route.startsWith("/plugins/") || state.route.startsWith("/perspective")) return "/";
  return ["/submit", "/install", "/about"].find((route) => state.route.startsWith(route)) || "/";
}

function homePage() {
  const plugins = filteredPlugins();
  const verifiedCount = registry.plugins.filter((plugin) => plugin.verifiedStatus === "verified").length;
  const categoriesCount = categories().length - 1;
  return `
    ${header()}
    <main id="main" class="page">
      <div class="workspace-grid">
        <section>
          <div class="page-heading">
            <span class="eyebrow">${icon("sparkles", "Community Marketplace")}</span>
            <h1>发现、审核并安装社区维护的 Codex 插件</h1>
            <p class="lede">搜索插件能力、查看同步状态，并把这个 GitHub Marketplace 添加到 Codex Desktop。</p>
          </div>

          <div class="panel search-panel" aria-label="插件搜索与筛选">
            <div class="search-row">
              <div class="field">
                <label for="plugin-search">搜索插件</label>
                <div class="input-shell">
                  ${icon("search")}
                  <input id="plugin-search" value="${safe(state.query)}" placeholder="搜索 GitHub、设计、数据、文档..." autocomplete="off" />
                </div>
              </div>
              <button class="button secondary" type="button" data-verified-toggle aria-pressed="${state.showOnlyVerified}">
                ${icon("badge-check", state.showOnlyVerified ? "显示全部" : "仅看已验证")}
              </button>
            </div>
            <div class="tabs" role="tablist" aria-label="插件分类">
              ${categories()
                .map(
                  (category) => `
                    <button class="tab-button" type="button" role="tab" data-category="${safe(category)}" aria-selected="${
                      state.category === category
                    }">${safe(category)}</button>
                  `
                )
                .join("")}
            </div>
          </div>

          <div class="section-head">
            <div>
              <h2>${plugins.length ? "插件目录" : "没有匹配结果"}</h2>
              <p>${plugins.length ? `找到 ${plugins.length} 个插件，按当前筛选展示。` : "换个关键词，或提交你想收录的插件。"}</p>
            </div>
            <a class="button ghost" href="/submit" data-link>${icon("plus", "分享插件")}</a>
          </div>

          ${
            plugins.length
              ? `<div class="plugin-grid">${plugins.map((plugin, index) => pluginCard(plugin, index)).join("")}</div>`
              : emptyState()
          }
        </section>

        <aside class="sidebar" aria-label="Marketplace 信息">
          <section class="panel marketplace-panel">
            <div class="sidebar-visual sky">
              <p class="eyebrow">Marketplace source</p>
              <h2>Marketplace</h2>
              <p>添加一次，后续从 GitHub 同步审核通过的插件。</p>
            </div>
            <div class="section-head sr-panel-copy">
              <div>
                <h2>Marketplace</h2>
              </div>
            </div>
            <div class="code-box">
              <code>${safe(MARKETPLACE_COMMAND)}</code>
              <button class="copy-button" type="button" data-copy="${safe(MARKETPLACE_COMMAND)}" aria-label="复制 Marketplace 添加命令">
                ${icon("copy")}
              </button>
            </div>
          </section>

          <section class="panel stats-panel sidebar-panel-colored">
            <div class="section-head compact">
              <div>
                <p class="eyebrow">Registry snapshot</p>
                <h2>市场概览</h2>
              </div>
            </div>
            <div class="metrics" aria-label="市场统计">
              <div class="metric tone-sky">${icon("boxes")}<strong>${registry.plugins.length}</strong><span>插件总数</span></div>
              <div class="metric tone-violet">${icon("badge-check")}<strong>${verifiedCount}</strong><span>已验证</span></div>
              <div class="metric tone-aurora">${icon("tags")}<strong>${categoriesCount}</strong><span>分类覆盖</span></div>
            </div>
          </section>

          <section class="panel review-panel">
            <div class="sidebar-visual aurora">
              <p class="eyebrow">Review pipeline</p>
              <h2>审核流程</h2>
              <p>从提交链接到 PR 合并，每一步都可追踪。</p>
            </div>
            <div class="timeline">
              ${timelineItem("link", "提交 GitHub 链接", "表单会生成可追踪的 GitHub issue。")}
              ${timelineItem("scan-search", "Action 校验", "检查 manifest、Release、资产和目录结构。")}
              ${timelineItem("git-pull-request", "PR 审核", "维护者合并后进入 marketplace.json。")}
            </div>
          </section>
        </aside>
      </div>
    </main>
  `;
}

function pluginCard(plugin, index = 0) {
  return `
    <article class="plugin-card tone-${(index % 3) + 1}">
      <div class="plugin-visual">
        <div class="plugin-top">
        <img class="avatar" src="${safe(plugin.avatarUrl)}" alt="${safe(plugin.author)} 头像" loading="lazy" width="48" height="48" />
        <div class="plugin-title">
          <h3>${safe(plugin.displayName)}</h3>
          <div class="meta">
            <span>${safe(plugin.author)}</span>
            <span class="mono">${safe(plugin.version)}</span>
            <span>${safe(plugin.category)}</span>
          </div>
        </div>
          ${statusBadge("verified", plugin.verifiedStatus)}
        </div>
        <div class="plugin-visual-label"><span>${safe(plugin.category)}</span><strong>${safe(plugin.releaseTag)}</strong></div>
      </div>
      <p class="card-description">${safe(plugin.description)}</p>
      <div class="chip-row">${tagList(plugin.tags)}</div>
      <div class="meta">
        ${statusBadge("sync", plugin.syncStatus)}
        <span>同步 ${formatDate(plugin.syncTimestamp)}</span>
      </div>
      <div class="card-actions">
        <a class="button" href="/plugins/${safe(plugin.name)}" data-link>${icon("arrow-right", "查看详情")}</a>
        <a class="button secondary" href="${safe(plugin.repositoryUrl)}" target="_blank" rel="noreferrer">${icon("github", "GitHub")}</a>
      </div>
    </article>
  `;
}

function emptyState() {
  return `
    <div class="empty-state">
      <div>
        <span class="brand-mark" style="margin:0 auto;">${icon("search-x")}</span>
        <h2>没有找到插件</h2>
        <p class="lede">试试清空筛选、切换分类，或者把你希望收录的 GitHub 仓库提交给维护者。</p>
        <div class="form-actions" style="justify-content:center;">
          <button class="button secondary" type="button" data-clear-filters>${icon("rotate-ccw", "清空筛选")}</button>
          <a class="button" href="/submit" data-link>${icon("plus", "提交插件")}</a>
        </div>
      </div>
    </div>
  `;
}

function perspectivePage() {
  const plugins = filteredPlugins();
  const verifiedCount = registry.plugins.filter((plugin) => plugin.verifiedStatus === "verified").length;
  const categoriesCount = categories().length - 1;
  return `
    <div class="perspective-app">
      ${header()}
      <main id="main" class="perspective-page" aria-label="Perspective 版插件市场">
        <section class="perspective-hero" aria-labelledby="perspective-title">
          <div class="perspective-atmosphere" aria-hidden="true"></div>
          <div class="perspective-stage">
            <div class="perspective-panel">
              <div class="perspective-copy">
                <span class="perspective-kicker">${icon("sparkles", "Perspective Marketplace")}</span>
                <h1 id="perspective-title">MWE Codex插件共享市场</h1>
                <p>汇集社区分享的 Codex 插件，支持按能力搜索、查看同步与审核状态，并快速复制安装命令添加到 Codex。</p>
                <div class="perspective-actions">
                  <a class="perspective-button primary" href="/submit" data-link>${icon("git-pull-request", "提交插件")}</a>
                  <button class="perspective-button secondary" type="button" data-copy="${safe(MARKETPLACE_REPOSITORY_URL)}" data-copy-label="Marketplace 链接已复制">${icon("monitor", "复制 Desktop 链接")}</button>
                  <button class="perspective-button secondary" type="button" data-copy="${safe(MARKETPLACE_COMMAND)}" data-copy-label="CLI 命令已复制">${icon("terminal", "复制 CLI 命令")}</button>
                </div>
              </div>

              <div class="perspective-console" aria-label="市场概览控制台">
                <div class="perspective-console-head">
                  <span>${icon("clock-3", "Asia/Shanghai")}</span>
                  <strong data-shanghai-clock aria-label="Asia/Shanghai 当前时间">${formatShanghaiDateTime(new Date())}</strong>
                </div>
                <div class="perspective-orbit-grid">
                  <div><strong>${registry.plugins.length}</strong><span>插件</span></div>
                  <div><strong>${verifiedCount}</strong><span>已验证</span></div>
                  <div><strong>${categoriesCount}</strong><span>分类</span></div>
                </div>
                <div class="perspective-command-list" aria-label="Marketplace 集成方式">
                  <div class="perspective-command-row">
                    <span>${icon("monitor", "Codex Desktop")}</span>
                    <code>${safe(MARKETPLACE_REPOSITORY_URL)}</code>
                    <button class="perspective-copy-mini" type="button" data-copy="${safe(MARKETPLACE_REPOSITORY_URL)}" data-copy-label="Marketplace 链接已复制" aria-label="复制 Marketplace 链接">${icon("copy")}</button>
                  </div>
                  <div class="perspective-command-row">
                    <span>${icon("terminal", "Codex CLI")}</span>
                    <code>${safe(MARKETPLACE_COMMAND)}</code>
                    <button class="perspective-copy-mini" type="button" data-copy="${safe(MARKETPLACE_COMMAND)}" data-copy-label="CLI 命令已复制" aria-label="复制 Marketplace 命令">${icon("copy")}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="perspective-workspace" aria-label="Perspective 插件发现工作台">
          <aside class="perspective-rail" aria-label="插件市场流程">
            <div class="perspective-rail-card">
              <span class="perspective-kicker">Marketplace Guide</span>
              <h2>插件索引</h2>
              <p>按分类浏览社区插件，查看审核状态，并选择 Codex Desktop 链接或 Codex CLI 命令完成集成。</p>
            </div>
            ${perspectiveStep("search", "发现", "搜索能力和场景")}
            ${perspectiveStep("badge-check", "验证", "区分审核状态")}
            ${perspectiveStep("monitor", "Desktop", "复制 Marketplace 仓库链接")}
            ${perspectiveStep("terminal", "CLI", "复制 marketplace add 命令")}
            <a class="perspective-button secondary wide" href="/install" data-link>${icon("download", "查看安装指南")}</a>
          </aside>

          <div class="perspective-directory">
            <div class="perspective-filter glass-card">
              <div class="field perspective-search-field">
                <label for="plugin-search">搜索插件</label>
                <div class="input-shell">
                  ${icon("search")}
                  <input id="plugin-search" value="${safe(state.query)}" placeholder="搜索 GitHub、设计、数据、文档..." autocomplete="off" />
                </div>
              </div>
              <button class="perspective-button secondary" type="button" data-verified-toggle aria-pressed="${state.showOnlyVerified}">
                ${icon("badge-check", state.showOnlyVerified ? "显示全部" : "仅看已验证")}
              </button>
            </div>

            <div class="perspective-tabs" role="tablist" aria-label="插件分类">
              ${categories()
                .map(
                  (category) => `
                    <button class="perspective-tab" type="button" role="tab" data-category="${safe(category)}" aria-selected="${
                      state.category === category
                    }">${safe(category)}</button>
                  `
                )
                .join("")}
            </div>

            <div class="perspective-section-head">
              <div>
                <span class="perspective-kicker">Registry Objects</span>
                <h2>${plugins.length ? "插件市场" : "没有匹配结果"}</h2>
              </div>
              <p>${plugins.length ? `当前视图显示 ${plugins.length} 个插件。` : "清空筛选或提交一个新的 GitHub 仓库。"}</p>
            </div>

            ${
              plugins.length
                ? `<div class="perspective-grid">${plugins.map((plugin, index) => perspectivePluginCard(plugin, index)).join("")}</div>`
                : `<div class="glass-card perspective-empty">${emptyState()}</div>`
            }
          </div>
        </section>
      </main>
    </div>
  `;
}

function perspectiveStep(iconName, title, text) {
  return `
    <div class="perspective-step">
      <span>${icon(iconName)}</span>
      <div>
        <strong>${title}</strong>
        <p>${text}</p>
      </div>
    </div>
  `;
}

function perspectivePluginCard(plugin, index = 0) {
  return `
    <article class="perspective-plugin-card glass-card depth-${(index % 4) + 1}">
      <div class="perspective-card-top">
        <img class="avatar" src="${safe(plugin.avatarUrl)}" alt="${safe(plugin.author)} 头像" loading="lazy" width="48" height="48" />
        <div>
          <h3>${safe(plugin.displayName)}</h3>
          <p>${safe(plugin.author)} · ${safe(plugin.version)}</p>
        </div>
        ${statusBadge("verified", plugin.verifiedStatus)}
      </div>
      <p>${safe(plugin.description)}</p>
      <div class="chip-row">${tagList(plugin.tags)}</div>
      <div class="perspective-card-meta">
        ${statusBadge("sync", plugin.syncStatus)}
        <span>${safe(plugin.category)}</span>
        <span>${safe(plugin.releaseTag)}</span>
      </div>
      <div class="card-actions">
        <a class="perspective-button primary" href="/plugins/${safe(plugin.name)}" data-link>${icon("arrow-right", "查看")}</a>
        <a class="perspective-button secondary" href="${safe(plugin.repositoryUrl)}" target="_blank" rel="noreferrer">${icon("github", "GitHub")}</a>
      </div>
    </article>
  `;
}

function organicPage() {
  const plugins = filteredPlugins();
  const verifiedCount = registry.plugins.filter((plugin) => plugin.verifiedStatus === "verified").length;
  const categoriesCount = categories().length - 1;
  return `
    <div class="organic-app">
      ${header()}
      <main id="main" class="organic-page" aria-label="自然有机风格插件市场">
        <section class="organic-hero" aria-labelledby="organic-title">
          <div class="organic-ambient" aria-hidden="true">
            <span class="organic-blob blob-one"></span>
            <span class="organic-blob blob-two"></span>
            <span class="organic-blob blob-three"></span>
            <span class="organic-line line-one"></span>
            <span class="organic-line line-two"></span>
          </div>

          <div class="organic-hero-copy organic-surface text-panel">
            <span class="organic-kicker">${icon("leaf", "Organic Marketplace")}</span>
            <h1 id="organic-title">让 Codex 插件像创意生态一样自然生长</h1>
            <p>以柔和 blob、手绘曲线和雾面叠层组织插件信息。视觉像在呼吸，搜索、状态和安装动作依然清晰稳定。</p>
            <div class="organic-actions">
              <a class="organic-button primary" href="/submit" data-link>${icon("git-pull-request", "分享插件")}</a>
              <button class="organic-button secondary" type="button" data-copy="${safe(MARKETPLACE_COMMAND)}">${icon("copy", "复制 Marketplace")}</button>
            </div>
          </div>

          <aside class="organic-garden" aria-label="市场生态概览">
            <div class="organic-garden-card pod-large">
              <span>${icon("boxes")}</span>
              <strong>${registry.plugins.length}</strong>
              <p>插件枝叶</p>
            </div>
            <div class="organic-garden-card pod-medium">
              <span>${icon("badge-check")}</span>
              <strong>${verifiedCount}</strong>
              <p>已验证花苞</p>
            </div>
            <div class="organic-garden-card pod-small">
              <span>${icon("tags")}</span>
              <strong>${categoriesCount}</strong>
              <p>能力土壤</p>
            </div>
          </aside>
        </section>

        <section class="organic-workspace" aria-label="自然有机插件发现工作台">
          <div class="organic-toolbar organic-surface">
            <div class="field organic-search-field">
              <label for="plugin-search">搜索插件</label>
              <div class="input-shell">
                ${icon("search")}
                <input id="plugin-search" value="${safe(state.query)}" placeholder="搜索 GitHub、设计、数据、文档..." autocomplete="off" />
              </div>
            </div>
            <button class="organic-button secondary" type="button" data-verified-toggle aria-pressed="${state.showOnlyVerified}">
              ${icon("badge-check", state.showOnlyVerified ? "显示全部" : "仅看已验证")}
            </button>
          </div>

          <div class="organic-tabs" role="tablist" aria-label="插件分类">
            ${categories()
              .map(
                (category, index) => `
                  <button class="organic-tab tone-${(index % 4) + 1}" type="button" role="tab" data-category="${safe(category)}" aria-selected="${
                    state.category === category
                  }">${safe(category)}</button>
                `
              )
              .join("")}
          </div>

          <div class="organic-content-grid">
            <aside class="organic-story organic-surface" aria-label="收录流程">
              <span class="organic-kicker">Growth Path</span>
              <h2>收录像培育一株植物</h2>
              ${organicStep("link", "播种链接", "提交 GitHub 仓库，形成可追踪 issue。")}
              ${organicStep("scan-search", "温和校验", "检查 manifest、Release、资产和目录结构。")}
              ${organicStep("git-pull-request", "长入目录", "审核合并后同步到 Marketplace。")}
              <a class="organic-button secondary wide" href="/perspective" data-link>${icon("layers-3", "查看 Perspective 版")}</a>
            </aside>

            <div class="organic-directory">
              <div class="organic-section-head">
                <div>
                  <span class="organic-kicker">Plugin Grove</span>
                  <h2>${plugins.length ? "插件林地" : "没有匹配结果"}</h2>
                </div>
                <p>${plugins.length ? `当前筛选下有 ${plugins.length} 个插件。` : "换个关键词，或把新的插件仓库种进来。"}</p>
              </div>
              ${
                plugins.length
                  ? `<div class="organic-grid">${plugins.map((plugin, index) => organicPluginCard(plugin, index)).join("")}</div>`
                  : `<div class="organic-surface organic-empty">${emptyState()}</div>`
              }
            </div>
          </div>
        </section>
      </main>
    </div>
  `;
}

function organicStep(iconName, title, text) {
  return `
    <div class="organic-step">
      <span>${icon(iconName)}</span>
      <div>
        <strong>${title}</strong>
        <p>${text}</p>
      </div>
    </div>
  `;
}

function organicPluginCard(plugin, index = 0) {
  return `
    <article class="organic-plugin-card organic-surface tone-${(index % 5) + 1}">
      <div class="organic-card-visual" aria-hidden="true">
        <span class="organic-card-orb"></span>
        <span class="organic-card-thread"></span>
      </div>
      <div class="organic-card-body text-panel">
        <div class="organic-card-top">
          <img class="avatar" src="${safe(plugin.avatarUrl)}" alt="${safe(plugin.author)} 头像" loading="lazy" width="48" height="48" />
          <div>
            <h3>${safe(plugin.displayName)}</h3>
            <p>${safe(plugin.author)} · ${safe(plugin.version)} · ${safe(plugin.category)}</p>
          </div>
        </div>
        <p class="organic-description">${safe(plugin.description)}</p>
        <div class="chip-row">${tagList(plugin.tags)}</div>
        <div class="organic-card-meta">
          ${statusBadge("verified", plugin.verifiedStatus)}
          ${statusBadge("sync", plugin.syncStatus)}
          <span>${safe(plugin.releaseTag)}</span>
        </div>
        <div class="card-actions">
          <a class="organic-button primary" href="/plugins/${safe(plugin.name)}" data-link>${icon("arrow-right", "查看详情")}</a>
          <a class="organic-button secondary" href="${safe(plugin.repositoryUrl)}" target="_blank" rel="noreferrer">${icon("github", "GitHub")}</a>
        </div>
      </div>
    </article>
  `;
}

function timelineItem(iconName, title, text) {
  return `
    <div class="timeline-item">
      <span class="timeline-icon">${icon(iconName)}</span>
      <div>
        <strong>${title}</strong>
        <p class="helper">${text}</p>
      </div>
    </div>
  `;
}

function detailPage(name) {
  const plugin = registry.plugins.find((item) => item.name === name);
  if (!plugin) return notFoundPage();
  const installCommand = `codex plugin add ${plugin.name}@${registry.marketplace.name || "codex-community"}`;
  return `
    ${header()}
    <main id="main" class="page">
      <div class="detail-layout">
        <article class="detail-card">
          <a class="button ghost" href="/" data-link>${icon("arrow-left", "返回插件目录")}</a>
          <div class="detail-header detail-section">
            <img class="avatar" src="${safe(plugin.avatarUrl)}" alt="${safe(plugin.author)} 头像" loading="lazy" width="64" height="64" />
            <div>
              <span class="eyebrow">${safe(plugin.category)}</span>
              <h1>${safe(plugin.displayName)}</h1>
              <p class="lede">${safe(plugin.description)}</p>
            </div>
          </div>

          <section class="detail-section">
            <h2>插件说明</h2>
            <p>${safe(plugin.longDescription)}</p>
            <div class="chip-row">${tagList(plugin.tags)}${tagList(plugin.capabilities)}</div>
          </section>

          <section class="detail-section">
            <h2>版本与同步</h2>
            <ul class="detail-list">
              <li><span>当前版本</span><strong class="mono">${safe(plugin.version)}</strong></li>
              <li><span>Release/tag</span><strong class="mono">${safe(plugin.releaseTag)}</strong></li>
              <li><span>审核状态</span>${statusBadge("verified", plugin.verifiedStatus)}</li>
              <li><span>同步状态</span>${statusBadge("sync", plugin.syncStatus)}</li>
              <li><span>最近同步</span><strong>${formatDate(plugin.syncTimestamp)}</strong></li>
            </ul>
          </section>

          <section class="detail-section notice-box">
            <h2>安装前提示</h2>
            <p>社区插件会在合并前经过 manifest、Release 和资产路径校验。安装前仍建议阅读仓库源码、权限说明和 README。</p>
          </section>
        </article>

        <aside class="sidebar">
          <section class="panel">
            <h2>安装入口</h2>
            <p class="helper">Codex Desktop 使用 Marketplace 仓库链接；Codex CLI 使用 marketplace add 命令。</p>
            <div class="code-box">
              <code>${safe(MARKETPLACE_REPOSITORY_URL)}</code>
              <button class="copy-button" type="button" data-copy="${safe(MARKETPLACE_REPOSITORY_URL)}" data-copy-label="Marketplace 链接已复制" aria-label="复制 Marketplace 链接">${icon("monitor")}</button>
            </div>
            <div class="code-box">
              <code>${safe(MARKETPLACE_COMMAND)}</code>
              <button class="copy-button" type="button" data-copy="${safe(MARKETPLACE_COMMAND)}" data-copy-label="CLI 命令已复制" aria-label="复制 Marketplace 命令">${icon("terminal")}</button>
            </div>
            <div class="code-box">
              <code>${safe(installCommand)}</code>
              <button class="copy-button" type="button" data-copy="${safe(installCommand)}" aria-label="复制插件安装命令">${icon("copy")}</button>
            </div>
          </section>

          <section class="panel">
            <h2>来源</h2>
            <div class="form-actions">
              <a class="button secondary" href="${safe(plugin.repositoryUrl)}" target="_blank" rel="noreferrer">${icon("github", "打开 GitHub")}</a>
              <a class="button ghost" href="/submit" data-link>${icon("git-pull-request", "贡献更新")}</a>
            </div>
          </section>
        </aside>
      </div>
    </main>
  `;
}

function submitPage() {
  const url = document.querySelector("#repo-url")?.value || "";
  const note = document.querySelector("#submit-note")?.value || "";
  const error = state.submitTouched ? validateGithubUrl(url) : "";
  return `
    ${header()}
    <main id="main" class="page">
      <div class="detail-layout">
        <section class="detail-card">
          <span class="eyebrow">${icon("git-pull-request", "提交插件")}</span>
          <h1>分享一个 Codex 插件 GitHub 仓库</h1>
          <p class="lede">提交后会生成 GitHub issue。维护者审核通过后，Action 会抓取 Release 快照并更新 Marketplace。</p>

          <form class="form-grid detail-section" data-submit-form novalidate>
            <div class="field">
              <label for="repo-url">GitHub 仓库 URL <span aria-hidden="true">*</span></label>
              <input id="repo-url" name="repoUrl" type="url" inputmode="url" autocomplete="url" value="${safe(url)}" placeholder="https://github.com/owner/plugin-repo" aria-describedby="repo-help repo-error" aria-invalid="${Boolean(error)}" />
              <p id="repo-help" class="helper">需要公开仓库，并在 Release 中包含 <code>.codex-plugin/plugin.json</code>。</p>
              <p id="repo-error" class="error-text" role="alert">${safe(error)}</p>
            </div>
            <div class="field">
              <label for="submit-note">补充说明</label>
              <textarea id="submit-note" name="note" placeholder="插件用途、目标用户、需要注意的权限或安装说明">${safe(note)}</textarea>
            </div>
            <div class="form-actions">
              <button class="button" type="submit" ${state.submitLoading ? "disabled" : ""}>
                ${icon(state.submitLoading ? "loader-circle" : "send", state.submitLoading ? "正在生成 issue..." : "生成提交 issue")}
              </button>
              <a class="button secondary" href="/about" data-link>${icon("shield-check", "查看审核规则")}</a>
            </div>
          </form>

          ${
            state.submitSuccessUrl
              ? `<div class="success-box detail-section"><strong>提交链接已生成</strong><p>请在 GitHub 中确认内容并创建 issue，后续审核进度会在那里追踪。</p><a class="button secondary" href="${safe(state.submitSuccessUrl)}" target="_blank" rel="noreferrer">${icon("external-link", "打开 GitHub issue")}</a></div>`
              : ""
          }
        </section>

        <aside class="sidebar">
          <section class="panel">
            <h2>自动校验</h2>
            <div class="timeline">
              ${timelineItem("file-json", "Manifest", "检查 name、version、author、interface 字段。")}
              ${timelineItem("tag", "Release/tag", "只同步稳定 Release，不追踪默认分支 HEAD。")}
              ${timelineItem("shield-check", "安全边界", "不执行提交仓库中的插件代码。")}
            </div>
          </section>
        </aside>
      </div>
    </main>
  `;
}

function installPage() {
  return `
    ${header()}
    <main id="main" class="page">
      <section class="detail-card">
        <span class="eyebrow">${icon("download", "Install Marketplace")}</span>
        <h1>把社区 Marketplace 添加到 Codex</h1>
        <p class="lede">添加后，Codex Desktop 会从这个 GitHub 仓库读取 <code>marketplace.json</code> 和已审核插件快照。</p>

        <div class="detail-section">
          <h2>1. Codex Desktop 添加链接</h2>
          <p class="helper">在 Codex Desktop 的插件市场来源中添加这个 GitHub 仓库链接。</p>
          <div class="code-box">
            <code>${safe(MARKETPLACE_REPOSITORY_URL)}</code>
            <button class="copy-button" type="button" data-copy="${safe(MARKETPLACE_REPOSITORY_URL)}" data-copy-label="Marketplace 链接已复制" aria-label="复制 Marketplace 链接">${icon("monitor")}</button>
          </div>
        </div>

        <div class="detail-section">
          <h2>2. Codex CLI 添加命令</h2>
          <div class="code-box">
            <code>${safe(MARKETPLACE_COMMAND)}</code>
            <button class="copy-button" type="button" data-copy="${safe(MARKETPLACE_COMMAND)}" data-copy-label="CLI 命令已复制" aria-label="复制 Marketplace 命令">${icon("terminal")}</button>
          </div>
        </div>

        <div class="detail-section">
          <h2>3. 安装插件</h2>
          <p class="helper">在详情页复制具体插件安装命令，格式为：</p>
          <div class="code-box">
            <code>codex plugin add plugin-name@codex-community</code>
            <button class="copy-button" type="button" data-copy="codex plugin add plugin-name@codex-community" aria-label="复制插件安装命令示例">${icon("copy")}</button>
          </div>
        </div>

        <div class="detail-section notice-box">
          <h2>同步策略</h2>
          <p>第一版按 GitHub Releases/tags 同步。新版本通过 GitHub Action 创建 PR，审核合并后进入市场。</p>
        </div>
      </section>
    </main>
  `;
}

function aboutPage() {
  return `
    ${header()}
    <main id="main" class="page">
      <section class="detail-card">
        <span class="eyebrow">${icon("shield-check", "审核规则")}</span>
        <h1>社区收录规则</h1>
        <p class="lede">这个市场优先保证插件可安装、来源可追踪、风险可说明。增长很重要，但信任更重要。</p>

        <div class="detail-section">
          <h2>必须满足</h2>
          <ul class="detail-list">
            <li><span>公开来源</span><strong>GitHub 仓库和 Release 可访问</strong></li>
            <li><span>Codex manifest</span><strong>包含 <code>.codex-plugin/plugin.json</code></strong></li>
            <li><span>版本</span><strong>使用 SemVer，并按 Release/tag 发布</strong></li>
            <li><span>资源</span><strong>引用的图标、截图和配置文件必须存在</strong></li>
          </ul>
        </div>

        <div class="detail-section">
          <h2>不会做</h2>
          <p>审核 Action 不会执行插件代码，不会自动上架未审核提交，也不会把默认分支 HEAD 当作稳定版本。</p>
        </div>
      </section>
    </main>
  `;
}

function notFoundPage() {
  return `
    ${header()}
    <main id="main" class="page">
      ${emptyState()}
    </main>
  `;
}

function render() {
  document.documentElement.dataset.theme = currentTheme();
  const path = state.route;
  let view = perspectivePage();
  if (path.startsWith("/plugins/")) view = detailPage(decodeURIComponent(path.split("/").filter(Boolean).pop() || ""));
  if (path.startsWith("/submit")) view = submitPage();
  if (path.startsWith("/install")) view = installPage();
  if (path.startsWith("/about")) view = aboutPage();
  if (path.startsWith("/perspective")) view = perspectivePage();
  if (path.startsWith("/organic")) view = organicPage();
  app.innerHTML = view;
  attachEvents();
  renderIcons();
}

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { "stroke-width": 2 } });
  }
}

function attachEvents() {
  initShanghaiClock();

  document.querySelectorAll("[data-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");
      if (!href || href.startsWith("http")) return;
      event.preventDefault();
      navigate(href);
    });
  });

  document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
    setTheme(currentTheme() === "dark" ? "light" : "dark");
    showToast(currentTheme() === "dark" ? "已切换到暗色模式" : "已切换到浅色模式");
  });

  document.querySelector("#plugin-search")?.addEventListener("input", (event) => {
    window.clearTimeout(attachEvents.searchTimer);
    attachEvents.searchTimer = window.setTimeout(() => {
      state.query = event.target.value;
      render();
      document.querySelector("#plugin-search")?.focus();
    }, 120);
  });

  document.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      render();
    });
  });

  document.querySelector("[data-verified-toggle]")?.addEventListener("click", () => {
    state.showOnlyVerified = !state.showOnlyVerified;
    render();
  });

  document.querySelector("[data-clear-filters]")?.addEventListener("click", () => {
    state.query = "";
    state.category = "全部";
    state.showOnlyVerified = false;
    render();
  });

  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copy, button.dataset.copyLabel || "命令已复制"));
  });


  const repoInput = document.querySelector("#repo-url");
  repoInput?.addEventListener("blur", () => {
    state.submitTouched = true;
    render();
  });

  document.querySelector("[data-submit-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const repoUrl = String(form.get("repoUrl") || "").trim();
    const note = String(form.get("note") || "").trim();
    const error = validateGithubUrl(repoUrl);
    state.submitTouched = true;
    if (error) {
      render();
      document.querySelector("#repo-url")?.focus();
      return;
    }
    state.submitLoading = true;
    render();
    window.setTimeout(() => {
      const params = new URLSearchParams({
        title: `收录插件：${repoUrl}`,
        body: `### GitHub 仓库\n${repoUrl}\n\n### 补充说明\n${note || "无"}\n\n### 自动检查\n- [ ] Release/tag 可访问\n- [ ] .codex-plugin/plugin.json 存在\n- [ ] manifest 字段完整\n`,
      });
      state.submitLoading = false;
      state.submitSuccessUrl = `${ISSUE_BASE}?${params.toString()}`;
      render();
      showToast("提交链接已生成");
    }, 700);
  });
}

function initShanghaiClock() {
  window.clearInterval?.(attachEvents.shanghaiClockTimer);
  attachEvents.shanghaiClockTimer = 0;
  const clock = document.querySelector("[data-shanghai-clock]");
  if (!clock) return;

  const update = () => {
    clock.textContent = formatShanghaiDateTime(new Date());
  };

  update();
  attachEvents.shanghaiClockTimer = window.setInterval?.(update, 1000) || 0;
}
function validateGithubUrl(value) {
  if (!value.trim()) return "请输入 GitHub 仓库 URL。";
  try {
    const url = new URL(value);
    if (url.hostname !== "github.com") return "目前只接受 github.com 仓库链接。";
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return "链接需要包含 owner 和 repo。";
    return "";
  } catch {
    return "URL 格式不正确，请使用 https://github.com/owner/repo。";
  }
}

window.addEventListener("popstate", () => {
  state.route = window.location.pathname;
  render();
});

loadRegistry();
