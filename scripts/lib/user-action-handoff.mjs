import { safeRedactText, secretValuesFromEnv } from "./security/redaction.mjs"

export const USER_ACTION_HANDOFF_SCHEMA_VERSION = "ocae-user-action-handoff.1"
export const USER_ACTION_SECTION_TITLE = "Erforderliche Aktion durch den Nutzer"
export const EMPTY_USER_ACTION_MESSAGE = "Keine Aktion durch den Nutzer erforderlich."
export const USER_ACTION_REASON_CODES = Object.freeze([
  "PHYSICAL_ACTION_REQUIRED",
  "RESOURCE_UNREACHABLE",
  "MISSING_PERMISSION",
  "MISSING_AUTHORIZATION",
  "NON_DELEGABLE_OWNER_APPROVAL",
  "PERSONAL_LEGAL_DECISION",
  "MANUAL_SECURITY_CONFIRMATION",
])

const REASON_CODES = new Set(USER_ACTION_REASON_CODES)
const HANDOFF_FIELDS = new Set([
  "schema_version", "required", "language", "section_title", "empty_message", "actions",
])
const REQUIRED_EVIDENCE_FIELDS = Object.freeze([
  "capability_checked",
  "effect",
  "tool_available",
  "tool_authenticated",
  "permission_available",
  "action_authorized",
  "alternatives_checked",
  "alternative_capability_available",
  "alternative_capability_authorized",
  "suitable_agent_available",
  "personal_decision_required",
  "physical_presence_required",
  "manual_security_policy_required",
  "evidence",
])
const BOOLEAN_EVIDENCE_FIELDS = Object.freeze([
  "capability_checked",
  "tool_available",
  "tool_authenticated",
  "permission_available",
  "action_authorized",
  "alternatives_checked",
  "alternative_capability_available",
  "alternative_capability_authorized",
  "suitable_agent_available",
  "personal_decision_required",
  "physical_presence_required",
  "manual_security_policy_required",
])
const ACTION_FIELDS = new Set([
  "id", "title", "reason_code", "reason", "reason_evidence", "obligation",
  "source_category", "status", "platform", "target", "instructions",
  "sort_order", "web_ui",
])
const EVIDENCE_FIELDS = new Set(REQUIRED_EVIDENCE_FIELDS)
const TARGET_FIELDS = new Set(["description", "repository", "pull_request", "issue", "branch"])
const WEB_UI_FIELDS = new Set(["label_source", "steps", "abort_condition"])
const STEP_FIELDS = new Set(["order", "control_type", "label", "instruction", "value", "confirmation"])
const CONTROL_TYPES = new Set(["tab", "menu", "button", "link", "input", "checkbox", "section"])
const LABEL_SOURCES = new Set(["live_checked", "official_docs", "current_expected_not_live_checked"])
const REDACTION_OPTIONS = Object.freeze({ secrets: secretValuesFromEnv() })
const PLACEHOLDER = /(?:<[^>]+>|\{[^}]+\}|\b(?:TBD|TODO|PLACEHOLDER)\b)/i
const CLI_INSTRUCTION = /(?:^|[\s`$])\s*(?:(?:sudo|env|command)\s+)*(?:(?:\/[A-Za-z0-9._-]+)*\/)?(?:gh|git)\s+\S/i
const CLI_MARKDOWN_INSTRUCTION = /(?:^|\n)\s*(?:(?:\d+\.|[-*])\s+)?(?:Führe\s+)?`?\s*(?:(?:sudo|env|command)\s+)*(?:(?:\/[A-Za-z0-9._-]+)*\/)?(?:gh|git)\s+\S/im
const PORTABLE_LOCAL_PATH = /(?:\/(?:home|Users|media)\/[^/\s`"'<>]+|\/root(?=\/|[\s`"'<>.,;:!?)]|$)|\/mnt\/[A-Za-z]\/Users\/[^/\s`"'<>]+|[A-Za-z]:\\Users\\[^\\\s`"'<>]+)/g
const ENGLISH_PROSE_TOKEN = /\b(?:the|this|that|please|open|click|select|enter|confirm|requires?|required|available|unavailable|cannot|could|must|checks?\s+are|is\s+not|was\s+not|successful)\b/gi
const ENGLISH_IMPERATIVE = /^\s*(?:open|click|select|enter|confirm|merge|check|review|press|connect)\b/i

export function createUserActionHandoff(actions = [], options = {}) {
  if (!Array.isArray(actions)) {
    throw contractError([issue("ACTIONS_INVALID", "actions", "actions muss ein Array sein.")])
  }
  const normalized = deduplicateAndSort(actions.map(sanitizeValue))
  const handoff = {
    schema_version: USER_ACTION_HANDOFF_SCHEMA_VERSION,
    required: true,
    language: "de",
    section_title: USER_ACTION_SECTION_TITLE,
    empty_message: EMPTY_USER_ACTION_MESSAGE,
    actions: normalized,
  }
  if (options.validate !== false) {
    const issues = validateUserActionHandoff(handoff, options.context)
    if (issues.length > 0) throw contractError(issues)
  }
  return handoff
}

export function validateUserActionHandoff(handoff, context = {}) {
  const issues = []
  if (!isRecord(handoff)) return [issue("HANDOFF_REQUIRED", "user_action_handoff", "Der Nutzeraktionsvertrag fehlt.")]
  rejectUnknown(handoff, HANDOFF_FIELDS, "user_action_handoff", issues)
  exact(handoff.schema_version, USER_ACTION_HANDOFF_SCHEMA_VERSION, issues, "SCHEMA_VERSION_INVALID", "schema_version")
  exact(handoff.required, true, issues, "HANDOFF_NOT_REQUIRED", "required")
  exact(handoff.language, "de", issues, "LANGUAGE_INVALID", "language")
  exact(handoff.section_title, USER_ACTION_SECTION_TITLE, issues, "SECTION_TITLE_INVALID", "section_title")
  exact(handoff.empty_message, EMPTY_USER_ACTION_MESSAGE, issues, "EMPTY_MESSAGE_INVALID", "empty_message")
  if (!Array.isArray(handoff.actions)) {
    issues.push(issue("ACTIONS_INVALID", "actions", "actions muss ein Array sein."))
    return issues
  }

  const seenIds = new Set()
  const seenSemantics = new Set()
  handoff.actions.forEach((action, index) => {
    const prefix = `actions[${index}]`
    validateAction(action, prefix, issues, context)
    if (!isRecord(action)) return
    if (stableStringify(sanitizeValue(action)) !== stableStringify(action)) {
      issues.push(issue("SENSITIVE_CONTENT_UNREDACTED", prefix, "Secrets und private lokale Pfade müssen vor maschinenlesbarer Ausgabe redigiert werden."))
    }
    if (seenIds.has(action.id)) issues.push(issue("DUPLICATE_ACTION", `${prefix}.id`, "Eine Aktions-ID darf nur einmal vorkommen."))
    seenIds.add(action.id)
    const semanticKey = `${action.reason_evidence?.effect || ""}:${stableStringify(action.target || {})}`
    if (seenSemantics.has(semanticKey)) issues.push(issue("DUPLICATE_ACTION", prefix, "Dieselbe Wirkung und dasselbe Ziel sind doppelt vorhanden."))
    seenSemantics.add(semanticKey)
  })
  const canonicalOrder = [...handoff.actions].sort(compareActions)
  if (canonicalOrder.some((action, index) => action !== handoff.actions[index])) {
    issues.push(issue("ACTION_ORDER_INVALID", "actions", "Aktionen müssen kanonisch nach sort_order und id sortiert sein."))
  }
  return issues
}

export function renderUserActionHandoff(handoff, options = {}) {
  const issues = validateUserActionHandoff(handoff, options.context)
  if (issues.length > 0) throw contractError(issues)
  const lines = [`## ${USER_ACTION_SECTION_TITLE}`, ""]
  if (handoff.actions.length === 0) {
    lines.push(EMPTY_USER_ACTION_MESSAGE)
    return lines.join("\n")
  }
  ;[...handoff.actions].sort(compareActions).forEach((action, index) => {
    if (index > 0) lines.push("")
    lines.push(`### ${redact(action.title)}`)
    lines.push("")
    lines.push("**Warum diese Aktion nicht durch das Agentensystem ausgeführt werden konnte:**  ")
    lines.push(redact(action.reason))
    lines.push("")
    lines.push(`**Ziel:** ${renderTarget(action.target)}`)
    lines.push("")
    if (action.platform === "github_web") {
      if (action.web_ui.label_source === "current_expected_not_live_checked") {
        lines.push("_Die sichtbaren GitHub-Bezeichnungen entsprechen dem aktuell erwarteten Stand und wurden in diesem Lauf nicht live geprüft._")
        lines.push("")
      } else if (action.web_ui.label_source === "official_docs") {
        lines.push("_Die sichtbaren GitHub-Bezeichnungen stammen aus der offiziellen Dokumentation und wurden in diesem Lauf nicht an der konkreten Repository-Oberfläche live geprüft._")
        lines.push("")
      }
      for (const step of [...action.web_ui.steps].sort((left, right) => left.order - right.order)) {
        const value = step.value ? ` Trage \`${redact(step.value)}\` ein.` : ""
        lines.push(`${step.order}. ${redact(step.instruction)} Sichtbare Bezeichnung: **${redact(step.label)}**.${value}`)
      }
      lines.push("")
      lines.push(`**Abbruchbedingung:** ${redact(action.web_ui.abort_condition)}`)
    } else {
      action.instructions.forEach((instruction, instructionIndex) => {
        lines.push(`${instructionIndex + 1}. ${redact(instruction)}`)
      })
    }
  })
  return lines.join("\n")
}

export function appendUserActionHandoff(markdown, handoff, options = {}) {
  const source = String(markdown || "").trimEnd()
  const existing = findUserActionHeading(source)
  if (existing.exact.length > 0 || existing.invalid.length > 0) {
    throw contractError([issue("SECTION_ALREADY_PRESENT", "markdown", "Der Bericht enthält bereits einen Nutzeraktionsabschnitt.")])
  }
  return `${source}${source ? "\n\n" : ""}${renderUserActionHandoff(handoff, options)}`
}

export function validateCompletionMarkdown(markdown) {
  const text = String(markdown || "").trimEnd()
  const scanText = maskFencedCode(text)
  const headings = [...scanText.matchAll(/^## (.+)$/gm)].map((match) => ({
    title: match[1].trim(),
    index: match.index,
    end: match.index + match[0].length,
  }))
  const exactHeadings = headings.filter((heading) => heading.title === USER_ACTION_SECTION_TITLE)
  const relatedInvalid = headings.filter((heading) =>
    heading.title !== USER_ACTION_SECTION_TITLE
    && /(?:user action|required user|aktion.*nutzer|nutzer.*aktion)/i.test(heading.title))
  const issues = []
  if (exactHeadings.length === 0) {
    if (relatedInvalid.length > 0) issues.push(issue("SECTION_TITLE_INVALID", "markdown", "Die Überschrift des Nutzeraktionsabschnitts ist nicht kanonisch."))
    else issues.push(issue("SECTION_MISSING", "markdown", "Der Nutzeraktionsabschnitt fehlt."))
    return issues
  }
  if (relatedInvalid.length > 0) issues.push(issue("SECTION_TITLE_INVALID", "markdown", "Neben der kanonischen Überschrift ist eine abweichende Nutzeraktionsüberschrift vorhanden."))
  if (exactHeadings.length > 1) issues.push(issue("SECTION_DUPLICATE", "markdown", "Der Nutzeraktionsabschnitt ist mehrfach vorhanden."))
  const heading = exactHeadings.at(-1)
  if (headings.at(-1)?.index !== heading.index) issues.push(issue("SECTION_NOT_FINAL", "markdown", "Der Nutzeraktionsabschnitt ist nicht der letzte fachliche Abschnitt."))
  const body = text.slice(heading.end).trim()
  if (!body) issues.push(issue("EMPTY_STATE_REQUIRED", "markdown", "Der Nutzeraktionsabschnitt ist leer."))
  if (body.startsWith(EMPTY_USER_ACTION_MESSAGE) && body !== EMPTY_USER_ACTION_MESSAGE) {
    issues.push(issue("EMPTY_STATE_CONFLICT", "markdown", "Standardsatz und echte Aktionen dürfen nicht gleichzeitig vorkommen."))
  }
  if (body && body !== EMPTY_USER_ACTION_MESSAGE && !/^### \S/m.test(body)) {
    issues.push(issue("EMPTY_STATE_REQUIRED", "markdown", "Ohne strukturierte Aktion ist exakt der deutsche Standardsatz erforderlich."))
  }
  if (body !== EMPTY_USER_ACTION_MESSAGE && CLI_MARKDOWN_INSTRUCTION.test(body)) {
    issues.push(issue("GITHUB_CLI_ONLY", "markdown", "Der Nutzeraktionsabschnitt darf keine Git- oder GitHub-CLI-Anleitung enthalten."))
  }
  if (/\b(?:No user action required|Required user action|Why this action|Target:)\b/i.test(body)
    || (/^### \S/m.test(body) && (!body.includes("**Warum diese Aktion nicht durch das Agentensystem ausgeführt werden konnte:**")
      || !body.includes("**Ziel:**")))
    || body.split("\n").some((line) => isLikelyEnglishProse(line.replace(/\*\*[^*]+\*\*/g, "")))) {
    issues.push(issue("LANGUAGE_INVALID", "markdown", "Der fachliche Nutzeraktionsabschnitt muss deutschsprachig sein."))
  }
  if (/\b(?:optional|empfehlung|restrisiko|nächste schritte?)\b/i.test(body) && body !== EMPTY_USER_ACTION_MESSAGE) {
    issues.push(issue("NON_REQUIRED_CONTENT", "markdown", "Optionale Empfehlungen, Rest-Risiken und nächste Schritte sind keine Nutzeraktionen."))
  }
  return issues
}

