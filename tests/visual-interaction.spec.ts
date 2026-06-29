import { expect, test, type Page } from '@playwright/test';

const marketPayload = {
  source: 'playwright',
  serviceStatus: 'live',
  generatedAt: new Date().toISOString(),
  plugins: Array.from({ length: 12 }, (_, i) => ({
    name: `plugin-${i}`,
    displayName: i === 0 ? 'Context7' : `Plugin ${i}`,
    description: i === 0 ? '为 Codex 提供最新的库文档和代码示例。' : `用于验证 Codex 插件市场布局和交互性能的测试插件 ${i}。`,
    longDescription: `Plugin ${i} 是一条用于详情页、复制按钮、管理员删除表单和响应式布局验证的测试数据。`,
    author: i === 0 ? 'upstash' : 'mwe-support',
    avatarUrl: i === 0 ? 'https://github.com/upstash.png?size=96' : 'https://github.com/mwe-support.png?size=96',
    category: i % 3 === 0 ? 'Developer Tools' : i % 3 === 1 ? 'Coding' : 'MCP',
    tags: ['文档', `tag-${i}`, i % 5 === 0 ? 'warning' : 'passed'],
    capabilities: i % 3 === 0 ? ['文档', 'MCP', '开发工具'] : ['Coding', 'Marketplace', 'CLI'],
    version: '0.1.0',
    releaseTag: i === 0 ? 'dev' : 'main',
    defaultBranch: i === 0 ? 'dev' : 'main',
    headSha: i === 0 ? '1111111111111111111111111111111111111111' : null,
    repositoryUrl: i === 0 ? 'https://github.com/upstash/context7' : `https://github.com/example/plugin-${i}`,
    repositoryTreeUrl: i === 0 ? 'https://github.com/upstash/context7/tree/dev' : `https://github.com/example/plugin-${i}/tree/main`,
    verifiedStatus: 'verified',
    syncStatus: 'synced',
    securityScan: { status: i % 5 === 0 ? 'warnings' : 'passed', findings: [] },
  })),
  checks: Array.from({ length: 8 }, (_, i) => ({
    id: `check-${i}`,
    slug: `plugin-${i}`,
    repo: i === 0 ? 'context7' : `plugin-${i}`,
    owner: i === 0 ? 'upstash' : 'example',
    repositoryUrl: i === 0 ? 'https://github.com/upstash/context7' : `https://github.com/example/plugin-${i}`,
    status: i % 4 === 0 ? 'failed' : 'approved',
    stage: i % 4 === 0 ? 'validating' : 'completed',
    updatedAt: new Date().toISOString(),
    reason: i % 4 === 0 ? '测试失败状态' : '检测通过',
  })),
};

async function installMocks(page: Page) {
  let context7Count = 0;
  await page.route('**/api/market', (route) => route.fulfill({ json: marketPayload }));
  await page.route('**/api/check', async (route) => {
    const body = route.request().postDataJSON() as { repositoryUrl?: string };
    if (body.repositoryUrl?.includes('context7')) {
      context7Count += 1;
      await route.fulfill({
        status: context7Count > 1 ? 200 : 201,
        json: {
          status: 'approved',
          stage: 'completed',
          duplicate: context7Count > 1,
          message: context7Count > 1 ? '这个仓库已经在市场中，已刷新检测状态。' : '检测通过，插件已加入市场。',
          plugins: [marketPayload.plugins[0]],
          check: { ...marketPayload.checks[1], repositoryUrl: 'https://github.com/upstash/context7', status: 'approved', stage: 'completed' },
        },
      });
    } else if (body.repositoryUrl?.includes('valid-plugin')) {
      await route.fulfill({ status: 201, json: { status: 'approved', stage: 'completed', message: '检测通过，插件已加入市场。', plugins: [marketPayload.plugins[1]], check: marketPayload.checks[1] } });
    } else {
      await route.fulfill({ status: 422, json: { status: 'failed', stage: 'validating', error: '测试失败仓库' } });
    }
  });
  await page.route('**/api/plugins/*', async (route) => {
    if (route.request().method() === 'DELETE') {
      const body = route.request().postDataJSON() as { adminPassword?: string };
      if (body.adminPassword === 'wrong') return route.fulfill({ status: 401, json: { error: '管理员密码不正确，请确认后再试。' } });
      return route.fulfill({ json: { message: '插件已从市场删除。' } });
    }
    return route.continue();
  });
}

