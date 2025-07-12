import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

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
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.uc')
        }
    };

    // Create the language client and start it
    client = new LanguageClient(
        'ucodeLanguageServer',
        'ucode Language Server',
        serverOptions,
        clientOptions
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