# git-to-yuque (gty)

> 在 `git commit` / `git push` 前，自动将本地 Markdown 文件变更同步到语雀（Yuque）文档。

## 功能特性

- 🪝 **双 Hook 集成**
  - `pre-commit`：检测 slug 冲突，有冲突阻断 commit
  - `pre-push`：自动同步文件变更到语雀
- 📁 **文件夹 → 语雀分组**：本地目录结构 → 语雀 TOC TITLE 节点
  - 新建目录 → 创建分组；删除目录 → 删除分组（含子节点）
- 📄 **完整 CRUD**：新增/修改 → 创建/更新；删除 → 从 TOC 移除并删除语雀文档
- ↩️ **Rename/Move**：
  - 跨目录移动（slug 不变）→ 移动 TOC 节点到新位置
  - 重命名（slug 变化）→ 删除旧文档，新位置创建新文档
- 🔍 **dry-run 模式**：预览操作，不实际修改语雀
- 🛡️ **健壮性**：429 自动重试（指数退避）、循环依赖防护、空 slug 兜底

## 安装

### 环境要求

- **Node.js** >= 16
- **npm** >= 8
- **Git** >= 2.0

### 从源码构建

```bash
git clone https://github.com/livis-hash/git-to-yuque.git
cd git-to-yuque
npm install
npm run build
npm link          # 全局注册 gty 命令

gty --version     # 验证安装
```

### 获取语雀 API Token

1. 登录 [语雀](https://www.yuque.com) → **账户设置** → **Token** → 创建 Token
2. 推荐通过环境变量配置，避免 token 写入文件：

```bash
# 添加到 ~/.zshrc 或 ~/.bash_profile
export GTY_TOKEN="your-yuque-token-here"
source ~/.zshrc
```

> **注意**：请勿将含有真实 Token 的 `.gty.yml` 提交到公开仓库。

## 快速开始

```bash
cd /your/git-repo

# 1. 生成配置文件
gty init              # 或: cp .gty.yml.example .gty.yml

# 2. 编辑 .gty.yml，填写 namespace
vim .gty.yml

# 3. 验证 API 连接
gty check

# 4. 安装 git hooks（pre-commit + pre-push）
gty install

# 此后正常工作：
git add . && git commit -m "..."   # pre-commit 检查 slug 冲突
git push                           # pre-push 自动同步到语雀
```

## 命令

| 命令 | 说明 |
|------|------|
| `gty init` | 生成 `.gty.yml` 配置文件模板 |
| `gty install` | 安装 pre-commit（slug 检查）和 pre-push（同步）hook |
| `gty uninstall` | 移除两个 hook |
| `gty lint` | 检查 staged 文件是否有 slug 冲突（pre-commit 自动调用） |
| `gty lint --all` | 检查所有 tracked 文件的 slug 冲突 |
| `gty check` | 验证配置和语雀 API 连接 |
| `gty sync` | 手动同步（与 upstream 对比差异） |
| `gty sync --dry-run` | 预览同步内容，不做实际修改 |
| `gty sync --all` | 同步所有匹配文件（忽略 git diff） |

## 配置文件（.gty.yml）

```yaml
# 语雀 API Token（推荐使用 GTY_TOKEN 环境变量）
token: ""

# 语雀知识库 namespace (group_login/book_slug)
namespace: "myteam/my-docs"

# 文件映射规则（留空则同步所有 .md 文件）
# docSlug 模板变量：{basename}=文件名, {path}=路径(斜杠→连字符)
mappings:
  - pattern: "docs/**/*.md"
    # docSlug: "{basename}"    # 默认，同目录下有重名文件时改为 "{path}"

# 排除文件
exclude:
  - "node_modules/**"
  - "CHANGELOG.md"

# 同步模式: create-or-update（默认）| update-only
syncMode: "create-or-update"

# 是否同步文件夹结构为语雀分组
syncFolders: true

# 同步失败时是否仍允许 git push 继续
continueOnError: true
```

## 目录结构映射

```
本地仓库                          语雀 TOC
──────────────────────────────────────────
docs/
  guide/
    intro.md          →   📁 guide
    advanced.md       →     📄 intro
  api/                →     📄 advanced
    overview.md       →   📁 api
README.md             →     📄 overview
                      →   📄 readme
```

## slug 冲突处理

如果两个不同目录下有同名文件（如 `docs/guide/intro.md` 和 `docs/api/intro.md`），两者默认都会生成 slug `intro` 导致互相覆盖。`gty lint` 会在 commit 前检测并阻断：

```
❌ Slug conflicts detected!
  slug "intro":
    - docs/guide/intro.md
    - docs/api/intro.md

💡 Fix: set docSlug: "{path}" in your .gty.yml mappings
```

修复：在 `.gty.yml` 中改用 `{path}` 模板：

```yaml
mappings:
  - pattern: "docs/**/*.md"
    docSlug: "{path}"   # docs-guide-intro, docs-api-intro → 唯一
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `GTY_TOKEN` | 语雀 API Token（优先级高于 `.gty.yml` 中的 `token`） |

## 已知限制

- **语雀 UI 手动改组名**：若在语雀界面修改了分组名称，路径映射会失效，下次同步时可能重复创建分组
- **并发 push**：多人同时推送可能创建重复 TOC 节点（无分布式锁）
