# Memopad Development Guide

## Project Overview
Memopad is a VS Code extension that saves notes and prompts in the sidebar for quick access. Notes are stored as plain text files in `~/.memopad`.

## Key Features
- Hierarchical folder organization
- Drag and drop to move files and folders
- Create, rename, delete notes and folders
- Copy note contents to clipboard
- Auto-refresh on file system changes

## Architecture

### File Structure
- `extension.js` - Main extension code (single file, CommonJS)
- `package.json` - VS Code extension manifest
- `.vscode/launch.json` - Debug configuration

### Storage
- Location: `~/.memopad` (user home directory)
- Format: Plain text files in hierarchical folder structure
- No database, pure filesystem

### Key Components

**Helper Functions** (`extension.js:78-80`)
- `getTargetDirectory(item)` - Returns target directory for operations (folder path or NOTES_DIR)
- Used by: addNote, addFolder, drag and drop handler

**NotesProvider Class** (`extension.js:12-76`)
- Implements VS Code TreeDataProvider interface
- `getChildren()` - Recursively loads folder contents using `fs.readdirSync` with `withFileTypes` option for performance
- `getParent()` - Required for drag and drop support
- Items sorted: folders first, then files (alphabetically)

**Drag and Drop** (`extension.js:84-118`)
- Uses VS Code's native drag and drop API
- Handles moving files/folders between locations
- Validates target paths and prevents duplicates
- Uses `getTargetDirectory()` helper for consistency

**Commands**
- `memopad.addNote` - Create note (in root or selected folder)
- `memopad.addFolder` - Create folder (supports nested folders)
- `memopad.copyNote` - Copy note content to clipboard
- `memopad.deleteItem` - Delete file or folder (recursive for folders)
- `memopad.renameItem` - Rename file or folder
- `memopad.refresh` - Manual refresh

**File Watcher** (`extension.js:123-128`)
- Pattern: `**/*` (watches all nested files)
- Auto-refreshes tree on create/delete/change

## Performance Optimizations

1. **Efficient directory reading** - Uses `fs.readdirSync(directory, { withFileTypes: true })` to avoid duplicate `fs.statSync()` calls
2. **Contextual operations** - Uses `item.contextValue` instead of filesystem calls when possible
3. **DRY principle** - Extracted `getTargetDirectory()` helper to reduce code duplication

## Testing Locally

To test the extension during development:

```bash
code --extensionDevelopmentPath=/Users/gundurraga/Desktop/indie-dev/memopad
```

This opens a new VS Code window with your local extension loaded. The marketplace version stays unchanged until you publish.

**Alternative (using F5):**
1. Ensure `.vscode/launch.json` exists
2. Press F5 or use Run > Start Debugging
3. New window opens with extension active

## Development Guidelines

- All files should be kebab-case
- Keep code simple, readable, maintainable
- No legacy or dead code
- Use `npm run lint` for linting
- Never commit without explicit user request
- Avoid disabling linter rules
- Branch naming: `feature/`, `fix/`, `refactor/`, `docs/` prefixes (e.g., `feature/add-folders`)

## Publishing

When ready to publish a new version:
1. Update version in `package.json`
2. Test thoroughly with local extension
3. Publish to marketplace (separate process)
