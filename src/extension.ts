import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import {
    LanguageClient,
    type LanguageClientOptions,
    type ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

// Field separator the server's CodeLens uses (ASCII Unit Separator).
const FS_CHAR = '\x1f';

// Backs the function-history CodeLens click. The server resolves the lens with a
// command pointing here, carrying the function's git line range. We list the
// commits in a quick-pick and show the chosen one as a read-only diff.
async function showFunctionHistory(uri: string, startLine: number, endLine: number, name: string): Promise<void> {
    const filePath = vscode.Uri.parse(uri).fsPath;
    const cwd = path.dirname(filePath);
    let out: string;
    try {
        out = cp.execFileSync('git', [
            'log', '-L', `${startLine},${endLine}:${path.basename(filePath)}`,
            '-s', `--format=%H${FS_CHAR}%an${FS_CHAR}%ad${FS_CHAR}%s`, '--date=short',
        ], { cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 1 << 20 });
    } catch {
        vscode.window.showWarningMessage(`No git history available for ${name}.`);
        return;
    }
    const items = out.split('\n').filter(Boolean).map((line) => {
        const parts = line.split(FS_CHAR);
        const hash = parts[0] ?? '';
        const author = parts[1] ?? '';
        const date = parts[2] ?? '';
        const subject = parts.slice(3).join(FS_CHAR) || '(no subject)';
        return { label: subject, description: `${author} · ${date}`, detail: hash, hash };
    });
    if (items.length === 0) {
        vscode.window.showInformationMessage(`No git history for ${name}.`);
        return;
    }
    const pick = await vscode.window.showQuickPick(items, { title: `History: ${name}`, matchOnDescription: true });
    if (!pick || !pick.hash) return;
    try {
        const diff = cp.execFileSync('git', ['show', pick.hash], { cwd, encoding: 'utf8', maxBuffer: 1 << 24 });
        const doc = await vscode.workspace.openTextDocument({ content: diff, language: 'diff' });
        await vscode.window.showTextDocument(doc, { preview: true });
    } catch {
        vscode.window.showWarningMessage(`Could not show commit ${pick.hash}.`);
    }
}

// Backs the "N references" CodeLens click. The server resolves the lens with a
// command pointing here, carrying the function's declaration position and the
// reference locations as plain JSON; we convert to vscode types and open the
// built-in peek-references view.
function showFunctionReferences(
    uri: string,
    position: { line: number; character: number },
    locations: { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }[]
): void {
    const docUri = vscode.Uri.parse(uri);
    const pos = new vscode.Position(position.line, position.character);
    const locs = (locations || []).map(l => new vscode.Location(
        vscode.Uri.parse(l.uri),
        new vscode.Range(l.range.start.line, l.range.start.character, l.range.end.line, l.range.end.character)
    ));
    vscode.commands.executeCommand('editor.action.showReferences', docUri, pos, locs);
}

// Prompt for the OpenWrt release whose ucode the diagnostics should target, and
// persist it to the `ucode.targetVersion` setting. Invoked from the UC6005 quick fix.
async function selectTargetVersion(): Promise<void> {
    const items: vscode.QuickPickItem[] = [
        { label: 'main', description: 'OpenWrt main / snapshot — newest ucode (disables version checks)' },
        { label: '25.12', description: 'OpenWrt 25.12 (ucode 2026-01-16) — default, latest release' },
        { label: '24.10', description: 'OpenWrt 24.10 (ucode 2025-07-18)' },
        { label: '23.05', description: 'OpenWrt 23.05 (ucode 2024-07-11)' },
        { label: '22.03', description: 'OpenWrt 22.03 (ucode 2022-12-02)' },
    ];
    const cfg = vscode.workspace.getConfiguration('ucode');
    const current = cfg.get<string>('targetVersion', '25.12');
    const pick = await vscode.window.showQuickPick(items, {
        title: 'ucode: target OpenWrt release',
        placeHolder: `Current: ${current}. Diagnostics will target this release's ucode.`,
    });
    if (pick) {
        await cfg.update('targetVersion', pick.label, vscode.ConfigurationTarget.Workspace);
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('ucode extension is being activated');
    
    // Create the language server
    const serverModule = context.asAbsolutePath('dist/server.js');
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

    // Server options for the language server
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };

    // Options for the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for ucode documents
        documentSelector: [{ scheme: 'file', language: 'ucode' }],
        synchronize: {
            // Notify the server about file changes to '.uc' files contained in the workspace
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.uc'),
            // Watch the `ucode.*` settings so changing them (e.g. `ucode.targetVersion`)
            // sends workspace/didChangeConfiguration to the server, which re-pulls the
            // value and re-analyzes open docs. Without this, VS Code never notifies the
            // server and version-gated diagnostics (UC6005) wouldn't update on a change.
            configurationSection: 'ucode',
        }
    };

    // Create the language client and start it
    client = new LanguageClient(
        'ucodeLanguageServer',
        'ucode Language Server',
        serverOptions,
        clientOptions
    );

    // CodeLens click targets (the lenses themselves come from the server).
    context.subscriptions.push(
        vscode.commands.registerCommand('ucode.showFunctionHistory', showFunctionHistory),
        vscode.commands.registerCommand('ucode.showFunctionReferences', showFunctionReferences),
        vscode.commands.registerCommand('ucode.selectTargetVersion', selectTargetVersion)
    );

    // Start the client. This will also launch the server
    console.log('Starting ucode language client...');
    client.start().then(() => {
        console.log('ucode language client started successfully');
    }).catch((error) => {
        console.error('Failed to start ucode language client:', error);
    });
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}