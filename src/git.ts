import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { GitChange } from './types';

/**
 * Get the root directory of the current git repository.
 */
export function getRepoRoot(cwd: string = process.cwd()): string {
    try {
        return execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8' }).trim();
    } catch {
        throw new Error('Not inside a git repository.');
    }
}

/**
 * Get the list of files changed between the remote tracking branch and HEAD.
 * This is used inside the pre-push hook context.
 *
 * @param remote  - remote name (e.g. "origin"), from $1 in pre-push hook
 * @param branch  - remote branch (e.g. "main"), derived from $2
 * @param cwd     - repository root
 */
export function getChangedFilesForPush(
    remote: string,
    remoteBranch: string,
    cwd: string
): GitChange[] {
    // remoteBranch from hook is a full ref like "refs/heads/main"
    const shortBranch = remoteBranch.replace(/^refs\/heads\//, '');
    const remoteRef = `${remote}/${shortBranch}`;

    // Check whether the remote ref exists (might not exist on first push)
    let baseRef: string;
    try {
        execSync(`git rev-parse --verify ${remoteRef}`, { cwd, encoding: 'utf8', stdio: 'pipe' });
        baseRef = remoteRef;
    } catch {
        // First push: diff against empty tree
        baseRef = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    }

    return parseDiffOutput(
        execSync(`git diff --name-status -M ${baseRef}..HEAD`, { cwd, encoding: 'utf8' })
    );
}

/**
 * Get all changed files between the last commit and working tree
 * (for manual `gty sync` usage outside of a hook).
 */
export function getChangedFilesSinceRemote(cwd: string): GitChange[] {
    // Try to get upstream tracking branch
    let baseRef: string;
    try {
        baseRef = execSync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', {
            cwd, encoding: 'utf8', stdio: 'pipe',
        }).trim();
    } catch {
        // No upstream - diff against empty tree
        baseRef = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    }

    return parseDiffOutput(
        execSync(`git diff --name-status -M ${baseRef}..HEAD`, { cwd, encoding: 'utf8' })
    );
}

/**
 * Parse the output of `git diff --name-status` into GitChange objects.
 * Line format: <status>\t<path>   or   R<score>\t<old>\t<new>
 */
function parseDiffOutput(output: string): GitChange[] {
    const changes: GitChange[] = [];
    const lines = output.trim().split('\n').filter(Boolean);

    for (const line of lines) {
        const parts = line.split('\t');
        const statusCode = parts[0].trim();

        if (statusCode.startsWith('R')) {
            // Renamed
            changes.push({ type: 'renamed', path: parts[2], oldPath: parts[1] });
        } else if (statusCode === 'A' || statusCode === 'C') {
            changes.push({ type: 'added', path: parts[1] });
        } else if (statusCode === 'M') {
            changes.push({ type: 'modified', path: parts[1] });
        } else if (statusCode === 'D') {
            changes.push({ type: 'deleted', path: parts[1] });
        }
    }

    return changes;
}

/**
 * Read the content of a file (relative to repoRoot).
 */
export function readFileContent(relativePath: string, repoRoot: string): string {
    const absPath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absPath)) {
        throw new Error(`File not found: ${absPath}`);
    }
    return fs.readFileSync(absPath, 'utf8');
}

/**
 * Get all markdown files currently staged (added, copied, modified, renamed).
 * Used by the pre-commit hook to check only what's about to be committed.
 */
export function getStagedMarkdownFiles(cwd: string): string[] {
    const output = execSync(
        'git diff --cached --name-only --diff-filter=ACMR',
        { cwd, encoding: 'utf8' }
    );
    return output.split('\n').filter(f => f && /\.(md|markdown|mdx)$/i.test(f));
}

/**
 * Get ALL markdown files tracked by git in the repo.
 * Used for a full-repo slug conflict scan.
 */
export function getAllTrackedMarkdownFiles(cwd: string): string[] {
    const output = execSync('git ls-files', { cwd, encoding: 'utf8' });
    return output.split('\n').filter(f => f && /\.(md|markdown|mdx)$/i.test(f));
}

/**
 * Derive a list of unique directory paths from a set of file paths.
 * e.g. "docs/guide/intro.md" → ["docs", "docs/guide"]
 */
export function extractDirs(filePaths: string[]): string[] {
    const dirs = new Set<string>();
    for (const filePath of filePaths) {
        const parts = filePath.split('/');
        for (let i = 1; i < parts.length; i++) {
            dirs.add(parts.slice(0, i).join('/'));
        }
    }
    return [...dirs].sort();
}

/**
 * Detect directories that were added or removed.
 * A directory is "added" if at least one of its new files was added
 * and no files in that directory existed before.
 *
 * For simplicity, we track added dirs from added/renamed files
 * and deleted dirs from deleted files (only if completely empty after).
 */
export function detectDirChanges(changes: GitChange[]): {
    addedDirs: string[];
    deletedDirs: string[];
} {
    const addedFileDirs = new Set<string>();
    const deletedFileDirs = new Set<string>();

    for (const change of changes) {
        if (change.type === 'added' || change.type === 'renamed') {
            const dir = change.path.includes('/') ? change.path.split('/').slice(0, -1).join('/') : '';
            if (dir) addedFileDirs.add(dir);
        }
        if (change.type === 'deleted') {
            const dir = change.path.includes('/') ? change.path.split('/').slice(0, -1).join('/') : '';
            if (dir) deletedFileDirs.add(dir);
        }
    }

    // Directories that are only in deleted (not in added) are potentially removed
    const addedDirs = [...addedFileDirs];
    const deletedDirs = [...deletedFileDirs].filter(d => !addedFileDirs.has(d));

    return { addedDirs, deletedDirs };
}
