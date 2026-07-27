---
name: frontend-design-build
description: Designs and implements distinctive, intentional web UI. Discovers existing design systems before creating new. Distinguishes between greenfield, existing-system, review-only, and bugfix scenarios. Requires owner approval before new visual direction, dependencies, or component library changes.
license: Apache-2.0
compatibility: opencode
metadata:
  audience: frontend-design-agent
  workflow: design-build
  activation: conditional
  derived_from: anthropics/skills/skills/frontend-design
  upstream_commit: 2235be7c60b551f5de82ade908fd3816455afcda
  adapted: true
  runtime_network_fetch: false
---

# Frontend Design Build

## Core Principle

Design distinctive, intentional UI that belongs to the specific product and its users. Before designing, discover what already exists. Reuse over replace. Implement only after approval. Never self-review — independent review is mandatory.

## When To Use

### Activate for:
- Creating a landing page, marketing site, or product page
- Creating a dashboard or admin interface
- Creating or redesigning a significant UI surface
- Implementing a wireframe or visual mockup
- Building new UI with React, Vue, Svelte, Astro, or vanilla HTML/CSS
- Explicit visual redesign with documented objectives

### Do NOT activate for:
- CLI-only projects
- Backend-only services
- Libraries without UI components
- Infrastructure without user interfaces
- Pure accessibility review (use ux-flow-review)
- Pure code review (use review-agent)
- Small CSS corrections without design mandate (use build agent)
- Playwright-only usage without real UI surface
- Static documentation without interactive flows

## Scenario Classification

Before any work, classify the situation into exactly one scenario:

### A. Existing Product With Design System
The project has `tailwind.config.*`, `theme.ts`, CSS custom properties, Storybook, component library, brand guidelines, or documented design tokens.

**Rule:** Discover first. Map tokens. Only extend — never create a parallel system.

### B. Existing Product Without Documented System
The project has UI code but no centralized design tokens or component documentation.

**Rule:** Extract. Audit existing patterns. Document findings as `ASSUMPTION`. Propose token consolidation before new work.

### C. Greenfield Frontend
No existing UI code. Starting from scratch.

**Rule:** Design from brief. Create token system. Document all assumptions. Flag missing brief elements.

### D. Pure Review Request
The task is analysis only — no implementation.

**Rule:** Delegate to `ux-flow-review` + `ui-design-system-review`. This skill does NOT activate.

### E. Small UI Bugfix Without Redesign
Single CSS fix, typo correction, or minor adjustment — no design mandate.

**Rule:** Delegate to `build` agent. This skill does NOT activate.

## Existing System First

Before any design proposal, discover:

| Layer | What to Search | Files to Check |
|-------|---------------|----------------|
| Design Tokens | CSS custom properties, Tailwind config, theme files | `:root { --* }`, `tailwind.config.*`, `theme.ts`, `tokens.json` |
| Component Library | MUI, Chakra, Bootstrap, shadcn/ui, Ant, custom | `package.json` dependencies, `components/`, `ui/` |
| Component Docs | Storybook, style guide, README | `.storybook/`, `*.stories.*`, `docs/components/` |
| Brand | Brand colors, logo, typography, guidelines | `DESIGN.md`, `BRAND.md`, `brand/`, Figma links in README |
| Layout System | Grid, breakpoints, spacing scale, container | CSS files, layout components, `Container`, `Layout` |
| Dark Mode | Theme switching, `prefers-color-scheme` | `color-scheme`, `data-theme`, `ThemeProvider` |
| Motion | Animation tokens, transition scale | `transition-*`, `motion-safe`, `prefers-reduced-motion` |
| Form Patterns | Input, validation, error, submit patterns | Form components, validation libraries |
| Navigation | Header, sidebar, mobile menu, breadcrumb | Nav components, routing config |
| Intentional Deviations | Documented exceptions from the system | ADRs, comments, design system README |

### Priority Rule (Strict Order)

```
1. REUSE existing component → Is there already a component for this?
2. EXTEND existing component → Can an existing component accept a variant/new prop?
3. ABSTRACT common pattern → Do 3+ places repeat the same unshared pattern?
4. CREATE new component   → Only with documented justification and owner approval
```

**Never** silently create a second parallel design system.

## Handling Missing Briefing

Missing information MUST NOT be invented as fact. Every assumption must be explicit:

```markdown
ASSUMPTION: <what is assumed, e.g., "target audience is shelter staff">
EVIDENCE: <what observable fact suggests this, e.g., "README mentions 'Tierheim' and all routes are admin-only">
IMPACT: <what changes if wrong, e.g., "visual tone and complexity would shift">
OWNER_CONFIRMATION_REQUIRED: <true | false>
```

Personas, user research, analytics data, or brand requirements MUST NOT be invented.

## Design Plan (Before Code)

Before implementation, produce a compact design plan covering:

```markdown
## Design Plan

### Product / Surface
[What page or feature is being designed]

### Documented Audience
[From README, docs, issues — not invented]

### Primary Task
[The single most important thing a user needs to accomplish on this page]

### Existing Design System
[What tokens, components, patterns already exist. "None found" if absent.]

### Design Direction
[Concise description of the visual approach — grounded in the product's subject matter]

### Color Tokens
| Token | Hex | Usage |
|-------|-----|-------|
| --color-primary | #XXXXXX | Primary actions, brand |
| ... (4–6 tokens total) | | |

### Typography Roles
| Role | Family | Weight | Size | Notes |
|------|--------|--------|------|-------|
| Display | ... | ... | ... | Used sparingly |
| Body | ... | ... | ... | Main text |
| Utility | ... | ... | ... | Captions, data |

### Layout Principle
[One-sentence description: "Single-column card feed with sticky header" or "Two-column dashboard with collapsible sidebar"]

### Signature Element
[The ONE unique element this page will be remembered by]

### Desktop Behavior
[Layout at >= 1024px]

### Mobile Behavior
[Layout at <= 375px]

### States
- **Loading:** [Skeleton, spinner, or progressive reveal]
- **Empty:** [Zero-state message and action]
- **Error:** [Error display and recovery path]
- **Success:** [Confirmation and next step]
- **Keyboard Focus:** [Visible focus ring, focus order]
- **Reduced Motion:** [No autoplay, instant transitions]

### Open Assumptions
- [ASSUMPTION] ...
- [ASSUMPTION] ...
```

