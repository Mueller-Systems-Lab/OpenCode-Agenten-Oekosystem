---
name: ux-flow-review
description: Analyzes user journeys, navigation, information architecture, UI states, and interaction flows for web, desktop, and mobile applications. Produces evidence-based UX findings with concrete acceptance criteria. Read-only — never modifies product files.
license: MIT
compatibility: opencode
metadata:
  audience: ux-review-agent
  workflow: review
  activation: conditional
---

# UX Flow Review

## Core Principle

Analyze real user flows through an application. Every finding must be evidence-based, reproducible, and tied to a specific user goal. No subjective aesthetic claims.

## When To Use

### Activate for:
- Interactive web applications (React, Vue, Svelte, Angular, Next.js, etc.)
- Desktop applications with UI
- Mobile applications
- Dashboards and admin interfaces
- Form-heavy workflows (onboarding, checkout, applications)
- Search, filter, and editing interfaces

### Do NOT activate for:
- CLI-only projects
- Backend-only services
- Libraries without UI
- Infrastructure without user interfaces
- Static documentation without interactive flows
- API tests using browser automation without real UI

## Mandatory Workflow

### Step 1: Read Product Requirements
- Identify existing product documentation, README, user stories, or PRD
- Extract stated user goals and target personas
- Document what the product claims to do

### Step 2: Derive Target Users
- From README, docs/, user stories, or issue descriptions
- DO NOT invent personas — only use what is documented
- If no user documentation exists, state this explicitly as a limitation

### Step 3: Determine Primary Tasks
- What is the main thing users need to accomplish?
- List 1-3 critical tasks
- Rank by importance based on documented priorities, not speculation

### Step 4: Identify Critical User Journey
- Select the highest-priority task
- Map the ideal path: start → intermediate states → success

### Step 5: Capture Start State
- What does the user see when they begin the task?
- Is the starting point clearly indicated?
- Are required prerequisites clear?

### Step 6: Capture Intermediate States
- What happens between start and completion?
- Are progress indicators present for multi-step flows?
- Can the user pause and resume?

### Step 7: Capture Error and Abandonment Paths
- What happens when validation fails?
- Is the error message actionable?
- Does focus move to the problem field?
- Can the user recover without starting over?

### Step 8: Capture Success State
- Is completion clearly confirmed?
- Does the user know what happens next?
- Is there an undo option for reversible actions?

### Step 9: Document Problems Reproducibly
- Every finding must include steps to reproduce
- Expected vs. actual behavior must be stated
- Multiple viewports if responsive is claimed

### Step 10: Classify Impact
- Use the standard severity scale: BLOCKER, HIGH, MEDIUM, LOW, OBSERVATION
- Base classification on user task impact, not personal preference

### Step 11: Formulate Acceptance Criteria
- Each finding must produce concrete, testable acceptance criteria
- Criteria must be verifiable by a Build Agent or Playwright test
- Example: "After clicking Submit with an empty required field, focus moves to that field within 200ms"

### Step 12: Declare Missing User Data
- If user research data is not available, state this explicitly
- "Without user testing data, severity is estimated from observable behavior only"
- Never claim user research was performed if it was not

### Step 13: Gate Before Implementation
- Findings are analysis, not implementation orders
- Build Agent requires Owner/Approval Gate before acting on findings
- UX agent does NOT approve implementation — it documents what should be verified

## Evidence Requirements

### Prohibited (Vague) Findings
```
❌ "The page is confusing."
❌ "Navigation could be better."
❌ "The form feels clunky."
```

### Required (Evidence-Based) Findings
```
✓ Finding: UX-004
✓ Severity: HIGH
✓ User Goal: Submit adoption application successfully
✓ Location: /application (375x812 viewport)
✓ Preconditions + Reproduction Steps + Expected + Actual + Impact
✓ Evidence: DOM reference, screenshot reference, reproducible flow
✓ Acceptance Criteria: 2-3 testable criteria
```

### Finding Template

Each finding must contain:
| Field | Required | Description |
|-------|----------|-------------|
| Finding ID | Yes | Unique identifier (UX-XXX) |
| Severity | Yes | BLOCKER, HIGH, MEDIUM, LOW, OBSERVATION |
| User Goal | Yes | What the user needs to accomplish |
| Location | Yes | Route, component, viewport if relevant |
| Preconditions | Yes | State before interaction |
| Reproduction Steps | Yes | Numbered, reproducible sequence |
| Expected Behavior | Yes | Measurable, observable expectation |
| Actual Behavior | Yes | Measurable, observable reality |
| Impact | Yes | Concrete consequence for the user |
| Evidence | Yes | File paths, DOM references, screenshot refs |
| Acceptance Criteria | Yes | Testable, verifiable criteria |
| Uncertainties | If any | Explicitly stated unknowns |

