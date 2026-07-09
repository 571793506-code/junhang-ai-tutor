# 工作区守护者

本文用于当前仓库恢复小程序继续搭建、并收敛生成与批改复杂链路阶段后的工作区清理、任务收口和提交判断。

## 守护目标

- 防止脏工作区继续叠加新任务。
- 把已确定有价值的规则、文档、脚本和源码纳入 Git。
- 把运行产物、上传资料、缓存、日志和临时文件留在本地或忽略，不混入提交。
- 暂停未验收的大功能继续扩大，尤其是小程序、PDF 生成和复杂批改链路。
- 每次收口后留下可追踪提交和剩余风险清单。

## 每轮固定流程

1. 读取 `AGENTS.md`、`docs/51-project-pitfall-review.md` 和本文。
2. 运行只读守护命令：

```bat
cmd /c npm.cmd run workspace:guard
```

该命令只读取 Git 状态、被忽略运行残留和最近提交；不执行 stage、删除、恢复或清理。
本地分支只显示 `ahead` 时，守护脚本只提示“验证后可推送”，不把它视为脏工作区；如果显示 `behind`，开始新任务前必须先确认同步策略。
3. 如守护命令报告不通过，再运行 `git status --short`，确认 staged、unstaged、untracked 三类状态。
4. 运行 `git diff --name-status` 和 `git diff --cached --name-status`，先看文件范围，不直接读超长 diff。
5. 按下面四类分组：
   - `收口提交`：规则、模块边界、踩坑清单、已验证脚本或稳定服务层能力。
   - `继续跟踪`：非数据源码、配置、脚本、文档，但还需要按模块验证后再提交。
   - `本地保存`：生成物、上传资料、截图、日志、缓存、运行导出物、大体积素材。
   - `谨慎处理`：小程序新功能、复杂 PDF 排版、自动审查堆叠、自动批改归档等高风险范围。
6. 只用显式路径 stage，不使用 `git add .`。
7. 提交前运行与本组相关的验证命令。
8. 提交后再次运行 `cmd /c npm.cmd run workspace:guard`，报告剩余未收口文件属于哪一类。

## 运行残留本地归档

`workspace:guard` 永远保持只读。需要把被忽略运行残留移出工作区时，显式运行：

```bat
cmd /c npm.cmd run workspace:archive-residue
```

该命令只处理守护脚本识别到的 ignored 运行残留，并按原相对路径移动到仓库同级本地目录：

```text
..\君航AI助教-local-archive\<时间戳>-run-residue\
```

归档命令有文件移动副作用，因此不要把它作为普通审查命令自动触发。归档后重新运行 `cmd /c npm.cmd run workspace:guard`，确认“被忽略运行残留”为 0。

## 当前阶段分类

### 收口提交

优先提交这些确定性内容：

- `AGENTS.md`
- `SKILLS.md`
- `docs/45-git-traceability-runbook.md`
- `docs/49-codex-plugin-usage-boundary-and-optimization.md`
- `docs/51-project-pitfall-review.md`
- `docs/52-workspace-guardian.md`
- 只涉及模块边界、踩坑复盘、命令风险、Git 可追踪性的 `.gitignore` 更新

### 继续跟踪

这些属于非数据文件，原则上应纳入 Git，但不能和规则收口混成一个提交：

- API、服务层、AI runtime、数据库、共享包。
- Web 联调端。
- 脚本和命令入口。
- 既有小程序快照。
- 已确认是演示物料的 `materials/promotion/`。

处理方式：按 `docs/45-git-traceability-runbook.md` 分组验证后单独提交。

### 本地保存

这些默认不提交：

- `exports/`
- `storage/`
- `apps/api/storage/uploads/`
- `tmp/`
- `*.log`
- `*.traineddata`
- `*.tgz`
- 根目录临时截图
- Python `__pycache__/` 和 `*.pyc`
- 疑似误生成文件，例如 `console.log*`、`{console.error*`
- 已确认保留的学生档案本地导出图片和 PDF：
  - `exports/student-profile-template-pdfs/**/*.pdf`
  - `exports/student-profile-template-pdfs/**/*.png`
  - `exports/student-profile-template-pngs/**/*.png`
- 已确认保留的学生档案本地导出辅助脚本：
  - `tmp/export_student_archive_pngs.py`
  - `tmp/generate_student_archive_pdfs.py`
  - `tmp/make_pdf_contact_sheet.py`

处理方式：优先用 `.gitignore` 屏蔽，保留本地文件，不在未确认前删除。

### 谨慎处理

当前恢复小程序继续搭建，但这些范围必须先确认 API/服务层边界并单独验证：

- 微信小程序页面、路由、样式和端侧交互。
- 课堂平板和公共屏新功能。
- 自动正式 PDF 生成主流程。
- 多模型自动审查堆叠。
- 自动批改归档。
- 未稳定的英语小测、数学作答区、语文阅读/田字格等生成细节继续深改。

这些内容可以作为历史快照保留；后续若进入其他项目，只能参考稳定经验，不直接复制不稳定实现。

## 提交前验证

文档、规则和中文文案提交前至少运行：

```bat
cmd /c npm.cmd run check:encoding
```

守护脚本自身变更时运行：

```bat
cmd /c npm.cmd run check:workspace-guardian
cmd /c npm.cmd run workspace:guard
cmd /c npm.cmd run workspace:archive-residue
```

如当前工作区确有 ignored 残留，`workspace:archive-residue` 会把它们移动到本地归档；如没有残留，应输出“无残留需要归档”。

涉及代码组提交时，根据范围追加：

```bat
cmd /c npm.cmd run check:api
cmd /c npm.cmd run check:services
cmd /c npm.cmd run check:miniprogram-js
cmd /c npm.cmd run typecheck --workspace apps/web
```

涉及资料上下文、生成草稿、教师复核或导出链路时，按需运行：

```bat
cmd /c npm.cmd run check:generation:blueprint
cmd /c npm.cmd run check:generation:layout
cmd /c npm.cmd run check:content-context
cmd /c npm.cmd run check:content-upload-ui
cmd /c npm.cmd run check:teaching-content:full
```

选择规则：

- 生成模板、兜底内容、题型蓝图、分值和基础审查规则：先跑 `check:generation:blueprint`。
- 已生成学生卷 PDF 页数、页眉页码、异常留白或小测/练习套用试卷题型：跑 `check:generation:layout`。
- 资料上传 UI 或 multipart 封装：跑 `check:content-upload-ui`。
- 资料上下文注入、教师复核、草稿导出或正式导出边界：跑 `check:content-context`。
- 完整教师登录、资料索引、生成草稿、导出、复核和正式资产闭环：只在大改、发布前或需要完整链路证明时跑 `check:teaching-content:full`。

## 收口报告格式

每次守护者收口后，回复必须包含：

- 本次提交了什么。
- 本次没有处理什么，以及原因。
- 验证命令和结果。
- 剩余 dirty 文件按 `继续跟踪`、`本地保存`、`谨慎处理` 分类。
- 是否创建了 commit。

## 禁止动作

- 不使用 `git add .`。
- 不把未确认生成物、上传资料、缓存、日志、大体积模型数据纳入提交。
- 不删除来源不明文件；确需删除前先列出路径和判断依据。
- 不用一个提交混合规则文档、API 大改、Web 大改、小程序大改和生成物。
- 不把当前脏工作区整体搬到任何外部新项目。
