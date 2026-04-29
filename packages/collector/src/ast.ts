import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { extname } from 'node:path';
import type { Store } from './store.js';

// Use createRequire so native tree-sitter grammar modules load through Node's
// CJS resolver, which is the expected path for native bindings.
const req = createRequire(import.meta.url);

export interface AstNodeRow {
  id: string;
  workspace_id: string;
  file_path: string;
  kind: 'function' | 'method' | 'class' | 'file';
  qualified_name: string | null;
  start_line: number;
  end_line: number;
  last_computed_at: number;
}

export type ExtractedAstNode = Omit<
  AstNodeRow,
  'id' | 'workspace_id' | 'file_path' | 'last_computed_at'
>;

// Per-language tree-sitter node-type configuration. `classTypes` push to a
// name stack so nested functions/methods can be qualified. `methodTypes` are
// treated as methods iff inside a class; `functionTypes` always standalone.
interface LangConfig {
  module: string; // npm package name
  grammarPath?: string[]; // some packages nest multiple grammars (tree-sitter-typescript)
  classTypes: Set<string>;
  classNameField?: string; // field name for class; defaults to nameField
  functionTypes: Set<string>;
  methodTypes: Set<string>;
  nameField: string;
}

const TS_LANG: LangConfig = {
  module: 'tree-sitter-typescript',
  grammarPath: ['typescript'],
  classTypes: new Set(['class_declaration']),
  functionTypes: new Set(['function_declaration']),
  methodTypes: new Set(['method_definition']),
  nameField: 'name',
};

const TSX_LANG: LangConfig = { ...TS_LANG, grammarPath: ['tsx'] };

const JS_LANG: LangConfig = {
  module: 'tree-sitter-javascript',
  classTypes: new Set(['class_declaration']),
  functionTypes: new Set(['function_declaration']),
  methodTypes: new Set(['method_definition']),
  nameField: 'name',
};

const PY_LANG: LangConfig = {
  module: 'tree-sitter-python',
  classTypes: new Set(['class_definition']),
  functionTypes: new Set(['function_definition']),
  methodTypes: new Set(['function_definition']),
  nameField: 'name',
};

const GO_LANG: LangConfig = {
  module: 'tree-sitter-go',
  // Go has no "class" — struct defined via type_declaration; methods carry
  // receiver separately via method_declaration.
  classTypes: new Set(),
  functionTypes: new Set(['function_declaration', 'method_declaration']),
  methodTypes: new Set(),
  nameField: 'name',
};

const RS_LANG: LangConfig = {
  module: 'tree-sitter-rust',
  classTypes: new Set(['impl_item']),
  classNameField: 'type',
  functionTypes: new Set(['function_item']),
  methodTypes: new Set(['function_item']),
  nameField: 'name',
};

const JAVA_LANG: LangConfig = {
  module: 'tree-sitter-java',
  classTypes: new Set(['class_declaration', 'interface_declaration']),
  functionTypes: new Set(),
  methodTypes: new Set(['method_declaration', 'constructor_declaration']),
  nameField: 'name',
};

const EXT_MAP: Record<string, LangConfig> = {
  '.ts': TS_LANG,
  '.mts': TS_LANG,
  '.cts': TS_LANG,
  '.tsx': TSX_LANG,
  '.js': JS_LANG,
  '.mjs': JS_LANG,
  '.cjs': JS_LANG,
  '.jsx': JS_LANG,
  '.py': PY_LANG,
  '.pyi': PY_LANG,
  '.go': GO_LANG,
  '.rs': RS_LANG,
  '.java': JAVA_LANG,
};

const MAX_BYTES = 1024 * 1024; // 1MB guard

// Cache: grammar key → Parser instance (or null sentinel if init failed).
const parserCache = new Map<string, unknown | null>();

function getParser(cfg: LangConfig): unknown | null {
  const cacheKey = `${cfg.module}:${cfg.grammarPath?.join('.') ?? ''}`;
  if (parserCache.has(cacheKey)) return parserCache.get(cacheKey) ?? null;
  try {
    const Parser = req('tree-sitter');
    let grammar: unknown = req(cfg.module);
    for (const seg of cfg.grammarPath ?? []) {
      grammar = (grammar as Record<string, unknown>)[seg];
    }
    const parser = new (Parser as new () => { setLanguage: (l: unknown) => void })();
    parser.setLanguage(grammar);
    parserCache.set(cacheKey, parser);
    return parser;
  } catch {
    parserCache.set(cacheKey, null);
    return null;
  }
}

// Minimal structural interface from tree-sitter's Node.
interface TsNode {
  type: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: TsNode[];
  childForFieldName?: (name: string) => TsNode | null;
  text: string;
}

interface TsParser {
  parse(source: string): { rootNode: TsNode };
}

