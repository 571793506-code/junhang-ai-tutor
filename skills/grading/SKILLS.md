# 批改类 Skill

用于修改、复用或审查图片批改、答案键对齐、OCR 识别、逐题复核、低置信拦截和教师确认归档经验。当前阶段只沉淀流程经验，不把现有复杂自动批改链路继续扩大为默认实现。

## 适用场景

- 学生或老师上传作业、小测、试卷、听写图片，需要识别作答并形成批改草稿。
- 需要区分已有生成材料批改和外部材料批改。
- 需要判断低置信结果是否允许出最终分或写入学生档案。
- 需要生成图片上传后的老师侧待复核摘要。

## 何时加载

当意图是批改已生成材料、外部练习册、图片作业、OCR 结果或逐题分数时加载。已有生成记录优先读取 `gradingSourcePackage`；外部材料走独立参考答案登记路径。

必须同时读取 `skills/grading/references/runtime-rules.md`。证据判断、合理异解、逐题评分和确认细则在该文件统一维护；本 Playbook 负责工具顺序和服务端门禁。

## 前置依赖

服务端必须确认学生仍可接收新工作、图片页序和质量、题目布局、答案来源及教师权限。生成材料需要有效的 `gradingSourcePackage` 和 `questionLayoutManifest`；外部材料需要参考答案证据或明确进入待复核状态。工作流持久化已在当前本机业务库完成迁移并启用；不要把旧验收记录中的“开关关闭/迁移未执行”当作当前状态，实际部署仍须按环境检查。真实批改正向验收仍要求完整原始识别、有效答案来源、教师确认和服务端归档证据。

## 输入契约

持续工作流入口见 `docs/14-api-contract.md` 的 Shared workflow API and CLI。薄 CLI 为 `node scripts/teaching-workflow.mjs`；从已登记 studentId/submissionId 创建草稿，原始作答、答案包和证据绑定由服务端读取。先读取当前版本，再携带题目 ID、expectedRevision 和稳定 operationKey 提交修订或教师确认；自然语言修订携带 instruction，手工修正使用显式 patch。创建/重判/校验适配器及 Web 工作台已实现并通过合成契约测试；当前本机业务 schema 已完成工作流迁移并启用持久化，隔离 PostgreSQL 工作流表事务、HTTP/对话客户端持久化及合成数据的发布/归档跨表事务已验收。可信服务端归档可复用未变化的确认；工作流 confirm 不触发独立 archive 命令，不得用导入 JSON 的确认人或时间代替服务端教师凭据。真实正向批改验收仍需当前链路产生的原始识别、有效来源包、教师确认及服务端 archive 记录，历史批改结果不能单独补造这些输入。

批改上下文分开保存 `printedPrompt`、`studentAnswer`、`ocrQuestions`、答案来源、图片质量和教师修正。Web 不得提交 `finalScore`、`archiveEligible`、provider、model 或 raw；服务端确定题号对齐和允许发送给模型的未解决题目。

独立回放还须保留原任务的教师评分要求。采集器仅从已经验证的不可变归档snapshot.resolvedRequest.requirement提取并脱敏为teacherContext，与工作流执行器同源；不从expected、批改解释或可变字段反推评分政策。旧快照遗漏该字段时重新采集到新路径，核对教师金标及原作答未变，不能直接改旧输入或宣称旧回放与原任务条件相同。

模型调用可将指纹有效且逐题题干、答案、满分匹配的来源包投影到未解决题的referenceAnswers，保留结构化多空答案、rubric、原解析与来源context；原完整来源包仍留在服务和归档边界。只删除与逐题识别精确重复的汇总文本，保留原observedWork、置信度和坐标。冲突或无法验证时保留原上下文，不截断来源包后重新生成指纹。核查attempt.transportDiagnostics.requestBytes才能判断精简是否实际生效，不能由字节减少推断超时已修复。

历史来源包缺少 `context.itemType` 时，执行器只能使用服务端从已登记 AssignmentItem 验证得到的题型：题号唯一对齐，题干、答案和满分均与来源包一致。类型绑定到 `archiveEvidence.assignmentQuestionTypes` 及证据指纹，题型变化使旧绑定失效；已归档版本保留原绑定。来源包自身的类型优先，不根据 OCR、题号区间或客户端字段猜题型。选择题可保守本地比较；多空填空不能因此强行本地判定，计算和应用题仍检查过程。

## 持续批改工作台与对话共用动作

教师 Web 的“批改复核 → 持续批改与版本”和 CLI 使用同一工作流 API；组件不拼接核心 prompt、不选择模型。当前本机持久化已启用；若运行环境未完成迁移或未启用开关，才显示“暂未启用”，日常上传、识别、来源登记与旧批次筛选继续使用原入口。

