import assert from "node:assert/strict"
import test from "node:test"

let contract = null
let moduleLoadError = null
try {
  contract = await import("../../scripts/lib/user-action-handoff.mjs")
} catch (error) {
  moduleLoadError = error
}

const noAction = () => contract.createUserActionHandoff([])

function evidence(overrides = {}) {
  return {
    capability_checked: true,
    effect: "LOCAL_WRITE",
    tool_available: false,
    tool_authenticated: false,
    permission_available: false,
    action_authorized: false,
    alternatives_checked: true,
    alternative_capability_available: false,
    alternative_capability_authorized: false,
    suitable_agent_available: false,
    personal_decision_required: false,
    physical_presence_required: false,
    manual_security_policy_required: false,
    evidence: ["Die Capability-Prüfung des Fixtures wurde ausgeführt."],
    ...overrides,
  }
}

function action(overrides = {}) {
  return {
    id: "fixture-action",
    title: "Gerät verbinden",
    reason_code: "PHYSICAL_ACTION_REQUIRED",
    reason: "Die Hardware muss physisch mit dem Gerät verbunden werden.",
    reason_evidence: evidence({ physical_presence_required: true }),
    obligation: "required",
    source_category: "non_delegable_user_action",
    status: "pending",
    platform: "physical",
    target: { description: "Testgerät" },
    instructions: ["Verbinde das Testgerät mit der Stromversorgung."],
    sort_order: 10,
    ...overrides,
  }
}

function githubMerge(overrides = {}) {
  return action({
    id: "github-merge",
    title: "Pull Request zusammenführen",
    reason_code: "NON_DELEGABLE_OWNER_APPROVAL",
    reason: "Der Merge benötigt die persönliche Freigabe des Repository-Eigentümers.",
    reason_evidence: evidence({
      effect: "MERGE",
      tool_available: true,
      tool_authenticated: true,
      permission_available: true,
      personal_decision_required: true,
    }),
    platform: "github_web",
    target: {
      repository: "xxammaxx/OpenCode-Agenten-Oekosystem",
      pull_request: 123,
    },
    instructions: [],
    web_ui: {
      label_source: "official_docs",
      steps: [
        { order: 1, control_type: "tab", label: "Pull requests", instruction: "Öffne den sichtbaren Reiter." },
        { order: 2, control_type: "link", label: "#123", instruction: "Öffne den Pull Request." },
        { order: 3, control_type: "button", label: "Merge pull request", instruction: "Starte den Merge-Dialog." },
        { order: 4, control_type: "button", label: "Confirm merge", instruction: "Bestätige den Merge.", confirmation: true },
      ],
      abort_condition: "Brich ab, wenn Checks fehlschlagen oder der Zielbranch nicht sichtbar ist.",
    },
    ...overrides,
  })
}

function requireContract() {
  assert.equal(moduleLoadError, null, `contract module must load: ${moduleLoadError?.message}`)
  assert.ok(contract)
}

function issueCodes(result) {
  return result.map((issue) => issue.code)
}

test("positive: no action renders the exact mandatory final section", () => {
  requireContract()
  const rendered = contract.renderUserActionHandoff(noAction())
  assert.equal(rendered, "## Erforderliche Aktion durch den Nutzer\n\nKeine Aktion durch den Nutzer erforderlich.")
})

test("positive: physical action is concrete and admissible", () => {
  requireContract()
  const handoff = contract.createUserActionHandoff([action()])
  assert.deepEqual(contract.validateUserActionHandoff(handoff), [])
  assert.match(contract.renderUserActionHandoff(handoff), /Verbinde das Testgerät/)
})

test("positive: missing permission after capability check is admissible", () => {
  requireContract()
  const handoff = contract.createUserActionHandoff([action({
    id: "permission",
    title: "Geschützte Freigabe erteilen",
    reason_code: "MISSING_PERMISSION",
    reason: "Das authentifizierte Werkzeug besitzt die erforderliche Berechtigung nicht.",
    reason_evidence: evidence({
      effect: "PUSH",
      tool_available: true,
      tool_authenticated: true,
      permission_available: false,
    }),
    platform: "manual",
    target: { description: "Geschütztes Testziel" },
    instructions: ["Erteile die ausdrücklich benannte Berechtigung für das Testziel."],
  })])
  assert.deepEqual(contract.validateUserActionHandoff(handoff), [])
})

