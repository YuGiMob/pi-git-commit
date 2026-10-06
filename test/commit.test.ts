import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  Type: {
    Object: (props: any) => props,
    String: (opts: any) => ({ type: "string", ...opts }),
    Number: (opts: any) => ({ type: "number", ...opts }),
    Union: (variants: any[]) => ({ type: "union", variants }),
    Literal: (val: string) => ({ type: "literal", value: val }),
    Optional: (schema: any) => ({ ...schema, optional: true }),
  },
  keyHint: (id: string, description: string) => `${id} (${description})`,
  renderDiff: (text: string) => text,
  truncateHead: (content: string, options?: { maxLines?: number; maxBytes?: number }) => {
    const maxLines = options?.maxLines ?? 2000;
    const maxBytes = options?.maxBytes ?? 50 * 1024;
    const lines = content.length === 0 ? [] : content.split("\n");
    if (content.endsWith("\n")) lines.pop();
    const totalBytes = Buffer.byteLength(content, "utf-8");
    if (lines.length <= maxLines && totalBytes <= maxBytes) {
      return { content, truncated: false, truncatedBy: null, totalLines: lines.length, totalBytes, outputLines: lines.length, outputBytes: totalBytes, lastLinePartial: false, firstLineExceedsLimit: false, maxLines, maxBytes };
    }
    const kept: string[] = [];
    let bytes = 0;
    for (const line of lines) {
      if (kept.length >= maxLines) break;
      const lineBytes = Buffer.byteLength(line, "utf-8") + (kept.length > 0 ? 1 : 0);
      if (bytes + lineBytes > maxBytes) break;
      kept.push(line);
      bytes += lineBytes;
    }
    const output = kept.join("\n");
    return { content: output, truncated: true, truncatedBy: kept.length >= maxLines ? "lines" : "bytes", totalLines: lines.length, totalBytes, outputLines: kept.length, outputBytes: Buffer.byteLength(output, "utf-8"), lastLinePartial: false, firstLineExceedsLimit: false, maxLines, maxBytes };
  },
  formatSize: (bytes: number) => `${bytes}B`,
}));

vi.mock("typebox", () => ({
  Type: {
    Object: (props: any) => props,
    String: (opts: any) => ({ type: "string", ...opts }),
    Number: (opts: any) => ({ type: "number", ...opts }),
    Union: (variants: any[]) => ({ type: "union", variants }),
    Literal: (val: string) => ({ type: "literal", value: val }),
    Optional: (schema: any) => ({ ...schema, optional: true }),
  },
}));

