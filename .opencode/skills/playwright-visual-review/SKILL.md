---
name: playwright-visual-review
description: Automates visual regression testing via Playwright. Compares screenshots against baselines, runs DOM diffs, accessibility checks, and classifies visual changes. Posts structured results to GitHub.
license: MIT
compatibility: opencode
metadata:
  audience: playwright-agent
  workflow: visual-qa
---
## Core Purpose

Detect visual regressions in web UIs before they reach production. Compare screenshots, DOM structure, and accessibility against known-good baselines.

## Workflow

### 1. Baseline Check
- Does a baseline screenshot exist for this route/viewport?
- NO → Capture baseline, mark as NEW, exit with NEEDS_HUMAN_REVIEW
- YES → Proceed to comparison

### 2. Capture Current State
- Render page at configured viewports (default: 1280x720, 375x812)
- Take full-page screenshot
- Capture DOM snapshot (simplified HTML structure)
- Extract accessibility tree
- Run axe-core for WCAG violations

### 3. Diff Analysis
- **Pixel Diff:** pixelmatch with configurable threshold (default: 0.1%)
- **DOM Diff:** structural comparison (added/removed/changed elements)
- **Text Diff:** visible text content comparison
- **A11y Diff:** accessibility tree changes

### 4. Classification

| Class | Criteria | Action |
|-------|----------|--------|
| REGRESSION | Previously passing, now visually different | BLOCK merge |
| IMPROVEMENT | Previously broken, now matches baseline | APPROVE |
| NEW_BASELINE | No baseline exists for this view | NEEDS REVIEW |
| COSMETIC | Pixel diff < 0.5%, no DOM change | WARNING only |
| A11Y_REGRESSION | New accessibility violations | BLOCK merge |

### 5. Report Generation
Generate structured report at `.opencode/reports/visual-qa/<timestamp>.json`:
```json
{
  "timestamp": "ISO8601",
  "commit": "<sha>",
  "route": "/path",
  "viewport": "1280x720",
  "classification": "REGRESSION|IMPROVEMENT|...",
  "pixel_diff_percent": 0.0,
  "dom_changes": 0,
  "a11y_violations": [],
  "screenshot_diff_path": "<path>",
  "recommendation": "block|warn|approve|review"
}
```

### 6. GitHub Integration (Orchestrator-Gated)
Post structured comment to PR/Issue ONLY when explicitly approved by the orchestrator or owner:
- Classification badge
- Side-by-side screenshot comparison (if regression)
- Accessibility violation summary
- Recommendation

**Never post GitHub comments autonomously.** The orchestrator or owner must explicitly approve each external write action.

## Accessibility Standards (WCAG 2.2 AA)

Automated axe checks are a partial verification only — they detect ~30-40% of accessibility issues. Manual or agent-assisted keyboard testing is still required.

- **axe configuration**: Run `@axe-core/playwright` with WCAG 2.2 AA tag set (`wcag22aa`, `wcag21aa`, `best-practice`)
- **Known axe limitations**: axe cannot verify: focus order logic, meaningful alt text quality, link purpose clarity, error recovery usability, or content readability. These require human or agent judgment.
- **Color contrast**: 4.5:1 (normal text), 3:1 (large text), 3:1 (UI components and graphical objects — WCAG 2.2)
- All interactive elements keyboard accessible with visible focus indicators
- All images have alt text (decorative images: `alt=""`)
- Form inputs have associated labels
- Heading hierarchy is logical (no skipped levels)
- ARIA attributes are valid
- **Focus order**: Tab order must follow visual/logical reading order (axe cannot verify this — separate check required)
- **Reduced motion**: Verify `prefers-reduced-motion: reduce` is respected (no autoplay, instant transitions)

## Accessibility Reporting

- axe violations are reported as `A11Y_REGRESSION` only when they represent new issues against a known baseline
- When no baseline exists, accessibility violations are flagged as `NEEDS_HUMAN_REVIEW` — never auto-approved
- **Do NOT claim full accessibility compliance** based on axe alone. The report must state: "Automated axe scan complete. Manual keyboard testing and screen reader testing recommended for full WCAG 2.2 AA compliance."
- Never post GitHub comments without explicit orchestrator approval or owner gate pass

## Performance (Slow Hardware Mode)
- Single viewport: 1280x720
- Disable animations (prefers-reduced-motion)
- Wait for network idle (timeout: 30s)
- Skip video recording
- Limit to 5 screenshots per run
