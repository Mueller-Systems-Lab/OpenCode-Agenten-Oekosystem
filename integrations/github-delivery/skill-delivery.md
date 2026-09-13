# Delivery Skill

## Overview
Reusable skill for executing the Issue-to-Merge delivery lifecycle. Enforces gate passing, evidence collection, and role separation.

## When to Use
- Implementing GitHub delivery workflows
- Enforcing delivery lifecycle gates
- Collecting delivery evidence
- Managing PR creation and merge decisions

## When NOT to Use
- Simple single-agent tasks
- Work without shared local filesystem
- Non-GitHub delivery workflows

## Core Workflow

### 1. Initialize Delivery
```bash
# Create delivery context
DELIVERY_ID="delivery-$(date +%s)"
ISSUE_NUMBER=$1
BRANCH_NAME=$2

# Validate inputs
if [ -z "$ISSUE_NUMBER" ] || [ -z "$BRANCH_NAME" ]; then
  echo "Usage: $0 <issue-number> <branch-name>"
  exit 1
fi
```

### 2. Start Delivery Lifecycle
```bash
# Record initial state
STATE="ISSUE_READY"
EVIDENCE_FILE="/tmp/opencode/T3-implementation/delivery-${DELIVERY_ID}.json"

cat > "$EVIDENCE_FILE" << EOF
{
  "delivery_id": "$DELIVERY_ID",
  "issue_number": $ISSUE_NUMBER,
  "branch_name": "$BRANCH_NAME",
  "state": "$STATE",
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "evidence": {}
}
EOF
```

### 3. Gate Enforcement
For each transition:
1. Verify all required evidence exists
2. Verify all required gates have passed
3. Verify role authorization
4. Check fail-closed requirements
5. Record transition with evidence

### 4. Evidence Collection
Collect evidence for each gate:

#### Story Completeness Gate
```bash
# Check story has acceptance criteria
if ! jq -e '.story.acceptance_criteria' "$STORY_FILE" > /dev/null 2>&1; then
  echo "FAIL: Story missing acceptance criteria"
  exit 1
fi

# Check story has size estimate
if ! jq -e '.story.size_estimate' "$STORY_FILE" > /dev/null 2>&1; then
  echo "FAIL: Story missing size estimate"
  exit 1
fi
```

#### Story Size Gate
```bash
# Validate size estimate is reasonable
SIZE=$(jq -r '.story.size_estimate' "$STORY_FILE")
if [ "$SIZE" -gt 13 ]; then
  echo "FAIL: Story too large (max 13 points)"
  exit 1
fi
```

#### Test Execution Gate
```bash
# Run tests and capture results
TEST_OUTPUT=$(npm test 2>&1)
TEST_EXIT=$?

if [ $TEST_EXIT -ne 0 ]; then
  echo "FAIL: Tests failed"
  echo "$TEST_OUTPUT" > "/tmp/opencode/T3-implementation/test-failure-${DELIVERY_ID}.log"
  exit 1
fi

# Check coverage threshold
COVERAGE=$(echo "$TEST_OUTPUT" | grep -o "Lines[^:]*:[^0-9]*\([0-9]*\)" | grep -o "[0-9]*$")
if [ "$COVERAGE" -lt 80 ]; then
  echo "FAIL: Coverage below threshold (80%)"
  exit 1
fi
```

#### Security Review Gate
```bash
# Verify security review exists
if [ ! -f "security-review-${ISSUE_NUMBER}.md" ]; then
  echo "FAIL: Security review not found"
  exit 1
fi

# Verify vulnerability scan passed
if ! grep -q "VULNERABILITY_SCAN: PASS" "security-review-${ISSUE_NUMBER}.md"; then
  echo "FAIL: Vulnerability scan not passed"
  exit 1
fi
```

#### Compliance Review Gate
```bash
# Verify compliance review exists
if [ ! -f "compliance-review-${ISSUE_NUMBER}.md" ]; then
  echo "FAIL: Compliance review not found"
  exit 1
fi

# Verify DSGVO check passed
if ! grep -q "DSGVO_CHECK: PASS" "compliance-review-${ISSUE_NUMBER}.md"; then
  echo "FAIL: DSGVO check not passed"
  exit 1
fi
```

