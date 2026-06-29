# UI / API / Deployment Regression Test Plan

This project uses a dark-first Perspective glassmorphism UI. All pages and components should keep the same rounded typography, layered control-deck layout, Lucide icon language, and responsive behavior.

## Target Flows

1. `/` loads, `/api/market` returns PostgreSQL-backed data, marketplace filters and copy controls render.
2. `/share` shows the upload form, validates invalid URLs inline, and shows success/failure feedback from `POST /api/check`.
3. `/plugins/:name` deep links into the themed detail page.
4. `/install`, `/reviews`, and `/rules` use the same app shell and do not mention a central marketplace repository as an installation step.
5. Theme switching between system/light/dark does not reset route state or freeze controls.
6. Search, category filters, warning filter, pagination, and copy buttons respond under rapid clicking.
7. Admin delete requires `MARKETPLACE_ADMIN_PASSWORD` or `ADMIN_PASSWORD` and removes the plugin from the marketplace immediately after success.
8. Polling or market refresh does not clear focused input or block clicks.
9. The five-step progress animation advances as a light segment from the previous node to the current node.

## Automated Coverage

Run:

```bash
npm run check
```

This executes:

- TypeScript build from `src/app.ts` to `app.js`.
- Node syntax checks for frontend bundle, server, and database helpers.
- Playwright visual and interaction tests across desktop, tablet, and mobile projects.

The Playwright suite in `tests/visual-interaction.spec.ts` covers:

- First meaningful screen render and no horizontal overflow.
- Full-page screenshot capture for desktop, tablet, and mobile.
- Repeated theme/filter/category/copy/detail-route clicks.
- Invalid submit validation and successful submit feedback.
- Admin delete UI feedback with mocked API.
- Usage page copy that focuses on installing individual plugins for Desktop and CLI users.

## Repeated-Click Stress Thresholds

A run passes only when:

- No uncaught page errors occur.
- No relevant console warnings/errors occur.
- Click latency p95 stays below 150ms in the stress loop.
- No long task exceeds 250ms in the stress loop.
- No Playwright click waits because a sticky header or overlay intercepts target buttons.
- Route remains stable after theme/copy/filter actions.

## Visual Regression Viewports

Capture and inspect:

- 1440px or wider desktop.
- 768 x 1024 tablet.
- 375 x 812 mobile.

Check every viewport for:

- No horizontal overflow.
- Header does not cover or intercept content.
- Hero/control deck remains balanced and glass-like.
- Form labels, helper text, and error text remain readable.
- Plugin cards keep buttons visible and tappable.
- Toast does not hide primary actions.
- Progress light follows the active detection segment and does not run unrelated loop animations.

## Manual API Checks

For the live Docker/PostgreSQL stack:

```bash
curl -sS http://127.0.0.1:8787/api/health
curl -sS http://127.0.0.1:8787/api/market
curl -sS -X POST http://127.0.0.1:8787/api/check \
  -H 'Content-Type: application/json' \
  --data '{"repositoryUrl":"https://github.com/callstackincubator/agent-skills"}'
```

Verify failed submissions are persisted as failed:

```bash
curl -sS -X POST http://127.0.0.1:8787/api/check \
  -H 'Content-Type: application/json' \
  --data '{"repositoryUrl":"https://github.com/not-a-real-owner/not-a-real-repo"}'
```

Verify admin deletion with a temporary fixture or known test plugin:

1. Start the service with `MARKETPLACE_ADMIN_PASSWORD` set.
2. Confirm the plugin appears in `GET /api/market`.
3. Call `DELETE /api/plugins/<name>` with `{ "adminPassword": "..." }`.
4. Confirm `GET /api/market` no longer returns the plugin.

## Docker / GHCR Checks

Before publishing an image:

```bash
docker build -t ghcr.io/mwe-support/mwe-codex-plugins-marketplace:<tag> .
docker run --rm ghcr.io/mwe-support/mwe-codex-plugins-marketplace:<tag> node --check server.mjs
```

After pushing:

```bash
docker pull ghcr.io/mwe-support/mwe-codex-plugins-marketplace:<tag>
```

For compose deployment with the published image:

```bash
MARKETPLACE_IMAGE=ghcr.io/mwe-support/mwe-codex-plugins-marketplace:<tag> \
  docker compose up -d --no-build mwe-codex-marketplace
```

## Known Tooling Notes

- Browser/IAB runtime may be unavailable in some Codex sessions; use Playwright Chromium as fallback and record that choice.
- If `view_image` is blocked by a sandbox helper error, preserve Playwright screenshots under `/tmp` and summarize the evidence in the final response.
