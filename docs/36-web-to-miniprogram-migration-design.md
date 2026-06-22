# Web 原型到小程序迁移前方案设计

## 1. 当前阶段说明

当前阶段已从方案设计进入小程序导入迁移准备。旧版“只做方案、不修改小程序页面”的停止线已经解除。

原因：

- 小程序迁移需要等待几天后再正式处理。
- 当前更适合先把 Web 端已经跑通的结构、数据、视觉和交互整理成迁移预案。
- 后续真正迁移时，可以直接按本方案拆分到小程序页面和组件。

本阶段执行线：

> 允许将统一入口、学生端首页、教师端控制入口和平板端公共主页先落位到 `apps/miniprogram/pages/*`，复杂拖拽、电视小程序页和完整互动闭环放到后续。

## 2. Web 端当前已完成的设计原型

当前 Web 端已经完成三块关键原型：

| Web 组件 | 位置 | 作用 |
| --- | --- | --- |
| `LoginEntryPreview` | `exports/ui-theme-preview/theme-preview.html` | 小程序统一登录入口预览，包含三端身份选择、角色风格切换和君航 AI 头像 |
| `TvParentDisplay` | `apps/web/src/main.tsx` | 教师端内的电视动态屏，用于家长参观展示 |
| `ClassroomPublicScreen` | `apps/web/src/main.tsx` | 课堂平板公共互动屏，包含四周头像拖拽解锁 |
| `StudentModuleHome` | `apps/web/src/main.tsx` | 学生端模块化首页 |

对应样式集中在：

| 样式区域 | 位置 |
| --- | --- |
| 登录入口主题样式 | `exports/ui-theme-preview/theme-preview.html` 的 `.login-*`、`.role-*` |
| 电视动态屏样式 | `apps/web/src/styles.css` 的 `.tv-*` |
| 平板公共端样式 | `apps/web/src/styles.css` 的 `.classroom-public-*`、`.tablet-*` |
| 学生端模块首页样式 | `apps/web/src/styles.css` 的 `.student-module-*`、`.student-home-*` |

## 3. 迁移总原则

### 3.1 先迁移结构，再迁移动效

第一轮小程序迁移时，建议先把信息结构和页面布局迁移过去：

1. 页面模块。
2. 数据字段。
3. 状态文案。
4. 基础视觉。

第二轮再处理：

1. 拖拽细节。
2. 光环吸附动效。
3. 动态数字刷新。
4. 图表动画。

这样能避免一开始就被小程序端交互限制卡住。

### 3.2 小程序端不照搬 Web CSS

Web 端样式只作为视觉参考，小程序端需要转成：

- WXML 结构。
- WXSS 样式。
- JS 状态和事件。

建议抽取视觉变量：

| 变量 | 用途 |
| --- | --- |
| `--jh-bg` | 页面背景 |
| `--jh-surface` | 卡片背景 |
| `--jh-line` | 边框线 |
| `--jh-text` | 主文字 |
| `--jh-muted` | 辅助文字 |
| `--jh-accent` | 科技感强调色 |
| `--jh-soft` | 柔和底色 |

### 3.3 公共屏继续坚持隐私边界

迁移到小程序后仍然保持：

- 不展示排名。
- 不展示个人分数。
- 不展示个人完成度。
- 电视端不展示学生头像墙。
- 平板端只确认本次互动身份，不进入完整个人主页。

### 3.4 小程序统一登录门禁

当前 Web 测试阶段可以继续保留页面内登录卡片，方便开发验证；正式迁移到小程序时不能照搬 Web 的内嵌登录方式。

小程序启动首页必须先让使用者选择身份：

| 入口 | 登录字段 | 登录成功后进入 |
| --- | --- | --- |
| 老师 | 电话、教师专属码 | 教师端工作台 |
| 学生 | 学生姓名、家长电话、学生专属码 | 学生端模块首页 |
| 平板端 | 平板绑定码或设备码 | 课堂平板公共端 |

迁移规则：

