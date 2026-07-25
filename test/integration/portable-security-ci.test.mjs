// GitHub-hosted runners can deny the user/mount namespaces required by
// Bubblewrap. This aggregate retains every portable integration gate plus the
// deterministic capability and fail-closed sandbox contracts in that case.
import "../contracts/bootstrap-capability-contract.test.mjs"
import "./approval-enforcement.test.mjs"
import "./bootstrap-gate-wiring.test.mjs"
import "./gate-cli-smoke.test.mjs"
import "./rollback-runtime.test.mjs"
