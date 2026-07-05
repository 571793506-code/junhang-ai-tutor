# 小程序 UI 类 Skill

用于调整微信小程序学生端、教师端、课堂平板端和公共屏界面设计、信息层级、视觉状态、组件选型和交互细节。可参考 TencentCloudBase `ui-design`、Anthropic `frontend-design`、TDesign Miniprogram Skill 和 `tdesign-miniprogram`，但必须改写为君航 AI 助教的教育场景和多端权限边界。

## 适用场景

- 设计或修改小程序页面布局、视觉风格、组件、状态、空态、错误态和加载态。
- 调整学生端、教师端、课堂平板端或公共屏的 UI 体验。
- 评估是否引入 TDesign Miniprogram、WeUI 或自定义组件。
- 把 Web 原型视觉迁移成符合小程序端的 WXML/WXSS 结构。

## 设计顺序

1. 先确定端：学生端、教师端、课堂平板端、公共屏。
2. 再确定任务：学习任务、AI 问答、资料上下文、复核、批改、课堂互动或展示。
3. 再确定信息层级：主行动、次要状态、教师复核、学生可见内容、内部运维摘要。
4. 再确定视觉规则：色彩、字体、间距、卡片密度、列表密度、按钮层级、状态颜色。
5. 最后选择组件：原生小程序组件、自定义组件、TDesign Miniprogram 或其他组件库。

## 端侧 UI 原则

- 学生端：降低干扰，突出今日任务、AI 问答、拍照提交、词汇和档案；只显示 `AI生成` 或可用状态。
- 教师端：信息密度可以更高，突出学生、任务、资料上下文、生成草稿、批改和复核状态；可展示服务状态和运维摘要，但不暴露密钥和完整内部配置。
- 课堂平板端：优先大字号、远距离可读、低操作成本和多人互动状态；不展示内部模型和调试信息。
- 公共屏：只展示课堂必要信息、节奏、学生互动状态和可公开的学习成果；不展示个人隐私、未复核内容和内部上下文。

## 外部参考的本地化用法

- TencentCloudBase `ui-design`：参考视觉方向、信息层级和设计规范；不照搬通用商业 SaaS 或零售模板。
- Anthropic `frontend-design`：参考页面质感、状态完整性和响应式思路；落地时必须转成小程序 WXML/WXSS，而不是 Web CSS 思维。
- TDesign Miniprogram Skill 和 `tdesign-miniprogram`：优先用于表单、弹窗、Tabs、列表、选择器、空态、加载态、AI 对话类 UI；先评估体积、主题定制和现有样式冲突，再决定是否引入。
- `tdesign-miniprogram-starter`：只参考页面组织、组件组合和状态设计，不直接套用零售或通用模板视觉。

## 当前项目可参考位置

- `docs/25-three-surface-experience-design.md`：三端体验方向。
- `docs/26-tablet-public-screen-interaction-spec.md`：课堂平板和公共屏互动。
- `docs/28-student-side-experience-spec.md`：学生端体验。
- `docs/29-teacher-console-control-spec.md`：教师端控制台。
- `docs/44-miniprogram-migration-runbook.md`：小程序迁移和同步规则。
- `apps/miniprogram/pages/`：当前小程序页面。
- `apps/miniprogram/styles/`：当前共享样式。

## 禁止项

- 不为了“好看”扩大端侧业务逻辑。
- 不把 Web 的大屏、hover、复杂布局直接搬到小程序。
- 不用营销落地页替代真实教学工作流。
- 不在学生端、课堂平板或公共屏展示供应商、模型名、完整错误、内部 prompt 或未复核内容。
- 不直接全量引入组件库；先确认页面价值、体积、样式冲突和验证命令。

## 验证

- 修改小程序 UI 后运行 `cmd /c npm.cmd run check:miniprogram-js`。
- 修改中文文案后运行 `cmd /c npm.cmd run check:encoding`。
- 修改 `miniapp-1` 后运行 `cmd.exe /c .\jh.cmd check:miniapp1`。
- 若引入或评估 TDesign Miniprogram，记录引入范围、组件列表、样式冲突和回退方案。
