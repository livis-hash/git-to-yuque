import axios, { AxiosInstance, AxiosError } from 'axios';
import {
    GtyConfig,
    YuqueUser,
    YuqueDoc,
    YuqueDocDetail,
    YuqueTocItem,
} from './types';

export class YuqueClient {
    private client: AxiosInstance;
    private config: GtyConfig;

    constructor(config: GtyConfig) {
        this.config = config;
        if (!config.token) {
            throw new Error(
                'Yuque API token is missing. Set it in .gty.yml or via the GTY_TOKEN environment variable.'
            );
        }
        this.client = axios.create({
            baseURL: config.baseUrl,
            headers: {
                'X-Auth-Token': config.token,
                'User-Agent': 'git-to-yuque/1.0.0',
                'Content-Type': 'application/json',
            },
            timeout: 30000,
        });
    }

    /**
     * Retry an async API call up to maxRetries times on 429 (rate-limit) responses.
     * Uses exponential backoff: 1s, 2s, 4s, ...
     */
    private async retryRequest<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
        let delay = 1000;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (err) {
                const is429 = axios.isAxiosError(err) && err.response?.status === 429;
                if (is429 && attempt < maxRetries) {
                    const retryAfter = Number(err.response?.headers?.['retry-after']) || delay / 1000;
                    const waitMs = retryAfter * 1000;
                    console.warn(`[gty] Rate limited by Yuque (429). Retrying in ${retryAfter}s... (${attempt + 1}/${maxRetries})`);
                    await new Promise(r => setTimeout(r, waitMs));
                    delay *= 2;
                    continue;
                }
                throw err;
            }
        }
        throw new Error('retryRequest: unreachable');
    }

    private get namespace() {
        return this.config.namespace;
    }

    private get groupLogin() {
        return this.namespace.split('/')[0];
    }

    private get bookSlug() {
        return this.namespace.split('/')[1];
    }

    /** Transform axios errors into readable messages */
    private handleError(err: unknown, context: string): never {
        if (axios.isAxiosError(err)) {
            const e = err as AxiosError<{ message?: string }>;
            const status = e.response?.status;
            const msg = e.response?.data?.message ?? e.message;
            throw new Error(`[Yuque] ${context}: HTTP ${status} - ${msg}`);
        }
        throw err;
    }

    // ----------------------------------------------------------
    // User
    // ----------------------------------------------------------

    /** Verify token and return current user */
    async getCurrentUser(): Promise<YuqueUser> {
        try {
            const res = await this.client.get<{ data: YuqueUser }>('/api/v2/user');
            return res.data.data;
        } catch (err) {
            this.handleError(err, 'getCurrentUser');
        }
    }

    // ----------------------------------------------------------
    // Documents
    // ----------------------------------------------------------

    /** List all docs in the book */
    async listDocs(): Promise<YuqueDoc[]> {
        try {
            const res = await this.client.get<{ data: YuqueDoc[] }>(
                `/api/v2/repos/${this.groupLogin}/${this.bookSlug}/docs`,
                { params: { limit: 100, offset: 0 } }
            );
            return res.data.data;
        } catch (err) {
            this.handleError(err, 'listDocs');
        }
    }

    /** Get a doc by its slug or ID */
    async getDoc(slugOrId: string | number): Promise<YuqueDocDetail | null> {
        try {
            const res = await this.client.get<{ data: YuqueDocDetail }>(
                `/api/v2/repos/${this.groupLogin}/${this.bookSlug}/docs/${slugOrId}`
            );
            return res.data.data;
        } catch (err) {
            if (axios.isAxiosError(err) && err.response?.status === 404) {
                return null;
            }
            this.handleError(err, `getDoc(${slugOrId})`);
        }
    }

    /** Create a new doc with Markdown content */
    async createDoc(params: {
        slug: string;
        title: string;
        body: string;
        public?: 0 | 1 | 2;
    }): Promise<YuqueDocDetail> {
        try {
            const res = await this.client.post<{ data: YuqueDocDetail }>(
                `/api/v2/repos/${this.groupLogin}/${this.bookSlug}/docs`,
                {
                    slug: params.slug,
                    title: params.title,
                    format: 'markdown',
                    body: params.body,
                    public: params.public ?? 0,
                }
            );
            return res.data.data;
        } catch (err) {
            this.handleError(err, `createDoc(${params.slug})`);
        }
    }

    /** Update an existing doc's content */
    async updateDoc(
        docId: number | string,
        params: {
            slug?: string;
            title?: string;
            body: string;
            public?: 0 | 1 | 2;
        }
    ): Promise<YuqueDocDetail> {
        try {
            const res = await this.client.put<{ data: YuqueDocDetail }>(
                `/api/v2/repos/${this.groupLogin}/${this.bookSlug}/docs/${docId}`,
                {
                    ...(params.slug && { slug: params.slug }),
                    ...(params.title && { title: params.title }),
                    format: 'markdown',
                    body: params.body,
                    ...(params.public !== undefined && { public: params.public }),
                }
            );
            return res.data.data;
        } catch (err) {
            this.handleError(err, `updateDoc(${docId})`);
        }
    }

    /** Permanently delete a doc by its slug or ID */
    async deleteDoc(slugOrId: string | number): Promise<void> {
        try {
            await this.client.delete(
                `/api/v2/repos/${this.groupLogin}/${this.bookSlug}/docs/${slugOrId}`
            );
        } catch (err) {
            if (axios.isAxiosError(err) && err.response?.status === 404) {
                return; // already deleted, that's fine
            }
            this.handleError(err, `deleteDoc(${slugOrId})`);
        }
    }

    // ----------------------------------------------------------
    // TOC (Table of Contents)
    // ----------------------------------------------------------

    /** Fetch the FULL TOC of the book (handles pagination automatically) */
    async getToc(): Promise<YuqueTocItem[]> {
        try {
            // Yuque TOC API returns all nodes in a single request (no pagination needed),
            // but we use retryRequest to handle transient 429 errors.
            return await this.retryRequest(async () => {
                const res = await this.client.get<{ data: YuqueTocItem[] }>(
                    `/api/v2/repos/${this.groupLogin}/${this.bookSlug}/toc`
                );
                return res.data.data ?? [];
            });
        } catch (err) {
            this.handleError(err, 'getToc');
        }
    }

    /**
     * Append a TITLE (group/folder) node to TOC.
     * @param title - Display name for the group
     * @param parentUuid - UUID of the parent node (empty string = root level, action_mode=child)
     */
    async addTocGroup(title: string, parentUuid: string = ''): Promise<YuqueTocItem[]> {
        try {
            const body: Record<string, unknown> = {
                action: 'appendNode',
                action_mode: 'child',
                type: 'TITLE',
                title,
                visible: 1,
            };
            if (parentUuid) {
                body.target_uuid = parentUuid;
            }
            const res = await this.client.put<{ data: YuqueTocItem[] }>(
                `/api/v2/repos/${this.groupLogin}/${this.bookSlug}/toc`,
                body
            );
            return res.data.data;
        } catch (err) {
            this.handleError(err, `addTocGroup(${title})`);
        }
    }

    /**
     * Append a DOC node to the TOC under a parent group.
     * @param docIds - array of doc IDs (returned from createDoc/updateDoc)
     * @param parentUuid - UUID of the parent TITLE node (empty = root)
     */
    async addTocDoc(docIds: number[], parentUuid: string = ''): Promise<YuqueTocItem[]> {
        try {
            const body: Record<string, unknown> = {
                action: 'appendNode',
                action_mode: 'child',
                type: 'DOC',
                doc_ids: docIds,
                visible: 1,
            };
            if (parentUuid) {
                body.target_uuid = parentUuid;
            }
            const res = await this.client.put<{ data: YuqueTocItem[] }>(
                `/api/v2/repos/${this.groupLogin}/${this.bookSlug}/toc`,
                body
            );
            return res.data.data;
        } catch (err) {
            this.handleError(err, `addTocDoc(docIds=${docIds})`);
        }
    }

    /**
     * Remove a TOC node by its UUID.
     * @param nodeUuid - UUID of the node to remove
     * @param removeChildren - if true, also removes all child nodes
     */
    async removeTocNode(nodeUuid: string, removeChildren = false): Promise<YuqueTocItem[]> {
        try {
            const res = await this.client.put<{ data: YuqueTocItem[] }>(
                `/api/v2/repos/${this.groupLogin}/${this.bookSlug}/toc`,
                {
                    action: 'removeNode',
                    action_mode: removeChildren ? 'child' : 'sibling',
                    node_uuid: nodeUuid,
                }
            );
            return res.data.data;
        } catch (err) {
            this.handleError(err, `removeTocNode(${nodeUuid})`);
        }
    }

    /**
     * Edit a TOC node (e.g. rename a group).
     */
    async editTocNode(nodeUuid: string, title: string): Promise<YuqueTocItem[]> {
        try {
            const res = await this.client.put<{ data: YuqueTocItem[] }>(
                `/api/v2/repos/${this.groupLogin}/${this.bookSlug}/toc`,
                {
                    action: 'editNode',
                    action_mode: 'sibling',
                    node_uuid: nodeUuid,
                    title,
                }
            );
            return res.data.data;
        } catch (err) {
            this.handleError(err, `editTocNode(${nodeUuid})`);
        }
    }
}
