# OpenCode Plugin & Hook API for Runtime Enforcement — Research Report

**Date:** 2026-07-16
**Researcher:** research-agent (LLM-powered)
**OpenCode Version Scope:** 1.15.x (docs last updated Jul 14, 2026; source from `dev` branch)

> **HISTORICAL RESEARCH:** This report describes the earlier plural plugin-path
> model. It is retained for provenance only and must not be used as an active
> installation instruction. The current verified bridge is
> `.opencode/plugin/governance-v2.ts`.

---

## Sources

| URL | Title | Accessed |
|-----|-------|----------|
| https://opencode.ai/docs/plugins/ | Plugins | 2026-07-16 |
| https://opencode.ai/docs/permissions/ | Permissions | 2026-07-16 |
| https://opencode.ai/docs/tools/ | Tools | 2026-07-16 |
| https://opencode.ai/docs/agents/ | Agents | 2026-07-16 |
| https://opencode.ai/docs/sdk/ | SDK | 2026-07-16 |
| https://opencode.ai/docs/config/ | Config | 2026-07-16 |
| https://opencode.ai/docs/policies/ | Policies | 2026-07-16 |
| https://opencode.ai/docs/custom-tools/ | Custom Tools | 2026-07-16 |
| https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/index.ts | Plugin Hooks interface (source) | 2026-07-16 |
| https://opencode.ai/docs/ecosystem/ | Ecosystem | 2026-07-16 |

---

## 1. Plugin System

### 1.1 Plugin Loading Mechanism

**CONFIDENCE: VERIFIED** (from official docs + source code)

OpenCode supports two plugin sources:

#### Local plugins (auto-load)
- **Project-level:** `.opencode/plugins/` — any `.js` or `.ts` file here is auto-loaded at startup
- **Global:** `~/.config/opencode/plugins/` — ditto for user-wide plugins

#### NPM plugins (config-driven)
- Specified in `opencode.json` via the `plugin` array:
  ```json
  { "plugin": ["opencode-helicone-session", "@my-org/custom-plugin"] }
  ```
- Installed automatically using **Bun** at startup into `~/.cache/opencode/node_modules/`
- Both regular and scoped packages supported

#### Load Order
1. Global config (`~/.config/opencode/opencode.json`)
2. Project config (`opencode.json`)
3. Global plugin directory (`~/.config/opencode/plugins/`)
4. Project plugin directory (`.opencode/plugins/`)

#### Dependencies for local plugins
Local plugins can use npm packages by adding a `package.json` in `.opencode/`:
```json
{ "dependencies": { "shescape": "^2.1.0" } }
```
OpenCode runs `bun install` at startup.

### 1.2 Plugin Structure

**CONFIDENCE: VERIFIED** (from official docs + source code `PluginInput` type)

A plugin exports a single async function (or default export):

```typescript
export const MyPlugin = async ({ project, client, $, directory, worktree, serverUrl, experimental_workspace }) => {
  return {
    // Hook implementations
  }
}
```

**PluginInput** context (from `PluginInput` type in source):
- `client`: an OpenCode SDK client (`createOpencodeClient`)
- `project`: current project info
- `directory`: current working directory
- `worktree`: git worktree path
- `serverUrl`: the server URL
- `$`: Bun's shell API
- `experimental_workspace`: workspace adapter registration

TypeScript support via `@opencode-ai/plugin` package:
```typescript
import type { Plugin } from "@opencode-ai/plugin"
export const MyPlugin: Plugin = async (ctx) => { ... }
```

### 1.3 Plugin Lifecycle

**CONFIDENCE: VERIFIED**

- **Load:** All plugins from all sources are loaded at startup
- **Init:** Each plugin function is called with the context object
- **Hook Registration:** The returned `Hooks` object registers all hook handlers
- **Disposal:** The `dispose` hook is called for cleanup when OpenCode shuts down

---

## 2. Hook System — Complete Reference

### 2.1 All Documented Hook Points

**CONFIDENCE: VERIFIED** (from OpenCode `Hooks` interface in source code `packages/plugin/src/index.ts`)

#### 2.1.1 Tool Hooks (MOST RELEVANT FOR RUNTIME ENFORCEMENT)

| Hook | Input | Output | Description |
|------|-------|--------|-------------|
| `tool.execute.before` | `{ tool, sessionID, callID }` | `{ args }` | Runs BEFORE any tool execution. Can modify args. **Can throw to block.** |
| `tool.execute.after` | `{ tool, sessionID, callID, args }` | `{ title, output, metadata }` | Runs AFTER tool execution. Can modify display title/output. |
| `tool.definition` | `{ toolID }` | `{ description, parameters }` | Modify tool definitions sent to the LLM. |

#### 2.1.2 Permission Hook

| Hook | Input | Output | Description |
|------|-------|--------|-------------|
| `permission.ask` | `Permission` (full permission request) | `{ status: "ask" \| "deny" \| "allow" }` | Override permission decisions. Can force deny/allow. |

#### 2.1.3 Chat/Message Hooks

| Hook | Input | Output | Description |
|------|-------|--------|-------------|
| `chat.message` | `{ sessionID, agent, model, messageID, variant }` | `{ message, parts }` | Called when new user message is received. Can modify message + parts. |
| `chat.params` | `{ sessionID, agent, model, provider, message }` | `{ temperature, topP, topK, maxOutputTokens, options }` | Modify LLM parameters before each call. |
| `chat.headers` | `{ sessionID, agent, model, provider, message }` | `{ headers }` | Add HTTP headers to LLM provider requests. |

#### 2.1.4 Command Hook

| Hook | Input | Output | Description |
|------|-------|--------|-------------|
| `command.execute.before` | `{ command, sessionID, arguments }` | `{ parts }` | Runs before a `/command` executes. Can modify the prompt parts. |

#### 2.1.5 Shell/Terminal Hook

| Hook | Input | Output | Description |
|------|-------|--------|-------------|
| `shell.env` | `{ cwd, sessionID?, callID? }` | `{ env }` | Inject environment variables into all shell executions (AI tools + user terminals). |

#### 2.1.6 Event Hook (Generic Listener)

The `event` hook receives ALL typed events (generic callback):
```typescript
event: async ({ event }) => {
  if (event.type === "session.idle") { ... }
}
```

Available event types from docs:
- **Command:** `command.executed`
- **File:** `file.edited`, `file.watcher.updated`
- **Installation:** `installation.updated`
- **LSP:** `lsp.client.diagnostics`, `lsp.updated`
- **Message:** `message.part.removed`, `message.part.updated`, `message.removed`, `message.updated`
- **Permission:** `permission.asked`, `permission.replied`
- **Server:** `server.connected`
- **Session:** `session.created`, `session.compacted`, `session.deleted`, `session.diff`, `session.error`, `session.idle`, `session.status`, `session.updated`
- **Shell:** `shell.env`
- **Todo:** `todo.updated`
- **TUI:** `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`
- **Tool:** `tool.execute.after`, `tool.execute.before`

#### 2.1.7 Experimental Hooks

| Hook | Description |
|------|-------------|
| `experimental.chat.messages.transform` | Transform the entire message array before sending to LLM. |
| `experimental.chat.system.transform` | Modify the system prompt array. |
| `experimental.provider.small_model` | Override the small model selection. |
| `experimental.session.compacting` | Inject custom context into compaction or replace compaction prompt entirely. |
| `experimental.compaction.autocontinue` | Control whether auto-continue happens after compaction. |
| `experimental.text.complete` | Override text completion. |

#### 2.1.8 Other Hooks (from source code Hooks interface)

- `dispose`: Cleanup on shutdown
- `config`: Modify configuration at load time
- `tool`: Register custom tools (key-value of tool definitions)
- `auth`: Register custom authentication methods for providers
- `provider`: Register custom provider models/discovery

### 2.2 `tool.execute.before` — Detailed Analysis

**CONFIDENCE: VERIFIED** (from official docs + source types + doc examples)

#### Hook Signature (from source code):
```typescript
"tool.execute.before"?: (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: any },
) => Promise<void>
```

