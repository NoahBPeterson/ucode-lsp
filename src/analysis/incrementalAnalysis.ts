// Orchestration for function-level incremental analysis. Used by both the server and the
// verification harness:
//   planClean(prevCache, text, ast, doc) → { clean, nodeTypes } for analyzer.setCleanBodies()
//   buildCache(prevCache, text, ast, doc, diagnostics, symbolTable, getType) → next cache
//
// Model: the analyzer always runs the full (cheap) scope pass; for an unchanged, PURE body
// whose environment fingerprint is unchanged, the type checker short-circuits inside it,
// returning cached node types (so hover/inference still resolve) and emitting nothing. The
// analyzer restores the cached return type and dedup-merges the cached diagnostics. See
// incrementalCache.ts for the soundness model; tests/test-incremental-analysis.test.js
// asserts incremental ≡ full.

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic } from 'vscode-languageserver/node';
import { type ProgramNode } from '../ast/nodes';
import {
  extractUnits, computeFingerprint, bodyHashOf, classifyBody, hashString,
  type IncrementalCacheEntry, type UnitState, type UnitRange,
} from './incrementalCache';

export type CleanBody = { bodyEnd: number; returnType: unknown; diagnostics: Diagnostic[]; thisWrites: Array<[string, unknown]> };

function reanchor(rel: { relStart: number; relEnd: number; diag: any }, bodyStart: number, doc: TextDocument): Diagnostic {
  return { ...rel.diag, range: { start: doc.positionAt(bodyStart + rel.relStart), end: doc.positionAt(bodyStart + rel.relEnd) } };
}

/** Which unchanged+pure bodies can have type checking skipped this run, keyed by current body
 *  start offset. Empty (⇒ full analysis) whenever the fingerprint changed. */
export function planClean(
  prevCache: IncrementalCacheEntry | undefined,
  text: string,
  ast: ProgramNode,
  doc: TextDocument,
): Map<number, CleanBody> {
  const clean = new Map<number, CleanBody>();
  if (!prevCache) return clean;
  const units = extractUnits(ast);
  if (computeFingerprint(text, units) !== prevCache.fingerprint) return clean;
  for (const u of units) {
    const prev = prevCache.units.get(u.key);
    if (!prev || (prev.cls !== 'pure' && prev.cls !== 'thisSafe')) continue; // only skippable classes
    if (prev.bodyHash !== bodyHashOf(text, u)) continue;
    clean.set(u.bodyStart, {
      bodyEnd: u.bodyEnd,
      returnType: prev.returnType,
      diagnostics: prev.relDiagnostics.map((rd) => reanchor(rd, u.bodyStart, doc)),
      thisWrites: prev.thisWrites,
    });
  }
  return clean;
}

function unitReturnType(u: UnitRange, symbolTable: any): unknown {
  if (u.kind === 'function') return symbolTable?.lookup?.(u.name)?.returnType;
  return (u.fnNode as any)._inferredReturnType;
}

// Stable JSON for a value that may contain Maps (rich types / property shapes).
function stableJson(v: unknown): string {
  const seen = new WeakSet();
  const enc = (x: any): any => {
    if (x instanceof Map) return ['Map', [...x.entries()].map(([k, val]) => [k, enc(val)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))];
    if (x && typeof x === 'object') {
      if (seen.has(x)) return '[circular]';
      seen.add(x);
      if (Array.isArray(x)) return x.map(enc);
      const keys = Object.keys(x).sort();
      return keys.map((k) => [k, enc(x[k])]);
    }
    return x;
  };
  try { return JSON.stringify(enc(v)); } catch { return String(v); }
}

/** A unit's externally-visible signature: what a SKIPPED reader of this unit could depend on
 *  — its return type, its returned-object shape, and the `this.<prop>` types it writes. */