## Owner / Approval Gate

Explicit owner confirmation is REQUIRED before:

| Gate | When |
|------|------|
| New Visual Direction | Shifting brand, palette, or typography identity |
| New External Fonts | Google Fonts, Adobe Fonts, custom font files |
| New Images / CDN | Unsplash, image services, new asset domains |
| New NPM Dependency | Any new package in `dependencies` or `devDependencies` |
| New Component Library | Adding MUI, Chakra, Bootstrap, shadcn/ui, etc. |
| Component Replacement | Removing or rewriting existing shared components |
| Navigation Restructure | Changing routes, IA, or primary navigation |
| Token Migration | Renaming or deleting existing design tokens |

Proceed ONLY after explicit `APPROVED` for each applicable gate.

## Implementation Rules

### Mandatory
- **Semantic HTML**: `<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<footer>`, `<button>`, `<a>` — use native elements before ARIA
- **Visible focus**: Every interactive element has a visible `:focus-visible` ring. Never `outline: none` without replacement
- **Keyboard operable**: Tab order is logical, focus trapped in modals, Enter/Space activates
- **prefers-reduced-motion**: Respect `@media (prefers-reduced-motion: reduce)` — no autoplay animations, instant transitions
- **Responsive**: Works on 375px–1280px+. Test both. Use flex/grid, not fixed widths
- **Real content or labeled placeholder**: Use actual copy or marked placeholder (`[Image: team photo]`), never lorem ipsum as final content
- **Clear action labels**: "Save changes" not "Submit". "Delete account" not "OK"
- **Explicit empty/error/success states**: Every interactive surface handles all states
- **No fake functionality**: Buttons that do nothing must be labeled as disabled or placeholder, not silently broken
- **No fake APIs**: Don't present mock data as production-ready without explicit marking
- **No silent external requests**: All network activity must be visible in code and documented
- **No uncontrolled global CSS**: Use scoped styles, CSS modules, or component-level styles

### Prohibited
- Modifying existing CSS custom properties without owner approval
- Overwriting third-party component library core styles globally
- Adding unnecessary heavy UI dependencies (moment.js for dates, lodash for one function)
- Shipping placeholder content as final without owner confirmation
- Self-claiming "UX complete" or "accessibility complete" or "production-ready"
- Modifying production infrastructure, secrets, or deployment config

## Completion Boundary

This skill's scope ends at implementation. The following claims belong to independent review steps and MUST NOT be made by this skill:

```
❌ "UX fully passed"
❌ "Accessibility fully verified"
❌ "Visual regression excluded"
❌ "Production ready"
❌ "Design system compliant"
```

These are owned by:
- **UX Flow Review** → user journey, navigation, interaction quality
- **UI Design System Review** → component consistency, token compliance, states
- **Playwright Visual Review** → visual regression, DOM diff, axe/a11y scan
- **Owner Approval Gate** → business acceptance, deployment decision

## External Source Attribution

This skill is adapted from `anthropics/skills/skills/frontend-design` with governance additions specific to the OpenCode Agent Ecosystem.

Changes from upstream:
- Added Scenario Classification (A–E) with routing rules
- Added Existing-System-First discovery workflow
- Added Owner/Approval Gate integration
- Added structured Design Plan requirement before code
- Added Assumption marking for missing briefs
- Added strict implementation rules (semantic HTML, focus, states)
- Added explicit Completion Boundary separating design/build from review
- Prohibited self-review and self-approval of UX/accessibility/production claims
- Added activation/deactivation rules for detector integration
- No runtime network fetch — all references are local or pinned

## Security Boundaries

1. **Owner approval before new dependencies**: No new npm packages without explicit gate.
2. **No external font/image CDN without approval**: Fonts and images must be local or approved.
3. **No runtime network fetch**: This skill contains no instructions to download content at runtime.
4. **Redaction**: Never include secrets, tokens, API keys, or PII in design plans or code. Use `[REDACTED]` for any observed credential-like values.
5. **No production data access**: Design against mock data unless production access is explicitly granted.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| Task description | Yes | What to design/build |
| Target project files | Yes | Existing code, tokens, components |
| Design brief (if any) | Preferred | Visual direction, brand, constraints |
| Owner approval (for gates) | Conditional | Required for new direction, deps, libraries |

## Outputs

1. **Scenario classification** — A, B, C, D, or E with rationale
2. **Existing system audit** — What was discovered (or confirmed absent)
3. **Design plan** — Per template above (for A, B, C)
4. **Open assumptions** — Marked and explained
5. **Implemented code** — Only after owner approval gates pass
6. **Evidence for review** — File paths, states implemented, decisions made

## Completion Criteria

- [ ] Scenario correctly classified
- [ ] Existing system thoroughly discovered
- [ ] Design plan created and approved (for design work)
- [ ] All applicable owner approval gates passed
- [ ] Code follows implementation rules (semantic, focus, keyboard, responsive, states)
- [ ] Implementation is complete — all interactive states handled
- [ ] Evidence documented for independent review steps
- [ ] No self-review claims made (UX, accessibility, visual regression, production)
- [ ] Assumptions explicitly marked
- [ ] Output returned to orchestrator
