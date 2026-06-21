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
import { ProgramNode } from '../ast/nodes';
import {
  extractUnits, computeFingerprint, bodyHashOf, isPureBody,
  IncrementalCacheEntry, UnitState, UnitRange,
} from './incrementalCache';

export type CleanBody = { bodyEnd: number; returnType: unknown; diagnostics: Diagnostic[] };

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
    if (!prev || !prev.pure) continue;
    if (prev.bodyHash !== bodyHashOf(text, u)) continue;
    clean.set(u.bodyStart, {
      bodyEnd: u.bodyEnd,
      returnType: prev.returnType,
      diagnostics: prev.relDiagnostics.map((rd) => reanchor(rd, u.bodyStart, doc)),
    });
  }
  return clean;
}

function unitReturnType(u: UnitRange, symbolTable: any): unknown {
  if (u.kind === 'function') return symbolTable?.lookup?.(u.name)?.returnType;
  return (u.fnNode as any)._inferredReturnType;
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
      pure: isPureBody(u),
      returnType: unitReturnType(u, symbolTable),
      relDiagnostics: rel,
    });
  }
  return { fingerprint, units: newUnits };
}