- 先读取当前版本及题目 ID，对照服务端原图、作答与可信参考答案。bbox 只有在页码、图片引用、裁剪空间一致且坐标有效时才能叠加；不能用不同裁剪区域的坐标标记整页。
- 修正识别提交 `action:"revise"`、`targetQuestionIds:[id]`、`patch:{type:"correct_recognition",questionId:id,value:{studentAnswer:"核对后的作答"}}`。必须保留 expectedRevision 和 operationKey。null 是未可靠识别；只有教师核对确为空白才提交空字符串，不能把模糊字迹猜成空白。
- 服务端记录识别修正凭据并只重批该题，保留原 OCR 置信度和坐标。完整 replace_question 中修改 studentAnswer 也走该路径，不沿用上传的评分。识别修正不等于评分确认，改后仍需教师检查。
- 新建草稿与逐题重判须保留独立的 observedWork、原图页码和图片/裁剪引用，计算题和应用题不能仅凭最终答案丢掉原过程。observedWork 属于服务端绑定的原始识别证据，评分修改不能删除或伪造它；未知 OCR 置信度保持 null，仅已验证的教师答案修正可在本次调用使用有效可信度1，保存版本仍保留原置信度。
- 仅改评分或解析时，读取完整当前题后提交 `replace_question` patch；不改 studentAnswer、不携带 instruction 时不调用模型。按要求重判则用 instruction，只提交当前题目标。受影响题撤销确认，未变化题保留原确认。
- confirm 只选教师已检查的题，不能把“已核对”扩展为所有题。全部确认后另行 archive，归档接口只接收 expectedRevision，由服务端再次检查来源、权限和证据。已有可信对话归档可复用未变化确认；上传 JSON 不能凭确认字段绕过检查。
- 409 冲突保留本地编辑，重新读取并比较后再发起新操作，不直接改 expectedRevision 自动覆盖。历史版本只读；恢复追加新版本，不改旧归档。归档重放使用原版本；同版本不会重复写入。

## 输出契约

教师端接收页质量、OCR 题目、答案来源、置信度、逐题状态、`archiveBlockers` 和 `workflowState`。学生端只接收教师确认后的分数与反馈；低置信、缺页、缺答案、冲突或未确认结果不得归档或进入 `profileEvidencePack`。

## 执行顺序

先验证来源包或登记外部参考答案，再按页序识别并对齐印刷题干和学生作答；客观题由服务层保守比较，未解决题目才发送任务策略指定的模型，最后汇总逐题得分并等待教师逐题确认。入口为 `gradeSubmissionService -> generateSubmissionReferenceAnswers/gradeSubmissionText -> runSubmissionPipeline -> runTeachingTask`；参考答案仅依据题干证据生成，不把学生作答作为答案来源。

## 模型与复核

模型超时先核对内部attempt.transportDiagnostics：request_started代表尚未观察到响应头，response_headers代表响应体尚未完成，response_body_complete代表传输已完成。只记录白名单阶段、HTTP状态、耗时和字节数，不保存URL、密钥、原始模型输出或学生文本；此观察不能直接确定供应商根因。无响应状态仍未知，不把deadline解释为HTTP 503。合成小请求成功仅证明当前基本通道，不能证明整卷可用；教师已确认评分及归档不受独立回放失败影响。

调用前读取 `packages/ai/src/model-policy.js` 的任务策略，本文件不复制模型参数或数值预算。2026-10-19教师指定GPT-6.1 Sol负责主观批改与参考答案，DeepSeek Flash负责辅助提取及可选识别。同型号替补被禁用；可用性故障不重复调用同一型号，质量校验失败仍最多由主模型修复一次，共享原有操作预算。MiniMax新视觉模型通过受限执行器按页识别；旧coding_plan/vlm保留显式兼容入口。裁图识别和合成探针只证明兼容性，整页识别与批改质量仍须单独验收。修改.env后必须核实运行中API是否已重新加载。任何 `teacher_confirmation` 未完成的结果都保持草稿或 `review_required`。

## 核心原则