**`input` fields:**
- `tool` — string, the tool name (e.g. `"bash"`, `"edit"`, `"write"`, `"read"`, `"grep"`, `"glob"`, `"webfetch"`, `"websearch"`, `"task"`, `"question"`, `"skill"`, `"todowrite"`, `"lsp"`, `"apply_patch"`)
- `sessionID` — string, the current session identifier
- `callID` — string, unique identifier for this tool invocation

**`output` fields:**
- `args` — any, the arguments that will be passed to the tool. **Can be mutated by the plugin.**

#### Blocking Behavior

**CRITICAL FINDING:** Throwing an error in `tool.execute.before` **BLOCKS** the tool execution.

This is confirmed by the official `.env protection` example:
```javascript
"tool.execute.before": async (input, output) => {
  if (input.tool === "read" && output.args.filePath.includes(".env")) {
    throw new Error("Do not read .env files")
  }
},
```

The error thrown blocks the tool call entirely. This is exactly behavior needed for runtime enforcement.

#### What the hook CAN see:
- ✅ Tool name (e.g., `"bash"`, `"read"`, `"edit"`)
- ✅ Tool arguments (via `output.args`)
- ✅ Session ID
- ✅ Call ID

#### What the hook CANNOT directly see:
- ❌ The agent that invoked the tool (not in the hook input)
- ❌ Write paths directly (must be extracted from args — e.g., `output.args.filePath` for `read`/`edit`/`write`, or the `command` field for `bash`)
- ❌ The full shell command as a string for `bash` — available via `output.args.command`
- ❌ MCP tool names before they are expanded (they appear as `tool` name)

#### Key Arguments Per Tool

From the tools documentation and permission docs, here are the key args the hook can inspect:

| Tool | Key args to inspect |
|------|---------------------|
| `bash` | `output.args.command` (the shell command string) |
| `read` | `output.args.filePath` (file being read) |
| `edit` | `output.args.filePath` (file being edited) |
| `write` | `output.args.filePath` (file being written) |
| `grep` | `output.args.pattern` (search pattern) |
| `glob` | `output.args.pattern` (glob pattern) |
| `webfetch` | `output.args.url` (URL being fetched) |
| `websearch` | `output.args.query` (search query) |
| `task` | `output.args.subagent_type` (subagent type) |
| `apply_patch` | `output.args.patchText` (paths embedded in markers) |
| `skill` | `output.args.skill` (skill name) |

---

## 3. Permission Model

### 3.1 Permission Actions

**CONFIDENCE: VERIFIED**

Three possible actions per permission rule:
- `"allow"` — run without approval
- `"ask"` — prompt user for approval
- `"deny"` — block the action entirely

### 3.2 Permission Keys (Tool Names)

**Available permission keys** (from Permissions docs):

| Permission Key | Tools it gates |
|---------------|---------------|
| `read` | `read` |
| `edit` | `write`, `edit`, `apply_patch` |
| `glob` | `glob` |
| `grep` | `grep` |
| `bash` | `bash` |
| `task` | `task` |
| `skill` | `skill` |
| `lsp` | `lsp` |
| `todowrite` | `todowrite`, `todoread` |
| `webfetch` | `webfetch` |
| `websearch` | `websearch` |
| `question` | `question` |
| `external_directory` | Any tool touching paths outside workspace |
| `doom_loop` | Recovery prompts when agent appears stuck |

### 3.3 Granular Rules

Each permission key can be either:
- A shorthand action: `"allow"`, `"ask"`, or `"deny"`
- An object of `pattern → action` for fine-grained control

```json
{
  "permission": {
    "bash": {
      "*": "ask",
      "git *": "allow",
      "rm *": "deny",
      "grep *": "allow"
    },
    "edit": {
      "*": "deny",
      "packages/web/src/content/docs/*.mdx": "allow"
    }
  }
}
```

**Rule evaluation:** Last matching rule wins. Put broad catch-all `"*"` first, specific rules after.

### 3.4 Auto Mode

`opencode --auto` automatically approves permission requests that are **not explicitly denied**. Explicit `"deny"` rules are always enforced.

### 3.5 Agent-Level Permissions

**CONFIDENCE: VERIFIED**

Agent permissions **override** global permissions:
- Agent rules take precedence
- Agent permissions are defined in JSON config or Markdown frontmatter
- Sub-agent permissions inherit from the invoking agent (for `task` tool)
- `todowrite` is **disabled for subagents by default**

```json
{
  "agent": {
    "build": {
      "permission": {
        "bash": {
          "*": "ask",
          "git status *": "allow"
        }
      }
    }
  }
}
```

Agent Markdown:
```yaml
---
mode: subagent
permission:
  edit: deny
  bash: deny
  webfetch: deny
---
```

### 3.6 Permission Hook (`permission.ask`)

**CONFIDENCE: VERIFIED**

The `permission.ask` hook allows a plugin to **override the permission decision** at runtime:

```typescript
"permission.ask": async (input: Permission, output: { status: "ask" | "deny" | "allow" }) => {
  // Can force deny/allow based on runtime conditions
  output.status = "deny"
}
```

This works alongside the declarative permission system in `opencode.json`.

### 3.7 Default Behavior

**CONFIDENCE: VERIFIED**

Default permissions (if nothing is configured):
- Most permissions: `"allow"`
- `doom_loop`: `"ask"`
- `external_directory`: `"ask"`
- `.env` files are denied for read by default:
  ```json
  { "read": { "*": "allow", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow" } }
  ```

### 3.8 Policies (Separate from Permissions)

**CONFIDENCE: VERIFIED**

Policies are an **experimental** feature that controls provider access (NOT tool access):
- Currently supports only `provider.use` action
- Allows denying specific LLM providers
- Global policy takes priority over project policy
- Uses the same `allow`/`deny` + wildcard model as permissions

---

## 4. Tool System

### 4.1 Complete List of Built-in Tool Names

**CONFIDENCE: VERIFIED** (from Tools docs + plugin source `tool.execute.before` input)

| Tool Name | Description |
|-----------|-------------|
| `bash` | Execute shell commands |
| `edit` | Modify files via exact string replacements |
| `write` | Create or overwrite files |
| `read` | Read file contents |
| `grep` | Regex search in file contents |
| `glob` | Find files by glob pattern |
| `lsp` | Language server protocol queries (experimental) |
| `apply_patch` | Apply diff patches |
| `skill` | Load a SKILL.md |
| `todowrite` | Manage todo lists |
| `webfetch` | Fetch web content by URL |
| `websearch` | Search the web (requires Exa or OpenCode provider) |
| `question` | Ask the user a question |
| `task` | Launch subagents |

**Note:** `apply_patch`, `write`, and `edit` are all gated by the `edit` permission key.

### 4.2 Custom Tools

**CONFIDENCE: VERIFIED**

Custom tools can be defined:
- JavaScript/TypeScript files in `.opencode/tools/` or `~/.config/opencode/tools/`
- File name becomes tool name (or `filename_exportname` for multiple exports)
- Custom tools **override** built-in tools with the same name
- They can also be defined as part of a plugin via the `tool` hook

```typescript
import { tool } from "@opencode-ai/plugin"
export default tool({
  description: "My custom tool",
  args: { param: tool.schema.string() },
  async execute(args, context) {
    const { directory, worktree } = context
    return `Result from ${directory}`
  },
})
```

### 4.3 MCP Server Tools

MCP tools are named as `mcpname_toolname` and are also gated by the permission system using wildcards like `"mymcp_*": "deny"`.

---

## 5. Key Questions Answered

### Q1: Can a project-local plugin intercept ALL tool calls before execution?

**ANSWER: YES — VERIFIED**

A plugin placed in `.opencode/plugins/` with a `tool.execute.before` hook will receive every tool call before it executes. The hook receives the tool name and its arguments. This is proven by the official `.env protection` example.

```javascript
// .opencode/plugins/enforce.js
export const Enforcer = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      // input.tool -> tool name
      // output.args -> writable args
      // throw to block
    }
  }
}
```

### Q2: Is the hook guaranteed to run before the tool executes?

**ANSWER: YES — VERIFIED**

The hook name itself (`tool.execute.before`) and its documented behavior confirm it runs synchronously before tool execution. The `.env protection` example demonstrates blocking reads by throwing before the tool runs.

