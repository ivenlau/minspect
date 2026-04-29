import type { Event, GitState } from '@minspect/core';
import { describe, expect, it } from 'vitest';
import { extractAstNodes } from './ast.js';
import { Store } from './store.js';

const git: GitState = { branch: 'main', head: 'a', dirty: false };

describe('extractAstNodes', () => {
  it('extracts top-level functions from TS', () => {
    const code = [
      'export function foo() {',
      '  return 1;',
      '}',
      '',
      'function bar(x: number) {',
      '  return x + 1;',
      '}',
    ].join('\n');
    const nodes = extractAstNodes('a.ts', code);
    expect(
      nodes
        .map((n) => n.qualified_name)
        .filter(Boolean)
        .sort(),
    ).toEqual(['bar', 'foo']);
  });

  it('extracts arrow-const as function', () => {
    const code = ['export const add = (a: number, b: number) => {', '  return a + b;', '};'].join(
      '\n',
    );
    const nodes = extractAstNodes('a.ts', code);
    expect(nodes[0]?.qualified_name).toBe('add');
    expect(nodes[0]?.kind).toBe('function');
  });

  it('extracts class + methods with qualified names', () => {
    const code = [
      'export class Greeter {',
      '  greet(name: string) {',
      '    return "hi " + name;',
      '  }',
      '  say() { return 1 }',
      '}',
    ].join('\n');
    const nodes = extractAstNodes('a.ts', code);
    const qualified = nodes.map((n) => n.qualified_name).filter(Boolean);
    expect(qualified).toContain('Greeter');
    expect(qualified).toContain('Greeter.greet');
    expect(qualified).toContain('Greeter.say');
  });

  it('falls back to whole-file node for unsupported extensions', () => {
    const nodes = extractAstNodes('README.md', '# Hello\nWorld\n');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.kind).toBe('file');
  });

  it('falls back to whole-file when no top-level nodes found', () => {
    const nodes = extractAstNodes('a.ts', 'const x = 1;\nconsole.log(x);\n');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.kind).toBe('file');
  });

  // ─── cross-language coverage (tree-sitter) ───────────────────────────────

  it('Python: function + class with methods', () => {
    const code = [
      'def foo():',
      '    return 1',
      '',
      'class Bar:',
      '    def method(self):',
      '        return 2',
      '    def other(self, x):',
      '        return x',
    ].join('\n');
    const nodes = extractAstNodes('a.py', code);
    const qualified = nodes.map((n) => n.qualified_name);
    expect(qualified).toContain('foo');
    expect(qualified).toContain('Bar');
    expect(qualified).toContain('Bar.method');
    expect(qualified).toContain('Bar.other');
  });

  it('Go: function + method on struct', () => {
    const code = [
      'package main',
      '',
      'func Foo() int { return 1 }',
      '',
      'type X struct { n int }',
      '',
      'func (x *X) Bar() int { return x.n }',
    ].join('\n');
    const nodes = extractAstNodes('a.go', code);
    const qualified = nodes.map((n) => n.qualified_name);
    expect(qualified).toContain('Foo');
    // Go methods show up as method nodes with their own name; exact qualified
    // form depends on grammar's field layout — be permissive.
    expect(qualified.some((n) => n === 'Bar' || n === 'X.Bar')).toBe(true);
  });

  it('Rust: fn + impl with nested fn', () => {
    const code = [
      'fn free_fn() -> i32 { 1 }',
      '',
      'struct S;',
      '',
      'impl S {',
      '    fn method(&self) -> i32 { 2 }',
      '}',
    ].join('\n');
    const nodes = extractAstNodes('a.rs', code);
    const qualified = nodes.map((n) => n.qualified_name);
    expect(qualified).toContain('free_fn');
    // Rust impl-nested function: should qualify with the impl type.
    expect(qualified).toContain('S.method');
  });

  it('Java: class with methods', () => {
    const code = [
      'public class Foo {',
      '  public int bar() { return 1; }',
      '  public String greet(String n) { return "hi " + n; }',
      '}',
    ].join('\n');
    const nodes = extractAstNodes('A.java', code);
    const qualified = nodes.map((n) => n.qualified_name);
    expect(qualified).toContain('Foo');
    expect(qualified).toContain('Foo.bar');
    expect(qualified).toContain('Foo.greet');
  });

  it('skips huge files (>1MB) with whole-file fallback', () => {
    // 1.5 MB of TS — above MAX_BYTES guard
    const big = 'function x() {}\n'.repeat(100_000); // ~1.6 MB
    const nodes = extractAstNodes('big.ts', big);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.kind).toBe('file');
  });
});