test("positive: GitHub owner merge renders numbered visible web controls", () => {
  requireContract()
  const rendered = contract.renderUserActionHandoff(contract.createUserActionHandoff([githubMerge()]))
  assert.match(rendered, /Repository `xxammaxx\/OpenCode-Agenten-Oekosystem`/)
  assert.match(rendered, /Pull Request `#123`/)
  assert.match(rendered, /1\. .*Pull requests/)
  assert.match(rendered, /3\. .*Merge pull request/)
  assert.match(rendered, /4\. .*Confirm merge/)
  assert.match(rendered, /offiziellen Dokumentation.*nicht.*live geprüft/)
  assert.doesNotMatch(rendered, /\bgh pr merge\b|\bgit merge\b/)
})

test("positive: multiple actions are deduplicated and stably sorted", () => {
  requireContract()
  const second = action({
    id: "b",
    title: "Zweite Aktion",
    target: { description: "Zweites Testgerät" },
    reason_evidence: evidence({ effect: "PHYSICAL_SECOND", physical_presence_required: true }),
    sort_order: 20,
  })
  const first = action({ id: "a", title: "Erste Aktion", sort_order: 5 })
  const duplicate = action({ id: "a", title: "Doppelte Formulierung", sort_order: 30 })
  const handoff = contract.createUserActionHandoff([second, duplicate, first])
  assert.deepEqual(handoff.actions.map((entry) => entry.id), ["a", "b"])
})

test("positive: German report permits official English GitHub labels", () => {
  requireContract()
  const report = contract.appendUserActionHandoff("# Abschlussbericht\n\n## Status\n\nErledigt.", contract.createUserActionHandoff([githubMerge()]))
  assert.deepEqual(contract.validateCompletionMarkdown(report), [])
  assert.match(report, /Merge pull request/)
})

test("positive: missing gh may be explained when valid web guidance is present", () => {
  requireContract()
  const candidate = githubMerge({
    reason: "Das Werkzeug gh war nicht verfügbar; die persönliche Freigabe bleibt über die geprüfte GitHub-Weboberfläche möglich.",
  })
  const report = contract.renderUserActionHandoff(contract.createUserActionHandoff([candidate]))
  assert.deepEqual(contract.validateCompletionMarkdown(report), [])
})

test("positive: fenced contract examples do not create duplicate report sections", () => {
  requireContract()
  const source = "# Bericht\n\n```markdown\n## Erforderliche Aktion durch den Nutzer\n\nKeine Aktion durch den Nutzer erforderlich.\n```"
  const report = contract.appendUserActionHandoff(source, noAction())
  assert.deepEqual(contract.validateCompletionMarkdown(report), [])
})

test("negative: explicit non-array actions are never normalized to empty", () => {
  requireContract()
  assert.throws(() => contract.createUserActionHandoff("malformed-actions"), /ACTIONS_INVALID/)
  assert.throws(() => contract.createUserActionHandoff({ malformed: true }, { validate: false }), /ACTIONS_INVALID/)
})

test("negative: unknown top-level handoff fields fail closed", () => {
  requireContract()
  const handoff = { ...noAction(), unexpected: true }
  assert.ok(issueCodes(contract.validateUserActionHandoff(handoff)).includes("UNKNOWN_FIELD"))
})

test("negative: authorized commit cannot be delegated", () => {
  requireContract()
  const candidate = action({
    id: "commit",
    title: "Änderungen committen",
    reason_code: "MISSING_AUTHORIZATION",
    reason_evidence: evidence({
      effect: "LOCAL_COMMIT",
      tool_available: true,
      tool_authenticated: true,
      permission_available: true,
      action_authorized: true,
    }),
  })
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("ACTION_CAPABILITY_AVAILABLE"))
})

test("negative: authorized PR connector prevents delegation", () => {
  requireContract()
  const candidate = githubMerge({
    id: "create-pr",
    title: "Pull Request erstellen",
    reason_code: "MISSING_AUTHORIZATION",
    reason_evidence: evidence({
      effect: "DRAFT_PR_UPDATE",
      tool_available: true,
      tool_authenticated: true,
      permission_available: true,
      action_authorized: true,
    }),
  })
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("ACTION_CAPABILITY_AVAILABLE"))
})

