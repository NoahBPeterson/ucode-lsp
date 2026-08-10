/**
 * "Generate @typedef from usage" — mine the member accesses a function body performs
 * on one of its parameters into a property tree, and render it as a `@typedef {object}`
 * block with dotted `@property` lines (the shape the JSDoc consumer already resolves,
 * including one-hop nesting like `action.path`). The code action in the server replaces
 * the param's `{object}` annotation with the generated typedef name.
 *
 * Leaf types come only from usage that genuinely pins them:
 *   - called as a function            → function
 *   - strict/loose-compared to a literal → that literal's type
 *   - assigned a literal value        → that literal's type
 * Anything else stays `unknown` (honest — the reader can refine by hand). A path
 * segment that has sub-properties is `object` (unioned with any pinned hints, e.g. a
 * member both called and dotted-through renders `function|object`).
 */

import type { AstNode, MemberExpressionNode, IdentifierNode, FunctionDeclarationNode, FunctionExpressionNode, ArrowFunctionExpressionNode } from '../ast/nodes';
import { astChildren } from '../ast/astChildren';

export interface MinedProperty {
  /** Dotted path below the parameter, e.g. `action.path`. */
  path: string;
  /** JSDoc type expression for the @property line. */
  type: string;
}

interface PropNode {
  hints: Set<string>;
  children: Map<string, PropNode>;
  order: number; // first-seen order, so the rendered block mirrors the code
}

type FunctionLikeNode = FunctionDeclarationNode | FunctionExpressionNode | ArrowFunctionExpressionNode;

function asFunctionLike(node: AstNode): FunctionLikeNode | null {
  return node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression'
    ? node : null;
}

function literalTypeName(node: AstNode): string | null {
  if (node.type !== 'Literal') return null;
  const lit = node;
  switch (lit.literalType) {
    case 'number': return typeof lit.value === 'number' && lit.value % 1 === 0 ? 'integer' : 'double';
    case 'double': return 'double';
    case 'string': return 'string';
    case 'boolean': return 'boolean';
    default: return null; // null/regex literals don't pin a useful property type
  }
}

/** Decompose a member chain into its base identifier and non-computed segment names.
 *  Stops at the first computed link (`x[i]` — the path is no longer nameable). */
function chainOf(node: MemberExpressionNode): { base: IdentifierNode; segs: Array<{ name: string }> } | null {
  const links: MemberExpressionNode[] = [];
  let cur: AstNode = node;
  while (cur.type === 'MemberExpression') {
    links.unshift(cur);
    cur = cur.object;
  }
  if (cur.type !== 'Identifier') return null;
  const segs: Array<{ name: string }> = [];
  for (const link of links) {
    if (link.computed || link.property.type !== 'Identifier') break;
    segs.push({ name: link.property.name });
  }
  if (segs.length === 0) return null;
  return { base: cur, segs };
}

/**
 * Mine the property tree `paramName` is used with inside `fnNode`'s body.
 * Returns the flattened, render-ready property list (depth-first, first-seen order),
 * or null when the body never dot-accesses the parameter. Subtrees where the name is
 * re-bound (a nested function's own param, or a `let`/`const` redeclaration) are
 * skipped — those accesses belong to the shadow, not this parameter.
 */
export function mineParamShape(fnNode: AstNode, paramName: string): MinedProperty[] | null {
  const body = asFunctionLike(fnNode)?.body;
  if (!body) return null;
  const root: PropNode = { hints: new Set(), children: new Map(), order: 0 };
  let counter = 0;

  const record = (segs: Array<{ name: string }>, leafHint: string | null): void => {
    let cur = root;
    for (const seg of segs) {
      let next = cur.children.get(seg.name);
      if (!next) {
        next = { hints: new Set(), children: new Map(), order: counter++ };
        cur.children.set(seg.name, next);
      }
      cur = next;
    }
    if (leafHint) cur.hints.add(leafHint);
  };

  const shadowedIn = (node: FunctionLikeNode): boolean => {
    const params = node.params ?? [];
    const rest = node.restParam;
    return params.some((p) => p?.name === paramName) || rest?.name === paramName;
  };

  const visit = (node: AstNode, parent: AstNode | null): void => {
    const fnLike = asFunctionLike(node);
    if (fnLike && node !== fnNode && shadowedIn(fnLike)) return;
    if (node.type === 'VariableDeclarator' && node.id?.name === paramName) {
      // A redeclaration anywhere below makes later reads ambiguous — record nothing
      // from the initializer's siblings is overkill; just skip THIS declarator's
      // subtree (its init may still read the param, but the ambiguity isn't worth it).
      return;
    }

    if (node.type === 'MemberExpression') {
      // Only the OUTERMOST link of a chain — inner links are re-visited via chainOf.
      const isInnerLink = parent?.type === 'MemberExpression' && parent.object === node;
      if (!isInnerLink) {
        const chain = chainOf(node);
        if (chain && chain.base.name === paramName) {
          let hint: string | null = null;
          if (parent?.type === 'CallExpression' && parent.callee === node) {
            hint = 'function';
          } else if (parent?.type === 'BinaryExpression') {
            const bin = parent;
            if (['==', '===', '!=', '!=='].includes(bin.operator)) {
              const other = bin.left === node ? bin.right : bin.left;
              hint = literalTypeName(other);
            }
          } else if (parent?.type === 'AssignmentExpression' && parent.left === node) {
            const rhs = parent.right;
            hint = literalTypeName(rhs)
              ?? (rhs.type === 'ObjectExpression' ? 'object' : rhs.type === 'ArrayExpression' ? 'array' : null);
          }
          record(chain.segs, hint);
        }
      }
    }

    for (const child of astChildren(node)) {
      visit(child, node);
    }
  };
  visit(body, fnNode);

  if (root.children.size === 0) return null;
  const out: MinedProperty[] = [];
  const flatten = (node: PropNode, prefix: string): void => {
    const entries = [...node.children.entries()].sort((a, b) => a[1].order - b[1].order);
    for (const [name, child] of entries) {
      const hints = new Set(child.hints);
      if (child.children.size > 0) hints.add('object');
      const type = hints.size > 0 ? [...hints].sort().join('|') : 'unknown';
      const path = prefix ? `${prefix}.${name}` : name;
      out.push({ path, type });
      flatten(child, path);
    }
  };
  flatten(root, '');
  return out;
}

