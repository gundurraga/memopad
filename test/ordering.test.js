const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const { MOVE_UP, MOVE_DOWN, readOrder, moveItem } = require('../note-order');

const PROJECT_DIRECTORY = path.resolve(__dirname, '..');
const EXTENSION_PATH = path.join(PROJECT_DIRECTORY, 'extension.js');
const extensionRequire = createRequire(EXTENSION_PATH);
const MIME_TYPE = 'application/vnd.code.tree.memopadNotes';

/** Loads extension commands against disposable notes, with only VS Code's UI replaced. */
function createHarness(testContext) {
    const home = fs.mkdtempSync(path.join(PROJECT_DIRECTORY, '.test-order-'));
    const directory = path.join(home, '.memopad');
    const commands = new Map();
    const errors = [];
    const responses = [];
    let view;
    const vscode = {
        EventEmitter: class {
            event() {}
            fire() {}
            dispose() {}
        },
        TreeItem: class {
            constructor(label) { this.label = label; }
        },
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        ThemeIcon: class {},
        Uri: { file: filePath => ({ fsPath: filePath }) },
        RelativePattern: class {},
        DataTransferItem: class {
            constructor(value) { this.value = value; }
        },
        commands: {
            registerCommand(name, callback) {
                commands.set(name, callback);
                return { dispose() {} };
            },
            executeCommand() {}
        },
        window: {
            createTreeView(name, options) {
                view = { ...options, reveal: async () => {}, dispose() {} };
                return view;
            },
            showErrorMessage: message => errors.push(message),
            showWarningMessage: async message => message.startsWith('Delete ')
                ? 'Delete' : errors.push(message),
            showInputBox: async () => responses.shift(),
            showTextDocument: async () => {},
            showInformationMessage() {}
        },
        workspace: {
            createFileSystemWatcher: () => ({
                onDidCreate() {}, onDidDelete() {}, onDidChange() {}, dispose() {}
            }),
            openTextDocument: async filePath => filePath
        }
    };
    const sandbox = {
        require: name => {
            if (name === 'vscode') return vscode;
            if (name === 'os') return { homedir: () => home };
            return extensionRequire(name);
        },
        module: { exports: {} }
    };
    vm.runInNewContext(fs.readFileSync(EXTENSION_PATH, 'utf8'), sandbox, { filename: EXTENSION_PATH });
    sandbox.module.exports.activate({ subscriptions: [] });
    testContext.after(() => fs.rmSync(home, { recursive: true, force: true }));
    return {
        directory, commands, errors, responses, view,
        children: item => Array.from(view.treeDataProvider.getChildren(item)),
        item: relativePath => view.treeDataProvider.createItem(
            path.join(directory, relativePath), fs.statSync(path.join(directory, relativePath)).isDirectory()
        )
    };
}

/** Returns the visible names from a harness folder, or from the root. */
function labels(harness, item) {
    return harness.children(item).map(child => child.label);
}

/** Creates notes with recognizable contents so ordering cannot silently alter them. */
function writeNotes(directory, names) {
    for (const name of names) fs.writeFileSync(path.join(directory, name), `Contents of ${name}`);
}

/** Sends a real controller drop with the selected source and target items.
 * @param {object} harness Extension fixture. @param {string} source Source path.
 * @param {string} [target] Target path, or root when omitted. @returns {Promise<void>} Completion. */
async function dropItem(harness, source, target) {
    const transfer = new Map([[MIME_TYPE, { value: [harness.item(source)] }]]);
    await harness.view.dragAndDropController.handleDrop(target ? harness.item(target) : undefined, transfer);
}

test('dragging onto a sibling reorders within its folder without moving files to root', async testContext => {
    const harness = createHarness(testContext);
    const folder = path.join(harness.directory, 'work');
    fs.mkdirSync(folder);
    writeNotes(folder, ['alpha.md', 'middle.md', 'zebra.md']);
    await dropItem(harness, 'work/zebra.md', 'work/alpha.md');
    assert.deepEqual(labels(harness, harness.item('work')), ['zebra.md', 'alpha.md', 'middle.md']);
    await dropItem(harness, 'work/zebra.md', 'work/middle.md');
    assert.deepEqual(labels(harness, harness.item('work')), ['alpha.md', 'zebra.md', 'middle.md']);
    assert.deepEqual(readOrder(folder), ['alpha.md', 'zebra.md', 'middle.md']);
    assert.equal(fs.existsSync(path.join(harness.directory, 'zebra.md')), false);
    assert.equal(fs.readFileSync(path.join(folder, 'zebra.md'), 'utf8'), 'Contents of zebra.md');
    assert.deepEqual(harness.errors, []);
});

