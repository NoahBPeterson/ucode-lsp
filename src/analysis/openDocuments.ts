/**
 * Registry of open editor buffers (live, possibly-unsaved content), keyed by the
 * file's absolute path. The LSP server keeps this in sync with its TextDocuments
 * manager (onDidOpen / onDidChangeContent / onDidClose) so cross-file resolution
 * in FileResolver reads what the user currently sees in the editor rather than
 * stale on-disk content.
 *
 * Keyed by decoded absolute path so the server's client URIs and FileResolver's
 * constructed `file://` URIs resolve to the same key regardless of encoding.
 */
const openByPath = new Map<string, string>();

function uriToPath(uri: string): string {
    if (uri.startsWith('file://')) {
        const raw = uri.substring('file://'.length);
        try { return decodeURIComponent(raw); } catch { return raw; }
    }
    return uri;
}

export function setOpenDocumentContent(uri: string, content: string): void {
    openByPath.set(uriToPath(uri), content);
}

export function clearOpenDocumentContent(uri: string): void {
    openByPath.delete(uriToPath(uri));
}

/** Live buffer content for a file if it is open in the editor, else undefined. */
export function getOpenDocumentContent(uri: string): string | undefined {
    return openByPath.get(uriToPath(uri));
}
