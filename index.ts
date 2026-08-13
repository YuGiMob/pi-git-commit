import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const COMMIT_TYPES = ["FIX", "IMPROVE", "NEW"] as const;

export default function (pi: ExtensionAPI) {
  let gitBlocked = true;

  const PREFIXES = new Set(["sudo", "env", "command", "nohup", "nice", "time", "exec", "builtin", "doas", "eval", "timeout", "runuser", "pkexec"]);
  const CONTROL_KEYWORDS = new Set(["if", "then", "else", "elif", "while", "until", "do", "case", "select"]);

  const GIT_META_OPTS = new Set(["--help", "-h", "--version"]);
  const GIT_OPTS_BARE = new Set(["--bare", "-p", "--paginate", "--no-pager", "--no-replace-objects", "--literal-pathspecs", "--glob-pathspecs", "--noglob-pathspecs", "--icase-pathspecs", "--no-optional-locks", "--html-path", "--man-path", "--info-path"]);
  const GIT_OPTS_WITH_ARG = new Set(["-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--shallow-file", "--template", "--upload-pack"]);

  const blockAll = () => true;
  const hasAny = (args: string[], values: string[]) => values.some((value) => args.includes(value));
  const allowOnly = (values: string[]) => (args: string[]) => !hasAny(args, values);
  const hasShortFlag = (args: string[], flags: string) => args.some((arg) => arg.startsWith("-") && !arg.startsWith("--") && arg.length > 1 && [...arg.slice(1)].some((flag) => flags.includes(flag)));

  const GIT_RULES: Record<string, (args: string[]) => boolean> = {
    add: blockAll,
    stage: blockAll,
    commit: blockAll,
    push: blockAll,
    pull: blockAll,
    merge: blockAll,
    rebase: blockAll,
    reset: blockAll,
    clean: blockAll,
    rm: blockAll,
    restore: blockAll,
    switch: blockAll,
    "cherry-pick": blockAll,
    revert: blockAll,
    mv: blockAll,
    init: blockAll,
    clone: blockAll,
    am: blockAll,
    replace: blockAll,
    "update-ref": blockAll,
    "symbolic-ref": blockAll,
    "update-index": blockAll,
    "read-tree": blockAll,
    "checkout-index": blockAll,
    "merge-file": blockAll,
    "prune-packed": blockAll,
    gc: blockAll,
    maintenance: blockAll,
    "filter-branch": blockAll,
    "filter-repo": blockAll,
    "fast-import": blockAll,
    prune: blockAll,
    repack: blockAll,
    "pack-refs": blockAll,
    mergetool: blockAll,
    bisect: blockAll,
    subtree: blockAll,
    fetch: (args) => hasAny(args, ["--prune", "-p", "-P", "--prune-tags"]),
    config: (args) => {
      if (hasAny(args, ["--add", "--unset", "--unset-all", "--replace-all", "--remove-section", "--rename-section", "--edit", "-e"])) return true;
      return !hasAny(args, ["--list", "-l", "--get", "--get-all", "--get-regexp", "--show-origin", "--show-scope"]);
    },
    remote: (args) => !(args.length === 0 || args.includes("-v") || hasAny(args, ["show", "get-url"])),
    apply: allowOnly(["--check", "--stat"]),
    notes: allowOnly(["list", "show"]),
    lfs: allowOnly(["ls-files", "status"]),
    "sparse-checkout": allowOnly(["list"]),
    stash: allowOnly(["list", "show"]),
    submodule: allowOnly(["status", "init", "summary"]),
    worktree: allowOnly(["list"]),
    reflog: (args) => !(args.length === 0 || hasAny(args, ["show"])),
    branch: (args) => {
      if (args.includes("--")) return true;
      if (hasAny(args, ["--delete", "--move", "--copy", "--force", "--track", "--prune", "--unset-upstream", "--edit-description"]) || args.some((arg) => arg.startsWith("--set-upstream-to"))) return true;
      if (hasShortFlag(args, "dmufcCDMt")) return true;
      if (!args.some((arg) => !arg.startsWith("-"))) return false;
      return !(hasAny(args, ["--list", "--merged", "--no-merged", "--contains", "--no-contains", "--points-at", "--show-current"]) || hasShortFlag(args, "lar"));
    },
    tag: (args) => {
      if (args.length === 0) return false;
      const first = args[0];
      if (first === "-l" || first === "--list" || first.startsWith("-n")) return false;
      return !["--contains", "--merged", "--no-merged", "--points-at", "--sort", "--format", "--column", "--no-column", "--color", "--ignore-case", "--verbose", "-v"].some((flag) => first.startsWith(flag));
    },
    checkout: (args) => {
      if (args[0] !== "--") return true;
      const path = args[1];
      if (path === undefined) return true;
      if (args.length > 2) return true;
      return path === "." || path === ".." || path.endsWith("/");
    },
  };

  const maskHeredocBodies = (command: string): string => {
    let masked = "";
    let cursor = 0;
    const heredocRe = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/g;
    let match: RegExpExecArray | null;
    while ((match = heredocRe.exec(command)) !== null) {
      const current = match;
      if (current.index < cursor) continue;
      const tail = command.slice(current.index + current[0].length);
      const lines = tail.split("\n");
      const end = lines.findIndex((line) => line.trim() === current[1]);
      if (end === -1) continue;
      const body = lines.slice(0, end + 1);
      masked += command.slice(cursor, current.index) + current[0] + body.map((line) => " ".repeat(line.length)).join("\n");
      cursor = current.index + current[0].length + body.join("\n").length;
    }
    return masked + command.slice(cursor);
  };

  const stripSurrounding = (segment: string): string => segment.replace(/^[\s'"(){}!]+/, "").replace(/[\s'"()!}]+$/, "");
  const stripQuotes = (value: string): string => value.trim().replace(/^['"]/, "").replace(/['"]$/, "");

  const stripEnvAssignments = (segment: string): string => {
    let rest = segment;
    for (;;) {
      const match = rest.match(/^[A-Za-z_][A-Za-z0-9_]*=(?:(?:[^'"\s])|(?:'[^']*')|(?:"[^"]*"))*(?:\s|$)/);
      if (!match) break;
      rest = rest.slice(match[0].length).trimStart();
      if (!rest) break;
    }
    return rest;
  };

  const stripPrefixes = (segment: string): string => {
    let rest = segment;
    for (;;) {
      rest = stripEnvAssignments(rest);
      if (!rest) break;
      const match = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)\b(?:\s|$)/);
      if (!match) break;
      const word = match[1].toLowerCase();
      if (!PREFIXES.has(word) && !CONTROL_KEYWORDS.has(word)) break;
      rest = rest.slice(match[0].length).trimStart();
      if (!rest) break;
      rest = rest.replace(/^\d+(?:\.\d+)?[a-z]*\s+/, "");
      while (rest.startsWith("-")) {
        const flag = rest.match(/^(\S+)(?:\s|$)/);
        if (!flag) break;
        rest = rest.slice(flag[0].length).trimStart();
        if (!rest) break;
        const next = rest.match(/^([^\s-][^\s]*)(?:\s|$)/);
        if (!next) break;
        const nextWord = next[1].toLowerCase();
        if (nextWord === "git" || nextWord === "git.exe" || PREFIXES.has(nextWord) || CONTROL_KEYWORDS.has(nextWord)) break;
        rest = rest.slice(next[0].length).trimStart();
      }
    }
    return rest;
  };

  const classifyGitCommand = (rest: string): boolean => {
    const tokens = rest.toLowerCase().split(/\s+/).filter(Boolean);
    let subcommand: string | undefined;
    let subcommandIndex = -1;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (GIT_META_OPTS.has(token)) return false;
      if (GIT_OPTS_BARE.has(token)) continue;
      if (GIT_OPTS_WITH_ARG.has(token)) {
        i++;
        continue;
      }
      if (token.startsWith("-")) continue;
      subcommand = token;
      subcommandIndex = i;
      break;
    }
    if (subcommand === undefined) return false;
    const rule = GIT_RULES[subcommand];
    if (!rule) return false;
    return rule(tokens.slice(subcommandIndex + 1));
  };

  const containsBlockedGitCommand = (command: string, depth = 0): boolean => {
    if (depth > 4) return true;
    const masked = maskHeredocBodies(command);
    return masked.split(/\n|;|\|\||&&|\||&|`|\$\(|<\(|>\(/).some((segment) => {
      let rest = stripSurrounding(segment.trim());
      if (!rest) return false;
      rest = stripPrefixes(rest);
      rest = stripSurrounding(rest);
      if (!rest) return false;
      const shell = rest.match(/^(sh|bash|zsh|dash|ksh|ash|fish)\s+-[a-zA-Z]*c[a-zA-Z]*\s+(.+)$/i);
      if (shell) return containsBlockedGitCommand(stripQuotes(shell[2]), depth + 1);
      const su = rest.match(/^su\b(.*?)\s+-c\s+(.+)$/i);
      if (su) return containsBlockedGitCommand(stripQuotes(su[2]), depth + 1);
      const pwsh = rest.match(/^(pwsh|powershell)\s+(-Command|-c)\s+(.+)$/i);
      if (pwsh) return containsBlockedGitCommand(stripQuotes(pwsh[3]), depth + 1);
      const git = rest.match(/^(?:.*\/)?git(\.exe)?\b(.*)$/i);
      if (!git) return false;
      return classifyGitCommand(git[2]);
    });
  };

  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return undefined;
    const command = event.input.command;
    if (typeof command !== "string") return undefined;
    const trimmed = command.trim();
    if (gitBlocked && containsBlockedGitCommand(trimmed)) {
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
        minLength: 1,
        description: "Commit message (imperative mood). Multi-line allowed for detailed changes.",
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {

      const { type, message } = params;
      const trimmedMessage = message.trim();
      if (!trimmedMessage) {
        return { content: [{ type: "text", text: "Commit message must not be empty." }], details: {}, isError: true };
      }
      const fullMessage = `${type}: ${trimmedMessage}`;
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
