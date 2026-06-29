const appRoot = document.querySelector("#app");
const toastRoot = document.querySelector("#toast");
if (!appRoot || !toastRoot) {
    throw new Error("App root is missing");
}
const app = appRoot;
const toast = toastRoot;
const productName = "MWE Codex插件共享市场";
const commonCategories = ["全部", "Coding", "Developer Tools", "Productivity", "Design", "Data", "MCP", "Codex Skill"];
const state = {
    route: window.location.pathname,
    query: "",
    category: "全部",
    onlyWarnings: false,
    filterOpen: false,
    marketPage: 1,
    submitUrl: "",
    submitTouched: false,
    submitLoading: false,
    submitError: "",
    submitMessage: "",
    submitStage: "idle",
    submitStatus: "idle",
    submitPulse: "a",
    deletePassword: "",
    deleteReason: "",
    deleteLoading: false,
    deleteError: "",
    deleteMessage: "",
    liveStatus: "loading",
    liveError: "",
    lastSyncAt: "",
    logs: [],
    market: { plugins: [], checks: [] },
};
let syncTimer = 0;
let clockTimer = 0;
let renderQueued = false;
let marketSignature = "";
let searchRenderTimer = 0;
let logId = 0;
let submitStageTimer = 0;
let submitProgressTimers = [];
let submitRunId = 0;
let suppressSubmitBlur = false;
let toastTimer = 0;
let skipNextFocusValueRestore = false;
let recentPaginationPointer = 0;
let recentFilterPointer = 0;
const safe = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const icon = (name, label = "") => `<i data-lucide="${name}" class="icon" aria-hidden="true"></i>${label ? `<span>${label}</span>` : ""}`;
function addLog(type, message, status = "info") {
    const entry = { id: ++logId, at: new Date().toISOString(), type, status, message: message.slice(0, 300) };
    state.logs = [entry, ...state.logs].slice(0, 50);
    void fetch("/api/client-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: entry.type, status: entry.status, message: entry.message }),
    }).catch(() => undefined);
}
function themeMode() {
    const stored = localStorage.getItem("marketplace-theme-mode") || "dark";
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
}
function systemTheme() {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function applyTheme() {
    const mode = themeMode();
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.theme = mode === "system" ? systemTheme() : mode;
}
function syncThemeButtons() {
    const mode = themeMode();
    document.querySelectorAll("[data-theme-mode]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.themeMode === mode));
    });
}
function scheduleRender() {
    if (renderQueued)
        return;
    renderQueued = true;
    requestAnimationFrame(() => {
        renderQueued = false;
        render();
    });
}
function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
function setThemeMode(mode) {
    localStorage.setItem("marketplace-theme-mode", mode);
    applyTheme();
    syncThemeButtons();
    addLog("theme", `主题切换为 ${mode === "system" ? "跟随系统" : mode === "light" ? "浅色" : "深色"}`, "success");
}
function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
        toast.hidden = true;
    }, 3200);
}
async function copyText(value, label) {
    if (!value)
        return;
    try {
        let copied = false;
        if (navigator.clipboard?.writeText && window.isSecureContext) {
            await Promise.race([
                navigator.clipboard.writeText(value),
                new Promise((_, reject) => window.setTimeout(() => reject(new Error("clipboard timeout")), 800)),
            ]);
            copied = true;
        }
        if (!copied) {
            const textarea = document.createElement("textarea");
            textarea.value = value;
            textarea.setAttribute("readonly", "");
            textarea.style.position = "fixed";
            textarea.style.left = "-9999px";
            textarea.style.top = "0";
            document.body.appendChild(textarea);
            textarea.select();
            copied = document.execCommand("copy");
            textarea.remove();
        }
        if (!copied)
            throw new Error("copy failed");
        showToast(label);
        addLog("copy", label, "success");
    }
    catch {
        showToast("复制失败，请手动选择文本");
        addLog("copy", "复制失败，请手动选择文本", "error");
    }
}
function normalizeRepositoryUrl(value) {
    return value.trim().replace(/\.git$/, "");
}
function defaultBranch(plugin) {
    return plugin.defaultBranch || plugin.releaseTag || "HEAD";
}
function encodeBranchPath(branch) {
    return branch.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}
