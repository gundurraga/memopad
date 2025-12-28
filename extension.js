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

    getParent(element) {
        if (!element || !element.resourceUri) return null;
        const parentPath = path.dirname(element.resourceUri.fsPath);
        if (parentPath === NOTES_DIR) return null;

        const parentName = path.basename(parentPath);
        const item = new vscode.TreeItem(parentName, vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = 'folder';
        item.resourceUri = vscode.Uri.file(parentPath);
        return item;
    }

    getChildren(element) {
        const directory = element ? element.resourceUri.fsPath : NOTES_DIR;

        try {
            const items = fs.readdirSync(directory, { withFileTypes: true });
            return items.map(item => {
                const itemPath = path.join(directory, item.name);
                const isDirectory = item.isDirectory();

                const treeItem = new vscode.TreeItem(
                    item.name,
                    isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
                );

                if (isDirectory) {
                    treeItem.contextValue = 'folder';
                    treeItem.iconPath = new vscode.ThemeIcon('folder');
                } else {
                    treeItem.command = {
                        command: 'vscode.open',
                        title: 'Open Note',
                        arguments: [vscode.Uri.file(itemPath)]
                    };
                    treeItem.contextValue = 'note';
                    treeItem.iconPath = new vscode.ThemeIcon('file');
                }

                treeItem.resourceUri = vscode.Uri.file(itemPath);
                return treeItem;
            }).sort((a, b) => {
                if (a.contextValue === 'folder' && b.contextValue === 'note') return -1;
                if (a.contextValue === 'note' && b.contextValue === 'folder') return 1;
                return a.label.localeCompare(b.label);
            });
        } catch (err) {
            return [];
        }
    }
}

function getTargetDirectory(item) {
    return item?.contextValue === 'folder' ? item.resourceUri.fsPath : NOTES_DIR;
}

function getAllFiles(directory, files = []) {
    const items = fs.readdirSync(directory, { withFileTypes: true });
    for (const item of items) {
        if (item.name.startsWith('.')) continue;
        const fullPath = path.join(directory, item.name);
        if (item.isDirectory()) {
            getAllFiles(fullPath, files);
        } else {
            files.push(fullPath);
        }
    }
    return files;
}

function searchInFiles(query) {
    const results = [];
    const files = getAllFiles(NOTES_DIR);
    const lowerQuery = query.toLowerCase();

    for (const filePath of files) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(lowerQuery)) {
                    const relativePath = path.relative(NOTES_DIR, filePath);
                    const linePreview = lines[i].trim().substring(0, 60);
                    results.push({
                        label: `$(file) ${relativePath}:${i + 1}`,
                        description: linePreview,
                        filePath,
                        line: i
                    });
                }
            }
        } catch (err) {
            // Skip files that can't be read
        }
    }
    return results;
}

function activate(context) {
    const notesProvider = new NotesProvider();
    const treeView = vscode.window.createTreeView('memopadNotes', {
        treeDataProvider: notesProvider,
        dragAndDropController: {
            dropMimeTypes: ['application/vnd.code.tree.memopadNotes'],
            dragMimeTypes: ['application/vnd.code.tree.memopadNotes'],
            handleDrag(source, dataTransfer) {
                dataTransfer.set('application/vnd.code.tree.memopadNotes', new vscode.DataTransferItem(source));
            },
            handleDrop(target, dataTransfer) {
                const transferItem = dataTransfer.get('application/vnd.code.tree.memopadNotes');
                if (!transferItem) return;

                const source = transferItem.value;
                if (!source || source.length === 0) return;

                const sourceItem = source[0];
                const targetDir = getTargetDirectory(target);
                const sourcePath = sourceItem.resourceUri.fsPath;
                const fileName = path.basename(sourcePath);
                const newPath = path.join(targetDir, fileName);

                if (sourcePath === newPath) return;

                if (fs.existsSync(newPath)) {
                    vscode.window.showErrorMessage(`${fileName} already exists in target location`);
                    return;
                }

                try {
                    fs.renameSync(sourcePath, newPath);
                    notesProvider.refresh();
                } catch (err) {
                    vscode.window.showErrorMessage(`Failed to move: ${err.message}`);
                }
            }
        }
    });

    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(NOTES_DIR, '**/*')
    );

    watcher.onDidCreate(() => notesProvider.refresh());
    watcher.onDidDelete(() => notesProvider.refresh());
    watcher.onDidChange(() => notesProvider.refresh());

    let addNote = vscode.commands.registerCommand('memopad.addNote', async (item) => {
        const name = await vscode.window.showInputBox({
            prompt: 'Enter note name',
            placeHolder: 'e.g., code-review.md'
        });

        if (!name) return;

        const parentDir = getTargetDirectory(item);
        const filePath = path.join(parentDir, name);

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

    let addFolder = vscode.commands.registerCommand('memopad.addFolder', async (item) => {
        const name = await vscode.window.showInputBox({
            prompt: 'Enter folder name',
            placeHolder: 'e.g., work, personal, templates'
        });

        if (!name) return;

        const parentDir = getTargetDirectory(item);
        const folderPath = path.join(parentDir, name);

        if (fs.existsSync(folderPath)) {
            vscode.window.showErrorMessage(`${name} already exists`);
            return;
        }

        try {
            fs.mkdirSync(folderPath, { recursive: true });
            notesProvider.refresh();
            vscode.window.showInformationMessage(`Folder created: ${name}`);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to create folder: ${err.message}`);
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

    let deleteItem = vscode.commands.registerCommand('memopad.deleteItem', async (item) => {
        const itemType = item.contextValue === 'folder' ? 'folder' : 'note';
        const result = await vscode.window.showWarningMessage(
            `Delete ${itemType} ${item.label}?`,
            'Delete', 'Cancel'
        );

        if (result === 'Delete') {
            try {
                if (item.contextValue === 'folder') {
                    fs.rmSync(item.resourceUri.fsPath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(item.resourceUri.fsPath);
                }
                notesProvider.refresh();
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to delete ${itemType}: ${err.message}`);
            }
        }
    });

    let renameItem = vscode.commands.registerCommand('memopad.renameItem', async (item) => {
        const itemType = item.contextValue === 'folder' ? 'folder' : 'note';
        const newName = await vscode.window.showInputBox({
            prompt: `Enter new ${itemType} name`,
            value: item.label
        });

        if (!newName || newName === item.label) return;

        const parentDir = path.dirname(item.resourceUri.fsPath);
        const newPath = path.join(parentDir, newName);

        if (fs.existsSync(newPath)) {
            vscode.window.showErrorMessage(`${newName} already exists`);
            return;
        }

        try {
            fs.renameSync(item.resourceUri.fsPath, newPath);
            notesProvider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to rename ${itemType}: ${err.message}`);
        }
    });

    let search = vscode.commands.registerCommand('memopad.search', async () => {
        const quickPick = vscode.window.createQuickPick();
        quickPick.placeholder = 'Search in memopad...';
        quickPick.matchOnDescription = true;

        quickPick.onDidChangeValue(value => {
            if (value.length < 2) {
                quickPick.items = [];
                return;
            }
            quickPick.items = searchInFiles(value);
        });

        quickPick.onDidAccept(() => {
            const selected = quickPick.selectedItems[0];
            if (selected) {
                const uri = vscode.Uri.file(selected.filePath);
                vscode.window.showTextDocument(uri).then(editor => {
                    const position = new vscode.Position(selected.line, 0);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                });
            }
            quickPick.hide();
        });

        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.show();
    });

    context.subscriptions.push(addNote, addFolder, copyNote, deleteItem, renameItem, search, watcher);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