async function installJankMetrics(page: Page) {
  await page.addInitScript(() => {
    (window as any).__clickMetrics = [];
    (window as any).__longTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          (window as any).__longTasks.push({ duration: entry.duration, startTime: entry.startTime });
        }
      }).observe({ entryTypes: ['longtask'] as any });
    } catch {}
    document.addEventListener('click', (event) => {
      const start = performance.now();
      requestAnimationFrame(() => {
        const target = event.target as HTMLElement | null;
        (window as any).__clickMetrics.push({
          label: target?.closest?.('button,a,input')?.textContent?.trim() || target?.tagName || 'unknown',
          latency: performance.now() - start,
        });
      });
    }, true);
  });
}

async function rapidClick(locator: ReturnType<Page['locator']>, count: number) {
  for (let i = 0; i < count; i++) await locator.click({ timeout: 5_000 });
}

test.beforeEach(async ({ page }) => {
  await installJankMetrics(page);
  await installMocks(page);
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('dashboard matches the accepted structure without overflow', async ({ page }, testInfo) => {
  const consoleMessages: string[] = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) consoleMessages.push(`${message.type()}: ${message.text()}`);
  });
  await page.goto('/');
  await expect(page.getByText('MWE Codex插件共享市场').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /提交插件仓库，自动检测并加入市场/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /插件市场/ })).toBeVisible();
  await expect(page.getByText('最近检测记录')).toBeVisible();
  await expect(page.locator('[data-beijing-time]').first()).toContainText(/\d{4}\/\d{2}\/\d{2}/);
  await expect(page.locator('.progress-step')).toHaveCount(5);
  await expect(page.locator('.progress-light')).toHaveCount(1);
  await expect(page.locator('.market-list .plugin-row')).toHaveCount(9);
  await expect(page.getByRole('button', { name: /下一页/ })).toBeEnabled();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBeFalsy();
  expect(consoleMessages.filter((item) => !item.includes('Failed to load resource'))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`dashboard-${testInfo.project.name}.png`), fullPage: true });
});

