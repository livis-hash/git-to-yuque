import * as path from 'path';
import chalk from 'chalk';
import { GtyConfig, SyncResult, YuqueTocItem, GitChange } from './types';
import { YuqueClient } from './yuque-client';
import { readFileContent } from './git';
import { matchFiles, getAllDirPaths, isExcluded, isMarkdown } from './mapper';

interface TocIndex {
    /** Map from directory path (e.g. "docs/guide") to its TOC TITLE node UUID */
    dirToUuid: Map<string, string>;
    /** Map from doc slug to TOC DOC node UUID */
    slugToUuid: Map<string, string>;
    /** Map from doc slug to doc ID */
    slugToDocId: Map<string, number>;
    /** Map from UUID to TocItem (for deletion lookups) */
    uuidToItem: Map<string, YuqueTocItem>;
    /** Map from TITLE node title (lowercase) to UUID (for existing groups) */
    titleToUuid: Map<string, string>;
}

/**
 * Build an index from a flat TOC array.
 * The TOC API returns items in a flat list with parent_uuid references.
 */
function buildTocIndex(items: YuqueTocItem[]): TocIndex {
    const uuidToItem = new Map<string, YuqueTocItem>();
    const dirToUuid = new Map<string, string>();
    const slugToUuid = new Map<string, string>();
    const slugToDocId = new Map<string, number>();
    const titleToUuid = new Map<string, string>();

    for (const item of items) {
        uuidToItem.set(item.uuid, item);
    }

    // Build full path for each node by traversing parent chain
    function getFullPath(uuid: string): string {
        const item = uuidToItem.get(uuid);
        if (!item) return '';
        if (!item.parent_uuid) return item.title;
        const parentPath = getFullPath(item.parent_uuid);
        return parentPath ? `${parentPath}/${item.title}` : item.title;
    }

    for (const item of items) {
        if (item.type === 'TITLE') {
            // Register by title (case-insensitive) for lookup
            titleToUuid.set(item.title.toLowerCase(), item.uuid);
            // Also store with parent path hierarchy
            const fullPath = getFullPath(item.uuid);
            dirToUuid.set(fullPath, item.uuid);
        } else if (item.type === 'DOC' && item.url) {
            slugToUuid.set(item.url, item.uuid);
            if (item.doc_id) {
                slugToDocId.set(item.url, item.doc_id);
            }
        }
    }

    return { dirToUuid, slugToUuid, slugToDocId, uuidToItem, titleToUuid };
}

/**
 * Ensure all directory segments exist as TITLE nodes in TOC.
 * Creates them in order (parent before child).
 * Returns the UUID of the deepest (leaf) group.
 */
async function ensureTocGroups(
    dirSegments: string[],
    tocIndex: TocIndex,
    client: YuqueClient,
    dryRun: boolean
): Promise<string> {
    let parentUuid = '';
    let currentPath = '';

    for (const segment of dirSegments) {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;

        if (tocIndex.dirToUuid.has(currentPath)) {
            // Group already exists
            parentUuid = tocIndex.dirToUuid.get(currentPath)!;
        } else {
            // Create the group
            if (!dryRun) {
                console.log(chalk.blue(`  📁 Creating TOC group: ${currentPath}`));
                const updatedToc = await client.addTocGroup(segment, parentUuid);
                // Find the newly created node
                const newNode = updatedToc.find(
                    n => n.type === 'TITLE' && n.title === segment && n.parent_uuid === parentUuid
                );
                if (newNode) {
                    tocIndex.dirToUuid.set(currentPath, newNode.uuid);
                    tocIndex.uuidToItem.set(newNode.uuid, newNode);
                    parentUuid = newNode.uuid;
                }
            } else {
                console.log(chalk.blue(`  📁 [dry-run] Would create TOC group: ${currentPath}`));
                // Use a fake UUID for dry-run to allow nested processing
                const fakeUuid = `dry-run-${currentPath}`;
                tocIndex.dirToUuid.set(currentPath, fakeUuid);
                parentUuid = fakeUuid;
            }
        }
    }

    return parentUuid;
}