- OCR、学生作答识别、标准答案和归档必须分层处理。
- 新任务、生成和批改上传必须由服务端复核目标学生仍可接收新工作；多端选择器只消费 `canReceiveNewWork`，不自行解释登录或退课状态。
- 对于本平台新生成的小测、练习和试卷，优先读取 `gradingSourcePackage` 中逐题题干、答案、分值、解析和评分依据；它比 PDF 文本、旧答案键和 OCR 印刷题干优先。学生卷和解析卷资产只用其来源 ID、版本和指纹关联。
- 有答案键、生成记录或 `questionLayoutManifest` 时优先使用它们，不重新猜题。
- 没有答案键时先生成参考答案，再标记置信度和复核风险。
- 视觉 OCR 结果必须保持页序稳定；候选适配器没有通过真实图片评估前，不迁移默认识别链路。
- 单一明确答案的选择、短填空和数值题优先在服务层保守比较；多空或组合参考答案不做整题布尔比较，短文本不相同不直接判错，交给主模型判断语义及部分给分。单一数值和单选仍可确定性判分，不新增审查调用。
- 混合题只把未解决题目、对应作答和参考答案发送给主模型；总分必须由逐题得分汇总，模型顶层分数不得覆盖。
- 低置信、漏页、题目缺失、学生作答缺失、图片质量差、参考答案不可靠或模型分歧时，不出最终分、不入档、不发布。
- 教师确认后才写入学生档案、错题记录和薄弱点分析。
- 默认主链路执行 OCR/视觉识别、答案键优先、客观题本地比较、Sol 主观题批改、低置信标记和教师逐题复核。`gradeSubmissionService` 的参考答案与主观批改共享操作 deadline/token pool；不再执行服务层风险复判或深度模型审查。`uncertain` 的逐题与总分保持 null。
- 配置 `OCR_VISION_PROVIDER=deepseek-flash` 才选用 Flash 候选识别器；`recognizeImages` 输出沿用既有 OCR 契约，页码取服务端图片顺序，保留 bbox、sourceImageRef 和 cropRef。它只提取证据，不给分或确认归档。
- 失败先分类，configuration 故障不追加调用；OCR、题干、学生作答或参考证据不足属于 evidence 故障，直接进入教师复核。额外调用次数和预算由代码策略统一约束，不能在服务层与模型层各叠加一套重试。
- `usedModelEscalation`、模型名、档位、触发原因和预算只属于内部运行元数据，不得展示给学生、家长、课堂平板或公共屏。Sol availability 和合成质量样本只证明链路可用，不能证明生产批改正确率；正确率必须使用教师确认的 gold 数据评估。
- 采集真实批改质量样本时先运行 `cmd /c npm.cmd run collect:grading:gold` 做只读dry-run；确认候选范围后用 `--write tmp/quality/grading-gold-cases.json` 写出脱敏样本。教师已确认归档提供expected金标，不提供待测actual；对话中已确认的生成批改按 `gradingSourcePackage`、逐题确认和归档状态纳入，外部图片批改还必须有OCR、答案来源和图片质量证据。采集数量不等于模型准确率。
- 旧来源包缺少题型时，采集复用服务端题号、题干、答案和满分一致的登记题型；不可变工作流归档必须先验证完整证据，再沿用其原始assignmentQuestionTypes绑定，不能被当前AssignmentItem变化覆盖。来源包题型优先，不从OCR或题号区间推断。补齐仅发生于脱敏评估输入，不能改业务来源包、教师expected或原归档；共享材料及原图布局未知时保持未知。
- 真实回放使用 `cmd /c npm.cmd run replay:grading:gold -- --gold <gold.json> --output <evaluation.json>`；评估入口只使用服务层结构化结果并强制 `persist:false`，需要受控模型探针时显式增加 `--model <model>`，需要缩短诊断预算时增加 `--timeout-ms <milliseconds>`。actual与evaluationRun由独立服务回放产生并绑定输入/结果哈希，禁止复制expected或手工填写actual充当执行结果。回放文件直接交给 `cmd /c npm.cmd run check:grading:quality -- <evaluation.json>`；缺失或无效执行证据的样本不参与指标，全部无效时指标为null，混合批次用counts.evaluatedCases注明有效范围且整批仍失败。不得把模型原始输出写入金标或正式资产。

## 两条处理路径

### 已确认转写与部分分待裁定

- 单题重新批改同时保留原教师要求与本次修订指令。服务端仅从当前教师身份、题号唯一、修正值与当前作答精确一致的工作流凭据生成 `recognitionReview:{status:"teacher_corrected",field:"studentAnswer"}`；普通请求自带此字段无效。原始 OCR 摘要、置信度、坐标及历史归档保留，不把转写修正当作评分确认。
- 已核验转写优先于旧的待修正要求及矛盾 OCR 摘要，但不补造缺失过程，也不解决题干或评分细则缺失。教师仅改分不能冒充 OCR 修正；原教师评分继续有效。
- 质量采集先验证不可变归档，再将有效转写状态脱敏写入新样本；回放只把状态及对应当前作答送入服务端修正选项，禁止传入 expected、教师身份、得分裁定或确认权限。旧样本不覆盖，独立回放保持 `persist:false`。
- `grading-v3` 对部分分待定要求解释已确定得失分项、待裁定项与缺少口径。仍保持整题 `score:null` 及教师最终评分权，不把确定项小计当作最终分数。

