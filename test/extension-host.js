const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vscode = require('vscode');

/** Exercises ordering commands in real VS Code using an isolated home. @returns {Promise<void>} Completion. */
async function run() {
    const workspaceDirectory = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const notesDirectory = path.join(workspaceDirectory, '.memopad');
    const resultPath = path.join(workspaceDirectory, 'host-result.json');
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    let steps = 0;
    const writeResult = result => {
        const temporaryPath = `${resultPath}.tmp`;
        fs.writeFileSync(temporaryPath, JSON.stringify(result));
        fs.renameSync(temporaryPath, resultPath);
    };
    const recordProgress = () => writeResult({ passed: false, steps: ++steps });
    const item = name => {
        const entry = new vscode.TreeItem(name);
        entry.resourceUri = vscode.Uri.file(path.join(notesDirectory, name));
        entry.id = `0:${entry.resourceUri.fsPath}`;
        entry.contextValue = 'note';
        return entry;
    };
    const readOrder = () => JSON.parse(fs.readFileSync(path.join(notesDirectory, '.memopad-order.json'), 'utf8'));
    try {
        const extension = vscode.extensions.getExtension('gundurraga.memopad');
        assert.ok(extension, 'Memopad development extension is available');
        assert.equal(extension.isActive, false, 'Memopad must activate only after test home isolation');
        process.env.HOME = workspaceDirectory;
        process.env.USERPROFILE = workspaceDirectory;
        assert.equal(os.homedir(), workspaceDirectory, 'Test home must be isolated before activating Memopad');
        fs.mkdirSync(notesDirectory);
        for (const name of ['alpha.md', 'middle.md', 'zebra.md']) {
            fs.writeFileSync(path.join(notesDirectory, name), `Contents of ${name}`);
        }
        await extension.activate();
        recordProgress();
        await vscode.commands.executeCommand('memopad.moveToTop', item('zebra.md'));
        assert.deepEqual(readOrder(), ['zebra.md', 'alpha.md', 'middle.md']);
        recordProgress();
        await vscode.commands.executeCommand('memopad.moveDown', item('zebra.md'));
        await vscode.commands.executeCommand('memopad.moveUp', item('middle.md'));
        assert.deepEqual(readOrder(), ['alpha.md', 'middle.md', 'zebra.md']);
        recordProgress();
        await vscode.commands.executeCommand('memopad.moveToTop', item('middle.md'));
        assert.deepEqual(readOrder(), ['middle.md', 'alpha.md', 'zebra.md']);
        assert.equal(fs.readFileSync(path.join(notesDirectory, 'middle.md'), 'utf8'), 'Contents of middle.md');
        recordProgress();
        await vscode.commands.executeCommand('memopad.resetOrder');
        assert.equal(fs.existsSync(path.join(notesDirectory, '.memopad-order.json')), false);
        recordProgress();
        writeResult({ passed: true, steps });
    } catch (error) {
        writeResult({ passed: false, steps, error: error.stack || error.message });
        throw error;
    } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
    }
}

module.exports = { run };