function validateAction(action, prefix, issues, context) {
  if (!isRecord(action)) {
    issues.push(issue("ACTION_INVALID", prefix, "Die Aktion muss ein Objekt sein."))
    return
  }
  rejectUnknown(action, ACTION_FIELDS, prefix, issues)
  requiredString(action.id, issues, "ACTION_ID_REQUIRED", `${prefix}.id`)
  if (action.id && !/^[a-z0-9][a-z0-9-]*$/.test(action.id)) issues.push(issue("ACTION_ID_INVALID", `${prefix}.id`, "Die Aktions-ID ist ungültig."))
  requiredString(action.title, issues, "ACTION_TITLE_REQUIRED", `${prefix}.title`)
  validateGermanProse(action.title, issues, `${prefix}.title`)
  if (!action.reason_code) issues.push(issue("REASON_CODE_REQUIRED", `${prefix}.reason_code`, "Ein kontrollierter Reason Code ist Pflicht."))
  else if (!REASON_CODES.has(action.reason_code)) issues.push(issue("REASON_CODE_INVALID", `${prefix}.reason_code`, "Der Reason Code ist nicht erlaubt."))
  requiredString(action.reason, issues, "REASON_REQUIRED", `${prefix}.reason`)
  validateGermanProse(action.reason, issues, `${prefix}.reason`)
  if (action.obligation !== "required") issues.push(issue("ACTION_NOT_REQUIRED", `${prefix}.obligation`, "Nur zwingende Handlungen dürfen delegiert werden."))
  if (action.source_category !== "non_delegable_user_action") issues.push(issue("SOURCE_CATEGORY_INVALID", `${prefix}.source_category`, "Empfehlungen, Rest-Risiken und nächste Schritte sind unzulässig."))
  if (action.status !== "pending") issues.push(issue("ACTION_ALREADY_EXECUTED", `${prefix}.status`, "Nur noch nicht ausgeführte Handlungen dürfen delegiert werden."))
  if (!["physical", "manual", "github_web"].includes(action.platform)) issues.push(issue("PLATFORM_INVALID", `${prefix}.platform`, "Die Plattform ist ungültig."))
  if (!Number.isInteger(action.sort_order) || action.sort_order < 0) issues.push(issue("SORT_ORDER_INVALID", `${prefix}.sort_order`, "sort_order muss eine nichtnegative Ganzzahl sein."))
  validateTarget(action.target, `${prefix}.target`, issues)
  validateEvidence(action, `${prefix}.reason_evidence`, issues, context)
  if (!Array.isArray(action.instructions) || action.instructions.some((entry) => typeof entry !== "string" || !entry.trim())) {
    issues.push(issue("INSTRUCTIONS_INVALID", `${prefix}.instructions`, "instructions muss ein Array nichtleerer Texte sein."))
  } else {
    action.instructions.forEach((entry, index) => validateGermanProse(entry, issues, `${prefix}.instructions[${index}]`))
  }
  if (action.platform !== "github_web" && (!Array.isArray(action.instructions) || action.instructions.length === 0)) {
    issues.push(issue("INSTRUCTIONS_REQUIRED", `${prefix}.instructions`, "Eine konkrete Handlungsanleitung fehlt."))
  }
  const githubTarget = isRecord(action.target)
    && ["repository", "pull_request", "issue", "branch"].some((key) => key in action.target)
  const cliInstruction = Array.isArray(action.instructions) && action.instructions.some((entry) =>
    typeof entry === "string" && CLI_INSTRUCTION.test(entry))
  if ((githubTarget || cliInstruction) && action.platform !== "github_web") {
    issues.push(issue("GITHUB_WEB_REQUIRED", `${prefix}.platform`, "GitHub-Aktionen müssen als github_web mit sichtbarer Web-UI-Anleitung modelliert sein."))
  }
  if (action.platform !== "github_web" && Object.hasOwn(action, "web_ui")) {
    issues.push(issue("WEB_UI_PLATFORM_INVALID", `${prefix}.web_ui`, "web_ui ist ausschließlich für github_web-Aktionen erlaubt."))
  }
  if (cliInstruction) {
    issues.push(issue("GITHUB_CLI_ONLY", `${prefix}.instructions`, "Nutzeraktionen dürfen keine Git- oder GitHub-CLI-Anleitung enthalten."))
  }
  if (action.platform === "github_web") validateGitHubAction(action, prefix, issues)
  if (containsPlaceholder(action)) issues.push(issue("PLACEHOLDER_FORBIDDEN", prefix, "Bekannte Ziele dürfen keine Platzhalter enthalten."))
}