describe('updateAstForEdit (via Store)', () => {
  it('populates ast_nodes and edit_ast_impact based on line overlap', () => {
    const store = new Store(':memory:');
    store.ingest({
      type: 'session_start',
      session_id: 's',
      agent: 'claude-code',
      workspace: '/ws',
      git,
      timestamp: 1,
    });
    store.ingest({
      type: 'turn_start',
      session_id: 's',
      turn_id: 't1',
      idx: 0,
      user_prompt: 'edit',
      git,
      timestamp: 2,
    });
    const beforeCode = [
      'function foo() {',
      '  return 1;',
      '}',
      '',
      'function bar() {',
      '  return 2;',
      '}',
    ].join('\n');
    const afterCode = [
      'function foo() {',
      '  return 1;',
      '}',
      '',
      'function bar() {',
      '  return 3;', // changed line
      '}',
    ].join('\n');
    store.ingest({
      type: 'tool_call',
      session_id: 's',
      turn_id: 't1',
      tool_call_id: 'tc1',
      idx: 0,
      tool_name: 'Edit',
      input: {},
      status: 'ok',
      file_edits: [{ file_path: 'src/a.ts', before_content: beforeCode, after_content: afterCode }],
      started_at: 10,
      ended_at: 11,
    } satisfies Event);

    const nodes = store.db
      .prepare(
        "SELECT qualified_name, kind FROM ast_nodes WHERE file_path = 'src/a.ts' ORDER BY qualified_name",
      )
      .all() as Array<{ qualified_name: string; kind: string }>;
    expect(nodes.map((n) => n.qualified_name).sort()).toEqual(['bar', 'foo']);

    // Impact should include only bar (the edit touched its range).
    const impact = store.db
      .prepare(
        `SELECT a.qualified_name
         FROM edit_ast_impact i
         JOIN ast_nodes a ON a.id = i.ast_node_id
         WHERE i.edit_id = 'tc1:0'`,
      )
      .all() as Array<{ qualified_name: string }>;
    expect(impact.map((r) => r.qualified_name)).toEqual(['bar']);

    store.close();
  });

  it('re-running a second edit re-computes ast_nodes (no duplicates)', () => {
    const store = new Store(':memory:');
    store.ingest({
      type: 'session_start',
      session_id: 's',
      agent: 'claude-code',
      workspace: '/ws',
      git,
      timestamp: 1,
    });
    store.ingest({
      type: 'turn_start',
      session_id: 's',
      turn_id: 't1',
      idx: 0,
      user_prompt: 'x',
      git,
      timestamp: 2,
    });
    const seed = (tc: string, content: string, t: number): Event => ({
      type: 'tool_call',
      session_id: 's',
      turn_id: 't1',
      tool_call_id: tc,
      idx: t,
      tool_name: 'Edit',
      input: {},
      status: 'ok',
      file_edits: [{ file_path: 'a.ts', before_content: null, after_content: content }],
      started_at: t,
      ended_at: t + 1,
    });
    store.ingest(seed('tc1', 'function foo() {\n  return 1;\n}', 10));
    // now add a second function via a fresh edit
    store.ingest({
      type: 'tool_call',
      session_id: 's',
      turn_id: 't1',
      tool_call_id: 'tc2',
      idx: 1,
      tool_name: 'Edit',
      input: {},
      status: 'ok',
      file_edits: [
        {
          file_path: 'a.ts',
          before_content: 'function foo() {\n  return 1;\n}',
          after_content: 'function foo() {\n  return 1;\n}\nfunction bar() {\n  return 2;\n}',
        },
      ],
      started_at: 11,
      ended_at: 12,
    });

    const nodes = store.db
      .prepare(
        "SELECT qualified_name FROM ast_nodes WHERE file_path = 'a.ts' ORDER BY qualified_name",
      )
      .all() as Array<{ qualified_name: string }>;
    expect(nodes.map((n) => n.qualified_name).sort()).toEqual(['bar', 'foo']);
    store.close();
  });
});