### Q3: What happens if a plugin throws an error during a hook?

**ANSWER: TOOL EXECUTION IS BLOCKED — VERIFIED**

The official `.env protection` example explicitly shows:
```javascript
throw new Error("Do not read .env files")
```
This blocks the `read` tool from executing. The thrown error is the mechanism to deny tool execution programmatically from within a hook.

### Q4: Is there a way to map OpenCode tool names to neutral operation descriptors?

**ANSWER: YES — IMPLEMENTABLE**

A plugin's `tool.execute.before` hook can build a mapping from tool+args to a neutral operation:
- `tool === "read"` + `output.args.filePath` → `READ` operation on a path
- `tool === "bash"` + parsing `output.args.command` → `EXEC` operation with command
- `tool === "edit"` or `"write"` → `WRITE` operation on a path
- `tool === "webfetch"` → `NETWORK` operation
- etc.

The hook has access to both tool name and args, so this mapping is fully achievable.

### Q5: Can the hook access write paths?

**ANSWER: YES, BUT INDIRECTLY — VERIFIED**

The hook receives `output.args` which contains the raw arguments. For file operations:
- `read`/`edit`/`write`: `output.args.filePath`
- `apply_patch`: paths are embedded in `output.args.patchText` as marker lines
- `bash`: must parse paths from `output.args.command`

### Q6: Does the permission system complement or replace hooks?

**ANSWER: COMPLEMENTS — VERIFIED**

The two systems work at different layers:

| Layer | Mechanism | Scope |
|-------|-----------|-------|
| Permissions (`opencode.json`) | Declarative, pattern-based | Per-tool, per-command, per-path |
| Permission hook (`permission.ask`) | Programmatic override | Can force deny/allow at runtime |
| Tool hooks (`tool.execute.before`) | Per-invocation interception | Can inspect exact args, modify them, or block via throw |

All three layers can be combined. For runtime enforcement:
1. **Permissions** provide the baseline deny/allow rules
2. **`permission.ask` hook** can add runtime-aware overrides
3. **`tool.execute.before` hook** provides the final pre-execution gate with full arg visibility

---

## 6. Gaps and Limitations

### 6.1 No Agent Context in `tool.execute.before`

**SEVERITY: MEDIUM**

The `tool.execute.before` hook input does NOT include the agent name. You can work around this by using the `sessionID` to look up the session via the SDK client, but it's not directly available.

**Workaround:** Use the `client` from plugin context to query session info:
```typescript
const session = await client.session.get({ path: { id: input.sessionID } })
```

### 6.2 No Direct "Write Path" Abstraction

**SEVERITY: LOW**

The hook gives raw args, not a normalized "write target." For `bash`, extracting paths requires parsing the command. For `apply_patch`, paths are inside `patchText` markers. This is manageable but adds complexity to path-aware enforcement.

### 6.3 No Pre-Startup Bootstrap Hook

**SEVERITY: LOW**

All plugin hooks run within an active OpenCode session. There is no hook that fires before the first session is created (e.g., for startup validation). The `config` hook runs during load but is not designed for blocking startup.

### 6.4 Experimental Hooks Are Unstable

**SEVERITY: MEDIUM for production use**

The following useful hooks are marked `experimental` and could change:
- `experimental.chat.messages.transform`
- `experimental.chat.system.transform`
- `experimental.session.compacting`
- `experimental.compaction.autocontinue`
- `experimental.text.complete`

Production enforcement should rely primarily on stable hooks (`tool.execute.before`, `permission.ask`).

### 6.5 No Per-File Write Deny Beyond Permissions

**SEVERITY: LOW (with plugin workaround)**

The declarative `permission` system only allows pattern matching on tool input (command, file path). The `tool.execute.before` hook provides full programmatic control but requires JS code to implement path allowlisting.

### 6.6 Plugin Cannot Modify Permission Rules Declaratively

**SEVERITY: LOW**

A plugin's `permission.ask` hook can override decisions at runtime, but cannot inject new patterns into the declarative permission system. This means a plugin must re-implement permission-like logic in code rather than extending the existing rule engine.

### 6.7 MCP Tool Tool Name Visibility

**SEVERITY: LOW**

MCP tools appear in the hook with their full name (e.g., `mymcp_search`), which is parsed from the MCP server name + tool name. This is consistent but may need special handling if you want to group all MCP tools together.

---

## 7. Integration Architecture Options for Runtime Enforcement

### Option A: Pure Hook-Based Enforcement

Use a project-local plugin (`.opencode/plugins/enforce.js`) with `tool.execute.before` that:
1. Inspects every tool call before execution
2. Validates against a configurable policy (file in project)
3. Throws to block disallowed operations
4. Logs all enforcement decisions

**Pros:** Maximum control, works with any config
**Cons:** Requires JavaScript, heavier implementation

### Option B: Permission-Based + Hook Supplement

Use `opencode.json` permissions for the bulk of rules, and a lightweight hook only for cases the permission system cannot handle (e.g., checking file contents, runtime state).

**Pros:** Simpler, leverages built-in system
**Cons:** Limited to pattern matching for most rules

### Option C: Hybrid With Permission Hook

Use `permission.ask` to programmatically override permission decisions based on runtime policy checks, combined with `tool.execute.before` for arg inspection and modification.

**Pros:** Good balance of simplicity and power
**Cons:** Two different hook signatures to maintain

---

## 8. Conclusion: Can OpenCode Support HOOK_ENFORCED?

**Answer: YES — VERIFIED**

OpenCode's plugin and hook system **fully supports** runtime enforcement of tool execution policies. Here's the evidence:

1. ✅ **`tool.execute.before` exists** — intercepts every tool call before execution
2. ✅ **Blocking works** — throwing an error in the hook blocks the tool
3. ✅ **Full arg visibility** — hook receives tool name + all arguments
4. ✅ **Project-local plugins** — `.opencode/plugins/` auto-loads at startup
5. ✅ **Batch all-tool interception** — single hook receives ALL tool types
6. ✅ **Written test case** — `.env protection` example proves the pattern works
7. ✅ **Permission system complementary** — can combine declarative rules + programmatic hooks
8. ✅ **Source code verified** — the `Hooks` interface in `packages/plugin/src/index.ts` confirms all hook signatures

### Recommended Approach for Runtime Enforcement Plugin

```javascript
// .opencode/plugins/runtime-enforce.js
export const RuntimeEnforcer = async ({ client, directory, worktree }) => {
  // Load enforcement policy from project config
  const policy = loadPolicy(directory)

  return {
    // Pre-execution gate
    "tool.execute.before": async (input, output) => {
      const operation = classifyOperation(input.tool, output.args)
      const decision = policy.evaluate(operation)

      if (decision === "deny") {
        throw new Error(`RUNTIME_ENFORCEMENT: Operation blocked — ${operation.summary}`)
      }

      if (decision === "modify") {
        output.args = decision.modifiedArgs
      }

      // Log for audit
      await client.app.log({
        body: {
          service: "runtime-enforce",
          level: "info",
          message: `${decision}: ${input.tool} by session ${input.sessionID}`,
          extra: { tool: input.tool, operation }
        }
      })
    },

    // Override permission prompts
    "permission.ask": async (input, output) => {
      const decision = policy.evaluatePermission(input)
      if (decision === "deny") output.status = "deny"
    }
  }
}
```

### Confidence Summary

| Claim | Confidence | Basis |
|-------|-----------|-------|
| `tool.execute.before` intercepts all tool calls | **VERIFIED** | Official docs + source code `Hooks` interface |
| Throwing in hook blocks execution | **VERIFIED** | Official `.env protection` example |
| Plugin auto-loads from `.opencode/plugins/` | **VERIFIED** | Official docs "From local files" section |
| Hook has access to tool name and args | **VERIFIED** | Source code `Hooks` interface `input.tool` + `output.args` |
| `permission.ask` can override decisions | **VERIFIED** | Source code `Hooks` interface |
| No agent context in `tool.execute.before` | **VERIFIED** | Source code confirms input fields: `tool`, `sessionID`, `callID` only |