test('dropping onto a note in another folder moves there and inserts before that note', async testContext => {
    const harness = createHarness(testContext);
    fs.mkdirSync(path.join(harness.directory, 'work'));
    writeNotes(harness.directory, ['important.md', 'other.md']);
    writeNotes(path.join(harness.directory, 'work'), ['alpha.md', 'middle.md']);
    await harness.commands.get('memopad.moveToTop')(harness.item('other.md'));
    await dropItem(harness, 'important.md', 'work/middle.md');
    assert.deepEqual(labels(harness, harness.item('work')), ['alpha.md', 'important.md', 'middle.md']);
    assert.equal(fs.existsSync(path.join(harness.directory, 'important.md')), false);
    assert.equal(fs.readFileSync(path.join(harness.directory, 'work/important.md'), 'utf8'), 'Contents of important.md');
    assert.deepEqual(readOrder(harness.directory), ['other.md', 'work']);
    await dropItem(harness, 'work/important.md');
    assert.equal(fs.existsSync(path.join(harness.directory, 'important.md')), true);
    assert.deepEqual(labels(harness, harness.item('work')), ['alpha.md', 'middle.md']);
    assert.deepEqual(harness.errors, []);
});

test('dropping onto folders moves inside them and preserves a moved folders internal order', async testContext => {
    const harness = createHarness(testContext);
    fs.mkdirSync(path.join(harness.directory, 'source'));
    fs.mkdirSync(path.join(harness.directory, 'destination'));
    writeNotes(path.join(harness.directory, 'source'), ['alpha.md', 'zebra.md']);
    await harness.commands.get('memopad.moveToTop')(harness.item('source/zebra.md'));
    await dropItem(harness, 'source', 'destination');
    assert.deepEqual(labels(harness, harness.item('destination/source')), ['zebra.md', 'alpha.md']);
    assert.deepEqual(harness.errors, []);
});

test('self drops, descendant drops and conflicting names cannot damage notes', async testContext => {
    const harness = createHarness(testContext);
    fs.mkdirSync(path.join(harness.directory, 'work/nested'), { recursive: true });
    writeNotes(harness.directory, ['alpha.md']);
    writeNotes(path.join(harness.directory, 'work'), ['alpha.md', 'zebra.md']);
    await dropItem(harness, 'work/zebra.md', 'work/zebra.md');
    await dropItem(harness, 'work', 'work');
    assert.equal(readOrder(path.join(harness.directory, 'work')), undefined);
    await dropItem(harness, 'work', 'work/nested');
    await dropItem(harness, 'alpha.md', 'work/zebra.md');
    assert.ok(harness.errors.some(message => message.includes('inside itself')));
    assert.ok(harness.errors.some(message => message.includes('already exists')));
    assert.equal(fs.readFileSync(path.join(harness.directory, 'alpha.md'), 'utf8'), 'Contents of alpha.md');
    assert.deepEqual(labels(harness, harness.item('work')), ['nested', 'alpha.md', 'zebra.md']);
});

test('ordering commands persist independent folder orders without changing note contents', async testContext => {
    const harness = createHarness(testContext);
    fs.mkdirSync(path.join(harness.directory, 'work'));
    writeNotes(harness.directory, ['alpha.md', 'middle.md', 'zebra.md']);
    writeNotes(path.join(harness.directory, 'work'), ['first.md', 'last.md']);
    assert.deepEqual(labels(harness), ['work', 'alpha.md', 'middle.md', 'zebra.md']);
    const zebra = harness.item('zebra.md');
    await harness.commands.get('memopad.moveToTop')(zebra);
    await harness.commands.get('memopad.moveDown')(zebra);
    await harness.commands.get('memopad.moveUp')(harness.item('middle.md'));
    assert.deepEqual(labels(harness), ['work', 'zebra.md', 'middle.md', 'alpha.md']);
    await harness.commands.get('memopad.moveToTop')(harness.item('work/last.md'));
    assert.deepEqual(labels(harness, harness.item('work')), ['last.md', 'first.md']);
    assert.deepEqual(readOrder(harness.directory), ['work', 'zebra.md', 'middle.md', 'alpha.md']);
    const freshModulePath = require.resolve('../note-order');
    delete require.cache[freshModulePath];
    const freshOrder = require('../note-order');
    const persistedNames = freshOrder.sortEntries(
        fs.readdirSync(harness.directory, { withFileTypes: true }), freshOrder.readOrder(harness.directory)
    ).map(entry => entry.name);
    assert.deepEqual(persistedNames, ['work', 'zebra.md', 'middle.md', 'alpha.md']);
    assert.equal(fs.readFileSync(zebra.resourceUri.fsPath, 'utf8'), 'Contents of zebra.md');
    assert.deepEqual(harness.errors, []);
});