test("negative: missing gh is not a gap when an authorized connector exists", () => {
  requireContract()
  const candidate = githubMerge({
    reason_code: "RESOURCE_UNREACHABLE",
    reason_evidence: evidence({
      effect: "DRAFT_PR_UPDATE",
      alternatives_checked: true,
      alternative_capability_available: true,
      alternative_capability_authorized: true,
    }),
  })
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("ALTERNATIVE_CAPABILITY_AVAILABLE"))
})

test("negative: GitHub CLI-only action is rejected", () => {
  requireContract()
  const candidate = githubMerge({
    web_ui: {
      label_source: "official_docs",
      steps: [{ order: 1, control_type: "command", label: "gh pr merge 123", instruction: "Führe gh pr merge 123 aus." }],
      abort_condition: "Brich bei einem Fehler ab.",
    },
  })
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("GITHUB_CLI_ONLY"))
})

test("negative: Markdown-only GitHub CLI guidance is rejected", () => {
  requireContract()
  const markdown = `# Bericht

## Erforderliche Aktion durch den Nutzer

### Pull Request zusammenführen

**Warum diese Aktion nicht durch das Agentensystem ausgeführt werden konnte:**
Eine persönliche Freigabe fehlt.

**Ziel:** Repository \`owner/repo\`, Pull Request \`#123\`

1. Führe \`gh pr merge 123\` aus.`
  assert.ok(issueCodes(contract.validateCompletionMarkdown(markdown)).includes("GITHUB_CLI_ONLY"))
})

test("negative: path-qualified and wrapped GitHub CLI guidance is rejected", () => {
  requireContract()
  for (const instruction of [
    "Führe /usr/bin/gh pr merge 123 aus.",
    "Führe sudo gh pr merge 123 aus.",
    "Führe command git merge feature aus.",
  ]) {
    const candidate = githubMerge()
    candidate.web_ui.steps[2].instruction = instruction
    assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("GITHUB_CLI_ONLY"))
  }
  const markdown = "# Bericht\n\n## Erforderliche Aktion durch den Nutzer\n\n### Merge\n\n**Warum diese Aktion nicht durch das Agentensystem ausgeführt werden konnte:**  \nEine persönliche Freigabe fehlt.\n\n**Ziel:** Repository `owner/repo`, Pull Request `#123`\n\n1. Führe `/usr/bin/gh pr merge 123` aus."
  assert.ok(issueCodes(contract.validateCompletionMarkdown(markdown)).includes("GITHUB_CLI_ONLY"))
})

test("negative: missing final section is rejected", () => {
  requireContract()
  assert.ok(issueCodes(contract.validateCompletionMarkdown("# Bericht\n\n## Status\n\nErledigt.")).includes("SECTION_MISSING"))
})

test("negative: English final section is rejected", () => {
  requireContract()
  const markdown = "# Report\n\n## Required user action\n\nNo user action required."
  assert.ok(issueCodes(contract.validateCompletionMarkdown(markdown)).includes("SECTION_TITLE_INVALID"))
})

test("negative: English body under the canonical heading is rejected", () => {
  requireContract()
  const markdown = "# Bericht\n\n## Erforderliche Aktion durch den Nutzer\n\nNo user action required."
  const codes = issueCodes(contract.validateCompletionMarkdown(markdown))
  assert.ok(codes.includes("LANGUAGE_INVALID"))
  assert.ok(codes.includes("EMPTY_STATE_REQUIRED"))
})

test("negative: deviating heading is rejected", () => {
  requireContract()
  const markdown = "# Bericht\n\n## Aktion des Nutzers\n\nKeine Aktion durch den Nutzer erforderlich."
  assert.ok(issueCodes(contract.validateCompletionMarkdown(markdown)).includes("SECTION_TITLE_INVALID"))
})

test("negative: canonical and deviating headings cannot coexist", () => {
  requireContract()
  const markdown = "# Bericht\n\n## Required user action\n\nIgnore.\n\n## Erforderliche Aktion durch den Nutzer\n\nKeine Aktion durch den Nutzer erforderlich."
  assert.ok(issueCodes(contract.validateCompletionMarkdown(markdown)).includes("SECTION_TITLE_INVALID"))
})