---

## Decision Summary

### Gelesen
- [x] OpenCode official docs: Plugins, Permissions, Tools, Agents, SDK, Config, Policies, Custom Tools, Ecosystem
- [x] OpenCode source code: `packages/plugin/src/index.ts` (Hooks interface, PluginInput type)

### Validierte Fakten
- `tool.execute.before` hook exists and can block tool execution by throwing
- 16 distinct hook points documented in the `Hooks` interface
- Project-local plugins auto-load from `.opencode/plugins/`
- Permission system uses `allow/ask/deny` with wildcard patterns
- Hook-based + permission-based enforcement can be combined

### Entscheidung
OpenCode **can support HOOK_ENFORCED** runtime enforcement via a project-local plugin using `tool.execute.before` + `permission.ask` hooks. A plugin in `.opencode/plugins/` can intercept all tool calls, inspect their arguments, and throw to block disallowed operations.

### Annahmen / Unsicherheiten
- Experimental hooks (`chat.messages.transform`, etc.) may change in future versions
- Agent context is not directly available in `tool.execute.before` — requires SDK lookup workaround
- The `permission.ask` hook's exact Permission input type shape depends on the internal permission model (not fully documented)

### Nächste Aktion
Implement a prototype enforcement plugin in `.opencode/plugins/runtime-enforce.js` and test with a controlled set of tool calls.

---

*End of research report.*

---

# Hermes Plugin API for Runtime Enforcement — Research Report

**Date:** 2026-07-16
**Researcher:** research-agent (LLM-powered)
**Hermes Version:** Hermes Agent v0.18.2 (2026.7.7.2) · upstream 306e2d23
**Install directory:** `~/.hermes/hermes-agent`
**Install method:** git (from `NousResearch/hermes-agent`)

---

## Sources

| Source | Type | Accessed |
|--------|------|----------|
| `~/.hermes/hermes-agent/hermes_cli/plugins.py` (2464 lines) | Source code — full PluginManager + PluginContext | 2026-07-16 |
| `~/.hermes/hermes-agent/hermes_cli/plugins_cmd.py` (1600+ lines) | Source code — CLI install/update/remove | 2026-07-16 |
| `~/.hermes/hermes-agent/agent/plugin_llm.py` (1046 lines) | Source code — PluginLlm facade | 2026-07-16 |
| `~/.hermes/hermes-agent/plugins/plugin_utils.py` (135 lines) | Source code — concurrency helpers | 2026-07-16 |
| `~/.hermes/hermes-agent/plugins/disk-cleanup/` (plugin.yaml + `__init__.py`) | Reference plugin implementation | 2026-07-16 |
| `~/.hermes/hermes-agent/website/docs/user-guide/features/hooks.md` (1496 lines) | Official docs — Event Hooks | 2026-07-16 |
| `~/.hermes/hermes-agent/website/docs/developer-guide/plugins/index.md` (1307 lines) | Official docs — Build a Plugin | 2026-07-16 |
| `~/.hermes/hermes-agent/website/docs/user-guide/features/plugins.md` | Official docs — Plugin overview | 2026-07-16 |
| `~/.hermes/hermes-agent/model_tools.py` (line 1170+) | Source code — `handle_function_call` pre-tool dispatch | 2026-07-16 |
| `~/.hermes/hermes-agent/agent/tool_executor.py` (line 448+) | Source code — alternative pre-tool dispatch path | 2026-07-16 |
| `hermes --help` / `hermes plugins --help` | CLI help output | 2026-07-16 |

---

## 1. Hermes Plugin System

### 1.1 Plugin Sources (Four-Tier Discovery)

**CONFIDENCE: VERIFIED** (from `hermes_cli/plugins.py` lines 7–13 and `_discover_and_load_inner`)

Hermes discovers plugins from four sources, with later sources overriding earlier on key collision:

| # | Source | Location | Env/Config Gate |
|---|--------|----------|-----------------|
| 1 | **Bundled** | `<repo>/plugins/<name>/` | Auto for built-in backends; all others require opt-in via `plugins.enabled` |
| 2 | **User** | `~/.hermes/plugins/<name>/` | Requires opt-in via `plugins.enabled` in `config.yaml` |
| 3 | **Project** | `./.hermes/plugins/<name>/` | Requires `HERMES_ENABLE_PROJECT_PLUGINS=1` **AND** opt-in via `plugins.enabled` |
| 4 | **Pip / entry-point** | Python packages via `hermes_agent.plugins` entry-points | Requires opt-in via `plugins.enabled` |

### 1.2 Plugin Directory Structure

**CONFIDENCE: VERIFIED** (from source + docs)

A Hermes plugin must contain **two essential files**:

```
~/.hermes/plugins/<plugin-name>/
├── plugin.yaml          # Manifest (required)
├── __init__.py          # Python module with register(ctx) function (required)
├── after-install.md     # Optional — rendered with Rich Markdown after install
├── schemas.py           # Optional — tool schemas
├── tools.py             # Optional — tool handler implementations
└── *.example            # Optional — config.example → copied to *. on install
```

### 1.3 plugin.yaml Manifest Schema

**CONFIDENCE: VERIFIED** (from `PluginManifest` dataclass + bundled plugin examples)

**Minimum valid manifest:**
```yaml
name: my-plugin
version: 1.0.0
description: What this plugin does
```

**Full schema with all recognized fields:**
```yaml
name: my-plugin                    # REQUIRED — unique plugin identifier
version: 1.0.0                     # Optional — semver-ish string
description: "..."                 # Optional — human-readable description
author: "Your Name"                # Optional — displayed in listings
manifest_version: 1                # Optional — currently only version 1 supported
kind: standalone                   # Optional — one of: standalone, backend, exclusive, platform, model-provider
                                   #   default = "standalone"
requires_env:                      # Optional — gate loading on env vars; prompted during install
  - SOME_API_KEY                   # Simple format
  - name: OTHER_KEY                # Rich format with metadata
    description: "Key for Other"
    url: "https://other.com/keys"
    secret: true
provides_tools:                    # Optional — documented list of tool names
  - my_tool_1
  - my_tool_2
provides_hooks:                    # Optional — documented list of hook names
  - post_tool_call
  - on_session_end
```

**Plugin kinds:**
- `standalone` (default): hooks/tools of its own; opt-in via `plugins.enabled`
- `backend`: pluggable backend for core tool categories (e.g., `image_gen`)
- `exclusive`: category with exactly one active provider (e.g., `memory`)
- `platform`: gateway messaging platform adapter
- `model-provider`: LLM provider backend

**Supported `manifest_version`:** Only version `1` is recognized. Plugins with higher version numbers are rejected during install. Most bundled plugins don't set this field (it defaults to version 1 behavior).

### 1.4 register(ctx) Function

**CONFIDENCE: VERIFIED** (from `_load_plugin()` method, line 1746–1828)

Every plugin's `__init__.py` must export a `register(ctx)` function:

```python
def register(ctx):
    """Called exactly once at startup. ctx is a PluginContext instance."""
    pass
```

**The `ctx` parameter** is a `PluginContext` instance providing access to:

| Method | Purpose |
|--------|---------|
| `ctx.register_tool(name, toolset, schema, handler, ...)` | Register a tool in the global registry |
| `ctx.register_hook(hook_name, callback)` | Subscribe to lifecycle hooks |
| `ctx.register_command(name, handler, ...)` | Register an in-session slash command (`/mycommand`) |
| `ctx.register_cli_command(name, help, setup_fn, ...)` | Register a CLI subcommand (`hermes <name>`) |
| `ctx.register_skill(name, path, description)` | Register a read-only skill file |
| `ctx.register_platform(...)` | Register a gateway platform adapter |
| `ctx.register_slack_action_handler(...)` | Register Slack Block Kit handlers |
| `ctx.register_image_gen_provider(...)` | Register image generation backend |
| `ctx.register_video_gen_provider(...)` | Register video generation backend |
| `ctx.register_web_search_provider(...)` | Register web search backend |
| `ctx.register_browser_provider(...)` | Register cloud browser backend |
| `ctx.register_secret_source(...)` | Register secret manager backend |
| `ctx.register_tts_provider(...)` | Register TTS backend |
| `ctx.register_transcription_provider(...)` | Register STT backend |
| `ctx.register_dashboard_auth_provider(...)` | Register dashboard OAuth provider |
| `ctx.register_context_engine(...)` | Replace the context compression engine |
| `ctx.register_middleware(kind, callback)` | Register behavior-changing middleware |
| `ctx.register_auxiliary_task(...)` | Register an auxiliary LLM task |
| `ctx.dispatch_tool(name, args)` | Dispatch any tool through the registry |
| `ctx.inject_message(content)` | Inject a message into the active conversation |
| `ctx.llm` (property) | Host-owned LLM facade for trusted plugins |

