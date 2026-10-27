/** Display-only tool rendering: Codex activity flow by default; /toolview selects or cycles modes. */
import { homedir } from "node:os";
import { CodexView, type Action, type RenderContext as ToolRenderContext } from "./codex-view.ts";
import { imageFallbackText, importantResultNotice, resultWarning } from "./result-utils.ts";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import {
  Text,
  sliceByColumn,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";

type Args = Record<string, unknown>;
type Appearance = "codex" | "compact";
type ViewMode = Appearance | "full";
interface GlanceState {
  summary: string;
  nativeState: Record<string, unknown>;
  nativeCall?: Component;
  nativeResult?: Component;
  callPartial?: boolean;
  interactive?: boolean;
}

const empty: Component = { render: () => [], invalidate() {} };
const labels: Record<string, string> = {
  read: "Read", write: "Write", edit: "Edit", bash: "Run Bash", powershell: "Run PowerShell",
  ls: "List", find: "Find", grep: "Search",
  read_symbol: "Read symbol", read_enclosing: "Read code", module_report: "Inspect module",
  project_report: "Inspect project", symbol_search: "Find symbol", lsp_navigation: "Navigate code",
  lens_diagnostics: "Check diagnostics", ast_grep_search: "Search code", ast_grep_replace: "Replace code",
  web_enable: "Enable web tools", web_search: "Search web", fetch_content: "Fetch",
  get_search_content: "Read web result", source_check: "Check sources", tool_search: "Find tools",
  pi_lens_activate_tools: "Enable code tools", effective_config: "Inspect config",
  get_goal: "Read goal", subagent: "Subagent",
};

/** Never let newlines, terminal controls, or unbounded arguments inflate a summary. */
function oneLine(value: unknown, limit = 4096): string {
  if (typeof value !== "string") return "";
  return stripTerminalSequences(value.slice(0, limit))
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ").trim();
}

function record(value: unknown): Args {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Args : {};
}

function shortPath(value: unknown, cwd: string): string {
  const path = oneLine(value).replace(/\\/g, "/");
  for (const [root, prefix] of [[cwd, ""], [homedir(), "~/"]]) {
    const base = root.replace(/\\/g, "/").replace(/\/$/, "");
    const fold = (s: string) => process.platform === "win32" ? s.toLowerCase() : s;
    if (fold(path) === fold(base)) return prefix || ".";
    if (fold(path).startsWith(`${fold(base)}/`)) return prefix + path.slice(base.length + 1);
  }
  return path;
}

function list(value: unknown, format: (s: unknown) => string = oneLine): string {
  if (!Array.isArray(value)) return "";
  const items = value.slice(0, 2).map((item) => format(item)).filter(Boolean);
  return items.join(", ") + (value.length > 2 ? ` (+${value.length - 2})` : "");
}

function urlLabel(value: unknown): string {
  const text = oneLine(value);
  try {
    const url = new URL(text);
    return url.hostname + url.pathname; // No credentials, query tokens, or fragments in the headline.
  } catch {
    return text;
  }
}

function describe(name: string, args: Args, cwd: string): Action {
  const label = labels[name] ?? oneLine(name).replace(/^mcp__/, "").replace(/__/g, "/");
  const path = shortPath(args.path ?? args.file_path ?? args.filePath ?? args.file, cwd);
  if (name === "bash" || name === "powershell") {
    return { label, target: oneLine(args.command) };
  }
  if (name === "fetch_content") {
    return { label, target: urlLabel(args.url) || list(args.urls, urlLabel) };
  }
  if (name === "get_goal") {
    return { label, target: [oneLine(args.section) || "summary", oneLine(args.task_id)].filter(Boolean).join(" · ") };
  }
  if (name === "get_search_content") {
    const parts = [oneLine(args.responseId, 120), oneLine(args.query), urlLabel(args.url)].filter(Boolean);
    for (const [key, title] of [["queryIndex", "query"], ["urlIndex", "url"]]) {
      const index = args[key];
      if (typeof index === "number" && Number.isInteger(index) && index >= 0) parts.push(`${title}[${index}]`);
    }
    const find = typeof args.findText === "string" ? oneLine(args.findText) : list(args.findText);
    if (find) parts.push(`find ${find}`);
    else {
      for (const key of ["offset", "limit"]) {
        const value = args[key];
        if (typeof value === "number" && Number.isInteger(value) && value >= 0) parts.push(`${key} ${value}`);
      }
    }
    return { label, target: parts.join(" · ") };
  }
  if (name === "subagent") {
    const options = record(args.options);
    const parts = [oneLine(args.action), oneLine(args.agent), oneLine(args.id ?? args.runId)].filter(Boolean);
    if (args.workflow === true || args.workflow === "true") parts.push("workflow (reply block)");
    else if (typeof args.workflow === "string") parts.push(`workflow ${shortPath(args.workflow, cwd)}`);
    if (Array.isArray(args.tasks)) parts.push(`parallel (${args.tasks.length}): ${list(args.tasks, (task) => oneLine(record(task).agent))}`);
    if (Array.isArray(args.chain)) parts.push(`chain (${args.chain.length}): ${list(args.chain, (step) => {
      const item = record(step);
      return oneLine(item.agent) || (Array.isArray(item.parallel) ? `${item.parallel.length} parallel` : "step");
    })}`);
    if (args.async === true) parts.push("[async]");
    const view = oneLine(options.view ?? args.view);
    if (view) parts.push(view);
    const index = options.index ?? args.index;
    if (typeof index === "number" && Number.isInteger(index) && index >= 0) parts.push(`child[${index}]`);
    const dir = shortPath(options.dir ?? args.dir, cwd);
    if (dir) parts.push(dir);
    const task = oneLine(args.task ?? args.message, 240);
    if (task) parts.push(task);
    return { label, target: parts.join(" · ") };
  }
  if (path) {
    const operation = oneLine(args.operation ?? args.action);
    const symbol = oneLine(args.symbol);
    const query = oneLine(args.query ?? args.pattern);
    const line = typeof args.line === "number" ? args.line : args.offset;
    const range = typeof line === "number" ? `:${line}` : "";
    return { label, target: [operation, query, path + range, symbol].filter(Boolean).join(" · "), path: !query };
  }
  const target = oneLine(args.query ?? args.pattern ?? args.operation ?? args.action ?? args.focus)
    || list(args.queries)
    || list(args.paths, (p) => shortPath(p, cwd))
    || list(args.tools)
    || oneLine(args.prompt ?? args.claim ?? args.objective ?? args.name ?? args.source);
  return { label, target };
}

function lineCount(text: string): number {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length - 1; i++) if (text[i] === "\n") count++;
  return count;
}

