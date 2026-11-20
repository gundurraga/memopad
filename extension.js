const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { MOVE_UP, MOVE_DOWN, readOrder, sortEntries, moveItem, placeItemBefore, resetOrder, updateItemOrder } = require('./note-order');

const NOTES_DIR = path.join(os.homedir(), '.memopad');

if (!fs.existsSync(NOTES_DIR)) {
    fs.mkdirSync(NOTES_DIR, { recursive: true });
}

class NotesProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.allExpanded = false;
        // Changing ids makes VS Code forget each folder's open state and apply the default again
        this.generation = 0;
        this.orderErrors = new Set();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    setAllExpanded(allExpanded) {
        this.allExpanded = allExpanded;
        this.generation++;
        vscode.commands.executeCommand('setContext', 'memopad.allExpanded', allExpanded);
        this.refresh();
    }

    getTreeItem(element) {
        return element;
    }

    createItem(itemPath, isDirectory) {
        const folderState = this.allExpanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        const treeItem = new vscode.TreeItem(
            path.basename(itemPath),
            isDirectory ? folderState : vscode.TreeItemCollapsibleState.None
        );
        treeItem.id = `${this.generation}:${itemPath}`;
        treeItem.resourceUri = vscode.Uri.file(itemPath);

        if (isDirectory) {
            treeItem.contextValue = 'folder';
            treeItem.iconPath = new vscode.ThemeIcon('folder');
        } else {
            treeItem.command = {
                command: 'vscode.open',
                title: 'Open Note',
                arguments: [treeItem.resourceUri]
            };
            treeItem.contextValue = 'note';
            treeItem.iconPath = new vscode.ThemeIcon('file');
        }
        return treeItem;
    }

    getParent(element) {
        if (!element || !element.resourceUri) return null;
        const parentPath = path.dirname(element.resourceUri.fsPath);
        if (parentPath === NOTES_DIR) return null;
        return this.createItem(parentPath, true);
    }

    getChildren(element) {
        const directory = element ? element.resourceUri.fsPath : NOTES_DIR;

        try {
            const entries = fs.readdirSync(directory, { withFileTypes: true });
            let savedOrder;
            try {
                savedOrder = readOrder(directory);
                this.orderErrors.delete(directory);
            } catch (error) {
                if (!this.orderErrors.has(directory)) {
                    vscode.window.showErrorMessage(`Cannot load custom order. Showing alphabetical order: ${error.message}`);
                    this.orderErrors.add(directory);
                }
            }
            return sortEntries(entries, savedOrder)
                .map(item => this.createItem(path.join(directory, item.name), item.isDirectory()));
        } catch (err) {
            return [];
        }
    }
}

function getTargetDirectory(item) {
    return item?.contextValue === 'folder' ? item.resourceUri.fsPath : NOTES_DIR;
}

/** Updates ordering after a completed file operation.
 * @param {string} sourcePath Original path. @param {string} [destinationPath] New path, if present.
 * @returns {void} */
function preserveItemOrder(sourcePath, destinationPath) {
    try {
        updateItemOrder(sourcePath, destinationPath);
    } catch (error) {
        vscode.window.showWarningMessage(`The file operation completed, but its custom order could not be updated: ${error.message}`);
    }
}

/** Positions an item after a completed move while keeping failures visible.
 * @param {string} itemPath Moved item. @param {string} targetPath Target note. @returns {void} */
function positionMovedItem(itemPath, targetPath) {
    try {
        placeItemBefore(itemPath, targetPath);
    } catch (error) {
        vscode.window.showWarningMessage(`The item was moved, but its custom order could not be saved: ${error.message}`);
    }
}

/** Reorders a sibling drop or moves an item to the target's folder.
 * @param {import('vscode').TreeItem} sourceItem Dragged item. @param {import('vscode').TreeItem} [target] Drop target.
 * @returns {boolean} Whether a move or reorder occurred. */
function moveDroppedItem(sourceItem, target) {
    const sourcePath = sourceItem.resourceUri.fsPath;
    const targetPath = target?.resourceUri.fsPath;
    if (sourcePath === targetPath) return false;
    const targetIsNote = target?.contextValue === 'note';
    const targetDirectory = targetIsNote ? path.dirname(targetPath) : getTargetDirectory(target);
    const fileName = path.basename(sourcePath);
    const destinationPath = path.join(targetDirectory, fileName);
    if (sourcePath === destinationPath) {
        return targetIsNote && placeItemBefore(sourcePath, targetPath);
    }
    if (targetDirectory === sourcePath || targetDirectory.startsWith(`${sourcePath}${path.sep}`)) {
        throw new Error('A folder cannot be moved inside itself');
    }
    if (fs.existsSync(destinationPath)) {
        throw new Error(`${fileName} already exists in target location`);
    }
    fs.renameSync(sourcePath, destinationPath);
    preserveItemOrder(sourcePath, destinationPath);
    if (targetIsNote) positionMovedItem(destinationPath, targetPath);
    return true;
}

/** Registers an ordering action for the selected item and refreshes its folder.
 * @param {NotesProvider} notesProvider Notes tree. @param {object} options Command, direction and tree view.
 * @returns {import('vscode').Disposable} Registered command. */
function registerOrderCommand(notesProvider, options) {
    return vscode.commands.registerCommand(options.command, async item => {
        if (!item?.resourceUri) return;
        try {
            if (!moveItem(item.resourceUri.fsPath, options.direction)) return;
            notesProvider.refresh();
            await options.treeView.reveal(item, { focus: true, select: true });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to change order: ${error.message}`);
        }
    });
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

                try {
                    if (moveDroppedItem(source[0], target)) notesProvider.refresh();
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

    let copyPath = vscode.commands.registerCommand('memopad.copyPath', async (item) => {
        await vscode.env.clipboard.writeText(item.resourceUri.fsPath);
        vscode.window.showInformationMessage(`Copied path: ${item.resourceUri.fsPath}`);
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
                preserveItemOrder(item.resourceUri.fsPath);
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
            preserveItemOrder(item.resourceUri.fsPath, newPath);
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

    let expandAll = vscode.commands.registerCommand('memopad.expandAll', () => notesProvider.setAllExpanded(true));
    let collapseAll = vscode.commands.registerCommand('memopad.collapseAll', () => notesProvider.setAllExpanded(false));

    const orderCommands = [
        { command: 'memopad.moveToTop', direction: 'top' },
        { command: 'memopad.moveUp', direction: MOVE_UP },
        { command: 'memopad.moveDown', direction: MOVE_DOWN }
    ].map(options => registerOrderCommand(notesProvider, { ...options, treeView }));
    const resetFolderOrder = vscode.commands.registerCommand('memopad.resetOrder', item => {
        try {
            resetOrder(getTargetDirectory(item));
            notesProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to reset order: ${error.message}`);
        }
    });

    context.subscriptions.push(addNote, addFolder, copyNote, copyPath, deleteItem, renameItem, search,
        expandAll, collapseAll, ...orderCommands, resetFolderOrder, watcher, treeView,
        notesProvider._onDidChangeTreeData);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