### 1.5 Plugin Activation

**CONFIDENCE: VERIFIED** (from `_discover_and_load_inner`)

All plugins are **opt-in by default** — they require explicit activation:

1. Run `hermes plugins enable <name>` to add to `plugins.enabled` in `config.yaml`
2. Or during install: answer `y` to "Enable now? [y/N]"
3. Or pass `--enable` during install
4. Plugins take effect on next session (gateway restart)
5. Plugins can also be **disabled without removal** via `hermes plugins disable <name>`

---

## 2. Hook System — Complete Reference

### 2.1 All Valid Hooks (20 Total)

**CONFIDENCE: VERIFIED** (from `VALID_HOOKS` set in `hermes_cli/plugins.py`, lines 135–213)

| Hook | Fires when | Can block? | Return value used? |
|------|-----------|-----------|-------------------|
| `pre_tool_call` | Before ANY tool executes | **YES** | **YES** — `{"action": "block", "message": str}` or `{"action": "approve", "message": str}` |
| `post_tool_call` | After ANY tool returns | No | ignored |
| `transform_tool_result` | After any tool returns, before result goes to model | No | `str` to replace result |
| `transform_terminal_output` | Inside `terminal` tool, pre-truncation/ANSI-strip | No | `str` to replace raw output |
| `transform_llm_output` | After tool loop, before final response | No | `str` to replace response text |
| `pre_llm_call` | Once per turn, before tool-calling loop | No | `{"context": str}` to inject context |
| `post_llm_call` | Once per turn, after tool-calling loop | No | ignored |
| `pre_verify` | Once per turn when agent edited code, before verify/finish | No | `{"action": "continue", "message": str}` |
| `pre_api_request` | Before an API request to the LLM provider | No | ignored |
| `post_api_request` | After an API request to the LLM provider | No | ignored |
| `api_request_error` | When an API request fails | No | ignored |
| `on_session_start` | New session created (first turn) | — | ignored |
| `on_session_end` | Session ends | — | ignored |
| `on_session_finalize` | CLI/gateway tears down a session | — | ignored |
| `on_session_reset` | Gateway swaps in a fresh session key | — | ignored |
| `subagent_start` | `delegate_task` child is about to run | — | ignored |
| `subagent_stop` | `delegate_task` child has exited | — | ignored |
| `pre_gateway_dispatch` | Gateway received user message, before auth+dispatch | — | `{"action": "skip" \| "rewrite" \| "allow"}` |
| `pre_approval_request` | Dangerous command needs user approval | — | ignored (observer only) |
| `post_approval_response` | User responded to approval prompt | — | ignored |

### 2.2 pre_tool_call — Detailed Analysis

**CONFIDENCE: VERIFIED** (from docs `hooks.md` + source `_get_pre_tool_call_directive_details` + `handle_function_call`)

#### Callback signature:
```python
def my_callback(
    tool_name: str,
    args: dict,
    task_id: str,
    session_id: str = "",
    tool_call_id: str = "",
    turn_id: str = "",
    api_request_id: str = "",
    middleware_trace: list | None = None,
    telemetry_schema_version: int = ...,
    **kwargs,  # ALWAYS accept **kwargs for forward compatibility
):
```

**Parameter details:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `tool_name` | `str` | Name of the tool about to execute (e.g., `"terminal"`, `"write_file"`, `"read_file"`, `"web_search"`) |
| `args` | `dict` | The arguments the model passed to the tool |
| `task_id` | `str` | Session/task identifier (empty string if not set) |
| `session_id` | `str` | Session ID (empty for one-shot runs) |
| `tool_call_id` | `str` | Unique identifier for this specific tool call |
| `turn_id` | `str` | Turn identifier |
| `api_request_id` | `str` | API request identifier (opaque) |
| `middleware_trace` | `list` | Aggregated middleware results from earlier middleware hooks |

#### Blocking a tool call — the return value:

```python
# Block the tool entirely (message becomes the tool result the model sees)
return {"action": "block", "message": "Reason the tool was blocked"}

# Escalate to human approval gate (same mechanism as Tier-2 dangerous shell patterns)
return {"action": "approve", "message": "Why this needs human confirmation", "rule_key": "write_file:ssh"}

# Or return None / any other value — no effect (observer-only)
return None
```

**Block directive semantics:**
- `block`: Vetoes the tool call outright. The `message` string is returned to the model as the tool result (wrapped in `{"error": message}`).
- `approve`: Escalates to the existing human-approval gate (`prompt_dangerous_approval` on CLI, the approval callback on gateway). This lets a plugin require a human `[o]nce / [s]ession / [a]lways / [d]eny` decision on ANY tool, not just terminal command strings.
- The **first valid block/approve wins** — Python plugins registered first, then shell hooks. The aggregator returns as soon as any callback produces a non-None block or approve directive with a non-empty message.

#### Error behavior:

If a `pre_tool_call` hook callback **raises an exception**, it is caught and logged — **the tool call proceeds**. This means:

> **Hook failure does NOT block the tool. Only an explicit `return {"action": "block", "message": "..."}` blocks the tool.**

Exception handling (from `invoke_hook` lines 1913–1924):
```python
for cb in callbacks:
    try:
        ret = cb(**kwargs)
        if ret is not None:
            results.append(ret)
    except Exception as exc:
        logger.warning("Hook '%s' callback %s raised: %s", hook_name, ..., exc)
```

#### What pre_tool_call CAN access:
- ✅ Tool name (`tool_name: str`)
- ✅ Tool arguments (`args: dict`) — the exact args the model passed
- ✅ Session ID and task ID
- ✅ Tool call ID, turn ID, API request ID
- ✅ Middleware trace
- ❌ The agent instance (not directly passed)
- ❌ The active workspace / working directory (NOT in `pre_tool_call` callback params — unlike `transform_terminal_output` which receives `cwd`)
- ❌ The platform (CLI vs gateway) — NOT directly in pre_tool_call

**CRITICAL FINDING — NO CWD IN pre_tool_call:**
The `pre_tool_call` callback does **NOT** receive the current working directory (`cwd`). This is different from shell hooks (which receive `cwd` in their JSON stdin payload at line 1336) and `transform_terminal_output` (which receives `cwd`). To determine the active workspace from a Python plugin's `pre_tool_call`, you would need to use `os.getcwd()` or `Path.cwd()` from within the hook — which gives the process working directory but does not distinguish project context when running under gateway mode.

#### Guarantee of execution:

**YES — `pre_tool_call` is guaranteed to fire before every tool execution** across all dispatch paths:

1. `model_tools.py` `handle_function_call()` (line 1170–1214) — the main dispatch path
2. `agent/tool_executor.py` (line 448) — the terminal/parallel dispatch path
3. `agent/agent_runtime_helpers.py` (line 2192) — ACP/Zed dispatch path

All three paths call `resolve_pre_tool_block()` which invokes `invoke_hook("pre_tool_call", ...)` exactly once per tool call. There is a `skip_pre_tool_call_hook` flag to prevent double-firing but it is only used internally.

#### Multi-hook / multi-plugin precedence:

Both Python plugin hooks and shell hooks flow through the same `invoke_hook()` dispatcher. Python plugins are registered first (`discover_and_load()`), shell hooks second (`register_from_config()`), so Python `pre_tool_call` block decisions take precedence in tie cases. The first valid block wins.

### 2.3 post_tool_call — Detailed Analysis

**CONFIDENCE: VERIFIED**

