# Stacked pull requests

Dependent work uses native GitHub stacks. A focused independent change may be a standalone PR. Each layer includes its relevant tests and targets the immediately preceding branch; the bottom targets this repository's default branch.

## Develop and submit

Read the repository's AGENTS.md and the official gh-stack skill. Verify the repository and remote before running commands:

```sh
gh stack init topic/foundation
# Implement, validate, stage only intended files, and commit.
gh stack add topic/consumer
# Implement and validate the dependent concern, then commit.
gh stack submit --auto --remote origin
gh stack view --json
```

Use `gh pr edit` to give each draft a specific title and description. Include exactly one dependency line outside comments and code fences:

```text
Depends on: none
```

For a child, use `Depends on: #123` with the immediate parent's number. Bot PRs follow the same declaration rule; add the line before making them ready to merge. Verify native membership with `gh api repos/OWNER/REPO/stacks`, not merely branch bases or navigation comments.

## Update safely

Inspect dirty state, `git worktree list --porcelain`, other task ownership, and remote tips before rewriting. One writer manages a stack. Do not rewrite branches in another active worktree. Edit the owning layer, use `gh stack rebase --upstack --remote origin`, then validate the changed layer and descendants and push with the extension's lease checks. `gh stack sync --remote origin` can abort with exit code zero: inspect output and `gh stack view --json` and verify GitHub state.

## Required policy

`Stack policy` validates declarations, immediate parents, current parent ancestry, native membership, and linear ordering. Independent and bottom PRs target the default branch. Closed parents must have merged into the default branch; the surviving bottom layer may temporarily keep that merged parent's declaration after retargeting. A broken layer blocks its native stack. Parent/child PRs with the same head SHA share the most restrictive result.

The controller reads trusted workflow code and GitHub metadata only. It does not check out or execute PR code. PR events, pushes, branch deletion, and manual dispatch reconcile all open PRs. API or consistency failures leave failing checks. Re-run the controller after correcting a declaration or linking a stack. Semantic focus remains a reviewer responsibility.

Default-branch protection requires PRs and policy/CI checks, including for administrators, and forbids force pushes and deletion. Native stacks inherit trunk requirements for each layer. Branches used for stack development remain rewriteable with lease protection. Fork contributions can be standalone PRs; cross-fork native stacks are unsupported.

## Merge

Wait for checks and existing merge authorization. Verify the exact target and its unmerged predecessors. Use `gh stack merge <PR-number> --yes` with an explicit allowed merge method; targeting an upper layer includes lower layers. Verify the asynchronous result on GitHub. After bottom-layer merge, verify automatic retargeting and rebase, update the new bottom's dependency to `none`, and sync locally. Do not bypass protection.

## Enrollment and recovery

The policy bundle and enrollment helper live at `~/.codex/stack-policy` on the configured Codex host. The helper audits before applying and saves original branch protection and repository file contents. Roll back protection with its `rollback --repo OWNER/REPO` command; revert the setup PR through a new PR to remove committed policy. Rollback does not reset developer branches or undo unrelated repository settings.

GitHub may change its public-preview stack APIs. A failing validation must be investigated, not silently bypassed. Repository owners can deliberately change GitHub settings; these controls govern normal contribution and merge paths, not owner authority.

<!-- codex-review-gate:start -->
## Codex review completion

The required `Stack policy` check blocks while Codex's authenticated summary reports a running, failed, or unknown review, while a new `@codex review` / `@codex security review` request from someone with repository write access awaits completion, or while an active bot eyes reaction has no later completion. Code and security requests are matched to their own completion timestamps. Recorded activity is retained in trusted check output across reruns and head updates, so deleting a marker does not cancel the wait. Every code and security review must finish. Completed findings are advisory: maintainers may choose to ignore them. Retry a failed review; do not bypass an unfinished review.

PR and comment events update the check. Manually dispatch the controller if a legacy reaction-only review does not emit a summary event. GitHub event delivery is asynchronous, leaving a brief detection window when a new review starts. No review is required when none is requested or active. This does not require a fresh review of every push. Existing stack, CI, and review requirements still apply. The controller only reads GitHub metadata and never executes PR code.
<!-- codex-review-gate:end -->
