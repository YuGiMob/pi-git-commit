import { formatSize, keyHint, renderDiff, truncateHead, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, matchesKey, MouseRegion, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const COMMIT_TYPES = ["FIX", "IMPROVE", "NEW"] as const;
const renderCommitToolCall = (name: string) => (args: { type?: string } | undefined, theme: Theme) =>
  new Text(`${theme.fg("toolTitle", theme.bold(`${name} `))}${args?.type ? theme.fg("muted", args.type) : theme.fg("dim", "…")}`, 0, 0);
const DIFF_CUSTOM_TYPE = "git-commit-diff";
const CHECKPOINT_MARKER_PREFIX = "[pi-git-commit checkpoint #";
const CHECKPOINT_MARKER_RE = /^\[pi-git-commit checkpoint #(\d+)\]$/;
const AMEND_DIFF_CUSTOM_TYPE = "git-amend-diff";
const AMEND_CHECKPOINT_MARKER_PREFIX = "[pi-git-amend checkpoint #";
const AMEND_CHECKPOINT_MARKER_RE = /^\[pi-git-amend checkpoint #(\d+)\]$/;
const NO_AMEND_CHANGES_NOTE = "No file changes since the last commit.";
const DIFF_PREVIEW_LINES = 2000;
const DIFF_PREVIEW_BYTES = 50 * 1024;
const STAT_PREVIEW_LINES = 100;
const STAT_PREVIEW_BYTES = 8 * 1024;
const DIFF_OMITTED_NOTE = `[Diff omitted: over the ${DIFF_PREVIEW_LINES} line / ${DIFF_PREVIEW_BYTES / 1024}KB preview budget. Inspect individual files with read-only \`git diff --staged -- <path>\`.]`;

export default function (pi: ExtensionAPI) {
  let gitBlocked = true;
  let commitFlowActive = false;
  let amendFlowActive = false;
  let stopInputListener: (() => void) | undefined;
  let commitStagedOnly = false;
  const queuedCommits = new Map<number, { stagedOnly: boolean }>();
  const queuedAmends = new Map<number, { critique: string }>();
  let nextCommitId = 0;
  let nextAmendId = 0;

  const PREFIXES = new Set(["sudo", "env", "command", "nohup", "nice", "time", "exec", "builtin", "doas", "eval", "timeout", "runuser", "pkexec", "setsid", "ionice", "strace", "ltrace", "flock", "unshare", "nsenter", "setpriv", "fakeroot", "busybox", "stdbuf", "watch", "run0", "systemd-run"]);
  const CONTROL_KEYWORDS = new Set(["if", "then", "else", "elif", "while", "until", "do", "case", "select"]);

  const GIT_META_OPTS = new Set(["--help", "-h", "--version"]);
  const GIT_OPTS_BARE = new Set(["--bare", "-p", "--paginate", "--no-pager", "--no-replace-objects", "--literal-pathspecs", "--glob-pathspecs", "--noglob-pathspecs", "--icase-pathspecs", "--no-optional-locks", "--html-path", "--man-path", "--info-path"]);
  const GIT_OPTS_WITH_ARG = new Set(["-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--shallow-file", "--template", "--upload-pack"]);
  const GIT_TAG_VALUE_FLAGS = new Set(["--sort", "--format", "-v"]);
  const GIT_TAG_LIST_FORCING = new Set(["--contains", "--no-contains", "--merged", "--no-merged", "--points-at"]);

  const blockAll = () => true;
  const hasAny = (args: string[], values: string[]) => values.some((value) => args.includes(value));
  const blockUnlessAny = (values: string[]) => (args: string[]) => !hasAny(args, values);
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
    "hash-object": (args) => hasShortFlag(args, "w"),
    "commit-tree": blockAll,
    mktree: blockAll,
    "index-pack": blockAll,
    "pack-objects": blockAll,
    "unpack-objects": blockAll,
    "send-pack": blockAll,
    bundle: (args) => !hasAny(args, ["verify", "list-heads"]),
    p4: blockAll,
    svn: blockAll,
    instaweb: blockAll,
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
    remote: (args) => args.length > 0 && blockUnlessAny(["-v", "show", "get-url"])(args),
    apply: blockUnlessAny(["--check", "--stat"]),
    notes: blockUnlessAny(["list", "show"]),
    lfs: blockUnlessAny(["ls-files", "status"]),
    "sparse-checkout": blockUnlessAny(["list"]),
    stash: blockUnlessAny(["list", "show"]),
    submodule: blockUnlessAny(["status", "init", "summary"]),
    worktree: blockUnlessAny(["list"]),
    reflog: (args) => args.length > 0 && blockUnlessAny(["show"])(args),
    branch: (args) => {
      if (args.includes("--")) return true;
      if (hasAny(args, ["--delete", "--move", "--copy", "--force", "--track", "--prune", "--unset-upstream", "--edit-description"]) || args.some((arg) => arg.startsWith("--set-upstream-to"))) return true;
      if (hasShortFlag(args, "dmufcCDMt")) return true;
      if (!args.some((arg) => !arg.startsWith("-"))) return false;
      return !(hasAny(args, ["--list", "--merged", "--no-merged", "--contains", "--no-contains", "--points-at", "--show-current"]) || hasShortFlag(args, "lar"));
    },
    tag: (args) => {
      if (args.length === 0) return false;
      if (hasAny(args, ["--delete", "--annotate", "--force", "--sign", "--edit", "--cleanup"]) || hasShortFlag(args, "damfsueF")) return true;
      const first = args[0];
      if (first === "-l" || first === "--list" || first.startsWith("-n")) return false;
      const readOnlyFlags = ["--contains", "--no-contains", "--merged", "--no-merged", "--points-at", "--sort", "--format", "--column", "--no-column", "--color", "--ignore-case", "--verbose", "-i", "-v"];
      if (!readOnlyFlags.some((flag) => first.startsWith(flag))) return true;
      if ([...GIT_TAG_LIST_FORCING].some((flag) => args.some((arg) => arg === flag || arg.startsWith(`${flag}=`)))) return false;
      return args.some((arg, index) => index > 0 && !arg.startsWith("-") && !GIT_TAG_VALUE_FLAGS.has(args[index - 1]));
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
    const heredocRe = /<<-?\s*\\?['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/g;
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

  const stripDurations = (value: string): string => {
    let rest = value;
    for (;;) {
      const match = rest.match(/^\d+(?:\.\d+)?[a-z]*\s+/);
      if (!match) return rest;
      rest = rest.slice(match[0].length).trimStart();
    }
  };

  const stripPrefixes = (segment: string): string => {
    let rest = segment;
    for (;;) {
      rest = stripEnvAssignments(rest);
      if (!rest) break;
      const match = rest.match(/^([A-Za-z_][A-Za-z0-9_-]*)(?:\s|$)/);
      if (!match) break;
      const word = match[1].toLowerCase();
      if (!PREFIXES.has(word) && !CONTROL_KEYWORDS.has(word)) break;
      rest = stripDurations(rest.slice(match[0].length).trimStart());
      if (!rest) break;
      while (rest.startsWith("-")) {
        const flag = rest.match(/^(\S+)(?:\s|$)/);
        if (!flag) break;
        rest = stripDurations(rest.slice(flag[0].length).trimStart());
        if (!rest) break;
        if (rest.startsWith("-")) continue;
        const next = rest.match(/^([^\s-][^\s]*)(?:\s|$)/);
        if (!next) break;
        const nextWord = next[1].toLowerCase();
        if (nextWord === "git" || nextWord === "git.exe" || PREFIXES.has(nextWord) || CONTROL_KEYWORDS.has(nextWord)) break;
        rest = stripDurations(rest.slice(next[0].length).trimStart());
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
      if (token === "git" || token === "git.exe") continue;
      if (GIT_META_OPTS.has(token)) return false;
      if (GIT_OPTS_BARE.has(token)) continue;
      if (GIT_OPTS_WITH_ARG.has(token)) {
        const value = tokens[i + 1];
        if (value !== undefined && value.startsWith("alias.")) return true;
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
    if (event.toolName !== "bash" && event.toolName !== "powershell") return undefined;
    const command = event.input.command;
    if (typeof command !== "string") return undefined;
    const trimmed = command.trim();
    if (gitBlocked && containsBlockedGitCommand(trimmed)) {
      return { block: true, reason: "Mutative git commands are blocked. Ask the user to run /toggle-allow-git to allow them for this session." };
    }
    return undefined;
  });

  const stripLeadingCommitType = (type: string, message: string): string => {
    const typePrefixRe = new RegExp(`^${type}(?!\\p{L})\\s*[:–—\\-]?\\s*`, "iu");
    let rest = message.trim();
    let next = rest.replace(typePrefixRe, "").trim();
    while (next !== rest) {
      rest = next;
      next = rest.replace(typePrefixRe, "").trim();
    }
    return rest;
  };

  const toolError = (text: string) => ({ content: [{ type: "text" as const, text }], details: {}, isError: true });
  const execOptions = (signal: AbortSignal | undefined) => (signal === undefined ? {} : { signal });

  const capStat = (stat: string): string => {
    const capped = truncateHead(stat, { maxLines: STAT_PREVIEW_LINES, maxBytes: STAT_PREVIEW_BYTES });
    if (!capped.truncated) return stat;
    const lines = stat.trimEnd().split("\n");
    const summary = lines.length > capped.outputLines ? lines[lines.length - 1].trim() : "";
    return `${capped.content}${summary ? `\n\n${summary}` : ""}\n\n[Stat truncated: showing ${capped.outputLines} of ${capped.totalLines} lines (${formatSize(capped.totalBytes)} total).]`;
  };

  const previewDiff = (diff: string): string | undefined =>
    truncateHead(diff, { maxLines: DIFF_PREVIEW_LINES, maxBytes: DIFF_PREVIEW_BYTES }).truncated ? undefined : diff;

  const fenceFor = (text: string): string => {
    let longest = 0;
    for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
    return "`".repeat(Math.max(3, longest + 1));
  };

  const buildReview = (diffStdout: string, statStdout: string) => {
    const stat = capStat(statStdout);
    const diff = previewDiff(diffStdout);
    const diffFence = fenceFor(diff ?? "");
    const diffSection = diff === undefined ? DIFF_OMITTED_NOTE : `${diffFence}diff\n${diff}\n${diffFence}`;
    const statFence = fenceFor(stat);
    const prompt = `DO NOT use bash to stage or commit. Use ONLY the \`git_commit\` tool.\n\nReview staged changes:\n\n${statFence}\n${stat}\n${statFence}\n\n${diffSection}\n\nUse \`git_commit\` tool with:\n- type: FIX, IMPROVE, or NEW\n- message: brief description (imperative mood)`;
    const details = diff === undefined ? { stat, note: DIFF_OMITTED_NOTE } : { diff, stat };
    return { prompt, details };
  };

  const buildAmendReview = (diffStdout: string, statStdout: string, lastMessage: string, critique: string) => {
    const stat = capStat(statStdout);
    const hasChanges = diffStdout.trim().length > 0;
    const diff = hasChanges ? previewDiff(diffStdout) : undefined;
    const diffFence = fenceFor(diff ?? "");
    const changes = !hasChanges ? NO_AMEND_CHANGES_NOTE : diff === undefined ? DIFF_OMITTED_NOTE : `${diffFence}diff\n${diff}\n${diffFence}`;
    const messageFence = fenceFor(lastMessage);
    const statFence = fenceFor(stat);
    const direction = critique
      ? `User critique:\n\n${critique}`
      : hasChanges
        ? "No critique was given. The newer changes are staged and will be folded into the last commit, so write a message that describes the joint result of the original commit and the newer changes."
        : "No critique was given. Rephrase the last commit message without changing its meaning.";
    const summary = hasChanges ? "Fold the newer changes into this commit and describe the joint result" : "Rephrase this message";
    const prompt = `DO NOT use bash for git. Use ONLY the \`git_amend\` tool.\n\nThe user wants the last commit amended.\n\n${direction}\n\nCurrent last commit message:\n\n${messageFence}text\n${lastMessage}\n${messageFence}\n\nChanges since the last commit:\n\n${statFence}\n${stat}\n${statFence}\n\n${changes}\n\nChoose the right type (FIX, IMPROVE, or NEW), write the corrected message and call \`git_amend\` with it. The tool stages all changes and folds them into the last commit, and refreshes the commit timestamp to now.`;
    const details = {
      stat,
      message: lastMessage,
      ...(critique ? { critique } : { summary }),
      ...(diff === undefined ? { note: hasChanges ? DIFF_OMITTED_NOTE : NO_AMEND_CHANGES_NOTE } : { diff }),
    };
    return { prompt, details };
  };

  const messageText = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((part) => {
      const candidate = part as { type?: string; text?: string };
      return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
    }).join("");
  };

  const checkpointIdFrom = (content: unknown, pattern: RegExp): number | undefined => {
    const match = pattern.exec(messageText(content).trim());
    return match ? Number(match[1]) : undefined;
  };

  const clearStopListener = () => {
    stopInputListener?.();
    stopInputListener = undefined;
  };

  const closeFlows = () => {
    commitFlowActive = false;
    amendFlowActive = false;
    commitStagedOnly = false;
    clearStopListener();
  };

  const cancelQueuedCheckpoints = () => {
    queuedCommits.clear();
    queuedAmends.clear();
  };

  const sendFlowStopped = (stoppedBy: string) => {
    pi.sendMessage(
      { customType: "git-commit-stopped", content: `The user stopped the pending flow ${stoppedBy}. Do not attempt to commit or amend.`, display: false },
      { deliverAs: "steer" },
    );
  };

  const watchForEscape = (ctx: ExtensionContext) => {
    clearStopListener();
    stopInputListener = ctx.ui.onTerminalInput((data) => {
      if (!commitFlowActive && !amendFlowActive && queuedCommits.size === 0 && queuedAmends.size === 0) return undefined;
      if (!matchesKey(data, "escape")) return undefined;
      const flowName = amendFlowActive || queuedAmends.size > 0 ? "Amend" : "Commit";
      closeFlows();
      cancelQueuedCheckpoints();
      ctx.ui.setWorkingMessage();
      sendFlowStopped("by pressing escape");
      ctx.ui.notify(`${flowName} flow stopped.`, "info");
      return undefined;
    });
  };

  pi.registerTool({
    name: "git_commit",
    label: "Git Commit",
    description: "Stage all changes and create a commit. Only use when the user has run /commit and asked you to commit. Do not call this tool unprompted.",
    promptSnippet: "Commit staged changes (only after user runs /commit)",
    promptGuidelines: [
      "Only use git_commit when the user explicitly asks you to commit after they ran /commit",
      "Do not call git_commit on its own — wait for the user to run /commit first",
    ],
    renderCall: renderCommitToolCall("git_commit"),
    parameters: Type.Object({
      type: Type.Union(COMMIT_TYPES.map((t) => Type.Literal(t))),
      message: Type.String({
        minLength: 1,
        description: "Commit message (imperative mood). Multi-line allowed for detailed changes.",
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (!commitFlowActive) {
        return toolError("No commit flow is active. Ask the user to run /commit first.");
      }
      let committed = false;
      try {
        const { type, message } = params;
        const description = stripLeadingCommitType(type, message);
        if (!description) {
          return toolError("Commit message must not be empty.");
        }
        const fullMessage = `${type}: ${description}`;
        if (!commitStagedOnly) {
          const addResult = await pi.exec("git", ["add", "."], execOptions(signal));
          if (addResult.code !== 0) {
            return toolError(`Staging failed: ${addResult.stderr}`);
          }
        }

        const result = await pi.exec("git", ["commit", "-m", fullMessage], execOptions(signal));
        if (result.code !== 0) {
          return toolError(`Commit failed: ${result.stderr}`);
        }
        committed = true;
        pi.sendMessage(
          { customType: "git-commit-flow-complete", content: "The commit flow is complete.", display: false },
          { deliverAs: "steer" },
        );
        return { content: [{ type: "text", text: `✓ Committed: ${fullMessage}` }], details: {} };
      } finally {
        if (committed) {
          closeFlows();
        }
      }
    },
  });

  pi.registerTool({
    name: "git_amend",
    label: "Git Amend",
    description: "Stage all changes and amend the last commit with the corrected message, refreshing its timestamp to now. Only use when the user has run /amend and asked you to amend. Do not call this tool unprompted.",
    promptSnippet: "Stage all changes and amend the last commit (only after user runs /amend)",
    promptGuidelines: [
      "Only use git_amend when the user explicitly asks you to amend after they ran /amend",
      "Do not call git_amend on its own — wait for the user to run /amend first",
    ],
    renderCall: renderCommitToolCall("git_amend"),
    parameters: Type.Object({
      type: Type.Union(COMMIT_TYPES.map((t) => Type.Literal(t))),
      message: Type.String({
        minLength: 1,
        description: "Corrected commit message (imperative mood). Multi-line allowed for detailed changes.",
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (!amendFlowActive) {
        return toolError("No amend flow is active. Ask the user to run /amend first.");
      }
      let amended = false;
      try {
        const { type, message } = params;
        const description = stripLeadingCommitType(type, message);
        if (!description) {
          return toolError("Commit message must not be empty.");
        }
        const fullMessage = `${type}: ${description}`;
        const addResult = await pi.exec("git", ["add", "."], execOptions(signal));
        if (addResult.code !== 0) {
          return toolError(`Staging failed: ${addResult.stderr}`);
        }
        const result = await pi.exec("git", ["commit", "--amend", "-m", fullMessage, "--date=now"], execOptions(signal));
        if (result.code !== 0) {
          return toolError(`Amend failed: ${result.stderr}`);
        }
        amended = true;
        pi.sendMessage(
          { customType: "git-amend-flow-complete", content: "The amend flow is complete.", display: false },
          { deliverAs: "steer" },
        );
        return { content: [{ type: "text", text: `✓ Amended: ${fullMessage}` }], details: {} };
      } finally {
        if (amended) {
          closeFlows();
        }
      }
    },
  });

  pi.on("message_start", async (event, ctx) => {
    const message = event.message;
    if (message.role !== "user") return;
    const amendId = checkpointIdFrom(message.content, AMEND_CHECKPOINT_MARKER_RE);
    if (amendId !== undefined) {
      const pendingAmend = queuedAmends.get(amendId);
      if (!pendingAmend) {
        Object.assign(message, { role: "custom", customType: AMEND_DIFF_CUSTOM_TYPE, content: "A queued amend checkpoint was cancelled.", display: false });
        return;
      }
      queuedAmends.delete(amendId);

      const addResult = await pi.exec("git", ["add", "."], execOptions(ctx.signal));
      if (addResult.code !== 0) {
        ctx.ui.notify(`git add failed: ${addResult.stderr}`, "error");
        Object.assign(message, { role: "custom", customType: AMEND_DIFF_CUSTOM_TYPE, content: `Amend checkpoint skipped: git add failed. ${addResult.stderr}`, display: false });
        return;
      }

      const diffResult = await pi.exec("git", ["diff", "--staged"], execOptions(ctx.signal));
      if (diffResult.code !== 0) {
        ctx.ui.notify(`git diff failed: ${diffResult.stderr}`, "error");
        Object.assign(message, { role: "custom", customType: AMEND_DIFF_CUSTOM_TYPE, content: `Amend checkpoint skipped: git diff failed. ${diffResult.stderr}`, display: false });
        return;
      }

      const statResult = await pi.exec("git", ["diff", "--staged", "--stat"], execOptions(ctx.signal));
      const logResult = await pi.exec("git", ["log", "-1", "--format=%B"], execOptions(ctx.signal));
      if (logResult.code !== 0) {
        ctx.ui.notify(`git log failed: ${logResult.stderr}`, "error");
        Object.assign(message, { role: "custom", customType: AMEND_DIFF_CUSTOM_TYPE, content: `Amend checkpoint skipped: git log failed. ${logResult.stderr}`, display: false });
        return;
      }

      const { prompt, details } = buildAmendReview(diffResult.stdout, statResult.code === 0 ? statResult.stdout.trim() : "", logResult.stdout.trim(), pendingAmend.critique);
      amendFlowActive = true;
      watchForEscape(ctx);
      Object.assign(message, { role: "custom", customType: AMEND_DIFF_CUSTOM_TYPE, content: prompt, display: true, details });
      return;
    }

    const id = checkpointIdFrom(message.content, CHECKPOINT_MARKER_RE);
    if (id === undefined) return;
    const pending = queuedCommits.get(id);
    if (!pending) {
      Object.assign(message, { role: "custom", customType: DIFF_CUSTOM_TYPE, content: "A queued commit checkpoint was cancelled.", display: false });
      return;
    }
    queuedCommits.delete(id);

    if (!pending.stagedOnly) {
      const addResult = await pi.exec("git", ["add", "."], execOptions(ctx.signal));
      if (addResult.code !== 0) {
        ctx.ui.notify(`git add failed: ${addResult.stderr}`, "error");
        Object.assign(message, { role: "custom", customType: DIFF_CUSTOM_TYPE, content: `Commit checkpoint skipped: git add failed. ${addResult.stderr}`, display: false });
        return;
      }
    }

    const diffResult = await pi.exec("git", ["diff", "--staged"], execOptions(ctx.signal));
    if (diffResult.code !== 0) {
      ctx.ui.notify(`git diff failed: ${diffResult.stderr}`, "error");
      Object.assign(message, { role: "custom", customType: DIFF_CUSTOM_TYPE, content: `Commit checkpoint skipped: git diff failed. ${diffResult.stderr}`, display: false });
      return;
    }
    if (!diffResult.stdout.trim()) {
      ctx.ui.notify("Nothing to commit (empty diff). Stage files first.", "warning");
      Object.assign(message, { role: "custom", customType: DIFF_CUSTOM_TYPE, content: "Commit checkpoint skipped: nothing staged.", display: false });
      return;
    }

    const statResult = await pi.exec("git", ["diff", "--staged", "--stat"], execOptions(ctx.signal));
    const { prompt, details } = buildReview(diffResult.stdout, statResult.code === 0 ? statResult.stdout.trim() : "");
    commitFlowActive = true;
    commitStagedOnly = pending.stagedOnly;
    watchForEscape(ctx);
    Object.assign(message, { role: "custom", customType: DIFF_CUSTOM_TYPE, content: prompt, display: true, details });
  });

  pi.on("agent_before_settle", () => {
    if (queuedCommits.size > 0 || queuedAmends.size > 0) cancelQueuedCheckpoints();
  });

  pi.on("session_start", () => {
    gitBlocked = true;
    closeFlows();
    cancelQueuedCheckpoints();
  });

  type ReviewDetails = { diff?: string; stat?: string; note?: string; message?: string; critique?: string; summary?: string };

  const registerReviewRenderer = (customType: string, title: string, head: (details: ReviewDetails | undefined, theme: Theme) => string[]) => {
    pi.registerMessageRenderer(customType, (message, { expanded, outputPad }, theme) => {
      const details = message.details as ReviewDetails | undefined;
      const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
      let clickExpanded = expanded;
      const populate = () => {
        box.clear();
        box.addChild(new Text(theme.fg("accent", title), 0, 0));
        for (const line of head(details, theme)) {
          box.addChild(new Text(line, 0, 0));
        }
        if (clickExpanded) {
          if (details?.diff) {
            box.addChild(new Text(renderDiff(details.diff), 0, 0));
          } else {
            if (details?.stat) {
              box.addChild(new Text(details.stat, 0, 0));
            }
            if (details?.note) {
              box.addChild(new Text(theme.fg("dim", details.note), 0, 0));
            }
          }
        } else {
          if (details?.stat) {
            box.addChild(new Text(details.stat, 0, 0));
          }
          box.addChild(new Text(theme.fg("dim", `(${keyHint("app.tools.expand", "to expand")})`), 0, 0));
        }
      };
      populate();
      return new MouseRegion(box, (event) => {
        if (event.type !== "click" || event.button !== "left") return undefined;
        clickExpanded = !clickExpanded;
        populate();
        return { handled: true };
      });
    });
  };

  registerReviewRenderer(DIFF_CUSTOM_TYPE, "Staged changes", () => []);

  registerReviewRenderer(AMEND_DIFF_CUSTOM_TYPE, "Amend review", (details, theme) => [
    ...(details?.message ? [theme.fg("muted", `Current message: ${details.message}`)] : []),
    ...(details?.critique ? [theme.fg("muted", `Critique: ${details.critique}`)] : []),
    ...(!details?.critique && details?.summary ? [theme.fg("muted", details.summary)] : []),
  ]);

  pi.registerCommand("commit", {
    description: "Stage files and show a diff for the agent to commit (--staged commits only the index)",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("commit requires interactive mode", "error");
        return;
      }
      const request = args.trim().split(/\s+/).filter(Boolean);
      const stagedOnly = request.includes("--staged");
      const unsupported = request.filter((arg) => arg !== "--staged");
      if (unsupported.length > 0) {
        ctx.ui.notify(`Unsupported argument: ${unsupported[0]}. Usage: /commit [--staged]`, "error");
        return;
      }
      if (ctx.signal !== undefined) {
        if (amendFlowActive || queuedAmends.size > 0) {
          ctx.ui.notify("An amend flow is already in progress. Run /stop-commit first.", "warning");
          return;
        }
        const id = nextCommitId;
        nextCommitId += 1;
        queuedCommits.set(id, { stagedOnly });
        pi.sendUserMessage(`${CHECKPOINT_MARKER_PREFIX}${id}]`, { deliverAs: "followUp" });
        watchForEscape(ctx);
        ctx.ui.notify(`Commit checkpoint queued (${queuedCommits.size} waiting). It runs when the queued work ahead of it finishes.`, "info");
        return;
      }
      if (commitFlowActive || amendFlowActive || queuedAmends.size > 0) {
        ctx.ui.notify("A commit or amend flow is already in progress. Run /stop-commit first.", "warning");
        return;
      }
      commitFlowActive = true;
      commitStagedOnly = stagedOnly;
      watchForEscape(ctx);

      const execGit = async (label: string, args: string[]) => {
        const result = await pi.exec("git", args);
        if (result.code !== 0) {
          ctx.ui.notify(`${label} failed: ${result.stderr}`, "error");
          closeFlows();
          return undefined;
        }
        return result;
      };

      try {
        await ctx.ui.setWorkingMessage("Waiting for queued messages to complete...");
        await ctx.waitForIdle();
        if (!commitFlowActive) return;

        if (!stagedOnly) {
          await ctx.ui.setWorkingMessage("Staging files...");
          const addResult = await execGit("git add", ["add", "."]);
          if (!addResult || !commitFlowActive) return;
        }

        await ctx.ui.setWorkingMessage("Getting diff...");
        const diffResult = await execGit("git diff", ["diff", "--staged"]);
        if (!diffResult || !commitFlowActive) return;
        if (!diffResult.stdout.trim()) {
          ctx.ui.notify("Nothing to commit (empty diff). Stage files first.", "warning");
          closeFlows();
          return;
        }

        const statResult = await pi.exec("git", ["diff", "--staged", "--stat"]);
        if (!commitFlowActive) return;
        const { prompt, details } = buildReview(diffResult.stdout, statResult.code === 0 ? statResult.stdout.trim() : "");
        if (!commitFlowActive) return;
        pi.sendMessage(
          { customType: DIFF_CUSTOM_TYPE, content: prompt, display: true, details },
          { deliverAs: "followUp", triggerTurn: true },
        );
      } finally {
        ctx.ui.setWorkingMessage();
      }
    },
  });

  pi.registerCommand("stop-commit", {
    description: "Stop the pending commit or amend flow started by /commit or /amend",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("stop-commit requires interactive mode", "error");
        return;
      }
      const flowWasActive = commitFlowActive || amendFlowActive || queuedCommits.size > 0 || queuedAmends.size > 0;
      closeFlows();
      cancelQueuedCheckpoints();
      if (flowWasActive) {
        ctx.ui.setWorkingMessage();
        sendFlowStopped("with /stop-commit");
        ctx.ui.notify("Flow stopped.", "info");
      } else {
        ctx.ui.notify("No commit flow in progress.", "info");
      }
    },
  });

  pi.registerCommand("amend", {
    description: "Review the last commit and send an optional critique to the agent for git_amend (stages all changes and refreshes the commit timestamp)",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("amend requires interactive mode", "error");
        return;
      }
      const critique = args.trim();
      if (ctx.signal !== undefined) {
        if (commitFlowActive || queuedCommits.size > 0) {
          ctx.ui.notify("A commit flow is already in progress. Run /stop-commit first.", "warning");
          return;
        }
        const id = nextAmendId;
        nextAmendId += 1;
        queuedAmends.set(id, { critique });
        pi.sendUserMessage(`${AMEND_CHECKPOINT_MARKER_PREFIX}${id}]`, { deliverAs: "followUp" });
        watchForEscape(ctx);
        ctx.ui.notify(`Amend checkpoint queued (${queuedAmends.size} waiting). It runs when the queued work ahead of it finishes.`, "info");
        return;
      }
      if (commitFlowActive || amendFlowActive || queuedCommits.size > 0 || queuedAmends.size > 0) {
        ctx.ui.notify("A commit or amend flow is already in progress. Run /stop-commit first.", "warning");
        return;
      }
      amendFlowActive = true;
      watchForEscape(ctx);

      const execGit = async (label: string, args: string[]) => {
        const result = await pi.exec("git", args);
        if (result.code !== 0) {
          ctx.ui.notify(`${label} failed: ${result.stderr}`, "error");
          closeFlows();
          return undefined;
        }
        return result;
      };

      try {
        await ctx.ui.setWorkingMessage("Waiting for queued messages to complete...");
        await ctx.waitForIdle();
        if (!amendFlowActive) return;

        await ctx.ui.setWorkingMessage("Staging files...");
        const addResult = await execGit("git add", ["add", "."]);
        if (!addResult || !amendFlowActive) return;

        await ctx.ui.setWorkingMessage("Getting diff...");
        const diffResult = await execGit("git diff", ["diff", "--staged"]);
        if (!diffResult || !amendFlowActive) return;

        const statResult = await pi.exec("git", ["diff", "--staged", "--stat"]);
        if (!amendFlowActive) return;
        const logResult = await execGit("git log", ["log", "-1", "--format=%B"]);
        if (!logResult || !amendFlowActive) return;

        const { prompt, details } = buildAmendReview(diffResult.stdout, statResult.code === 0 ? statResult.stdout.trim() : "", logResult.stdout.trim(), critique);
        pi.sendMessage(
          { customType: AMEND_DIFF_CUSTOM_TYPE, content: prompt, display: true, details },
          { deliverAs: "followUp", triggerTurn: true },
        );
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