function repositorySourceUrl(plugin) {
    return normalizeRepositoryUrl(plugin.repositoryUrl);
}
function repositoryTreeUrl(plugin) {
    const root = normalizeRepositoryUrl(plugin.repositoryUrl);
    const branch = defaultBranch(plugin);
    if (!branch || branch === "HEAD")
        return root;
    return plugin.repositoryTreeUrl || `${root}/tree/${encodeBranchPath(branch)}`;
}
function shellArg(value) {
    if (/^[A-Za-z0-9_./:@-]+$/.test(value))
        return value;
    return `'${value.replace(/'/g, `'\''`)}'`;
}
function cliCommand(plugin) {
    const branch = defaultBranch(plugin);
    const root = normalizeRepositoryUrl(plugin.repositoryUrl);
    return branch && branch !== "HEAD" ? `codex plugin marketplace add ${shellArg(root)} --ref ${shellArg(branch)}` : `codex plugin marketplace add ${shellArg(root)}`;
}
function pluginChips(plugin) {
    const branch = defaultBranch(plugin);
    const labels = [...(plugin.capabilities || plugin.tags || []).slice(0, 3)];
    if (branch && branch !== "HEAD")
        labels.push(`默认分支 ${branch}`);
    return labels.map((item) => `<span class="chip">${safe(item)}</span>`).join("");
}
function formatTime(value, withSeconds = false) {
    if (!value)
        return "刚刚";
    return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: withSeconds ? "2-digit" : undefined,
        hour12: false,
    }).format(new Date(value));
}
function beijingTime() {
    return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).format(new Date());
}
function updateClock() {
    document.querySelectorAll("[data-beijing-time]").forEach((node) => {
        node.textContent = beijingTime();
    });
}
function startClock() {
    window.clearInterval(clockTimer);
    updateClock();
    clockTimer = window.setInterval(updateClock, 1000);
}
function validateGithubUrl(value) {
    if (!value.trim())
        return "请输入 GitHub 仓库链接。";
    try {
        const url = new URL(value.trim());
        if (url.protocol !== "https:" || url.hostname !== "github.com") {
            return "目前只支持 https://github.com/owner/repo。";
        }
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length < 2)
            return "链接需要包含 owner 和 repo。";
        return "";
    }
    catch {
        return "URL 格式不正确，请粘贴完整 GitHub 仓库链接。";
    }
}
function categories() {
    const dynamic = new Set(state.market.plugins.map((plugin) => plugin.category).filter(Boolean));
    const merged = [...commonCategories, ...dynamic];
    return [...new Set(merged)].filter((category) => category === "全部" || dynamic.has(category) || ["Coding", "Developer Tools"].includes(category));
}
function filteredPlugins() {
    const query = state.query.trim().toLowerCase();
    return state.market.plugins.filter((plugin) => {
        const haystack = [
            plugin.name,
            plugin.displayName,
            plugin.description,
            plugin.author,
            plugin.category,
            plugin.repositoryUrl,
            plugin.repositoryTreeUrl || "",
            plugin.defaultBranch || plugin.releaseTag || "",
            ...(plugin.tags || []),
            ...(plugin.capabilities || []),
        ]
            .join(" ")
            .toLowerCase();
        const matchesQuery = !query || haystack.includes(query);
        const matchesCategory = state.category === "全部" || plugin.category === state.category;
        const matchesWarnings = !state.onlyWarnings || plugin.securityScan?.status === "warnings";
        return matchesQuery && matchesCategory && matchesWarnings;
    });
}
const marketPageSize = 9;
function activeFilterCount() {
    return (state.query.trim() ? 1 : 0) + (state.category !== "全部" ? 1 : 0) + (state.onlyWarnings ? 1 : 0);
}
function maxMarketPage(total) {
    return Math.max(1, Math.ceil(total / marketPageSize));
}
function clampMarketPage(total = filteredPlugins().length) {
    state.marketPage = Math.min(Math.max(1, state.marketPage), maxMarketPage(total));
}
function resetMarketPage() {
    state.marketPage = 1;
}
function changeMarketPage(action) {
    const maxPage = maxMarketPage(filteredPlugins().length);
    const nextPage = action === "page-prev" ? Math.max(1, state.marketPage - 1) : Math.min(maxPage, state.marketPage + 1);
    if (nextPage === state.marketPage)
        return false;
    state.marketPage = nextPage;
    addLog("filter", `切换到插件第 ${state.marketPage} 页`, "info");
    scheduleRender();
    return true;
}
function toggleFilterPanel() {
    state.filterOpen = !state.filterOpen;
    addLog("filter", state.filterOpen ? "展开过滤条件" : "收起过滤条件", "info");
    scheduleRender();
}
function toggleWarningFilter() {
    state.onlyWarnings = !state.onlyWarnings;
    resetMarketPage();
    addLog("filter", state.onlyWarnings ? "仅查看需复核插件" : "显示全部插件", "success");
    scheduleRender();
}
function resetFilters() {
    state.query = "";
    state.category = "全部";
    state.onlyWarnings = false;
    resetMarketPage();
    addLog("filter", "过滤条件已重置", "success");
    scheduleRender();
}
async function loadMarket({ silent = false } = {}) {
    if (!silent)
        state.liveStatus = "loading";
    try {
        const response = await fetch("/api/market", { cache: "no-store" });
        const payload = (await response.json());
        if (!response.ok)
            throw new Error("市场状态加载失败");
        const nextMarket = {
            plugins: payload.plugins || [],
            checks: payload.checks || [],
            generatedAt: payload.generatedAt,
            source: payload.source,
            serviceStatus: payload.serviceStatus,
        };
        const nextSignature = JSON.stringify({ plugins: nextMarket.plugins, checks: nextMarket.checks, status: "live" });
        const changed = nextSignature !== marketSignature || state.liveStatus !== "live" || Boolean(state.liveError);
        state.market = nextMarket;
        clampMarketPage();
        marketSignature = nextSignature;
        state.liveStatus = payload.serviceStatus || "live";
        state.liveError = "";
        state.lastSyncAt = new Date().toISOString();
        if (silent)
            return;
        if (!changed)
            return;
        addLog("api", "市场数据已同步", "success");
    }
    catch (error) {
        state.liveStatus = "stale";
        state.liveError = error instanceof Error ? error.message : "实时状态暂时不可用";
        addLog("api", state.liveError, "error");
    }
    scheduleRender();
}
const detectionStages = ["received", "cloning", "validating", "extracting", "completed"];
const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
const submitStageMinimumMs = 1600;
const submitReceivedMinimumMs = 900;
function setSubmitStage(stage, status = "checking") {
    const stageChanged = stage !== state.submitStage;
    state.submitStage = stage;
    state.submitStatus = status;
    if (stageChanged && status === "checking" && stage !== "idle" && stage !== "received") {
        state.submitPulse = state.submitPulse === "a" ? "b" : "a";
    }
    syncSubmitUi();
}
function stageAdvanceDelay(stage) {
    return stage === "received" ? submitReceivedMinimumMs : submitStageMinimumMs;
}
async function animateSubmitTo(stage, status) {
    clearSubmitProgressTimers();
    const currentIndex = Math.max(0, detectionStages.indexOf(state.submitStage));
    const finalIndex = Math.max(currentIndex, detectionStages.indexOf(stage));
    for (let index = currentIndex + 1; index <= finalIndex; index += 1) {
        const nextStage = detectionStages[index];
        setSubmitStage(nextStage, "checking");
        await wait(stageAdvanceDelay(nextStage));
    }
    setSubmitStage(stage, status);
}
async function playSubmitPrelude(runId, targetStage = "extracting") {
    clearSubmitProgressTimers();
    setSubmitStage("received");
    await wait(stageAdvanceDelay("received"));
    const targetIndex = detectionStages.indexOf(targetStage);
    for (let index = 1; index <= targetIndex; index += 1) {
        if (runId !== submitRunId || state.submitStatus !== "checking")
            return;
        const nextStage = detectionStages[index];
        setSubmitStage(nextStage, "checking");
        await wait(stageAdvanceDelay(nextStage));
    }
}
function clearSubmitProgressTimers() {
    window.clearInterval(submitStageTimer);
    submitProgressTimers.forEach((timer) => window.clearTimeout(timer));
    submitProgressTimers = [];
}
async function submitRepository() {
    if (state.submitLoading)
        return;
    const runId = ++submitRunId;
    const repoUrl = state.submitUrl.trim();
    const validationError = validateGithubUrl(repoUrl);
    state.submitTouched = true;
    state.submitError = "";
    state.submitMessage = "";
    if (validationError) {
        state.submitError = validationError;
        setSubmitStage("received", "failed");
        syncSubmitError(validationError);
        addLog("submit", validationError, "warning");
        return;
    }
    state.submitLoading = true;
    syncSubmitButton();
    const progressPrelude = playSubmitPrelude(runId);
    addLog("submit", `开始检测 ${normalizeRepositoryUrl(repoUrl)}`, "info");
    try {
        const response = await fetch("/api/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ repositoryUrl: repoUrl }),
        });
        const payload = await response.json();
        if (runId !== submitRunId)
            return;
        if (!response.ok)
            throw new Error(payload.error || "检测失败，请稍后重试。");
        await progressPrelude;
        if (runId !== submitRunId)
            return;
        await animateSubmitTo(payload.stage || "completed", "approved");
        if (runId !== submitRunId)
            return;
        state.submitMessage = payload.message || "检测通过，插件已加入市场。";
        skipNextFocusValueRestore = true;
        state.submitUrl = "";
        state.submitError = "";
        state.submitTouched = false;
        await loadMarket({ silent: true });
        if (runId !== submitRunId)
            return;
        showToast("检测完成，市场已更新");
        addLog("submit", state.submitMessage, "success");
    }
    catch (error) {
        if (runId !== submitRunId)
            return;
        state.submitError = error instanceof Error ? error.message : "检测失败，请稍后重试。";
        syncSubmitError(state.submitError);
        await animateSubmitTo("validating", "failed");
        if (runId !== submitRunId)
            return;
        await loadMarket({ silent: true });
        if (runId !== submitRunId)
            return;
        syncSubmitError(state.submitError);
        showToast("检测未通过");
        addLog("submit", state.submitError, "error");
    }
    finally {
        if (runId === submitRunId) {
            clearSubmitProgressTimers();
            state.submitLoading = false;
            syncSubmitButton();
            scheduleRender();
        }
    }
}
async function deletePlugin(pluginName) {
    if (state.deleteLoading)
        return;
    const password = state.deletePassword.trim();
    if (!password) {
        state.deleteError = "请输入管理员密码。";
        addLog("admin", "删除操作缺少管理员密码", "warning");
        scheduleRender();
        return;
    }
    state.deleteLoading = true;
    state.deleteError = "";
    state.deleteMessage = "";
    addLog("admin", `请求删除插件 ${pluginName}`, "info");
    scheduleRender();
    try {
        const response = await fetch(`/api/plugins/${encodeURIComponent(pluginName)}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adminPassword: password, reason: state.deleteReason }),
        });
        const payload = await response.json();
        if (!response.ok)
            throw new Error(payload.error || "删除失败，请稍后重试。");
        state.deletePassword = "";
        state.deleteReason = "";
        state.deleteMessage = payload.message || "插件已从市场删除。";
        await loadMarket({ silent: true });
        showToast("插件已删除");
        addLog("admin", state.deleteMessage, "success");
        window.history.pushState({}, "", "/");
        state.route = "/";
    }
    catch (error) {
        state.deleteError = error instanceof Error ? error.message : "删除失败，请稍后重试。";
        showToast("删除失败");
        addLog("admin", state.deleteError, "error");
    }
    finally {
        state.deleteLoading = false;
        scheduleRender();
    }
}
function header() {
    const mode = themeMode();
    const navItems = [
        ["/", "store", "市场"],
        ["/install", "book-open", "如何使用"],
        ["/about", "shield-check", "检测规范"],
    ];
    const themeOptions = [
        ["light", "sun", "浅色"],
        ["system", "monitor", "跟随系统"],
        ["dark", "moon", "深色"],
    ];
    const liveText = state.liveStatus === "live" ? "正常运行" : state.liveStatus === "loading" ? "同步中" : "离线";
    return `
    <header class="topbar">
      <a class="brand" href="/" data-link aria-label="返回首页">
        <span class="brand-mark"><img src="/assets/mwe-logo.png" alt="" width="88" height="36" /></span>
        <span>${productName}</span>
      </a>
      <nav class="nav" aria-label="主要视图">
        ${navItems
        .map(([href, iconName, label]) => {
        const current = href === "/" ? state.route === "/" || state.route === "/share" : state.route.startsWith(href);
        return `<a href="${href}" data-link class="nav-link" aria-current="${current ? "page" : "false"}">${icon(iconName, label)}</a>`;
    })
        .join("")}
      </nav>
      <div class="top-actions">
        <span class="live-pill ${safe(state.liveStatus)}" title="${safe(state.liveError || "网页实时状态")}">
          <span class="status-dot"></span><span>服务状态：</span><strong>${safe(liveText)}</strong>
        </span>
        <span class="time-pill">${icon("clock")}<span data-beijing-time>${safe(beijingTime())}</span></span>
        <div class="theme-switch" role="group" aria-label="主题">
          ${themeOptions
        .map(([value, iconName, label]) => `<button class="theme-option" data-action="theme" data-theme-mode="${value}" aria-label="${label}" aria-pressed="${mode === value}" type="button">${icon(iconName)}</button>`)
        .join("")}
        </div>
      </div>
    </header>
  `;
}
function stepState(stage, status) {
    const order = ["received", "cloning", "validating", "extracting", "completed"];
    const current = state.submitStage === "idle" ? -1 : order.indexOf(state.submitStage);
    const target = order.indexOf(stage);
    if (status === "failed" && target === Math.max(current, 0))
        return "failed";
    if (status === "approved" && target === order.length - 1)
        return state.market.checks[0]?.securityScan?.status === "warnings" ? "warning" : "passed";
    if (target < current || (status === "approved" && target <= current))
        return "passed";
    if (target === current)
        return "active";
    return "pending";
}
function progressPercent() {
    if (state.submitStage === "idle")
        return 0;
    const index = Math.max(0, detectionStages.indexOf(state.submitStage));
    return Math.round((index / (detectionStages.length - 1)) * 100);
}
function progressPulseStart() {
    const progress = progressPercent();
    if (progress <= 0)
        return 0;
    return Math.max(0, progress - 25);
}
function progressPulseSize() {
    const progress = progressPercent();
    return progress <= 0 ? 0 : 25;
}
function stepNodeContent(index, status) {
    if (status === "passed" || status === "warning")
        return icon("check");
    if (status === "failed")
        return icon("x");
    return String(index + 1);
}
function syncSubmitError(message = state.submitError) {
    const errorNode = document.querySelector("#repo-error");
    if (errorNode)
        errorNode.textContent = message;
    const input = document.querySelector("#repo-url");
    if (input)
        input.setAttribute("aria-invalid", String(Boolean(message)));
}
function progressSteps() {
    return [
        ["received", "接收链接", "验证链接格式"],
        ["cloning", "拉取仓库", "读取仓库内容"],
        ["validating", "检测规范", "验证插件规范"],
        ["extracting", "提取信息", "生成插件信息"],
        ["completed", "完成", "加入市场展示"],
    ];
}
function syncProgressDom() {
    const rail = document.querySelector(".progress-rail");
    if (!rail)
        return;
    rail.style.setProperty("--progress", `${progressPercent()}%`);
    rail.style.setProperty("--pulse-start", `${progressPulseStart()}%`);
    rail.style.setProperty("--pulse-size", `${progressPulseSize()}%`);
    rail.dataset.stage = state.submitStage;
    rail.dataset.status = state.submitStatus;
    rail.dataset.pulse = state.submitPulse;
    progressSteps().forEach(([stage], index) => {
        const step = rail.querySelector(`[data-step="${stage}"]`);
        if (!step)
            return;
        const status = stepState(stage, state.submitStatus);
        step.className = `progress-step ${status}`;
        const node = step.querySelector(".step-node");
        if (node)
            node.innerHTML = stepNodeContent(index, status);
    });
    window.lucide?.createIcons({ attrs: { "stroke-width": 2 } });
}
function syncSubmitButton() {
    const button = document.querySelector('[data-action="submit-check"]');
    if (!button)
        return;
    button.disabled = state.submitLoading;
    button.innerHTML = icon(state.submitLoading ? "loader-circle" : "sparkles", state.submitLoading ? "检测中" : "开始检测");
    window.lucide?.createIcons({ attrs: { "stroke-width": 2 } });
}
function syncSubmitUi() {
    syncProgressDom();
    syncSubmitButton();
}
function progressRail() {
    return `
    <div class="progress-rail" aria-label="检测进度" style="--progress: ${progressPercent()}%; --pulse-start: ${progressPulseStart()}%; --pulse-size: ${progressPulseSize()}%" data-stage="${safe(state.submitStage)}" data-status="${safe(state.submitStatus)}" data-pulse="${safe(state.submitPulse)}">
      <span class="progress-track" aria-hidden="true"><span class="progress-fill"></span><span class="progress-light"></span></span>
      ${progressSteps()
        .map(([stage, title, detail], index) => {
        const status = stepState(stage, state.submitStatus);
        return `
            <div class="progress-step ${status}" data-step="${safe(stage)}">
              <span class="step-node">${stepNodeContent(index, status)}</span>
              <strong>${safe(title)}</strong>
              <p>${safe(detail)}</p>
            </div>
          `;
    })
        .join("")}
    </div>
  `;
}
function submitPanel() {
    const error = state.submitTouched ? state.submitError || validateGithubUrl(state.submitUrl) : state.submitError;
    return `
    <section class="submit-panel glass-panel" aria-labelledby="submit-title">
      <div class="orb orb-a"></div>
      <div class="orb orb-b"></div>
      <div class="panel-head">
        <span class="small-label">${icon("git-pull-request")} 提交插件</span>
        <h1 id="submit-title">提交插件仓库，自动检测并加入市场</h1>
        <p>粘贴 GitHub 仓库链接，系统将立即检测是否为有效的 Codex 插件。</p>
      </div>
      <form class="share-form" data-share-form novalidate>
        <label for="repo-url">GitHub 仓库链接 <span aria-hidden="true">*</span></label>
        <div class="url-field">
          ${icon("git-branch")}
          <input id="repo-url" name="repositoryUrl" type="url" autocomplete="url" placeholder="https://github.com/owner/repository" value="${safe(state.submitUrl)}" aria-invalid="${Boolean(error)}" aria-describedby="repo-help repo-error" />
        </div>
        <p id="repo-help" class="helper">请粘贴公开的代码仓库链接，系统将自动分析插件规范与清单文件。</p>
        <p id="repo-error" class="error-text" role="alert">${safe(error)}</p>
        <div class="form-actions">
          <button class="primary-button" data-action="submit-check" type="submit" ${state.submitLoading ? "disabled" : ""}>${icon(state.submitLoading ? "loader-circle" : "sparkles", state.submitLoading ? "检测中" : "开始检测")}</button>
          <button class="secondary-button" data-action="clear-submit" type="button">${icon("trash-2", "清空")}</button>
        </div>
      </form>
      ${state.submitMessage ? `<div class="success-box">${icon("badge-check")}<span>${safe(state.submitMessage)}</span></div>` : ""}
      ${progressRail()}
    </section>
  `;
}
function statusBadge(plugin) {
    const scan = plugin.securityScan?.status || "pending";
    const label = scan === "warnings" ? "有提示" : scan === "blocked" ? "需复核" : scan === "passed" ? "已通过" : "待检测";
    const iconName = scan === "warnings" ? "shield-alert" : scan === "blocked" ? "shield-x" : "badge-check";
    return `<span class="status-badge ${safe(scan)}">${icon(iconName, label)}</span>`;
}
function pluginRow(plugin) {
    return `
    <article class="plugin-row glass-panel">
      <a class="plugin-main" href="/plugins/${encodeURIComponent(plugin.name)}" data-link>
        <img class="avatar" src="${safe(plugin.avatarUrl || `https://github.com/${plugin.author}.png?size=96`)}" alt="${safe(plugin.author)} 头像" width="56" height="56" loading="lazy" />
        <span>
          <span class="plugin-title">${safe(plugin.displayName)} ${statusBadge(plugin)}</span>
          <small>by ${safe(plugin.author)}</small>
          <span class="plugin-desc">${safe(plugin.description)}</span>
          <span class="chip-row">${pluginChips(plugin)}</span>
        </span>
      </a>
      <div class="plugin-actions">
        <button class="secondary-button" type="button" data-action="copy-repo" data-copy="${safe(repositorySourceUrl(plugin))}" data-copy-label="仓库链接已复制">${icon("link", "复制仓库链接")}</button>
        <button class="secondary-button" type="button" data-action="copy-cli" data-copy="${safe(cliCommand(plugin))}" data-copy-label="CLI 安装命令已复制">${icon("terminal", "复制 CLI 命令")}</button>
      </div>
    </article>
  `;
}
function marketPanel() {
    const plugins = filteredPlugins();
    clampMarketPage(plugins.length);
    const pageCount = maxMarketPage(plugins.length);
    const start = (state.marketPage - 1) * marketPageSize;
    const pagePlugins = plugins.slice(start, start + marketPageSize);
    const activeFilters = activeFilterCount();
    const filterPanelOpen = state.filterOpen || activeFilters > 0;
    const firstShown = pagePlugins.length ? start + 1 : 0;
    const lastShown = start + pagePlugins.length;
    return `
    <section class="market-panel glass-panel" aria-labelledby="market-title">
      <div class="panel-title-row">
        <div>
          <h2 id="market-title">插件市场 <span class="soft-badge">实时更新</span></h2>
          <p>已检测通过的插件将实时展示在这里。</p>
        </div>
        <div class="market-count">
          <span>当前显示 ${firstShown}-${lastShown} / 筛选 ${plugins.length} / 共 ${state.market.plugins.length} 个插件</span>
          <button class="secondary-button compact" type="button" data-action="refresh-market">${icon("refresh-cw", "刷新")}</button>
        </div>
      </div>
      <div class="filter-bar">
        <label class="search-box" for="plugin-search">
          ${icon("search")}
          <input id="plugin-search" type="search" placeholder="搜索插件、作者、能力..." value="${safe(state.query)}" />
        </label>
        <button class="secondary-button compact filter-toggle" data-action="toggle-filters" type="button" aria-expanded="${filterPanelOpen}" aria-controls="market-filters">${icon("sliders-horizontal", `过滤${activeFilters ? ` ${activeFilters}` : ""}`)}</button>
      </div>
      <div id="market-filters" class="filter-panel ${filterPanelOpen ? "open" : ""}">
        <div class="tabs" role="tablist" aria-label="分类过滤">
          ${categories()
        .map((category) => `<button class="tab" data-action="category" data-category="${safe(category)}" aria-pressed="${state.category === category}" type="button">${safe(category)}</button>`)
        .join("")}
        </div>
        <div class="filter-actions">
          <button class="secondary-button compact" data-action="warning-toggle" data-warning-toggle type="button" aria-pressed="${state.onlyWarnings}">${icon("shield-alert", state.onlyWarnings ? "显示全部" : "仅看需复核")}</button>
          <button class="secondary-button compact" data-action="reset-filters" type="button" ${activeFilters ? "" : "disabled"}>${icon("rotate-ccw", "重置过滤")}</button>
        </div>
      </div>
      <div class="market-list" data-page="${state.marketPage}" data-page-count="${pageCount}">
        ${pagePlugins.length ? pagePlugins.map(pluginRow).join("") : `<div class="empty-state">${icon("package-search")}<h3>还没有匹配插件</h3><p>换个分类或提交一个新的 Codex 插件仓库。</p></div>`}
      </div>
      <div class="pagination" aria-label="插件分页">
        <button class="secondary-button compact" data-action="page-prev" type="button" ${state.marketPage <= 1 ? "disabled" : ""}>${icon("chevron-left", "上一页")}</button>
        <span>第 ${state.marketPage} / ${pageCount} 页</span>
        <button class="secondary-button compact" data-action="page-next" type="button" ${state.marketPage >= pageCount ? "disabled" : ""}>${icon("chevron-right", "下一页")}</button>
      </div>
    </section>
  `;
}
function checkRecord(item) {
    const statusText = item.status === "approved" ? "检测通过" : item.status === "failed" ? "检测失败" : "检测中";
    const iconName = item.status === "approved" ? "circle-check" : item.status === "failed" ? "circle-x" : "loader-circle";
    return `
    <article class="check-record ${safe(item.status)}">
      <span>${icon(iconName)}</span>
      <strong>${safe(item.repositoryUrl)}</strong>
      <span class="record-status">${safe(statusText)}</span>
      <small>${safe(item.reason || formatTime(item.updatedAt || item.submittedAt))}</small>
      <a href="${safe(item.repositoryUrl)}" target="_blank" rel="noreferrer" aria-label="打开仓库">${icon("chevron-right")}</a>
    </article>
  `;
}
function resultGuide() {
    return `
    <section class="info-card glass-panel">
      <h2>检测结果说明</h2>
      <div class="result-line success">${icon("circle-check")}<div><strong>检测通过</strong><p>仓库包含有效的 Codex 插件清单，已加入市场。</p></div></div>
      <div class="result-line warning">${icon("triangle-alert")}<div><strong>检测失败（可修复）</strong><p>插件清单不完整或部分字段缺失，请完善后重新提交。</p></div></div>
      <div class="result-line danger">${icon("circle-x")}<div><strong>检测失败（不可用）</strong><p>未找到插件清单或仓库不可访问，无法识别为插件。</p></div></div>
    </section>
  `;
}
function howToCard() {
    return `
    <section class="info-card howto-card glass-panel">
      <h2>如何使用？</h2>
      <ol class="howto-list">
        <li><span>1</span><div><strong>粘贴 GitHub 仓库链接</strong><p>支持公开的 Codex 插件仓库。</p></div></li>
        <li><span>2</span><div><strong>自动检测与验证</strong><p>系统检查插件规范和必需文件。</p></div></li>
        <li><span>3</span><div><strong>加入市场展示</strong><p>通过后插件将实时展示给所有用户。</p></div></li>
      </ol>
      <a class="secondary-button" href="/about" data-link>${icon("arrow-right", "了解检测规范")}</a>
    </section>
  `;
}
function recentChecks() {
    return `
    <section class="recent-panel glass-panel" aria-labelledby="recent-title">
      <div class="panel-title-row">
        <h2 id="recent-title">最近检测记录</h2>
        <a class="ghost-link" href="/reviews" data-link>查看全部记录 ${icon("arrow-right")}</a>
      </div>
      <div class="timeline">
        ${state.market.checks.length ? state.market.checks.slice(0, 8).map(checkRecord).join("") : `<p class="helper">暂无检测记录。</p>`}
      </div>
    </section>
  `;
}
function logStream() {
    return "";
}
function homePage() {
    return `
    ${header()}
    <main id="main" class="page dashboard-page">
      <div class="dashboard-grid">
        ${submitPanel()}
        ${marketPanel()}
        ${recentChecks()}
        <div class="side-stack">
          ${resultGuide()}
          ${howToCard()}
        </div>
      </div>
    </main>
  `;
}
function staticPage(kind) {
    const checks = state.market.checks;
    const title = kind === "install" ? "如何使用插件市场" : kind === "about" ? "检测规范" : "关于我们";
    const installBody = `
    <div class="usage-grid">
      <article class="usage-card glass-panel">
        <div class="usage-head">${icon("monitor")}<div><strong>Codex Desktop 用户</strong><p>适合在桌面端浏览插件、复制单个插件的 GitHub 仓库来源，并在 Codex Desktop 中安装使用。</p></div></div>
        <ol class="usage-steps">
          <li><span>1</span><div><strong>打开插件市场</strong><p>进入市场首页，按名称、作者、分类或能力搜索你需要的插件。</p><a class="secondary-button" href="/" data-link>${icon("store", "前往插件市场")}</a></div></li>
          <li><span>2</span><div><strong>查看插件详情</strong><p>确认插件已通过检测，阅读说明、能力标签、来源仓库和同步状态。</p></div></li>
          <li><span>3</span><div><strong>复制仓库来源</strong><p>在插件卡片或详情页点击“复制仓库链接”，复制的是可被 Codex Desktop clone 的 GitHub 根仓库 URL，不是 /tree 分支浏览页。</p></div></li>
          <li><span>4</span><div><strong>安装并使用插件</strong><p>在 Codex Desktop 的插件安装入口粘贴插件仓库来源。默认分支会跟随仓库远端 HEAD，页面标签会显示当前检测到的默认分支。安装完成后，按插件说明在会话中调用它的能力。</p></div></li>
        </ol>
      </article>
      <article class="usage-card glass-panel">
        <div class="usage-head">${icon("terminal")}<div><strong>Codex CLI 用户</strong><p>适合从网页市场复制具体插件的安装命令，并在终端安装到本机 Codex CLI。</p></div></div>
        <ol class="usage-steps">
          <li><span>1</span><div><strong>选择具体插件</strong><p>在市场首页或插件详情页找到需要的插件，先确认检测状态和仓库来源。</p></div></li>
          <li><span>2</span><div><strong>复制 CLI 安装命令</strong><p>点击插件卡片上的“复制 CLI 命令”，命令会带上仓库默认分支，避免 dev、master 等非 main 分支安装错误。</p><code>codex plugin marketplace add &lt;插件仓库链接&gt; --ref &lt;默认分支&gt;</code></div></li>
          <li><span>3</span><div><strong>在终端运行命令</strong><p>把复制的命令粘贴到终端执行。安装完成后，按 CLI 提示刷新或重新进入 Codex 会话。</p></div></li>
          <li><span>4</span><div><strong>在 CLI 会话中使用插件</strong><p>回到 Codex CLI，对 Codex 说明你要使用该插件完成的任务，或按插件详情页的说明调用能力。</p></div></li>
        </ol>
      </article>
    </div>`;
    const body = kind === "install"
        ? installBody
        : kind === "about"
            ? `
          <div class="rule-grid">
            ${["公开 GitHub 仓库", "能识别 Codex 插件入口", "非关键字段降级为提示", "危险安装脚本需要复核"].map((item) => `<div class="rule-item">${icon("shield-check")}<strong>${item}</strong></div>`).join("")}
          </div>`
            : `
          <div class="timeline">${checks.length ? checks.map(checkRecord).join("") : `<p class="helper">暂无检测记录。</p>`}</div>`;
    return `
    ${header()}
    <main id="main" class="page content-page">
      <section class="content-card glass-panel">
        <a href="/" data-link class="secondary-button compact">${icon("arrow-left", "返回市场")}</a>
        <h1>${safe(title)}</h1>
        <p>${kind === "install" ? "根据你使用的是 Codex Desktop 还是 Codex CLI，选择具体插件，复制该插件的 GitHub 仓库来源或 CLI 安装命令并开始使用。" : kind === "reviews" ? "这里汇总最近的插件检测与同步状态。" : "了解插件进入市场前会经过哪些检测，以及哪些情况需要人工复核。"}</p>
        ${body}
      </section>
    </main>
  `;
}
function detailPage(name) {
    const plugin = state.market.plugins.find((item) => item.name === name);
    if (!plugin) {
        return `
      ${header()}
      <main id="main" class="page content-page">
        <div class="empty-state glass-panel">
          ${icon("package-x")}
          <h1>没有找到这个插件</h1>
          <a href="/" data-link class="primary-button">${icon("arrow-left", "返回市场")}</a>
        </div>
      </main>
    `;
    }
    return `
    ${header()}
    <main id="main" class="page content-page detail-page">
      <article class="detail-card glass-panel">
        <a href="/" data-link class="secondary-button compact">${icon("arrow-left", "返回插件目录")}</a>
        <div class="plugin-head large">
          <img class="avatar large" src="${safe(plugin.avatarUrl || `https://github.com/${plugin.author}.png?size=96`)}" alt="${safe(plugin.author)} 头像" width="76" height="76" />
          <div>
            <p class="small-label">${safe(plugin.category)}</p>
            <h1>${safe(plugin.displayName)}</h1>
            <p>${safe(plugin.description)}</p>
          </div>
          ${statusBadge(plugin)}
        </div>
        <div class="detail-actions">
          <button class="primary-button" type="button" data-copy="${safe(repositorySourceUrl(plugin))}" data-copy-label="仓库链接已复制">${icon("link", "复制仓库链接")}</button>
          <button class="secondary-button" type="button" data-copy="${safe(cliCommand(plugin))}" data-copy-label="CLI 安装命令已复制">${icon("terminal", "复制 CLI 命令")}</button>
        </div>
        <section>
          <h2>插件说明</h2>
          <p>${safe(plugin.longDescription || plugin.description)}</p>
        </section>
        <section>
          <h2>能力标签</h2>
          <div class="chip-row">${[...(plugin.tags || []), ...(plugin.capabilities || [])].map((item) => `<span class="chip">${safe(item)}</span>`).join("")}</div>
        </section>
        <form class="admin-delete glass-panel" data-delete-form="${safe(plugin.name)}" novalidate>
          <div>
            <p class="small-label">Marketplace Admin</p>
            <h2>从市场删除这个插件</h2>
            <p class="helper">输入管理员密码后会直接从当前市场移除。密码只发送到服务端验证，不写入日志。</p>
          </div>
          <label for="admin-password">管理员密码</label>
          <input id="admin-password" name="adminPassword" type="password" autocomplete="current-password" value="${safe(state.deletePassword)}" aria-describedby="delete-error" />
          <label for="delete-reason">删除原因</label>
          <textarea id="delete-reason" name="reason" rows="3" placeholder="可选，便于审计记录">${safe(state.deleteReason)}</textarea>
          <p id="delete-error" class="error-text" role="alert">${safe(state.deleteError)}</p>
          ${state.deleteMessage ? `<div class="success-box">${icon("badge-check")}<span>${safe(state.deleteMessage)}</span></div>` : ""}
          <button class="danger-button" type="submit" ${state.deleteLoading ? "disabled" : ""}>${icon(state.deleteLoading ? "loader-circle" : "trash-2", state.deleteLoading ? "删除中" : "确认删除插件")}</button>
        </form>
      </article>
    </main>
  `;
}
function captureFocus() {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement))
        return null;
    if (!active.id)
        return null;
    return {
        id: active.id,
        value: active.value,
        selectionStart: active.selectionStart,
        selectionEnd: active.selectionEnd,
    };
}
function restoreFocus(snapshot) {
    if (!snapshot)
        return;
    if (skipNextFocusValueRestore) {
        skipNextFocusValueRestore = false;
        return;
    }
    const next = document.getElementById(snapshot.id);
    if (!(next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement))
        return;
    if (snapshot.id === "repo-url")
        state.submitUrl = snapshot.value;
    if (snapshot.id === "plugin-search")
        state.query = snapshot.value;
    if (snapshot.id === "admin-password")
        state.deletePassword = snapshot.value;
    if (snapshot.id === "delete-reason")
        state.deleteReason = snapshot.value;
    next.value = snapshot.value;
    next.focus({ preventScroll: true });
    if (snapshot.selectionStart !== null && snapshot.selectionEnd !== null) {
        try {
            next.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
        }
        catch { }
    }
}
function render() {
    const focusSnapshot = captureFocus();
    applyTheme();
    if (state.route.startsWith("/plugins/")) {
        app.innerHTML = detailPage(decodeURIComponent(state.route.split("/").filter(Boolean).pop() || ""));
    }
    else if (state.route.startsWith("/install")) {
        app.innerHTML = staticPage("install");
    }
    else if (state.route.startsWith("/about")) {
        app.innerHTML = staticPage("about");
    }
    else if (state.route.startsWith("/reviews")) {
        app.innerHTML = staticPage("reviews");
    }
    else {
        app.innerHTML = homePage();
    }
    window.lucide?.createIcons({ attrs: { "stroke-width": 2 } });
    syncThemeButtons();
    updateClock();
    restoreFocus(focusSnapshot);
}
function routeTo(href) {
    if (state.route === href)
        return;
    window.history.pushState({}, "", href);
    state.route = href;
    state.deleteError = "";
    state.deleteMessage = "";
    addLog("route", `切换页面：${href}`, "info");
    scheduleRender();
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}
function clearSubmitForm({ deferRender = false } = {}) {
    submitRunId += 1;
    clearSubmitProgressTimers();
    skipNextFocusValueRestore = true;
    const repoInput = document.querySelector("#repo-url");
    if (repoInput)
        repoInput.value = "";
    document.querySelectorAll(".submit-panel .success-box, .submit-panel .error-box").forEach((node) => node.remove());
    state.submitUrl = "";
    state.submitError = "";
    state.submitMessage = "";
    state.submitTouched = false;
    state.submitLoading = false;
    state.submitStage = "idle";
    state.submitStatus = "idle";
    state.submitPulse = state.submitPulse === "a" ? "b" : "a";
    syncSubmitError("");
    syncSubmitUi();
    if (deferRender) {
        window.setTimeout(scheduleRender, 240);
    }
    else {
        scheduleRender();
    }
}
function selectCategory(category) {
    state.category = category || "全部";
    resetMarketPage();
    document.querySelectorAll("[data-category]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.category === state.category));
    });
}
function bindEvents() {
    app.addEventListener("click", (event) => {
        const target = event.target;
        const copyButton = target.closest("[data-copy]");
        if (!copyButton)
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void copyText(copyButton.dataset.copy || "", copyButton.dataset.copyLabel || "已复制");
    }, true);
    app.addEventListener("click", (event) => {
        const target = event.target;
        const clearButton = target.closest('[data-action="clear-submit"]');
        if (!clearButton)
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        clearSubmitForm();
        addLog("click", "提交表单已清空", "info");
    }, true);
    app.addEventListener("pointerdown", (event) => {
        const target = event.target;
        const pageButton = target.closest('[data-action="page-prev"], [data-action="page-next"]');
        if (pageButton && !pageButton.disabled) {
            event.preventDefault();
            recentPaginationPointer = Date.now();
            changeMarketPage(pageButton.dataset.action);
            return;
        }
        const filterActionButton = target.closest('[data-action="toggle-filters"], [data-action="reset-filters"], [data-warning-toggle], [data-category]');
        if (filterActionButton && !filterActionButton.disabled) {
            event.preventDefault();
            recentFilterPointer = Date.now();
            if (filterActionButton.dataset.category !== undefined) {
                selectCategory(filterActionButton.dataset.category || "全部");
                addLog("filter", `分类切换为 ${state.category}`, "success");
                scheduleRender();
                return;
            }
            if (filterActionButton.dataset.warningToggle !== undefined) {
                toggleWarningFilter();
                return;
            }
            if (filterActionButton.dataset.action === "toggle-filters") {
                toggleFilterPanel();
                return;
            }
            if (filterActionButton.dataset.action === "reset-filters") {
                resetFilters();
                return;
            }
        }
        const actionButton = target.closest('[data-action="submit-check"], [data-action="clear-submit"]');
        if (actionButton) {
            suppressSubmitBlur = true;
            window.setTimeout(() => { suppressSubmitBlur = false; }, 500);
            actionButton.classList.add("is-pressed");
            window.setTimeout(() => actionButton.classList.remove("is-pressed"), 160);
        }
    }, true);
    app.addEventListener("click", (event) => {
        const target = event.target;
        const link = target.closest("[data-link]");
        if (link) {
            const href = link.getAttribute("href");
            if (href && !href.startsWith("http")) {
                event.preventDefault();
                routeTo(href);
            }
            return;
        }
        const themeButton = target.closest("[data-theme-mode]");
        if (themeButton?.dataset.themeMode) {
            setThemeMode(themeButton.dataset.themeMode);
            return;
        }
        const copyButton = target.closest("[data-copy]");
        if (copyButton) {
            void copyText(copyButton.dataset.copy || "", copyButton.dataset.copyLabel || "已复制");
            return;
        }
        const categoryButton = target.closest("[data-category]");
        if (categoryButton) {
            if (Date.now() - recentFilterPointer > 1200) {
                selectCategory(categoryButton.dataset.category || "全部");
                addLog("filter", `分类切换为 ${state.category}`, "success");
                scheduleRender();
            }
            return;
        }
        const warningButton = target.closest("[data-warning-toggle]");
        if (warningButton) {
            if (Date.now() - recentFilterPointer > 1200)
                toggleWarningFilter();
            return;
        }
        const actionButton = target.closest("[data-action]");
        const action = actionButton?.dataset.action;
        if (action === "toggle-filters") {
            if (Date.now() - recentFilterPointer > 1200)
                toggleFilterPanel();
            return;
        }
        if (action === "reset-filters") {
            if (Date.now() - recentFilterPointer > 1200)
                resetFilters();
            return;
        }
        if (action === "page-prev" || action === "page-next") {
            if (Date.now() - recentPaginationPointer > 1200) {
                changeMarketPage(action);
            }
            return;
        }
        if (action === "submit-check") {
            event.preventDefault();
            void submitRepository();
            return;
        }
        if (action === "refresh-market") {
            void loadMarket();
            return;
        }
        if (action === "clear-submit") {
            event.preventDefault();
            clearSubmitForm({ deferRender: true });
            addLog("click", "提交表单已清空", "info");
            return;
        }
        if (action === "clear-logs") {
            state.logs = [];
            scheduleRender();
        }
    });
    app.addEventListener("input", (event) => {
        const input = event.target;
        if (input.id === "repo-url") {
            state.submitUrl = input.value;
            state.submitError = "";
            syncSubmitError("");
            return;
        }
        if (input.id === "plugin-search") {
            state.query = input.value;
            resetMarketPage();
            window.clearTimeout(searchRenderTimer);
            searchRenderTimer = window.setTimeout(() => {
                addLog("filter", state.query ? `搜索：${state.query}` : "清空搜索", "info");
                scheduleRender();
            }, 120);
            return;
        }
        if (input.id === "admin-password") {
            state.deletePassword = input.value;
            state.deleteError = "";
            return;
        }
        if (input.id === "delete-reason") {
            state.deleteReason = input.value;
        }
    });
    app.addEventListener("blur", (event) => {
        const input = event.target;
        if (input.id === "repo-url") {
            if (suppressSubmitBlur)
                return;
            state.submitTouched = true;
            state.submitError = validateGithubUrl(state.submitUrl);
            scheduleRender();
        }
    }, true);
    app.addEventListener("submit", (event) => {
        const form = event.target;
        if (form.matches("[data-share-form]")) {
            event.preventDefault();
            void submitRepository();
            return;
        }
        const pluginName = form.dataset.deleteForm;
        if (pluginName) {
            event.preventDefault();
            void deletePlugin(pluginName);
        }
    });
}
window.addEventListener("popstate", () => {
    state.route = window.location.pathname;
    render();
});
window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", () => {
    if (themeMode() === "system") {
        applyTheme();
        syncThemeButtons();
    }
});
applyTheme();
bindEvents();
startClock();
void loadMarket();
window.clearInterval(syncTimer);
syncTimer = window.setInterval(() => void loadMarket({ silent: true }), 5000);
export {};
