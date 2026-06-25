# AGENTS.md

## Project Direction

This repository is the MWE Codex plugin quick sharing marketplace. The accepted product direction is a dark-first Perspective/glassmorphism interface with a complete light theme, rounded typography, MWE branding, and clear copy actions for repository links and Codex CLI install commands.

The product is no longer a central GitHub registry or GitHub Action driven review system. Users paste a public GitHub repository URL, the server detects Codex plugin content, and passing plugins appear in the web marketplace from PostgreSQL in near realtime.

## Design System Requirements

- Keep the site visually unified across every route. Do not let secondary pages drift back to the older plain Codex/tooling style.
- All user-facing pages must render inside the current Perspective visual system in `styles.css` unless a future redesign explicitly replaces the whole system.
- Use the established tokens in `styles.css`: `--ps-heading`, `--ps-body`, `--ps-brand`, `--ps-border`, `--ps-glass`, and related light/dark overrides.
- Default theme is dark, with a polished light theme. Theme changes must update styling without causing route state loss or interaction freezes.
- Typography should stay rounded and friendly, using the current Nunito/Open Sans-oriented stack. Avoid mixing in harsher system-only headings on new pages.
- Use Lucide icons for controls and status. Do not introduce emoji as UI icons.
- Keep cards, panels, forms, code boxes, and sidebars glass-like and consistent with the homepage. Avoid plain white/black blocks unless scoped as intentional code or terminal surfaces.
- Preserve accessible focus rings, visible labels, 44px minimum interactive targets, and keyboard-friendly navigation.

## Current Routes

- `/`: quick sharing form, live marketplace, and recent checks.
- `/share`: same app shell focused on the sharing flow.
- `/plugins/:name`: plugin detail page.

When adding a page, update this list and verify the new page uses the same theme shell, navigation, spacing, and button language as the homepage.

## Marketplace Copy Rules

- Use `MWE Codex 插件快享市场` for the product/brand title.
- The repository link action copies the plugin source GitHub repository URL.
- The CLI action copies `codex plugin add <repository-url>`.
- Keep copy concise: this site is for quick sharing and detection, not a marketing landing page.

## Interaction Rules

- Ordinary uploads must not create GitHub issues or depend on GitHub Actions.
- `POST /api/check` is the upload path: validate the URL, clone/read the public repository, detect Codex plugin content, write a check record, and upsert passing plugins.
- Detection should be permissive enough for real community repositories: missing Release, README, screenshots, or optional metadata should become warnings, not hard failures.
- Hard failures should be reserved for inaccessible repositories, invalid URLs, unreadable/invalid plugin manifests, or no recognizable Codex plugin entry.
- Failed checks must be visible as failed in `/api/market`; never leave failed uploads stuck as pending/reviewing.
- Duplicate plugin submissions are detected by normalized GitHub repository URL and should return a clear user-facing message instead of creating another record loop.
- Theme switching must not rebuild the whole app or reset the current route. Update theme attributes and pressed states in place.
- Copy buttons should show a toast and remain usable after theme changes and route changes.
- Search/filter interactions should keep stable keys and avoid rendering unnecessary lists.
- Form validation should use visible labels, helper text, field-local errors, disabled loading states, and success/error feedback.
- Do not render, persist, or log secrets from user input or environment variables.

## Verification Checklist

Before committing UI/API changes, check:

- All routes listed above visually match the Perspective homepage in both dark and light themes.
- Switching light/dark/system theme and then clicking nav, copy, filter, and form controls does not freeze the page.
- `/plugins/:name` deep links return the app shell and render the themed detail page.
- `POST /api/check` approves a known valid plugin repository, for example `https://github.com/callstackincubator/agent-skills`.
- `POST /api/check` records a failed status for an inaccessible or invalid repository.
- `GET /api/market` reflects approved and failed checks without waiting for GitHub Action state.
- 375px, 768px, 1024px, and desktop widths have no horizontal overflow, clipped buttons, or overlapping text.
- `npm run check` passes.