test("negative: standard sentence and real action conflict", () => {
  requireContract()
  const markdown = "# Bericht\n\n## Erforderliche Aktion durch den Nutzer\n\nKeine Aktion durch den Nutzer erforderlich.\n\n### Trotzdem\n\nBitte handeln."
  assert.ok(issueCodes(contract.validateCompletionMarkdown(markdown)).includes("EMPTY_STATE_CONFLICT"))
})

test("negative: optional recommendation is not a required action", () => {
  requireContract()
  const candidate = action({ obligation: "optional", source_category: "recommendation" })
  const codes = issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false })))
  assert.ok(codes.includes("ACTION_NOT_REQUIRED"))
  assert.ok(codes.includes("SOURCE_CATEGORY_INVALID"))
})

test("negative: residual risk is not a user action", () => {
  requireContract()
  const candidate = action({ source_category: "residual_risk" })
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("SOURCE_CATEGORY_INVALID"))
})

test("negative: missing reason code is rejected", () => {
  requireContract()
  const candidate = action()
  delete candidate.reason_code
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("REASON_CODE_REQUIRED"))
})

test("negative: missing capability evidence is rejected", () => {
  requireContract()
  const candidate = action()
  delete candidate.reason_evidence
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("CAPABILITY_EVIDENCE_REQUIRED"))
})

test("negative: already executed action is rejected", () => {
  requireContract()
  const candidate = action({ status: "executed" })
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("ACTION_ALREADY_EXECUTED"))
})

test("negative: suitable alternative agent prevents delegation", () => {
  requireContract()
  const candidate = action({
    reason_code: "RESOURCE_UNREACHABLE",
    reason_evidence: evidence({ suitable_agent_available: true }),
  })
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("SUITABLE_AGENT_AVAILABLE"))
})

test("negative: GitHub steps require visible labels", () => {
  requireContract()
  const candidate = githubMerge()
  candidate.web_ui.steps[2].label = ""
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("WEB_UI_LABEL_REQUIRED"))
})

test("negative: GitHub steps require a contiguous order and explicit abort instruction", () => {
  requireContract()
  const candidate = githubMerge()
  candidate.web_ui.steps[1].order = 8
  candidate.web_ui.abort_condition = "Checks müssen grün sein."
  const codes = issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false })))
  assert.ok(codes.includes("WEB_UI_ORDER_INVALID"))
  assert.ok(codes.includes("WEB_UI_ABORT_REQUIRED"))
})

test("negative: GitHub confirmation must follow navigation and action controls", () => {
  requireContract()
  const candidate = githubMerge()
  candidate.web_ui.steps = [
    { order: 1, control_type: "button", label: "Confirm merge", instruction: "Bestätige den Merge.", confirmation: true },
    { order: 2, control_type: "tab", label: "Pull requests", instruction: "Öffne den sichtbaren Reiter." },
    { order: 3, control_type: "button", label: "Merge pull request", instruction: "Starte den Merge-Dialog." },
  ]
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("WEB_UI_SEQUENCE_INVALID"))
})

test("negative: GitHub steps require visible target navigation", () => {
  requireContract()
  const candidate = githubMerge()
  candidate.web_ui.steps = [
    { order: 1, control_type: "button", label: "Merge pull request", instruction: "Starte den Merge-Dialog." },
    { order: 2, control_type: "button", label: "Confirm merge", instruction: "Bestätige den Merge." },
  ]
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("WEB_UI_NAVIGATION_REQUIRED"))
})

test("negative: an arbitrary button is not a confirmation", () => {
  requireContract()
  const candidate = githubMerge()
  candidate.web_ui.steps = [
    { order: 1, control_type: "tab", label: "Pull requests", instruction: "Öffne den sichtbaren Reiter." },
    { order: 2, control_type: "button", label: "Cancel", instruction: "Schließe den Dialog." },
  ]
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("WEB_UI_CONFIRMATION_REQUIRED"))
})

test("negative: known GitHub target rejects placeholders", () => {
  requireContract()
  const candidate = githubMerge({ target: { repository: "owner/repo", pull_request: "<PR>" } })
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("PLACEHOLDER_FORBIDDEN"))
})