function validateEvidence(action, path, issues, context) {
  const evidence = action.reason_evidence
  if (!isRecord(evidence)) {
    issues.push(issue("CAPABILITY_EVIDENCE_REQUIRED", path, "Capability-Evidence ist Pflicht."))
    return
  }
  rejectUnknown(evidence, EVIDENCE_FIELDS, path, issues)
  for (const field of REQUIRED_EVIDENCE_FIELDS) {
    if (!(field in evidence)) issues.push(issue("CAPABILITY_EVIDENCE_INCOMPLETE", `${path}.${field}`, `Capability-Evidence-Feld ${field} fehlt.`))
  }
  for (const field of BOOLEAN_EVIDENCE_FIELDS) {
    if (field in evidence && typeof evidence[field] !== "boolean") {
      issues.push(issue("CAPABILITY_EVIDENCE_TYPE_INVALID", `${path}.${field}`, `${field} muss ein boolescher Wert sein.`))
    }
  }
  requiredString(evidence.effect, issues, "CAPABILITY_EFFECT_INVALID", `${path}.effect`)
  if (evidence.capability_checked !== true || evidence.alternatives_checked !== true) {
    issues.push(issue("CAPABILITY_CHECK_REQUIRED", path, "Capability- und Alternativenprüfung müssen nachweislich erfolgt sein."))
  }
  if (!requiredTextArray(evidence.evidence, 512)) issues.push(issue("CAPABILITY_EVIDENCE_UNPROVEN", `${path}.evidence`, "Capability-Evidence muss aus nichtleeren Texten mit höchstens 512 Zeichen bestehen."))
  if (Array.isArray(evidence.evidence)) {
    evidence.evidence.forEach((entry, index) => validateGermanProse(entry, issues, `${path}.evidence[${index}]`))
  }
  if (evidence.tool_authenticated === true && evidence.tool_available !== true) {
    issues.push(issue("CAPABILITY_EVIDENCE_CONTRADICTORY", path, "Ein authentifiziertes Werkzeug muss zugleich verfügbar sein."))
  }
  if (evidence.permission_available === true
    && (evidence.tool_available !== true || evidence.tool_authenticated !== true)) {
    issues.push(issue("CAPABILITY_EVIDENCE_CONTRADICTORY", path, "Eine Werkzeugberechtigung setzt ein verfügbares und authentifiziertes Werkzeug voraus."))
  }
  if (evidence.action_authorized === true
    && (evidence.tool_available !== true || evidence.tool_authenticated !== true || evidence.permission_available !== true)) {
    issues.push(issue("CAPABILITY_EVIDENCE_CONTRADICTORY", path, "Eine Aktionsautorisierung setzt Verfügbarkeit, Authentifizierung und Berechtigung voraus."))
  }
  if (evidence.alternative_capability_authorized === true && evidence.alternative_capability_available !== true) {
    issues.push(issue("CAPABILITY_EVIDENCE_CONTRADICTORY", path, "Eine autorisierte alternative Capability muss verfügbar sein."))
  }
  if (evidence.tool_available && evidence.tool_authenticated && evidence.permission_available && evidence.action_authorized) {
    issues.push(issue("ACTION_CAPABILITY_AVAILABLE", path, "Ein verfügbares, authentifiziertes, berechtigtes und autorisiertes Werkzeug kann die Aktion ausführen."))
  }
  if (evidence.alternative_capability_available && evidence.alternative_capability_authorized) {
    issues.push(issue("ALTERNATIVE_CAPABILITY_AVAILABLE", path, "Eine autorisierte alternative Capability ist verfügbar."))
  }
  if (evidence.suitable_agent_available) issues.push(issue("SUITABLE_AGENT_AVAILABLE", path, "Ein geeigneter Agent ist verfügbar."))
  if ((context.executedEffects || []).includes(evidence.effect)) {
    issues.push(issue("ACTION_EXECUTION_CONFLICT", path, "Die Wirkung wurde bereits ausgeführt und darf nicht zugleich delegiert werden."))
  }
  validateReasonCombination(action.reason_code, evidence, path, issues)
}