#### Visual QA Gate
```bash
# Check if visual changes exist
if git diff --name-only HEAD~1 | grep -qE "\.(css|scss|less|vue|jsx|tsx)$"; then
  # Visual changes detected, run visual QA
  if ! npx playwright test --grep "visual"; then
    echo "FAIL: Visual QA failed"
    exit 1
  fi
else
  # No visual changes, record N/A
  echo "VISUAL_QA: N/A - No visual changes detected" >> "$EVIDENCE_FILE"
fi
```

#### Pre-PR Checks Gate
```bash
# Run lint
if ! npm run lint; then
  echo "FAIL: Lint failed"
  exit 1
fi

# Run build
if ! npm run build; then
  echo "FAIL: Build failed"
  exit 1
fi
```

### 5. PR Creation
```bash
# Create draft PR
PR_URL=$(gh pr create \
  --draft \
  --title "feat: ${ISSUE_TITLE}" \
  --body "Closes #${ISSUE_NUMBER}" \
  --base master \
  --head "$BRANCH_NAME")

# Record PR evidence
jq --arg pr_url "$PR_URL" \
   --arg pr_sha "$(git rev-parse HEAD)" \
   '.evidence.draft_pr_url = $pr_url | .evidence.draft_pr_sha = $pr_sha' \
   "$EVIDENCE_FILE" > "${EVIDENCE_FILE}.tmp" && mv "${EVIDENCE_FILE}.tmp" "$EVIDENCE_FILE"
```

### 6. All Gates Pass Check
```bash
# Verify all gates have passed
REQUIRED_GATES=(
  "issue_triage"
  "story_completeness"
  "story_size"
  "implementation_started"
  "tests_pass"
  "coverage_threshold"
  "security_review_pass"
  "compliance_review_pass"
  "visual_qa_pass"
  "pre_pr_checks"
  "draft_pr_created"
)

for gate in "${REQUIRED_GATES[@]}"; do
  if ! jq -e ".gates.${gate}" "$EVIDENCE_FILE" > /dev/null 2>&1; then
    echo "FAIL: Gate ${gate} not passed"
    exit 1
  fi
done
```

### 7. PR Ready for Review
```bash
# Mark PR as ready for review
gh pr ready "$PR_URL"

# Record transition
jq '.state = "PR_READY_FOR_REVIEW"' "$EVIDENCE_FILE" > "${EVIDENCE_FILE}.tmp" && mv "${EVIDENCE_FILE}.tmp" "$EVIDENCE_FILE"
```

### 8. Review Approval
```bash
# Wait for review approval
echo "Waiting for review approval..."
# This would be handled by GitHub webhook or polling
```

### 9. Pre-Merge Check
```bash
# Run final CI checks
if ! gh checks "$PR_URL" --required; then
  echo "FAIL: Final CI checks failed"
  exit 1
fi
```

### 10. Merge Decision Packet
```bash
# Generate decision packet
DECISION_PACKET=$(cat << EOF
{
  "delivery_id": "$DELIVERY_ID",
  "issue_number": $ISSUE_NUMBER,
  "pr_url": "$PR_URL",
  "pr_sha": "$(git rev-parse HEAD)",
  "evidence_summary": {
    "tests_pass": true,
    "security_review": true,
    "compliance_review": true,
    "visual_qa": true,
    "all_gates_pass": true
  },
  "recommendation": "APPROVE",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
)

# Save decision packet
echo "$DECISION_PACKET" > "/tmp/opencode/T3-implementation/decision-packet-${DELIVERY_ID}.json"
```

### 11. Owner Decision
```bash
# Wait for owner decision
echo "Waiting for owner decision..."
# This would be handled by approval-coordinator
```

### 12. Merge Execution
```bash
# Only merge with exact SHA-bound token
if [ -n "$EXACT_SHA_TOKEN" ] && [ "$EXACT_SHA_TOKEN" = "$(git rev-parse HEAD)" ]; then
  gh pr merge "$PR_URL" --merge
else
  echo "FAIL: Invalid or missing exact SHA token"
  exit 1
fi
```

