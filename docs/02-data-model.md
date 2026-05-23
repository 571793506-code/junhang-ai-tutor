# 数据模型草案

## 核心对象

- `students`：学生基本信息。
- `guardians`：家长信息与绑定关系。
- `teachers`：老师信息。
- `classes`：班级/教学组。
- `subjects`：学科。
- `knowledge_points`：知识点树。
- `textbook_assets`：教材、课文、单元和素材索引。
- `learning_tasks`：老师或 AI 创建的学习任务。
- `task_attempts`：学生完成任务记录。
- `dictation_sessions`：背书/听写过程记录。
- `qa_sessions`：知识问答会话。
- `vocabulary_records`：英语词汇学习记录。
- `assignments`：作业/试卷。
- `assignment_items`：题目。
- `submissions`：学生提交。
- `grading_results`：批改结果。
- `mistake_records`：错题记录。
- `behavior_events`：学习行为日志。
- `student_profiles`：学生长期画像。
- `student_reports`：日/周/月/期中/期末档案。
- `generated_assets`：PPT、讲义、试卷、解析、3D 场景等生成物。
- `model_runs`：每次 AI 调用、输入摘要、输出摘要、成本与状态。

## 学生画像字段

- 基本信息：年级、学校、教材版本、班级、家长绑定。
- 学科表现：语文、数学、英语等分学科掌握度。
- 知识点掌握度：0-100 分或等级制。
- 学习习惯：完成率、耗时、复习频率、提问方式。
- 错因分布：不会、概念混淆、粗心、审题、表达不完整。
- 情绪和反馈：鼓励性观察，不做医疗或心理诊断。
- 发展建议：短期补弱、中期提升、长期兴趣方向。

## 行为日志事件

每个事件至少包含：

- `student_id`
- `actor_type`：student / guardian / teacher / system
- `feature`：dictation / qa / vocabulary / grading / report 等
- `action`
- `occurred_at`
- `duration_seconds`
- `metadata`

## 报告生成原则

- 家长版：少术语，重事实、变化和建议。
- 老师版：保留知识点、错因、证据和后续任务。
- 学生版：鼓励优先，告诉他下一步怎么做。