function validateReasonCombination(reasonCode, evidence, path, issues) {
  if (!REASON_CODES.has(reasonCode)) return
  const invalid = (message) => issues.push(issue("REASON_EVIDENCE_MISMATCH", path, message))
  if (reasonCode === "PHYSICAL_ACTION_REQUIRED" && (!evidence.physical_presence_required || evidence.tool_available)) invalid("Eine physische Handlung benötigt physische Präsenz und darf nicht tool-ausführbar sein.")
  if (reasonCode === "RESOURCE_UNREACHABLE" && (evidence.tool_available || evidence.alternative_capability_available || evidence.suitable_agent_available)) invalid("RESOURCE_UNREACHABLE erfordert das Fehlen jeder geeigneten Capability.")
  if (reasonCode === "MISSING_PERMISSION" && (!evidence.tool_available || !evidence.tool_authenticated || evidence.permission_available)) invalid("MISSING_PERMISSION erfordert ein authentifiziertes Werkzeug ohne erforderliche Berechtigung.")
  if (reasonCode === "MISSING_AUTHORIZATION" && (!evidence.tool_available || !evidence.tool_authenticated || !evidence.permission_available || evidence.action_authorized)) invalid("MISSING_AUTHORIZATION erfordert Capability und Berechtigung, aber keine gültige Autorisierung.")
  if (reasonCode === "NON_DELEGABLE_OWNER_APPROVAL" && (!evidence.personal_decision_required || evidence.action_authorized)) invalid("Eine nicht delegierbare Owner-Freigabe muss persönlich und nicht autorisiert sein.")
  if (reasonCode === "PERSONAL_LEGAL_DECISION" && !evidence.personal_decision_required) invalid("Eine persönliche/rechtliche Entscheidung muss als persönlich markiert sein.")
  if (reasonCode === "MANUAL_SECURITY_CONFIRMATION" && (!evidence.personal_decision_required || !evidence.manual_security_policy_required)) invalid("Die manuelle Sicherheitsfreigabe benötigt eine konkrete Policy und persönliche Entscheidung.")
}