/** An existing `@typedef {object}` block with the offsets the widening edits need. */
export interface ExistingTypedef {
  name: string;
  props: MinedProperty[];
  /** Absolute offset of the line holding the closing `*​/` — where new `@property`
   *  lines insert. -1 when the block is single-line (not extendable in place). */
  insertOffset: number;
  /** Leading whitespace of the block's first line. */
  indent: string;
  /** Absolute {type} spans per property path, for upgrading a declared `unknown`. */
  typeSpans: Map<string, { start: number; end: number }>;
}

/**
 * All `@typedef {object} Name` blocks already in the file, with their @property
 * lists and edit anchors — so the action can point a same-shaped parameter at an
 * existing typedef, or WIDEN one with the new members, instead of minting a
 * near-duplicate.
 */
export function parseExistingTypedefs(text: string): Map<string, ExistingTypedef> {
  const out = new Map<string, ExistingTypedef>();
  for (const block of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    const m = /@typedef\s*\{\s*object\s*\}\s*(\w+)/.exec(block[0]);
    if (!m) continue;
    const blockStart = block.index!;
    const props: MinedProperty[] = [];
    const typeSpans = new Map<string, { start: number; end: number }>();
    for (const pm of block[0].matchAll(/@property\s*\{([^}]*)\}\s+([\w.]+)/g)) {
      props.push({ path: pm[2]!, type: pm[1]!.trim() });
      const typeStart = blockStart + pm.index! + pm[0].indexOf('{') + 1;
      typeSpans.set(pm[2]!, { start: typeStart, end: typeStart + pm[1]!.length });
    }
    const lineStartOf = (off: number): number => text.lastIndexOf('\n', off - 1) + 1;
    const closeOff = blockStart + block[0].lastIndexOf('*/');
    const firstLineStart = lineStartOf(blockStart);
    const closeLineStart = lineStartOf(closeOff);
    const indentText = text.slice(firstLineStart, blockStart);
    out.set(m[1]!, {
      name: m[1]!,
      props,
      insertOffset: closeLineStart > firstLineStart ? closeLineStart : -1,
      indent: /^\s*$/.test(indentText) ? indentText : '',
      typeSpans,
    });
  }
  return out;
}

/** The widening plan against one candidate typedef: which mined properties are
 *  missing from it, and which of its declared `unknown` types usage now pins. */
export interface TypedefExtensionPlan {
  typedef: ExistingTypedef;
  missing: MinedProperty[];
  upgrades: Array<{ path: string; newType: string; span: { start: number; end: number } }>;
}

/**
 * Choose an existing typedef the mined shape can reuse or WIDEN — one shared request
 * typedef per dispatcher, not a near-duplicate per method. Compatible means: no path
 * both sides type CONCRETELY but differently, and at least one path in common (an
 * unrelated typedef is someone else's shape). Preference: nothing missing (pure
 * reuse, no block churn), then most shared paths, then declaration order. Extra
 * declared properties the mined shape lacks are fine — that is exactly the shared
 * widened typedef serving a method that uses a subset.
 */