- 启动页只做身份选择和登录，不展示学生端、教师端、平板端的业务内容。
- 选择身份后再显示该身份需要填写的信息。
- 初始状态右侧只显示“学生端、教师端、平板端”三个端口；点击后三个端口移动到中部横向排列，右侧显示对应登录字段。
- 选择身份后左侧说明内容隐藏，君航 AI 助教头像上移，页面整体切换到对应身份风格。
- 角色风格变化必须影响整页背景、装饰线、端口卡片和表单区域，不能只改变表单局部颜色。
- 登录页使用 `exports/miniprogram-migration-assets/junhang-ai-avatar-center.png` 作为君航 AI 助教头像候选资产。
- 登录成功后进入对应端口，登录表单、示例账号、测试专属码和无关身份入口不再出现在业务页内。
- 学生端登录后只看到学生主页、今日任务、AI 问答、词汇、拍照提交和已发布档案。
- 教师端登录后才显示学生权限、今日任务、生成打印、批改复核、学生档案、教材资料、课堂设备、电视动态屏入口和系统状态。
- 平板端登录后只进入公共课堂屏，不展示教师登录或学生家长登录信息。

## 4. 学生端迁移方案

### 4.1 对应页面

| Web 原型 | 小程序页面 |
| --- | --- |
| `StudentModuleHome` | `apps/miniprogram/pages/student/home/index.*` |
| 今日任务模块 | `pages/student/tasks/index.*` |
| AI 问答模块 | `pages/student/qa/index.*` |
| 英语词汇模块 | `pages/student/vocabulary/index.*` |
| 拍照提交模块 | `pages/student/upload/index.*` |
| 学生档案模块 | `pages/student/profile/index.*` |

### 4.2 首页模块结构

学生端首页建议迁移为 6 个模块：

| 模块 | 第一版状态 | 点击去向 |
| --- | --- | --- |
| 今日任务 | 已有功能 | `pages/student/tasks/index` |
| AI 问答 | 已有功能 | `pages/student/qa/index` |
| 英语词汇 | 已有功能 | `pages/student/vocabulary/index` |
| 拍照提交 | 已有功能 | `pages/student/upload/index` |
| 学生档案 | 已有功能 | `pages/student/profile/index` |
| 互动扩展 | 预留入口 | 老师开启后再进入具体活动 |

### 4.3 首页数据字段

建议首页只需要这些字段：

| 字段 | 来源 |
| --- | --- |
| 学生姓名 | bootstrap `student.displayName` |
| 年级 | bootstrap `student.grade` |
| 今日任务数量 | bootstrap `tasks` |
| 连续学习天数 | bootstrap `student.streak` |
| 待巩固数量 | bootstrap `corrections` |
| 档案反馈数量 | bootstrap `reports` |

### 4.4 迁移注意事项

- 学生端首页不要做复杂信息流。
- 模块卡片只做入口和状态摘要。
- 互动扩展默认低调展示，老师没有开启时不展示具体活动内容。
- AI 问答入口文案强调“思路引导”，不强调代写答案。

## 5. 平板端迁移方案

### 5.1 对应页面

| Web 原型 | 小程序页面 |
| --- | --- |
| `ClassroomPublicScreen` | `apps/miniprogram/pages/classroom/dashboard/index.*` |

### 5.2 页面状态

平板端建议迁移为 4 个核心状态：

| 状态 | 小程序数据字段 |
| --- | --- |
| 公共待机 | `mode: "idle"` |
| 拖拽头像 | `mode: "dragging"` |
| 身份确认 | `mode: "confirmed"` |
| 插件选择 | `mode: "plugin"` |

### 5.3 头像轨道

Web 原型中通过 `splitAvatarRails(students)` 把学生分到四周：

- 上边：top。
- 右边：right。
- 下边：bottom。
- 左边：left。

小程序迁移时建议在 JS 中生成：

```js
const rails = {
  top: [],
  right: [],
  bottom: [],
  left: []
}
```

然后 WXML 分四组渲染。

### 5.4 拖拽交互迁移方式

Web 原型使用 HTML5 drag/drop。

小程序端不能直接照搬，建议用：

- `bindtouchstart`
- `bindtouchmove`
- `bindtouchend`
- 记录触点坐标。
- 判断是否进入中心光环区域。
- 松手后进入身份确认。

第一轮可以先做点击头像模拟确认，第二轮再做完整拖拽。

推荐迁移顺序：

1. 四周头像轨道静态展示。
2. 点击头像进入身份确认。
3. 增加长按态。
4. 增加拖拽坐标。
5. 增加中心吸附判断。

### 5.5 插件栏

第一版插件栏迁移为：

| 插件 | 状态 |
| --- | --- |
| AI 问答 | 可用 |
| 听写播报 | 可用 |
| 课文跟读 | 可用 |
| 课堂投票 | 入口 |
| 今日鼓励 | 入口 |
| 小组协作 | 入口 |

插件栏规则：

- 未确认学生前显示为低亮状态。
- 确认学生后可进入可用插件。
- 入口型插件只展示，不进入完整流程。

