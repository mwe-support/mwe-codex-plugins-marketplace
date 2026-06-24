const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

const MARKETPLACE_REPOSITORY_URL = "https://github.com/mwe-support/mwe-codex-plugins-marketplace";
const MARKETPLACE_COMMAND = `codex plugin marketplace add ${MARKETPLACE_REPOSITORY_URL}`;

let registry = { marketplace: {}, plugins: [], submissions: [] };
let state = {
  route: window.location.pathname,
  query: "",
  category: "全部",
  showOnlyVerified: false,
  submitTouched: false,
  submitLoading: false,
  submitError: "",
  submitSuccessUrl: "",
  submitSuccessMessage: "",
  submitIssueNumber: "",
  reviews: [],
  reviewsLoading: false,
  reviewsError: "",
  removalPluginName: "",
  removalTouched: false,
  removalLoading: false,
  removalError: "",
  removalSuccessUrl: "",
  removalSuccessMessage: "",
  removalIssueNumber: "",
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

function systemTheme() {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function themeMode() {
  const stored = localStorage.getItem("marketplace-theme-mode") || localStorage.getItem("marketplace-theme") || "system";
  return ["system", "light", "dark"].includes(stored) ? stored : "system";
}

function currentTheme() {
  const mode = themeMode();
  return mode === "system" ? systemTheme() : mode;
}

function applyTheme() {
  document.documentElement.dataset.theme = currentTheme();
  document.documentElement.dataset.themeMode = themeMode();
}

function setThemeMode(mode) {
  localStorage.setItem("marketplace-theme-mode", mode);
  localStorage.removeItem("marketplace-theme");
  applyTheme();
  syncThemeControls();
}

function syncThemeControls() {
  const mode = themeMode();
  document.querySelectorAll("[data-theme-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeMode === mode));
  });
}

async function loadRegistry() {
  try {
    const response = await fetch("/registry/plugins.json", { cache: "no-store" });
    registry = await response.json();
  } catch {
    showToast("Registry 加载失败，正在显示空状态");
    registry = { marketplace: {}, plugins: [], submissions: [] };
  }
  state.reviews = registry.submissions || [];
  render();
  loadReviewItems();
}

async function loadReviewItems() {
  state.reviewsLoading = true;
  state.reviewsError = "";
  if (state.route.startsWith("/reviews")) render();
  try {
    const response = await fetch("/api/submissions", { cache: "no-store" });
    const payload = await response.json();
    state.reviews = payload.submissions || registry.submissions || [];
    state.reviewsError = payload.warning || "";
  } catch (error) {
    state.reviews = registry.submissions || [];
    state.reviewsError = error.message || "审核进度加载失败";
  } finally {
    state.reviewsLoading = false;
    if (state.route.startsWith("/reviews")) render();
  }
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

const reviewStatusLabel = {
  reviewing: "待审核",
  approved: "已同步",
  rejected: "已拒绝",
  failed: "需处理",
  closed: "已关闭",
  removed: "已删除",
};

function reviewItems() {
  return (state.reviews.length ? state.reviews : registry.submissions || []).slice().sort((a, b) => new Date(b.updatedAt || b.submittedAt) - new Date(a.updatedAt || a.submittedAt));
}

function reviewColumnItems(statuses) {
  return reviewItems().filter((item) => statuses.includes(item.status));
}

function reviewBadge(status) {
  const iconName = status === "approved" ? "badge-check" : status === "failed" || status === "rejected" ? "triangle-alert" : "clock-3";
  return `<span class="review-status ${safe(status)}">${icon(iconName, reviewStatusLabel[status] || status)}</span>`;
}

function securityScanBadge(scan) {
  const status = scan?.status || "pending";
  const label = status === "passed" ? "安全扫描通过" : status === "warnings" ? "安全扫描提醒" : status === "blocked" ? "安全扫描阻断" : "等待安全扫描";
  const iconName = status === "passed" ? "shield-check" : status === "blocked" ? "shield-alert" : "shield-question";
  return `<span class="security-badge ${safe(status)}">${icon(iconName, label)}</span>`;
}

function statusBadge(type, value) {
  return `<span class="status ${safe(value)}">${icon(
    value === "verified" || value === "synced" ? "badge-check" : value === "failed" ? "triangle-alert" : "clock-3"
  )}${safe(statusLabel[value] || value)}</span>`;
}

function tagList(items) {
  return (items || []).map((item) => `<span class="badge">${safe(item)}</span>`).join("");
}

function pluginInstallCommand(plugin) {
  return `codex plugin add ${plugin.name}@${registry.marketplace.name || "codex-community"}`;
}

function pageShell(content, pageClass = "standard-page") {
  return `
    <div class="perspective-app">
      ${header()}
      <main id="main" class="perspective-page ${pageClass}">
        ${content}
      </main>
    </div>
  `;
}

function pluginCopyActions(plugin, variant = "card") {
  if (plugin.verifiedStatus !== "verified" || plugin.installPolicy === "REVIEW_ONLY") {
    return `<span class="install-note">通过审核后开放单独安装</span>`;
  }
  const installCommand = pluginInstallCommand(plugin);
  const buttonClass = variant === "perspective" ? "perspective-button secondary" : "button secondary";
  return `
    <button class="${buttonClass}" type="button" data-copy="${safe(plugin.repositoryUrl)}" data-copy-label="插件 GitHub 链接已复制" aria-label="复制 ${safe(plugin.displayName)} GitHub 仓库链接">${icon("github", "复制链接")}</button>
    <button class="${buttonClass}" type="button" data-copy="${safe(installCommand)}" data-copy-label="插件安装命令已复制" aria-label="复制 ${safe(plugin.displayName)} CLI 安装命令">${icon("terminal", "复制安装")}</button>
  `;
}

function header() {
  const mode = themeMode();
  const navItems = [
    ["/", "store", "市场"],
    ["/reviews", "list-checks", "进度"],
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
          <div class="theme-switch" role="group" aria-label="主题模式">
            ${[
              ["system", "monitor", "跟随系统"],
              ["light", "sun", "浅色"],
              ["dark", "moon", "深色"],
            ]
              .map(
                ([value, iconName, label]) => `
                  <button class="theme-option" type="button" data-theme-mode="${value}" aria-pressed="${mode === value}" aria-label="${label}">${icon(iconName)}</button>
                `
              )
              .join("")}
          </div>
          <a class="perspective-button secondary" href="/install" data-link>${icon("monitor", "Codex Desktop")}</a>
        </div>
      </div>
    </header>
  `;
}

function topLevelRoute() {
  if (state.route.startsWith("/plugins/") || state.route.startsWith("/perspective")) return "/";
  return ["/reviews", "/submit", "/install", "/about"].find((route) => state.route.startsWith(route)) || "/";
}

function emptyState() {
  return `
    <div class="empty-state">
      <div>
        <span class="brand-mark" style="margin:0 auto;">${icon("search-x")}</span>
        <h2>没有找到插件</h2>
        <p class="lede">试试清空筛选、切换分类，或者把你希望收录的 GitHub 仓库提交给维护者。</p>
        <div class="form-actions" style="justify-content:center;">
          <button class="perspective-button secondary" type="button" data-clear-filters>${icon("rotate-ccw", "清空筛选")}</button>
          <a class="perspective-button primary" href="/submit" data-link>${icon("plus", "提交插件")}</a>
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

function reviewCard(item) {
  const scan = item.securityScan;
  const issueLabel = item.issueUrl ? `#${item.issueUrl.split("/").pop()}` : "追踪";
  return `
    <article class="review-card glass-card">
      <div class="review-card-head">
        <div>
          <h3>${safe(item.displayName || item.repo || item.slug)}</h3>
          <p>${safe(item.owner || "community")} / ${safe(item.repo || item.slug)}</p>
        </div>
        ${reviewBadge(item.status)}
      </div>
      <a class="review-repo" href="${safe(item.repositoryUrl)}" target="_blank" rel="noreferrer">${icon("github", item.repositoryUrl || "GitHub 仓库")}</a>
      <div class="review-meta">
        <span>${icon("calendar-clock", formatShanghaiDateTime(item.updatedAt || item.submittedAt))}</span>
        ${securityScanBadge(scan)}
      </div>
      ${item.reason ? `<p class="review-reason">${safe(item.reason)}</p>` : ""}
      ${scan?.findings?.length ? `<ul class="review-findings">${scan.findings.slice(0, 3).map((finding) => `<li><strong>${safe(finding.severity)}</strong> ${safe(finding.path)} · ${safe(finding.description)}</li>`).join("")}</ul>` : ""}
      <div class="form-actions">
        ${item.issueUrl ? `<a class="perspective-button secondary" href="${safe(item.issueUrl)}" target="_blank" rel="noreferrer">${icon("external-link", issueLabel)}</a>` : ""}
        ${item.pluginName ? `<a class="perspective-button primary" href="/plugins/${safe(item.pluginName)}" data-link>${icon("arrow-right", "查看插件")}</a>` : ""}
      </div>
    </article>
  `;
}

function reviewColumn(title, statuses, iconName) {
  const items = reviewColumnItems(statuses);
  return `
    <section class="review-column">
      <div class="review-column-head">
        <span>${icon(iconName)}</span>
        <div>
          <h2>${title}</h2>
          <p>${items.length} 条记录</p>
        </div>
      </div>
      <div class="review-column-list">
        ${items.length ? items.map(reviewCard).join("") : `<div class="review-empty">暂无记录</div>`}
      </div>
    </section>
  `;
}

function reviewsPage() {
  const total = reviewItems().length;
  return `
    <div class="perspective-app">
      ${header()}
      <main id="main" class="perspective-page review-page" aria-label="提交和审核进度">
        <section class="review-hero glass-card">
          <span class="perspective-kicker">Review Board</span>
          <div>
            <h1>提交和审核进度</h1>
            <p>从网页提交、GitHub issue、自动审核、静态安全扫描到 Marketplace 同步，所有状态集中显示在这里。</p>
          </div>
          <button class="perspective-button secondary" type="button" data-refresh-reviews ${state.reviewsLoading ? "disabled" : ""}>${icon(state.reviewsLoading ? "loader-circle" : "refresh-cw", state.reviewsLoading ? "刷新中" : "刷新进度")}</button>
        </section>
        ${state.reviewsError ? `<div class="error-box review-warning" role="status">${safe(state.reviewsError)}</div>` : ""}
        <section class="review-summary" aria-label="审核概况">
          <div class="glass-card"><strong>${total}</strong><span>提交记录</span></div>
          <div class="glass-card"><strong>${reviewColumnItems(["approved"]).length}</strong><span>已同步</span></div>
          <div class="glass-card"><strong>${reviewColumnItems(["reviewing"]).length}</strong><span>审核中</span></div>
          <div class="glass-card"><strong>${reviewColumnItems(["failed", "rejected"]).length}</strong><span>需处理</span></div>
        </section>
        <section class="review-board" aria-label="审核看板">
          ${reviewColumn("待审核", ["reviewing"], "clock-3")}
          ${reviewColumn("需处理", ["failed", "rejected", "closed"], "triangle-alert")}
          ${reviewColumn("已同步", ["approved"], "badge-check")}
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
        <a class="perspective-button secondary" href="${safe(plugin.repositoryUrl)}" target="_blank" rel="noreferrer">${icon("external-link", "打开仓库")}</a>
        ${pluginCopyActions(plugin, "perspective")}
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
  const installCommand = pluginInstallCommand(plugin);
  const removalRequester = document.querySelector("#removal-requester")?.value || "";
  const removalReason = document.querySelector("#removal-reason")?.value || "";
  const removalActive = state.removalPluginName === plugin.name;
  const removalError = removalActive ? state.removalError : "";
  const removalSuccessUrl = removalActive ? state.removalSuccessUrl : "";
  return `
    <div class="perspective-app">
      ${header()}
      <main id="main" class="perspective-page plugin-detail-page">
        <div class="detail-layout">
          <article class="detail-card glass-card plugin-detail-card">
            <a class="perspective-button secondary detail-back" href="/" data-link>${icon("arrow-left", "返回插件目录")}</a>
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
            <section class="panel glass-card">
            <h2>安装入口</h2>
            <p class="helper">可以同步整个 Marketplace，也可以只复制当前插件的仓库链接或 CLI 安装命令。</p>
            <div class="code-box">
              <code>${safe(MARKETPLACE_REPOSITORY_URL)}</code>
              <button class="copy-button" type="button" data-copy="${safe(MARKETPLACE_REPOSITORY_URL)}" data-copy-label="Marketplace 链接已复制" aria-label="复制 Marketplace 链接">${icon("monitor")}</button>
            </div>
            <div class="code-box">
              <code>${safe(MARKETPLACE_COMMAND)}</code>
              <button class="copy-button" type="button" data-copy="${safe(MARKETPLACE_COMMAND)}" data-copy-label="CLI 命令已复制" aria-label="复制 Marketplace 命令">${icon("terminal")}</button>
            </div>
            <div class="install-choice">
              <span>${icon("github", "插件 GitHub")}</span>
              <div class="code-box">
                <code>${safe(plugin.repositoryUrl)}</code>
                <button class="copy-button" type="button" data-copy="${safe(plugin.repositoryUrl)}" data-copy-label="插件 GitHub 链接已复制" aria-label="复制插件 GitHub 仓库链接">${icon("copy")}</button>
              </div>
            </div>
            <div class="install-choice">
              <span>${icon("terminal", "单插件 CLI")}</span>
              <div class="code-box">
                <code>${safe(installCommand)}</code>
                <button class="copy-button" type="button" data-copy="${safe(installCommand)}" data-copy-label="插件安装命令已复制" aria-label="复制插件安装命令">${icon("copy")}</button>
              </div>
            </div>
          </section>

            <section class="panel glass-card">
              <h2>来源</h2>
            <div class="form-actions">
              <a class="perspective-button secondary" href="${safe(plugin.repositoryUrl)}" target="_blank" rel="noreferrer">${icon("github", "打开 GitHub")}</a>
              <a class="perspective-button secondary" href="/submit" data-link>${icon("git-pull-request", "贡献更新")}</a>
            </div>
          </section>

            <section class="panel glass-card removal-panel">
              <h2>删除请求</h2>
              <p class="helper">仅插件 GitHub 仓库的 owner 或 maintainer 可以删除收录记录。网页会创建追踪请求，owner 需要在 GitHub issue 中确认。</p>
              <form class="removal-form" data-removal-form novalidate>
                <input type="hidden" name="pluginName" value="${safe(plugin.name)}" />
                <input type="hidden" name="repositoryUrl" value="${safe(plugin.repositoryUrl)}" />
                <div class="field">
                  <label for="removal-requester">GitHub 用户名</label>
                  <input id="removal-requester" name="requester" value="${safe(removalRequester)}" placeholder="owner-login" autocomplete="username" aria-describedby="removal-help removal-error" />
                  <p id="removal-help" class="helper">填写仓库 owner 或 maintainer 的 GitHub 登录名，用于维护者识别。</p>
                  <p id="removal-error" class="error-text" role="alert">${safe(removalError)}</p>
                </div>
                <div class="field">
                  <label for="removal-reason">删除原因</label>
                  <textarea id="removal-reason" name="reason" placeholder="例如：仓库已停止维护，希望从 Marketplace 下架。">${safe(removalReason)}</textarea>
                </div>
                <button class="perspective-button secondary" type="submit" ${state.removalLoading && removalActive ? "disabled" : ""}>${icon(state.removalLoading && removalActive ? "loader-circle" : "trash-2", state.removalLoading && removalActive ? "正在提交..." : "申请删除")}</button>
              </form>
              ${removalSuccessUrl ? `<div class="success-box detail-section"><strong>${safe(state.removalSuccessMessage || "已提交删除请求")}</strong><p>仓库 owner/maintainer 需要在 GitHub issue 中确认后才会自动删除。</p><a class="perspective-button secondary" href="${safe(removalSuccessUrl)}" target="_blank" rel="noreferrer">${icon("external-link", state.removalIssueNumber ? `查看 #${safe(state.removalIssueNumber)}` : "查看删除进度")}</a></div>` : ""}
            </section>
          </aside>
        </div>
      </main>
    </div>
  `;
}

function submitPage() {
  const url = document.querySelector("#repo-url")?.value || "";
  const note = document.querySelector("#submit-note")?.value || "";
  const error = state.submitTouched ? validateGithubUrl(url) : "";
  return pageShell(`
      <div class="detail-layout standard-layout">
        <section class="detail-card glass-card standard-card">
          <span class="perspective-kicker">${icon("git-pull-request", "提交插件")}</span>
          <h1>分享一个 Codex 插件 GitHub 仓库</h1>
          <p class="lede">在这里提交仓库链接即可进入自动审核队列。系统会代你创建追踪 issue，不需要跳转到 GitHub 再手动确认。</p>

          <form class="form-grid detail-section" data-submit-form novalidate>
            <div class="field">
              <label for="repo-url">GitHub 仓库 URL <span aria-hidden="true">*</span></label>
              <input id="repo-url" name="repoUrl" type="url" inputmode="url" autocomplete="url" value="${safe(url)}" placeholder="https://github.com/owner/plugin-repo" aria-describedby="repo-help repo-error" aria-invalid="${Boolean(error)}" />
              <p id="repo-help" class="helper">需要公开仓库，并在根目录或 <code>plugins/*</code> 子目录包含 <code>.codex-plugin/plugin.json</code>。</p>
              <p id="repo-error" class="error-text" role="alert">${safe(error)}</p>
            </div>
            <div class="field">
              <label for="submit-note">补充说明</label>
              <textarea id="submit-note" name="note" placeholder="插件用途、目标用户、需要注意的权限或安装说明">${safe(note)}</textarea>
            </div>
            <div class="form-actions">
              <button class="perspective-button primary" type="submit" ${state.submitLoading ? "disabled" : ""}>
                ${icon(state.submitLoading ? "loader-circle" : "send", state.submitLoading ? "正在提交审核..." : "提交审核")}
              </button>
              <a class="perspective-button secondary" href="/about" data-link>${icon("shield-check", "查看审核规则")}</a>
            </div>
          </form>

          ${
            state.submitError
              ? `<div class="error-box detail-section" role="alert"><strong>提交失败</strong><p>${safe(state.submitError)}</p></div>`
              : ""
          }
          ${
            state.submitSuccessMessage
              ? `<div class="success-box detail-section"><strong>${safe(state.submitSuccessMessage || "已提交审核")}</strong><p>${state.submitSuccessUrl ? "自动审核会在后台运行；下面的链接仅用于追踪进度，不需要再手动创建 issue。" : "系统没有创建新的审核 issue，你可以继续浏览或提交其他插件。"}</p>${state.submitSuccessUrl ? `<a class="perspective-button secondary" href="${safe(state.submitSuccessUrl)}" target="_blank" rel="noreferrer">${icon("external-link", state.submitIssueNumber ? `查看 #${safe(state.submitIssueNumber)}` : "查看审核进度")}</a>` : ""}</div>`
              : ""
          }
        </section>

        <aside class="sidebar">
          <section class="panel glass-card standard-card">
            <h2>自动校验</h2>
            <div class="timeline">
              ${timelineItem("file-json", "Manifest", "检查 name、version、author、interface、capabilities 字段。")}
              ${timelineItem("tag", "Release/tag", "优先使用指定 ref；没有 Release 时可同步默认分支快照。")}
              ${timelineItem("shield-check", "安全扫描", "静态检查高危命令、安装钩子和密钥外传风险。")}
              ${timelineItem("shield", "执行边界", "审核不会执行提交仓库中的插件代码。")}
            </div>
          </section>
        </aside>
      </div>
  `, "standard-page submit-page");
}

function installPage() {
  return pageShell(`
      <section class="detail-card glass-card standard-card standard-single">
        <span class="perspective-kicker">${icon("download", "Install Marketplace")}</span>
        <h1>把社区 Marketplace 添加到 Codex</h1>
        <p class="lede">添加后，Codex Desktop 会从这个 GitHub 仓库读取 <code>marketplace.json</code> 和已审核插件快照。</p>

        <div class="detail-section">
          <h2>1. 同步整个 Marketplace</h2>
          <p class="helper">在 Codex Desktop 的插件市场来源中添加这个 GitHub 仓库链接。添加后，已验证插件会随中央仓库同步显示。</p>
          <div class="code-box">
            <code>${safe(MARKETPLACE_REPOSITORY_URL)}</code>
            <button class="copy-button" type="button" data-copy="${safe(MARKETPLACE_REPOSITORY_URL)}" data-copy-label="Marketplace 链接已复制" aria-label="复制 Marketplace 链接">${icon("monitor")}</button>
          </div>
        </div>

        <div class="detail-section">
          <h2>2. Codex CLI 添加 Marketplace</h2>
          <div class="code-box">
            <code>${safe(MARKETPLACE_COMMAND)}</code>
            <button class="copy-button" type="button" data-copy="${safe(MARKETPLACE_COMMAND)}" data-copy-label="CLI 命令已复制" aria-label="复制 Marketplace 命令">${icon("terminal")}</button>
          </div>
        </div>

        <div class="detail-section">
          <h2>3. 单独安装已验证插件</h2>
          <p class="helper">每个已验证插件卡片和详情页都会提供两个复制按钮：插件 GitHub 仓库链接，以及从已配置 Marketplace 安装该插件的 CLI 命令。</p>
          <div class="code-box">
            <code>codex plugin add plugin-name@codex-community</code>
            <button class="copy-button" type="button" data-copy="codex plugin add plugin-name@codex-community" aria-label="复制插件安装命令示例">${icon("copy")}</button>
          </div>
        </div>

        <div class="detail-section notice-box">
          <h2>同步策略</h2>
          <p>中央仓库用于批量发现和同步插件；单插件 CLI 命令用于精确安装某个已验证插件。自动审核规则通过后，Action 会更新 registry 和 marketplace 快照，网页与 Codex marketplace 都会同步出现该插件。</p>
        </div>
      </section>
  `, "standard-page install-page");
}

function aboutPage() {
  return pageShell(`
      <section class="detail-card glass-card standard-card standard-single">
        <span class="perspective-kicker">${icon("shield-check", "审核规则")}</span>
        <h1>社区收录规则</h1>
        <p class="lede">这个市场优先保证插件可安装、来源可追踪、风险可说明。增长很重要，但信任更重要。</p>

        <div class="detail-section">
          <h2>必须满足</h2>
          <ul class="detail-list">
            <li><span>公开来源</span><strong>GitHub 仓库和 Release 可访问</strong></li>
            <li><span>Codex manifest</span><strong>根目录或 <code>plugins/*</code> 子目录包含 <code>.codex-plugin/plugin.json</code></strong></li>
            <li><span>版本</span><strong>manifest 使用 SemVer；Release/tag 推荐，默认分支可作为预览 ref</strong></li>
            <li><span>资源</span><strong>引用的图标、截图和配置文件必须存在</strong></li>
          </ul>
        </div>

        <div class="detail-section">
          <h2>不会做</h2>
          <p>审核 Action 不会执行插件代码；只做 manifest、README、skills/mcp 路径校验，并增加静态安全扫描。明显危险的远程脚本执行、根目录删除、磁盘擦除等规则会阻断自动同步，可疑安装钩子会进入看板提醒。</p>
        </div>
      </section>
  `, "standard-page about-page");
}

function notFoundPage() {
  return pageShell(`
      <section class="glass-card standard-card standard-single perspective-empty">
        ${emptyState()}
      </section>
  `, "standard-page not-found-page");
}
function render() {
  document.documentElement.dataset.theme = currentTheme();
  document.documentElement.dataset.themeMode = themeMode();
  const path = state.route;
  let view = perspectivePage();
  if (path.startsWith("/plugins/")) view = detailPage(decodeURIComponent(path.split("/").filter(Boolean).pop() || ""));
  if (path.startsWith("/reviews")) view = reviewsPage();
  if (path.startsWith("/submit")) view = submitPage();
  if (path.startsWith("/install")) view = installPage();
  if (path.startsWith("/about")) view = aboutPage();
  if (path.startsWith("/perspective")) view = perspectivePage();
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

  document.querySelectorAll("[data-theme-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setThemeMode(button.dataset.themeMode);
      const label = button.dataset.themeMode === "system" ? "跟随系统" : button.dataset.themeMode === "light" ? "浅色模式" : "深色模式";
      showToast(`主题已切换为${label}`);
    });
  });

  document.querySelector("[data-refresh-reviews]")?.addEventListener("click", () => {
    loadReviewItems();
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
  });

  attachRemovalForm();

  document.querySelector("[data-submit-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const repoUrl = String(form.get("repoUrl") || "").trim();
    const note = String(form.get("note") || "").trim();
    const error = validateGithubUrl(repoUrl);
    state.submitTouched = true;
    state.submitError = "";
    state.submitSuccessUrl = "";
    state.submitSuccessMessage = "";
    state.submitIssueNumber = "";
    if (error) {
      render();
      document.querySelector("#repo-url")?.focus();
      return;
    }

    state.submitLoading = true;
    render();
    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, note }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "提交失败，请稍后重试。");

      state.submitSuccessUrl = result.issueUrl || "";
      state.submitSuccessMessage = result.message || "已提交，自动审核已进入队列。";
      state.submitIssueNumber = result.issueNumber ? String(result.issueNumber) : "";
      loadReviewItems();
      showToast(result.duplicate ? result.duplicateType === "listed" ? "插件已收录" : "已有审核任务" : "已提交审核");
    } catch (error) {
      state.submitError = error.message || "提交失败，请稍后重试。";
      showToast("提交失败");
    } finally {
      state.submitLoading = false;
      render();
    }
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
function attachRemovalForm() {
  document.querySelector("[data-removal-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pluginName = String(form.get("pluginName") || "").trim();
    const repositoryUrl = String(form.get("repositoryUrl") || "").trim();
    const requester = String(form.get("requester") || "").trim().replace(/^@/, "");
    const reason = String(form.get("reason") || "").trim();
    state.removalPluginName = pluginName;
    state.removalTouched = true;
    state.removalError = "";
    state.removalSuccessUrl = "";
    state.removalSuccessMessage = "";
    state.removalIssueNumber = "";
    if (!/^[A-Za-z0-9-]{1,39}$/.test(requester)) {
      state.removalError = "请输入有效的 GitHub 用户名。";
      render();
      document.querySelector("#removal-requester")?.focus();
      return;
    }

    state.removalLoading = true;
    render();
    try {
      const response = await fetch("/api/removals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pluginName, repositoryUrl, requester, reason }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "删除请求提交失败，请稍后重试。");
      state.removalSuccessUrl = result.issueUrl || "";
      state.removalSuccessMessage = result.message || "已提交删除请求。";
      state.removalIssueNumber = result.issueNumber ? String(result.issueNumber) : "";
      loadReviewItems();
      showToast(result.duplicate ? "已有删除请求" : "已提交删除请求");
    } catch (error) {
      state.removalError = error.message || "删除请求提交失败，请稍后重试。";
      showToast("删除请求失败");
    } finally {
      state.removalLoading = false;
      render();
    }
  });
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

window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", () => {
  if (themeMode() === "system") {
    applyTheme();
    syncThemeControls();
  }
});

applyTheme();
loadRegistry();
