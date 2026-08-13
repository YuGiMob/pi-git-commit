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
  let capturedTool: any;
  let capturedCommands: any[];
  let toolCallHandler: ((event: any) => Promise<any>) | undefined;
  let sessionStartHandler: (() => void) | undefined;

  async function isBlocked(command: string): Promise<boolean> {
    if (!toolCallHandler) return false;
    const result = await toolCallHandler({ toolName: "bash", input: { command } });
    return result?.block === true;
  }

  beforeEach(async () => {
    capturedCommands = [];
    toolCallHandler = undefined;
    sessionStartHandler = undefined;
    pi = {
      on: vi.fn((event: string, handler: any) => {
        if (event === "tool_call") toolCallHandler = handler;
        if (event === "session_start") sessionStartHandler = handler;
      }),
      registerTool: vi.fn((tool: any) => {
        capturedTool = tool;
      }),
      registerCommand: vi.fn((name: string, cmd: any) => {
        capturedCommands.push({ name, cmd });
      }),
      getActiveTools: vi.fn(() => ["git_commit"]),
      setActiveTools: vi.fn(),
      sendUserMessage: vi.fn(),
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
      expect(capturedTool).toBeDefined();
      expect(capturedTool.name).toBe("git_commit");
    });

    it("has FIX, IMPROVE, NEW as type options", () => {
      expect(capturedTool.parameters.type).toBeDefined();
    });

    it("has a message parameter", () => {
      expect(capturedTool.parameters.message).toBeDefined();
      expect(capturedTool.parameters.message.minLength).toBe(1);
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

  describe("session_start handler", () => {
    it("ensures git_commit tool is active", () => {
      pi.getActiveTools = vi.fn(() => []);
      sessionStartHandler!();
      expect(pi.setActiveTools).toHaveBeenCalled();
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
        },
        waitForIdle: vi.fn(),
      };
    }

    it("sends the follow-up with the staged diff and restores the default working message", async () => {
      pi.exec = vi.fn().mockResolvedValue({ code: 0, stdout: "diff --git a/x b/x", stderr: "" });
      const ctx = createCtx();

      await commitCommand()!.cmd.handler("", ctx);

      expect(pi.sendUserMessage).toHaveBeenCalledWith(
        expect.stringContaining("diff --git a/x b/x"),
        { deliverAs: "followUp" },
      );
      expect(ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith();
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

  describe("git_commit tool integration (real git)", () => {
    let tempDir: string;
    let tool: any;

    const runGit = (args: string[]) => {
      const result = spawnSync("git", args, { cwd: tempDir, encoding: "utf-8" });
      return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    };

    beforeEach(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-git-commit-"));
      runGit(["init", "-b", "main"]);
      runGit(["config", "user.name", "Test User"]);
      runGit(["config", "user.email", "test@example.com"]);
      runGit(["config", "commit.gpgsign", "false"]);

      vi.resetModules();
      const mod = await import("../index.js");
      const fakePi: any = {
        on: vi.fn(),
        registerTool: vi.fn((registered: any) => {
          tool = registered;
        }),
        registerCommand: vi.fn(),
        getActiveTools: vi.fn(() => []),
        setActiveTools: vi.fn(),
        sendUserMessage: vi.fn(),
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
      const result = await tool.execute("call-1", { type: "FIX", message: "add a.txt" }, undefined, vi.fn(), {});
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("FIX: add a.txt");
      expect(runGit(["log", "-1", "--format=%s"]).stdout.trim()).toBe("FIX: add a.txt");
      expect(runGit(["status", "--porcelain"]).stdout.trim()).toBe("");
    });

    it("reports a failed commit as a tool error", async () => {
      fs.writeFileSync(path.join(tempDir, "b.txt"), "hello");
      runGit(["add", "."]);
      runGit(["commit", "-m", "seed"]);
      const result = await tool.execute("call-1", { type: "IMPROVE", message: "no changes" }, undefined, vi.fn(), {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Commit failed");
    });

    it("rejects an empty commit message", async () => {
      const result = await tool.execute("call-1", { type: "FIX", message: "   " }, undefined, vi.fn(), {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("empty");
    });
  });
});
