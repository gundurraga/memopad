const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const ORDER_FILE = '.memopad-order.json';
const MOVE_UP = -1;
const MOVE_DOWN = 1;

/** Reads saved order. @param {string} directory Folder. @returns {string[]|undefined} Saved names, if present. */
function readOrder(directory) {
    let content;
    try {
        content = fs.readFileSync(path.join(directory, ORDER_FILE), 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
    }
    const names = JSON.parse(content);
    if (!Array.isArray(names) || names.some(name =>
        typeof name !== 'string' || !name || name.startsWith('.') || path.basename(name) !== name
    ) || new Set(names).size !== names.length) {
        throw new Error(`Invalid custom order in ${directory}`);
    }
    return names;
}

/** Sorts entries by saved names, then folders and names for new entries.
 * @param {import('fs').Dirent[]} entries Directory entries. @param {string[]} [savedOrder] Arranged names.
 * @returns {import('fs').Dirent[]} Visible entries in display order. */
function sortEntries(entries, savedOrder = []) {
    const positions = new Map(savedOrder.map((name, index) => [name, index]));
    return entries.filter(entry => !entry.name.startsWith('.')).sort((first, second) => {
        const firstPosition = positions.get(first.name) ?? Infinity;
        const secondPosition = positions.get(second.name) ?? Infinity;
        if (firstPosition !== secondPosition) return firstPosition - secondPosition;
        if (first.isDirectory() !== second.isDirectory()) return first.isDirectory() ? -1 : 1;
        return first.name.localeCompare(second.name);
    });
}

/** Saves atomically so an interrupted write preserves the previous order.
 * @param {string} directory Folder. @param {string[]} names Display order. @returns {void} */
function saveOrder(directory, names) {
    const orderPath = path.join(directory, ORDER_FILE);
    const temporaryPath = `${orderPath}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(names, null, 2)}\n`, { flag: 'wx' });
        fs.renameSync(temporaryPath, orderPath);
    } finally {
        fs.rmSync(temporaryPath, { force: true });
    }
}

/** Moves an item within its folder.
 * @param {string} itemPath Item path. @param {'top'|number} direction Position or offset.
 * @returns {boolean} Whether the order changed. */
function moveItem(itemPath, direction) {
    const directory = path.dirname(itemPath);
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    const names = sortEntries(entries, readOrder(directory)).map(entry => entry.name);
    const index = names.indexOf(path.basename(itemPath));
    if (index === -1) return false;
    const destination = direction === 'top' ? 0 : index + direction;
    if (destination < 0 || destination >= names.length || destination === index) return false;
    names.splice(destination, 0, names.splice(index, 1)[0]);
    saveOrder(directory, names);
    return true;
}

/** Places an item before a sibling after a drop onto that sibling.
 * @param {string} itemPath Dragged item. @param {string} targetPath Target item.
 * @returns {boolean} Whether the order changed. */
function placeItemBefore(itemPath, targetPath) {
    const directory = path.dirname(itemPath);
    if (path.dirname(targetPath) !== directory || itemPath === targetPath) return false;
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    const names = sortEntries(entries, readOrder(directory)).map(entry => entry.name);
    const sourceIndex = names.indexOf(path.basename(itemPath));
    const targetIndex = names.indexOf(path.basename(targetPath));
    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex + 1 === targetIndex) return false;
    names.splice(sourceIndex, 1);
    names.splice(names.indexOf(path.basename(targetPath)), 0, path.basename(itemPath));
    saveOrder(directory, names);
    return true;
}

/** Restores default order. @param {string} directory Folder. @returns {void} */
function resetOrder(directory) {
    fs.rmSync(path.join(directory, ORDER_FILE), { force: true });
}

/** Preserves a renamed item's position, or removes a deleted or moved item.
 * @param {string} sourcePath Original path. @param {string} [destinationPath] New path, if present.
 * @returns {void} */
function updateItemOrder(sourcePath, destinationPath) {
    const directory = path.dirname(sourcePath);
    const names = readOrder(directory);
    const sourceName = path.basename(sourcePath);
    if (!names?.includes(sourceName)) return;
    const destinationName = destinationPath && path.basename(destinationPath);
    const renamedInPlace = destinationPath && path.dirname(destinationPath) === directory
        && !destinationName.startsWith('.');
    const updatedNames = renamedInPlace
        ? names.filter(name => name !== destinationName || name === sourceName)
            .map(name => name === sourceName ? destinationName : name)
        : names.filter(name => name !== sourceName);
    saveOrder(directory, updatedNames);
}

module.exports = { MOVE_UP, MOVE_DOWN, readOrder, sortEntries, moveItem, placeItemBefore, resetOrder, updateItemOrder };