## 6. 电视动态屏迁移方案

### 6.1 当前建议

电视动态屏第一版不建议迁移成小程序页面。

更推荐保留为 Web 大屏：

- 浏览器全屏展示。
- 电视或投影打开 Web 地址。
- 教师端提供入口。

原因：

- 电视动态屏更适合 16:9 大屏布局。
- 小程序投屏到电视的显示比例和性能不稳定。
- Web 更容易做动态图表、流线、热力图和自动刷新。

### 6.2 若后续必须做成小程序页面

可以新增：

| 小程序页面 | 用途 |
| --- | --- |
| `pages/tv/dashboard/index` | 电视动态屏 |

但建议放到后续版本，不纳入当前迁移第一步。

### 6.3 Web 大屏保留模块

| 模块 | 是否保留 |
| --- | --- |
| 今日学习运行概览 | 保留 |
| AI 学习中枢 | 保留 |
| AI 处理队列 | 保留 |
| 多年级任务分布 | 保留 |
| 实时学习动态 | 保留 |
| 学科知识互动热力 | 保留 |

## 7. 教师端迁移方案

### 7.1 对应页面

| Web 原型 | 小程序页面 |
| --- | --- |
| 教师端工作台 | `pages/teacher/console/index.*` |
| 学生权限 | `pages/teacher/students/index.*` |
| 今日任务 | `pages/teacher/tasks/index.*` |
| 生成打印 | `pages/teacher/assessments/index.*` |
| 批改上传 | `pages/teacher/grading/index.*` |
| 批改复核 | `pages/teacher/review/index.*` |
| 学生档案 | `pages/teacher/profile/index.*` |
| 教材资料 | 后续复用教材/资料 API，不在学生端暴露 |
| 课堂设备 | 后续复用平板锁定、听写、跟读、播报接口 |
| 系统状态 | 教师端控制台内显示服务状态和审计摘要 |

### 7.2 教师端新增入口

后续迁移时教师端可以新增两个轻入口：

| 入口 | 说明 |
| --- | --- |
| 打开电视动态屏 | 显示 Web 大屏地址或二维码 |
| 平板展示模式 | 常规待机、家长参观、课堂互动 |

第一版不做复杂配置，只做入口和状态。

## 8. 数据迁移应用方案

### 8.1 继续复用现有接口

小程序迁移时优先复用：

| 场景 | 接口 |
| --- | --- |
| 初始化数据 | `/api/bootstrap` |
| 学生登录 | `/api/student-login` |
| 教师登录 | `/api/teacher-login` |
| 平板登录 | `/api/classroom/device-login` |
| AI 问答 | `/api/ai/qa` |
| 任务发布 | `/api/teacher/tasks` |
| 上传提交 | `/api/submissions/batches` |
| 批改复核 | `/api/review/submissions` |
| 学生档案 | `/api/students/:studentId/profile/*` |
| 平板设备 | `/api/classroom/devices/:deviceId` |

### 8.2 后续可新增接口

| 接口 | 用途 | 何时需要 |
| --- | --- | --- |
| `/api/display/tv-summary` | 返回电视动态屏匿名聚合数据 | Web 大屏需要真实统计时 |
| `/api/classroom/display-config` | 返回平板展示模式、插件开关 | 平板端需要教师远程控制时 |
| `/api/classroom/interactions` | 写入头像确认、插件使用事件 | 需要沉淀互动记录时 |

## 9. 迁移前检查清单

真正开始小程序迁移前，需要确认：

1. 小程序统一登录入口是否最终确定为学生、教师、平板端三类身份。
2. 学生端首页 6 个模块是否最终确定。
3. 平板端是否第一轮先做点击确认，还是直接做拖拽。
4. 电视动态屏是否继续保持 Web 大屏。
5. 教师端是否需要先加“打开电视动态屏”入口。
6. 平板端插件中哪些是真可用，哪些只展示入口。
7. 是否需要新增平板互动事件接口。

更完整的页面映射、真实字段、交互边界、默认决策和验收标准见：

> `docs/40-miniprogram-migration-readiness-checklist.md`

## 10. 暂停点

当前工作建议暂停在：

- Web 端原型继续优化。
- 方案文档继续补充。
- 不迁移小程序。
- 已开始补齐 `apps/miniprogram/pages/*` 的教师端模块入口；后续继续按 Web/API 契约迁移，不把核心逻辑写成小程序专属。

等可以开始迁移时，再按本方案先处理统一登录入口，然后进入学生端首页和平板端 dashboard。
