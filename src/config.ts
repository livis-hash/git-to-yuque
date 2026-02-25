import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { GtyConfig, MappingRule } from './types';

const CONFIG_FILENAME = '.gty.yml';

const DEFAULTS: Partial<GtyConfig> = {
    baseUrl: 'https://www.yuque.com',
    syncMode: 'create-or-update',
    continueOnError: true,
    syncFolders: true,
    exclude: [
        'node_modules/**',
        '.git/**',
        'dist/**',
        'build/**',
        '**/.DS_Store',
    ],
    mappings: [],
};

export function findConfigFile(startDir: string): string | null {
    let dir = startDir;
    while (true) {
        const candidate = path.join(dir, CONFIG_FILENAME);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

export function loadConfig(repoRoot?: string): { config: GtyConfig; configPath: string; repoRoot: string } {
    const searchDir = repoRoot ?? process.cwd();
    const configPath = findConfigFile(searchDir);

    if (!configPath) {
        throw new Error(
            `No ${CONFIG_FILENAME} found. Run "gty init" to create one.`
        );
    }

    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = yaml.load(raw) as Record<string, unknown>;

    // Override token with environment variable
    const token = (process.env.GTY_TOKEN as string) || (parsed.token as string) || '';

    const config: GtyConfig = {
        ...DEFAULTS,
        ...(parsed as Partial<GtyConfig>),
        token,
    } as GtyConfig;

    validateConfig(config, configPath);

    return {
        config,
        configPath,
        repoRoot: path.dirname(configPath),
    };
}

function validateConfig(config: GtyConfig, configPath: string): void {
    const errors: string[] = [];

    if (!config.token) {
        errors.push('`token` is required (or set GTY_TOKEN env variable)');
    }

    if (!config.namespace) {
        errors.push('`namespace` is required, e.g. "myteam/my-book"');
    } else if (!config.namespace.includes('/')) {
        errors.push('`namespace` must be in format "group_login/book_slug"');
    }

    if (!Array.isArray(config.mappings)) {
        errors.push('`mappings` must be an array');
    }

    if (!Array.isArray(config.exclude)) {
        config.exclude = DEFAULTS.exclude!;
    }

    if (config.syncMode && !['create-or-update', 'update-only'].includes(config.syncMode)) {
        errors.push('`syncMode` must be "create-or-update" or "update-only"');
    }

    if (errors.length > 0) {
        throw new Error(
            `Invalid config at ${configPath}:\n` + errors.map(e => `  - ${e}`).join('\n')
        );
    }
}

export function getConfigTemplate(): string {
    return `# git-to-yuque 配置文件 (.gty.yml)
# 文档: https://github.com/livis/git-to-yuque

# 语雀 API Token (也可通过 GTY_TOKEN 环境变量设置, 推荐使用环境变量以避免泄露)
# 获取方式: 语雀 → 账户设置 → Token
token: ""

# 语雀知识库 namespace (格式: "用户名或团队login/知识库slug")
# 例如: "myteam/my-docs" 对应 https://www.yuque.com/myteam/my-docs
namespace: "your-group/your-book"

# 语雀地址 (默认 https://www.yuque.com)
baseUrl: "https://www.yuque.com"

# 文件映射规则: 本地文件路径 (glob) → 语雀文档 slug
# 如果不配置 docSlug，则使用文件名 (不含扩展名) 作为 slug
# 支持模板变量: {basename} = 文件名(不含扩展名), {path} = 路径(斜杠转连字符)
mappings:
  - pattern: "**/*.md"
    # docSlug: "{basename}"  # 可省略，默认使用 basename

# 排除的文件/目录 (glob 格式)
exclude:
  - "node_modules/**"
  - ".git/**"
  - "dist/**"
  - "build/**"
  - "CHANGELOG.md"
  - "**/*.test.md"

# 同步模式
# create-or-update: 文档不存在时创建，存在时更新 (默认)
# update-only: 只更新已存在的文档，不创建新文档
syncMode: "create-or-update"

# 是否同步文件夹结构为语雀分组 (TITLE 节点)
# 开启后: 本地文件夹 → 语雀目录分组, 文件夹删除/创建 → 分组删除/创建
syncFolders: true

# 如果语雀同步失败，是否仍然允许 git push 继续
continueOnError: true
`;
}
