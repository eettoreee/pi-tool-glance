# Changelog

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
