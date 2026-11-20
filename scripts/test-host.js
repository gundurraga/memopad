const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const PROJECT_DIRECTORY = path.resolve(__dirname, '..');
const TIMEOUT_MILLISECONDS = 60000;
const REPORT_INTERVAL_MILLISECONDS = 10000;
const RESULT_INTERVAL_MILLISECONDS = 250;
const TOTAL_STEPS = 5;
const CLEANUP_TIMEOUT_MILLISECONDS = 5000;
const CLEANUP_INTERVAL_MILLISECONDS = 100;

if (!process.env.STUDIO_HEAVY_SLOT) {
    const queued = spawnSync('heavy', ['run', '--label', 'memopad VS Code host', '--', process.execPath, __filename], { stdio: 'inherit' });
    if (queued.error?.code !== 'ENOENT') {
        if (queued.error) throw queued.error;
        process.exit(queued.status ?? 1);
    }
}

/** Stops only the disposable VS Code profile before removing its files.
 * @param {string} profileDirectory Test profile. @returns {Promise<void>} Process shutdown. */
async function stopTestHost(profileDirectory) {
    spawnSync('pkill', ['-f', profileDirectory]);
    const deadline = Date.now() + CLEANUP_TIMEOUT_MILLISECONDS;
    while (spawnSync('pgrep', ['-f', profileDirectory]).status === 0) {
        if (Date.now() >= deadline) {
            spawnSync('pkill', ['-KILL', '-f', profileDirectory]);
            throw new Error(`Test profile did not stop cleanly: ${profileDirectory}`);
        }
        await new Promise(resolve => setTimeout(resolve, CLEANUP_INTERVAL_MILLISECONDS));
    }
}

/** Runs VS Code with disposable settings and notes. @returns {Promise<void>} Test completion. */
async function run() {
    const directory = fs.mkdtempSync(path.join(PROJECT_DIRECTORY, '.test-order-host-'));
    const profileDirectory = path.join(directory, 'profile');
    const workspaceDirectory = path.join(directory, 'workspace');
    const extensionsDirectory = path.join(directory, 'extensions');
    const resultPath = path.join(workspaceDirectory, 'host-result.json');
    for (const folder of [path.join(profileDirectory, 'User'), workspaceDirectory, extensionsDirectory]) {
        fs.mkdirSync(folder, { recursive: true });
    }
    fs.writeFileSync(path.join(profileDirectory, 'User', 'settings.json'), JSON.stringify({
        'workbench.startupEditor': 'none', 'telemetry.telemetryLevel': 'off',
        'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
        'window.restoreWindows': 'none', 'security.workspace.trust.enabled': false
    }));
    let previousProgress = 0;
    const reporter = setInterval(() => {
        const progress = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, 'utf8')).steps : 0;
        console.log(`VS Code: ${progress}/${TOTAL_STEPS} steps complete${progress === previousProgress ? ', no new progress' : ''}. Timeout: 60 seconds.`);
        previousProgress = progress;
    }, REPORT_INTERVAL_MILLISECONDS);
    try {
        console.log(`Opening isolated VS Code, 0/${TOTAL_STEPS} steps complete.`);
        await new Promise((resolve, reject) => {
            const child = spawn('code', [
                '--new-window', '--user-data-dir', profileDirectory,
                '--extensions-dir', extensionsDirectory,
                `--extensionDevelopmentPath=${PROJECT_DIRECTORY}`,
                `--extensionTestsPath=${path.join(PROJECT_DIRECTORY, 'test', 'extension-host.js')}`,
                workspaceDirectory
            ], { stdio: 'inherit' });
            let settled = false;
            const finish = error => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                clearInterval(resultPoller);
                if (error) reject(error);
                else resolve();
            };
            const resultPoller = setInterval(() => {
                if (!fs.existsSync(resultPath)) return;
                try {
                    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
                    if (result.error) finish(new Error(result.error));
                    if (result.passed) finish();
                } catch (error) {
                    finish(error);
                }
            }, RESULT_INTERVAL_MILLISECONDS);
            const timeout = setTimeout(() => {
                child.kill('SIGTERM');
                finish(new Error('VS Code host timed out'));
            }, TIMEOUT_MILLISECONDS);
            child.on('error', finish);
            child.on('exit', code => {
                if (code !== 0) finish(new Error(`VS Code launcher exited with ${code}`));
            });
        });
        assert.ok(fs.existsSync(resultPath), 'VS Code exited before reporting results');
        assert.deepEqual(JSON.parse(fs.readFileSync(resultPath, 'utf8')), { passed: true, steps: TOTAL_STEPS });
        console.log(`VS Code host passed, ${TOTAL_STEPS}/${TOTAL_STEPS} steps complete.`);
    } catch (error) {
        console.error(`Host logs: ${profileDirectory}/logs`);
        throw error;
    } finally {
        clearInterval(reporter);
        await stopTestHost(profileDirectory);
    }
    fs.rmSync(directory, { recursive: true, force: true });
}

run().catch(error => { console.error(error); process.exitCode = 1; });
