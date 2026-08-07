import { describe, expect, it, vi, beforeEach } from "vitest";

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

    it("blocks commands mentioning git commands even in strings", async () => {
      expect(await isBlocked("echo 'git add is dangerous'")).toBe(true);
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
});