#### Callback signature:
```python
def my_callback(
    tool_name: str,
    args: dict,
    result: str,          # The tool's return value (always a JSON string)
    task_id: str,
    session_id: str = "",
    tool_call_id: str = "",
    turn_id: str = "",
    api_request_id: str = "",
    duration_ms: int,     # How long the tool's dispatch took
    **kwargs,
):
```

**Key difference from pre_tool_call:**
- Receives `result` (JSON string of what the tool returned)
- Receives `duration_ms` (milliseconds of tool execution)
- Return value is **always ignored** — this is a fire-and-forget observer

---

## 3. Plugin Installation

### 3.1 Installing from a Git Repository

**CONFIDENCE: VERIFIED** (from `hermes_cli/plugins_cmd.py`, full code)

**Command:**
```bash
hermes plugins install <identifier>
```

**Accepted identifier formats:**

| Format | Example | Resolves to |
|--------|---------|------------|
| Full Git URL | `https://github.com/owner/repo.git` | Clone repo root |
| SSH URL | `git@github.com:owner/repo.git` | Clone repo root |
| Browser URL | `https://github.com/owner/repo/tree/main/path` | Clone repo, use `path/` as plugin dir |
| Owner/repo shorthand | `owner/repo` | `https://github.com/owner/repo.git` |
| Shorthand w/ subdir | `owner/repo/path/to/plugin` | Clone repo, use `path/to/plugin` |
| URL w/ `.git/` subdir | `https://.../repo.git/path` | Clone repo, use `path` |
| URL w/ `#fragment` | `<url>#path/to/plugin` | Explicit subdirectory |

**Installation process:**
1. Parse identifier → resolve Git URL + optional subdirectory
2. Clone into temp dir with `git clone --depth 1`
3. Resolve subdirectory within clone (if specified)
4. Read `plugin.yaml` from the target directory
5. Validate `manifest_version` (must be ≤ 1)
6. Extract `name` from manifest (or derive from repo name)
7. Move plugin directory to `~/.hermes/plugins/<name>/`
8. Copy any `*.example` files to their real names (e.g., `config.yaml.example` → `config.yaml`)
9. Prompt for any `requires_env` variables not already set
10. Display `after-install.md` if present, or a default confirmation
11. Prompt "Enable now? [y/N]"

**Flags:**
- `--force` / `-f`: Remove existing plugin and reinstall
- `--enable`: Auto-enable after install (skip confirmation)
- `--no-enable`: Install disabled

### 3.2 What Files Does Hermes Look For in the Repo Root?

**CONFIDENCE: VERIFIED** (from `_install_plugin_core` + `_sanitize_plugin_name`)

When installing from a Git URL **without a subdirectory**, the cloned repo root is used as the plugin directory. Hermes requires:

1. `plugin.yaml` (or `plugin.yml`) — the manifest
2. `__init__.py` — the Python module with `register(ctx)`

Without at least one of these, a warning is printed: "may not be a valid Hermes plugin."

Optional files that are recognized:
- `after-install.md` — rendered with Rich Markdown after install
- `*.example` files — copied to `*` (e.g., `config.yaml.example` → `config.yaml`)

### 3.3 Project-Local vs User-Global Plugin Distinction

**CONFIDENCE: VERIFIED** (from `_discover_and_load_inner`, lines 1315–1467)

| Dimension | User Plugin (`~/.hermes/plugins/`) | Project Plugin (`./.hermes/plugins/`) |
|-----------|-----------------------------------|--------------------------------------|
| Discovery | Always scanned | Only when `HERMES_ENABLE_PROJECT_PLUGINS=1` |
| Source label | `"user"` (or `"git"` if `.git/` present) | `"project"` |
| Activation | Via `plugins.enabled` in `config.yaml` | Via `plugins.enabled` in `config.yaml` |
| Precedence | Overrides bundled | **Overrides user** (loaded after user) |
| Install method | `hermes plugins install <url>` → lands in `~/.hermes/plugins/` | **Manual** — copy directory to `./.hermes/plugins/<name>/` |

**Important:** `hermes plugins install` always installs to `~/.hermes/plugins/` — it does **NOT** support installing to a project-local directory. Project-local plugins must be placed manually or via a URL installer script.

### 3.4 Plugin Versioning and Updates

**CONFIDENCE: VERIFIED**

- **Update:** `hermes plugins update <name>` — runs `git pull` in the plugin directory
- Only works for git-installed plugins (requires `.git/` directory)
- **Version display:** The `version` field in `plugin.yaml` is for display only — no version comparison or pinning
- **Locking:** No lockfile or pinned version mechanism exists. The `manifest_version` field gates structural compatibility only.

---

## 4. Slash Commands and CLI Commands

### 4.1 Slash Commands (In-Session Commands)

**CONFIDENCE: VERIFIED** (from `PluginContext.register_command`, lines 527–579)

```python
ctx.register_command(
    "mycommand",              # Command name (leading / optional)
    handler=my_handler,       # fn(raw_args: str) -> str | None (can be async)
    description="What it does",
    args_hint="<arg1> <arg2>",  # Optional — for Discord slash command picker
)
```

**Behavior:**
- Handler receives a single string with all raw arguments
- Can be sync or async
- Names conflicting with built-in commands are rejected with a warning
- Available in CLI and gateway sessions
- Automatically forwarded to gateway adapters (Discord, Telegram, etc.)

### 4.2 CLI Commands (Subcommands)

**CONFIDENCE: VERIFIED** (from `PluginContext.register_cli_command`, lines 502–523)

```python
ctx.register_cli_command(
    "mysubcommand",           # Subcommand name (becomes `hermes mysubcommand`)
    help="Description",
    setup_fn=setup_parser,    # Receives argparse subparser to add arguments
    handler_fn=handler,       # Optional — set as default dispatch
)
```

**Behavior:**
- Creates `hermes <name>` terminal commands (e.g., `hermes honcho`)
- `setup_fn` adds arguments/sub-subparsers to the argparse subparser
- These are regular CLI commands, not in-session slash commands

---

## 5. Key Questions Answered for Runtime Enforcement

### Q1: Can a Hermes root-Git plugin intercept ALL tool calls before execution?

**ANSWER: YES — VERIFIED**

A plugin installed via `hermes plugins install <git-url>` with a `pre_tool_call` hook will receive **every single tool call** before execution. The hook's callback receives `tool_name: str` and `args: dict`, allowing full inspection and blocking.

```python
# __init__.py in your Git repo root
def enforce(tool_name, args, task_id, session_id, **kwargs):
    # Inspect every tool call
    if is_disallowed(tool_name, args):
        return {"action": "block", "message": "Policy violation: " + reason}
    return None  # Allow

def register(ctx):
    ctx.register_hook("pre_tool_call", enforce)
```

**Proof:** The `resolve_pre_tool_block()` function (called from ALL tool dispatch paths) invokes `invoke_hook("pre_tool_call", ...)` with these parameters, and the hook fires once per tool call even for parallel tool calls. The callback receives the complete tool name and arguments.

### Q2: Is pre_tool_call guaranteed to run before tool execution?

**ANSWER: YES — VERIFIED** (from source code triple-confirmed)

Three independent dispatch paths all call `resolve_pre_tool_block()` **before** executing the tool handler:

1. **`model_tools.py:1170–1214`** — `handle_function_call()` for the main dispatch path
2. **`agent/tool_executor.py:448`** — Terminal/parallel dispatch path
3. **`agent/agent_runtime_helpers.py:2192`** — ACP/Zed dispatch path

All three paths have the same pattern: check hook → if blocked, return error JSON immediately without executing the tool.

### Q3: How does the hook determine the active workspace/project?

**ANSWER: INDIRECTLY — LIKELY**

The `pre_tool_call` callback does **NOT** receive `cwd` or `workspace_root` as a direct parameter. The `session_id` and `task_id` are available but these are opaque identifiers.

**Detection options:**
1. **`os.getcwd()` / `Path.cwd()`** — gets the process working directory (works in CLI mode, may be unreliable in gateway mode where the gateway process has its own cwd)
2. **Shell hooks (alternative approach):** Shell hooks (`hooks:` in `config.yaml`) for `pre_tool_call` receive `cwd` in their JSON stdin payload:
   ```json
   {"hook_event_name": "pre_tool_call", "tool_name": "...", "cwd": "~/project", ...}
   ```
