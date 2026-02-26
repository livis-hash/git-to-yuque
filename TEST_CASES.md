# git-to-yuque 测试用例

本文档记录了 `git-to-yuque (gty)` 项目体系化的测试用例列表。这些 case 涵盖了文件的增删改查、特殊路径移动、Slug 碰撞、以及边界配置场景。

您可以顺着这些 Case 在本地结合 `--dry-run` 或是实际的测试仓库来一一验证项目的功能完备性：

## 1. 基础文件生命周期 (CRUD)
*   **新建并提交同步**：
    *   在根目录新建 `test-new.md`，执行 commit 和 push，期望在语雀根目录生成相应文档。
    *   在深层目录新建 `docs/guide/deep/test-new.md`，执行 commit 和 push，期望语雀按照完整的层级自动创建三个分组并挂载。
*   **更新文件内容及标题**：
    *   修改已同步文档的正文内容（包括 Markdown 语法，如图片、代码块等）。
    *   修改文档首个一级标题（如果插件是按 Markdown 的 `#` 抓取标题），期望语雀端标题同步变更。
*   **删除文件**：
    *   删除一个根目录的文件，期望语雀端该文档也被删除（或者从目录树挪出）。
    *   删除深层目录中**唯一**的文件，期望不仅仅删除了该文档，同时清理了由于失去子节点而变得**空荡的父目录（分组 TITLE）**。

## 2. 文件移动与重命名 (Rename/Move)
*   **平级重命名（改变 Slug）**：
    *   将 `a.md` 重命名为 `b.md`。期望旧 Slug (`a`) 对应的文档被删除，新 Slug (`b`) 文档被建立（取决于 `docSlug` 策略）。
*   **跨目录平移（Slug 不变）**：
    *   将 `docs/api/index.md` 挪到 `docs/guide/index.md`。期望该文档**不动内容**，只在语雀目录树上将位置从 `api` 下摘除并转移到 `guide` 分组下。
*   **跨目录并重命名（Slug 和位置均变）**：
    *   将 `src/old.md` 移且改名为 `docs/new.md`。期望旧文档和旧路径被清理，并在新路径创建新文档。

## 3. Slug 冲突检测 (Pre-commit Hook)
*   **同名文件检测**：
    *   在 `folderA/intro.md` 和 `folderB/intro.md` 建立同名文件（默认 `basename` 作为 Slug）。执行 `git commit` 时，期望触发 `gty lint` 拦截错误，并提示冲突的文件路径。
*   **解决冲突后提交**：
    *   在 `.gty.yml` 将策略改为 `docSlug: "{path}"`，然后再次 `git commit`。期望能顺利通过。

## 4. 边界处理与配置开关
*   **非 Markdown 文件的忽略**：
    *   修改或新增 `.txt`、`.png`、`.ts` 等文件，期望同步逻辑直接跳过它们。
*   **全局排除（Exclusions）**：
    *   在忽略配置 `exclude` 中加入 `drafts/**`。
    *   在 `drafts/` 下新建 Markdown 或是更新已被忽略的文件，期望同步时跳过它们。
*   **按模式同步限制 (Mappings Match)**：
    *   令 `mappings.pattern: "docs/**/*.md"`。
    *   修改根目录下的 `README.md`，期望它不会被同步到语雀上去。
*   **Update-only 模式测试**：
    *   设置 `syncMode: "update-only"`。
    *   在本地新建文件，Push 后期望语雀不新增；但修改以前存在的文件时可以正常更新。

## 5. Git Diff 提取的特殊场景
*   **本地多 Commit 合成推**：
    *   一次性 commit 多次：C1(新增 A.md)、C2(修改 A.md)、C3(又删除了 A.md)。执行 `git push` 时，期望逻辑能通过正确的 remote diff 计算，发现净结算是没有任何影响（或删除状态），不报错崩溃，且语雀状态保持正确。
*   **Dry-run 命令**：
    *   执行 `gty sync --dry-run`。期望终端打印出和正式执行一模一样的变更列表及语雀调用的描述，但是实际上不去请求发送任何修改。
*   **强制全量同步**：
    *   执行 `gty sync --all`。期望插件扫描本地当前存在的所有 markdown 文件，全量覆盖一次线上的旧文档内容（无视 Git diff 的增量机制）。

## 6. 网络异常与容错
*   **弱网或 Rate Limit 重试测试**（较难模拟，但可通过压测）：
    *   通过脚本一次性 push 大量文件（比如 150 个 md 文件），命中语雀 API 的 429 频率限制拦截，期望插件内部能正确捕捉到 HTTP 429，休眠并重试，最终跑完所有文件同步而不断掉（基于 exponential backoff）。
*   **网络阻断（ContinueOnError）**：
    *   在没网的时候或者配错 Token 时 `gty sync` 报错失败。如果设置 `continueOnError: true`，即使同步失败也不应阻断代码 Push。如果是 `false` 则中断 Push。