function validateTarget(target, path, issues) {
  if (!isRecord(target) || Object.keys(target).length === 0) {
    issues.push(issue("TARGET_REQUIRED", path, "Ein konkretes Ziel ist Pflicht."))
    return
  }
  rejectUnknown(target, TARGET_FIELDS, path, issues)
  for (const key of ["description", "repository", "branch"]) {
    if (key in target && (typeof target[key] !== "string" || !target[key].trim())) {
      issues.push(issue("TARGET_FIELD_INVALID", `${path}.${key}`, `${key} muss ein nichtleerer Text sein.`))
    }
  }
  if (typeof target.repository === "string" && !/^[^/\s]+\/[^/\s]+$/.test(target.repository)) issues.push(issue("GITHUB_REPOSITORY_INVALID", `${path}.repository`, "Das Repository muss owner/name entsprechen."))
  for (const key of ["pull_request", "issue"]) if (key in target && (!Number.isInteger(target[key]) || target[key] < 1)) issues.push(issue("GITHUB_TARGET_INVALID", `${path}.${key}`, "Die GitHub-Nummer muss eine positive Ganzzahl sein."))
}

function validateGitHubAction(action, prefix, issues) {
  if (!action.target?.repository || !["pull_request", "issue", "branch"].some((key) => key in (action.target || {}))) {
    issues.push(issue("GITHUB_TARGET_REQUIRED", `${prefix}.target`, "Repository und Zielobjekt sind für GitHub-Aktionen Pflicht."))
  }
  const webUi = action.web_ui
  if (!isRecord(webUi)) {
    issues.push(issue("GITHUB_WEB_REQUIRED", `${prefix}.web_ui`, "GitHub-Aktionen benötigen eine Web-UI-Anleitung."))
    return
  }
  rejectUnknown(webUi, WEB_UI_FIELDS, `${prefix}.web_ui`, issues)
  if (typeof webUi.label_source !== "string" || !LABEL_SOURCES.has(webUi.label_source)) issues.push(issue("WEB_UI_LABEL_SOURCE_REQUIRED", `${prefix}.web_ui.label_source`, "Die Herkunft sichtbarer UI-Bezeichnungen fehlt."))
  if (!Array.isArray(webUi.steps) || webUi.steps.length < 2) {
    issues.push(issue("WEB_UI_STEPS_REQUIRED", `${prefix}.web_ui.steps`, "Mindestens zwei nummerierte Web-UI-Schritte sind Pflicht."))
  }
  const orders = new Set()
  const actionButtonOrders = []
  const navigationOrders = []
  const confirmationOrders = []
  let hasCli = false
  for (const [index, step] of (Array.isArray(webUi.steps) ? webUi.steps : []).entries()) {
    const path = `${prefix}.web_ui.steps[${index}]`
    if (!isRecord(step)) {
      issues.push(issue("WEB_UI_STEP_INVALID", path, "Der Web-UI-Schritt muss ein Objekt sein."))
      continue
    }
    rejectUnknown(step, STEP_FIELDS, path, issues)
    if (!Number.isInteger(step.order) || step.order < 1 || orders.has(step.order)) issues.push(issue("WEB_UI_ORDER_INVALID", `${path}.order`, "Die Schrittfolge muss eindeutig nummeriert sein."))
    orders.add(step.order)
    if (typeof step.control_type !== "string" || !CONTROL_TYPES.has(step.control_type)) issues.push(issue("WEB_UI_CONTROL_INVALID", `${path}.control_type`, "Der sichtbare Steuerelementtyp ist ungültig."))
    if (["tab", "menu", "link"].includes(step.control_type)) navigationOrders.push(step.order)
    if (step.confirmation === true) {
      if (step.control_type === "button") confirmationOrders.push(step.order)
      else issues.push(issue("WEB_UI_CONFIRMATION_INVALID", `${path}.confirmation`, "Eine Bestätigung muss als sichtbarer Button modelliert sein."))
    } else if (step.control_type === "button") {
      actionButtonOrders.push(step.order)
    }
    if (typeof step.confirmation !== "undefined" && typeof step.confirmation !== "boolean") issues.push(issue("WEB_UI_CONFIRMATION_INVALID", `${path}.confirmation`, "confirmation muss ein boolescher Wert sein."))
    requiredString(step.label, issues, "WEB_UI_LABEL_REQUIRED", `${path}.label`)
    requiredString(step.instruction, issues, "WEB_UI_INSTRUCTION_REQUIRED", `${path}.instruction`)
    validateGermanProse(step.instruction, issues, `${path}.instruction`)
    if ("value" in step && typeof step.value !== "string") issues.push(issue("WEB_UI_VALUE_INVALID", `${path}.value`, "value muss ein Text sein."))
    const cliText = [step.label, step.instruction, step.value].filter((value) => typeof value === "string").join(" ")
    if (CLI_INSTRUCTION.test(cliText) || step.control_type === "command") hasCli = true
  }
  if (hasCli) issues.push(issue("GITHUB_CLI_ONLY", `${prefix}.web_ui.steps`, "GitHub-Nutzeraktionen dürfen keine CLI-only-Anleitung enthalten."))
  const ordered = [...orders].sort((left, right) => left - right)
  if (ordered.some((order, index) => order !== index + 1)) issues.push(issue("WEB_UI_ORDER_INVALID", `${prefix}.web_ui.steps`, "Die Web-UI-Schritte müssen lückenlos bei 1 beginnen."))
  if (navigationOrders.length === 0) issues.push(issue("WEB_UI_NAVIGATION_REQUIRED", `${prefix}.web_ui.steps`, "Ein sichtbarer Reiter, ein Menü oder ein Link zur Zielnavigation fehlt."))
  if (actionButtonOrders.length === 0 || confirmationOrders.length === 0) issues.push(issue("WEB_UI_CONFIRMATION_REQUIRED", `${prefix}.web_ui.steps`, "Ein Aktionsbutton und eine nachfolgende explizite Bestätigung sind Pflicht."))
  if (confirmationOrders.some((confirmationOrder) =>
    navigationOrders.some((navigationOrder) => confirmationOrder <= navigationOrder)
    || actionButtonOrders.some((buttonOrder) => confirmationOrder <= buttonOrder))) {
    issues.push(issue("WEB_UI_SEQUENCE_INVALID", `${prefix}.web_ui.steps`, "Navigation und Aktionsbutton müssen vor der Bestätigung liegen."))
  }
  if (typeof webUi.abort_condition !== "string" || !webUi.abort_condition.trim() || !/\b(?:brich|abbruch|beende)\b/i.test(webUi.abort_condition)) {
    issues.push(issue("WEB_UI_ABORT_REQUIRED", `${prefix}.web_ui.abort_condition`, "Eine konkrete deutschsprachige Abbruchbedingung ist Pflicht."))
  }
  validateGermanProse(webUi.abort_condition, issues, `${prefix}.web_ui.abort_condition`)
}