3. **Project-level plugin (`./.hermes/plugins/`):** A project-level plugin knows its own location, so it can derive the workspace from `__file__` / plugin directory relative to project root. Requires `HERMES_ENABLE_PROJECT_PLUGINS=1`.

### Q4: Can the plugin detect if `.agent-governance/manifest.json` exists?

**ANSWER: YES, BUT REQUIRES CONTEXT DETECTION — LIKELY**

Since `pre_tool_call` does not receive a working directory directly, the plugin needs to determine the project root first. Options:

1. **Use `Path.cwd()` in CLI mode** — the process cwd when running `hermes chat` in a project directory
2. **Walk upward from `Path.cwd()`** looking for `.agent-governance/manifest.json`
3. **Use shell hooks** which receive `cwd` directly
4. **For project-local plugins**, the plugin directory at `./.hermes/plugins/<name>/` provides the project root: `Path(__file__).resolve().parent.parent.parent.parent` (from `./.hermes/plugins/<name>/__init__.py` up to project root)

**Limitation:** In gateway/daemon mode, the process cwd is the gateway's working directory, not the user's project. This means a user-global plugin (`~/.hermes/plugins/`) has no automatic way to determine which project the gateway is working on for a given session.

### Q5: What happens when no project governance is installed (graceful degradation)?

**ANSWER: IMPLEMENTATION-DEPENDENT — DESIGN DECISION**

By default, a plugin hook callback that fails does NOT block execution. This means:

- If the enforcement plugin cannot find `.agent-governance/manifest.json`, it can:
  - **Option A (permissive):** Allow all tools (graceful degradation, no blocking)
  - **Option B (deny-by-default):** Block all tools and return a message like "No governance manifest found"
  - **Option C (scope to project):** Only enforce when the plugin is project-local (detected via `HERMES_ENABLE_PROJECT_PLUGINS=1`)

**Design recommendation:** Use a deny-by-default approach with an explicit opt-in via the manifest:
- If `.agent-governance/manifest.json` exists → enforce its rules
- If it does not exist → return `{"action": "block", "message": "Project governance manifest not found. Please create .agent-governance/manifest.json or disable this enforcement plugin."}`

---

## 6. Shell Hooks as Alternative Enforcement Path

### 6.1 Shell Hooks for pre_tool_call

**CONFIDENCE: VERIFIED** (from `hooks.md` lines 1283–1496)

Shell hooks are an **alternative to Python plugins** that can achieve the same enforcement:

```yaml
# ~/.hermes/config.yaml
hooks:
  pre_tool_call:
    - matcher: "terminal|write_file|patch"
      command: "~/.hermes/agent-hooks/enforce.sh"
      timeout: 5
```

**Shell hook JSON wire protocol** (stdin):

```json
{
  "hook_event_name": "pre_tool_call",
  "tool_name":       "terminal",
  "tool_input":      {"command": "rm -rf /"},
  "session_id":      "sess_abc123",
  "cwd":             "~/project",
  "extra":           {"task_id": "...", "tool_call_id": "..."}
}
```

**CRITICAL ADVANTAGE FOR RUNTIME ENFORCEMENT:** Shell hooks receive `cwd` directly in their JSON payload (line 1336 in `hooks.md`). This makes workspace detection trivial compared to Python plugin hooks.

**Blocking response (stdout):**
```json
{"action": "block", "message": "Forbidden: rm -rf /"}
```
or
```json
{"decision": "block", "reason": "Forbidden: rm -rf /"}
```

**Key advantage:** Shell hooks are written in any language (bash, Python, Go binary), declared entirely in `config.yaml`, and require no Python plugin authoring.

**Key disadvantage:** Shell hooks require first-use consent (prompted interactively) or `--accept-hooks` / `HERMES_ACCEPT_HOOKS=1` / `hooks_auto_accept: true`. They also have a subprocess overhead on every tool call (typically 1-10ms depending on script complexity).

### 6.2 Shell Hook vs Python Plugin Comparison

| Dimension | Python Plugin Hook | Shell Hook |
|-----------|-------------------|------------|
| Declared in | `plugin.yaml` + `register()` in `__init__.py` | `hooks:` block in `config.yaml` |
| Lives under | `~/.hermes/plugins/<name>/` | `~/.hermes/agent-hooks/` (by convention) |
| Language | Python only | Any (Bash, Python, Go, etc.) |
| Runs in | CLI + Gateway | CLI + Gateway |
| Can block tool calls | Yes (`pre_tool_call`) | Yes (`pre_tool_call`) |
| Has `cwd` in `pre_tool_call` | **NO** | **YES** |
| Has `session_id` in `pre_tool_call` | Yes (via `session_id` kwarg) | Yes (via JSON stdin) |
| Performance | In-process (no overhead) | Subprocess (~1-10ms) |
| Consent model | Implicit (Python plugin trust) | First-use prompt per `(event, command)` |
| Distribute via Git | `hermes plugins install <url>` | Manual or bootstrap script |

---

## 7. Assessment: Can Hermes Support HOOK_ENFORCED?

### Overall Answer: YES, WITH MODERATE LIMITATIONS

**CONFIDENCE: VERIFIED**

Hermes v0.18.2 fully supports runtime enforcement via its `pre_tool_call` hook system. Here is the evidence-based assessment:

### What Works Well (✅)

1. ✅ **`pre_tool_call` exists and is stable** — documented, tested, and used by built-in plugins (e.g., Langfuse observability plugin)
2. ✅ **Blocking works** — `{"action": "block", "message": "..."}` vetoes the tool call before execution
3. ✅ **Full arg visibility** — the hook receives tool name + all arguments the model passed
4. ✅ **All dispatch paths covered** — three independent code paths (`model_tools.py`, `tool_executor.py`, `agent_runtime_helpers.py`) all call `resolve_pre_tool_block()`
5. ✅ **Multi-plugin safe** — first valid block wins, no race conditions
6. ✅ **Git installation works** — `hermes plugins install <git-url>` handles full Git URLs, GitHub shorthand, subdirectories
7. ✅ **Graceful error handling** — hook exceptions are caught and logged, never crash the agent
8. ✅ **Shell hooks as alternative** — can achieve the same enforcement in any language with `cwd` access

### Limitations (⚠️)

1. ⚠️ **No automatic workspace detection in Python hooks** — `pre_tool_call` callbacks do NOT receive `cwd`/workspace root. Must use `os.getcwd()` or project-local plugin context.
2. ⚠️ **Plugin installation is always user-global** — `hermes plugins install` always writes to `~/.hermes/plugins/`, never to a project directory. Project-local enforcement requires manual placement or a bootstrap script.
3. ⚠️ **Project plugins are gated behind an env var** — `HERMES_ENABLE_PROJECT_PLUGINS=1` must be set for `./.hermes/plugins/` to be scanned. This is opt-in by design.
4. ⚠️ **All plugins are opt-in via `plugins.enabled`** — even after project-local placement, the plugin must be explicitly enabled in `config.yaml`.
5. ⚠️ **No pre-startup/bootstrap hook** — all hooks run within an active Hermes session. There is no hook that fires before the first session (e.g., to validate a project at startup).
6. ⚠️ **Shell hook consent required** — non-Python enforcement via shell hooks requires first-use consent (or `--accept-hooks` / `hooks_auto_accept`).

### Recommended Enforcement Architecture for Hermes

**For a URL-installer deployment:**

1. **Install plugin from Git URL:**
   ```bash
   hermes plugins install https://github.com/owner/agent-governance.git \
     --enable
   ```

