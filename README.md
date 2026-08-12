# pi-git-commit

Keeps mutative git operations out of the agent's bash and provides a safe, reviewable commit flow in [pi-coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent): a bash guard, a `git_commit` tool, and `/commit` + `/toggle-allow-git` commands.

## What you get

- **Bash git guard.** Mutative git commands are blocked in the agent's bash tool — `add`, `commit`, `push`, `pull`, `merge`, `rebase`, `reset`, `clean`, `rm`, `restore`, `switch`, `cherry-pick`, `revert`, `mv`, `init`, `clone`, plus mutative forms of `branch`, `tag` (including creation), `checkout` (including whole-tree restores like `checkout -- .`), `stash`, `submodule`, `worktree`, `config`, `remote`, `apply`, `notes`, `update-ref`, `gc` and more. Read-only commands (`status`, `diff`, `log`, `fetch`, `branch`, `tag`, `stash list`, ...) stay allowed.
- **`git_commit` tool.** The agent stages everything and commits with a `FIX` / `IMPROVE` / `NEW` type prefix. Enabled automatically on session start.
- **`/commit` command.** Waits for queued messages to finish, stages all changes, shows the staged diff, and asks the agent to review it and commit via `git_commit` — never via bash.
- **`/toggle-allow-git` command.** Temporarily allows mutative git commands in bash for the current session. The guard re-arms on the next session.

## Quick start

1. Make your changes, then run:

```text
/commit
```

2. The extension stages the working tree and hands the staged diff to the agent with instructions to review it.

3. The agent commits using the `git_commit` tool:

```json
{
  "type": "FIX",
  "message": "Fix off-by-one in the retry loop"
}
```

4. If you need to run mutative git yourself, allow it for the session:

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
| `message` | Commit message in imperative mood. Multi-line allowed for detailed changes. |

The tool runs `git add .` followed by `git commit -m "<TYPE>: <message>"` and reports staging or commit failures as tool errors. The agent is instructed to only use it after you run `/commit`.

## The bash guard

The guard intercepts `tool_call` events for the bash tool and blocks commands that match mutative git forms. The block list is a conservative superset: anything that can change repository state is blocked, while a curated set of read-only forms is explicitly allowed (for example `git fetch`, `git stash list`, `git remote -v`, `git config --get`, `git apply --check`, `git checkout -- <file>`, `git submodule status`, `git worktree list`).

The guard parses the command into segments (pipelines, `&&`, `||`, `;`, `&`, command and process substitution, newlines) and inspects only segments that actually invoke `git` — including path-qualified invocations (`/usr/bin/git`), wrapper prefixes with their flags (`sudo -u root`, `nice -n 5`, `timeout 5`), environment-assignment prefixes (`VAR=1 git ...`, `env VAR=1 git ...`), control constructs (`{ ...; }`, `!`, `if`, `while`), and `sh -c`/`su -c` wrappers — while skipping git's global options such as `-C`, `-c`, `--git-dir`, and `--work-tree`. Git commands mentioned inside strings or heredocs are not blocked. Plain `git fetch` stays allowed, but `git fetch --prune`/`-p`/`--prune-tags` is blocked. Indirect invocation (aliases, variables, `find -exec`) cannot be detected reliably and is best-effort; likewise a directory passed to `git checkout --` without a trailing slash is indistinguishable from a file, so `git checkout -- src` (restoring the whole `src` tree) is not caught.

A blocked command returns:

```text
Mutative git commands are blocked. Use /toggle-allow-git to allow for this session.
```

## Troubleshooting

- **The agent refuses to commit.** The guard blocks `git commit` in bash by design. Run `/commit` and let the agent use the `git_commit` tool.
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