## Role Separation Enforcement

### Issue Orchestrator
- Can: Coordinate, plan, track
- Cannot: Implement, merge

### Executor
- Can: Implement, test, create PRs
- Cannot: Review, approve, merge

### Security Agent
- Can: Review security, approve
- Cannot: Implement, merge

### Compliance Agent
- Can: Review compliance, approve
- Cannot: Implement, merge

### Review Agent
- Can: Review code, approve
- Cannot: Implement, merge

### Playwright Agent
- Can: Run visual QA, record evidence
- Cannot: Implement, merge

### UX Review Agent
- Can: Analyze UX, record evidence
- Cannot: Implement, merge

## Security Constraints

### No pull_request_target
Never use pull_request_target trigger in workflows.

### No Untrusted Secrets
Never use secrets from untrusted sources.

### SHA-Pinned Actions
All GitHub Actions must be SHA-pinned:
```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
```

### Concurrency Control
Use concurrency groups to prevent parallel runs:
```yaml
concurrency:
  group: delivery-${{ github.ref }}
  cancel-in-progress: true
```

### Fail-Closed Checks
All checks must fail closed:
- If check cannot run, treat as FAIL
- If evidence missing, treat as FAIL
- If role unauthorized, treat as FAIL

## Merge Constraints

### Exact SHA-Bound Token
Merge requires exact SHA token:
```bash
if [ "$PROVIDED_SHA" = "$(git rev-parse HEAD)" ]; then
  # Allow merge
else
  # Block merge
fi
```

### Owner Decision Packet
Merge requires owner decision packet:
```bash
if [ ! -f "decision-packet-${DELIVERY_ID}.json" ]; then
  echo "FAIL: Missing decision packet"
  exit 1
fi
```

### No Autonomous Merge
Agent cannot merge autonomously. Merge must be authorized by owner.

## Visual QA

### For Visual Paths
```bash
# Run Playwright visual regression
npx playwright test --grep "visual"

# Compare screenshots
# Record evidence
```

### For Non-Visual Paths
```bash
# Record explicit N/A
echo "VISUAL_QA: N/A - No visual changes" >> "$EVIDENCE_FILE"
```

## Testing Requirements

Tests must cover:
1. Lifecycle state transitions
2. Gate enforcement
3. Evidence collection
4. Role separation
5. Security constraints
6. Merge constraints
7. Visual QA (or N/A recording)
8. Fake-GitHub scenarios

## Evidence Storage

### Temporary Evidence
Store in `/tmp/opencode/T3-implementation/`:
- Delivery context files
- Test outputs
- Decision packets

### Permanent Evidence
Store in `integrations/github-delivery/evidence/`:
- Lifecycle transitions
- Gate results
- Final delivery reports

### Blackboard Reference
Reference evidence in blackboard facts using native swarm tool.

## Error Handling

### Gate Failure
```bash
if ! gate_check; then
  echo "FAIL: Gate check failed"
  # Record failure evidence
  # Do not proceed to next state
  exit 1
fi
```

### Evidence Missing
```bash
if [ ! -f "$EVIDENCE_FILE" ]; then
  echo "FAIL: Evidence file missing"
  # Do not proceed
  exit 1
fi
```

### Role Unauthorized
```bash
if ! role_check "$AGENT_ROLE" "$REQUIRED_ROLE"; then
  echo "FAIL: Agent not authorized for this action"
  # Do not proceed
  exit 1
fi
```

## Cleanup

After delivery complete:
```bash
# Remove temporary files
rm -f /tmp/opencode/T3-implementation/delivery-${DELIVERY_ID}*.json

# Archive permanent evidence
mkdir -p "integrations/github-delivery/evidence/${DELIVERY_ID}"
mv /tmp/opencode/T3-implementation/decision-packet-${DELIVERY_ID}.json \
   "integrations/github-delivery/evidence/${DELIVERY_ID}/"
```