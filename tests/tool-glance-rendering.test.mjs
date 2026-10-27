import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Exercise the installed Pi loader/components; never execute tools or call a model.
const agentDir = fileURLToPath(new URL('../', import.meta.url));
const localModules = join(agentDir, 'node_modules');
const modules = process.env.PI_TOOL_GLANCE_RUNTIME
  ?? (existsSync(join(localModules, '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'))
    ? localModules : join(agentDir, 'install', 'releases', '1.3.0', 'node_modules'));
const root = join(modules, '@earendil-works', 'pi-coding-agent');
const runtime = (path) => import(pathToFileURL(join(root, path)).href);
const { loadExtensions } = await runtime('dist/core/extensions/loader.js');
const { ExtensionRunner } = await runtime('dist/core/extensions/runner.js');
const { KeybindingsManager } = await runtime('dist/core/keybindings.js');
const { ToolExecutionComponent } = await runtime('dist/modes/interactive/components/tool-execution.js');
const { TreeSelectorComponent } = await runtime('dist/modes/interactive/components/tree-selector.js');
const themeModule = await runtime('dist/modes/interactive/theme/theme.js');
const { createAllToolRenderers } = await runtime('dist/core/tools/renderers/index.js');
const { createToolHtmlRenderer } = await runtime('dist/core/export-html/tool-renderer.js');
const tui = await import(pathToFileURL(join(modules, '@earendil-works', 'pi-tui', 'dist/index.js')).href);
themeModule.initTheme('dark', false);
const builtins = createAllToolRenderers();
const clean = (component, width = 160) => tui.stripTerminalSequences(component.render(width).join('\n'));
const result = (text = 'hello', details) => ({ content: [{ type: 'text', text }], details, isError: false, durationMs: 5 });
const image = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };

async function harness(t, mode = 'tui') {
  const loaded = await loadExtensions([join(agentDir, 'extensions', 'tool-glance', 'index.ts')], process.cwd());
  assert.deepEqual(loaded.errors, []);
  const state = {
    expanded: false, components: [], errors: [], notifications: [],
    statuses: new Map([['tool-glance', 'View: Old'], ['other', 'keep']]),
  };
  const ui = {
    getToolsExpanded: () => state.expanded,
    setToolsExpanded: (value) => { state.expanded = value; state.components.forEach((c) => c.setExpanded(value)); },
    setStatus: (key, value) => value === undefined ? state.statuses.delete(key) : state.statuses.set(key, value),
    notify: (text, level) => state.notifications.push({ text, level }),
    requestRender() {},
  };
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, process.cwd(), { getBranch: () => [] }, {});
  runner.setUIContext(ui, mode);
  runner.onError((error) => state.errors.push(error));
  await runner.emit({ type: 'session_start' });
  t.after(async () => { await runner.emit({ type: 'session_shutdown' }); assert.deepEqual(state.errors, []); });
  const command = runner.getCommand('toolview');
  async function setMode(value) {
    await command.handler(value, runner.createCommandContext());
    assert.deepEqual(state.errors, []);
  }
  function tool(name, id, args = {}, options = {}) {
    const native = Object.hasOwn(options, 'native') ? options.native : builtins[name];
    const definition = runner.resolveToolRenderers(name, () => native);
    const component = new ToolExecutionComponent(name, id, args, { showImages: false, outputPad: 0, ...options }, definition, ui, process.cwd());
    state.components.push(component);
    component.setExpanded(state.expanded);
    component.setArgsComplete();
    component.markExecutionStarted();
    return component;
  }
  async function observe(calls) {
    await runner.emit({ type: 'message_end', message: { role: 'assistant', content: calls.map(([name, id, args]) => ({ type: 'toolCall', name, id, arguments: args })) } });
  }
  const html = () => createToolHtmlRenderer({ getToolRenderers: (name) => runner.resolveToolRenderers(name, () => builtins[name]), theme: themeModule.theme, cwd: process.cwd() });
  return { runner, loaded, state, setMode, tool, observe, html, command };
}

