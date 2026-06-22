# 第一版方案文档索引

## 1. 必读顺序

建议按下面顺序阅读和确认：

1. `docs/32-v1-feature-list.md`  
   第一版功能清单，确定做什么、不做什么。

2. `docs/33-v1-execution-checklist.md`  
   第一版开发执行清单，确定先做哪一块、每块做到什么程度。

3. `docs/25-three-surface-experience-design.md`  
   学生端、平板端、电视端、教师端的整体体验方向。

4. `docs/26-tablet-public-screen-interaction-spec.md`  
   平板公共端拖拽头像、学习光环和互动插件设计。

5. `docs/27-tv-parent-display-spec.md`  
   电视动态屏面向家长展示的原则和模块。

6. `docs/28-student-side-experience-spec.md`  
   学生端首页、任务、AI 问答、词汇和互动扩展设计。

7. `docs/29-teacher-console-control-spec.md`  
   教师端控制、发布、复核和展示配置设计。

8. `docs/30-experience-implementation-roadmap.md`  
   整体实施路线。

9. `docs/36-web-to-miniprogram-migration-design.md`  
   Web 原型到小程序迁移前方案设计，当前只做预案，不开始迁移。

10. `docs/37-current-web-prototype-status.md`  
    当前 Web 原型状态记录，用于后续几天继续优化 Web 方案。

11. `docs/38-data-and-interaction-rules.md`  
    数据展示与互动规则，说明电视热力、匿名事件、平板解锁和学生端状态的含义。

12. `docs/39-web-prototype-optimization-roadmap.md`  
    Web 原型优化路线，安排接下来几天继续打磨的顺序。

13. `docs/40-miniprogram-migration-readiness-checklist.md`  
    小程序迁移前最终核对表，汇总页面映射、真实数据、交互边界、默认决策和验收标准。

14. `exports/miniprogram-migration-assets/README.md`  
    小程序迁移资产包说明，记录登录页头像资产、三端登录字段和迁移边界。

## 2. 当前第一版结论

第一版重点：

- 学生端：模块化首页 + 现有学习功能体验升级。
- 平板端：公共待机 + 四周头像拖拽解锁 + 插件选择。
- 电视端：多年级匿名动态数据大屏。
- 教师端：保留现有工作闭环，增加电视和平板展示控制入口。

第一版不要做：

- 课堂实时榜。
- 学生公开排名。
- 公共屏个人完成度。
- 电视学生头像墙。
- 完整小队 PK 系统。
- 完整课堂投票闭环。
- 家长独立端。

## 3. 推荐开工顺序

### 第一优先级：电视动态屏

原因：最直接影响家长参观时的信任感和科技感。

输出：

- Web 大屏页面。
- 动态数据面板。
- 匿名事件流。
- AI 流程展示。
- 教师端打开入口。

### 第二优先级：平板拖拽解锁

原因：最能体现学生参与感和现场互动性。

输出：

- 四周头像轨道。
- 中心学习光环。
- 拖拽吸附。
- 本次互动身份确认。
- 插件选择。

### 第三优先级：学生端首页改造

原因：学生端是家庭使用主入口，需要和小程序真实模块一致。

输出：

- 今日任务。
- AI 问答。
- 英语词汇。
- 拍照提交。
- 学生档案。
- 互动扩展入口。

### 第四优先级：教师端轻控制

原因：教师端先满足管理和控制，不做复杂展示。

输出：

- 打开电视动态屏。
- 平板展示模式。
- 简单插件开关。

## 4. 确认后可进入的开发任务

建议下一步直接进入：

> 整理小程序迁移准备材料，不直接修改 `apps/miniprogram/pages/*`。

当前统一登录入口、电视动态屏、平板公共端、学生端模块化首页已经在 Web 端形成原型。接下来先把登录入口定稿、君航 AI 头像资产和迁移清单收口；等小程序迁移窗口开始后，再按 `docs/36-web-to-miniprogram-migration-design.md` 执行。

正式进入迁移前，先按 `docs/40-miniprogram-migration-readiness-checklist.md` 核对并确认默认决策。