function unitSig(u: UnitRange, symbolTable: any): string {
  const rt = unitReturnType(u, symbolTable);
  const rpt = u.kind === 'function' ? symbolTable?.lookup?.(u.name)?.returnPropertyTypes : (u.fnNode as any)._inferredReturnPropertyTypes;
  const tw = ((u.fnNode as any)._thisWrites ?? []) as Array<[string, unknown]>;
  return stableJson([rt, rpt, tw]);
}

/** Build the cache to keep after an analysis. Unchanged units (same body hash) are carried
 *  forward wholesale (their relative diagnostics/types are position-independent); only changed
 *  or new units are recomputed. */
export function buildCache(
  prevCache: IncrementalCacheEntry | undefined,
  text: string,
  ast: ProgramNode,
  doc: TextDocument,
  diagnostics: Diagnostic[],
  symbolTable: any,
): IncrementalCacheEntry {
  const units = extractUnits(ast);
  const fingerprint = computeFingerprint(text, units);
  const fpUnchanged = prevCache && prevCache.fingerprint === fingerprint;
  const withOffset = diagnostics.map((d) => ({ d, off: doc.offsetAt(d.range.start) }));
  const newUnits = new Map<string, UnitState>();
  for (const u of units) {
    const bodyHash = bodyHashOf(text, u);
    const prev = prevCache?.units.get(u.key);
    if (fpUnchanged && prev && prev.bodyHash === bodyHash) {
      newUnits.set(u.key, prev); // unchanged unit: carry forward (rel offsets are stable)
      continue;
    }
    const rel: UnitState['relDiagnostics'] = [];
    for (const { d, off } of withOffset) {
      if (off >= u.bodyStart && off < u.bodyEnd) {
        rel.push({
          relStart: off - u.bodyStart,
          relEnd: doc.offsetAt(d.range.end) - u.bodyStart,
          diag: { severity: d.severity, message: d.message, source: d.source, code: d.code, data: (d as any).data, tags: d.tags, relatedInformation: d.relatedInformation },
        });
      }
    }
    newUnits.set(u.key, {
      bodyHash,
      cls: classifyBody(u),
      returnType: unitReturnType(u, symbolTable),
      relDiagnostics: rel,
      thisWrites: ((u.fnNode as any)._thisWrites ?? []) as Array<[string, unknown]>,
      sig: unitSig(u, symbolTable),
    });
  }
  const semanticSig = hashString([...newUnits.entries()].map(([k, v]) => k + '=' + v.sig).sort().join(''));
  return { fingerprint, semanticSig, units: newUnits };
}

/** Run an analysis incrementally and SOUNDLY. `run(cleanBodies)` performs the analysis with
 *  the given skip set and returns its diagnostics + symbol table. If skipping was applied but
 *  the derived semantic signature changed (a sibling's return type / returned shape / this-
 *  property type moved), a skipped reader could be stale, so we transparently redo a FULL
 *  analysis. Pure-logic edits (the common typing case) don't change the signature → fast path. */
export function runIncremental<T extends { diagnostics: Diagnostic[]; symbolTable: any }>(
  doc: TextDocument,
  ast: ProgramNode,
  prevCache: IncrementalCacheEntry | undefined,
  run: (cleanBodies: Map<number, CleanBody>) => T,
): { result: T; cache: IncrementalCacheEntry; skipped: number; redidFull: boolean } {
  const text = doc.getText();
  const clean = planClean(prevCache, text, ast, doc);
  let res = run(clean);
  let cache = buildCache(prevCache, text, ast, doc, res.diagnostics, res.symbolTable);
  let redidFull = false;
  if (clean.size > 0 && prevCache && cache.semanticSig !== prevCache.semanticSig) {
    // A skipped body may have read a signature/shape that just changed — redo fully (sound).
    res = run(new Map());
    cache = buildCache(undefined, text, ast, doc, res.diagnostics, res.symbolTable);
    redidFull = true;
  }
  return { result: res, cache, skipped: redidFull ? 0 : clean.size, redidFull };
}
