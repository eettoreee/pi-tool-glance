/** Codex-inspired activity layout. Only presentation metadata is retained here. */
import type { AgentToolResult, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { mixColors, sliceByColumn, stripTerminalSequences, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { resultWarning } from "./result-utils.ts";

export type RenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
export interface Action { label: string; target: string; path?: boolean }
type Args = Record<string, unknown>;
type Kind = "read" | "search" | "list" | "inspect" | "run";
interface Activity {
  id: string;
  name: string;
  args: Args;
  action: Action;
  invalidators: Map<object, () => void>;
  summary: () => string;
  status: "pending" | "done" | "error";
  images: boolean;
  warning: string;
}
interface Plan {
  ids: string[];
  dirty: boolean;
  groups: Map<string, Activity[]>;
}

const kinds: Record<string, Kind> = {
  read: "read", read_symbol: "read", read_enclosing: "read", module_report: "read",
  grep: "search", find: "search", symbol_search: "search", ast_grep_search: "search", web_search: "search",
  ls: "list", project_report: "inspect", lsp_navigation: "inspect", fetch_content: "inspect",
  get_search_content: "inspect", source_check: "inspect", effective_config: "inspect",
  bash: "run", powershell: "run",
};
const verbs: Record<string, [string, string]> = {
  read: ["Read", "Reading"], read_symbol: ["Read", "Reading"], read_enclosing: ["Read", "Reading"],
  module_report: ["Inspected", "Inspecting"], project_report: ["Inspected", "Inspecting"],
  write: ["Wrote", "Writing"], edit: ["Edited", "Editing"],
  bash: ["Ran", "Running"], powershell: ["Ran", "Running"],
  grep: ["Searched", "Searching"], find: ["Searched", "Searching"],
  symbol_search: ["Searched", "Searching"], ast_grep_search: ["Searched", "Searching"],
  ast_grep_replace: ["Replaced", "Replacing"], ls: ["Listed", "Listing"],
  web_search: ["Searched", "Searching"], fetch_content: ["Fetched", "Fetching"],
  get_search_content: ["Read", "Reading"], source_check: ["Checked", "Checking"],
  lens_diagnostics: ["Checked", "Checking"], lsp_navigation: ["Inspected", "Inspecting"],
  effective_config: ["Inspected", "Inspecting"], tool_search: ["Loaded", "Loading"],
  get_goal: ["Read goal", "Reading goal"],
  web_enable: ["Enabled", "Enabling"], pi_lens_activate_tools: ["Enabled", "Enabling"],
};
const readOnlyLsp = new Set(["definition", "typeDefinition", "declaration", "references", "hover", "signatureHelp",
  "documentSymbol", "findSymbol", "workspaceSymbol", "implementation", "prepareCallHierarchy", "incomingCalls",
  "outgoingCalls", "capabilities", "workspaceDiagnostics"]);
const object = (value: unknown): Args => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Args : {};
const clean = (value: unknown): string => typeof value === "string"
  ? stripTerminalSequences(value.slice(0, 4096)).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim() : "";

function eligible(name: string, args: Args): boolean {
  if (!kinds[name]) return false;
  if (name === "lsp_navigation" && !readOnlyLsp.has(clean(args.operation))) return false;
  return !/\.(png|jpe?g|gif|webp|bmp)(?:$|[?#])/i.test(clean(args.path));
}

/** Summarize syntax, not intent: never infer successful checks from a command string. */
function shellLabel(name: string, args: Args): string {
  const raw = typeof args.command === "string" ? stripTerminalSequences(args.command.slice(0, 4096)).trim() : "";
  const fallback = name === "powershell" ? "PowerShell script" : "shell script";
  if (!raw) return fallback;
  // Compound and multi-line commands keep their real text; a generic label would hide what ran
  // in both the row and a collapsed command group.
  if (/[\r\n;|&`]|^[$({]/.test(raw)) return truncateToWidth(clean(raw), 96, "…");
  const tokens = clean(raw).split(" ");
  if (!/^[\w./\\:-]+$/.test(tokens[0])) return fallback;
  const command = tokens[0].replace(/\\/g, "/").split("/").pop() ?? tokens[0];
  if (/^(npm|pnpm|yarn|bun|uv|git)(\.exe)?$/i.test(command)) return [command, ...tokens.slice(1, 3)].join(" ");
  if (/^node(\.exe)?$/i.test(command)) {
    const entry = tokens[1] ?? "";
    return entry === "--test" ? "node --test" : entry && !entry.startsWith("-")
      ? `node ${entry.replace(/\\/g, "/").split("/").pop()}` : "node";
  }
  return command;
}

function describe(activity: Activity): { verb: string; target: string; path?: boolean } {
  const { name, args, action, status } = activity;
  const verb = verbs[name]?.[status === "pending" ? 1 : 0] ?? (status === "pending" ? "Calling" : "Called");
  if (name === "bash" || name === "powershell") return { verb, target: shellLabel(name, args) };
  if (name === "lsp_navigation" && !readOnlyLsp.has(clean(args.operation))) {
    return { verb: status === "pending" ? "Calling" : "Called", target: `LSP ${action.target}`, path: action.path };
  }
  if (name === "ast_grep_replace" && args.apply !== true) {
    return { verb: status === "pending" ? "Previewing" : "Previewed", target: action.target, path: action.path };
  }
  if (name === "web_enable") return { verb, target: "web tools" };
  if (name === "pi_lens_activate_tools") return { verb, target: "code tools" };
  if (!verbs[name]) return { verb, target: [action.label, action.target].filter(Boolean).join(" · ") };
  return { verb, target: action.target || ({ project_report: "project", effective_config: "configuration",
    get_search_content: "web result" }[name] ?? ""), path: action.path };
}

function fitTarget(value: string, width: number, path = false): string {
  if (path && width > 1 && visibleWidth(value) > width) {
    return "…" + sliceByColumn(value, visibleWidth(value) - width + 1, width - 1, true);
  }
  return truncateToWidth(value, width, "…");
}

const FRAME_MS = 100;
const PULSE_MS = 2000;

/** Codex's activity indicator: a brightness pulse in true color, else its 600ms bullet blink. */
function activityMarker(theme: Theme, at = Date.now()): string {
  if (theme.getColorMode() === "truecolor") {
    const phase = (at % PULSE_MS) / PULSE_MS * 2 * Math.PI;
    const intensity = 0.5 + 0.5 * Math.cos(phase);
    return theme.style("•", { fg: mixColors(theme.colors.dim, theme.colors.text, intensity), bold: true });
  }
  return at % 1200 < 600 ? theme.bold("•") : theme.fg("dim", "◦");
}

/** Green means the call finished, red means it failed; running calls pulse like Codex. */
function statusMarker(theme: Theme, status: Activity["status"]): string {
  if (status === "pending") return activityMarker(theme);
  return theme.fg(status === "error" ? "error" : "success", theme.bold("•"));
}

function line(theme: Theme, width: number, prefix: string, verb: string, target = "", path = false, suffix = "", accent = false): string {
  const title = truncateToWidth(verb, Math.min(24, Math.max(0, Math.floor(width * 0.4))), "…");
  const head = prefix + (accent ? theme.fg("accent", title) : theme.bold(title));
  const room = Math.max(0, width - visibleWidth(head));
  const tail = truncateToWidth(suffix, room, "…");
  const body = fitTarget(target, Math.max(0, room - visibleWidth(tail) - 1), path);
  return truncateToWidth(head + (body ? ` ${theme.fg("text", body)}` : "") + theme.fg("dim", tail), width, "…");
}

export class CodexView {
  private rows = new Map<string, Activity>();
  private plans = new Map<string, Plan>();
  private pending = new Set<string>();
  private queued = false;
  private generation = 0;
  private expanded: () => boolean = () => false;
  /** Tool calls of the run under construction, shared with its plan once it has two members. */
  private run: string[] = [];
  private runPlan?: Plan;
  private animator?: ReturnType<typeof setInterval>;

  reset(branch: readonly unknown[] = [], expanded: () => boolean = () => false): void {
    this.generation++;
    this.stopAnimation();
    this.rows.clear();
    this.plans.clear();
    this.pending.clear();
    this.queued = false;
    this.run = [];
    this.runPlan = undefined;
    this.expanded = expanded;
    for (const entry of branch) {
      const item = object(entry);
      if (item.type === "message") this.observe(item.message);
    }
  }

  /**
   * A run of low-risk work spans assistant messages of one turn, so a burst of reads or commands
   * still collapses into one activity. Visible prose, user messages, mutations, and tools outside
   * the groupable kinds close it.
   */
  observe(message: unknown): void {
    const msg = object(message);
    if (msg.role === "user") return this.closeRun();
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) return;
    for (const part of msg.content) {
      const block = object(part);
      if (block.type === "toolCall") {
        if (typeof block.id === "string" && typeof block.name === "string"
          && eligible(block.name, object(block.arguments))) this.extendRun(block.id);
        else this.closeRun();
      } else if (block.type === "text" && clean(block.text)) this.closeRun();
    }
  }

  private extendRun(id: string): void {
    if (this.run.includes(id)) return;
    this.run.push(id);
    if (!this.runPlan && this.run.length > 1) this.runPlan = { ids: this.run, dirty: true, groups: new Map() };
    if (!this.runPlan) return;
    for (const key of this.run) this.plans.set(key, this.runPlan);
    this.runPlan.dirty = true;
    this.changed(this.runPlan);
  }

  private closeRun(): void {
    this.run = [];
    this.runPlan = undefined;
  }

  track(name: string, args: Args, action: Action, context: RenderContext, summary: () => string): void {
    const status = context.isPartial ? "pending" : context.isError ? "error" : "done";
    let row = this.rows.get(context.toolCallId);
    const changed = !row || (row.status !== status && (row.status === "pending" || !context.isPartial));
    if (!row) {
      row = { id: context.toolCallId, name, args, action, summary, status, images: false, warning: "", invalidators: new Map() };
      this.rows.set(row.id, row);
    } else if (row.status === "pending" || !context.isPartial) {
      // Rebuilding/exporting a finished call must not downgrade it to "Reading" again.
      Object.assign(row, { args, action, summary, status });
    }
    row.invalidators.set(context.state, context.invalidate);
    if (changed) this.changed(this.plans.get(row.id));
    this.animate();
  }

  result(context: RenderContext, result: AgentToolResult<unknown>, detached = false): void {
    const row = this.rows.get(context.toolCallId);
    if (!row) return;
    // Static HTML exports use separate render states and no-op invalidators. Do not retain them.
    if (detached) row.invalidators.delete(context.state);
    const images = result.content.some((block) => block.type === "image");
    const warning = resultWarning(row.name, result.details);
    const finished = row.status === "pending" && !context.isPartial;
    if (row.images !== images || row.warning !== warning || finished) {
      row.images = images;
      row.warning = warning;
      if (finished) row.status = context.isError ? "error" : "done";
      this.changed(this.plans.get(row.id));
    }
    this.animate();
  }

  nativeDetails(context: RenderContext): boolean {
    return context.expanded && (this.expanded() || this.members(context.toolCallId).length < 2);
  }

  refresh(): void { this.schedule(this.rows.keys()); this.animate(); }

  /** Redraw pending rows for Codex's activity pulse; the interval exists only while work runs. */
  private animate(): void {
    if (this.expanded() || ![...this.rows.values()].some((row) => row.status === "pending")) {
      this.stopAnimation();
      return;
    }
    if (this.animator !== undefined) return;
    const generation = this.generation;
    this.animator = setInterval(() => {
      if (generation !== this.generation) return;
      for (const row of this.rows.values()) {
        if (row.status !== "pending") continue;
        for (const invalidate of row.invalidators.values()) {
          try { invalidate(); } catch { /* One activity must not stop the others from pulsing. */ }
        }
      }
    }, FRAME_MS);
    this.animator.unref?.();
  }

  private stopAnimation(): void {
    if (this.animator === undefined) return;
    clearInterval(this.animator);
    this.animator = undefined;
  }

  private changed(plan: Plan | undefined): void {
    if (!plan) return;
    plan.dirty = true;
    this.schedule(plan.ids);
  }

  /** Redraw after the current core update, never recursively from a renderer. */
  private schedule(ids: Iterable<string>): void {
    for (const id of ids) if (this.rows.has(id)) this.pending.add(id);
    if (this.queued || !this.pending.size) return;
    this.queued = true;
    const generation = this.generation;
    queueMicrotask(() => {
      if (generation !== this.generation) return;
      this.queued = false;
      const pending = [...this.pending];
      this.pending.clear();
      for (const id of pending) {
        for (const invalidate of this.rows.get(id)?.invalidators.values() ?? []) invalidate();
      }
    });
  }

  private members(id: string): Activity[] {
    const row = this.rows.get(id);
    if (!row) return [];
    const plan = this.plans.get(id);
    if (!plan) return [row];
    if (plan.dirty) {
      plan.groups.clear();
      let group: Activity[] = [];
      const flush = () => {
        for (const member of group) plan.groups.set(member.id, group);
        group = [];
      };
      for (const key of plan.ids) {
        const member = this.rows.get(key);
        // Failures, running calls, images, and structured warnings remain separate and visible.
        if (!member || member.status !== "done" || member.images || member.warning) flush();
        else group.push(member);
      }
      flush();
      plan.dirty = false;
    }
    return plan.groups.get(id) ?? [row];
  }

  component(context: RenderContext, theme: Theme): Component {
    return {
      invalidate() {},
      render: (width) => {
        if (width <= 0) return [];
        const row = this.rows.get(context.toolCallId);
        if (!row) return [];
        const members = this.expanded() ? [row] : this.members(row.id);
        if (members.length > 1 && members[0] !== row) return [];
        const pad = " ".repeat(Math.min(context.outputPad, Math.max(0, width - 1)));
        if (members.length > 1) return this.groupLines(members, context.expanded, theme, width, pad);
        const action = describe(row);
        const summary = row.summary();
        const diff = row.name === "edit" ? summary.match(/^\+\d+ \/ -\d+/)?.[0].replace(" / ", " ") : undefined;
        const suffix = [diff, row.warning].filter(Boolean).map((item) => ` (${item})`).join("");
        const first = line(theme, width, pad + statusMarker(theme, row.status) + " ", action.verb,
          action.target, action.path, suffix);
        if (row.status !== "error") return [first];
        return [first, truncateToWidth(theme.fg("dim", pad + "  └ ") + theme.fg("error", clean(summary)), width, "…")];
      },
    };
  }

  private groupLines(members: Activity[], open: boolean, theme: Theme, width: number, pad: string): string[] {
    const noun: Record<Kind, string> = { read: "read", search: "search", list: "listing", inspect: "lookup", run: "command" };
    const counts = new Map<Kind, number>();
    for (const row of members) {
      const kind = kinds[row.name];
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    const countLabel = [...counts].map(([kind, count]) => `${count} ${noun[kind]}${count === 1 ? "" : kind === "search" ? "es" : "s"}`).join(" · ");
    const hasRun = counts.has("run");
    const onlyRun = hasRun && counts.size === 1;
    // Completed commands are work, reads are exploration; a mixed run is reported as work.
    const verb = onlyRun ? "Ran" : hasRun ? "Worked" : "Explored";
    const result = [line(theme, width, pad + statusMarker(theme, "done") + " ", verb, "", false, `  ${countLabel}`)];
    const kindVerbs: Record<Kind, string> = { read: "Read", search: "Search", list: "List", inspect: "Inspect", run: "Ran" };
    const entries: { verb: string; target: string; path?: boolean }[] = open
      ? members.map(describe)
      : [...counts.keys()].slice(0, 2).map((kind, index) => {
        const matching = members.filter((row) => kinds[row.name] === kind);
        const targets = [...new Set(matching.map((row) => describe(row).target).filter(Boolean))];
        const extra = targets.length > 2 ? ` (+${targets.length - 2})` : "";
        const remaining = index === 1 && counts.size > 2 ? ` · +${counts.size - 2} types` : "";
        return { verb: kindVerbs[kind], target: targets.slice(0, 2).join(", ") + extra + remaining };
      });
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      // Codex's activity gutter: └ marks the first detail, the rest align beneath it.
      result.push(line(theme, width, pad + theme.fg("dim", i === 0 ? "  └ " : "    "),
        entry.verb, entry.target, entry.path, "", true));
    }
    return result;
  }
}