test('new notes append and reset affects only the selected folder', async testContext => {
    const harness = createHarness(testContext);
    fs.mkdirSync(path.join(harness.directory, 'work'));
    writeNotes(harness.directory, ['alpha.md', 'zebra.md']);
    writeNotes(path.join(harness.directory, 'work'), ['alpha.md', 'zebra.md']);
    await harness.commands.get('memopad.moveToTop')(harness.item('zebra.md'));
    await harness.commands.get('memopad.moveToTop')(harness.item('work/zebra.md'));
    harness.responses.push('aardvark.md');
    await harness.commands.get('memopad.addNote')(harness.item('work'));
    assert.deepEqual(labels(harness, harness.item('work')), ['zebra.md', 'alpha.md', 'aardvark.md']);
    await harness.commands.get('memopad.resetOrder')(harness.item('work'));
    assert.deepEqual(labels(harness, harness.item('work')), ['aardvark.md', 'alpha.md', 'zebra.md']);
    assert.deepEqual(labels(harness), ['zebra.md', 'work', 'alpha.md']);
    await harness.commands.get('memopad.resetOrder')();
    assert.deepEqual(labels(harness), ['work', 'alpha.md', 'zebra.md']);
    assert.equal(fs.readFileSync(path.join(harness.directory, 'work/aardvark.md'), 'utf8'), '');
});

test('renaming a folder preserves its position and the order of notes inside it', async testContext => {
    const harness = createHarness(testContext);
    fs.mkdirSync(path.join(harness.directory, 'work'));
    writeNotes(harness.directory, ['alpha.md']);
    writeNotes(path.join(harness.directory, 'work'), ['alpha.md', 'zebra.md']);
    await harness.commands.get('memopad.moveToTop')(harness.item('alpha.md'));
    await harness.commands.get('memopad.moveToTop')(harness.item('work/zebra.md'));
    harness.responses.push('renamed');
    await harness.commands.get('memopad.renameItem')(harness.item('work'));
    assert.deepEqual(labels(harness), ['alpha.md', 'renamed']);
    assert.deepEqual(readOrder(harness.directory), ['alpha.md', 'renamed']);
    assert.deepEqual(labels(harness, harness.item('renamed')), ['zebra.md', 'alpha.md']);
    harness.responses.push('important.md');
    await harness.commands.get('memopad.renameItem')(harness.item('renamed/zebra.md'));
    assert.deepEqual(labels(harness, harness.item('renamed')), ['important.md', 'alpha.md']);
});

test('renaming into an externally deleted name preserves order without duplicate metadata', async testContext => {
    const harness = createHarness(testContext);
    writeNotes(harness.directory, ['alpha.md', 'middle.md', 'zebra.md']);
    await harness.commands.get('memopad.moveToTop')(harness.item('zebra.md'));
    fs.unlinkSync(path.join(harness.directory, 'alpha.md'));
    harness.responses.push('alpha.md');
    await harness.commands.get('memopad.renameItem')(harness.item('zebra.md'));
    assert.deepEqual(readOrder(harness.directory), ['alpha.md', 'middle.md']);
    assert.deepEqual(labels(harness), ['alpha.md', 'middle.md']);
    assert.equal(fs.readFileSync(path.join(harness.directory, 'alpha.md'), 'utf8'), 'Contents of zebra.md');
    assert.deepEqual(harness.errors, []);
});

test('renaming a note to a hidden name keeps the remaining custom order valid', async testContext => {
    const harness = createHarness(testContext);
    writeNotes(harness.directory, ['alpha.md', 'middle.md', 'zebra.md']);
    await harness.commands.get('memopad.moveToTop')(harness.item('zebra.md'));
    harness.responses.push('.hidden.md');
    await harness.commands.get('memopad.renameItem')(harness.item('zebra.md'));
    assert.deepEqual(readOrder(harness.directory), ['alpha.md', 'middle.md']);
    assert.deepEqual(labels(harness), ['alpha.md', 'middle.md']);
    assert.equal(fs.readFileSync(path.join(harness.directory, '.hidden.md'), 'utf8'), 'Contents of zebra.md');
    assert.deepEqual(harness.errors, []);
});

