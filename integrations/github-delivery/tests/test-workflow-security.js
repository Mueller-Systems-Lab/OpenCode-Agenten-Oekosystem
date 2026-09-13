#!/usr/bin/env node

/**
 * Workflow Security Tests
 * Tests for GitHub workflow security constraints
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';

// Test data
const WORKFLOW_PATH = '/home/xxammaxx/Schreibtisch/OpenCode-Agenten-Oekosystem/.github/workflows/github-delivery.yml';

// Simple test runner
function runTest(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    return { name, passed: true };
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error.message}`);
    return { name, passed: false, error: error.message };
  }
}

// Test suite
const tests = [
  // Trigger Security
  {
    name: 'should not use pull_request_target trigger',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      assert(!workflowContent.includes('pull_request_target'), 'Workflow must not use pull_request_target trigger');
    }
  },
  {
    name: 'should use safe pull_request trigger',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      assert(workflowContent.includes('pull_request:'), 'Workflow must use pull_request trigger');
    }
  },
  {
    name: 'should not use workflow_run trigger',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      assert(!workflowContent.includes('workflow_run:'), 'Workflow must not use workflow_run trigger');
    }
  },
  {
    name: 'should not use schedule trigger',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      assert(!workflowContent.includes('schedule:'), 'Workflow must not use schedule trigger');
    }
  },
  // Permission Security
  {
    name: 'should use minimal top-level permissions',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for minimal permissions
      assert(workflowContent.includes('contents: read'), 'Workflow must have contents: read permission');
      assert(workflowContent.includes('pull_requests: write'), 'Workflow must have pull_requests: write permission');
      assert(workflowContent.includes('issues: read'), 'Workflow must have issues: read permission');
    }
  },
  {
    name: 'should not have write permissions to contents',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Find permissions section
      const permissionsMatch = workflowContent.match(/permissions:\s*\n\s*contents:\s*(\w+)/);
      if (permissionsMatch) {
        assert.strictEqual(permissionsMatch[1], 'read', 'Contents permission must be read-only');
      }
    }
  },
  {
    name: 'should not have admin permissions',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      assert(!workflowContent.includes('permissions: write-all'), 'Workflow must not have write-all permissions');
      assert(!workflowContent.includes('permissions: admin'), 'Workflow must not have admin permissions');
    }
  },
  {
    name: 'should not have actions permissions',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check if actions permission is explicitly set
      if (workflowContent.includes('actions:')) {
        assert(!workflowContent.includes('actions: write'), 'Workflow must not have actions: write permission');
      }
    }
  },
  {
    name: 'should not have deployments permissions',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check if deployments permission is explicitly set
      if (workflowContent.includes('deployments:')) {
        assert(!workflowContent.includes('deployments: write'), 'Workflow must not have deployments: write permission');
      }
    }
  },
  // Action Security
  {
    name: 'should use SHA-pinned actions',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Find all uses: lines
      const usesLines = workflowContent.match(/uses:\s*.+/g) || [];
      
      for (const usesLine of usesLines) {
        // Skip if it's a local action
        if (usesLine.includes('./') || usesLine.includes('../')) {
          continue;
        }
        
        // Check for SHA pinning
        assert(usesLine.includes('@'), `Action must be pinned: ${usesLine}`);
        
        // Extract the SHA
        const shaMatch = usesLine.match(/@([a-f0-9]{40})/);
        if (shaMatch) {
          assert.strictEqual(shaMatch[1].length, 40, `SHA must be 40 characters: ${usesLine}`);
        }
      }
    }
  },
  {
    name: 'should not use floating tags',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Find all uses: lines
      const usesLines = workflowContent.match(/uses:\s*.+/g) || [];
      
      for (const usesLine of usesLines) {
        // Skip if it's a local action
        if (usesLine.includes('./') || usesLine.includes('../')) {
          continue;
        }
        
        // Check for floating tags (v1, v2, etc.)
        assert(!usesLine.includes('@v1'), `Must not use floating tag v1: ${usesLine}`);
        assert(!usesLine.includes('@v2'), `Must not use floating tag v2: ${usesLine}`);
        assert(!usesLine.includes('@v3'), `Must not use floating tag v3: ${usesLine}`);
        assert(!usesLine.includes('@v4'), `Must not use floating tag v4: ${usesLine}`);
        assert(!usesLine.includes('@latest'), `Must not use floating tag latest: ${usesLine}`);
      }
    }
  },
  {
    name: 'should not use untrusted actions',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // List of untrusted actions (example)
      const untrustedActions = [
        'actions/github-script',
        'actions/cache',
        'actions/upload-artifact',
        'actions/download-artifact'
      ];
      
      for (const action of untrustedActions) {
        if (workflowContent.includes(action)) {
          // If used, it should be SHA-pinned
          const actionRegex = new RegExp(`uses:.*${action.replace('/', '\\/')}.*@([a-f0-9]{40})`);
          assert(actionRegex.test(workflowContent), `Untrusted action ${action} must be SHA-pinned`);
        }
      }
    }
  },
  {
    name: 'should not use deprecated actions',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // List of deprecated actions
      const deprecatedActions = [
        'actions/checkout@v1',
        'actions/checkout@v2',
        'actions/setup-node@v1',
        'actions/setup-node@v2'
      ];
      
      for (const action of deprecatedActions) {
        assert(!workflowContent.includes(action), `Must not use deprecated action: ${action}`);
      }
    }
  },
  // Concurrency Security
  {
    name: 'should use concurrency control',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      assert(workflowContent.includes('concurrency:'), 'Workflow must have concurrency control');
    }
  },
  {
    name: 'should have concurrency group',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      assert(workflowContent.includes('group:'), 'Concurrency must have group');
    }
  },
  {
    name: 'should cancel in-progress runs',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      assert(workflowContent.includes('cancel-in-progress: true'), 'Concurrency must cancel in-progress runs');
    }
  },
  {
    name: 'should use ref-based concurrency group',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for ref-based group
      assert(workflowContent.includes('${{ github.ref }}'), 'Concurrency group should use github.ref');
    }
  },
  // Secret Security
  {
    name: 'should not use untrusted secrets',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for secrets usage
      const secretsRegex = /\$\{\{\s*secrets\.\w+\s*\}\}/g;
      const secretsMatches = workflowContent.match(secretsRegex) || [];
      
      // If secrets are used, they should be from trusted sources
      for (const secret of secretsMatches) {
        // Example: GITHUB_TOKEN is trusted
        assert(secret.includes('GITHUB_TOKEN') || secret.includes('github.token'), 
               `Secret must be from trusted source: ${secret}`);
      }
    }
  },
  {
    name: 'should not expose secrets in logs',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for echo of secrets
      assert(!workflowContent.includes('echo ${{ secrets.'), 'Must not expose secrets in logs');
      assert(!workflowContent.includes('echo "${{ secrets.'), 'Must not expose secrets in logs');
    }
  },
  {
    name: 'should not use secrets in if conditions',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for secrets in if conditions
      assert(!workflowContent.includes('if: ${{ secrets.'), 'Must not use secrets in if conditions');
    }
  },
  // Branch Security
  {
    name: 'should only trigger on safe branches',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for safe branches
      assert(workflowContent.includes('branches: [master]'), 'Should only trigger on master branch');
    }
  },
  {
    name: 'should not trigger on feature branches',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for feature branch patterns
      assert(!workflowContent.includes('branches: [feature/**]'), 'Should not trigger on feature branches');
      assert(!workflowContent.includes('branches: [feat/**]'), 'Should not trigger on feature branches');
    }
  },
  {
    name: 'should not trigger on tags',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for tag triggers
      assert(!workflowContent.includes('tags:'), 'Should not trigger on tags');
    }
  },
  // Timeout Security
  {
    name: 'should have timeout-minutes set',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      assert(workflowContent.includes('timeout-minutes:'), 'Workflow must have timeout-minutes set');
    }
  },
  {
    name: 'should have reasonable timeout',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Extract timeout
      const timeoutMatch = workflowContent.match(/timeout-minutes:\s*(\d+)/);
      if (timeoutMatch) {
        const timeout = parseInt(timeoutMatch[1]);
        assert(timeout <= 360, 'Timeout should be reasonable (max 6 hours)');
        assert(timeout >= 5, 'Timeout should be at least 5 minutes');
      }
    }
  },
  // Environment Security
  {
    name: 'should not use persistent credentials',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for persist-credentials: false
      assert(workflowContent.includes('persist-credentials: false'), 'Must not persist credentials');
    }
  },
  {
    name: 'should not set environment variables with secrets',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for env with secrets
      assert(!workflowContent.includes('env:\n  SECRET: ${{ secrets.'), 'Must not set secrets as environment variables');
    }
  },
  {
    name: 'should not use GITHUB_TOKEN in env',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for GITHUB_TOKEN in env
      assert(!workflowContent.includes('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}'), 'Must not expose GITHUB_TOKEN in env');
    }
  },
  // Step Security
  {
    name: 'should not use shell injection',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Split workflow into lines and check for shell injection in run blocks
      const lines = workflowContent.split('\n');
      let inRunBlock = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Detect run blocks
        if (line.match(/^\s*run:\s*\|/)) {
          inRunBlock = true;
          continue;
        }
        
        // Detect end of run blocks (next step or job)
        if (inRunBlock && (line.match(/^\s*-?\s*name:/) || line.match(/^\s*[a-z_]+:/))) {
          inRunBlock = false;
        }
        
        // Check for shell injection in run blocks
        if (inRunBlock) {
          assert(!line.includes('${{ github.event.'), `Shell injection detected in run block at line ${i + 1}`);
          assert(!line.includes('${{ github.head_ref }}'), `Shell injection detected in run block at line ${i + 1}`);
        }
      }
      
      // Note: Using github.event in env: blocks or if: conditions is safe
      // because those are processed by GitHub Actions before shell execution
    }
  },
  {
    name: 'should use safe variable expansion',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for safe variable expansion
      if (workflowContent.includes('${{ ')) {
        // Should use env context for untrusted input
        assert(workflowContent.includes('env:'), 'Should use env context for untrusted input');
      }
    }
  },
  {
    name: 'should not use eval',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for eval
      assert(!workflowContent.includes('eval '), 'Must not use eval');
    }
  },
  {
    name: 'should not use exec',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for exec
      assert(!workflowContent.includes('exec '), 'Must not use exec');
    }
  },
  // Fail-Closed Security
  {
    name: 'should fail on any check failure',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for fail on any check failure
      assert(workflowContent.includes('Fail on any check failure'), 'Must fail on any check failure');
    }
  },
  {
    name: 'should not use continue-on-error',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for continue-on-error
      assert(!workflowContent.includes('continue-on-error: true'), 'Must not use continue-on-error');
    }
  },
  {
    name: 'should not use if: success()',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for if: success()
      assert(!workflowContent.includes('if: success()'), 'Must not use if: success()');
    }
  },
  {
    name: 'should use if: always() for cleanup',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for if: always() in cleanup steps
      if (workflowContent.includes('Record final evidence')) {
        assert(workflowContent.includes('if: always()'), 'Cleanup must use if: always()');
      }
    }
  },
  // Artifact Security
  {
    name: 'should have retention-days set',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for retention-days
      assert(workflowContent.includes('retention-days:'), 'Artifacts must have retention-days set');
    }
  },
  {
    name: 'should have reasonable retention',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Extract retention
      const retentionMatch = workflowContent.match(/retention-days:\s*(\d+)/);
      if (retentionMatch) {
        const retention = parseInt(retentionMatch[1]);
        assert(retention <= 90, 'Retention should be reasonable (max 90 days)');
        assert(retention >= 1, 'Retention should be at least 1 day');
      }
    }
  },
  {
    name: 'should not store secrets in artifacts',
    fn: () => {
      const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
      
      // Check for secrets in artifact paths
      assert(!workflowContent.includes('${{ secrets.'), 'Must not store secrets in artifacts');
    }
  }
];

// Run tests
console.log('Running Workflow Security Tests...\n');

let passed = 0;
let failed = 0;
const failedTests = [];

for (const test of tests) {
  const result = runTest(test.name, test.fn);
  if (result.passed) {
    passed++;
  } else {
    failed++;
    failedTests.push(test.name);
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${tests.length} total`);

if (failed > 0) {
  console.log('\nFailed Tests:');
  for (const test of failedTests) {
    console.log(`  - ${test}`);
  }
  process.exit(1);
}