export async function syncChanges(options: {
    config: GtyConfig;
    repoRoot: string;
    changes: GitChange[];
    dryRun?: boolean;
}): Promise<SyncResult[]> {
    const { config, repoRoot, changes, dryRun = false } = options;
    const results: SyncResult[] = [];
    const client = new YuqueClient(config);

    if (changes.length === 0) {
        console.log(chalk.gray('No file changes detected.'));
        return results;
    }

    // Fetch current TOC
    console.log(chalk.gray('Fetching current TOC...'));
    let tocItems: YuqueTocItem[] = [];
    if (!dryRun) {
        tocItems = await client.getToc();
    }
    const tocIndex = buildTocIndex(tocItems);

    // Split changes by type
    const fileChanges = changes.filter(c => isMarkdown(c.path) && !isExcluded(c.path, config.exclude));
    const deletedFiles = fileChanges.filter(c => c.type === 'deleted');
    const upsertFiles = fileChanges.filter(c => c.type !== 'deleted');

    // ----------------------------------------------------------------
    // Step 1: Handle deleted files → remove from TOC
    // ----------------------------------------------------------------
    for (const change of deletedFiles) {
        const slug = tocIndex.slugToUuid.has(change.path)
            ? change.path
            : undefined;

        if (config.syncFolders) {
            const nodeUuid = slug ? tocIndex.slugToUuid.get(change.path) : undefined;
            if (nodeUuid) {
                if (!dryRun) {
                    console.log(chalk.red(`  🗑  Removing TOC node for: ${change.path}`));
                    await client.removeTocNode(nodeUuid, false);
                } else {
                    console.log(chalk.red(`  🗑  [dry-run] Would remove TOC node: ${change.path}`));
                }
                results.push({ file: change.path, status: dryRun ? 'dry-run' : 'deleted' });
            } else {
                results.push({ file: change.path, status: 'skipped', error: 'No TOC node found' });
            }
        } else {
            results.push({ file: change.path, status: 'skipped' });
        }
    }

    // ----------------------------------------------------------------
    // Step 2: Handle upsert files (added / modified / renamed)
    // ----------------------------------------------------------------
    const matched = matchFiles(upsertFiles, config);

    // Collect all dir paths needed across all files, sorted parent-first
    if (config.syncFolders && matched.length > 0) {
        const allDirPaths = getAllDirPaths(matched.map(f => f.relativePath));
        // Pre-create all needed groups
        for (const dirPath of allDirPaths) {
            if (!tocIndex.dirToUuid.has(dirPath)) {
                const segments = dirPath.split('/');
                await ensureTocGroups(segments, tocIndex, client, dryRun);
            }
        }
    }

    for (const mf of matched) {
        const { relativePath, docSlug, title, dirSegments, changeType } = mf;

        try {
            console.log(chalk.cyan(`  📄 ${changeType}: ${relativePath} → slug: ${docSlug}`));

            if (dryRun) {
                results.push({ file: relativePath, status: 'dry-run', docSlug });
                continue;
            }

            // Read file content
            const body = readFileContent(relativePath, repoRoot);

            // Determine parent group UUID
            const parentUuid = config.syncFolders && dirSegments.length > 0
                ? await ensureTocGroups(dirSegments, tocIndex, client, dryRun)
                : '';

            // Check whether doc already exists
            const existingDoc = await client.getDoc(docSlug);

            if (existingDoc) {
                // Update existing doc
                const updated = await client.updateDoc(existingDoc.id, { body, title });
                console.log(chalk.green(`    ✅ Updated: ${docSlug} (id=${updated.id})`));

                // Ensure the doc node is in TOC (it might have been created without TOC entry)
                if (!tocIndex.slugToUuid.has(docSlug)) {
                    await client.addTocDoc([updated.id], parentUuid);
                    tocIndex.slugToDocId.set(docSlug, updated.id);
                }

                results.push({ file: relativePath, status: 'updated', docSlug, docId: updated.id });
            } else {
                if (config.syncMode === 'update-only') {
                    console.log(chalk.yellow(`    ⏭  Skipped (update-only mode): ${docSlug}`));
                    results.push({ file: relativePath, status: 'skipped', docSlug });
                    continue;
                }

                // Create new doc
                const created = await client.createDoc({ slug: docSlug, title, body });
                console.log(chalk.green(`    ✅ Created: ${docSlug} (id=${created.id})`));

                // Add to TOC under the correct parent group
                const updatedToc = await client.addTocDoc([created.id], parentUuid);
                // Update local index with new entries
                const newDocNode = updatedToc.find(n => n.type === 'DOC' && n.doc_id === created.id);
                if (newDocNode) {
                    tocIndex.slugToUuid.set(docSlug, newDocNode.uuid);
                    tocIndex.slugToDocId.set(docSlug, created.id);
                }

                results.push({ file: relativePath, status: 'created', docSlug, docId: created.id });
            }
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`    ❌ Error syncing ${relativePath}: ${error}`));
            results.push({ file: relativePath, status: 'error', docSlug, error });
        }
    }

    // ----------------------------------------------------------------
    // Step 3: Detect + remove deleted directories if syncFolders
    // ----------------------------------------------------------------
    if (config.syncFolders) {
        const deletedDirPaths = new Set<string>();
        for (const change of changes.filter(c => c.type === 'deleted')) {
            const dir = change.path.includes('/')
                ? change.path.split('/').slice(0, -1).join('/')
                : null;
            if (dir) deletedDirPaths.add(dir);
        }

        for (const dirPath of deletedDirPaths) {
            // Only remove if it no longer has active file-based children (approximate heuristic)
            const stillActive = matched.some(m =>
                m.relativePath.startsWith(dirPath + '/')
            );
            if (stillActive) continue;

            const nodeUuid = tocIndex.dirToUuid.get(dirPath);
            if (!nodeUuid) continue;

            if (!dryRun) {
                console.log(chalk.red(`  🗑  Removing TOC group: ${dirPath}`));
                await client.removeTocNode(nodeUuid, true); // remove with children
                tocIndex.dirToUuid.delete(dirPath);
            } else {
                console.log(chalk.red(`  🗑  [dry-run] Would remove TOC group: ${dirPath}`));
            }
        }
    }

    return results;
}

