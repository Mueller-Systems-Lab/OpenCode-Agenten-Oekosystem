#!/bin/bash

# Delivery Lifecycle Test Runner
# Runs all tests and reports results

set -e

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVIDENCE_DIR="/tmp/opencode/T3-implementation"

# Create evidence directory
mkdir -p "$EVIDENCE_DIR"

echo "=========================================="
echo "Delivery Lifecycle Test Suite"
echo "=========================================="
echo ""
echo "Test Directory: $TEST_DIR"
echo "Evidence Directory: $EVIDENCE_DIR"
echo ""

# Initialize test results
PASSED=0
FAILED=0
TOTAL=0
FAILED_TESTS=()

# Run lifecycle tests
echo "Running Lifecycle Tests..."
echo "------------------------------------------"
if node "$TEST_DIR/test-lifecycle.js"; then
    echo "✓ Lifecycle tests passed"
    PASSED=$((PASSED + 1))
else
    echo "✗ Lifecycle tests failed"
    FAILED=$((FAILED + 1))
    FAILED_TESTS+=("lifecycle")
fi
TOTAL=$((TOTAL + 1))
echo ""

# Run workflow security tests
echo "Running Workflow Security Tests..."
echo "------------------------------------------"
if node "$TEST_DIR/test-workflow-security.js"; then
    echo "✓ Workflow security tests passed"
    PASSED=$((PASSED + 1))
else
    echo "✗ Workflow security tests failed"
    FAILED=$((FAILED + 1))
    FAILED_TESTS+=("workflow-security")
fi
TOTAL=$((TOTAL + 1))
echo ""

# Run fake GitHub scenarios tests
echo "Running Fake GitHub Scenarios Tests..."
echo "------------------------------------------"
if node "$TEST_DIR/test-fake-github.js"; then
    echo "✓ Fake GitHub scenarios tests passed"
    PASSED=$((PASSED + 1))
else
    echo "✗ Fake GitHub scenarios tests failed"
    FAILED=$((FAILED + 1))
    FAILED_TESTS+=("fake-github")
fi
TOTAL=$((TOTAL + 1))
echo ""

# Generate test report
TEST_REPORT="$EVIDENCE_DIR/test-report-$(date +%Y%m%d-%H%M%S).json"
cat > "$TEST_REPORT" << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "test_suite": "delivery-lifecycle",
  "results": {
    "total": $TOTAL,
    "passed": $PASSED,
    "failed": $FAILED,
    "failed_tests": [$(printf '"%s",' "${FAILED_TESTS[@]}" | sed 's/,$//')]
  },
  "evidence_dir": "$EVIDENCE_DIR",
  "test_files": [
    "test-lifecycle.js",
    "test-workflow-security.js",
    "test-fake-github.js"
  ]
}
EOF

echo "=========================================="
echo "Test Results Summary"
echo "=========================================="
echo ""
echo "Total: $TOTAL"
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo ""

if [ $FAILED -gt 0 ]; then
    echo "Failed Tests:"
    for test in "${FAILED_TESTS[@]}"; do
        echo "  - $test"
    done
    echo ""
    echo "❌ Some tests failed"
    exit 1
else
    echo "✅ All tests passed"
    echo ""
    echo "Test report saved to: $TEST_REPORT"
    exit 0
fi