function trackTimers(t) {
  const set = globalThis.setInterval;
  const clear = globalThis.clearInterval;
  const active = new Set();
  t.mock.method(globalThis, 'setInterval', (...args) => {
    const timer = set(...args); timer.unref?.(); active.add(timer); return timer;
  });
  t.mock.method(globalThis, 'clearInterval', (timer) => { active.delete(timer); return clear(timer); });
  t.after(() => { for (const timer of active) clear(timer); active.clear(); });
  return active;
}

test('command-only controls, hidden footer, and tree Ctrl+O are preserved', async (t) => {
  const h = await harness(t);
  const config = new KeybindingsManager({ 'app.tools.expand': [] });
  tui.setKeybindings(config);
  assert.deepEqual(config.getKeys('app.tree.filter.cycleForward'), ['ctrl+o']);
  assert.deepEqual(config.getKeys('app.tools.expand'), []);
  assert.equal(h.loaded.extensions[0].shortcuts.size, 0);
  assert.equal(h.runner.getShortcuts(config.getEffectiveConfig()).size, 0);
  assert.deepEqual(h.runner.getShortcutDiagnostics(), []);
  const c = h.tool('read', 'modes', { path: 'demo.txt' }); c.updateResult(result());
  assert.match(clean(c), /\u2022 Read demo\.txt/);
  await h.setMode(''); assert.equal(h.state.expanded, true); assert.match(clean(c), /hello/);
  await h.setMode(''); assert.match(clean(c), /\u2713 Read demo\.txt/);
  await h.setMode(''); assert.match(clean(c), /\u2022 Read demo\.txt/);
  assert.equal(h.state.statuses.has('tool-glance'), false);
  assert.equal(h.state.statuses.get('other'), 'keep');
  assert.ok(h.state.notifications.every(({ text }) => !/ctrl\+o/i.test(text)));
  const entry = { type: 'message', id: 'root', parentId: null, timestamp: new Date(0).toISOString(), message: { role: 'user', content: [{ type: 'text', text: 'question' }], timestamp: 0 } };
  const tree = new TreeSelectorComponent([{ entry, children: [] }], 'root', 24, () => {}, () => {});
  tree.handleInput('\u000f'); assert.match(clean(tree), /\[no-tools\]/);
});

const warnings = [
  ['grep', { pattern: 'needle', path: 'src' }, { matchLimitReached: 100 }, /100 matches limit/],
  ['grep', { pattern: 'needle', path: 'src' }, { linesTruncated: true }, /lines truncated/],
  ['find', { pattern: '*.ts', path: 'src' }, { resultLimitReached: 50 }, /50 results limit/],
  ['ls', { path: 'src' }, { entryLimitReached: 20 }, /20 entries limit/],
];
for (const [name, args, details, expected] of warnings) {
  for (const mode of ['codex', 'compact']) {
    test(`${mode} preserves ${name} ${Object.keys(details)[0]} warning`, async (t) => {
      const h = await harness(t); await h.setMode(mode);
      const c = h.tool(name, 'warning', args); c.updateResult(result('sample', details));
      assert.match(clean(c), /truncat/i); assert.match(clean(c), expected);
    });
  }
}

test('limited search is not swallowed by an exploration group', async (t) => {
  const h = await harness(t);
  const calls = [['read', 'first', { path: 'a.txt' }], ['grep', 'limited', { pattern: 'needle', path: 'src' }], ['read', 'last', { path: 'b.txt' }]];
  await h.observe(calls);
  const cs = calls.map(([name, id, args]) => h.tool(name, id, args));
  cs[0].updateResult(result()); cs[1].updateResult(result('sample', { matchLimitReached: 10 })); cs[2].updateResult(result());
  await Promise.resolve();
  assert.match(clean(cs[1]), /10 matches limit/);
  assert.ok(cs.every((c) => !/Explored/.test(clean(c))));
});

test('standard truncation and edit diff counts can both remain visible', async (t) => {
  const h = await harness(t);
  const c = h.tool('edit', 'edit-warning', { path: 'a.txt' });
  c.updateResult(result('changed', { diff: '-old\n+new', truncation: { truncated: true } }));
  assert.match(clean(c), /\+1 -1/); assert.match(clean(c), /truncat/i);
});

