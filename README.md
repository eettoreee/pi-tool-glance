# Tool Glance for Pi

Less tool noise. More conversation.

Tool Glance is a presentation-only [Pi](https://pi.dev) extension with three tool views, selected or cycled with slash commands:

```text
/toolview compact
/toolview codex
/toolview full
/toolview          # Compact → Codex → Full → Compact
```

- **Compact** — a single-line summary per call, with English action labels, useful statistics, and duration.
- **Codex** — quiet activity lines with Codex's markers: a pulsing bullet while a call runs, green when it finishes, red on failure. Adjacent reads, searches, listings, inspections, and shell commands merge into one activity, even across the assistant messages of a turn.
- **Full** — original arguments and results, using the tool's original renderers where available.

Example Codex view:

```text
• Ran  3 commands
  └ Ran npm test, uv run check.py (+1)
• Edited index.ts (+12 -4)
• Explored  3 reads · 1 search
  └ Read index.ts, README.md (+1)
    Search renderCall
• Ran node --test
```

## Requirements

- Pi **1.3.0 or newer**, using the `@earendil-works` extension API. Tested against 1.3.0 and 1.4.0; older `@mariozechner` releases are not supported.
- Node.js **22.19.0 or newer**.
- An interactive terminal session. The extension does not change RPC, JSON, or print-mode tool execution.

## Install

```sh
pi install git:github.com/eettoreee/pi-tool-glance
```

If you already loaded a manually copied Tool Glance extension, disable or move that copy out of Pi's extension discovery directory first. **Load only one copy** of this extension.

### Keybindings (optional)

Tool Glance registers **no keyboard shortcut**. Pi's tree filter keeps its default `Ctrl+O` inside `/tree`; no override is required.

If you want tool views controlled only by `/toolview`, you can disable Pi's native tool-output toggle by merging this entry into `~/.pi/agent/keybindings.json`:

```json
{
  "app.tools.expand": []
}
```

**Keep your other keybindings. Do not replace the entire file if it already exists.** A minimal standalone template is included at [`examples/keybindings.json`](examples/keybindings.json).

Then run this inside Pi:

```text
/reload
```

This extension does not edit your settings or keybindings automatically. Without the optional override, Pi's native `Ctrl+O` tool-output toggle also remains available in the main editor. If an earlier local configuration disabled `app.tree.filter.cycleForward`, remove that override to restore Pi's default tree shortcut.

## Controls

| Control | Action |
| --- | --- |
| `/toolview` | Cycle **Compact → Codex → Full → Compact** |
| `/toolview compact` | Select Compact |
| `/toolview codex` | Select Codex |
| `/toolview full` | Select Full |
| Click a single activity | Open or close that call's details in fullscreen mode |
| Click an activity group | Open or close its complete action list |

Startup defaults to **Codex**. There is **no persistent View status in the footer**; explicit `/toolview` commands show a brief notification.

## What stays visible

- Calls that are still running, with Codex's pulsing activity marker.
- Failures with a red marker and a compact error reason.
- Image results, according to Pi's image settings.
- Structured output-truncation warnings, including web-tool flags and incomplete URL/query batches.
- Browser approval/manual-open instructions and usable review URLs while a search needs user action.
- A brief native subagent status and run ID, when available, without showing its entire output card.
- File-edit statistics, when the result supplies a diff.

Finished calls show a green marker. The running marker pulses with true color and falls back to Codex's `•`/`◦` blink; it repaints only while a call is pending and releases its timer when the call finishes, the view is expanded, or the session resets.

Summaries understand configuration-file targets, goal sections/task IDs, stored-content IDs and paging/find selectors, and subagent agents/tasks/workflows/run selectors. Unknown tools, including MCP tools, retain a generic fallback. Unsupported or hidden inline images retain a text placeholder.

Grouping covers reads, searches, listings, inspections, and shell commands. A run may span the assistant messages of one turn; it closes at a user message, visible prose, a mutation (`write`, `edit`, applied replacements), an unknown tool, or a result that failed or carried a warning or image. Running calls stay visible as their own rows and join the group once they finish. Calls retain transcript order even when they finish in parallel. Groups are headed `Explored` (reads only), `Ran` (commands only), or `Worked` (mixed).

Compound and multi-line shell commands show their own bounded command text instead of a generic `shell script` label, so a collapsed group stays readable. The extension does not guess what a script accomplished or claim that tests passed merely because a test command ran.

## Data and privacy

Tool Glance changes **rendering only**. It does not re-register tools, alter execution, modify tool arguments/results, or add model context. Native renderers are retained for Full view, including their existing limitations. Their pending display resources are finalized on completion or session reset, even after switching to a compact view. HTML exports use neutral call headings, retain expandable original results, and do not change live tool progress.

This is **not a redaction or security extension**. Raw arguments and results remain in the conversation and stored transcript. File paths, commands, and error messages can contain sensitive information; review them before sharing logs or exports. Shortened paths and omitted URL query strings in a headline are presentation conveniences, not a privacy guarantee. Actionable browser review links retain their path and query so they can be opened; these may contain local access tokens.

## Uninstall

```sh
pi remove git:github.com/eettoreee/pi-tool-glance
```

If you added the optional `app.tools.expand` override, remove only that entry or restore it to `"ctrl+o"`, then run `/reload`. Keep all other settings and keybindings intact.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm test
npm pack --dry-run --ignore-scripts
```

Pi loads the TypeScript extension directly; there is no bundle or build step. Host packages are peer dependencies and are not bundled. Pinned development dependencies support type checking against Pi 1.3.0; the suite also passes against 1.4.0. The regression suite uses the real Pi loader, tool components, tree selector, and HTML adapter without executing tools or calling a model. Set `PI_TOOL_GLANCE_RUNTIME` to another Pi `node_modules` directory to test that installation.

## License

[MIT](LICENSE) · Copyright (c) 2026 eettoreee.

Inspired by Codex-style activity presentation. This is an independent Pi extension, not an official OpenAI or Anthropic product.