/** Print a summary of sync results to stdout */
export function printSummary(results: SyncResult[]): void {
    const counts = { created: 0, updated: 0, deleted: 0, skipped: 0, error: 0, 'dry-run': 0 };
    for (const r of results) {
        counts[r.status] = (counts[r.status] || 0) + 1;
    }

    console.log('\n' + chalk.bold('─── Sync Summary ─────────────────────────────'));
    if (counts.created) console.log(chalk.green(`  ✅ Created : ${counts.created}`));
    if (counts.updated) console.log(chalk.green(`  📝 Updated : ${counts.updated}`));
    if (counts.deleted) console.log(chalk.red(`  🗑  Deleted : ${counts.deleted}`));
    if (counts.skipped) console.log(chalk.gray(`  ⏭  Skipped : ${counts.skipped}`));
    if (counts['dry-run']) console.log(chalk.cyan(`  🔍 Dry-run : ${counts['dry-run']}`));
    if (counts.error) console.log(chalk.red(`  ❌ Errors  : ${counts.error}`));
    console.log(chalk.bold('──────────────────────────────────────────────\n'));

    const errors = results.filter(r => r.status === 'error');
    if (errors.length > 0) {
        console.error(chalk.red('Errors:'));
        for (const e of errors) {
            console.error(chalk.red(`  ${e.file}: ${e.error}`));
        }
    }
}