for (const [name, args, term] of [
  ['grep', { pattern: 'UNIQUE_SEARCH_TERM', path: 'src' }, 'UNIQUE_SEARCH_TERM'],
  ['find', { pattern: '*.special.ts', path: 'src' }, '*.special.ts'],
  ['symbol_search', { query: 'parse token', path: 'src' }, 'parse token'],
]) {
  test(`${name} summary includes query and directory`, async (t) => {
    const h = await harness(t); const c = h.tool(name, 'query', args); c.updateResult(result());
    assert.ok(clean(c).includes(term)); assert.ok(clean(c).includes('src'));
  });
}

test('mixed search targets keep the query at narrow widths and sanitize controls', async (t) => {
  const h = await harness(t);
  const c = h.tool('grep', 'long-query', { pattern: 'needle\n\u001b[31m', path: `src/${'long-directory/'.repeat(30)}` }); c.updateResult(result());
  const output = clean(c, 45); assert.match(output, /needle/);
  for (const line of c.render(45)) assert.ok(tui.visibleWidth(line) <= 45);
});

for (const mode of ['codex', 'compact', 'full']) {
  test(`${mode} shows image fallback for an unknown tool with images hidden`, async (t) => {
    const h = await harness(t); await h.setMode(mode);
    const c = h.tool('mcp__demo__preview', 'image', { target: 'preview' });
    const payload = { content: [image], details: undefined, isError: false };
    const before = JSON.stringify(payload); c.updateResult(payload);
    assert.match(clean(c), /\[Image:.*image\/png.*1x1/); assert.equal(JSON.stringify(payload), before);
  });
}

test('Full fallback preserves both text and image indicators in unsupported terminals', async (t) => {
  const previous = tui.getCapabilities(); t.after(() => tui.setCapabilities(previous));
  tui.setCapabilities({ ...previous, images: null });
  const h = await harness(t); await h.setMode('full');
  const c = h.tool('mcp__demo__preview', 'mixed', {}, { showImages: true });
  c.updateResult({ content: [{ type: 'text', text: 'TEXT_MARKER' }, image], details: undefined, isError: false });
  assert.match(clean(c), /TEXT_MARKER/); assert.match(clean(c), /\[Image:/);
});

test('inline images remain delegated to core without duplicate placeholders', async (t) => {
  const previous = tui.getCapabilities(); t.after(() => tui.setCapabilities(previous));
  tui.setCapabilities({ ...previous, images: 'kitty' });
  const h = await harness(t); const c = h.tool('read', 'inline', { path: 'pixel.png' }, { showImages: true });
  c.updateResult({ content: [image], details: undefined, isError: false });
  assert.equal(c.imageComponents.length, 1);
  assert.doesNotMatch(tui.stripTerminalSequences(c.selfRenderContainer.render(100).join('\n')), /\[Image:/);
});

for (const mode of ['codex', 'compact']) {
  test(`native shell timer is cleared when completed after Full -> ${mode}`, async (t) => {
    const active = trackTimers(t); const h = await harness(t); await h.setMode('full');
    const c = h.tool('bash', 'timer', { command: 'node --test' }); c.updateResult(result('working'), true);
    assert.equal(active.size, 1);
    await h.setMode(mode); c.updateResult(result('done')); await Promise.resolve();
    assert.equal(active.size, 0);
  });
}

for (const event of ['session_tree', 'session_shutdown']) {
  test(`${event} releases pending native renderer resources`, async (t) => {
    const active = trackTimers(t); const h = await harness(t); await h.setMode('full');
    const c = h.tool('powershell', 'pending', { command: 'Write-Output test' }); c.updateResult(result('working'), true);
    assert.equal(active.size, 1); await h.setMode('codex');
    await h.runner.emit({ type: event }); assert.equal(active.size, 0);
  });
}

test('default Codex rendering starts only the activity pulse, never a hidden native timer', async (t) => {
  const active = trackTimers(t); const h = await harness(t);
  const c = h.tool('bash', 'hidden', { command: 'node --test' }); c.updateResult(result('working'), true);
  assert.equal(active.size, 1); c.updateResult(result('done')); assert.equal(active.size, 0);
});

for (const name of ['mcp__demo__inspect', 'powershell']) {
  test(`HTML ${name} call header is neutral, not permanently running`, async (t) => {
    const h = await harness(t); const html = h.html();
    const call = html.renderCall('static-call', name, { path: 'sample.txt', command: 'Write-Output test' });
    assert.ok(call); assert.doesNotMatch(call, /Calling|Reading|Searching|Running/);
    const rendered = html.renderResult('static-call', name, [{ type: 'text', text: 'DONE_MARKER' }], undefined, false);
    assert.match(rendered.expanded, /DONE_MARKER/);
  });
}

test('HTML rendering preserves error results and does not alter live progress', async (t) => {
  const h = await harness(t); const c = h.tool('grep', 'same-id', { pattern: 'needle', path: 'src' });
  c.updateResult(result('working'), true); assert.match(clean(c), /Searching/);
  const html = h.html(); html.renderCall('same-id', 'grep', { pattern: 'needle', path: 'src' });
  const rendered = html.renderResult('same-id', 'grep', [{ type: 'text', text: 'Error: HISTORY_ERROR' }], undefined, true);
  assert.match(rendered.expanded, /HISTORY_ERROR/); assert.match(clean(c), /Searching/);
  c.updateResult(result('done')); assert.match(clean(c), /Searched/);
});

test('successful exploration grouping, local expansion, and errors still work', async (t) => {
  const h = await harness(t);
  const calls = [['read', 'a', { path: 'a.txt' }], ['read', 'b', { path: 'b.txt' }], ['read', 'c', { path: 'c.txt' }]];
  await h.observe(calls); const cs = calls.map(([name, id, args]) => h.tool(name, id, args));
  cs.forEach((c) => c.updateResult(result())); await Promise.resolve();
  assert.match(clean(cs[0]), /Explored.*3 reads/); assert.equal(clean(cs[1]), '');
  cs[0].setExpanded(true); assert.match(clean(cs[0]), /c\.txt/);
  cs[1].updateResult({ ...result('Error: failed'), isError: true }); assert.match(clean(cs[1]), /Error: failed/);
});

test('pending Codex calls stay pending and fit narrow/wide-character layouts', async (t) => {
  const h = await harness(t); const c = h.tool('read', 'wide', { path: '\u9879\u76ee/\u6587\u4ef6.txt' });
  assert.match(clean(c), /Reading/); c.updateResult(result()); assert.match(clean(c), /Read/);
  for (const width of [1, 2, 5, 10, 40, 100]) for (const line of c.render(width)) assert.ok(tui.visibleWidth(line) <= width);
});

test('non-TUI command handlers stay inert', async (t) => {
  for (const mode of ['print', 'json', 'rpc']) {
    const h = await harness(t, mode); await h.setMode('full');
    assert.equal(h.state.expanded, false); assert.deepEqual(h.state.notifications, []);
  }
});

const adapterCases = [
  ['effective_config', { file: 'src/UNIQUE_CONFIG.ts' }, ['UNIQUE_CONFIG.ts']],
  ['get_goal', { section: 'tasks', task_id: 'task-123' }, ['tasks', 'task-123']],
  ['get_goal', {}, ['summary']],
  ['get_search_content', { responseId: 'response-123', urlIndex: 0, offset: 100, limit: 50 }, ['response-123', 'url[0]', 'offset 100', 'limit 50']],
  ['get_search_content', { responseId: 'response-123', queryIndex: 0, findText: 'needle', offset: 100 }, ['response-123', 'query[0]', 'find', 'needle']],
  ['subagent', { agent: 'reviewer', task: 'Review parser', async: true }, ['reviewer', 'Review parser', 'async']],
  ['subagent', { action: 'status', id: 'run-123', options: { view: 'transcript', index: 0 } }, ['status', 'run-123', 'transcript', 'child[0]']],
  ['subagent', { workflow: 'workflows/audit.mjs', async: true }, ['workflow', 'audit.mjs', 'async']],
  ['subagent', { workflow: true }, ['workflow', 'reply block']],
  ['subagent', { tasks: [{ agent: 'scout', task: 'Inspect' }, { agent: 'reviewer', task: 'Review' }] }, ['parallel', 'scout', 'reviewer']],
  ['subagent', { chain: [{ agent: 'scout' }, { parallel: [{ agent: 'reviewer' }, { agent: 'tester' }] }] }, ['chain', 'scout', '2 parallel']],
];
for (const [index, [name, args, expected]] of adapterCases.entries()) {
  for (const mode of ['codex', 'compact']) {
    test(`${mode} parameter adapter ${index + 1}: ${name}`, async (t) => {
      const h = await harness(t); await h.setMode(mode);
      const c = h.tool(name, 'adapter', args); c.updateResult(result());
      const output = clean(c);
      for (const text of expected) assert.ok(output.includes(text), `${text} missing from ${output}`);
      if (args.findText) assert.doesNotMatch(output, /offset 100/); // The API ignores offset in find mode.
    });
  }
}

test('retrieval adapter sanitizes controls and keeps raw arguments in Full', async (t) => {
  const h = await harness(t);
  const args = { responseId: 'response-123', url: 'https://user:password@example.com/page?secret=hidden', findText: ['needle\n\u001b[31m', 'other'] };
  const c = h.tool('get_search_content', 'retrieval', args); c.updateResult(result('RAW_CONTENT'));
  const output = clean(c); assert.match(output, /needle.*other/); assert.match(output, /example\.com\/page/);
  assert.doesNotMatch(output, /password|secret=hidden/);
  await h.setMode('full'); assert.match(clean(c), /RAW_CONTENT/); assert.match(clean(c), /secret=hidden/);
});

for (const mode of ['codex', 'compact']) {
  test(`${mode} preserves a web tool's top-level truncated flag`, async (t) => {
    const h = await harness(t); await h.setMode(mode);
    const c = h.tool('fetch_content', 'flat-truncation', { url: 'https://example.com/large' });
    c.updateResult(result('partial page', { truncated: true, responseId: 'response-123', urlCount: 1, successful: 1 }));
    assert.match(clean(c), /truncat/i);
  });
}

test('truncated web results stay outside successful exploration groups', async (t) => {
  const h = await harness(t);
  const calls = [['fetch_content', 'truncated-page', { url: 'https://example.com/large' }], ['read', 'local-read', { path: 'a.txt' }]];
  await h.observe(calls); const cs = calls.map(([name, id, args]) => h.tool(name, id, args));
  cs[0].updateResult(result('partial page', { truncated: true })); cs[1].updateResult(result()); await Promise.resolve();
  assert.match(clean(cs[0]), /truncat/i); assert.match(clean(cs[1]), /Read a\.txt/);
  assert.ok(cs.every((c) => !/Explored/.test(clean(c))));
});

for (const [name, details, expected] of [
  ['fetch_content', { urlCount: 2, successful: 1 }, /1\/2 URLs succeeded/],
  ['web_search', { queryCount: 3, successfulQueries: 2 }, /2\/3 queries succeeded/],
]) {
  test(`${name} preserves partial-success diagnostics`, async (t) => {
    const h = await harness(t); const c = h.tool(name, 'partial-success', { query: 'sample', url: 'https://example.com' });
    c.updateResult(result('some operations failed', details)); assert.match(clean(c), expected);
  });
}

test('false truncation flags and fully successful batches do not produce warnings', async (t) => {
  const h = await harness(t); const c = h.tool('fetch_content', 'complete-page', { url: 'https://example.com' });
  c.updateResult(result('page', { truncated: false, urlCount: 2, successful: 2 }));
  assert.doesNotMatch(clean(c), /truncat|Partial|succeeded/);
});

for (const phase of ['curator-fallback', 'waiting-for-approval', 'curating']) {
  for (const mode of ['codex', 'compact']) {
    test(`${mode} retains ${phase} instructions and the actionable review URL`, async (t) => {
      const h = await harness(t); await h.setMode(mode);
      let nativeCalls = 0;
      const native = { renderResult: () => { nativeCalls++; return new tui.Text('NATIVE_DETAILS', 0, 0); } };
      const c = h.tool('web_search', 'approval', { query: 'sample' }, { native });
      const url = 'http://127.0.0.1:43210/review?token=sample';
      c.updateResult(result('original partial result', { phase, curatorUrl: url, browserOpenError: 'auto-open failed\n\u001b[31m', timeoutSeconds: 300 }), true);
      const output = clean(c); assert.match(output, /approval|manually/i); assert.ok(output.includes(url));
      assert.equal(nativeCalls, 0); // Do not open a whole native card or start its timers just for a notice.
      for (const width of [1, 5, 20, 60]) for (const line of c.render(width)) assert.ok(tui.visibleWidth(line) <= width);
      c.updateResult(result('finished', { phase, curatorUrl: url }));
      assert.doesNotMatch(clean(c), /43210|approval|manually/i);
      assert.equal(h.state.statuses.has('tool-glance'), false);
    });
  }
}

test('approval notices reject unsafe URL schemes and disappear on final failure', async (t) => {
  const h = await harness(t); const c = h.tool('web_search', 'unsafe-review', { query: 'sample' });
  c.updateResult(result('pending', { phase: 'curator-fallback', curatorUrl: 'javascript:alert(1)' }), true);
  assert.match(clean(c), /manually/i); assert.doesNotMatch(clean(c), /javascript|alert/);
  c.updateResult({ ...result('Error: cancelled', { phase: 'curator-fallback', curatorUrl: 'http://127.0.0.1:1234' }), isError: true });
  assert.match(clean(c), /Error: cancelled/); assert.doesNotMatch(clean(c), /manually|1234/);
});

for (const mode of ['codex', 'compact']) {
  test(`${mode} retains a brief native subagent state and run identity`, async (t) => {
    const h = await harness(t); await h.setMode(mode);
    const native = { renderResult: (r) => new tui.Text(`reviewer · ${r.details.nativeState}\nNATIVE_BODY_MARKER`, 0, 0) };
    const c = h.tool('subagent', 'native-agent', { agent: 'reviewer', task: 'Review parser', async: true }, { native });
    c.updateResult(result('started', { mode: 'single', asyncId: 'run-123', results: [], nativeState: 'running' }));
    assert.match(clean(c), /running/); assert.match(clean(c), /run-123/); assert.doesNotMatch(clean(c), /NATIVE_BODY_MARKER/);
    c.updateResult(result('finished', { mode: 'single', asyncId: 'run-123', results: [{ exitCode: 0 }], nativeState: 'completed' }));
    assert.match(clean(c), /completed/); assert.doesNotMatch(clean(c), /running/);
    await h.setMode('full'); assert.match(clean(c), /NATIVE_BODY_MARKER/);
  });
}

test('subagent state has a conservative fallback when no native renderer exists', async (t) => {
  const h = await harness(t); const c = h.tool('subagent', 'fallback-agent', { agent: 'reviewer', task: 'Review parser' });
  const payload = result('started', { mode: 'single', asyncId: 'run-123', results: [] });
  const before = JSON.stringify(payload); c.updateResult(payload);
  assert.match(clean(c), /running/); assert.match(clean(c), /run-123/); assert.equal(JSON.stringify(payload), before);
  c.updateResult(result('finished', { mode: 'single', asyncId: 'run-123', results: [{ exitCode: 0 }] }));
  assert.match(clean(c), /run-123/); assert.doesNotMatch(clean(c), /running/);
});

test('brief native subagent status retains image fallbacks and renderer cleanup', async (t) => {
  const active = trackTimers(t); const h = await harness(t);
  const native = { renderResult: (r, o, theme, context) => {
    if (o.isPartial && !context.state.timer) context.state.timer = setInterval(() => {}, 1000);
    if (!o.isPartial && context.state.timer) { clearInterval(context.state.timer); context.state.timer = undefined; }
    return new tui.Text('reviewer · running\nHIDDEN_NATIVE_BODY', 0, 0);
  } };
  const c = h.tool('subagent', 'agent-resources', { agent: 'reviewer' }, { native });
  c.updateResult({ content: [image], details: { mode: 'single', asyncId: 'run-123', results: [] }, isError: false }, true);
  assert.match(clean(c), /running/); assert.match(clean(c), /\[Image:/); assert.doesNotMatch(clean(c), /HIDDEN_NATIVE_BODY/);
  // The native timer and the activity pulse both run while the call is pending.
  assert.equal(active.size, 2); await h.runner.emit({ type: 'session_shutdown' }); assert.equal(active.size, 0);
});

// v4: a run spans assistant messages of one turn and also covers shell commands.

async function emitEnd(h, content, role = 'assistant') {
  await h.runner.emit({ type: 'message_end', message: { role, content } });
}
const call = (id, name, args) => ({ type: 'toolCall', name, id, arguments: args });
const prose = (text) => ({ type: 'text', text });

test('v4 merges a command burst inside one message', async (t) => {
  const h = await harness(t);
  const calls = [
    ['bash', 'run-1', { command: 'npm test' }],
    ['bash', 'run-2', { command: 'uv run check.py' }],
    ['powershell', 'run-3', { command: 'git status' }],
    ['bash', 'run-4', { command: 'npm run build' }],
  ];
  await h.observe(calls);
  const cs = calls.map(([name, id, args]) => h.tool(name, id, args));
  cs.forEach((c) => c.updateResult(result()));
  await Promise.resolve();
  const header = clean(cs[0]);
  assert.match(header, /Ran\s+4 commands/);
  assert.match(header, /npm test, uv run/);
  for (const c of cs.slice(1)) assert.equal(clean(c), '');
});

test('v4 merges commands across assistant messages of the same turn', async (t) => {
  const h = await harness(t);
  await emitEnd(h, [call('cross-1', 'bash', { command: 'npm run build' })]);
  const first = h.tool('bash', 'cross-1', { command: 'npm run build' }); first.updateResult(result());
  await emitEnd(h, [call('cross-2', 'bash', { command: 'npm run lint' })]);
  const second = h.tool('bash', 'cross-2', { command: 'npm run lint' }); second.updateResult(result());
  await emitEnd(h, [call('cross-3', 'bash', { command: 'npm run test' })]);
  const third = h.tool('bash', 'cross-3', { command: 'npm run test' }); third.updateResult(result());
  await Promise.resolve();
  assert.match(clean(first), /Ran\s+3 commands/);
  assert.equal(clean(second), ''); assert.equal(clean(third), '');
});

test('v4 prose, user messages, mutations, and unknown tools close a run', async (t) => {
  const h = await harness(t);
  const cases = [
    ['prose', [call('bar-1', 'bash', { command: 'npm test' })], [prose('Now I will lint.'), call('bar-2', 'bash', { command: 'npm run lint' })]],
    ['mutation', [call('bar-3', 'bash', { command: 'npm test' })], [call('bar-4', 'edit', { path: 'a.txt' })]],
    ['unknown', [call('bar-5', 'bash', { command: 'npm test' })], [call('bar-6', 'mcp__demo__inspect', { target: 'x' })]],
  ];
  for (const [label, firstCalls, secondCalls] of cases) {
    await emitEnd(h, firstCalls);
    const before = h.tool(firstCalls[0].name, firstCalls[0].id, firstCalls[0].arguments); before.updateResult(result());
    await emitEnd(h, secondCalls);
    const after = secondCalls.map((block) => {
      const c = h.tool(block.name, block.id, block.arguments); c.updateResult(result()); return c;
    });
    await Promise.resolve();
    assert.doesNotMatch(clean(before), /2 commands|Worked/, label);
    assert.ok(after.some((c) => clean(c).trim() !== ''), label);
    await emitEnd(h, [], 'user');
  }
  await emitEnd(h, [call('bar-7', 'bash', { command: 'npm test' })]);
  const split = h.tool('bash', 'bar-7', { command: 'npm test' }); split.updateResult(result());
  await emitEnd(h, [], 'user');
  await emitEnd(h, [call('bar-8', 'bash', { command: 'npm run lint' })]);
  const nextTurn = h.tool('bash', 'bar-8', { command: 'npm run lint' }); nextTurn.updateResult(result());
  await Promise.resolve();
  assert.match(clean(split), /Ran npm test/); assert.match(clean(nextTurn), /Ran npm run lint/);
});

test('v4 running calls stay visible, merge once done, and errors split out', async (t) => {
  const h = await harness(t);
  await h.observe([['bash', 'live-1', { command: 'npm test' }], ['bash', 'live-2', { command: 'npm run build' }]]);
  const first = h.tool('bash', 'live-1', { command: 'npm test' });
  const second = h.tool('bash', 'live-2', { command: 'npm run build' });
  first.updateResult(result('working'), true); second.updateResult(result('working'), true);
  await Promise.resolve();
  assert.match(clean(first), /Running npm test/); assert.match(clean(second), /Running npm run build/);
  first.updateResult(result()); second.updateResult(result());
  await Promise.resolve();
  assert.match(clean(first), /Ran\s+2 commands/); assert.equal(clean(second), '');
  await emitEnd(h, [], 'user');
  await h.observe([['bash', 'err-1', { command: 'npm test' }], ['bash', 'err-2', { command: 'npm run build' }]]);
  const ok = h.tool('bash', 'err-1', { command: 'npm test' });
  const bad = h.tool('bash', 'err-2', { command: 'npm run build' });
  ok.updateResult(result()); bad.updateResult({ ...result('BUILD_FAILED'), isError: true });
  await Promise.resolve();
  assert.match(clean(ok), /Ran npm test/); assert.doesNotMatch(clean(ok), /2 commands/);
  assert.match(clean(bad), /BUILD_FAILED/);
});

test('v4 mixed exploration and commands are reported as work', async (t) => {
  const h = await harness(t);
  await h.observe([['read', 'mix-1', { path: 'a.txt' }], ['bash', 'mix-2', { command: 'npm test' }], ['grep', 'mix-3', { pattern: 'needle', path: 'src' }]]);
  const cs = [['read', 'mix-1', { path: 'a.txt' }], ['bash', 'mix-2', { command: 'npm test' }], ['grep', 'mix-3', { pattern: 'needle', path: 'src' }]]
    .map(([name, id, args]) => h.tool(name, id, args));
  cs.forEach((c) => c.updateResult(result()));
  await Promise.resolve();
  const header = clean(cs[0]);
  assert.match(header, /Worked\s+1 read/); assert.match(header, /1 command/); assert.match(header, /1 search/);
  assert.ok(cs.slice(1).every((c) => clean(c) === ''));
});

// Codex fidelity: pulsing activity marker, green success, red failure.

test('codex markers pulse while running and settle green or red', async (t) => {
  const h = await harness(t); const theme = themeModule.theme;
  const c = h.tool('bash', 'pulse', { command: 'npm test' });
  const now = Date.now; t.after(() => { Date.now = now; });
  Date.now = () => 0;
  const bright = c.render(80).join('\n');
  Date.now = () => 1000;
  const faint = c.render(80).join('\n');
  assert.notEqual(bright, faint); // True color pulses brightness; 256 color blinks •/◦.
  const glyph = tui.stripTerminalSequences(faint).trim().slice(0, 1);
  assert.ok(glyph === '•' || glyph === '◦', glyph);
  c.updateResult(result());
  assert.ok(c.render(80).join('\n').includes(theme.fg('success', theme.bold('•'))));
  const bad = h.tool('bash', 'fails', { command: 'npm run build' });
  bad.updateResult({ ...result('BUILD_FAILED'), isError: true });
  assert.ok(bad.render(80).join('\n').includes(theme.fg('error', theme.bold('•'))));
});

test('the activity pulse stops when work finishes or the session resets', async (t) => {
  const active = trackTimers(t); const h = await harness(t);
  const c = h.tool('bash', 'pulse-timer', { command: 'npm test' });
  c.render(80);
  assert.equal(active.size, 1);
  c.updateResult(result());
  await Promise.resolve();
  assert.equal(active.size, 0);
  const pending = h.tool('bash', 'pulse-reset', { command: 'npm test' });
  pending.render(80);
  assert.equal(active.size, 1);
  await h.runner.emit({ type: 'session_shutdown' });
  assert.equal(active.size, 0);
});
