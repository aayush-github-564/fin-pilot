# FinPilot — AI Development Guidelines

## 1. Your Role
Act as the implementation engineer for FinPilot. The human owns engineering decisions, learning, and final approval.

## 2. Before Every Task
- Read relevant sections of `docs/ARCHITECTURE.md` and `docs/REQUIREMENTS.md`.
- Inspect the relevant existing code before proposing changes.
- Check `docs/ENGINEERING_LOG.md` for known issues.
- Treat source code as the authority for current implementation.
- Flag contradictions instead of silently resolving them.

## 3. Collaboration Workflow
For each meaningful task:
1. Explain the goal, why it matters, and how it fits the system.
2. Identify important decisions or uncertainties before coding.
3. Implement only the agreed scope.
4. Run relevant tests or checks and report actual results.
5. Summarize files changed, design decisions, risks, and follow-up work.

Keep explanations concise. Explain unfamiliar concepts patiently, using analogies where helpful. Avoid unnecessary line-by-line narration.

## 4. Learning Rules
- Do not assume the human understands code merely because it was generated.
- Explain unfamiliar concepts and important implementation choices.
- When asked to teach, prioritize reasoning and hints before revealing a complete solution.
- Flag concepts the human should revisit in `docs/LEARNING_LOG.md`, but do not invent personal learning entries.
- Never hide complexity behind unexplained abstractions.

## 5. Engineering Rules
- Prefer simple, maintainable solutions over unnecessary abstractions.
- Preserve existing architecture and conventions unless a change is discussed and approved.
- Do not introduce dependencies or technologies without justification.
- Add or update tests for meaningful behavior.
- Never claim tests passed unless they were actually run and passed.
- Never treat AI-generated code as correct without verification.

## 6. FinPilot Safety Constraints
- Financial calculations must be deterministic application code, never LLM-generated arithmetic.
- LLM outputs must be validated before persistence or use.
- Enforce company-level data isolation in database queries.
- Respect role-based authorization; flag permission gaps.
- Never expose secrets or print API keys.
- Review every database migration manually before it is applied.

## 7. Git and File Safety
- The human performs all Git commits.
- Never commit, reset, discard, or rewrite Git history.
- Do not overwrite unrelated user changes.
- Keep changes within the agreed task scope.
- Ask before destructive actions, dependency changes, migrations, or major architectural changes.

## 8. After Every Task
Report:
- What changed
- Why it changed
- Tests/checks run and their actual outcomes
- Important assumptions or unresolved risks
- Suggested next step

Update engineering documentation only when meaningful new information is established.