function resultSummary(name: string, args: Args, result: AgentToolResult<unknown>, context: ToolRenderContext): string {
  const texts = result.content.filter((block) => block.type === "text");
  if (context.isError) {
    // Inspect a bounded head and tail so a long build log cannot obscure its final error.
    const sample = texts.map((b) => b.text.length > 4096
      ? `${b.text.slice(0, 2048)}\n${b.text.slice(-2048)}` : b.text).join("\n");
    const lines = sample.split(/\r?\n/).map((s) => oneLine(s, 240)).filter(Boolean);
    return lines.find((s) => /error|exception|failed|denied|not found|错误|失败/i.test(s))
      ?? lines[0] ?? "Tool failed (expand for details)";
  }
  if (context.isPartial) return "";
  const details = record(result.details);
  const warning = resultWarning(name, details);
  let summary = "";
  if (name === "read" || name === "read_symbol" || name === "read_enclosing") {
    const images = result.content.filter((block) => block.type === "image").length;
    const count = images || texts.reduce((n, b) => n + lineCount(b.text), 0);
    summary = images ? `${count} image${count === 1 ? "" : "s"}` : `${count} line${count === 1 ? "" : "s"}`;
  } else if (name === "write" && typeof args.content === "string") {
    const count = lineCount(args.content);
    summary = `${count} line${count === 1 ? "" : "s"}`;
  } else if (name === "edit") {
    const patch = typeof details.patch === "string" ? details.patch : details.diff;
    if (typeof patch === "string") {
      let added = 0, removed = 0;
      for (const line of patch.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) added++;
        if (line.startsWith("-") && !line.startsWith("---")) removed++;
      }
      summary = `+${added} / -${removed}`;
    } else if (Array.isArray(args.edits)) {
      summary = `${args.edits.length} replacement${args.edits.length === 1 ? "" : "s"}`;
    }
  }
  return [summary, warning].filter(Boolean).join(" · ");
}

function stateFor(context: ToolRenderContext): GlanceState {
  return context.state.toolGlance ??= { summary: "", nativeState: {} };
}

function duration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;
}

