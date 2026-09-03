# pi-git-commit

Keeps mutative git operations out of the agent's bash and provides a safe, reviewable commit flow in [pi-coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent): a bash guard, a `git_commit` tool, and `/commit`, `/stop-commit` and `/toggle-allow-git` commands.

## What you get

- **Bash git guard.** Mutative git commands are blocked in the agent's bash tool — `add`, `stage`, `commit`, `push`, `pull`, `merge`, `rebase`, `reset`, `clean`, `rm`, `restore`, `switch`, `cherry-pick`, `revert`, `mv`, `init`, `clone`, index/object plumbing (`read-tree`, `checkout-index`, `merge-file`, `prune-packed`), plus mutative forms of `branch` (including creation, `-u`, `-f`, `-c`/`-C`/`--copy`, `-D`/`-M`, `--force`, `-t`/`--track`), `tag` (including creation), `checkout` (including whole-tree restores like `checkout -- .`), `stash`, `submodule`, `worktree`, `config`, `remote`, `apply`, `notes`, `update-ref`, `gc` and more. Read-only commands (`status`, `diff`, `log`, `fetch`, `branch`, `tag`, `stash list`, ...) stay allowed.
- **`git_commit` tool.** The agent stages everything and commits with a `FIX` / `IMPROVE` / `NEW` type prefix. The tool stays active for the whole session but refuses to run until `/commit` opens the flow, and it refuses again once the commit succeeds. The active tool set never changes mid-session, so the provider prompt cache is never invalidated.
- **`/commit` command.** Waits for queued messages to finish, stages all changes, shows a collapsed summary of the staged diff (a `git diff --stat` line; press `ctrl+o` to expand the full diff), unlocks the `git_commit` tool, and asks the agent to review the changes and commit via `git_commit` — never via bash. Run `/stop-commit` at any point to abort the flow.
- **`/stop-commit` command.** Aborts a pending commit flow: closes the flow so `git_commit` refuses to commit, and cancels a `/commit` that is still waiting for queued messages, so no commit is made.
- **`/toggle-allow-git` command.** Temporarily allows mutative git commands in bash for the current session. The guard re-arms on the next session.

## Quick start

1. Make your changes, then run:

```text
/commit
```

2. The extension stages the working tree and shows a collapsed summary of the staged diff — press `ctrl+o` to expand it. The full diff is handed to the agent with instructions to review it.

3. The agent commits using the `git_commit` tool:

```json
{
  "type": "FIX",
  "message": "Correct the off-by-one in the retry loop"
}
```

4. Changed your mind? Run `/stop-commit` to abort the flow before the agent commits.

5. If you need to run mutative git yourself, allow it for the session:

```text
/toggle-allow-git
```

## Installation

```bash
pi install npm:pi-git-commit
```

From a local checkout:

```bash
pi install /path/to/pi-git-commit
```

## The git_commit tool

| Field | Description |
| --- | --- |
| `type` | `FIX` (bug fix), `IMPROVE` (improvement), or `NEW` (new feature). |
| `message` | Commit message in imperative mood, without the type prefix (it is added automatically). A leading type word matching the chosen type is stripped (with `:`, whitespace, or `-`/`—` separators, any casing, repeats included) so the type is never duplicated. Multi-line allowed for detailed changes. |

The tool runs `git add .` followed by `git commit -m "<TYPE>: <message>"` and reports staging or commit failures as tool errors. A leading type word in the message is stripped whenever it repeats the chosen type — with `:`, whitespace, or `-`/`—` separators, at any casing, repeated prefixes included — so the type never ends up duplicated: `FIX: Fix: ...`, `FIX: Fix ...`, and `fix - ...` all become `FIX: ...`. The flow gate is enforced in the tool itself: `git_commit` is listed for the whole session but refuses to run until you run `/commit`, and it refuses again once the commit succeeds, so the agent cannot commit at arbitrary points in the conversation. Because the active tool set never changes, pi's system prompt stays identical for the whole session and the provider's prompt cache is never invalidated (changing the active tool set rebuilds the system prompt and drops the cached prefix). If a commit fails, the flow stays open and the agent can retry immediately without re-running `/commit`.

## The bash guard

The guard intercepts `tool_call` events for the bash tool and blocks commands that match mutative git forms. The block list is a conservative superset: anything that can change repository state is blocked, while a curated set of read-only forms is explicitly allowed (for example `git fetch`, `git stash list`, `git remote -v`, `git config --get`, `git apply --check`, `git checkout -- <file>`, `git submodule status`, `git worktree list`).

The guard parses the command into segments (pipelines, `&&`, `||`, `;`, `&`, command and process substitution, newlines) and inspects only segments that actually invoke `git` — including path-qualified invocations (`/usr/bin/git`), wrapper prefixes with their flags (`sudo -u root`, `nice -n 5`, `timeout 5`), environment-assignment prefixes (`VAR=1 git ...`, `env VAR=1 git ...`), control constructs (`{ ...; }`, `!`, `if`, `while`), and `sh -c`/`su -c` wrappers — while skipping git's global options such as `-C`, `-c`, `--git-dir`, and `--work-tree`. Commands nested more than four wrapper levels deep are blocked outright (fail closed), even when no git command is visible. Git commands mentioned inside strings or heredocs are not blocked. Plain `git fetch` stays allowed, but `git fetch --prune`/`-p`/`--prune-tags` is blocked. Indirect invocation (aliases, variables, `find -exec`) cannot be detected reliably and is best-effort; likewise a directory passed to `git checkout --` without a trailing slash is indistinguishable from a file, so `git checkout -- src` (restoring the whole `src` tree) is not caught.

A blocked command returns:

```text
Mutative git commands are blocked. Ask the user to run /toggle-allow-git to allow them for this session.
```

## Troubleshooting

- **The agent refuses to commit.** The guard blocks `git commit` in bash by design. Run `/commit` and let the agent use the `git_commit` tool.
- **The agent stopped committing.** You ran `/stop-commit`, which aborted the pending flow. Run `/commit` again to start a new one.
- **Prompt cache misses (sudden cost/latency spikes) after /commit.** Older versions activated and deactivated the `git_commit` tool per flow, which rebuilt pi's system prompt and invalidated the provider's cached prompt prefix. Update to this version: the tool set now never changes mid-session.
- **"Nothing to commit (empty diff)."** There are no staged changes — make edits first, then run `/commit` again.
- **I need git in bash right now.** Run `/toggle-allow-git`; the guard re-arms automatically on the next session start.

## Development

Requires [Node.js](https://nodejs.org) ≥ 22.19 and npm.

```bash
npm install
npm test
npm run typecheck
```

## Credits

- [badlogic](https://github.com/badlogic), pi-coding-agent and the tool/command APIs

## License

[MIT](LICENSE)