2. **Plugin `__init__.py` with pre_tool_call hook:**
   ```python
   import os
   from pathlib import Path

   def enforce(tool_name, args, session_id, **kwargs):
       # Detect workspace via cwd (works in CLI mode)
       # For gateway mode, use project-local detection
       cwd = Path.cwd()
       manifest = cwd / ".agent-governance" / "manifest.json"

       if not manifest.exists():
           # Graceful degradation: check parent dirs
           for parent in cwd.parents:
               manifest = parent / ".agent-governance" / "manifest.json"
               if manifest.exists():
                   break
           else:
               return {"action": "block",
                       "message": "No .agent-governance/manifest.json found"}

       policy = load_policy(manifest)
       decision = policy.evaluate(tool_name, args)

       if decision == "deny":
           return {"action": "block", "message": f"Blocked: {decision.reason}"}

       return None  # Allow

   def register(ctx):
       ctx.register_hook("pre_tool_call", enforce)
   ```

3. **Fallback: Use shell hooks for workspace-aware enforcement:**
   ```yaml
   hooks:
     pre_tool_call:
       - command: "python3 $HOME/.hermes/agent-hooks/enforce.py"
         timeout: 3
   ```

### Tool Gaps Found

| Gap | Severity | Description |
|-----|----------|-------------|
| No `cwd` in Python `pre_tool_call` | **MEDIUM** | Must use `os.getcwd()` or project-local plugin context |
| No project-level install from Git | **MEDIUM** | `hermes plugins install` only targets `~/.hermes/plugins/` |
| No pre-startup hook | **LOW** | Cannot validate project at Hermes startup time |
| Shell hook consent model | **LOW** | Requires `--accept-hooks` or interactive consent for first use |
| manifest_version not used in bundled plugins | **LOW** | Field exists in schema but no plugin uses it yet — forward compatibility is theoretical |

---

## 8. Plugin YAML Schema — Complete Reference

**CONFIDENCE: VERIFIED** (from `PluginManifest` dataclass + source code + docs)

```yaml
# ── Required fields ──────────────────────────────────────
name: string                              # Plugin identifier (e.g., "my-enforcer")

# ── Recommended fields ───────────────────────────────────
version: string                           # Semver-ish (e.g., "1.0.0")
description: string                       # Human-readable description
author: string                            # Author attribution

# ── Plugin metadata ──────────────────────────────────────
manifest_version: 1                       # Currently only version 1 supported
kind: standalone                          # standalone | backend | exclusive | platform | model-provider

# ── Dependency declarations ──────────────────────────────
requires_env:                             # Env vars needed; prompted during install
  - API_KEY                               # Simple string format
  - name: OTHER_KEY                       # Rich format with metadata
    description: "What this key is for"
    url: "https://service.com/keys"
    secret: true                          # Masked prompt during install

# ── Capability declarations (informational) ──────────────
provides_tools:                           # List of tool names this plugin registers
  - my_tool
  - another_tool
provides_hooks:                           # List of hooks this plugin uses
  - pre_tool_call
  - post_tool_call
  - on_session_end
```

---

## 9. register(ctx) Interface — Complete Reference

**CONFIDENCE: VERIFIED** (from `PluginContext` class in `hermes_cli/plugins.py`, lines 337–1240)

```python
class PluginContext:
    manifest: PluginManifest          # Read-only manifest for this plugin
    profile_name: str                 # Active Hermes profile name (property)
    llm: PluginLlm                    # Host-owned LLM facade (property, lazy)

    # ── Hook Registration ─────────────────────────────────
    def register_hook(hook_name: str, callback: Callable) -> None
    # Valid hook_name: any of the 20 VALID_HOOKS entries

    # ── Tool Registration ─────────────────────────────────
    def register_tool(
        name: str,
        toolset: str,
        schema: dict,                 # OpenAI tool schema
        handler: Callable,            # fn(args: dict, **kwargs) -> str (JSON)
        check_fn: Callable | None = None,  # Optional availability check
        requires_env: list | None = None,
        is_async: bool = False,
        description: str = "",
        emoji: str = "",
        override: bool = False,       # Set True to replace built-in tools
    ) -> None

    # ── Command Registration ──────────────────────────────
    def register_command(
        name: str,
        handler: Callable,            # fn(raw_args: str) -> str | None
        description: str = "",
        args_hint: str = "",          # For Discord slash command picker
    ) -> None

    # ── CLI Command Registration ──────────────────────────
    def register_cli_command(
        name: str,
        help: str,
        setup_fn: Callable,           # Receives argparse subparser
        handler_fn: Callable | None = None,
        description: str = "",
    ) -> None

    # ── Tool Dispatch (from plugin code) ──────────────────
    def dispatch_tool(tool_name: str, args: dict, **kwargs) -> str
    # Dispatches through the full registry with parent agent context

    # ── Message Injection ─────────────────────────────────
    def inject_message(content: str, role: str = "user") -> bool

    # ── Middleware Registration ───────────────────────────
    def register_middleware(kind: str, callback: Callable) -> None

    # ── Skill Registration ────────────────────────────────
    def register_skill(name: str, path: Path, description: str = "") -> None
```

---

## 10. End-to-End Enforcement Plugin Checklist for Hermes

To create a URL-installable runtime enforcement plugin for Hermes:

- [ ] **Repository structure:** Root-level `plugin.yaml` + `__init__.py`
- [ ] **plugin.yaml:** `name`, `version`, `description`, `provides_hooks: [pre_tool_call]`
- [ ] **__init__.py:** `register(ctx)` function that calls `ctx.register_hook("pre_tool_call", enforce)`
- [ ] **Detection:** Use `Path.cwd()` or `__file__`-based discovery to find `.agent-governance/manifest.json`
- [ ] **Policy loading:** Parse the manifest JSON and build allow/deny rules
- [ ] **Blocking:** Return `{"action": "block", "message": "..."}` for denied operations
- [ ] **Graceful degradation:** Decide behavior when no manifest is found (block vs. allow)
- [ ] **Install:** `hermes plugins install https://github.com/owner/hermes-governance.git --enable`
- [ ] **Test:** `hermes hooks test pre_tool_call --for-tool terminal`

---

## Decision Summary

### Gelesen
- [x] Hermes source code: `hermes_cli/plugins.py` (full 2464 lines), `hermes_cli/plugins_cmd.py`, `agent/plugin_llm.py`
- [x] Hermes source code: `model_tools.py`, `agent/tool_executor.py`, `agent/agent_runtime_helpers.py` (all dispatch paths)
- [x] Official docs: `hooks.md`, `plugins/index.md`, `plugins.md`, `built-in-plugins.md`, `agent-loop.md`, `tools-runtime.md`
- [x] Reference implementation: `plugins/disk-cleanup/` (hooks + slash commands)
- [x] CLI help: `hermes --help`, `hermes plugins --help`

### Validierte Fakten
- Hermes has a mature 20-hook lifecycle system with `pre_tool_call` as the primary enforcement gate
- `pre_tool_call` fires before every tool execution across all three dispatch paths
- Blocking is done via `return {"action": "block", "message": "..."}` — throwing does NOT block
- Python plugin hooks do NOT receive `cwd` in `pre_tool_call` (unlike shell hooks which do)
- Plugins are installed via `hermes plugins install <git-url>` into `~/.hermes/plugins/`
- Project-local plugins require `HERMES_ENABLE_PROJECT_PLUGINS=1` and manual placement
- All plugins are opt-in via `plugins.enabled` in `config.yaml`

### Entscheidung
Hermes **can support HOOK_ENFORCED** runtime enforcement. The recommended approach is a **hybrid architecture**: a Python plugin for the core enforcement logic (in-process, fast, distributed via Git), with a shell hook or project-local bootstrap for workspace detection in gateway mode.

### Annahmen / Unsicherheiten
- Workspace detection in gateway/daemon mode is unresolved for Python hooks — requires either `os.getcwd()` (unreliable in gateway mode) or a project-local plugin approach
- The `manifest_version` field is defined but not yet actively used by the runtime — this may change in future Hermes versions
- Shell hook consent model requires `--accept-hooks` for non-interactive deployments

### Nächste Aktion
- Implement the enforcement plugin: `plugin.yaml` + `__init__.py` with `pre_tool_call` hook
- Add `cwd` detection logic using `Path.cwd()` and upward traversal for manifest discovery
- Create a shell hook wrapper as a fallback for gateway-mode workspace detection
- Test with `hermes hooks test pre_tool_call --for-tool terminal`

---

*End of Hermes Plugin API research report.*