function headline(action: Action, context: ToolRenderContext, state: GlanceState, theme: Theme): Component {
  return {
    invalidate() {},
    render(width) {
      if (width <= 0) return [];
      const pad = " ".repeat(Math.min(context.outputPad, Math.max(0, width - 1)));
      const color = context.isError ? "error" : context.isPartial ? "warning" : "success";
      const icon = context.isError ? "✗" : context.isPartial ? (context.executionStarted ? "…" : "·") : "✓";
      const label = truncateToWidth(action.label, Math.min(32, Math.floor(width * 0.4)), "…");
      const prefix = pad + theme.fg(color, icon) + " " + theme.fg("toolTitle", label);
      // Reserve room for errors/stats and duration before allocating room for a long target.
      const suffixText = [state.summary, duration(context.durationMs)].filter(Boolean).join(" · ");
      const room = Math.max(0, width - visibleWidth(prefix));
      const suffix = truncateToWidth(suffixText ? ` · ${suffixText}` : "", room, "…");
      const targetWidth = Math.max(0, room - visibleWidth(suffix) - 1);
      let target = truncateToWidth(action.target, targetWidth, "…");
      if (action.path && targetWidth > 1 && visibleWidth(action.target) > targetWidth) {
        target = "…" + sliceByColumn(action.target, visibleWidth(action.target) - targetWidth + 1, targetWidth - 1, true);
      }
      return [truncateToWidth(prefix + (target ? ` ${theme.fg("accent", target)}` : "")
        + theme.fg(context.isError ? "error" : "muted", suffix), width, "…")];
    },
  };
}

/** Keep the native subagent's state semantics, but not its entire collapsed card/output body. */
function briefSubagentResult(
  native: Component, notice: string, runId: string, images: string, theme: Theme, pad: number,
): Component {
  const fallback = new Text(theme.fg("muted", notice), pad, 0);
  const imageText = new Text(theme.fg("muted", images), pad, 0);
  return {
    invalidate() { native.invalidate(); fallback.invalidate(); imageText.invalidate(); },
    render(width) {
      if (width <= 0) return [];
      const first = native.render(width).find((line) => stripTerminalSequences(line).trim());
      let lines: string[] = [];
      if (first) {
        const plain = stripTerminalSequences(first).trimEnd();
        const title = sliceByColumn(first, 0, visibleWidth(plain), true);
        const suffix = runId && !plain.includes(runId) ? theme.fg("muted", ` · run ${runId}`) : "";
        const room = Math.max(0, width - visibleWidth(suffix));
        lines = [truncateToWidth(truncateToWidth(title, room, "…") + suffix, width, "…")];
      } else if (notice) lines = fallback.render(width);
      return [...lines, ...(images ? imageText.render(width) : [])];
    },
  };
}

function renderers(
  name: string, native: ToolRenderers | undefined, view: CodexView, appearance: () => Appearance,
  nativePending: Map<GlanceState, () => void>,
): ToolRenderers {
  return {
    renderShell: "self", // No colored box or its top/bottom padding.
    renderCall(rawArgs, theme, context) {
      const state = stateFor(context);
      state.callPartial = context.isPartial;
      // Pi 1.3 has no export flag: real tool rows first render before execution/args complete;
      // the HTML adapter enters with both complete. Keep static headings neutral and isolated.
      state.interactive ??= !context.executionStarted || !context.argsComplete;
      const action = describe(name, record(rawArgs), context.cwd);
      if (!state.interactive) {
        return new Text(theme.fg("toolTitle", action.label)
          + (action.target ? ` ${theme.fg("accent", action.target)}` : ""), context.outputPad, 0);
      }
      view.track(name, record(rawArgs), action, context, () => state.summary);
      if (appearance() === "codex" ? view.nativeDetails(context) : context.expanded) {
        if (native?.renderCall) {
          state.nativeCall = native.renderCall(rawArgs, theme, {
            ...context, state: state.nativeState, lastComponent: state.nativeCall,
          });
          return state.nativeCall;
        }
        return new Text(`${theme.fg("toolTitle", name)}\n${JSON.stringify(rawArgs, null, 2) ?? ""}`, context.outputPad, 0);
      }
      return appearance() === "codex" ? view.component(context, theme) : headline(action, context, state, theme);
    },
    renderResult(result, options, theme, context) {
      const state = stateFor(context);
      state.summary = resultSummary(name, record(context.args), result, context);
      // Static exports use their own state and must not finish or regroup a live tool row.
      const detached = !state.interactive || state.callPartial !== context.isPartial;
      if (!detached) view.result(context, result);
      // Local group expansion shows actions; Full view and HTML exports retain raw results.
      const showDetails = options.expanded
        && (detached || appearance() !== "codex" || view.nativeDetails(context));
      const notice = context.isError ? "" : importantResultNotice(name, result.details, options.isPartial);
      const inlineSubagent = name === "subagent" && !showDetails;
      const nativeResult = native?.renderResult;
      const renderNative = (partial = options.isPartial, invalidate = context.invalidate): Component => {
        const component = nativeResult!(result, { ...options, isPartial: partial }, theme, {
          ...context, isPartial: partial, invalidate, state: state.nativeState, lastComponent: state.nativeResult,
        });
        state.nativeResult = component;
        return component;
      };
      if ((showDetails || inlineSubagent) && nativeResult) {
        try {
          const component = renderNative();
          if (options.isPartial) nativePending.set(state, () => { renderNative(false, () => {}); });
          return inlineSubagent ? briefSubagentResult(component, notice, oneLine(record(result.details).asyncId, 120),
            imageFallbackText(result, context.showImages), theme, context.outputPad) : component;
        } finally {
          if (!options.isPartial) nativePending.delete(state);
        }
      }
      if (!options.isPartial && nativePending.has(state)) {
        try {
          if (nativeResult) renderNative(); // Hidden renderers still need the final state to stop timers.
        } catch {
          // A failing hidden presentation must not replace the visible activity/error summary.
        } finally {
          nativePending.delete(state);
        }
      }
      const images = imageFallbackText(result, context.showImages);
      if (!showDetails) {
        const lines = [notice ? theme.fg(name === "web_search" ? "warning" : "muted", notice) : "",
          images ? theme.fg("muted", images) : ""].filter(Boolean).join("\n");
        return lines ? new Text(lines, context.outputPad, 0) : empty;
      }
      const text = result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      const output = [text, notice, images].filter(Boolean).join("\n");
      return output ? new Text(theme.fg(context.isError ? "error" : "toolOutput", output), context.outputPad, 0) : empty;
    },
  };
}

