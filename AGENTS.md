# AGENTS.md

## Project Direction

This repository is the MWE Codex plugin sharing marketplace. The accepted product direction is the Perspective marketplace version: a dark-first glassmorphism interface with a complete light theme, rounded typography, MWE branding, and clear Codex Desktop / Codex CLI install affordances.

## Design System Requirements

- Keep the site visually unified across every route. Do not let secondary pages drift back to the older plain Codex/tooling style.
- All user-facing pages must render inside the current `perspective-app` / `perspective-page` visual system unless a future redesign explicitly replaces the whole system.
- Use the established Perspective tokens in `styles.css`: `--ps-heading`, `--ps-body`, `--ps-brand`, `--ps-border`, `--ps-glass`, `--ps-neutral-*`, and related light/dark overrides.
- Default theme is dark, with a polished light theme. Theme changes must update styling without causing route state loss or interaction freezes.
- Typography should stay rounded and friendly, using the current Nunito/Open Sans-oriented stack. Avoid mixing in harsher system-only headings on new pages.
- Use Lucide icons for controls and status. Do not introduce emoji as UI icons.
- Keep cards, panels, forms, code boxes, and sidebars glass-like and consistent with the homepage. Avoid plain white/black blocks unless scoped as intentional code or terminal surfaces.
- All page frames should follow the homepage layout system and use the available wide canvas well; standard content pages should not collapse into narrow old-style panels unless the content itself requires a focused reading width.
- Marketplace plugin `description` and `longDescription` fields must be written in Chinese. Technical names such as Codex, GitHub, MCP, CLI, API, Release, IMAP, or plugin/product names may remain in English.
- Preserve accessible focus rings, visible labels, 44px minimum interactive targets, and keyboard-friendly navigation.

## Current Routes

- `/`: marketplace discovery homepage.
- `/reviews`: submission/review progress board.
- `/submit`: web submission form; users should not need to manually create GitHub issues.
- `/install`: Codex Desktop marketplace link and Codex CLI command guidance.
- `/about`: review rules and safety boundaries.
- `/plugins/:name`: plugin detail page, including owner/maintainer-only removal request entry.

When adding a page, update this list and verify the new page uses the same theme shell, navigation, spacing, and button language as the homepage.

## Marketplace Copy Rules

- Use `MWE Codex插件共享市场` for the product/brand title.
- Distinguish Codex Desktop actions from Codex CLI actions with separate buttons and icons.
- The Marketplace link is the integrated repository URL: `https://github.com/mwe-support/mwe-codex-plugins-marketplace`.
- The CLI command is: `codex plugin marketplace add https://github.com/mwe-support/mwe-codex-plugins-marketplace`.

## Interaction Rules

- Deleting a plugin from the marketplace must go through a removal request and must be limited to the plugin GitHub repository owner or maintainer. The workflow must verify this before removing plugin files or snapshots.
- Duplicate plugin submissions are detected by normalized GitHub repository URL and should return a clear user-facing message instead of creating another review issue.
- Theme switching must not rebuild the whole app or reset the current route. Update theme attributes and pressed states in place.
- Copy buttons should show a toast and remain usable after theme changes and route changes.
- Search/filter interactions should keep stable keys and avoid rendering unnecessary lists.
- Form validation should use visible labels, helper text, field-local errors, disabled loading states, and success/error feedback.

## Verification Checklist

Before committing UI changes, check:

- All routes listed above visually match the Perspective homepage in both dark and light themes, with page frames stretched to the approved wide layout where appropriate.
- Plugin marketplace descriptions are Chinese and pass `node scripts/marketplace.mjs validate`.
- Duplicate submit and plugin removal flows are covered by server/API or rendered-browser checks.
- Switching light/dark/system theme and then clicking nav, copy, filter, and form controls does not freeze the page.
- `/plugins/:name` deep links return the app shell and render the themed detail page.
- 375px, 768px, 1024px, and desktop widths have no horizontal overflow, clipped buttons, or overlapping text.
- `node --check app.js`, `node --check server.mjs`, `node scripts/marketplace.mjs validate`, and `node scripts/marketplace.mjs sync --check` pass.
