# pi-git-commit

A [pi-coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension that keeps mutative git operations out of the agent's bash and provides a safe commit flow.

## Features

- **Bash git guard.** Blocks `git add`, `commit`, `push`, `pull`, `merge`, `rebase`, `reset`, `clean`, `rm`, `restore`, `switch`, `cherry-pick`, `revert`, `mv`, `init`, `clone` and other mutative forms in the agent's bash tool. Read-only commands (`status`, `diff`, `log`, `fetch`, `branch`, `tag`, `stash list`, ...) stay allowed.
- **`git_commit` tool.** The agent stages everything and commits with a `FIX` / `IMPROVE` / `NEW` type prefix. Enabled automatically on session start.
- **`/commit` command.** Stages all changes, shows the staged diff, and asks the agent to review it and commit via `git_commit` (never via bash).
- **`/toggle-allow-git` command.** Temporarily allows mutative git commands in bash for the current session.

## Installation

```bash
pi install npm:pi-git-commit
```

## Usage

Run `/commit` after making changes. The extension stages the working tree, presents the diff to the agent, and the agent commits using the `git_commit` tool.

Use `/toggle-allow-git` if you need to run mutative git commands in bash yourself for the current session (the guard re-arms on the next session).
