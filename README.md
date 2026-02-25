# git-to-yuque

> 在 `git pre-push` 前，将本地 Markdown 文件变更自动同步到语雀（Yuque）文档。

## 功能特性

- 🪝 **Git Hook 集成**：在 `git push` 前自动运行，无感同步
- 📁 **文件夹 → 分组**：本地目录结构自动映射为语雀 TOC 分组（TITLE 节点）
  - 新建文件夹 → 创建语雀分组
  - 删除文件夹 → 删除语雀分组（含子节点）
- 📄 **Markdown 同步**：新建/修改文件 → 创建/更新语雀文档
- 🔍 **Glob 过滤**：支持排除特定文件/目录
- 🔢 **dry-run 模式**：预览同步内容，不实际修改语雀

## 安装

### 环境要求

- **Node.js** >= 16
- **npm** >= 8
- **Git** >= 2.0（需要能执行 `git log`、`git diff` 等命令）

### 方式一：从源码构建（当前推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/livis/git-to-yuque.git
cd git-to-yuque

# 2. 安装依赖
npm install

# 3. 编译 TypeScript
npm run build

# 4. 全局链接，使 gty 命令可用
npm link

# 验证安装
gty --version
```

### 方式二：发布后通过 npm 安装（待发布）

```bash
npm install -g git-to-yuque
```

### 获取语雀 API Token

1. 登录 [语雀](https://www.yuque.com)
2. 进入 **账户设置** → **Token**
3. 创建 Token，并记录下来
4. 推荐将 Token 设置为环境变量，避免写入配置文件：

```bash
# 添加到 ~/.zshrc 或 ~/.bash_profile
export GTY_TOKEN="your-yuque-token-here"
source ~/.zshrc
```

> **注意**：请勿将含有真实 Token 的 `.gty.yml` 提交到公开仓库。使用环境变量 `GTY_TOKEN` 是更安全的方式。

## 快速开始

```bash
# 1. 在你的目标 git 仓库中初始化配置
cd /your/repo
gty init              # 生成 .gty.yml，或手动复制模板： cp .gty.yml.example .gty.yml

# 2. 编辑 .gty.yml，填写 token 和 namespace
vim .gty.yml

# 3. 验证配置和连接
gty check

# 4. 安装 pre-push hook
gty install

# 5. 正常 git push，自动触发同步
git add . && git commit -m "..."
git push
```

## 命令

| 命令 | 说明 |
|------|------|
| `gty init` | 生成 `.gty.yml` 配置文件模板 |
| `gty install` | 在当前 repo 安装 pre-push hook |
| `gty uninstall` | 移除 pre-push hook |
| `gty check` | 验证配置和语雀 API 连接 |
| `gty sync` | 手动触发同步（与 upstream 对比差异） |
| `gty sync --dry-run` | 预览同步内容，不做实际修改 |
| `gty sync --all` | 同步所有匹配文件（忽略 git diff） |

## 配置文件（.gty.yml）

```yaml
# 语雀 Token（推荐使用 GTY_TOKEN 环境变量）
token: ""

# 语雀知识库 namespace (group_login/book_slug)
namespace: "myteam/my-docs"

# 文件 → 文档映射（留空则同步所有 .md 文件）
mappings:
  - pattern: "docs/**/*.md"

# 排除文件
exclude:
  - "node_modules/**"
  - "CHANGELOG.md"

# 同步模式: create-or-update | update-only
syncMode: "create-or-update"

# 文件夹 → 语雀分组
syncFolders: true

# 同步失败时是否仍允许 git push 继续
continueOnError: true
```

## 目录结构映射示例

本地仓库：
```
docs/
  guide/
    intro.md      → 语雀 slug: intro（在分组 "guide" 下）
    advanced.md   → 语雀 slug: advanced（在分组 "guide" 下）
  api/
    overview.md   → 语雀 slug: overview（在分组 "api" 下）
README.md         → 语雀 slug: readme（根目录）
```

语雀目录结构：
```
📁 guide (TITLE 分组)
  📄 intro
  📄 advanced
📁 api (TITLE 分组)
  📄 overview
📄 readme
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `GTY_TOKEN` | 语雀 API Token（优先级高于 `.gty.yml` 中的 `token`） |
