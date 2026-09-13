# Delivery Lifecycle Evaluator

## Overview
Read-only evaluator for the Issue-to-Merge delivery lifecycle. Supports issue, branch, pre-PR, PR, pre-merge, post-merge, and JSON modes without remote writes.

## Purpose
Evaluate delivery lifecycle state and progress without modifying any remote state.

## Supported Modes

### 1. Issue Mode
Evaluate issue readiness and story completeness.

### 2. Branch Mode
Evaluate branch creation and implementation progress.

### 3. Pre-PR Mode
Evaluate pre-PR checks and readiness.

### 4. PR Mode
Evaluate PR status and review progress.

### 5. Pre-Merge Mode
Evaluate pre-merge checks and decision packet.

### 6. Post-Merge Mode
Evaluate merge completion and evidence.

### 7. JSON Mode
Output evaluation results in JSON format.

## Usage

### Issue Mode
```bash
./evaluator.sh --mode issue --issue-number 15
```

**Checks:**
- Issue exists and is open
- Issue has labels
- Issue has priority
- Story spec exists
- Acceptance criteria exist
- Size estimate exists

**Output:**
```
ISSUE_EVALUATION: PASS/FAIL
- Issue exists: PASS/FAIL
- Has labels: PASS/FAIL
- Has priority: PASS/FAIL
- Story spec exists: PASS/FAIL
- Acceptance criteria exist: PASS/FAIL
- Size estimate exists: PASS/FAIL
```

### Branch Mode
```bash
./evaluator.sh --mode branch --branch-name feat/issue-15-delivery
```

**Checks:**
- Branch exists
- Branch is up to date with master
- Implementation plan exists
- Code changes are present
- Unit tests are written

**Output:**
```
BRANCH_EVALUATION: PASS/FAIL
- Branch exists: PASS/FAIL
- Up to date with master: PASS/FAIL
- Implementation plan exists: PASS/FAIL
- Code changes present: PASS/FAIL
- Unit tests written: PASS/FAIL
```

### Pre-PR Mode
```bash
./evaluator.sh --mode pre-pr --branch-name feat/issue-15-delivery
```

**Checks:**
- Lint passes
- Build passes
- Tests pass
- Coverage meets threshold
- Security review complete
- Compliance review complete
- Visual QA complete (or N/A recorded)

**Output:**
```
PRE_PR_EVALUATION: PASS/FAIL
- Lint passes: PASS/FAIL
- Build passes: PASS/FAIL
- Tests pass: PASS/FAIL
- Coverage meets threshold: PASS/FAIL
- Security review complete: PASS/FAIL
- Compliance review complete: PASS/FAIL
- Visual QA complete: PASS/FAIL
```

### PR Mode
```bash
./evaluator.sh --mode pr --pr-url https://github.com/xxammaxx/opencode-agent-ecosystem/pull/15
```

**Checks:**
- PR exists
- PR is draft
- PR has required labels
- PR has issue linked
- Review is approved
- All checks pass

**Output:**
```
PR_EVALUATION: PASS/FAIL
- PR exists: PASS/FAIL
- PR is draft: PASS/FAIL
- PR has required labels: PASS/FAIL
- PR has issue linked: PASS/FAIL
- Review is approved: PASS/FAIL
- All checks pass: PASS/FAIL
```

### Pre-Merge Mode
```bash
./evaluator.sh --mode pre-merge --pr-url https://github.com/xxammaxx/opencode-agent-ecosystem/pull/15
```

**Checks:**
- PR is approved
- All checks pass
- Decision packet exists
- Evidence summary complete
- Exact SHA token valid
- Owner approval exists

**Output:**
```
PRE_MERGE_EVALUATION: PASS/FAIL
- PR is approved: PASS/FAIL
- All checks pass: PASS/FAIL
- Decision packet exists: PASS/FAIL
- Evidence summary complete: PASS/FAIL
- Exact SHA token valid: PASS/FAIL
- Owner approval exists: PASS/FAIL
```

### Post-Merge Mode
```bash
./evaluator.sh --mode post-merge --pr-url https://github.com/xxammaxx/opencode-agent-ecosystem/pull/15
```

**Checks:**
- PR is merged
- Merge SHA matches expected
- Merge timestamp recorded
- Evidence archived
- Branch deleted (if policy allows)

**Output:**
```
POST_MERGE_EVALUATION: PASS/FAIL
- PR is merged: PASS/FAIL
- Merge SHA matches: PASS/FAIL
- Merge timestamp recorded: PASS/FAIL
- Evidence archived: PASS/FAIL
- Branch deleted: PASS/FAIL
```

### JSON Mode
```bash
./evaluator.sh --mode json --issue-number 15
```