已生成材料：

- 使用 `assignmentId`、`gradingSourcePackage`、题目布局清单和导出资产来源版本；历史生成记录没有答案包时，才兼容使用题目、答案键和 `questionLayoutManifest`。
- 只识别学生作答区域，按题号对齐。
- 这条路径可追溯答案与来源版本，实际准确率仍需教师确认样本验证。

外部材料：

- 先识别印刷题干、学生作答、页序、清晰度和题目区域。
- 再生成参考答案和评分点。
- 最终只给教师待复核草稿，不自动归档。

## 当前项目可参考位置

- `docs/48-grading-workbench-redesign.md`：批改工作台目标、状态和实体设计。
- `docs/14-api-contract.md`：批改上传、工作台、逐题修正和归档接口。
- `packages/services/src/index.js`：批改服务层、低置信和归档门禁经验。
- `apps/api/src/server.js`：`POST /api/submissions/grade`、工作台和归档路由。
- `docs/20-ocr-prestructure.md`：OCR 预处理和低置信处理原则。

## 推荐输出形态

教师端批改输入应整理为明确动作：

```text
批改上传图片
使用答案：1.A 2.C 3.略
```

输出建议包含：

- 图片质量和页数判断；
- 已识别题号和学生作答摘要；
- 有答案键时的逐题辅助判断；
- 无答案键时的参考答案草稿；
- 低置信项；
- 需要老师确认的分数和题目。

## 连带错误复核

连带错误的复核依据仍是本题权威rubric与observedWork，执行runtime-rules中的“判断与给分”。分别检查根源错误、保留项、独立新错及最终答案项；不得从相邻题推定本题未规定的给分口径。已有评分规则模糊且影响分数时保留uncertain/null。诊断夹具scripts/test-support/teaching-practice-cases.mjs中的预期分来自合成规则，不是历史学生金标，也不覆盖已确认的2、2、1、1结果分。

解析先比较原题与学生首行，再比较相邻可见算式；对照完整studentAnswer与observedWork，用实际短算式定位，区分等价拆分、符号展开、乘积和合计错误。教师已允许错误传递时，按学生上一行实际数值核对后续计算；能够确定的完整计算项目明确保留，只有内部对错混合且缺少分配口径的项目待裁定。不能把过程摘要当作完整原作答，不能把原题的项误称为学生改写后的另一项。教学细则只在runtime-rules维护，Web和对话共享同一正文；不追加模型审查或改写原模型文本来制造通过。

过程字段未提供与原卷确实无过程、运算顺序多空的等价表达及逐空分值、独立最终结果项的处理均遵从runtime-rules。以buildGradingEvidenceBoundaryCase作合成边界诊断，原始学生样本另行回放；不把诊断预期注入模型，也不以模型同分代替解释核查或教师最终评分。

## 禁止项

- 不自动把批改结果发布给学生或家长。
- 不自动归档低置信结果。
- 不把当前多模型批改审查链作为默认主链路继续扩大。
- 不把印刷题干、示例答案或 OCR 混合文本当作学生作答。
- 不在普通端展示模型、供应商或内部评分链路。

## 验证

- 修改批改 API 或工作台服务时运行 `cmd /c npm.cmd run check --workspace apps/api`。
- 修改 Web 批改原型时运行 `cmd /c npm.cmd run typecheck --workspace apps/web`。
- 涉及小程序既有快照时运行 `cmd /c npm.cmd run check:miniprogram-js`，但当前阶段不新增小程序功能。
- 修改中文提示词、批改文案或归档规则时运行 `cmd /c npm.cmd run check:encoding`。
- 金标文件必须由教师确认：每个case需要 `caseId`、`sourceType`、`input`、`expected` 和 `teacherReview`；teacherReview必须包含confirmedBy、ISO格式confirmedAt和modifiedQuestionNos，每题须有教师确认答案，或在status=uncertain时提供原因。先由 `quality-gold-contract.mjs` 校验，独立回放后再运行 `cmd /c npm.cmd run check:grading:quality -- <evaluation.json>`。
- `fixtures/quality/grading-gold-cases.example.json` 是无actual的合成金标契约样本；直接执行质量检查必须退出1、evaluatedCases为0且指标为null，须先独立回放才有待评估结果。合成回放仍不得作为生产准确率证据。没有真实教师确认gold、合格独立执行证据和教师复核报告前，不得宣称批改正确率已达生产标准。