export function extractAstNodes(
  filePath: string,
  content: string,
  _now: number = Date.now(),
): ExtractedAstNode[] {
  const ext = extname(filePath).toLowerCase();
  const cfg = EXT_MAP[ext];
  if (!cfg) return [fileFallback(content)];
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) return [fileFallback(content)];

  const parser = getParser(cfg) as TsParser | null;
  if (!parser) return [fileFallback(content)];

  let tree: { rootNode: TsNode };
  try {
    tree = parser.parse(content);
  } catch {
    return [fileFallback(content)];
  }

  const out: ExtractedAstNode[] = [];
  walk(tree.rootNode, cfg, [], out);
  if (out.length === 0) return [fileFallback(content)];
  return out;
}

function nameOf(node: TsNode, field: string): string | null {
  const named = node.childForFieldName?.(field);
  if (named) return named.text;
  // Fallback: first identifier-like child.
  for (const child of node.children) {
    if (
      child.type === 'identifier' ||
      child.type === 'type_identifier' ||
      child.type === 'property_identifier'
    ) {
      return child.text;
    }
  }
  return null;
}

function rangeOf(node: TsNode): { start_line: number; end_line: number } {
  return {
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
  };
}

function walk(node: TsNode, cfg: LangConfig, classStack: string[], out: ExtractedAstNode[]): void {
  if (cfg.classTypes.has(node.type)) {
    const field = cfg.classNameField ?? cfg.nameField;
    const name = nameOf(node, field) ?? '(anonymous)';
    out.push({ kind: 'class', qualified_name: name, ...rangeOf(node) });
    classStack.push(name);
    for (const child of node.children) walk(child, cfg, classStack, out);
    classStack.pop();
    return;
  }
  if (cfg.methodTypes.has(node.type) && classStack.length > 0) {
    const name = nameOf(node, cfg.nameField) ?? '(anonymous)';
    const qn = `${classStack[classStack.length - 1]}.${name}`;
    out.push({ kind: 'method', qualified_name: qn, ...rangeOf(node) });
    return;
  }
  if (cfg.functionTypes.has(node.type)) {
    const name = nameOf(node, cfg.nameField);
    if (name) {
      out.push({ kind: 'function', qualified_name: name, ...rangeOf(node) });
    }
    return;
  }
  // Special case for JS/TS: top-level `const foo = (…) => {…}` / `function(…)`.
  // Tree-sitter exposes this as `variable_declarator { name, value }` where
  // value is `arrow_function` | `function_expression`. Only catch it when
  // we're not nested in another function body (classStack empty suffices for
  // our purposes here).
  if (node.type === 'variable_declarator') {
    const name = nameOf(node, 'name');
    const value = node.childForFieldName?.('value');
    if (
      name &&
      value &&
      (value.type === 'arrow_function' || value.type === 'function_expression')
    ) {
      out.push({ kind: 'function', qualified_name: name, ...rangeOf(node) });
      return;
    }
  }
  for (const child of node.children) walk(child, cfg, classStack, out);
}

function fileFallback(content: string): ExtractedAstNode {
  const lines = content === '' ? 1 : content.split('\n').length;
  return {
    kind: 'file',
    qualified_name: null,
    start_line: 1,
    end_line: lines,
  };
}

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

// Replace ast_nodes and edit_ast_impact for a file, computing impact based on
// line-range overlap with the edit's hunks.
export function updateAstForEdit(
  store: Store,
  args: {
    edit_id: string;
    workspace_id: string;
    file_path: string;
    after_content: string;
  },
): void {
  const now = Date.now();
  const nodes = extractAstNodes(args.file_path, args.after_content, now);

  store.db
    .prepare('DELETE FROM ast_nodes WHERE workspace_id = ? AND file_path = ?')
    .run(args.workspace_id, args.file_path);
  const insertNode = store.db.prepare(
    `INSERT INTO ast_nodes (id, workspace_id, file_path, kind, qualified_name, start_line, end_line, last_computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const nodeRows: AstNodeRow[] = nodes.map((n, i) => ({
    id: `${args.workspace_id}:${args.file_path}:${i}:${sha(n.qualified_name ?? `${n.kind}-${i}`)}`,
    workspace_id: args.workspace_id,
    file_path: args.file_path,
    kind: n.kind,
    qualified_name: n.qualified_name,
    start_line: n.start_line,
    end_line: n.end_line,
    last_computed_at: now,
  }));
  for (const n of nodeRows)
    insertNode.run(
      n.id,
      n.workspace_id,
      n.file_path,
      n.kind,
      n.qualified_name,
      n.start_line,
      n.end_line,
      n.last_computed_at,
    );

  const hunks = store.db
    .prepare('SELECT new_start, new_count FROM hunks WHERE edit_id = ?')
    .all(args.edit_id) as Array<{ new_start: number; new_count: number }>;
  const impacted = new Set<string>();
  for (const n of nodeRows) {
    for (const h of hunks) {
      const hunkEnd = h.new_start + h.new_count - 1;
      if (n.end_line >= h.new_start && n.start_line <= hunkEnd) {
        impacted.add(n.id);
        break;
      }
    }
  }

  store.db.prepare('DELETE FROM edit_ast_impact WHERE edit_id = ?').run(args.edit_id);
  const insertImpact = store.db.prepare(
    'INSERT INTO edit_ast_impact (edit_id, ast_node_id) VALUES (?, ?)',
  );
  for (const id of impacted) insertImpact.run(args.edit_id, id);
}
