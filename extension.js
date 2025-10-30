const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const NOTES_DIR = path.join(os.homedir(), '.memopad');

if (!fs.existsSync(NOTES_DIR)) {
    fs.mkdirSync(NOTES_DIR, { recursive: true });
}

class NotesProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element) {
        return element;
    }

    getChildren() {
        const files = fs.readdirSync(NOTES_DIR);
        return files.map(file => {
            const filePath = path.join(NOTES_DIR, file);
            const item = new vscode.TreeItem(file, vscode.TreeItemCollapsibleState.None);
            item.command = {
                command: 'vscode.open',
                title: 'Open Note',
                arguments: [vscode.Uri.file(filePath)]
            };
            item.contextValue = 'note';
            item.resourceUri = vscode.Uri.file(filePath);
            return item;
        });
    }
}

function activate(context) {
    const notesProvider = new NotesProvider();
    vscode.window.registerTreeDataProvider('memopadNotes', notesProvider);

    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(NOTES_DIR, '*')
    );

    watcher.onDidCreate(() => notesProvider.refresh());
    watcher.onDidDelete(() => notesProvider.refresh());
    watcher.onDidChange(() => notesProvider.refresh());

    let addNote = vscode.commands.registerCommand('memopad.addNote', async () => {
        const name = await vscode.window.showInputBox({
            prompt: 'Enter note name',
            placeHolder: 'e.g., code-review.md'
        });

        if (!name) return;

        const filePath = path.join(NOTES_DIR, name);

        if (fs.existsSync(filePath)) {
            vscode.window.showErrorMessage(`${name} already exists`);
            return;
        }

        try {
            fs.writeFileSync(filePath, '', 'utf8');
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);
            notesProvider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to create note: ${err.message}`);
        }
    });

    let copyNote = vscode.commands.registerCommand('memopad.copyNote', async (item) => {
        try {
            const content = fs.readFileSync(item.resourceUri.fsPath, 'utf8');
            await vscode.env.clipboard.writeText(content);
            vscode.window.showInformationMessage(`Copied: ${item.label}`);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to copy note: ${err.message}`);
        }
    });

    let deleteNote = vscode.commands.registerCommand('memopad.deleteNote', async (item) => {
        const result = await vscode.window.showWarningMessage(
            `Delete ${item.label}?`,
            'Delete', 'Cancel'
        );

        if (result === 'Delete') {
            try {
                fs.unlinkSync(item.resourceUri.fsPath);
                notesProvider.refresh();
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to delete note: ${err.message}`);
            }
        }
    });

    let renameNote = vscode.commands.registerCommand('memopad.renameNote', async (item) => {
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new name',
            value: item.label
        });

        if (!newName || newName === item.label) return;

        const newPath = path.join(NOTES_DIR, newName);

        if (fs.existsSync(newPath)) {
            vscode.window.showErrorMessage(`${newName} already exists`);
            return;
        }

        try {
            fs.renameSync(item.resourceUri.fsPath, newPath);
            notesProvider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to rename note: ${err.message}`);
        }
    });

    let refresh = vscode.commands.registerCommand('memopad.refresh', () => {
        notesProvider.refresh();
    });

    context.subscriptions.push(addNote, copyNote, deleteNote, renameNote, refresh, watcher);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