function deduplicateAndSort(actions) {
  const sorted = actions.map((action, inputIndex) => ({ ...structuredCloneSafe(action), __inputIndex: inputIndex }))
    .sort((left, right) => compareActions(left, right)
      || left.__inputIndex - right.__inputIndex)
  const ids = new Set()
  const semantics = new Set()
  const output = []
  for (const action of sorted) {
    const semanticKey = `${action.reason_evidence?.effect || ""}:${stableStringify(action.target || {})}`
    if (ids.has(action.id) || semantics.has(semanticKey)) continue
    ids.add(action.id)
    semantics.add(semanticKey)
    delete action.__inputIndex
    output.push(action)
  }
  return output
}

function renderTarget(target) {
  if (target.repository) {
    const parts = [`Repository \`${redact(target.repository)}\``]
    if (target.pull_request) parts.push(`Pull Request \`#${target.pull_request}\``)
    if (target.issue) parts.push(`Issue \`#${target.issue}\``)
    if (target.branch) parts.push(`Branch \`${redact(target.branch)}\``)
    return parts.join(", ")
  }
  return redact(target.description || stableStringify(target))
}

function rejectUnknown(value, allowed, path, issues) {
  if (!isRecord(value)) return
  for (const key of Object.keys(value)) if (!allowed.has(key)) issues.push(issue("UNKNOWN_FIELD", `${path}.${key}`, "Unbekannte Felder sind nicht erlaubt."))
}

