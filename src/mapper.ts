import * as path from 'path';
import { minimatch } from 'minimatch';
import { GtyConfig, MappedFile, GitChange } from './types';

/**
 * Convert a relative file path to a Yuque doc slug.
 * Supports template variables: {basename}, {path}
 */
export function toDocSlug(relativePath: string, template?: string): string {
    const parsed = path.parse(relativePath);
    const basename = parsed.name; // filename without extension
    const dirPath = parsed.dir.replace(/\//g, '-').replace(/\\/g, '-');
    const pathSlug = [dirPath, basename].filter(Boolean).join('-');

    if (!template || template === '{basename}') {
        return slugify(basename);
    }
    if (template === '{path}') {
        return slugify(pathSlug);
    }

    return slugify(
        template
            .replace('{basename}', basename)
            .replace('{path}', pathSlug)
    );
}

function slugify(str: string): string {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Derive a human-readable title from a file path.
 * e.g. "getting-started.md" → "Getting Started"
 */
export function toTitle(relativePath: string): string {
    const basename = path.basename(relativePath, path.extname(relativePath));
    return basename
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Check whether a file path is excluded by any of the exclude globs.
 */
export function isExcluded(relativePath: string, excludePatterns: string[]): boolean {
    for (const pattern of excludePatterns) {
        if (minimatch(relativePath, pattern, { dot: true, matchBase: false })) {
            return true;
        }
    }
    return false;
}

/**
 * Check whether a file is a supported markdown file.
 */
export function isMarkdown(relativePath: string): boolean {
    return /\.(md|markdown|mdx)$/i.test(relativePath);
}

/**
 * Match a list of git-changed files against the config mappings + exclude rules.
 * Returns only the files that should be synced along with their doc slug and dir structure.
 */
export function matchFiles(
    changes: GitChange[],
    config: GtyConfig
): Array<MappedFile & { changeType: GitChange['type'] }> {
    const { mappings, exclude } = config;
    const results: Array<MappedFile & { changeType: GitChange['type'] }> = [];

    for (const change of changes) {
        const { path: relativePath, type: changeType } = change;

        // Only handle markdown files
        if (!isMarkdown(relativePath)) continue;

        // Check exclusions
        if (isExcluded(relativePath, exclude)) continue;

        // Find the first matching mapping rule
        let docSlug: string | undefined;
        if (mappings.length > 0) {
            let matched = false;
            for (const rule of mappings) {
                if (minimatch(relativePath, rule.pattern, { dot: true, matchBase: false })) {
                    docSlug = toDocSlug(relativePath, rule.docSlug);
                    matched = true;
                    break;
                }
            }
            if (!matched) continue;
        } else {
            // No mappings configured → sync all markdown files
            docSlug = toDocSlug(relativePath);
        }

        const dirSegments = path.dirname(relativePath) === '.'
            ? []
            : path.dirname(relativePath).split('/').filter(Boolean);

        results.push({
            localPath: relativePath,
            relativePath,
            docSlug: docSlug as string,
            title: toTitle(relativePath),
            dirSegments,
            changeType,
        });
    }

    return results;
}

/**
 * Derive all unique directory paths involved from a list of file changes.
 * Returns them sorted by depth (parents first).
 * e.g. "docs/guide/intro.md" → ["docs", "docs/guide"]
 */
export function getAllDirPaths(filePaths: string[]): string[] {
    const dirs = new Set<string>();
    for (const fp of filePaths) {
        const segments = fp.split('/');
        // Build parent paths from depth 1 up to len-1 (not including file itself)
        for (let i = 1; i < segments.length; i++) {
            dirs.add(segments.slice(0, i).join('/'));
        }
    }
    // Sort: shorter paths first (parents before children)
    return [...dirs].sort((a, b) => a.split('/').length - b.split('/').length);
}
