// Configuration types

export interface MappingRule {
    // Glob pattern for local files, e.g. "docs/guide/*.md"
    pattern: string;
    // Yuque doc slug template: {basename} | {path} | custom string
    docSlug?: string;
}

export interface GtyConfig {
    token: string;
    baseUrl: string;
    namespace: string;
    mappings: MappingRule[];
    exclude: string[];
    syncMode: 'create-or-update' | 'update-only';
    continueOnError: boolean;
    syncFolders: boolean;
}

// Yuque API response types

export interface YuqueUser {
    id: number;
    login: string;
    name: string;
    avatar_url: string;
}

export interface YuqueDoc {
    id: number;
    slug: string;
    title: string;
    book_id: number;
    user_id: number;
    public: number;
    status: number;
    created_at: string;
    updated_at: string;
}

export interface YuqueDocDetail extends YuqueDoc {
    body: string;
    body_html: string;
    format: string;
}

export interface YuqueTocItem {
    uuid: string;
    type: 'DOC' | 'LINK' | 'TITLE';
    title: string;
    url: string;
    doc_id?: number;
    prev_uuid: string;
    child_uuid: string;
    parent_uuid: string;
    sibling_uuid: string;
    depth: number;
    visible: 0 | 1;
    open_window: 0 | 1;
}

export interface YuqueTocUpdateResult {
    data: YuqueTocItem[];
}

// Internal sync types

export interface MappedFile {
    localPath: string;
    relativePath: string;
    docSlug: string;
    title: string;
    dirSegments: string[];
}

export type ChangeType = 'added' | 'modified' | 'deleted' | 'renamed';

export interface GitChange {
    type: ChangeType;
    path: string;
    oldPath?: string;
}

export type SyncStatus = 'created' | 'updated' | 'skipped' | 'error' | 'deleted' | 'dry-run';

export interface SyncResult {
    file: string;
    status: SyncStatus;
    docSlug?: string;
    docId?: number;
    error?: string;
}