test('moving and deleting notes remove stale positions and keep their contents intact', async testContext => {
    const harness = createHarness(testContext);
    fs.mkdirSync(path.join(harness.directory, 'work'));
    writeNotes(harness.directory, ['alpha.md', 'zebra.md']);
    writeNotes(path.join(harness.directory, 'work'), ['first.md', 'last.md']);
    await harness.commands.get('memopad.moveToTop')(harness.item('zebra.md'));
    await harness.commands.get('memopad.moveToTop')(harness.item('work/last.md'));
    const transfer = new Map([[MIME_TYPE, { value: [harness.item('zebra.md')] }]]);
    await harness.view.dragAndDropController.handleDrop(harness.item('work'), transfer);
    assert.deepEqual(readOrder(harness.directory), ['work', 'alpha.md']);
    assert.deepEqual(labels(harness, harness.item('work')), ['last.md', 'first.md', 'zebra.md']);
    assert.equal(fs.readFileSync(path.join(harness.directory, 'work/zebra.md'), 'utf8'), 'Contents of zebra.md');
    await harness.commands.get('memopad.deleteItem')(harness.item('work/last.md'));
    assert.deepEqual(readOrder(path.join(harness.directory, 'work')), ['first.md']);
    assert.deepEqual(labels(harness, harness.item('work')), ['first.md', 'zebra.md']);
});

test('boundary moves do not write metadata or wrap items around', async testContext => {
    const harness = createHarness(testContext);
    writeNotes(harness.directory, ['alpha.md', 'zebra.md']);
    assert.equal(moveItem(path.join(harness.directory, 'alpha.md'), MOVE_UP), false);
    assert.equal(moveItem(path.join(harness.directory, 'zebra.md'), MOVE_DOWN), false);
    await harness.commands.get('memopad.moveToTop')(harness.item('alpha.md'));
    assert.equal(readOrder(harness.directory), undefined);
    await harness.commands.get('memopad.moveUp')();
    assert.deepEqual(labels(harness), ['alpha.md', 'zebra.md']);
    assert.deepEqual(harness.errors, []);
});

test('broken metadata leaves notes visible, reports the problem and can be reset', async testContext => {
    const harness = createHarness(testContext);
    writeNotes(harness.directory, ['alpha.md', 'zebra.md']);
    const metadataPath = path.join(harness.directory, '.memopad-order.json');
    for (const content of ['{broken', '["../alpha.md"]', '["alpha.md", "alpha.md"]']) {
        fs.writeFileSync(metadataPath, content);
        assert.deepEqual(labels(harness), ['alpha.md', 'zebra.md']);
        await harness.commands.get('memopad.moveToTop')(harness.item('zebra.md'));
        assert.equal(fs.readFileSync(metadataPath, 'utf8'), content);
    }
    assert.ok(harness.errors.some(message => message.startsWith('Cannot load custom order')));
    assert.ok(harness.errors.some(message => message.startsWith('Failed to change order')));
    await harness.commands.get('memopad.resetOrder')();
    await harness.commands.get('memopad.moveToTop')(harness.item('zebra.md'));
    assert.deepEqual(labels(harness), ['zebra.md', 'alpha.md']);
});

test('failed atomic writes preserve the saved order and clean up temporary files', testContext => {
    const harness = createHarness(testContext);
    writeNotes(harness.directory, ['alpha.md', 'zebra.md']);
    moveItem(path.join(harness.directory, 'zebra.md'), 'top');
    const originalRename = fs.renameSync;
    testContext.mock.method(fs, 'renameSync', (source, destination) => {
        if (destination.endsWith('.memopad-order.json')) throw new Error('Save failed');
        return originalRename(source, destination);
    });
    assert.throws(() => moveItem(path.join(harness.directory, 'zebra.md'), MOVE_DOWN), /Save failed/);
    assert.deepEqual(readOrder(harness.directory), ['zebra.md', 'alpha.md']);
    assert.deepEqual(fs.readdirSync(harness.directory).sort(), ['.memopad-order.json', 'alpha.md', 'zebra.md']);
});