test('theme, category filters, copy buttons, and routes remain responsive', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Context7/ }).first()).toBeVisible();
  await rapidClick(page.getByRole('button', { name: '浅色' }), 8);
  await rapidClick(page.getByRole('button', { name: '深色' }), 8);
  await rapidClick(page.getByRole('button', { name: '跟随系统' }), 8);
  await page.getByRole('button', { name: /下一页/ }).click();
  await expect(page.getByRole('link', { name: /Plugin 9/ })).toBeVisible();
  await page.getByRole('button', { name: /上一页/ }).click();
  await expect(page.getByRole('link', { name: /Context7/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /过滤/ }).click();
  await rapidClick(page.getByRole('button', { name: /仅看需复核|显示全部/ }), 8);
  await page.getByRole('button', { name: 'Coding' }).click();
  await expect(page.getByRole('button', { name: 'Coding' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: /Context7/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Developer Tools' }).click();
  await expect(page.getByRole('button', { name: 'Developer Tools' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#plugin-search').fill('context7');
  await page.waitForTimeout(180);
  await expect(page.getByRole('link', { name: /Context7/ }).first()).toBeVisible();
  await expect(page.locator('[data-action="copy-repo"]').first()).toHaveAttribute('data-copy', 'https://github.com/upstash/context7/tree/dev');
  await expect(page.locator('[data-action="copy-cli"]').first()).toHaveAttribute('data-copy', 'codex plugin marketplace add https://github.com/upstash/context7 --ref dev');
  await page.locator('[data-action="copy-repo"]').first().click();
  await page.locator('[data-action="copy-cli"]').first().click();
  await page.getByRole('link', { name: /Context7/ }).click();
  await expect(page).toHaveURL(/\/plugins\/plugin-0/);
  await expect(page.getByRole('heading', { name: 'Context7' })).toBeVisible();

  const metrics = await page.evaluate(() => ({
    clicks: (window as any).__clickMetrics,
    longTasks: (window as any).__longTasks,
  }));
  const latencies = metrics.clicks.map((item: { latency: number }) => item.latency).sort((a: number, b: number) => a - b);
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const longestTask = Math.max(0, ...metrics.longTasks.map((item: { duration: number }) => item.duration));
  expect(p95).toBeLessThan(180);
  expect(longestTask).toBeLessThan(300);
});

test('reduced-motion keeps submit stages paced instead of jumping to extraction', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/share');
  await page.getByLabel(/GitHub 仓库链接/).fill('https://github.com/upstash/context7');
  await page.getByRole('button', { name: /开始检测/ }).click();
  await page.waitForTimeout(250);
  await expect(page.locator('.progress-rail')).toHaveAttribute('data-stage', 'received');
  await expect(page.locator('.progress-step.active')).toContainText('接收链接');
  await page.waitForTimeout(900);
  await expect(page.locator('.progress-rail')).toHaveAttribute('data-stage', 'cloning');
});

test('submit flow shows five-step progress, duplicate recovery, and failed state', async ({ page }) => {
  await page.goto('/share');
  await page.getByLabel(/GitHub 仓库链接/).fill('not-a-url');
  await page.getByRole('button', { name: /开始检测/ }).click();
  await expect(page.getByRole('alert')).toContainText('URL 格式不正确');
  await expect(page.locator('.progress-step.failed')).toContainText('接收链接');

  await page.getByLabel(/GitHub 仓库链接/).fill('https://github.com/upstash/context7');
  const successStartedAt = Date.now();
  await page.getByRole('button', { name: /开始检测/ }).click();
  await expect(page.getByText('检测完成，市场已更新')).toBeVisible({ timeout: 10000 });
  expect(Date.now() - successStartedAt).toBeGreaterThan(5000);
  await expect(page.locator('.progress-step').last()).toHaveClass(/passed|warning/);

  await page.getByLabel(/GitHub 仓库链接/).fill('https://github.com/upstash/context7');
  await page.getByRole('button', { name: /开始检测/ }).click();
  await expect(page.getByLabel('提交插件仓库，自动检测并加入市场').getByText('这个仓库已经在市场中，已刷新检测状态。')).toBeVisible({ timeout: 10000 });

  await page.getByLabel(/GitHub 仓库链接/).fill('https://github.com/example/broken-plugin');
  await page.getByRole('button', { name: /开始检测/ }).click();
  await expect(page.getByRole('alert')).toContainText('测试失败仓库');
  await expect(page.locator('.check-record.failed .record-status').first()).toContainText('检测失败');
});

test('admin password errors are visible and success deletes immediately', async ({ page }) => {
  await page.goto('/plugins/plugin-1');
  await expect(page.getByRole('heading', { name: 'Plugin 1' })).toBeVisible();
  await page.getByLabel('管理员密码').fill('wrong');
  await page.getByLabel('删除原因').fill('playwright regression');
  await page.getByRole('button', { name: /确认删除插件/ }).click();
  await expect(page.getByRole('alert')).toContainText('管理员密码不正确');
  await expect(page.getByText('wrong')).toHaveCount(0);

  await page.getByLabel('管理员密码').fill('secret-admin');
  await page.getByRole('button', { name: /确认删除插件/ }).click();
  await expect(page.getByText('插件已删除')).toBeVisible();
  await expect(page).toHaveURL('/');
});

test('install page explains Desktop and CLI usage without central marketplace links', async ({ page }) => {
  await page.goto('/install');
  await expect(page.getByRole('heading', { name: '如何使用插件市场' })).toBeVisible();
  await expect(page.getByText('Codex Desktop 用户')).toBeVisible();
  await expect(page.getByText('打开插件市场')).toBeVisible();
  await expect(page.getByText('复制默认分支链接')).toBeVisible();
  await expect(page.getByText('在 Codex Desktop 的插件安装入口粘贴插件默认分支链接')).toBeVisible();
  await expect(page.getByText('Codex CLI 用户')).toBeVisible();
  await expect(page.getByText('复制 CLI 安装命令')).toBeVisible();
  await expect(page.getByText('codex plugin marketplace add <插件仓库链接> --ref <默认分支>')).toBeVisible();
  await expect(page.getByText('mwe-support/mwe-codex-plugins-marketplace')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /复制 Marketplace/ })).toHaveCount(0);
  await expect(page.getByText('GitHub Action')).toHaveCount(0);
});