**Output:**
```json
{
  "evaluation_id": "eval-1234567890",
  "mode": "issue",
  "issue_number": 15,
  "timestamp": "2026-09-13T07:30:00Z",
  "results": {
    "issue_exists": true,
    "has_labels": true,
    "has_priority": true,
    "story_spec_exists": true,
    "acceptance_criteria_exist": true,
    "size_estimate_exists": true
  },
  "overall": "PASS",
  "failures": []
}
```

## Evaluation Logic

### Fail-Closed Principle
- If a check cannot be executed, treat as FAIL
- If evidence is missing, treat as FAIL
- If role is unauthorized, treat as FAIL

### Evidence Requirements
Each mode requires specific evidence:

#### Issue Mode
- `issue_view.json` - GitHub issue data
- `story_spec.md` - Story specification
- `acceptance_criteria.md` - Acceptance criteria
- `size_estimate.json` - Size estimate

#### Branch Mode
- `branch_list.json` - Branch information
- `implementation_plan.md` - Implementation plan
- `git_diff.txt` - Code changes
- `test_results.json` - Test results

#### Pre-PR Mode
- `lint_results.json` - Lint output
- `build_results.json` - Build output
- `test_results.json` - Test output
- `coverage_report.json` - Coverage data
- `security_review.md` - Security review
- `compliance_review.md` - Compliance review
- `visual_qa_report.md` - Visual QA report

#### PR Mode
- `pr_view.json` - PR information
- `pr_reviews.json` - Review status
- `pr_checks.json` - Check status

#### Pre-Merge Mode
- `pr_view.json` - PR information
- `decision_packet.json` - Decision packet
- `evidence_summary.json` - Evidence summary
- `exact_sha_token.txt` - SHA token
- `owner_approval.txt` - Owner approval

#### Post-Merge Mode
- `pr_view.json` - PR information
- `merge_sha.txt` - Merge SHA
- `merge_timestamp.txt` - Merge timestamp
- `evidence_archive.json` - Evidence archive

## Role Separation

### Read-Only Operations
The evaluator only performs read-only operations:
- `gh issue view`
- `gh pr view`
- `gh pr checks`
- `git log`
- `git diff`
- `git branch`
- `cat` files
- `jq` queries

### No Write Operations
The evaluator never performs:
- `gh pr create`
- `gh pr merge`
- `gh pr comment`
- `git commit`
- `git push`
- `git branch -d`
- `mkdir`
- `touch`
- `rm`

## Error Handling

### Missing Evidence
```bash
if [ ! -f "$EVIDENCE_FILE" ]; then
  echo "EVALUATION: FAIL - Missing evidence: $EVIDENCE_FILE"
  FAILURES+=("missing_evidence:$EVIDENCE_FILE")
fi
```

### Check Failure
```bash
if ! check_result; then
  echo "EVALUATION: FAIL - Check failed: $CHECK_NAME"
  FAILURES+=("check_failed:$CHECK_NAME")
fi
```

### Role Unauthorized
```bash
if ! role_check "$AGENT_ROLE" "$REQUIRED_ROLE"; then
  echo "EVALUATION: FAIL - Role unauthorized: $AGENT_ROLE"
  FAILURES+=("role_unauthorized:$AGENT_ROLE")
fi
```

## Integration with Blackboard

### Publishing Results
```bash
# Record evaluation result
swarm fact 3 "evaluation_result" \
  --value "PASS" \
  --evidence "/tmp/opencode/T3-implementation/evaluation-${EVAL_ID}.json"
```

### Recording Evidence
```bash
# Record evaluation evidence
swarm result 3 "evaluation" "PASS" \
  --ref "/tmp/opencode/T3-implementation/evaluation-${EVAL_ID}.json"
```

## Test Coverage

Tests must cover:
1. All evaluation modes
2. Fail-closed behavior
3. Missing evidence handling
4. Role separation enforcement
5. JSON output format
6. Error conditions
7. Edge cases

## Security Constraints

### No Remote Writes
Evaluator never writes to remote systems:
- No GitHub API writes
- No file system writes
- No database writes
- No network requests (except reads)

### Read-Only Evidence
Evaluator only reads evidence:
- Reads from local files
- Reads from GitHub API (read-only)
- Reads from git repository
- Never modifies evidence

### Minimal Permissions
Evaluator uses minimal permissions:
- `contents: read` for git operations
- `pull_requests: read` for PR operations
- `issues: read` for issue operations
- No write permissions

## Output Formats

### Human-Readable
```
EVALUATION: PASS/FAIL
- Check 1: PASS/FAIL
- Check 2: PASS/FAIL
- Check 3: PASS/FAIL
```

### Machine-Readable (JSON)
```json
{
  "evaluation_id": "eval-1234567890",
  "mode": "issue",
  "overall": "PASS",
  "results": {},
  "failures": []
}
```

### Blackboard-Compatible
```
F|3|evaluation_result=PASS|ref:/tmp/opencode/T3-implementation/evaluation.json
R|3|evaluation|PASS|ref:/tmp/opencode/T3-implementation/evaluation.json
```