function exact(actual, expected, issues, code, path) {
  if (actual !== expected) issues.push(issue(code, path, `Erwartet: ${JSON.stringify(expected)}.`))
}

function requiredString(value, issues, code, path) {
  if (typeof value !== "string" || !value.trim()) issues.push(issue(code, path, "Ein nichtleerer Text ist Pflicht."))
}

function requiredTextArray(value, maxLength = Number.MAX_SAFE_INTEGER) {
  return Array.isArray(value) && value.length > 0 && value.every((entry) =>
    typeof entry === "string" && entry.trim() && entry.length <= maxLength)
}

function validateGermanProse(value, issues, path) {
  if (typeof value !== "string") return
  if (isLikelyEnglishProse(value)) {
    issues.push(issue("LANGUAGE_INVALID", path, "Handoff-eigene Prosa muss deutschsprachig sein; nur sichtbare technische UI-Bezeichnungen dürfen Englisch bleiben."))
  }
}

function isLikelyEnglishProse(value) {
  const tokens = String(value || "").match(ENGLISH_PROSE_TOKEN) || []
  return tokens.length >= 2 || ENGLISH_IMPERATIVE.test(String(value || ""))
}

function findUserActionHeading(markdown) {
  const headings = [...maskFencedCode(String(markdown)).matchAll(/^## (.+)$/gm)].map((match) => match[1].trim())
  return {
    exact: headings.filter((heading) => heading === USER_ACTION_SECTION_TITLE),
    invalid: headings.filter((heading) => /(?:user action|required user|aktion.*nutzer|nutzer.*aktion)/i.test(heading)),
  }
}

function containsPlaceholder(value) {
  if (typeof value === "string") return PLACEHOLDER.test(value)
  if (Array.isArray(value)) return value.some(containsPlaceholder)
  if (isRecord(value)) return Object.values(value).some(containsPlaceholder)
  return false
}

function redact(value) {
  return safeRedactText(String(value ?? ""), REDACTION_OPTIONS).replace(PORTABLE_LOCAL_PATH, "[REDACTED_LOCAL_PATH]")
}

function sanitizeValue(value) {
  if (typeof value === "string") return redact(value)
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeValue(entry)]))
  return value
}

function numberOrMax(value) {
  return Number.isInteger(value) ? value : Number.MAX_SAFE_INTEGER
}

function compareActions(left, right) {
  return (numberOrMax(left?.sort_order) - numberOrMax(right?.sort_order))
    || String(left?.id || "").localeCompare(String(right?.id || ""), "en")
}

function maskFencedCode(markdown) {
  let insideFence = false
  return String(markdown).split("\n").map((line) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      insideFence = !insideFence
      return " ".repeat(line.length)
    }
    return insideFence ? " ".repeat(line.length) : line
  }).join("\n")
}

function structuredCloneSafe(value) {
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value))
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`
  return JSON.stringify(value)
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function issue(code, path, message) {
  return { code, path, message }
}

function contractError(issues) {
  const error = new Error(`USER_ACTION_HANDOFF_INVALID: ${issues.map((entry) => entry.code).join(", ")}`)
  error.code = "USER_ACTION_HANDOFF_INVALID"
  error.issues = issues
  return error
}
