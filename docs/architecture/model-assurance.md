# Model Assurance Module

## Architecture

The Model Assurance module provides an empirical evaluation gate for AI model versions in a concrete project context. It evaluates whether a specific model+provider+toolset combination can safely perform development tasks in this repository.

### Architecture Decision

**ADR-008**: Model Assurance Evaluation Gate

**Status**: PROPOSED

**Context**: PR #7 revealed a critical gap where a model could report `GREEN_SAFE` despite missing runtime dependencies and false test counts. We need a systematic way to evaluate model+provider+toolset combinations against concrete project requirements.

**Decision**: Implement a Model Assurance module with:
1. A Slash command (`/speckit.opencode-evidence.model-audit`) for invocation
2. 8 task classes mapping to project work types
3. 4 evaluation modes (requirements, dry-run, shadow, full)
4. 19 hard gates that cannot be compensated by scores
5. 10 fake models for deterministic testing
6. Hidden test isolation to prevent candidate manipulation
7. Weighted scoring across 7 dimensions
8. A model registry with explicit invalidation rules

**Consequences**:
- No model can be GREEN_ELIGIBLE without passing all hard gates
- Hard gate violations (e.g., invented agents, false test counts) result in RED_UNSUITABLE
- Scores alone cannot compensate for governance violations
- Registry entries invalidate on any change to model, harness, toolset, or parameters

### Module Structure

```
integrations/model-assurance/
├── evaluator/           # Evaluation engine (future: shadow mode)
├── hard-gates.json      # 19 hard gate definitions
├── public-probes/       # Public test probes
├── schemas/             # JSON schemas
└── templates/           # Templates

scripts/model-assurance/
└── evaluate.mjs         # Main evaluator script

.opencode/model-assurance/
├── model-registry.json  # Model evaluation registry
└── project-requirements.yml  # Project profile

test/model-assurance/
├── fake-models/         # Fake model implementations
├── fixtures/            # Test fixtures
├── integration/         # Integration tests
└── model-assurance-contract.test.mjs  # Contract tests
```

### Key Components

1. **Evaluator**: Parses CLI args, validates inputs, builds evaluation contracts, blocks unauthorized provider calls
2. **Hard Gates**: 19 immutable gates defined in `hard-gates.json` — each failure produces `RED_UNSUITABLE`
3. **Task Classes**: 8 classes with different min scores, required gates, min runs, and tool permissions
4. **Fake Models**: 10 deterministic test models with documented expected classifications
5. **Model Registry**: Tracks evaluations with automatic invalidation on any parameter change

### Security Boundaries

- No external provider calls without `--allow-provider-calls` AND `--budget-eur`
- Shadow mode isolates candidate in temporary workspace
- Hidden tests stored outside candidate workspace
- Candidate cannot modify evaluator, scores, or hard gates
- No automatic model switching based on evaluation results