export function planTypedefExtension(existing: Map<string, ExistingTypedef>, mined: MinedProperty[]): TypedefExtensionPlan | null {
  let best: { plan: TypedefExtensionPlan; shared: number } | null = null;
  for (const t of existing.values()) {
    const declared = new Map(t.props.map((p) => [p.path, p.type]));
    let shared = 0;
    let conflict = false;
    const missing: MinedProperty[] = [];
    const upgrades: TypedefExtensionPlan['upgrades'] = [];
    for (const mp of mined) {
      const dt = declared.get(mp.path);
      if (dt === undefined) { missing.push(mp); continue; }
      shared++;
      if (mp.type === 'unknown' || mp.type === dt) continue;
      if (dt === 'unknown') {
        const span = t.typeSpans.get(mp.path);
        if (span) upgrades.push({ path: mp.path, newType: mp.type, span });
        continue;
      }
      conflict = true;
      break;
    }
    if (conflict || shared === 0) continue;
    if (missing.length > 0 && t.insertOffset < 0) continue; // single-line block — can't widen in place
    const plan: TypedefExtensionPlan = { typedef: t, missing, upgrades };
    const beats = (): boolean => {
      if (best === null) return true;
      const pure = missing.length === 0;
      const bestPure = best.plan.missing.length === 0;
      if (pure !== bestPure) return pure; // nothing-missing reuse beats any widening
      return shared > best.shared;
    };
    if (beats()) best = { plan, shared };
  }
  return best?.plan ?? null;
}

/**
 * A non-computed property's key name. ucode's parser represents bare object keys as
 * STRING LITERALS (`{ call: … }` → Literal "call"), not Identifiers — an Identifier-only
 * check silently matches nothing.
 */
export function propertyKeyName(prop: { computed?: boolean; key?: AstNode }): string | null {
  if (prop.computed || !prop.key) return null;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal') {
    const v = prop.key.value;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/**
 * Sibling-declaration seeding: when a function sits in an object literal next to a
 * sibling property whose value is an object of literals, and the function's body
 * reads `param.<sibling>.<key>` for a key that sibling declares, the literal is a
 * type-by-example declaration for that member (`''` → string, `0` → integer,
 * `false` → boolean). The NAME correspondence is discovered from the code — the
 * mined member path must match the sibling's own name — so nothing here assumes any
 * particular convention; rpcd plugins and ubus.publish objects (`args`/`call`) are
 * simply the most common instance of the shape.
 *
 * Returns `<siblingName>.<key>` → type for one sibling's object literal; only paths
 * the mining actually produced ever consume a seed.
 */
export function siblingExampleSeeds(siblingName: string, siblingObject: AstNode): Map<string, string> {
  const seeds = new Map<string, string>();
  const props = siblingObject.type === 'ObjectExpression' ? siblingObject.properties : [];
  for (const p of props) {
    if (p.type !== 'Property') continue;
    const name = propertyKeyName(p);
    if (!name || !p.value) continue;
    const t = literalTypeName(p.value);
    if (t) seeds.set(`${siblingName}.${name}`, t);
  }
  return seeds;
}

/**
 * Fold sibling type-by-example seeds into a mined shape: refine `unknown` leaves the
 * seeds can type, and ADD declared keys the body never happened to read — the sibling
 * declaration is the request contract, so a key it declares belongs in the typedef
 * even when this particular body ignores it. A seed group only applies when the body
 * links the parameter to that sibling name at all (some mined path is `<sibling>` or
 * `<sibling>.…`); an unlinked group is someone else's object.
 */
export function mergeSiblingDeclaredKeys(mined: MinedProperty[], seeds: Map<string, string>): MinedProperty[] {
  const byBase = new Map<string, Array<{ path: string; type: string }>>();
  for (const [path, type] of seeds) {
    const base = path.slice(0, path.indexOf('.'));
    let group = byBase.get(base);
    if (!group) { group = []; byBase.set(base, group); }
    group.push({ path, type });
  }
  let out = mined.map((mp) => mp.type === 'unknown' && seeds.has(mp.path) ? { ...mp, type: seeds.get(mp.path)! } : mp);
  for (const [base, group] of byBase) {
    if (!out.some((mp) => mp.path === base || mp.path.startsWith(base + '.'))) continue;
    const have = new Set(out.map((mp) => mp.path));
    const missing = group.filter((g) => !have.has(g.path));
    if (missing.length === 0) continue;
    // The base node always exists in a linked shape (mining records every segment) —
    // but a base read only as a whole value is an `unknown` LEAF; children make it an object.
    out = out.map((mp) => mp.path === base && mp.type === 'unknown' ? { ...mp, type: 'object' } : mp);
    // Insert after the last entry of the base's subtree, keeping declaration order.
    let insertAt = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i]!.path === base || out[i]!.path.startsWith(base + '.')) insertAt = i;
    }
    out = [...out.slice(0, insertAt + 1), ...missing, ...out.slice(insertAt + 1)];
  }
  return out;
}

/** Render the typedef block, one line per mined property, indented like the JSDoc
 *  block it will sit above. Ends with a newline (insert-ready at a line start). */
export function renderTypedefBlock(typeName: string, props: MinedProperty[], indent: string): string {
  const lines = [
    `${indent}/**`,
    `${indent} * @typedef {object} ${typeName}`,
    ...props.map((p) => `${indent} * @property {${p.type}} ${p.path}`),
    `${indent} */`,
  ];
  return lines.join('\n') + '\n';
}