test("negative: a GitHub target cannot bypass github_web as manual CLI guidance", () => {
  requireContract()
  const candidate = action({
    platform: "manual",
    target: { repository: "owner/repo", pull_request: 1 },
    instructions: ["Führe gh pr merge 1 aus."],
  })
  const codes = issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false })))
  assert.ok(codes.includes("GITHUB_WEB_REQUIRED"))
  assert.ok(codes.includes("GITHUB_CLI_ONLY"))
})

test("negative: external handoff action order must already be canonical", () => {
  requireContract()
  const first = action({ id: "a", sort_order: 1 })
  const second = action({
    id: "b",
    sort_order: 2,
    target: { description: "Zweites Testgerät" },
    reason_evidence: evidence({ effect: "PHYSICAL_SECOND", physical_presence_required: true }),
  })
  const handoff = contract.createUserActionHandoff([first, second])
  handoff.actions.reverse()
  assert.ok(issueCodes(contract.validateUserActionHandoff(handoff)).includes("ACTION_ORDER_INVALID"))
  assert.throws(() => contract.renderUserActionHandoff(handoff), /ACTION_ORDER_INVALID/)
})

test("negative: runtime validator enforces schema-compatible scalar types", () => {
  requireContract()
  const candidate = action({
    title: 42,
    reason: { text: "ungültig" },
    target: { description: 99 },
    instructions: { step: "ungültig" },
    reason_evidence: evidence({
      effect: 7,
      tool_available: "false",
      tool_authenticated: null,
      evidence: [123],
    }),
  })
  const codes = issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false })))
  assert.ok(codes.includes("ACTION_TITLE_REQUIRED"))
  assert.ok(codes.includes("REASON_REQUIRED"))
  assert.ok(codes.includes("TARGET_FIELD_INVALID"))
  assert.ok(codes.includes("INSTRUCTIONS_INVALID"))
  assert.ok(codes.includes("CAPABILITY_EFFECT_INVALID"))
  assert.ok(codes.includes("CAPABILITY_EVIDENCE_TYPE_INVALID"))
  assert.ok(codes.includes("CAPABILITY_EVIDENCE_UNPROVEN"))
})

test("negative: non-GitHub actions cannot carry ignored web UI data", () => {
  requireContract()
  const candidate = action({ web_ui: "invalid" })
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("WEB_UI_PLATFORM_INVALID"))
})

test("negative: contradictory capability evidence fails closed", () => {
  requireContract()
  const authorizedWithoutTool = action({
    reason_code: "RESOURCE_UNREACHABLE",
    reason_evidence: evidence({
      tool_available: false,
      tool_authenticated: false,
      permission_available: false,
      action_authorized: true,
    }),
  })
  const alternativeAuthorizationWithoutCapability = action({
    id: "alternative-contradiction",
    target: { description: "Zweites Testgerät" },
    reason_evidence: evidence({
      effect: "PHYSICAL_SECOND",
      physical_presence_required: true,
      alternative_capability_available: false,
      alternative_capability_authorized: true,
    }),
  })
  for (const candidate of [authorizedWithoutTool, alternativeAuthorizationWithoutCapability]) {
    const codes = issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false })))
    assert.ok(codes.includes("CAPABILITY_EVIDENCE_CONTRADICTORY"))
  }
})

test("negative: runtime enforces the schema evidence text length limit", () => {
  requireContract()
  const candidate = action({ reason_evidence: evidence({ evidence: ["x".repeat(513)] }) })
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("CAPABILITY_EVIDENCE_UNPROVEN"))
})

test("negative: English handoff prose is rejected while UI labels remain exempt", () => {
  requireContract()
  const candidate = githubMerge({
    title: "Merge the pull request",
    reason: "The merge requires personal approval.",
    reason_evidence: evidence({ evidence: ["The capability check was successful."] }),
  })
  candidate.web_ui.steps[0].instruction = "Open the visible tab."
  candidate.web_ui.abort_condition = "Brich ab, wenn required checks are not successful."
  const handoff = contract.createUserActionHandoff([candidate], { validate: false })
  assert.ok(issueCodes(contract.validateUserActionHandoff(handoff)).includes("LANGUAGE_INVALID"))
  const rendered = contract.renderUserActionHandoff(contract.createUserActionHandoff([githubMerge()]))
  assert.deepEqual(contract.validateCompletionMarkdown(rendered), [])
})

