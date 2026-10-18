# Tool Glance for Pi

Less tool noise. More conversation.

Tool Glance is a presentation-only [Pi](https://pi.dev) extension with three tool views and one shortcut:

```text
Ctrl+O: Compact → Codex → Full → Compact
```

- **Compact** — a single-line summary per call, with English action labels, useful statistics, and duration.
- **Codex** — quiet, neutral activity lines; adjacent successful exploration is grouped under `Explored`.
- **Full** — original arguments and results, using the tool's original renderers where available.

Example Codex view:

```text
• Explored  3 reads · 1 search
  ├ Read index.ts, README.md (+1)
  └ Search renderCall

• Edited index.ts (+12 -4)

• Ran node --test
```

## Requirements

- Pi **1.3.0**, using the `@earendil-works` extension API. This is the tested host version; older `@mariozechner` releases are not supported.
- Node.js **22.19.0 or newer**.
- An interactive terminal session. The extension does not change RPC, JSON, or print-mode tool execution.

## Install

```sh
pi install git:github.com/eettoreee/pi-tool-glance
```

If you already loaded a manually copied Tool Glance extension, disable or move that copy out of Pi's extension discovery directory first. **Load only one copy** of this extension.

### Enable the three-way shortcut

Pi 1.3 reserves its original two-state `Ctrl+O` action. To let Tool Glance handle the key, merge this entry into `~/.pi/agent/keybindings.json`:

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

This extension does not edit your settings or keybindings automatically. Without the keybinding override, the `/toolview` command still works, but Pi will reject the extension's `Ctrl+O` shortcut.

## Controls

| Control | Action |
| --- | --- |
| `Ctrl+O` | Cycle **Compact → Codex → Full → Compact** in the main editor |
| `/toolview` | Run the same three-way cycle |
| `/toolview compact` | Select Compact |
| `/toolview codex` | Select Codex |
| `/toolview full` | Select Full |
| Click a single activity | Open or close that call's details in fullscreen mode |
| Click an `Explored` group | Open or close its complete action list |

Startup defaults to **Codex**. The extension publishes `View: Compact`, `View: Codex`, or `View: Full` through Pi's status API; custom footers decide how to display extension statuses. Keyboard switching does not add a notification for every keypress.

## What stays visible

- Calls that are still running.
- Failures and a compact error reason.
- Image results, according to Pi's image settings.
- Structured output-truncation warnings.
- File-edit statistics, when the result supplies a diff.

Grouping is deliberately conservative: only adjacent successful read/search/inspection calls **within one assistant message** are merged. Groups do not cross prose, thinking blocks, shell commands, mutations, or unknown tools. Calls retain transcript order even when they finish in parallel.

Long compound shell commands are summarized as `PowerShell script` or `shell script`. The extension does not guess what a script accomplished or claim that tests passed merely because a test command ran.

## Data and privacy

Tool Glance changes **rendering only**. It does not re-register tools, alter execution, modify tool arguments/results, or add model context. Native renderers are retained for Full view, including their existing limitations. HTML exports retain expandable original results.

This is **not a redaction or security extension**. Raw arguments and results remain in the conversation and stored transcript. File paths, commands, and error messages can contain sensitive information; review them before sharing logs or exports. Shortened paths and omitted URL query strings in a headline are presentation conveniences, not a privacy guarantee.

## Uninstall

```sh
pi remove git:github.com/eettoreee/pi-tool-glance
```

Remove only the `app.tools.expand` override from your keybindings file, or restore it to `"ctrl+o"`, then run `/reload`. Keep all other settings and keybindings intact.

## Development

```sh
npm install --ignore-scripts
npm run check
npm pack --dry-run --ignore-scripts
```

Pi loads the TypeScript extension directly; there is no bundle or build step. Host packages are peer dependencies and are not bundled. Pinned development dependencies support type checking against Pi 1.3.0.

## License

[MIT](LICENSE) · Copyright (c) 2026 eettoreee.

Inspired by Codex-style activity presentation. This is an independent Pi extension, not an official OpenAI or Anthropic product.
