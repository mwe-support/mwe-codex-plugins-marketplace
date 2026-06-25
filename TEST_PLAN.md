# UI / Interaction Regression Test Plan

This project uses a dark-first Perspective glassmorphism UI. All pages and components should keep the same rounded typography, layered control-deck layout, Lucide icon language, and responsive behavior.

## Roles Used For This Review

- UI/UX review subagent: audited layout consistency, accessibility risks, responsive screenshot coverage, and likely jank sources.
- Interaction testing subagent: designed repeated-click stress flows, latency metrics, long-task thresholds, and Playwright automation strategy.

## Target Flows

1. `/` loads, `/api/market` returns data, marketplace filters and copy controls render.
2. `/share` shows the upload form, validates invalid URLs inline, and shows success/failure feedback.
3. `/plugins/:name` deep links into the themed detail page.
4. Theme switching between system/light/dark does not reset route state or freeze controls.
5. Search, category filters, warning filter, and copy buttons respond under rapid clicking.
6. Admin delete requires a password and removes the plugin from the marketplace immediately after success.
7. Polling or market refresh does not clear focused input or block clicks.

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

- 1586 x 992 desktop, matching the supplied reference image dimensions.
- 768 x 1024 tablet.
- 375 x 812 mobile.

Check every viewport for:

- No horizontal overflow.
- Header does not cover or intercept content.
- Hero/control deck remains balanced and glass-like.
- Form labels, helper text, and error text remain readable.
- Plugin cards keep buttons visible and tappable.
- Toast does not hide primary actions.

## Manual API Checks

For the live Docker/PostgreSQL stack, verify admin deletion with a temporary fixture:

1. Insert or create a temporary plugin row with `source.type = "shared-repository"`.
2. Start the service with `MARKETPLACE_ADMIN_PASSWORD` set.
3. Confirm the fixture appears in `GET /api/market`.
4. Call `DELETE /api/plugins/<name>` with `{ "adminPassword": "..." }`.
5. Confirm `GET /api/market` no longer returns the fixture.

## Known Tooling Notes

- Browser/IAB runtime was not available in this session, so validation uses Playwright Chromium.
- `view_image` was blocked by a sandbox helper error, so screenshot files are preserved outside the repo during QA and referenced in the final report.
