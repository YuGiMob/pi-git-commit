import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const COMMIT_TYPES = ["FIX", "IMPROVE", "NEW"] as const;

export default function (pi: ExtensionAPI) {
  let gitBlocked = true;

  const containsBlockedGitCommand = (command: string): boolean => {
    const alwaysBlocked = /\bgit\s+(add|commit|push|pull|merge|rebase|reset|clean|rm|restore|switch|cherry-pick|revert|mv|init|clone)\b/;
    if (alwaysBlocked.test(command)) return true;

    const readOnlyForms = [
      /\bgit\s+fetch\b/,
      /\bgit\s+stash\s+(list|show)\b/,
      /\bgit\s+remote\s*$/,
      /\bgit\s+config\s+(--list|-l|--get|--get-all|--get-regexp|--show-origin|--show-scope)\b/,
      /\bgit\s+remote\s+(-v|show|get-url)\b/,
      /\bgit\s+apply\s+--(check|stat)\b/,
      /\bgit\s+notes\s+(list|show)\b/,
      /\bgit\s+lfs\s+(ls-files|status)\b/,
      /\bgit\s+sparse-checkout\s+list\b/,
    ];
    if (readOnlyForms.some((re) => re.test(command))) return false;

    if (/\bgit\s+(config|remote|apply|am|notes|replace|update-ref|symbolic-ref|update-index|gc|maintenance|sparse-checkout|lfs)\b/.test(command)) return true;

    if (/\bgit\s+branch\b/.test(command)) {
      if (/\bgit\s+branch\s+(-d|-D|-m|-M|--delete|--move)\b/.test(command)) return true;
      return false;
    }

    if (/\bgit\s+tag\b/.test(command)) {
      if (/\bgit\s+tag\s+(-d|-a|-s|-f|--delete|--annotate|--sign|--force)\b/.test(command)) return true;
      return false;
    }

    if (/\bgit\s+checkout\s+--\s/.test(command)) return false;
    if (/\bgit\s+checkout\b/.test(command)) return true;

    if (/\bgit\s+submodule\s+(status|init|summary)\b/.test(command)) return false;
    if (/\bgit\s+submodule\b/.test(command)) return true;

    if (/\bgit\s+worktree\s+list\b/.test(command)) return false;
    if (/\bgit\s+worktree\b/.test(command)) return true;

    if (/\bgit\s+stash\b/.test(command)) return true;

    return false;
  };

  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return undefined;
    const command = (event.input.command as string).trim();
    if (gitBlocked && containsBlockedGitCommand(command)) {
      return { block: true, reason: "Mutative git commands are blocked. Use /toggle-allow-git to allow for this session." };
    }
    return undefined;
  });

  pi.registerTool({
    name: "git_commit",
    label: "Git Commit",
    description: "Stage all changes and create a commit. Only use when the user has run /commit and asked you to commit. Do not call this tool unprompted.",
    promptSnippet: "Commit staged changes (only after user runs /commit)",
    promptGuidelines: [
      "Only use git_commit when the user explicitly asks you to commit after they ran /commit",
      "Do not call git_commit on its own — wait for the user to run /commit first",
    ],
    parameters: Type.Object({
      type: Type.Union(COMMIT_TYPES.map((t) => Type.Literal(t))),
      message: Type.String({
        description: "Commit message (imperative mood). Multi-line allowed for detailed changes.",
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {

      const { type, message } = params;
      const fullMessage = `${type}: ${message}`;
      const addResult = await pi.exec("git", ["add", "."], { signal });
      if (addResult.code !== 0) {
        return { content: [{ type: "text", text: `Staging failed: ${addResult.stderr}` }], details: {}, isError: true };
      }

      const result = await pi.exec("git", ["commit", "-m", fullMessage], { signal });
      if (result.code !== 0) {
        return { content: [{ type: "text", text: `Commit failed: ${result.stderr}` }], details: {}, isError: true };
      }

      return { content: [{ type: "text", text: `✓ Committed: ${fullMessage}` }], details: {} };
    },
  });

  pi.on("session_start", () => {
    gitBlocked = true;
    const activeTools = pi.getActiveTools();
    if (!activeTools.includes("git_commit")) {
      pi.setActiveTools([...activeTools, "git_commit"]);
    }
  });

  pi.registerCommand("commit", {
    description: "Stage files and show diff for commit",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("commit requires interactive mode", "error");
        return;
      }

      try {
        await ctx.ui.setWorkingMessage("Waiting for queued messages to complete...");
        await ctx.waitForIdle();

        await ctx.ui.setWorkingMessage("Staging files...");
        const addResult = await pi.exec("git", ["add", "."]);
        if (addResult.code !== 0) {
          ctx.ui.notify(`git add failed: ${addResult.stderr}`, "error");
          return;
        }

        await ctx.ui.setWorkingMessage("Getting diff...");
        const diffResult = await pi.exec("git", ["diff", "--staged"]);
        if (diffResult.code !== 0) {
          ctx.ui.notify(`git diff failed: ${diffResult.stderr}`, "error");
          return;
        }

        if (!diffResult.stdout.trim()) {
          ctx.ui.notify("Nothing to commit (empty diff). Stage files first.", "warning");
          return;
        }

        const diff = diffResult.stdout || "(no changes staged)";

        const prompt = `DO NOT use bash for git. Use ONLY the \`git_commit\` tool.\n\nReview staged changes:\n\`\`\`diff\n${diff}\`\`\`\n\nUse \`git_commit\` tool with:\n- type: FIX (bug fix), IMPROVE (improvement), or NEW (new feature)\n- message: brief description (imperative mood). Multi-line allowed for detailed changes.`;
        pi.sendUserMessage(prompt, { deliverAs: "followUp" });
      } finally {
        ctx.ui.setWorkingMessage();
      }
    },
  });
  pi.registerCommand("toggle-allow-git", {
    description: "Toggle whether mutative git commands are allowed in bash for this session",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("toggle-allow-git requires interactive mode", "error");
        return;
      }
      gitBlocked = !gitBlocked;
      if (gitBlocked) {
        ctx.ui.notify("Mutative git commands are blocked again in bash", "info");
      } else {
        ctx.ui.notify("Mutative git commands are now allowed in bash for this session", "warning");
      }
    },
  });

}
