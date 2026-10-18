/** Display-only tool rendering: Codex activity flow by default; Ctrl+O restores details. */
import { homedir } from "node:os";
import { CodexView, type Action, type RenderContext as ToolRenderContext } from "./codex-view.ts";
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
  const path = shortPath(args.path ?? args.file_path ?? args.filePath, cwd);
  if (name === "bash" || name === "powershell") {
    return { label, target: oneLine(args.command) };
  }
  if (name === "fetch_content") {
    return { label, target: urlLabel(args.url) || list(args.urls, urlLabel) };
  }
  if (path) {
    const operation = oneLine(args.operation ?? args.action);
    const symbol = oneLine(args.symbol);
    const line = typeof args.line === "number" ? args.line : args.offset;
    const range = typeof line === "number" ? `:${line}` : "";
    return { label, target: [operation, path + range, symbol].filter(Boolean).join(" · "), path: true };
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
  const truncated = record(details.truncation).truncated === true;
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
  return [summary, truncated ? "Output truncated" : ""].filter(Boolean).join(" · ");
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

function renderers(name: string, native: ToolRenderers | undefined, view: CodexView, appearance: () => Appearance): ToolRenderers {
  return {
    renderShell: "self", // No colored box or its top/bottom padding.
    renderCall(rawArgs, theme, context) {
      const state = stateFor(context);
      state.callPartial = context.isPartial;
      const action = describe(name, record(rawArgs), context.cwd);
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
      // Core TUI updates always pair call/result renders in the same phase; static HTML exports do not.
      const detached = state.callPartial !== context.isPartial;
      view.result(context, result, detached);
      // Local group expansion shows actions; global Ctrl+O and HTML exports retain raw results.
      if (!options.expanded || (!detached && appearance() === "codex" && !view.nativeDetails(context))) return empty;
      if (native?.renderResult) {
        state.nativeResult = native.renderResult(result, options, theme, {
          ...context, state: state.nativeState, lastComponent: state.nativeResult,
        });
        return state.nativeResult;
      }
      const output = result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      return output ? new Text(theme.fg(context.isError ? "error" : "toolOutput", output), context.outputPad, 0) : empty;
    },
  };
}

export default function toolGlance(pi: ExtensionAPI) {
  const view = new CodexView();
  let appearance: Appearance = "codex";
  // No tool is re-registered, no result is changed, and no model context is added.
  pi.registerToolRenderer((name, next) => renderers(name, next(), view, () => appearance));

  function applyMode(mode: ViewMode, ctx: ExtensionContext, notify = false): void {
    if (ctx.mode !== "tui") return;
    if (mode !== "full") appearance = mode;
    ctx.ui.setToolsExpanded(mode === "full");
    view.refresh(); // Pi skips setToolsExpanded when only the appearance changed.
    const label = { compact: "Compact", codex: "Codex", full: "Full" }[mode];
    ctx.ui.setStatus("tool-glance", `View: ${label} · Ctrl+O`);
    if (notify) ctx.ui.notify(`Tool view: ${label} (Ctrl+O: Compact → Codex → Full)`, "info");
  }

  function cycleMode(ctx: ExtensionContext, notify = false): void {
    if (ctx.mode !== "tui") return;
    const current: ViewMode = ctx.ui.getToolsExpanded() ? "full" : appearance;
    const next: Record<ViewMode, ViewMode> = { compact: "codex", codex: "full", full: "compact" };
    applyMode(next[current], ctx, notify);
  }

  pi.registerShortcut("ctrl+o", {
    description: "Cycle tool view: Compact → Codex → Full",
    handler: (ctx) => cycleMode(ctx),
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    view.reset(ctx.sessionManager.getBranch(), () => ctx.ui.getToolsExpanded());
    applyMode(appearance, ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    if (ctx.mode === "tui") view.reset(ctx.sessionManager.getBranch(), () => ctx.ui.getToolsExpanded());
  });
  pi.on("message_end", (event, ctx) => {
    if (ctx.mode === "tui") view.observe(event.message);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    view.reset();
    if (ctx.mode === "tui") ctx.ui.setStatus("tool-glance", undefined);
  });

  pi.registerCommand("toolview", {
    description: "Tool view: /toolview [compact|codex|full]; Ctrl+O cycles all three modes",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") return;
      const mode = args.trim().toLowerCase();
      if (mode && mode !== "codex" && mode !== "compact" && mode !== "full") {
        ctx.ui.notify("Usage: /toolview [compact|codex|full]; Ctrl+O cycles Compact → Codex → Full.", "warning");
        return;
      }
      if (mode === "compact" || mode === "codex" || mode === "full") applyMode(mode, ctx, true);
      else cycleMode(ctx, true);
    },
  });
}