## Extended Review Rules

### URL and Deep-Link States
- Verify that filters, tabs, pagination, expanded panels, and modal states are reflected in the URL
- Back/Forward browser navigation must restore prior state correctly
- Deep-linked URLs must render the correct UI state (not reset to default)
- Shareable URLs must reconstruct the exact view state

### Clear Action Labels
- Buttons must describe the action, not generic commands: "Save changes" not "Submit", "Delete account" not "OK"
- Labels must remain consistent across the flow: "Publish" button → "Published" toast
- Menu options that open follow-up dialogs end with ellipsis: "Rename…", "Export…"
- Active voice preferred: "Install the CLI" not "The CLI will be installed"

### Focus on First Error
- On form submission failure, focus must move to the first field with a validation error
- Error messages must appear adjacent to the relevant field, not only in a summary banner
- Inline validation (on blur or after submission) must be announced via polite aria-live

### Unsaved Changes Protection
- Warn before navigation when form data could be lost
- Use `beforeunload` or framework-specific navigation guards
- The warning must be clear about what will be lost

### Mobile and Touch Flows
- Touch targets must be ≥ 44px on mobile (≥ 24px on desktop)
- `<input>` font size must be ≥ 16px on mobile to prevent iOS auto-zoom
- Touch-action: manipulation on interactive controls to prevent double-tap zoom
- Safe area insets respected via `env(safe-area-inset-*)`

### Recovery Paths
- Error states must include clear next steps, not just problem statements
- Example: "Your API key is incorrect. Generate a new key in your account settings." not "Invalid API key"
- Empty states must invite action: "No projects yet. Create your first project."
- Irreversible actions must have confirmation or undo within a safe window

### Locale-Aware Content
- Dates, times, numbers, and currencies must use `Intl.*` or locale-aware formatters
- Language detection via `Accept-Language` header and `navigator.languages`, not IP/geo
- Brand names, code tokens, and technical identifiers must use `translate="no"`

## Severity Classification

| Severity | Criteria |
|----------|----------|
| **BLOCKER** | Primary task cannot be completed, or significant harm (data loss, financial loss, safety) is likely |
| **HIGH** | Substantial risk of misoperation, high abandonment probability, or WCAG 2.2 AA accessibility barrier |
| **MEDIUM** | Noticeable friction or inconsistency; workaround exists but degrades experience |
| **LOW** | Minor friction without significant task impairment |
| **OBSERVATION** | Note or hypothesis without sufficient evidence for a formal finding; requires further investigation |

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| Product documentation | Preferred | README, user stories, PRD, issue descriptions |
| Source code | Yes | Component files, routes, templates, views |
| Style/design documentation | Preferred | Design system docs, Figma links, brand guidelines |
| Existing user research | If available | Usability test results, analytics, support tickets |

## Outputs

Structured findings returned to the orchestrator. The UX agent does NOT write report files. If persistence is required, the orchestrator or an authorized report-writer handles it.

## Security Boundaries

1. **Read-only**: Never modify product files, CSS, components, or configuration.
2. **No report writes**: Do not write to `.opencode/reports/ux-ui/`. Return findings to orchestrator.
3. **No user data invention**: Never claim user research, testing, or analytics data that does not exist.
4. **No autonomous approval**: Findings are not implementation orders. Build Agent must pass Owner/Approval Gate.
5. **Evidence before claims**: Every finding must reference specific files, components, or states.
6. **No Playwright duplication**: Do not perform pixel diffs, DOM diffs, or visual regression. Delegate to Playwright agent for technical verification.
7. **Redaction**: NEVER include secrets, tokens, API keys, or PII in findings. If a referenced file contains secrets, reference the file path only. Replace any observed credential-like values with `[REDACTED]`. Watch for patterns: `ghp_*`, `sk-*`, `api_key=*`, `token=*`, `Authorization: Bearer *`.

## Completion Criteria

- [ ] All relevant product documentation read
- [ ] Primary user tasks identified (from documentation, not invented)
- [ ] Critical journey mapped from start to success
- [ ] All interaction states covered (default, loading, empty, error, success)
- [ ] Every finding has: ID, severity, user goal, reproduction steps, expected/actual, evidence, acceptance criteria
- [ ] No subjective aesthetic claims present
- [ ] Missing data explicitly declared
- [ ] Findings returned to orchestrator, not written to filesystem
