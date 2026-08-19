# 工作区守护者策略升级设计

## 1. 背景与目标

当前守护者已经能够读取 Git 状态、区分 ignored 运行残留与 approved 本地资产，并通过显式命令把运行残留移动到仓库同级本地归档目录。但当前文件分类仍偏粗：`output/pdf` 生成物和 `.superpowers` 会话文件可能被报告为“继续跟踪”，容易造成误暂存；归档报告也没有充分说明文件为什么被保留或移动。

本次升级的目标是让守护者成为“分类和保护工具”，而不是清理或提交代理：

- 生成物默认留在工作区原位置并归类为本地保存。
- approved 本地资产继续原地保留，任何归档都必须跳过。
- ignored 运行残留只有用户显式执行归档命令时才移动。
- 守护器报告给出稳定、可解释的分类结果。
- 不自动 stage、commit、删除、恢复或覆盖文件。

## 2. 已确认边界

### 2.1 本地保存

以下内容默认保留在工作区原位置，不进入 Git：

- `output/pdf/**`：学生卷、教师答案解析、结构化答案包和教学计划等生成物。
- `.superpowers/brainstorm/**` 中除运行状态目录外的会话预览和设计过程文件。
- approved 学生档案 PDF、PNG 和辅助脚本。

本地保存不等于归档。守护器只报告这些文件，不移动它们。

### 2.2 运行残留

以下内容仍属于运行残留：

- `tmp/**` 中的临时脚本、渲染结果、缓存和中间文件。
- `storage/**`、`apps/api/storage/uploads/**`、`logs/**` 中的运行文件。
- `.superpowers/brainstorm/**/state/server.pid`、`server-stopped` 和其他明确的进程状态文件。

运行残留也不自动处理。只有显式执行 `workspace:archive-residue` 时才移动到：

```text
..\君航AI助教-local-archive\<时间戳>-run-residue\
```

### 2.3 正式项目内容

源码、配置、测试、规则文档和已跟踪报告继续按模块归入“继续跟踪”或“收口提交”。守护器不根据文件时间、文件名或当前会话自动判断这些修改属于谁，也不自动提交。

## 3. 方案选择

### 方案 A：只扩充分类规则

增加 `output/pdf` 和 `.superpowers` 的路径分类，不修改忽略策略和归档报告结构。

- 优点：改动小，风险低。
- 缺点：生成物仍可能反复出现在 Git 状态中；报告无法清楚区分本地保存和运行残留。

### 方案 B：策略驱动守护者（采用）

统一升级分类策略、`.gitignore`、守护报告、显式归档和回归测试。

- `output/pdf` 和 `.superpowers` 明确忽略并报告为本地保存。
- `tmp`、上传目录和日志继续报告为运行残留。
- approved 资产单独列出并强制跳过归档。
- 归档命令增加预览、统计、哈希和冲突保护。

该方案能直接解决当前误分类问题，同时不引入任务归属推断。

### 方案 C：完整任务账本

在方案 B 上增加任务基线、文件来源、修改会话、哈希和 agent 归属记录。

- 优点：可以更细地判断用户修改和当前任务修改。
- 缺点：引入新的状态文件和生命周期，可能制造更多工作区噪声；当前没有足够稳定的任务会话协议支撑。

方案 C 延后，不作为本轮实现范围。

## 4. 目标架构

### 4.1 分类策略

`classifyWorkspaceFile()` 继续作为唯一可测试的可见文件分类入口，但返回结果增加分类原因：

```js
{
  bucket: "local",
  label: "本地保存",
  reason: "generated-output"
}
```

分类优先级保持：

1. 守护者自身规则文件：`收口提交`。
2. 本地保存路径和生成物：`本地保存`。
3. 小程序、平板和公共屏范围：`谨慎处理`。
4. 其他源码、配置、脚本和文档：`继续跟踪`。

新增规则至少覆盖：

- `output/pdf/**` -> `local / generated-output`
- `.superpowers/brainstorm/**`（排除 `state`）-> `local / session-artifact`
- `.superpowers/brainstorm/**/state/server.pid` -> `runtime / runtime-state`
- `.superpowers/brainstorm/**/state/server-stopped` -> `runtime / runtime-state`

运行状态文件可以被单独统计，但不因其位于 `.superpowers` 下就自动移动；只有显式归档命令才处理它们。

### 4.2 ignored 文件报告

报告模型拆分为三类 ignored 文件：