export default function toolGlance(pi: ExtensionAPI) {
  const view = new CodexView();
  let appearance: Appearance = "codex";
  const nativePending = new Map<GlanceState, () => void>();
  function clearNativePending(): void {
    const finishers = [...nativePending.values()];
    nativePending.clear();
    for (const finish of finishers) {
      try { finish(); } catch { /* One renderer must not prevent the others from releasing resources. */ }
    }
  }
  // No tool is re-registered, no result is changed, and no model context is added.
  pi.registerToolRenderer((name, next) => renderers(name, next(), view, () => appearance, nativePending));

  function applyMode(mode: ViewMode, ctx: ExtensionContext, notify = false): void {
    if (ctx.mode !== "tui") return;
    if (mode !== "full") appearance = mode;
    ctx.ui.setToolsExpanded(mode === "full");
    view.refresh(); // Pi skips setToolsExpanded when only the appearance changed.
    const label = { compact: "Compact", codex: "Codex", full: "Full" }[mode];
    if (notify) ctx.ui.notify(`Tool view: ${label} (/toolview cycles modes)`, "info");
  }

  function cycleMode(ctx: ExtensionContext, notify = false): void {
    if (ctx.mode !== "tui") return;
    const current: ViewMode = ctx.ui.getToolsExpanded() ? "full" : appearance;
    const next: Record<ViewMode, ViewMode> = { compact: "codex", codex: "full", full: "compact" };
    applyMode(next[current], ctx, notify);
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    clearNativePending();
    ctx.ui.setStatus("tool-glance", undefined);
    // A hidden thinking block still renders one placeholder line per model step. With thinking
    // hidden that line is pure noise, so drop it until the session ends.
    ctx.ui.setHiddenThinkingLabel("");
    view.reset(ctx.sessionManager.getBranch(), () => ctx.ui.getToolsExpanded());
    applyMode(appearance, ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    clearNativePending();
    view.reset(ctx.sessionManager.getBranch(), () => ctx.ui.getToolsExpanded());
  });
  pi.on("message_end", (event, ctx) => {
    if (ctx.mode === "tui") view.observe(event.message);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    clearNativePending();
    view.reset();
    if (ctx.mode === "tui") {
      ctx.ui.setStatus("tool-glance", undefined);
      ctx.ui.setHiddenThinkingLabel(undefined);
    }
  });

  pi.registerCommand("toolview", {
    description: "Tool view: /toolview [compact|codex|full]; omit the mode to cycle",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") return;
      const mode = args.trim().toLowerCase();
      if (mode && mode !== "codex" && mode !== "compact" && mode !== "full") {
        ctx.ui.notify("Usage: /toolview [compact|codex|full]; /toolview cycles Compact → Codex → Full.", "warning");
        return;
      }
      if (mode === "compact" || mode === "codex" || mode === "full") applyMode(mode, ctx, true);
      else cycleMode(ctx, true);
    },
  });
}