test("negative: next steps are not copied into required actions", () => {
  requireContract()
  const candidate = action({ source_category: "next_step" })
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("SOURCE_CATEGORY_INVALID"))
})

test("negative: generic AI inability without evidence is rejected", () => {
  requireContract()
  const candidate = action({ reason: "Die KI kann das nicht.", reason_evidence: evidence({ evidence: [] }) })
  assert.ok(issueCodes(contract.validateUserActionHandoff(contract.createUserActionHandoff([candidate], { validate: false }))).includes("CAPABILITY_EVIDENCE_UNPROVEN"))
})

test("negative: action executed in context cannot also be delegated", () => {
  requireContract()
  const handoff = contract.createUserActionHandoff([action()], { validate: false })
  assert.ok(issueCodes(contract.validateUserActionHandoff(handoff, { executedEffects: ["LOCAL_WRITE"] })).includes("ACTION_EXECUTION_CONFLICT"))
})

test("negative: report content cannot follow the final user-action section", () => {
  requireContract()
  const markdown = "# Bericht\n\n## Erforderliche Aktion durch den Nutzer\n\nKeine Aktion durch den Nutzer erforderlich.\n\n## Residual Risks\n\nKeine."
  assert.ok(issueCodes(contract.validateCompletionMarkdown(markdown)).includes("SECTION_NOT_FINAL"))
})

test("security: renderer redacts portable local paths", () => {
  requireContract()
  const unixHome = ["", "home", "example-user", "private", "device"].join("/")
  const macHome = ["", "Users", "example-user", "private", "device"].join("/")
  const candidate = action({
    reason: `Die persönliche Prüfung betrifft ${unixHome}.`,
    target: { description: macHome },
  })
  const rendered = contract.renderUserActionHandoff(contract.createUserActionHandoff([candidate]))
  assert.doesNotMatch(rendered, /example-user/)
  assert.match(rendered, /\[REDACTED_LOCAL_PATH\]/)
})

test("security: machine-readable handoff redacts credential-shaped values and local paths", () => {
  requireContract()
  const credentialMarker = ["ghp", "syntheticcredentialmarker000000000000000000"].join("_")
  const unixHome = ["", "home", "example-user", "private", "device"].join("/")
  const candidate = action({
    reason: `Die persönliche Prüfung betrifft ${credentialMarker}.`,
    target: { description: unixHome },
    reason_evidence: evidence({
      physical_presence_required: true,
      evidence: [`Fixture ${credentialMarker}`],
    }),
  })
  const handoff = contract.createUserActionHandoff([candidate])
  const serialized = JSON.stringify(handoff)
  assert.doesNotMatch(serialized, new RegExp(credentialMarker))
  assert.doesNotMatch(serialized, /example-user/)
  assert.match(serialized, /\[REDACTED\]/)
  assert.match(serialized, /\[REDACTED_LOCAL_PATH\]/)
})

test("security: media, root, and WSL user paths are redacted without real environment literals", () => {
  requireContract()
  const mediaPath = ["", "media", "synthetic-user", "private", "device"].join("/")
  const rootPath = ["", "root", "private", "device"].join("/")
  const wslPath = ["", "mnt", "c", "Users", "synthetic-user", "private"].join("/")
  const candidate = action({
    reason: `Die Prüfung betrifft ${mediaPath}.`,
    target: { description: rootPath },
    instructions: [`Prüfe das Gerät anhand von ${wslPath}.`],
  })
  const serialized = JSON.stringify(contract.createUserActionHandoff([candidate]))
  assert.doesNotMatch(serialized, /synthetic-user|\/media\/|\/root\/|\/mnt\/c\/Users\//)
  assert.match(serialized, /\[REDACTED_LOCAL_PATH\]/)
})

test("security: raw unredacted machine handoff fails validation", () => {
  requireContract()
  const unixHome = ["", "home", "example-user", "private", "device"].join("/")
  const handoff = contract.createUserActionHandoff([action()])
  handoff.actions[0].target.description = unixHome
  assert.ok(issueCodes(contract.validateUserActionHandoff(handoff)).includes("SENSITIVE_CONTENT_UNREDACTED"))
})