- `ignoredRuntimeFiles`：可由显式归档命令移动的运行残留。
- `ignoredLocalFiles`：原地保留的生成物、会话文件和普通本地资料。
- `ignoredPreservedLocalFiles`：已批准的保护资产，归档时强制跳过。

`clean` 判断只在存在 ignored runtime residue 时失败；ignored local 和 preserved local 不阻断工作区通过。可见但尚未被 `.gitignore` 覆盖的本地路径仍应在任务审查中显示为“本地保存”，直到忽略规则生效。

### 4.3 忽略规则

在 `.gitignore` 中加入仓库根目录限定规则：

```gitignore
/output/pdf/
/.superpowers/
```

不使用宽泛的 `output/` 或全局 `*.json`、`*.html` 规则，避免隐藏可能属于项目内容的文件。approved `exports` 和 `tmp` 规则保持不变。

### 4.4 归档安全

`workspace:archive-residue` 保留显式执行才产生移动副作用，并增加：

- `--dry-run`：只列出待移动文件、数量和总大小。
- 移动前生成归档清单，包含相对路径、目标路径、大小、修改时间、SHA-256 和分类原因。
- 目标文件已存在时跳过并报告冲突，不覆盖目标。
- 继续拒绝空路径、越界路径和 approved 保护资产。
- 完成后报告 moved、skipped、conflict 三类结果。

为保持已有操作习惯，无参数命令继续执行实际归档；需要无副作用检查时使用 `--dry-run`。

### 4.5 输出格式

默认输出继续保持中文可读报告；新增 `--json` 输出稳定结构，至少包含：

```json
{
  "clean": false,
  "risk": "attention",
  "branch": {},
  "visible": {
    "closeout": [],
    "track": [],
    "local": [],
    "caution": []
  },
  "ignored": {
    "runtime": [],
    "local": [],
    "preserved": []
  },
  "recommendations": []
}
```

JSON 字段用于后续自动化读取，但不授权自动清理或自动提交。

## 5. 实施范围

### 第一阶段：分类和保护

- 更新 `scripts/workspace-guardian-lib.mjs` 的路径策略和报告模型。
- 更新 `.gitignore`，只忽略根目录 `output/pdf` 和 `.superpowers`。
- 保持 approved 资产保护规则不变。
- 保持 9 个现有已跟踪修改不变。

### 第二阶段：归档和报告

- 增加 ignored local 的扫描与报告。
- 增加归档 dry-run、哈希清单和冲突保护。
- 增加 JSON 报告入口。
- 更新 `docs/52-workspace-guardian.md` 的命令和分类说明。

### 第三阶段：验证

- 补充守护器分类、忽略、报告和归档测试。
- 验证 approved 资产始终原地保留。
- 验证 output/pdf 不再被建议 stage。
- 验证 tracked source 不会被自动移动。

## 6. 验证标准

至少满足以下结果：

1. 新建 `output/pdf/sample.pdf` 后，守护器分类为本地保存，不生成 stage 建议。
2. `.superpowers/brainstorm/demo/content.html` 分类为本地保存。
3. `.superpowers/brainstorm/demo/state/server.pid` 被列入运行残留，但不会在守护审查时自动移动。
4. ignored runtime residue 只有显式归档命令才移动，且 approved 文件始终跳过。
5. 归档冲突、越界路径和哈希清单测试通过。
6. `check:workspace-guardian`、`check:encoding` 和 `git diff --check` 通过。
7. 守护者改动不改变 API、生成、批改、小程序或现有 `output/pdf` 内容。

## 7. 非目标

- 不自动 stage、commit、push 或创建分支。
- 不删除来源不明文件。
- 不移动 `output/pdf` 生成物。
- 不移动 approved 学生档案 PNG/PDF/辅助脚本。
- 不修改当前 9 个已跟踪文件的业务内容。
- 不实现基于 agent/session 的任务归属推断。
- 不把 PDF 内容质量检查混入工作区守护者；PDF 质量仍由生成和版式检查负责。

## 8. 后续实施顺序

1. 先实现分类策略和 `.gitignore` 规则。
2. 再实现 ignored local/runtime/preserved 三类报告。
3. 再实现归档 dry-run、清单和冲突保护。
4. 最后补齐测试、文档和守护自检。

每一阶段都只使用显式路径，完成后运行对应测试，再运行 `workspace:guard` 复核剩余工作区状态。