describe("commit extension", () => {
  let extension: any;
  let pi: any;
  let capturedTools: any[] = [];
  let capturedMessageRenderer: any;
  let capturedCommands: any[];
  let toolCallHandler: ((event: any) => Promise<any>) | undefined;
  let sessionStartHandler: (() => void) | undefined;

  async function isBlocked(command: string, toolName = "bash"): Promise<boolean> {
    if (!toolCallHandler) return false;
    const result = await toolCallHandler({ toolName, input: { command } });
    return result?.block === true;
  }

  beforeEach(async () => {
    capturedCommands = [];
    capturedTools = [];
    capturedMessageRenderer = undefined;
    toolCallHandler = undefined;
    sessionStartHandler = undefined;
    pi = {
      on: vi.fn((event: string, handler: any) => {
        if (event === "tool_call") toolCallHandler = handler;
        if (event === "session_start") sessionStartHandler = handler;
      }),
      registerTool: vi.fn((tool: any) => {
        capturedTools.push(tool);
      }),
      registerMessageRenderer: vi.fn((customType: string, renderer: any) => {
        if (customType === "git-commit-diff") capturedMessageRenderer = renderer;
      }),
      registerCommand: vi.fn((name: string, cmd: any) => {
        capturedCommands.push({ name, cmd });
      }),
      getActiveTools: vi.fn(() => ["git_commit"]),
      setActiveTools: vi.fn(),
      sendUserMessage: vi.fn(),
      sendMessage: vi.fn(),
      exec: vi.fn(),
    };

    const mod = await import("../index.js");
    extension = mod.default;
    extension(pi);
  });

  describe("containsBlockedGitCommand", () => {
    it("blocks git add", async () => {
      expect(await isBlocked("git add .")).toBe(true);
    });

    it("blocks git commit", async () => {
      expect(await isBlocked('git commit -m "test"')).toBe(true);
    });

    it("blocks git push", async () => {
      expect(await isBlocked("git push origin main")).toBe(true);
    });

    it("blocks git pull", async () => {
      expect(await isBlocked("git pull origin main")).toBe(true);
    });

    it("blocks git merge", async () => {
      expect(await isBlocked("git merge feature")).toBe(true);
    });

    it("blocks git rebase", async () => {
      expect(await isBlocked("git rebase main")).toBe(true);
    });

    it("blocks git reset", async () => {
      expect(await isBlocked("git reset --hard")).toBe(true);
    });

    it("blocks git clean", async () => {
      expect(await isBlocked("git clean -fd")).toBe(true);
    });

    it("blocks git rm", async () => {
      expect(await isBlocked("git rm file.txt")).toBe(true);
    });

    it("blocks git restore", async () => {
      expect(await isBlocked("git restore file.txt")).toBe(true);
    });

    it("blocks git switch", async () => {
      expect(await isBlocked("git switch main")).toBe(true);
    });

    it("blocks git cherry-pick", async () => {
      expect(await isBlocked("git cherry-pick abc123")).toBe(true);
    });

    it("blocks git revert", async () => {
      expect(await isBlocked("git revert abc123")).toBe(true);
    });

    it("blocks git mv", async () => {
      expect(await isBlocked("git mv old new")).toBe(true);
    });

    it("blocks git init", async () => {
      expect(await isBlocked("git init")).toBe(true);
    });

    it("blocks git clone", async () => {
      expect(await isBlocked("git clone https://example.com/repo.git")).toBe(true);
    });

    it("blocks git config", async () => {
      expect(await isBlocked("git config user.email test@example.com")).toBe(true);
    });

    it("blocks git remote add", async () => {
      expect(await isBlocked("git remote add origin https://example.com/repo.git")).toBe(true);
    });

    it("blocks git apply", async () => {
      expect(await isBlocked("git apply patch.diff")).toBe(true);
    });

    it("blocks git am", async () => {
      expect(await isBlocked("git am 0001-fix.patch")).toBe(true);
    });

    it("blocks git notes add", async () => {
      expect(await isBlocked("git notes add -m note")).toBe(true);
    });

    it("blocks git replace", async () => {
      expect(await isBlocked("git replace HEAD HEAD~1")).toBe(true);
    });

    it("blocks git update-ref", async () => {
      expect(await isBlocked("git update-ref refs/heads/main HEAD")).toBe(true);
    });

    it("blocks git symbolic-ref", async () => {
      expect(await isBlocked("git symbolic-ref HEAD refs/heads/main")).toBe(true);
    });

    it("blocks git update-index", async () => {
      expect(await isBlocked("git update-index --assume-unchanged file.txt")).toBe(true);
    });

    it("blocks git gc", async () => {
      expect(await isBlocked("git gc --prune=now")).toBe(true);
    });

    it("blocks git maintenance", async () => {
      expect(await isBlocked("git maintenance run")).toBe(true);
    });

    it("blocks git sparse-checkout set", async () => {
      expect(await isBlocked("git sparse-checkout set src")).toBe(true);
    });

    it("blocks git lfs push", async () => {
      expect(await isBlocked("git lfs push origin main")).toBe(true);
    });

    it("blocks git branch -d", async () => {
      expect(await isBlocked("git branch -d old-branch")).toBe(true);
    });

    it("blocks git branch -m", async () => {
      expect(await isBlocked("git branch -m new-name")).toBe(true);
    });

    it("blocks git tag -d", async () => {
      expect(await isBlocked("git tag -d v1.0")).toBe(true);
    });

    it("blocks git checkout (branch switch)", async () => {
      expect(await isBlocked("git checkout main")).toBe(true);
    });

    it("blocks git stash (mutative)", async () => {
      expect(await isBlocked("git stash drop")).toBe(true);
    });

    it("blocks git submodule add", async () => {
      expect(await isBlocked("git submodule add https://example.com/repo.git")).toBe(true);
    });

    it("blocks git worktree add", async () => {
      expect(await isBlocked("git worktree add ../path")).toBe(true);
    });

    it("allows git fetch", async () => {
      expect(await isBlocked("git fetch origin")).toBe(false);
    });

    it("blocks git fetch --prune", async () => {
      expect(await isBlocked("git fetch --prune")).toBe(true);
      expect(await isBlocked("git fetch -p origin")).toBe(true);
      expect(await isBlocked("git fetch --prune-tags")).toBe(true);
      expect(await isBlocked("git fetch --all --prune")).toBe(true);
    });

    it("allows git status", async () => {
      expect(await isBlocked("git status")).toBe(false);
    });

    it("allows git diff", async () => {
      expect(await isBlocked("git diff")).toBe(false);
    });

    it("allows git log", async () => {
      expect(await isBlocked("git log --oneline")).toBe(false);
    });

    it("allows git stash list", async () => {
      expect(await isBlocked("git stash list")).toBe(false);
    });

    it("allows git stash show", async () => {
      expect(await isBlocked("git stash show")).toBe(false);
    });

    it("allows git branch (list)", async () => {
      expect(await isBlocked("git branch")).toBe(false);
    });

    it("allows git tag (list)", async () => {
      expect(await isBlocked("git tag")).toBe(false);
    });

    it("allows git checkout -- file", async () => {
      expect(await isBlocked("git checkout -- file.txt")).toBe(false);
    });

    it("allows git submodule status", async () => {
      expect(await isBlocked("git submodule status")).toBe(false);
    });

    it("allows git submodule init", async () => {
      expect(await isBlocked("git submodule init")).toBe(false);
    });

    it("allows git submodule summary", async () => {
      expect(await isBlocked("git submodule summary")).toBe(false);
    });

    it("allows git worktree list", async () => {
      expect(await isBlocked("git worktree list")).toBe(false);
    });

    it("allows git config --list", async () => {
      expect(await isBlocked("git config --list")).toBe(false);
    });

    it("allows git config --get", async () => {
      expect(await isBlocked("git config --get user.name")).toBe(false);
    });

    it("allows git remote -v", async () => {
      expect(await isBlocked("git remote -v")).toBe(false);
    });

    it("allows git remote (bare list)", async () => {
      expect(await isBlocked("git remote")).toBe(false);
    });

    it("allows git remote show", async () => {
      expect(await isBlocked("git remote show origin")).toBe(false);
    });

    it("allows git remote get-url", async () => {
      expect(await isBlocked("git remote get-url origin")).toBe(false);
    });

    it("allows git apply --check", async () => {
      expect(await isBlocked("git apply --check patch.diff")).toBe(false);
    });

    it("allows git notes list", async () => {
      expect(await isBlocked("git notes list")).toBe(false);
    });

    it("allows git lfs ls-files", async () => {
      expect(await isBlocked("git lfs ls-files")).toBe(false);
    });

    it("allows git sparse-checkout list", async () => {
      expect(await isBlocked("git sparse-checkout list")).toBe(false);
    });

    it("allows non-git commands", async () => {
      expect(await isBlocked("ls -la")).toBe(false);
    });

    it("blocks mutative git commands in the powershell tool", async () => {
      expect(await isBlocked("git push", "powershell")).toBe(true);
      expect(await isBlocked("git -C /tmp/repo reset --hard", "powershell")).toBe(true);
      expect(await isBlocked("git status", "powershell")).toBe(false);
    });

    it("allows git commands mentioned inside strings", async () => {
      expect(await isBlocked("echo 'git add is dangerous'")).toBe(false);
      expect(await isBlocked("grep -rn 'git push' docs")).toBe(false);
    });

    it("allows git commands inside heredocs", async () => {
      const script = `cat > deploy.sh <<'EOF'
git push origin main
git commit -m x
EOF`;
      expect(await isBlocked(script)).toBe(false);
    });

    it("allows git commands inside backslash-quoted heredocs", async () => {
      const script = `cat <<\\EOF
git push origin main
EOF`;
      expect(await isBlocked(script)).toBe(false);
    });

    it("allows git in command substitution for read-only commands", async () => {
      expect(await isBlocked("echo $(git rev-parse HEAD)")).toBe(false);
    });

    it("blocks git with -C directory", async () => {
      expect(await isBlocked("git -C /tmp/repo commit -m x")).toBe(true);
    });

    it("blocks git with -c config overrides", async () => {
      expect(await isBlocked("git -c user.name=x commit -m y")).toBe(true);
      expect(await isBlocked("git -c core.hooksPath=/tmp/hooks commit -m y")).toBe(true);
    });

    it("blocks git with --git-dir and --work-tree", async () => {
      expect(await isBlocked("git --git-dir=/tmp/gitdir push")).toBe(true);
      expect(await isBlocked("git --work-tree=/tmp commit")).toBe(true);
    });

    it("blocks uppercase GIT", async () => {
      expect(await isBlocked("GIT add .")).toBe(true);
    });

    it("blocks history rewrites and object maintenance", async () => {
      expect(await isBlocked("git filter-branch --all")).toBe(true);
      expect(await isBlocked("git filter-repo --force")).toBe(true);
      expect(await isBlocked("git fast-import < dump")).toBe(true);
      expect(await isBlocked("git prune")).toBe(true);
      expect(await isBlocked("git repack -a")).toBe(true);
      expect(await isBlocked("git pack-refs --all")).toBe(true);
      expect(await isBlocked("git reflog expire --all")).toBe(true);
    });

    it("allows git reflog show", async () => {
      expect(await isBlocked("git reflog show HEAD")).toBe(false);
      expect(await isBlocked("git reflog")).toBe(false);
    });

    it("blocks git subtree, bisect and mergetool", async () => {
      expect(await isBlocked("git subtree push origin main")).toBe(true);
      expect(await isBlocked("git subtree add --prefix=lib https://example.com/repo.git main")).toBe(true);
      expect(await isBlocked("git bisect reset")).toBe(true);
      expect(await isBlocked("git mergetool")).toBe(true);
    });

    it("blocks git behind sudo and in sh -c", async () => {
      expect(await isBlocked("sudo git push origin main")).toBe(true);
      expect(await isBlocked('sh -c "git push origin main"')).toBe(true);
      expect(await isBlocked("bash -c 'git add .'")).toBe(true);
    });

    it("blocks git in command substitution and after background operators", async () => {
      expect(await isBlocked("echo $(git push origin main)")).toBe(true);
      expect(await isBlocked("npm run build & git push")).toBe(true);
    });

    it("blocks git checkout -- . and directory restores", async () => {
      expect(await isBlocked("git checkout -- .")).toBe(true);
      expect(await isBlocked("git checkout -- src/")).toBe(true);
    });

    it("blocks mutative commands in mixed pipelines", async () => {
      expect(await isBlocked("git status && git push")).toBe(true);
      expect(await isBlocked("git config --list && git fetch origin")).toBe(false);
    });

    it("allows non-git binaries with git-like names", async () => {
      expect(await isBlocked("mygit commit")).toBe(false);
      expect(await isBlocked("git-upload-pack")).toBe(false);
    });

    it("blocks path-qualified git invocations", async () => {
      expect(await isBlocked("/usr/bin/git push")).toBe(true);
      expect(await isBlocked("./git commit -m x")).toBe(true);
      expect(await isBlocked("sudo /usr/bin/git push")).toBe(true);
    });

    it("blocks git behind wrapper prefixes with flags", async () => {
      expect(await isBlocked("sudo -u root git push origin main")).toBe(true);
      expect(await isBlocked("sudo -u git push")).toBe(true);
      expect(await isBlocked("nice -n 5 git push")).toBe(true);
      expect(await isBlocked("env -i git push")).toBe(true);
      expect(await isBlocked("time -p git push")).toBe(true);
      expect(await isBlocked("timeout 5 git push")).toBe(true);
      expect(await isBlocked("doas -u root git add .")).toBe(true);
    });

    it("blocks repeated git tokens behind wrapper prefixes", async () => {
      expect(await isBlocked("sudo -u git git push")).toBe(true);
      expect(await isBlocked("env -u git git push")).toBe(true);
      expect(await isBlocked("git git push")).toBe(true);
      expect(await isBlocked("sudo -u git ls")).toBe(false);
    });

    it("blocks git with env var assignments", async () => {
      expect(await isBlocked("VAR=1 git push origin main")).toBe(true);
      expect(await isBlocked("env VAR=1 git push")).toBe(true);
      expect(await isBlocked("GIT_CONFIG=/tmp/cfg git commit -m x")).toBe(true);
      expect(await isBlocked('FOO="a b" git push')).toBe(true);
      expect(await isBlocked("FOO=bar ls -la")).toBe(false);
    });

    it("allows non-git commands behind wrapper prefixes with flags", async () => {
      expect(await isBlocked("sudo -u root ls -la")).toBe(false);
      expect(await isBlocked("nice -n 5 make")).toBe(false);
      expect(await isBlocked("timeout 5 ls")).toBe(false);
    });

    it("blocks git in shell control constructs", async () => {
      expect(await isBlocked("{ git push; }")).toBe(true);
      expect(await isBlocked("! git push")).toBe(true);
      expect(await isBlocked("if git push; then :; fi")).toBe(true);
      expect(await isBlocked("while git push; do :; done")).toBe(true);
      expect(await isBlocked("then git push")).toBe(true);
    });

    it("blocks git in process substitution", async () => {
      expect(await isBlocked("cat <(git push)")).toBe(true);
      expect(await isBlocked("diff <(git show HEAD) <(git push)")).toBe(true);
    });

    it("blocks git behind su -c", async () => {
      expect(await isBlocked('su -c "git push origin main"')).toBe(true);
      expect(await isBlocked("su - -c 'git add .'")).toBe(true);
      expect(await isBlocked("su root -c git push")).toBe(true);
      expect(await isBlocked('su -c "echo hi"')).toBe(false);
    });

    it("blocks tag creation", async () => {
      expect(await isBlocked("git tag v1.0")).toBe(true);
      expect(await isBlocked('git tag -m "msg" v1.0')).toBe(true);
      expect(await isBlocked("git tag -a v1.0 -m msg")).toBe(true);
    });

    it("allows tag listing", async () => {
      expect(await isBlocked("git tag -l")).toBe(false);
      expect(await isBlocked("git tag --list 'v*'")).toBe(false);
      expect(await isBlocked("git tag --contains HEAD")).toBe(false);
      expect(await isBlocked("git tag --sort=-creatordate")).toBe(false);
      expect(await isBlocked("git tag -n5")).toBe(false);
    });

    it("blocks tag mutations hidden after read-only flags", async () => {
      expect(await isBlocked("git tag --sort=-creatordate -d v1.0")).toBe(true);
      expect(await isBlocked("git tag -n1 -d v1.0")).toBe(true);
      expect(await isBlocked("git tag --contains HEAD -a v1.0 -m msg")).toBe(true);
      expect(await isBlocked("git tag --sort=-creatordate v2.0")).toBe(true);
      expect(await isBlocked("git tag --color v3.0")).toBe(true);
      expect(await isBlocked("git tag --format='%(refname)' v4.0")).toBe(true);
      expect(await isBlocked("git tag --merged main -d v1.0")).toBe(true);
    });

    it("allows read-only tag listing with values", async () => {
      expect(await isBlocked("git tag -v v1.0")).toBe(false);
      expect(await isBlocked("git tag --no-contains HEAD")).toBe(false);
      expect(await isBlocked("git tag --sort creatordate")).toBe(false);
      expect(await isBlocked("git tag --format '%(refname)'")).toBe(false);
      expect(await isBlocked("git tag -i")).toBe(false);
      expect(await isBlocked("git tag --merged main v5.0")).toBe(false);
      expect(await isBlocked("git tag --points-at HEAD v5.0")).toBe(false);
      expect(await isBlocked("git tag --contains=HEAD v5.0")).toBe(false);
    });

    it("blocks git config read flags combined with write flags", async () => {
      expect(await isBlocked("git config --get --add x y")).toBe(true);
      expect(await isBlocked("git config --list --unset x")).toBe(true);
    });

    it("blocks git branch --prune and upstream changes", async () => {
      expect(await isBlocked("git branch --prune")).toBe(true);
      expect(await isBlocked("git branch --set-upstream-to=origin/main")).toBe(true);
    });

    it("blocks multi-path checkout restores", async () => {
      expect(await isBlocked("git checkout -- a b c")).toBe(true);
      expect(await isBlocked("git checkout -- a.txt")).toBe(false);
    });

    it("blocks git branch -u, -f, -c and --force", async () => {
      expect(await isBlocked("git branch -u origin/main")).toBe(true);
      expect(await isBlocked("git branch -f main HEAD")).toBe(true);
      expect(await isBlocked("git branch -c copy")).toBe(true);
      expect(await isBlocked("git branch --force main HEAD")).toBe(true);
    });

    it("blocks git stage and index/object plumbing", async () => {
      expect(await isBlocked("git stage .")).toBe(true);
      expect(await isBlocked("git read-tree HEAD")).toBe(true);
      expect(await isBlocked("git checkout-index -a")).toBe(true);
      expect(await isBlocked("git merge-file a b c")).toBe(true);
      expect(await isBlocked("git prune-packed")).toBe(true);
    });

    it("blocks deeply nested sh -c wrappers (fail closed)", async () => {
      const nested = `sh -c "`.repeat(5) + "git push" + `"`.repeat(5);
      expect(await isBlocked(nested)).toBe(true);
    });

    it("blocks long wrapper prefix chains", async () => {
      expect(await isBlocked("sudo sudo sudo sudo sudo sudo git push")).toBe(true);
    });

    it("blocks combined short flags and force variants on branch", async () => {
      expect(await isBlocked("git branch -dv old-branch")).toBe(true);
      expect(await isBlocked("git branch -D old-branch")).toBe(true);
      expect(await isBlocked("git branch -M new-name")).toBe(true);
      expect(await isBlocked("git branch -fu main HEAD")).toBe(true);
    });

    it("allows read-only branch flags", async () => {
      expect(await isBlocked("git branch -v")).toBe(false);
      expect(await isBlocked("git branch -vv")).toBe(false);
      expect(await isBlocked("git branch -a")).toBe(false);
      expect(await isBlocked("git branch -r")).toBe(false);
    });

    it("blocks branch creation", async () => {
      expect(await isBlocked("git branch feature")).toBe(true);
      expect(await isBlocked("git branch feature main")).toBe(true);
      expect(await isBlocked("git branch -- feature")).toBe(true);
      expect(await isBlocked("git branch -q feature")).toBe(true);
      expect(await isBlocked("git branch -v feature")).toBe(true);
      expect(await isBlocked("git branch -i feature")).toBe(true);
      expect(await isBlocked("git branch --sort=name feature")).toBe(true);
      expect(await isBlocked("git branch --format='%(refname)' feature")).toBe(true);
      expect(await isBlocked("git branch --color feature")).toBe(true);
      expect(await isBlocked("git branch --no-color feature")).toBe(true);
    });

    it("blocks branch -t and --track", async () => {
      expect(await isBlocked("git branch -t feature")).toBe(true);
      expect(await isBlocked("git branch --track feature")).toBe(true);
    });

    it("allows read-only branch listing with patterns", async () => {
      expect(await isBlocked("git branch -l feature")).toBe(false);
      expect(await isBlocked("git branch --list 'v*'")).toBe(false);
      expect(await isBlocked("git branch --merged main")).toBe(false);
      expect(await isBlocked("git branch --no-merged main")).toBe(false);
      expect(await isBlocked("git branch --contains HEAD")).toBe(false);
      expect(await isBlocked("git branch --no-contains HEAD")).toBe(false);
      expect(await isBlocked("git branch --points-at HEAD")).toBe(false);
      expect(await isBlocked("git branch --show-current")).toBe(false);
    });

    it("fails closed on deeply nested wrappers even without git", async () => {
      const nested = `sh -c "`.repeat(5) + "ls" + `"`.repeat(5);
      expect(await isBlocked(nested)).toBe(true);
    });
  });

  describe("git_commit tool registration", () => {
    it("registers a tool named git_commit", () => {
      const commitTool = capturedTools.find((t: any) => t.name === "git_commit");
      expect(commitTool).toBeDefined();
      expect(commitTool.name).toBe("git_commit");
    });

    it("has FIX, IMPROVE, NEW as type options", () => {
      const tool = capturedTools.find((t: any) => t.name === "git_commit");
      expect(tool.parameters.type).toBeDefined();
    });

    it("has a message parameter", () => {
      const tool = capturedTools.find((t: any) => t.name === "git_commit");
      expect(tool.parameters.message).toBeDefined();
      expect(tool.parameters.message.minLength).toBe(1);
    });
  });

  describe("git_amend tool registration", () => {
    it("registers a tool named git_amend", () => {
      const amendTool = capturedTools.find((t: any) => t.name === "git_amend");
      expect(amendTool).toBeDefined();
      expect(amendTool.name).toBe("git_amend");
    });

    it("has the same parameters as git_commit", () => {
      const amendTool = capturedTools.find((t: any) => t.name === "git_amend");
      expect(amendTool.parameters.type).toBeDefined();
      expect(amendTool.parameters.message).toBeDefined();
      expect(amendTool.parameters.message.minLength).toBe(1);
    });
  });

  describe("/amend command registration", () => {
    it("registers a command named amend", () => {
      const cmd = capturedCommands.find((c: any) => c.name === "amend");
      expect(cmd).toBeDefined();
    });
  });

  describe("/commit command registration", () => {
    it("registers a command named commit", () => {
      const cmd = capturedCommands.find((c: any) => c.name === "commit");
      expect(cmd).toBeDefined();
    });
  });

  describe("/toggle-allow-git command registration", () => {
    it("registers a command named toggle-allow-git", () => {
      const cmd = capturedCommands.find((c: any) => c.name === "toggle-allow-git");
      expect(cmd).toBeDefined();
    });
  });

  describe("/stop-commit command registration", () => {
    it("registers a command named stop-commit", () => {
      const cmd = capturedCommands.find((c: any) => c.name === "stop-commit");
      expect(cmd).toBeDefined();
    });
  });

  describe("session_start handler", () => {
    it("leaves the active tools untouched so the provider prompt cache stays stable", () => {
      pi.getActiveTools = vi.fn(() => ["git_commit", "bash"]);
      sessionStartHandler!();
      expect(pi.setActiveTools).not.toHaveBeenCalled();
    });
  });

  describe("block reason", () => {
    it("includes a hint about /toggle-allow-git", async () => {
      const result = await toolCallHandler!({ toolName: "bash", input: { command: "git push" } });
      expect(result.reason).toContain("/toggle-allow-git");
    });
  });

  describe("/commit command handler", () => {
    const commitCommand = () => capturedCommands.find((c: any) => c.name === "commit");

    function createCtx() {
      return {
        hasUI: true,
        ui: {
          notify: vi.fn(),
          setWorkingMessage: vi.fn(),
          onTerminalInput: vi.fn(() => () => {}),
        },
        waitForIdle: vi.fn(),
      };
    }

    it("sends the staged diff as a collapsible custom message and restores the default working message", async () => {
      pi.exec = vi.fn()
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "diff --git a/x b/x\n+hello", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "1 file changed, 1 insertion(+)", stderr: "" });
      const ctx = createCtx();

      await commitCommand()!.cmd.handler("", ctx);

      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "git-commit-diff",
          display: true,
          content: expect.stringContaining("diff --git a/x b/x"),
          details: { diff: "diff --git a/x b/x\n+hello", stat: "1 file changed, 1 insertion(+)" },
        }),
        expect.objectContaining({ deliverAs: "followUp", triggerTurn: true }),
      );
      const sent = pi.sendMessage.mock.calls[0][0] as { content: string };
      expect(sent.content).toContain("1 file changed, 1 insertion(+)");
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expect(ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith();
    });

    it("omits a diff over the preview budget and keeps only the capped stat", async () => {
      const hugeDiff = ["diff --git a/big b/big", "--- a/big", "+++ b/big", ...Array.from({ length: 2500 }, (_, index) => `+line ${index}`)].join("\n");
      const hugeStat = [...Array.from({ length: 150 }, (_, index) => ` file${index}.txt | 1 +`), " 150 files changed, 2500 insertions(+)"].join("\n");
      pi.exec = vi.fn()
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: hugeDiff, stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: hugeStat, stderr: "" });
      const ctx = createCtx();

      await commitCommand()!.cmd.handler("", ctx);

      const sent = pi.sendMessage.mock.calls[0][0] as { content: string; details: { diff?: string; stat: string; note?: string } };
      expect(sent.content).toContain("Review staged changes");
      expect(sent.content).toContain("[Diff omitted: over the 2000 line / 50KB preview budget");
      expect(sent.content).not.toContain("diff --git");
      expect(sent.content).toContain("[Stat truncated: showing 100 of 151 lines");
      expect(sent.details.diff).toBeUndefined();
      expect(sent.details.note).toContain("[Diff omitted:");
      expect(sent.details.stat).toContain("[Stat truncated:");
    });

    it("includes the full diff when it fits the preview budget", async () => {
      const fittingDiff = ["diff --git a/x b/x", "--- a/x", "+++ b/x", ...Array.from({ length: 1997 }, (_, index) => `+line ${index}`)].join("\n");
      pi.exec = vi.fn()
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: fittingDiff, stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: " 1 file changed, 1997 insertions(+)", stderr: "" });
      const ctx = createCtx();

      await commitCommand()!.cmd.handler("", ctx);

      const sent = pi.sendMessage.mock.calls[0][0] as { content: string; details: { diff?: string } };
      expect(sent.content).not.toContain("[Diff omitted");
      expect(sent.content).toContain("+line 1996");
      expect(sent.details.diff).toBe(fittingDiff);
    });

    it("sends the custom message without changing the active tools", async () => {
      pi.getActiveTools = vi.fn(() => []);
      pi.exec = vi.fn().mockResolvedValue({ code: 0, stdout: "diff --git a/x b/x", stderr: "" });
      const ctx = createCtx();

      await commitCommand()!.cmd.handler("", ctx);

      expect(pi.setActiveTools).not.toHaveBeenCalled();
      expect(pi.sendMessage).toHaveBeenCalled();
    });

    it("restores the default working message when git add fails", async () => {
      pi.exec = vi.fn().mockResolvedValue({ code: 1, stdout: "", stderr: "fatal: not a git repository" });
      const ctx = createCtx();

      await commitCommand()!.cmd.handler("", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("git add failed"), "error");
      expect(ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith();
    });

    it("restores the default working message when git diff fails", async () => {
      pi.exec = vi.fn()
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "fatal" });
      const ctx = createCtx();

      await commitCommand()!.cmd.handler("", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("git diff failed"), "error");
      expect(ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith();
    });

    it("restores the default working message when there is nothing staged", async () => {
      pi.exec = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
      const ctx = createCtx();

      await commitCommand()!.cmd.handler("", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Nothing to commit"), "warning");
      expect(ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith();
    });
  });

  describe("git-commit-diff message renderer", () => {
    const theme = {
      bg: (_name: string, text: string) => text,
      fg: (_name: string, text: string) => text,
    };
    const message = {
      content: "Review staged changes",
      details: { diff: "diff --git a/x b/x\n+hello", stat: "1 file changed, 1 insertion(+)" },
    };

    it("registers a renderer for git-commit-diff", () => {
      expect(capturedMessageRenderer).toBeDefined();
    });

    it("shows the stat summary and an expand hint when collapsed", () => {
      const box = capturedMessageRenderer(message, { expanded: false, outputPad: 0 }, theme);
      const text = box.render(80).join("\n");
      expect(text).toContain("1 file changed, 1 insertion(+)");
      expect(text).toContain("app.tools.expand");
      expect(text).not.toContain("diff --git");
    });

    it("shows the full diff when expanded", () => {
      const box = capturedMessageRenderer(message, { expanded: true, outputPad: 0 }, theme);
      const text = box.render(80).join("\n");
      expect(text).toContain("diff --git a/x b/x");
      expect(text).toContain("+hello");
    });

    it("shows the omission note when the diff was too large to attach", () => {
      const box = capturedMessageRenderer(
        { content: "Review staged changes", details: { stat: "1 file changed", note: "[Diff omitted: over budget]" } },
        { expanded: true, outputPad: 0 },
        theme,
      );
      const text = box.render(80).join("\n");
      expect(text).toContain("[Diff omitted: over budget]");
    });
  });

  describe("/stop-commit command handler", () => {
    let stopCommand: any;
    let commitCommand: any;
    let amendCommand: any;
    let fakePi: any;

    let terminalInputHandler: ((data: string) => unknown) | undefined;
    function createCtx() {
      return {
        hasUI: true,
        ui: {
          notify: vi.fn(),
          setWorkingMessage: vi.fn(),
          onTerminalInput: vi.fn((handler: (data: string) => unknown) => {
            terminalInputHandler = handler;
            return () => {
              terminalInputHandler = undefined;
            };
          }),
        },
        waitForIdle: vi.fn(),
      };
    }

    beforeEach(async () => {
      terminalInputHandler = undefined;
      vi.resetModules();
      const mod = await import("../index.js");
      fakePi = {
        on: vi.fn(),
        registerTool: vi.fn(),
        registerMessageRenderer: vi.fn(),
        registerCommand: vi.fn((name: string, cmd: any) => {
          if (name === "stop-commit") stopCommand = cmd;
          if (name === "commit") commitCommand = cmd;
          if (name === "amend") amendCommand = cmd;
        }),
        getActiveTools: vi.fn(() => []),
        setActiveTools: vi.fn(),
        sendUserMessage: vi.fn(),
        sendMessage: vi.fn(),
        exec: vi.fn(),
      };
      mod.default(fakePi);
    });

    it("steers the agent away and notifies when a commit flow is active", async () => {
      fakePi.exec = vi.fn().mockResolvedValue({ code: 0, stdout: "diff --git a/x b/x", stderr: "" });
      await commitCommand.handler("", createCtx());
      const ctx = createCtx();
      await stopCommand.handler("", ctx);
      expect(fakePi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ customType: "git-commit-stopped", display: false, content: expect.stringContaining("/stop-commit") }),
        expect.objectContaining({ deliverAs: "steer" }),
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("stopped"), "info");
    });

    it("notifies that no flow is in progress when none is active", async () => {
      const ctx = createCtx();
      await stopCommand.handler("", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("No commit flow"), "info");
      expect(fakePi.setActiveTools).not.toHaveBeenCalled();
    });

    it("aborts a pending /commit flow while it waits for idle", async () => {
      let resolveIdle!: () => void;
      const idlePromise = new Promise<void>((resolve) => { resolveIdle = resolve; });
      const ctx = createCtx();
      ctx.waitForIdle = vi.fn(() => idlePromise);
      fakePi.exec = vi.fn().mockResolvedValue({ code: 0, stdout: "diff --git a/x b/x", stderr: "" });
      const commitPromise = commitCommand.handler("", ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await stopCommand.handler("", createCtx());
      resolveIdle();
      await commitPromise;
      expect(fakePi.sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ customType: "git-commit-diff" }),
        expect.anything(),
      );
      expect(fakePi.setActiveTools).not.toHaveBeenCalled();
    });

    it("aborts a pending /commit flow while it is staging", async () => {
      let resolveAdd!: (value: any) => void;
      const addPromise = new Promise((resolve) => { resolveAdd = resolve; });
      fakePi.exec = vi.fn()
        .mockReturnValueOnce(addPromise)
        .mockResolvedValue({ code: 0, stdout: "diff --git a/x b/x", stderr: "" });
      const ctx = createCtx();
      const commitPromise = commitCommand.handler("", ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await stopCommand.handler("", createCtx());
      resolveAdd({ code: 0, stdout: "", stderr: "" });
      await commitPromise;
      expect(fakePi.sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ customType: "git-commit-diff" }),
        expect.anything(),
      );
      expect(fakePi.setActiveTools).not.toHaveBeenCalled();
    });

    it("aborts a pending /amend flow while it waits for idle", async () => {
      let resolveIdle!: () => void;
      const idlePromise = new Promise<void>((resolve) => { resolveIdle = resolve; });
      const ctx = createCtx();
      ctx.waitForIdle = vi.fn(() => idlePromise);
      const amendPromise = amendCommand.handler("better message", ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await stopCommand.handler("", createCtx());
      resolveIdle();
      await amendPromise;
      expect(fakePi.sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ customType: "git-amend-request" }),
        expect.anything(),
      );
      expect(fakePi.setActiveTools).not.toHaveBeenCalled();
    });

    it("cancels a pending /commit flow when escape is pressed", async () => {
      let resolveIdle!: () => void;
      const idlePromise = new Promise<void>((resolve) => { resolveIdle = resolve; });
      const ctx = createCtx();
      ctx.waitForIdle = vi.fn(() => idlePromise);
      fakePi.exec = vi.fn().mockResolvedValue({ code: 0, stdout: "diff --git a/x b/x", stderr: "" });

      const commitPromise = commitCommand.handler("", ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(ctx.ui.setWorkingMessage).toHaveBeenCalledWith("Waiting for queued messages to complete...");

      terminalInputHandler!("\x1b");
      expect(ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith();
      resolveIdle();
      await commitPromise;

      expect(fakePi.sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ customType: "git-commit-diff" }),
        expect.anything(),
      );
      expect(fakePi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ customType: "git-commit-stopped", display: false, content: expect.stringContaining("escape") }),
        expect.objectContaining({ deliverAs: "steer" }),
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Commit flow stopped"), "info");
    });

    it("cancels a pending /amend flow when escape is pressed", async () => {
      let resolveIdle!: () => void;
      const idlePromise = new Promise<void>((resolve) => { resolveIdle = resolve; });
      const ctx = createCtx();
      ctx.waitForIdle = vi.fn(() => idlePromise);

      const amendPromise = amendCommand.handler("better message", ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(ctx.ui.setWorkingMessage).toHaveBeenCalledWith("Waiting for queued messages to complete...");

      terminalInputHandler!("\x1b");
      expect(ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith();
      resolveIdle();
      await amendPromise;

      expect(fakePi.sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ customType: "git-amend-request" }),
        expect.anything(),
      );
      expect(fakePi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ customType: "git-commit-stopped", display: false, content: expect.stringContaining("escape") }),
        expect.objectContaining({ deliverAs: "steer" }),
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Amend flow stopped"), "info");
    });

    it("clears the custom working message when the flow is stopped", async () => {
      let resolveIdle!: () => void;
      const idlePromise = new Promise<void>((resolve) => { resolveIdle = resolve; });
      const ctx = createCtx();
      ctx.waitForIdle = vi.fn(() => idlePromise);
      fakePi.exec = vi.fn().mockResolvedValue({ code: 0, stdout: "diff --git a/x b/x", stderr: "" });

      const commitPromise = commitCommand.handler("", ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(ctx.ui.setWorkingMessage).toHaveBeenCalledWith("Waiting for queued messages to complete...");

      const stopCtx = createCtx();
      await stopCommand.handler("", stopCtx);
      expect(stopCtx.ui.setWorkingMessage).toHaveBeenCalledWith();

      resolveIdle();
      await commitPromise;
    });

    it("closes the flow when escape is pressed after the diff was sent", async () => {
      fakePi.exec = vi.fn().mockResolvedValue({ code: 0, stdout: "diff --git a/x b/x", stderr: "" });
      const ctx = createCtx();
      await commitCommand.handler("", ctx);
      expect(fakePi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ customType: "git-commit-diff" }),
        expect.anything(),
      );

      terminalInputHandler!("\x1b");
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Commit flow stopped"), "info");
      expect(fakePi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ customType: "git-commit-stopped", display: false, content: expect.stringContaining("escape") }),
        expect.objectContaining({ deliverAs: "steer" }),
      );
      expect(terminalInputHandler).toBeUndefined();

      const stopCtx = createCtx();
      await stopCommand.handler("", stopCtx);
      expect(stopCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("No commit flow"), "info");
    });
  });

  describe("git_amend tool integration (real git)", () => {
    let tempDir: string;
    let tool: any;
    let fakePi: any;
    let amendCommand: any;
    let stopCommand: any;

    const runGit = (args: string[]) => {
      const result = spawnSync("git", args, { cwd: tempDir, encoding: "utf-8" });
      return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    };

    const realExec = (command: string, args: string[], opts?: { cwd?: string }) => {
      const result = spawnSync(command, args, { cwd: opts?.cwd ?? tempDir, encoding: "utf-8" });
      return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    };

    const startAmendFlow = async (critique: string) => {
      const ctx = { hasUI: true, ui: { notify: vi.fn(), setWorkingMessage: vi.fn(), onTerminalInput: vi.fn(() => () => {}) }, waitForIdle: vi.fn() };
      await amendCommand.handler(critique, ctx);
    };

    const seedCommit = (name: string, message: string) => {
      fs.writeFileSync(path.join(tempDir, name), "hello");
      runGit(["add", "."]);
      runGit(["commit", "-m", message]);
    };

    beforeEach(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-git-commit-amend-"));
      runGit(["init", "-b", "main"]);
      runGit(["config", "user.name", "Test User"]);
      runGit(["config", "user.email", "test@example.com"]);
      runGit(["config", "commit.gpgsign", "false"]);

      vi.resetModules();
      const mod = await import("../index.js");
      fakePi = {
        on: vi.fn(),
        registerTool: vi.fn((registered: any) => {
          tool = registered;
        }),
        registerMessageRenderer: vi.fn(),
        registerCommand: vi.fn((name: string, cmd: any) => {
          if (name === "amend") amendCommand = cmd;
          if (name === "stop-commit") stopCommand = cmd;
        }),
        getActiveTools: vi.fn(() => []),
        setActiveTools: vi.fn(),
        sendUserMessage: vi.fn(),
        sendMessage: vi.fn(),
        exec: vi.fn(realExec),
      };
      mod.default(fakePi);
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("refuses to run without an amend flow", async () => {
      const result = await tool.execute("call-1", { type: "FIX", message: "rewrite" }, undefined, vi.fn(), {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No amend flow");
    });

    it("sends only the critique to the agent", async () => {
      seedCommit("a.txt", "seed");
      await startAmendFlow("the type should be IMPROVE");

      expect(fakePi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          display: false,
          content: expect.stringContaining("the type should be IMPROVE"),
        }),
        expect.objectContaining({ deliverAs: "followUp", triggerTurn: true }),
      );
      const request = fakePi.sendMessage.mock.calls[0][0] as { content: string };
      expect(request.content).not.toContain("seed");
      expect(request.content).toContain("git_amend");
      expect(fakePi.exec).not.toHaveBeenCalled();
    });

    it("amends the last commit message with the TYPE prefix and closes the flow", async () => {
      seedCommit("b.txt", "seed");
      await startAmendFlow("mention the retry loop");

      const result = await tool.execute("call-1", { type: "FIX", message: "Fix: correct the retry loop" }, undefined, vi.fn(), {});
      expect(result.isError).toBeFalsy();
      expect(runGit(["log", "-1", "--format=%s"]).stdout.trim()).toBe("FIX: correct the retry loop");
      expect(runGit(["status", "--porcelain"]).stdout.trim()).toBe("");

      const again = await tool.execute("call-1", { type: "FIX", message: "again" }, undefined, vi.fn(), {});
      expect(again.isError).toBe(true);
      expect(again.content[0].text).toContain("No amend flow");
    });

    it("refreshes the commit timestamp to the current time", async () => {
      const oldDate = "2001-01-01T00:00:00Z";
      fs.writeFileSync(path.join(tempDir, "k.txt"), "hello");
      runGit(["add", "."]);
      spawnSync("git", ["commit", "-m", "seed"], { cwd: tempDir, encoding: "utf-8", env: { ...process.env, GIT_AUTHOR_DATE: oldDate, GIT_COMMITTER_DATE: oldDate } });
      expect(runGit(["log", "-1", "--format=%ad", "--date=unix"]).stdout.trim()).toBe("978307200");

      await startAmendFlow("refresh the timestamp");
      const before = Math.floor(Date.now() / 1000);
      const result = await tool.execute("call-1", { type: "FIX", message: "refreshed message" }, undefined, vi.fn(), {});
      const after = Math.ceil(Date.now() / 1000);

      expect(result.isError).toBeFalsy();
      const authorDate = Number(runGit(["log", "-1", "--format=%ad", "--date=unix"]).stdout.trim());
      const committerDate = Number(runGit(["log", "-1", "--format=%cd", "--date=unix"]).stdout.trim());
      expect(authorDate).toBeGreaterThanOrEqual(before);
      expect(authorDate).toBeLessThanOrEqual(after);
      expect(committerDate).toBeGreaterThanOrEqual(before);
      expect(committerDate).toBeLessThanOrEqual(after);
    });

    it("leaves untracked files untouched while amending", async () => {
      seedCommit("c.txt", "seed");
      await startAmendFlow("better message");
      fs.writeFileSync(path.join(tempDir, "d.txt"), "untracked");

      const result = await tool.execute("call-1", { type: "IMPROVE", message: "better message" }, undefined, vi.fn(), {});
      expect(result.isError).toBeFalsy();
      expect(runGit(["log", "-1", "--format=%s"]).stdout.trim()).toBe("IMPROVE: better message");
      expect(runGit(["status", "--porcelain"]).stdout.trim()).toBe("?? d.txt");
    });

    it("refuses when the index has staged changes and keeps the flow open", async () => {
      seedCommit("e.txt", "seed");
      await startAmendFlow("sharpen the message");
      fs.writeFileSync(path.join(tempDir, "f.txt"), "staged");
      runGit(["add", "."]);

      const result = await tool.execute("call-1", { type: "FIX", message: "sharpened" }, undefined, vi.fn(), {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("staged");
      expect(runGit(["log", "-1", "--format=%s"]).stdout.trim()).toBe("seed");

      runGit(["reset"]);
      const retry = await tool.execute("call-1", { type: "FIX", message: "sharpened" }, undefined, vi.fn(), {});
      expect(retry.isError).toBeFalsy();
      expect(runGit(["log", "-1", "--format=%s"]).stdout.trim()).toBe("FIX: sharpened");
    });

    it("keeps the flow open after a failed amend so the agent can retry", async () => {
      seedCommit("g.txt", "seed");
      await startAmendFlow("fix the message");

      fakePi.exec = vi.fn(async (_command: string, args: string[]) => {
        if (args[0] === "commit") return { code: 1, stdout: "", stderr: "boom" };
        return { code: 0, stdout: "", stderr: "" };
      });
      const failed = await tool.execute("call-1", { type: "FIX", message: "boom message" }, undefined, vi.fn(), {});
      expect(failed.isError).toBe(true);
      expect(failed.content[0].text).toContain("Amend failed");

      fakePi.exec = realExec;
      const retry = await tool.execute("call-1", { type: "FIX", message: "real message" }, undefined, vi.fn(), {});
      expect(retry.isError).toBeFalsy();
      expect(runGit(["log", "-1", "--format=%s"]).stdout.trim()).toBe("FIX: real message");
    });

    it("rejects an empty message without closing the flow", async () => {
      seedCommit("h.txt", "seed");
      await startAmendFlow("fix");
      const result = await tool.execute("call-1", { type: "FIX", message: "   " }, undefined, vi.fn(), {});
      expect(result.isError).toBe(true);
      const retry = await tool.execute("call-1", { type: "FIX", message: "real message" }, undefined, vi.fn(), {});
      expect(retry.isError).toBeFalsy();
      expect(runGit(["log", "-1", "--format=%s"]).stdout.trim()).toBe("FIX: real message");
    });

    it("opens no flow when /amend is called without a critique", async () => {
      seedCommit("i.txt", "seed");
      const ctx = { hasUI: true, ui: { notify: vi.fn(), setWorkingMessage: vi.fn(), onTerminalInput: vi.fn(() => () => {}) }, waitForIdle: vi.fn() };
      await amendCommand.handler("", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("/amend"), "error");
      expect(fakePi.sendMessage).not.toHaveBeenCalled();

      const result = await tool.execute("call-1", { type: "FIX", message: "no flow" }, undefined, vi.fn(), {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No amend flow");
    });

    it("opens the flow without running any git command", async () => {
      const ctx = { hasUI: true, ui: { notify: vi.fn(), setWorkingMessage: vi.fn(), onTerminalInput: vi.fn(() => () => {}) }, waitForIdle: vi.fn() };
      await amendCommand.handler("anything", ctx);
      expect(fakePi.exec).not.toHaveBeenCalled();
      expect(fakePi.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("aborts a pending amend flow via /stop-commit", async () => {
      seedCommit("j.txt", "seed");
      await startAmendFlow("initial critique");
      const ctx = { hasUI: true, ui: { notify: vi.fn(), setWorkingMessage: vi.fn(), onTerminalInput: vi.fn(() => () => {}) }, waitForIdle: vi.fn() };
      await stopCommand.handler("", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("stopped"), "info");

      const result = await tool.execute("call-1", { type: "FIX", message: "should fail" }, undefined, vi.fn(), {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No amend flow");
    });
  });

  describe("git_commit tool integration (real git)", () => {
    let tempDir: string;
    let tool: any;
    let fakePi: any;
    let commitCommand: any;
    let terminalInputHandler: ((data: string) => unknown) | undefined;

    const runGit = (args: string[]) => {
      const result = spawnSync("git", args, { cwd: tempDir, encoding: "utf-8" });
      return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    };

    const startCommitFlow = async () => {
      const ctx = { hasUI: true, ui: { notify: vi.fn(), setWorkingMessage: vi.fn(), onTerminalInput: vi.fn((handler: (data: string) => unknown) => { terminalInputHandler = handler; return () => { terminalInputHandler = undefined; }; }) }, waitForIdle: vi.fn() };
      await commitCommand.handler("", ctx);
    };

    beforeEach(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-git-commit-"));
      runGit(["init", "-b", "main"]);
      runGit(["config", "user.name", "Test User"]);
      runGit(["config", "user.email", "test@example.com"]);
      runGit(["config", "commit.gpgsign", "false"]);

      vi.resetModules();
      const mod = await import("../index.js");
      fakePi = {
        on: vi.fn(),
        registerTool: vi.fn((registered: any) => {
          if (registered.name === "git_commit") tool = registered;
        }),
        registerMessageRenderer: vi.fn(),
        registerCommand: vi.fn((name: string, cmd: any) => {
          if (name === "commit") commitCommand = cmd;
        }),
        getActiveTools: vi.fn(() => []),
        setActiveTools: vi.fn(),
        sendUserMessage: vi.fn(),
        sendMessage: vi.fn(),
        exec: (command: string, args: string[], opts?: { cwd?: string }) => {
          const result = spawnSync(command, args, { cwd: opts?.cwd ?? tempDir, encoding: "utf-8" });
          return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
        },
      };
      mod.default(fakePi);
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("stages all changes and commits with the TYPE: prefix", async () => {
      fs.writeFileSync(path.join(tempDir, "a.txt"), "hello");
      await startCommitFlow();
      const result = await tool.execute("call-1", { type: "FIX", message: "add a.txt" }, undefined, vi.fn(), {});
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("FIX: add a.txt");
      expect(runGit(["log", "-1", "--format=%s"]).stdout.trim()).toBe("FIX: add a.txt");
      expect(runGit(["status", "--porcelain"]).stdout.trim()).toBe("");
    });

    it("reports a failed commit as a tool error", async () => {
      fs.writeFileSync(path.join(tempDir, "b.txt"), "hello");
      await startCommitFlow();
      runGit(["add", "."]);
      runGit(["commit", "-m", "seed"]);
      const result = await tool.execute("call-1", { type: "IMPROVE", message: "no changes" }, undefined, vi.fn(), {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Commit failed");
    });

    it("rejects an empty commit message", async () => {
      fs.writeFileSync(path.join(tempDir, "empty.txt"), "hello");
      await startCommitFlow();
      const result = await tool.execute("call-1", { type: "FIX", message: "   " }, undefined, vi.fn(), {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("empty");
    });

    it("closes the flow after a successful commit so a retry fails", async () => {
      fs.writeFileSync(path.join(tempDir, "c.txt"), "hello");
      await startCommitFlow();
      const result = await tool.execute("call-1", { type: "FIX", message: "add c.txt" }, undefined, vi.fn(), {});
      expect(result.isError).toBeFalsy();
      const again = await tool.execute("call-1", { type: "FIX", message: "add c.txt again" }, undefined, vi.fn(), {});
      expect(again.isError).toBe(true);
      expect(again.content[0].text).toContain("No commit flow");
    });

    it("steers the model with a minimal completion message after a successful commit", async () => {
      fs.writeFileSync(path.join(tempDir, "e.txt"), "hello");
      await startCommitFlow();
      const result = await tool.execute("call-1", { type: "FIX", message: "add e.txt" }, undefined, vi.fn(), {});
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).not.toContain("deactivated");
      expect(fakePi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ display: false, content: expect.stringMatching(/flow is complete/) }),
        expect.objectContaining({ deliverAs: "steer" }),
      );
    });

    it("keeps the flow active after a failed commit", async () => {
      fs.writeFileSync(path.join(tempDir, "d.txt"), "hello");
      await startCommitFlow();
      runGit(["add", "."]);
      runGit(["commit", "-m", "seed"]);
      const result = await tool.execute("call-1", { type: "IMPROVE", message: "no changes" }, undefined, vi.fn(), {});
      expect(result.isError).toBe(true);
      expect(fakePi.setActiveTools).not.toHaveBeenCalled();
    });

    it("keeps the flow active after an empty-message rejection", async () => {
      fs.writeFileSync(path.join(tempDir, "d2.txt"), "hello");
      await startCommitFlow();
      const result = await tool.execute("call-1", { type: "FIX", message: "   " }, undefined, vi.fn(), {});
      expect(result.isError).toBe(true);
      expect(fakePi.setActiveTools).not.toHaveBeenCalled();
    });

    it("strips a leading type prefix from the message to avoid duplication", async () => {
      fs.writeFileSync(path.join(tempDir, "f.txt"), "hello");
      await startCommitFlow();
      const result = await tool.execute("call-1", { type: "FIX", message: "Fix: correct the off-by-one" }, undefined, vi.fn(), {});
      expect(result.isError).toBeFalsy();
      expect(runGit(["log", "-1", "--format=%s"]).stdout.trim()).toBe("FIX: correct the off-by-one");
    });

    it("strips repeated and differently-cased type prefixes", async () => {
      fs.writeFileSync(path.join(tempDir, "g.txt"), "hello");
      await startCommitFlow();
      const result = await tool.execute("call-1", { type: "FIX", message: "fix: FIX: Fix: correct it" }, undefined, vi.fn(), {});
      expect(result.isError).toBeFalsy();
      expect(runGit(["log", "-1", "--format=%s"]).stdout.trim()).toBe("FIX: correct it");
    });

    it("strips the type prefix for every commit type", async () => {
      fs.writeFileSync(path.join(tempDir, "h1.txt"), "hello");
      await startCommitFlow();
      let result = await tool.execute("call-1", { type: "IMPROVE", message: "Improve: parser speed" }, undefined, vi.fn(), {});
      expect(result.isError).toBeFalsy();
      expect(runGit(["log", "-1", "--format=%s"]).stdout.trim()).toBe("IMPROVE: parser speed");
      fs.writeFileSync(path.join(tempDir, "h2.txt"), "hello");
      await startCommitFlow();
      result = await tool.execute("call-1", { type: "NEW", message: "New: add retry loop" }, undefined, vi.fn(), {});
      expect(result.isError).toBeFalsy();
      expect(runGit(["log", "-1", "--format=%s"]).stdout.trim()).toBe("NEW: add retry loop");
    });

    it("strips the type word even without a separator", async () => {
      fs.writeFileSync(path.join(tempDir, "i.txt"), "hello");
      await startCommitFlow();
      const result = await tool.execute("call-1", { type: "FIX", message: "Fix the fixtures loader" }, undefined, vi.fn(), {});
      expect(result.isError).toBeFalsy();
      expect(runGit(["log", "-1", "--format=%s"]).stdout.trim()).toBe("FIX: the fixtures loader");
    });

    it("strips the type word with dash separators", async () => {
      fs.writeFileSync(path.join(tempDir, "j.txt"), "hello");
      await startCommitFlow();
      const result = await tool.execute("call-1", { type: "FIX", message: "FIX — harden the retry loop" }, undefined, vi.fn(), {});
      expect(result.isError).toBeFalsy();
      expect(runGit(["log", "-1", "--format=%s"]).stdout.trim()).toBe("FIX: harden the retry loop");
    });

    it("does not tear the type word out of longer words", async () => {
      fs.writeFileSync(path.join(tempDir, "k.txt"), "hello");
      await startCommitFlow();
      const result = await tool.execute("call-1", { type: "FIX", message: "fixes the load order" }, undefined, vi.fn(), {});
      expect(result.isError).toBeFalsy();
      expect(runGit(["log", "-1", "--format=%s"]).stdout.trim()).toBe("FIX: fixes the load order");
    });

    it("rejects a message that is only a type prefix", async () => {
      fs.writeFileSync(path.join(tempDir, "prefix.txt"), "hello");
      await startCommitFlow();
      const result = await tool.execute("call-1", { type: "FIX", message: "Fix:" }, undefined, vi.fn(), {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("empty");
    });

    it("refuses to commit after escape closed the flow", async () => {
      fs.writeFileSync(path.join(tempDir, "escape.txt"), "hello");
      await startCommitFlow();
      terminalInputHandler!("\x1b");
      expect(fakePi.sendMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ customType: "git-commit-stopped" }),
        expect.objectContaining({ deliverAs: "steer" }),
      );
      const result = await tool.execute("call-1", { type: "FIX", message: "should fail" }, undefined, vi.fn(), {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No commit flow");
    });
  });
});
