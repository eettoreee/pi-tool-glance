# Changelog

## 0.4.0

- Remove the `Thinking...` placeholder Pi prints for every hidden thinking block; a long turn no longer collects one faint line per model step. The default label is restored on shutdown, and non-TUI modes are untouched.

## 0.3.0

- Match Codex's activity markers from `codex-rs` 0.164: a brightness pulse with true color (Codex's `•`/`◦` blink without it) while a call runs, a green bullet on success, and a red bullet on failure.
- Use bold default-color verbs, accent-colored detail labels, and Codex's detail gutter (`└` on the first line, four-space alignment after).
- Merge shell commands into activities, and let a run span the assistant messages of one turn; user messages, prose, mutations, unknown tools, and failed/warned/image results still close it.
- Keep running calls visible until they finish instead of hiding them inside a group.
- Show bounded real command text for compound and multi-line shell commands instead of a generic `shell script` label.
- Add regression coverage for marker timing and timer cleanup, cross-message runs, command bursts, barriers, and mixed-kind headers.

## 0.2.0

- Use `/toolview` to select or cycle Compact, Codex, and Full. The extension no longer registers `Ctrl+O` or publishes a persistent View footer status; Pi's tree shortcut remains available.
- Preserve search queries alongside paths, configuration-file targets, goal sections/task IDs, stored-content paging/find selectors, and subagent agents/tasks/workflows/run IDs.
- Keep built-in and web truncation flags and incomplete URL/query batches visible and outside successful exploration groups.
- Retain browser approval/manual-open instructions and actionable review URLs in compact views.
- Show a brief native subagent state and run identity, with a conservative fallback when no native renderer exists.
- Preserve text image placeholders when inline images are hidden or unsupported, including tools without native renderers.
- Finalize pending native renderer resources after completion, tree navigation, reload, or shutdown, even if their output is hidden.
- Use neutral HTML call headings and isolate exported results from live tool progress.
- Add portable regression tests using Pi's real loader, TUI components, tree selector, and HTML adapter. Tests never execute tools or call models.

## 0.1.0

- Initial release with Compact, Codex-style, and Full tool views.
