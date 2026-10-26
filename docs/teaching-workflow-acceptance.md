# 生成与批改工作台验收记录

更新日期：2026-10-10。对应日常工作台计划 Task 9。当前结论：第1至4项已按教师确认完成；第5项“当前学生/教材/教师留出任务”暂缓，待教师与学生继续磨合。第6项已完成业务库备份、工作流迁移、Prisma Client 更新及持久化启用；教师已确认本份生成内容，真实 Web 已完成发布、预览与正式学生卷/解析卷导出，两份均为1页A4。本轮16题真实批改已按教师最终决定确认，版本5、37.5/60分；独立归档、8条错题、真实数据库幂等及档案证据准入验收通过。Web教师确认和归档回显已修正，真实任务刷新后显示版本5已归档，分数及确认数保持一致。按已约定范围，第九阶段教学与数据库闭环验收完成，可进入下一阶段；第5项继续暂缓。下文较早的失败、未确认、未归档及旧界面问题均为历史记录，以最新记录为准。

### 2026-10-26 日常质量闭环：新版规则剩余7份重验与待办核对

- 完成尚未使用当前grading-v3重验的7份144题，退出0、completed=true、无剩余候选。沿用Sol 6.1 high及180秒总预算，persist:false；expected及teacherReview不进入模型，原输入投影、原作答和源gold未改。本批仅验证文本评分，不包含重新OCR、Web操作或打印导出。此前已按同一规则重验的35题不重复调用，旧179题统计不能当作新版结果。

| 样本caseId | 题数 | 秒 | 同分 | 待定 | 分差 |
| --- | ---: | ---: | ---: | ---: | ---: |
| grading-29c64a88f35027f7 | 12 | 68.7 | 4 | 8 | 0 |
| grading-f712a93d8aa71ece | 20 | 77.2 | 12 | 8 | 0 |
| grading-0b7868f59da6672b | 12 | 69.5 | 5 | 7 | 0 |
| grading-2be54f928a5993b5 | 20 | 94.1 | 0 | 20 | 0 |
| grading-f40303cf96301a23 | 16 | 73.2 | 5 | 11 | 0 |
| grading-35179edc0d80724a | 29 | 179.9 | 13 | 16 | 0 |
| grading-b275c83f89872733 | 35 | 87.2 | 18 | 17 | 0 |

- 质量CLI独立零调用重读退出0，有效执行7/7；57题有数值评分且同分，87题待定，0缺题、0数值分差。逐题分数覆盖率及一致率均39.58%，可比题MAE为0；7份草稿总分均null，不能称整卷或生产准确率100%。抽查解释仍区分未采集过程与实际未写过程，多空部分正确但缺逐空分值时不默认均分；已有独立结果分可说明但不补造过程分。2份45题缺少原作答的样本继续阻断。
- 7份均仅一次主调用，无修复、替补或额外审查，均观察到HTTP200及response_body_complete；执行规则hash逐份与当前正文f1f496960568c6954ad86675b3121ff240d9b877010ae8d28e9a71ae025c1517一致。29题179908ms接近180秒上限，整卷稳定耗时仍未验收。两次渠道报告completion_tokens为6050及9476，高于请求配置6000，计量/限制含义仍待核实，不能说渠道实际输出均受该配置限制；费用未知，不提高预算或追加调用。
- 第5题已定位历史35题归档：教师原1/2分的扣分说明为要求计数单位表达、未接受分数形式；来源rubric给出“3个0.1、5个0.001”，没有明确禁止等价分数。该说明来自教师金标侧，不直接注入模型来制造一致。教师要求先看原卷；本地项目、历史归档目录及附件缓存未找到可打开的原图，只有4张照片文件名登记。等待教师重新提供原页核对，保留原1分，不拿转写或重建稿冒充原卷。
- 业务工作流、全部历史版本及独立归档完整对象哈希前后一致，Submission/GradingResult/MistakeRecord/Assignment/TeachingWorkflow数量仍为42/42/114/272/10；原版本5、37.5/60、GRADED、needsReview=false不变。证据前缀tmp/quality/daily-followup-20261026，含完整回放、7份checkpoint、inventory、quality、differences、inspection、review及数据库before/after；CLI报告为daily-followup-cli-quality-20261026.json，规则/输出编码与数据库核验日志为daily-followup-inspection-20261026.log。
- 剩余事项：评分所缺原过程/逐空分值/选项/题型证据及第5题核对；整卷稳定耗时及渠道计量；近期两份已认可内容新稿的实际打印版式。当前学生/教材/教师留出任务按教师决定暂缓，工作区清理后置。第九阶段原有正式双卷、教师最终评分、独立归档及数据库闭环不重新列为未完成；较早计划未勾复选框须结合后续完成记录阅读。
- 本轮回放/评测定向回归24/24通过、0跳过；全量编码扫描1182文件，仍仅既有tmp/quality/task9-prisma-package-20260926/package/runtime/binary.js:126告警，退出1、0修复，不称全量通过。正式文档另用共享守卫与严格UTF-8核对；不改vendor、不放宽检查、不处理原encoding-history-report.md和output/。

### 2026-10-23 日常质量闭环：运行重载与真实Web入口核验

- 旧API进程18772启动于17:15，早于共享服务18:13的修改，不能视为已载入上一轮修正；当时5173端口未监听。确认无在途教学工作流后，仅停止核实过的旧API子进程，由既有本地守护重启为18744（19:03）。API直接从@junhang/services的./src/index.js加载服务，进程启动晚于源码修改；源码与grading-v3规则哈希已保存，规则仍为f1f496960568c6954ad86675b3121ff240d9b877010ae8d28e9a71ae025c1517。恢复Web至http://127.0.0.1:5173/，保留两项服务运行，不改模型、180秒预算或追加审查。
- Playwright/Edge真实页面验证发现：登录后手动选任务可用，但页面刷新并重新登录后，保存的批改任务没有自动恢复。实际HTTP成功且无控制台错误；根因是React.StrictMode重复挂载使首个读取序号失效，已设置的currentId却阻止第二次读取。只在批改工作台卸载清理时清空当前读取标记，保留服务端版本、权限、评分及独立归档边界。页面刷新仍需按现行逻辑重新登录，再恢复该教师的任务ID，不声称自动恢复登录态。
- 既有浏览器回归加入StrictMode及刷新恢复不新增评分调用的断言。首次冷启动曾因Vite编译超过8秒在导航处失败，单独将导航等待设为30秒，业务断言等待仍8秒；随后准确复现刷新后任务不显示的失败，再实施最小修正。修正后2/2浏览器回归通过、0跳过，覆盖合成上传、来源管理、服务不可用、局部识别修正、教师确认、过期保存、独立归档、历史只读及窄屏；模型/OCR和数据库为合成或内存fixture，不是新增真实学生评分。红绿日志为tmp/quality/grading-runtime-strict-{red,red2,green}-20261023.log；Web类型检查通过，日志grading-runtime-web-typecheck-20261023.log。
- 真实Web只读验收路径：教师UI登录→批改复核→选择原16题任务→刷新当前批改→查看第14题→刷新页面→重新登录并恢复任务。页面与HTTP均显示版本5已归档、37.5/60、16/16已确认，第14题教师已确认5/5。1440×1000及390×844实测，题干作答与解析各占独立完整行；窄屏scrollWidth=390，无横向溢出。无Vite错误遮罩、pageerror、console error或请求失败。浏览器拦截非登录业务写请求，实测0次阻断、0模型调用、0业务修改；登录会创建会话，不能称整个数据库零写入。无Browser插件，复用已安装Playwright与Edge，未安装依赖。
- 浏览器证据及截图位于E:/AppData/Cache/Temp/junhang-runtime-20261023-v3/，包括browser.json、desktop-question14.png和mobile-question14.png；失败中间证据保留在同名前缀及-v2目录。运行前后证据为tmp/quality/grading-runtime-{before,after,final,process-before,process-after}-20261023.json。业务工作流、全部版本及独立归档完整对象哈希前后一致，Submission/GradingResult/MistakeRecord/Assignment/TeachingWorkflow数量仍为42/42/114/272/10，历史评分状态GRADED、needsReview=false不变。真实health与数据库正常，未登录工作流读取401、教师读取200。最终补验按generating/exporting_draft/cancelling及保守包含queued检查生成任务：列表0、在途0；先前before/after脚本只检查queued/running，不能将其追溯称为覆盖所有生成状态。
- 本次完成运行载入、批改入口和刷新恢复修正，不是新版规则的又一次模型评分或稳定耗时验收。上一轮35题17同分/17待定/1分差及157.0秒结论仍按原证据保留；第5题等价表达、可信过程/逐空分值缺口、其余样本新规则回放及整卷稳定时长继续待办。第5项留出任务和工作区清理仍暂缓；既有output与编码历史报告未纳入本次提交。
- 收尾检查：全量编码扫描1172文件，仍仅既有tmp/quality/task9-prisma-package-20260926/package/runtime/binary.js:126告警，退出1、0修复，不称全量通过；本轮4份正式修改文件的严格UTF-8解码及共享编码守卫通过，git diff --check通过。日志grading-runtime-encoding-20261023.log及报告grading-runtime-validation-20261023.json保留，未改vendor或放宽检查。

### 2026-10-23 日常质量闭环：过程证据边界与多空语义评分修正

- 本轮修正共享服务及grading-v3，不更换Sol 6.1 high、不扩大180秒总预算、不追加审查。根因之一是本地客观题短文本比较将数组规范化后的逗号组合答案直接整题判错，未进入模型；现在组合答案、多空题及非字面匹配短文本交现有单次语义判断，单选及单数字的确定性判断保留。同步运行规则、批改Skills入口和Prompt Playbook。
- 明确observedWork缺失、null或空字符串不证明学生实际未写过程；同时读取完整studentAnswer，过程证据不足且影响过程分时保留uncertain、score:null。只有可信来源确认实际未写过程才使用结果特例；多空题接受符合题意的等价表达，部分正确但无逐空分值时不默认均分。rubric无附加条件的独立结果分单独判断，错误过程不能取消正确的独立结果项，也不能因此获得过程分。
- 新增10题合成边界诊断并在旧、新规则各真实运行一次，persist:false，预期结果不进模型。相同输入旧运行21.3秒有3处偏差，新运行58.6秒10/10符合预期，逐题解释已核查；合成结果不是教师金标。旧第7题错误过程取消独立结果分，第9/10题被本地整题清零；新运行分别保留独立结果1分、按明确逐空分值给1.5分、分值缺失保留null。证据为tmp/quality/grading-evidence-diagnostic-{baseline,revised}-20261023.json。
- 原35题grading-8d2ba1c830b85778保持完整输入、expected和teacherReview，独立真实回放157019ms完成；唯一主调用，HTTP200、response_body_complete，无修复或替补。配置输出上限6000，渠道报告输入25375、输出5974 tokens，费用未知。17题同分、17题待定、1题分差，总分仍null；此前同样本56.2秒、20题同分、8题待定、7题分差。待定增加反映证据不足被保留，不能将分差减少直接称为准确率提升；本次更慢，未通过稳定时长验收。
- 逐题核查：第1题前三空的运算顺序表述获认可，末空80错误，因原逐空分值缺失保留null；第22/25/27/28/31/32/33/34题只有最终错答、过程未采集，本次均保留null，不再将未提供过程当作无过程清零。第12/35题明确未作答仍为0分。仅余第5题教师1分、模型2分，涉及分数表示的等价表达与原评分语境，继续追踪，教师原分不变。其余待定仍需可信过程、逐空分值及来源细则，不从旧得分倒推。
- 新执行规则SHA256为f1f496960568c6954ad86675b3121ff240d9b877010ae8d28e9a71ae025c1517。真实证据前缀tmp/quality/grading-evidence-live-20261023，含完整回放、quality、differences、数据库before/after。源gold、原作答、expected及teacherReview哈希不变；业务工作流、全部版本、独立归档完整对象及42/42/114/272/10数量前后一致，历史版本5、37.5/60、GRADED、needsReview=false保持。未重新OCR、执行Web操作、重启API、发布或正式导出；当前源码的独立进程已验证，既有Web/API实例是否载入本次服务代码尚未验收。规则正文每次读取不等于运行实例已重新载入服务JS。
- 42项定向回归通过、0跳过，check:api、check:services及check:skills通过，证据前缀grading-evidence，含regression-final、api、services、skills日志。全量编码扫描1163文件，仍仅既有临时Prisma包tmp/quality/task9-prisma-package-20260926/package/runtime/binary.js:126告警，退出1、0修复；不修改vendor、不放宽检查、不称全量通过。本轮正式修改文件另作严格UTF-8及共享编码守卫定向检查。工作区、既有产物及第5项留出任务暂缓状态保持。

### 2026-10-23 日常质量闭环：剩余8份179题独立回放

- 本次完成上一批尚未执行的8份179题文本评分候选，保留原作答、题型及来源，不重做OCR。其余2份45题仍因确认摘要不能代替原作答而阻断；最新16题已另有回放记录，不重复混入本批。沿用gpt-6.1-sol high、180秒总预算及连续失败1次即停止，persist:false，expected和teacherReview不进入模型。批次退出0、completed=true、无剩余候选；不是OCR、Web操作或正式归档验收。
- 各份题数/耗时/同分/待定/分差如下。所有9次调用均观察到HTTP200及response_body_complete；第5份主调用在52.1秒因question_score_invalid未通过校验，仅执行既有单次quality-repair，修复120.6秒，合计172.7秒。其他7份仅一次主调用，无替补或追加审查；执行规则grading-v3及SHA256 b032e7d56a16ae89448333364ec9851f2143900823ffa4d8fb7cfdc196d51aca保持一致。三次调用渠道报告completion_tokens为6009/6148/6512，超过该次请求配置的6000；仅记录观测，渠道计量与限制含义尚未核实，不能说所有实际输出均受6000限制。

| 样本caseId | 题数 | 秒 | 同分 | 待定 | 分差 |
| --- | ---: | ---: | ---: | ---: | ---: |
| grading-29c64a88f35027f7 | 12 | 92.8 | 4 | 8 | 0 |
| grading-f712a93d8aa71ece | 20 | 94.1 | 11 | 9 | 0 |
| grading-0b7868f59da6672b | 12 | 100.3 | 7 | 5 | 0 |
| grading-2be54f928a5993b5 | 20 | 103.4 | 0 | 20 | 0 |
| grading-f40303cf96301a23 | 16 | 172.7 | 2 | 14 | 0 |
| grading-35179edc0d80724a | 29 | 138.3 | 8 | 21 | 0 |
| grading-8d2ba1c830b85778 | 35 | 56.2 | 20 | 8 | 7 |
| grading-b275c83f89872733 | 35 | 148.9 | 18 | 17 | 0 |

- 质量CLI零调用重读退出0，8份均有有效执行证据；179题中77题可比、70同分、7分差、102待定。逐题数值分覆盖43.02%、一致39.11%，可比题MAE为0.1429分；8份草稿均无确定总分，不计算整卷分差。二分正确率67.04%不能当作逐题分值准确率，CLI的ok仅表示执行证据有效。单批最终执行失败0/8不等于生产失败率为0，更不能证明整卷稳定低于180秒。
- 逐题核查7处数值分差均来自grading-8d2ba1c830b85778：第1题教师1.5分、本次0分，模型将“小括号；中括号；除法”全部视为未按要求填算式，题干并未限定只能填算式；同批其他样本已接受类似运算顺序表述，应追踪其等价表达及部分正确评分不一致。第5题教师1分、本次2分，模型将“3/10、5/1000”视为等价表达；原教师决定保留，不凭现有转写推翻原分或将此次建议称为已获教师认可。第25/27/31/32/33题教师分别3/1/1.5/1/2分，本次均0分；当前只采集到最终错误结果，没有原过程，不能以“未提供过程”认定“学生未写过程”并清零。第22/28/34题虽与金标同为0分，也有同类证据边界问题，分数一致不代表解释质量通过；第3份第7/8题亦需一并追踪。
- 102题待定主要涉及未采集计算过程、逐空分值缺失、选择题选项未提供、历史arithmetic/math/bonus题型不明确，以及涂改或模糊答案。不能补造原过程、从expected倒推rubric、将未定题计作已正确评分，或批量要求教师重新确认旧成绩。本轮未修改运行规则/源码，也未为了消除分差重试样本；下一项应先修正“未提供证据不等于未作答”的给分边界及运算顺序等价表达，再做针对性回归和受控真实验证。多空分值、原过程与题型仍须来自可信原始来源。
- 证据前缀tmp/quality/daily-followup-20261023，含完整回放、8份checkpoint、inventory、quality、differences、inspection、review.md及数据库before/after；独立CLI报告daily-followup-cli-quality-20261023.json。检查确认逐份input等于原始输入的标准回放投影，studentAnswer未改写，expected/teacherReview及源gold文件哈希不变。业务工作流、全部历史版本、独立归档完整对象哈希及42/42/114/272/10数量均保持；原版本5、37.5/60、GRADED、needsReview=false不变。第5项留出任务继续暂缓，工作区与既有运行产物保留。
- 本轮28项回放/评测/金标契约回归通过、0跳过，check:api通过，日志daily-followup-regression-20261023.log和daily-followup-api-20261023.log。全量编码首扫1149文件、文档更新后复扫1160文件，均仅既有临时Prisma包runtime/binary.js:126告警，退出1、0修复（daily-followup-encoding-20261023.log及daily-followup-final-encoding-20261023.log），不改vendor、不放宽守卫、不宣称全量通过；本次两份修改文档及评价稿另用共享编码守卫定向检查通过，见daily-followup-changed-encoding-20261023.log。

### 2026-10-22 日常质量闭环：逐行证据核对与错误传递说明

- 沿上一轮解析缺口做规则修正：共享grading-v3要求按原题到首行、相邻可见算式逐行核对，引用学生实际写出的项；区分合法拆分、改数、带负号展开、乘积及合计的新错。完整studentAnswer过程与observedWork共同读取，摘要不能覆盖完整证据。教师已允许错误传递且后续计算全部相对前行正确时，明确保留已有计算项目分；项目内部对错混合而缺少细则仍待定，不自行分配。同步批改Skills及提示词Playbook，不改模型、JSON契约、预算或调用次数，不叠加审查。
- 同一16题、原作答与原教师要求独立真实回放，persist:false、expected/teacherReview不进模型。130738ms完成，唯一gpt-6.1-sol high主调用，HTTP200、response_body_complete，无修复/替补；输入14579、输出4612 tokens，费用未知。调用上限6000 tokens、总预算180秒保持。执行规则SHA256 b032e7d56a16ae89448333364ec9851f2143900823ffa4d8fb7cfdc196d51aca与当前正文一致；规则每次操作重读，无需API重启。
- 人工核查：第8题准确定位乘数错配、196×5项展开错误、后续乘积及末和新错；第12题不再把合法拆分判为改数，明确两处负号展开错误及7230误写7430；第11题明确按已有口径保留计算2/2分，方法细分仍待定。第9题也区分符号展开及后续合并错误。原三处缺口本次未再出现，不代表所有样本的解析质量已通过。
- 11题数值建议分与金标一致，8/9/11/12/14共5题uncertain、score:null，总分null，逐题分数覆盖及一致率68.75%、可比题MAE为0。第14题因答语将两类纸统称为彩纸新增待裁定，与上一轮5分建议不一致；教师已裁定满分继续有效，不重新询问、不回填expected掩盖差异。第16题仍建议2.5分。是否全对二分一致率93.75%不是逐题分值准确率，本次不标为整卷评分通过。130.7秒较上一轮44.2秒更慢，不据单次成功宣称稳定时延或规则提速。
- 证据前缀tmp/quality/grading-step-evidence-live-20261022，含完整回放、quality、differences、review.md及数据库before/after。原gold文件哈希不变；工作流、全部历史版本、独立归档完整对象哈希及42/42/114/272/10数量不变，版本5、37.5/60、GRADED、needsReview=false保持。未重新OCR、操作Web、发布、正式导出或重启API；工作区及既有产物保留，第5项继续暂缓。
- 32项规则装配、上下文、执行器及转写准入回归通过、0跳过，check:skills及check:api通过（grading-step-evidence-{regression,skills,api}-20261022.log）。全量编码扫描1133文件仍仅既有临时Prisma包runtime/binary.js:126告警，退出1、0修复（grading-step-evidence-encoding-20261022.log）；不改vendor或放宽守卫，不宣称全量编码通过。本轮5个修改文件及回放评价稿使用共享守卫定向检查，结果见grading-step-evidence-changed-encoding-20261022.log。
- 后续仍需按现行停止条件验证其余8份179题候选、追踪分数待定及第14题措辞裁量波动、积累整卷时延证据；原样本教师决定不变，不以局部语义修正宣称日常质量闭环全部完成。

### 2026-10-22 日常质量闭环：批改输出精简与整卷复测

- 本轮聚焦整卷时延和待裁定原因。最近daily-batch首份在180秒内未观察到响应头，只能确定deadline耗尽，不能称为HTTP503或归因于具体上游故障。没有提高模型预算、降低推理档位、增加重试、启用分组或追加自动审查。
- 共享AI层的批改输出契约不再要求模型复写studentAnswer、correctAnswer、bbox；按已校验题号从原作答、已核验参考和原坐标恢复。保留结构化多空答案、数字0及未知坐标null，不接受模型虚构坐标；未通过来源投影核验时不把冲突参考当成权威答案回填。score、maxScore、状态、得失分依据和待裁定原因仍由模型输出并接受原验证，studentProcess仅在必要时摘录关键步骤。Web与对话调用同一链路，正式原始来源包及确认边界不变。
- 先用两项失败回归复现缺少可靠标准答案/坐标回填和模型错误复写，再修正；完整相关137项回归通过、0跳过，覆盖来源冲突、漏题、缺分、超界分、低置信及uncertain必须null、既有最多一次修复和预算上限。日志为tmp/quality/grading-compact-response-{red,focused,regression}-20261022.log。
- 同一份最新16题、原作答及教师评分要求独立真实回放，persist:false、expected不进入模型。44155ms返回；唯一gpt-6.1-sol high主调用，HTTP200、response_body_complete，无修复/替补。调用输入13913、输出4654 tokens，费用未知；12题有建议分且与金标一致，8/9/11/12共4题仍为uncertain/score:null，草稿总分null。逐题分数覆盖及一致率均75%、可比题MAE为0；是否全对的二分一致率1不能当作逐题分数准确率。第14题本次给5分、第16题2.5分与原金标一致，但模型差异不构成重新确认。单次44.2秒不能证明稳定时延，也不能把改善全归因于本轮输出精简。
- 逐题核查仍发现解释质量缺口：第8题将实际196×5的展开误称为398×5；第12题将63=(60+3)的合法拆分也描述为改写错误，且未分别定位负号展开及末行求和的独立错误；第11题未明确可按已授权错误传递口径保留的计算项。原模型文本保留，不能把12题数值一致当作解释全部正确。新草稿缺分及这些语义偏差继续追踪，不重复要求教师确认历史37.5分，不从expected反推rubric，不用确定项小计代替整题分数。
- 证据前缀tmp/quality/grading-compact-response-live-20261022，含完整回放、quality、differences、review.md及数据库before/after；核对原始gold文件哈希不变，工作流/所有历史版本/独立归档完整对象哈希一致，42/42/114/272/10业务数量不变，版本5、37.5/60、GRADED、needsReview=false保持。本轮未重新OCR、执行Web页面操作、发布或正式导出；工作区及所有既有产物保留，第5项留出任务继续暂缓。
- API静态/配置检查通过；全量源码编码扫描1131文件，仍仅既有tmp/quality/task9-prisma-package-20260926/package/runtime/binary.js:126告警，退出1、0修复。用共享编码守卫定向检查本轮5个修改文件及真实回放评价稿均通过；日志grading-compact-api-20261022.log、grading-compact-encoding-20261022.log和grading-compact-changed-encoding-20261022.log。不改vendor或放宽检查，不宣称全量编码通过。
- 确认queued/running工作流均0，沿进程父链核实本项目run-api.cmd及run-api-autostart.cmd守护，再仅停止旧API子进程19880以重载代码。既有守护恢复后监听PID19268，/health返回200、ok=true且database.ok=true；证据为grading-compact-runtime-preflight-20261022.json及grading-compact-runtime-health-20261022.json。本次未进行Web页面交互验收或新增业务写入。

### 2026-10-22 日常质量闭环：受控批次与逐题分数指标

- 核对gold-recognition-review-20261019.json的11份240题，expected、teacherReview及原作答与旧金标一致。2份45题含确认摘要而缺少可回放原作答，先行阻断；其余9份195题仅作为文本评分候选，不代表完整OCR或教学可用性已通过。库存和顺序见tmp/quality/daily-batch-20261022-inventory.json。
- 真实首份16题runId c72dbffd-8401-4565-a860-2aa88c4b6781，在180105ms超时，唯一gpt-6.1-sol high主调用为TEACHING_DEADLINE，transport停在request_started、无HTTP状态、请求28083字节。只能确认未观察到响应头，不能认定HTTP503或上游具体根因；没有提高预算、替补、修复或追加重试。连续失败上限1触发后，其余8份179题未调用；报告completed=false、stopReason=CONSECUTIVE_FAILURE_LIMIT。日志和检查点前缀为tmp/quality/daily-batch-20261022。
- 修正质量报告解释边界：新增逐题数值分覆盖率、一致率、平均绝对分差及对应计数。是否全对或状态一致不等于部分分一致；uncertain即使携带数字也按未定处理，null/非数值不转0，未定保留在一致率分母，旧金标无分值保持未知。ok仍仅表示执行证据有效，不表示教学评分质量达标。失败/无效执行不能贡献上述指标。
- 使用新版CLI零调用重读报告，新失败批次退出1、有效评估0、全部指标null（daily-batch-score-quality-20261022.json）；旧2026-10-19成功16题报告退出0，10题数值评分与金标一致、6题待裁定，覆盖率及一致率均0.625，可比题误差0，不能说整卷准确率100%。输出为sol-primary-latest16-score-quality-20261022.json，原证据不覆盖；检查脚本及日志为tmp/quality/inspect-score-metrics-20261022.mjs、daily-score-report-inspection-20261022.log。
- 数据库前后快照的工作流、全部版本和归档哈希一致，Submission/GradingResult/Mistake/Assignment/Workflow数量仍为42/42/114/272/10。教师最终版本5、37.5/60、GRADED、needsReview=false不变，未重新确认或归档；证据为daily-batch-20261022-db-before.json及-db-after.json。独立评估persist:false，expected不进入模型。
- 本次展示四年级混合运算四题72÷8＋16×3、(156－84)÷6＋27、360÷(18－6)×4－35、960－(36＋24)×(84÷7)，教师明确回复“内容与评分点可用”。对应新稿tmp/quality/sol-primary-live-calculation-20261019.review.md，答案57/39/85/240、每题5分、仅结果各1分；与旧补弱2/2/1/1口径分开。本次为内容评价，不新增业务发布或归档，也不代替打印版式验收。第5项留出仍暂缓。
- 随后提供六年级一般过去时完整教师稿tmp/quality/sol-primary-live-english-20261019.review.md：动词过去式4题、短语翻译4题、句子翻译2题、选择4题、短文阅读6题，共20题60分；教师独立回复“内容与评分点可用”。本轮两份新稿内容评价完成，英语小测两页A4/四线格等实际打印版式未在本轮重新导出或验收，不能由内容确认推断版式通过。
- 聚焦评测、独立回放、金标契约及已确认生成基线32/32测试通过，0跳过，日志tmp/quality/daily-score-metrics-final-20261022.log；API检查退出0且ok=true（daily-api-20261022.log）。工作区清理后置，既有docs/encoding-history-report.md修改、output/及运行证据保留。整卷时延、待裁定题及更广批次仍未完成，不宣称日常质量闭环全面验收。
- 全量源码编码扫描1124文件，仍仅既有tmp/quality/task9-prisma-package-20260926/package/runtime/binary.js:126告警，退出1、0修复，日志daily-encoding-20261022.log。用同一共享编码守卫定向检查本轮5个修改文件均通过（daily-changed-encoding-20261022.log）；不修改vendor或放宽守卫，不能宣称全量编码通过。

### 2026-10-19 教师转写修正衔接与部分分说明

- 定位第16题revision3–5的真实studentAnswerReview凭据：当前教师身份与当前作答精确匹配。原归档转写正确，但采集丢失修正状态，原要求仍含待修正文字；局部重新批改另有仅传最新指令、遗漏原教师要求的问题。共享服务现仅接收服务端核验的修正选项，拒绝普通输入自带核对标记；题号重复、身份或答案不匹配不生效。原OCR置信度、过程摘要及位置保留，不再用数值1冒充教师核对。
- 工作流重新批改保留原要求和本次指令；采集只从已校验不可变归档提取脱敏转写状态，独立回放传对应当前答案，expected及教师评分不进入模型。重新采集11份240题，逐份核对expected、teacherReview及学生作答与旧样本一致；第14题只有教师满分裁定，没有OCR修正凭据，未虚构核对状态。旧金标与业务归档不修改。新采集文件为tmp/quality/gold-recognition-review-20261019.json。
- grading-v3与Codex批改Skills同源更新：核验转写优先于矛盾旧OCR摘要或该字段待修正要求，但不补造过程、不代表评分确认。部分分待定时区分已确定项、待裁定项及缺少口径，整题score仍null，教师保留最终决定权。
- 真实第16题单题回放28077ms完成，实际2.5/6，与教师金标一致；说明列式2分、498×5正确0.5分，其余两次乘法错误、沿用学生中间值末步仍算错、最终结果错误。当前中间值合计减法应为1400而非700。该次采用默认gpt-6.1-sol high，1次主调用，无修复/替补/兜底，HTTP200且响应完成。证据前缀tmp/quality/recognition-review-live-20261019，含独立输入、结果、质量报告及数据库前后哈希。此为转写衔接验证，不证明整卷准确率或稳定时延。
- 真实第8题单题回放38728ms完成，1次默认Sol high，无修复/替补/兜底。明确结果项0/1分，指出第一步改变原式与后续独立新错，列清方法2分/计算2分内部缺少分配口径，保持uncertain/score:null；原教师1分继续有效，无需重新裁定旧档案。证据前缀tmp/quality/recognition-review-live-q08-20261019；质量报告不把null分数视为评分通过。两次回放均persist:false，业务工作流、全部revision、归档完整哈希及42/42/114/272/10表数量前后不变，版本5、37.5/60、GRADED及needsReview=false保持。
- 剩余范围：其他部分分歧义仍交教师，历史第14题措辞不能自动当成OCR已修正；新生成内容的教学适用性、更多整卷稳定时延和第5项留出任务不由本次两题回放代替。模型职责和预算未改，未重新OCR、操作Web或导出PDF；工作区及全部既有产物保留。
- 收口验证：162项回归、check:api和check:skills通过；17份本轮修改文件定向编码通过。全量源码编码扫描1115文件仍仅有既有tmp/quality/task9-prisma-package-20260926/package/runtime/binary.js:126告警，未改vendor或放宽检查。确认queued/running工作流均0后重载API，监听进程由4756变为15808，/health返回200且database.ok=true。日志与检查报告前缀tmp/quality/recognition-review-；源码、规则及记录按显式路径提交，既有encoding-history-report.md、output/及全部运行产物保留。

### 2026-10-19 Sol主模型重新真实验收

- 按教师要求重新测试，使用当前默认路由，不传model覆盖、不提高预算；测试通过真实外部模型及共享服务执行，全部persist:false。API健康与数据库连接正常；本轮未重新OCR、未执行Web页面操作或PDF导出，5173未监听，不将这些范围记作通过。已有教师评分、发布与归档不重新确认或改写。
- 完整16题使用gold-cases-20261019.json首份教师确认样本独立回放，146431ms完成，唯一主调用gpt-6.1-sol high、HTTP200、response_body_complete，无修复/替补/动态兜底，未触发180秒超时。执行记录、输入及actual哈希核对有效，教师expected和teacherReview与原金标一致；证据前缀tmp/quality/sol-primary-live-latest16-20261019，含.json、.json.run.json、.inspection.json与.review.md。单次成功不能证明稳定时延，且使用已有识别和答案键，不代表含OCR及参考答案生成的全流程耗时。
- 10题实际给分与教师金标一致：1–7、10、13、15；8、9、11、12、14、16共6题uncertain/score:null，草稿总分null，不能补填原37.5。8/9/11/12因方法与计算类别内的部分分配未细化而待裁定；14因原作答“彩纸”与题干两类纸总数的措辞冲突待核对，教师原满分继续有效；16虽带已确认学生转写，原归档resolvedRequest仍含“待通过单题识别修正”旧要求，且保留原识别过程，模型因此不评分。这里记录已确认修正与旧要求的上下文衔接缺口，不要求教师重新裁定已确定得分，也不修改不可变归档或把expected作为模型输入。
- 质量CLI退出0、有效样本1，但questionAccuracy=0.9375只表示“是否全对”的二分一致率，部分正确与uncertain均被计为非全对，不能解释为逐题评分准确率；statusAgreement=0.625，整卷分数误差null，productionAccuracyClaim=false。故本轮结论是整卷调用可用、教学评分仍部分待补齐，不宣称完整批改验收或生产准确率通过。原始质量报告保留在同前缀.quality.json与.quality.log。
- 四年级计算专项沿用教师已确认样本的原始生成要求重新出题，不提供旧题及金标答案。57381ms、1次Sol high调用、4题20分，无修复或兜底；专项题量/题型、解析、考点、易错点及rubric服务门禁通过。独立复算新题答案57、39、85、240均正确，各5分，评分细则明确过程及仅结果1分口径。新内容仍待教师评价，不继承旧内容确认。结果、质量及教师稿为tmp/quality/sol-primary-live-calculation-20261019.json、.quality.json、.review.md。
- 六年级英语一般过去时小测沿用此前同一要求重生成，默认120秒/16000tokens，62348ms、4个分区各一次Sol high主调用，无修复或兜底；20题60分、服务阅读及题型门禁通过，10道书写题保留english-four-line，6道阅读题与完整材料对应。核对动词变化、句子、选择及阅读答案解析未见明确错误；不是教师教学适用性或两页PDF版式确认。材料为tmp/quality/sol-primary-live-english-20261019.json、.quality.json、.review.md，独立内容核查为sol-primary-live-generation-inspection-20261019.json。
- 业务库只读前后核对workflow、全部历史revision和独立archive完整对象哈希一致；Submission/GradingResult/MistakeRecord/Assignment/TeachingWorkflow数量保持42/42/114/272/10。教师归档版本5、37.5/60、GRADED、needsReview=false保留。证据为tmp/quality/sol-primary-live-db-before-20261019.json及-after-20261019.json。工作区及既有产物保留，未做清理。
- 下一步若继续修正，应围绕部分分配的可解释建议及逐题已确认识别修正的有效证据/旧指令消解；不能为得到非空总分而放宽教师确认门禁，不能把历史分数输入模型来制造一致。新生成两份教师稿可直接用于教师内容评价。
- 收口检查：API（含数据库）及生成蓝图通过；源码编码扫描1100文件，退出1且仅有既有Prisma临时包runtime/binary.js:126告警，未自动修复或放宽守卫。两份修改文档与三份评价稿定向编码核查5文件无问题，git diff --check通过；证据前缀tmp/quality/sol-live-acceptance-。本轮只提交计划和验收记录，模型源码未改，既有encoding-history-report.md、output/及运行产物保留。

### 2026-10-19 按教师决定切换Sol 6.1主模型

- 教师明确指定生成、主观批改改用GPT-6.1 Sol。共享策略、环境示例及本机.env统一为gpt-6.1-sol high，参考答案同属批改主路由。Web与对话继续调用同一服务；辅助提取、OCR、客观题本地比较及学生问答职责不变，最终评分、发布与归档仍由教师确认。
- 默认主模型与原替补同型号，因此禁用同型号availability重复调用，不自动改回Astra。仅显式配置不同型号替补时保留原接替机制。结构/内容校验失败仍最多一次同模型修复，与替补共享追加名额、deadline和token pool。默认批改及参考答案主调用使用原180秒操作剩余预算，不再预留120秒后接替同一型号；生成仍为原240秒预算。没有增加总时间或token上限。
- 模型、HTTP假网关、共享服务、工作流创建/重判、来源证据及回放回归246/246通过、0跳过，日志tmp/quality/sol-primary-final-regression-20261019.log；API、Skills与生成蓝图检查通过。两处旧工作流测试更新为核对现行逐题referenceAnswers投影，仍验证来源rubric、解析及材料隔离，不要求模型接收完整来源包。
- 本机配置预检核实三类任务均Sol高推理、replacement=null、活动工作流0；通过已有守护进程重载API，/health正常且database.ok=true，新监听进程6868。证据为tmp/quality/sol-primary-activation-preflight-20261019.json和sol-primary-live-health-20261019.json。本轮没有新增真实模型生成/批改或重新写入评分归档；此前8题Sol受控回放不能代替默认整卷验收，180秒内稳定完成仍未证明。
- 生成、批改Skills及提示词上下文Playbook同步当前模型职责，旧计划Astra设计标为历史。工作区保留，清理继续后置；源码全量编码检查1086文件，仍只有既有临时Prisma解包runtime/binary.js:126告警，未修改vendor或放宽守卫。16个修改文件定向编码核查无问题，git diff --check通过；证据为tmp/quality/sol-primary-encoding-20261019.log和sol-primary-changed-encoding-20261019.json。

### 2026-10-19 当前模型升级与批改内容边界修正

- 用户要求先更新生成、批改及其辅助调用到当前型号，再修正内容。主调用保留gpt-6-astra high，替补及独立反馈任务改为gpt-6.1-sol high，辅助提取使用deepseek-flash（官方说明当前映射V4.1-Flash-1017），MiniMax视觉OCR升级MiniMax-M3.1-Flash low。同步运行默认值、环境示例、本机.env与能力检查脚本；学生问答的Terra单调用职责保留，未改教师最终评分和归档。新型号不是全部任务改用同一个大模型。
- 来源核对：OpenAI官方模型页、latest-model页及迁移页均返回403，resolver两次失败；OpenAI型号候选来自本地OpenAI Docs非权威快照，再以当前渠道/models清单及实际请求核验，不宣称已获得官方完整兼容性保证。DeepSeek官方https://api-docs.deepseek.com/quick_start/pricing及thinking_mode页确认最新Flash别名和默认思考；MiniMax官方https://platform.minimax.io/docs/api-reference/text-openai-api确认M3.1视觉输入、低推理档位与max_completion_tokens。渠道MiniMax列表列Preview，正式名称另经文本和真实裁图请求HTTP200验证。合成像素视觉探针曾400，不覆盖该失败；真实裁图随后成功。安全清单及探针见tmp/quality/model-upgrade-discovery-20261019.json、model-upgrade-probe-20261019.json、minimax-upgrade-diagnosis-20261019.json、minimax-vision-compatibility-20261019.json。
- 新OCR与可选DeepSeek识别共用按页受限执行器：共享原90秒/24000tokens池、最多两路并发、保留图片/裁图绑定和服务端页号，无自动Sol追加。MiniMax显式low；DeepSeek辅助调用显式thinking.disabled，避免默认high思考。空题数组不再成功，未知置信度不再被Number(null)转换为0，保留不可辨认warnings与空白区别，修复输出模板闭合符号。旧coding_plan/vlm仅作显式兼容，不改历史OCR。真实裁图共享链路约4502ms返回，证据tmp/quality/modern-ocr-live-20261019.json；仅证明该裁图识别，不证明整页OCR准确率。
- 默认新链路16题回放upgraded-model-latest16-20261019仍180022ms失败：Astra120016ms、Sol6.1 59981ms均仅request_started，未观察到响应头，usage及费用未知；质量CLI退出1，有效评估0，指标null。故升级没有解决整卷超时。所有回放persist:false，教师37.5/60归档及expected不变。
- 小范围诊断明确强制Sol6.1、仅取同一金标前8题，保持原教师要求及原作答：upgraded-sol-eight-question-20261019约59230ms返回，第8题模型0分与教师金标1分不同，子集总分8/19与金标9/19相差1。现有质量CLI虽退出0，仍不据此宣称逐题分数一致或生产质量通过；这不是默认主模型或整卷验收。
- 据该差异修正共享规则为grading-v2：本次教师要求可补充来源通用rubric；已知类别满分但局部正确方法的细分影响得分时，说明歧义并保留uncertain/score:null，不自行补分或直接清零；反馈避免重复题干、过程和通用长文。用同一8题同一Sol6.1再次独立验证upgraded-sol-content-revision-20261019，约43956ms返回，第8题保留待教师裁定且score:null。质量CLI退出0但分数误差指标null；这只验证本题歧义边界生效，不证明提速或完整批改准确率。原教师1分及整卷归档未改。
- 验证：模型/路由/主备切换/共享服务/识别边界/采集回放/质量评测220项通过、0跳过（model-upgrade-final3-regression-20261019.log）；API、Skills、生成蓝图及Web类型检查通过。全量编码检查仍只报既有tmp/quality/task9-prisma-package-20260926/package/runtime/binary.js:126，未修改vendor或放宽守卫。当前无活动教学工作流时，通过已有守护进程重启API；/health HTTP200且database.ok=true，端口恢复，证据model-upgrade-live-health-20261019.json。没有执行Web界面操作、正式发布或写入新的评分归档；工作区继续保留。

### 2026-10-19 日常质量闭环：阅读生成修正与回放上下文补齐

- 本轮保留既有工作区及原教师归档，未重启现有Web/API，真实调用均由当前源码的共享服务以persist:false执行。没有改变模型职责、高推理档位、预算、重试次数、评分或归档门禁；第5项留出任务仍暂缓。
- 首次单独复现英语小测：generation-diagnosis-20261019，67242ms，四分区均HTTP200，阅读因reading_passage_too_short及reading_context_questions_insufficient被拒，服务兜底后20题54分。此前只保存smoke摘要，本次保留完整结果及分区attempts，确认兜底并非等同于连接失败。
- 修正服务端调用与校验契约：partition.readingRequirements在调用前明确篇数、每篇篇幅、计数单位和上下文题数量，英语模型校验与服务复核共用同一阅读检查，未放宽原服务门禁。完整新调用generation-reading-contract-20261019在71327ms内一次主模型/分区完成，20题60分、无兜底、审查通过；现有evaluateGenerationQualityResult对首次样本判失败、修正后样本判通过。正文、答案与评分依据整理为tmp/quality/generation-reading-contract-20261019.review.md供教师评价；不代表教师内容确认、打印版式、正式导出或当前学生留出任务验收。
- 11份旧快照分批回放compact-grading-replay-20261019：最新16题104176ms、下一份20题85742ms均主调用成功，但均有uncertain且总分null。第三份因24处“教师确认正确”等摘要不能代替原作答，零模型调用预检拦截；按连续失败1次条件停止，余8份未回放。第16题卷的6道待裁定为8/9/11/12/14/16；第14题教师5/5及整卷37.5/60的业务结果不变。批次仅3/11执行，质量CLI因执行批次不完整拒绝计算指标，不能由可用返回宣称评分质量通过。
- 定位待裁定的上下文缺口：原工作流通过teacherContext发送教师requirement，但采集器遗漏了不可变归档snapshot.resolvedRequest.requirement，其中含已确认的逐题评分分配及错误传递口径。采集器现仅从通过归档完整性验证的原始请求恢复并脱敏此字段，不从expected、批改解释或可变字段反推。新快照tmp/quality/gold-cases-20261019.json仍为42份扫描、11份准入、240题、31份阻断；逐份核对expected和ocrQuestions与10月12日快照完全一致，只有最新16题补入原始要求。旧失败证据未覆盖。
- 模型输入精简仅作用于指纹有效且题干、答案、满分匹配的来源：投影到未解决题referenceAnswers，保留结构化多空答案、来源rubric/解析/context，原完整来源包保留于服务和归档；assignmentItems仅保留未解决题，只删除精确重复的汇总文本，原过程、置信度和坐标不变。多空答案的旧字符串规范化最初触发保守保护，首批请求仍为32501字节，其成功不能归因于精简。补齐等价数组投影后请求实测25422字节（减少7079字节，约21.8%）。
- 独立验证verified-projection-latest16-20261019仍180013ms超时；补回原教师评分要求后的restored-teacher-context-latest16-20261019仍180011ms超时，输入26240字节，主120006ms、替补59980ms。两次均仅观察到request_started，未收到响应头，状态/usage/费用未知。两份单样本质量CLI均退出1，有效评估0、指标null。故未证明精简解决超时，也未验收恢复评分要求后的真实评分效果；停止重复调用，不擅自扩大预算或改模型。
- 验证：165/165模型、阅读、共享服务、来源投影、金标采集、回放及质量评测回归通过，0跳过，日志tmp/quality/daily-quality-final-regression-20261019.log。API（含数据库连通）、Skills、生成蓝图及Web类型检查通过；源码编码检查仍仅既有Prisma临时包runtime/binary.js:126告警，未修vendor或放宽守卫。新增修改另做定向编码核查。原教师评分、归档、业务数据库及既有生成文件未改；已验证代码按显式路径提交，工作区清理继续后置。

### 2026-10-12 日常质量闭环：响应阶段排查与生成基线回归

- 教师明确清理后置到所有阶段完成，本轮只读核对工作区范围，未执行清理/移动运行文件。合成探针 `tmp/quality/transport-stage-probe-20261012.json`：DNS126ms、TLS829ms成功，当前Astra5805ms、Sol4557ms均HTTP200且预期JSON有效；两次调用各30秒/2048 tokens上限、无学生数据、无自动重试。仅证明当前小请求通道可用，不证明长批改已恢复。
- 基于上述新连接证据，仅对原16题做一次带阶段记录的现行预算回放：`tmp/quality/traced-replay-latest16-20261012.{json,run.json,transport.json,log}`，progress在`.progress.jsonl`。请求32501字节，system/user文本2374/18318字符、每次6000 completion tokens、高推理、主120秒及替补剩余约60秒；两次均在收到响应头前deadline退出，总180050ms、状态未知、无响应体。该阶段排除PDF/JSON解析导致本次等待，但不能区分上游计算、排队或连接处理原因；不擅自降低推理、扩预算、拆题或改模型职责。质量CLI退出1、有效样本0、全部指标null；教师金标与原归档不变，后续批次暂未运行。
- 为补齐下一次调用证据，共用runtime及teaching-model-runner现把request_started/response_headers/response_body_complete写入内部attempt.transportDiagnostics，白名单仅阶段、合法HTTP状态、非负安全整数耗时/字节数。无URL、密钥、原文或学生内容；外部回调异常不影响请求，结束后迟到事件不能改attempt，模型候选/输入剔除诊断字段，角色投影不返回诊断。调用次数、预算及路由未变。5项本地HTTP/注入测试先复现缺失，再通过；覆盖无响应头、响应体停滞、白名单和观察器失败。带跟踪的真实回放发生在代码修正前，用临时观测器采集，不能声称生产API已重启或新字段已在运行实例验收。
- 生成基线从既有复核稿提取为 `fixtures/quality/generation-confirmed-calculation.json`：教师确认对应版本3，原内容快照为版本2，确认来源见9月30日记录。新增共用服务离线回归验证4题、20分、答案120/12/50/13、逐题原rubric及解析不变；本份仅结果1/1/1/1分，与更早另一练习2/2/1/1分分开。模型返回为mock，persist:false，既不新增教师金标预测、发布或模型质量证明，也不把4题固化为产品默认。原始JSON/教师业务版本均不改。
- 定向模型/诊断/金标/采集/回放/评测/归档解析/专项训练/已确认生成基线114/114通过、0跳过，日志 `tmp/quality/remaining-work-regression-20261012.log`；API、Skills及生成蓝图通过。另行扩展生成审查回归42项中40通过、2失败，日志 `tmp/quality/daily-generation-regression-20261012.log`：旧综合卷mock未给逐题score，preserveScores路径填入题型默认分后汇总116，测试预期100；失败在assessment-draft-review.test.mjs:946、1021。不删除旧测试、不放宽断言、不为凑100改已给定rubric，登记为待处理的历史综合卷缺分兼容问题，不能宣称所有生成回归通过。
- 随后完成缺分兼容修正：只对旧接口且所有题均无score/points/rubric的综合内容使用已有蓝图分配分值，并明确usedDynamicFallback=true、保留教师复核；当前teaching-pipeline-v1输出、部分已有分值及任一已有评分依据均不重新缩放。专项原分值和rubric不变。旧附加题测试保留100分断言，并加强兜底标记；Weather“完整模型”测试夹具补充其原先缺失的明确分值，保留“不兜底”断言。生成审查/专项/已确认基线及评测44项通过（追加评分保留测试前），日志 `tmp/quality/daily-generation-green-final-20261012.log`；此前失败日志保留，不将无分值兜底算成模型质量成功。
- 源码编码检查1046文件仍仅既有Prisma临时包runtime/binary.js:126告警，退出1、0自动修复，日志 `tmp/quality/remaining-work-encoding-final-20261012.log`；后续新增评分兼容和文档内容按同一守卫再检查。本轮核心产出是内部可观测性、已复核生成基线与旧综合卷缺分兼容修正；长批改可用性、其余10份独立评估及真实新生成内容评价仍待完成。第5项留出继续暂缓。
- 最终合并回归143/143通过，含新增旧综合卷明确rubric/部分已有分值不被重写的回归，日志 `tmp/quality/remaining-work-final-regression-20261012.log`；最终API、Skills、蓝图通过。服务smoke退出0（日志 `tmp/quality/remaining-work-services-20261012.log`），真实问答及任务草稿可用；英语综合小测104420ms返回20题/54分且usedDynamicFallback=true，只能算服务返回及待复核草稿，不能算生成质量通过或教师新内容验收。该脚本persist:false，未发布、确认或写业务记录。最终编码1046文件仍仅上述既有vendor告警（`remaining-work-final-encoding-20261012.log`），随后类型声明和记录用同一编码守卫定向核查。未重新启动运行API，新增内部字段的生产实例启用尚未验收。

### 2026-10-12 日常质量闭环：现行预算独立评分回放

- 沿用补齐可信题型的脱敏快照，只回放最新16题 `grading-966504f42b8df647`：`npm.cmd run replay:grading:gold -- --gold tmp/quality/gold-cases-20261012.json --output tmp/quality/default-budget-latest16-20261012.json --limit 1 --max-consecutive-failures 1`。未覆盖模型、超时或deep audit，服务默认总预算180000ms、主调用120000ms、token pool 12000；本次两次尝试各预留6000 tokens。persist:false，不重新OCR、确认或归档。
- 脚本已结束并完整保存报告，不是进程悬挂。runId `864268ff-cedb-47b8-89fa-ebf95fddee3c`，执行耗时180050ms（外层180057ms）：Astra主调用120016ms，Sol可用性替补59768ms，均为TEACHING_DEADLINE；无成功结果，available=false、failureReason=timeout，usage/费用未知。批次completed=true仅表示脚本收口，不表示评分成功。其余10份不追加调用。
- 题型、来源上下文、布局题型及作答/过程覆盖均16，missing为空；此覆盖不等于原共享材料或打印几何完整。补齐题型后在正常预算仍超时，故题型遗漏不是已经解决超时的证据。已定位到两个模型调用的deadline退出，不能由此区分供应商排队、响应耗时或连接故障，也不据此直接改路由、增加预算或拆题。
- `check:grading:quality`实际退出1，执行问题为EXECUTION_NOT_SUCCESSFUL及ACTUAL_RESULTS_INCOMPLETE；1份尝试、0份有效评估，所有质量指标null、productionAccuracyClaim=false。本次单份回放失败占1/1，仅描述该批可用性，不推广为生产失败率。16题分数差异与状态一致性保持未知，不能将uncertain兜底当作模型评分或将教师expected复制到actual。
- 本地核验脚本 `tmp/quality/inspect-default-budget-20261012.mjs` 已验证输入/结果hash、失败状态、两次尝试、expected与teacherReview未变；教师总分37.5、第14题5分保留。质量及逐题未知对照报告为 `tmp/quality/default-budget-latest16-20261012.quality.json`、`.inspection.json`；原始输出、`.json.run.json`、`.json.progress.jsonl`和`.log`保留。教师评分及既有业务归档不被独立回放失败替代。
- 问题追踪：正常预算的长批改可用性尚未解除。下一项先检查服务到供应商调用的连接/响应证据和当前配置，再用有依据的受控验证决定最小修正；其余样本批评估及生成同类要求回归仍待完成，第5项留出任务继续暂缓。本轮未调整生产模型策略或业务代码。
- 收尾：质量契约、采集、回放、生成/批改评测及归档解析器53/53回归通过，日志 `tmp/quality/default-budget-regression-20261012.log`；check:api、check:skills及git diff --check通过。源码编码扫描1041文件，仅保留既有临时Prisma解包runtime/binary.js:126告警，退出1、0自动修复；日志 `tmp/quality/default-budget-encoding-20261012.log`。本轮仅显式提交计划与验收文档，既有encoding-history-report.md、output/及tmp/运行证据保留，不清理。

### 2026-10-12 日常质量闭环：归档、采集与回放输入核对

- 只读对照11份已确认样本、数据库Submission/AssignmentItem及最新工作流第5版。旧采集投影与数据库一致，教师金标未变；来源包本身均缺少结构化题型，但登记作业保留题型，最新16题不可变归档还保留assignmentQuestionTypes。问题是采集未读取/投影可信补充题型，而不是原归档题型丢失。对照证据为 `tmp/quality/input-audit-20261012.json`；共享材料、answerFormat及原打印布局未见现存结构化证据，不能由题型恢复等同认定其完整。
- 采集复用现有服务端legacyAssignmentQuestionTypes核对逻辑，补查orderIndex/itemType；只有题号唯一且题干、答案、满分一致才采用。不可变工作流归档先校验完整归档证据，沿用归档时的题型绑定，不受当前作业变化影响；无效归档进入阻断报告。来源题型优先，不采用OCR猜测。补充只进入脱敏评估副本，业务来源包指纹、教师评分和原归档不修改。
- 新快照 `tmp/quality/gold-cases-20261012.json` 仍扫描42份、准入11份240题、阻断31份；240题可信题型恢复。`tmp/quality/projection-verification-20261012.json` 实际断言expected、teacherReview及所有原作答/过程/置信度/坐标不变，无actual/evaluationRun；最新16题来源/回放/布局题型覆盖均16，回放missing为空，37.5分和第14题5分保留。sourceContextCount=16来自重建时加入题型，不能解释为新增共享材料或原打印几何。新快照hash为sha256:fd60834ac8062da4b7450380ce7e53d03dd1c7e62d51f9a324a2464a34b6da13。
- 本轮不调用模型、不重新OCR或业务归档。2026-10-10的60秒失败回放保留，不以本次字段修正宣称超时解决或真实评分准确率通过；下一项仍是按现行预算和停止条件开展分批独立评估。
- 质量契约、采集、回放、生成/批改评测及归档解析器回归53/53通过、0跳过，日志 `tmp/quality/input-audit-regression-20261012.log`；check:api、check:skills及git diff --check通过。旧100毫秒超时测试在本机准备阶段偶发耗尽预算，本轮使用已有注入时钟隔离准备耗时，真实100毫秒调用abort计时器及失败分类/次数断言仍保留，不调整生产预算。既有encoding-history-report.md及output/不纳入提交，不做清理。
- 源码编码检查1037文件，仍仅有既有Prisma临时解包runtime/binary.js:126的1项告警，退出1；未改vendor、未放宽守卫，不宣称全量编码通过，日志 `tmp/quality/input-audit-encoding-20261012.log`。

### 2026-10-10 日常质量闭环首批：采集、回归与问题追踪

- 教师已选定下一阶段为日常质量闭环。旧模块计划的质量工具已存在，本轮复用并修补现有工具；本机启用、真实双卷导出及16题确认/归档状态同步到generation/grading入口和Playbook，防止后续Codex误判为尚未迁移或重复归档。第5项留出任务继续暂缓。
- 已修复质量报告缺陷：无独立执行记录、输入/结果哈希不匹配、scope不符或执行失败的样本不再贡献准确率等任何指标。counts.evaluatedCases明确有效样本数；混合批次只计算有效子集且整批仍失败，全部无效则所有指标null。合成gold示例移除静态actual；CLI实际验证退出1、有效样本0、全部指标null，属于正确拒绝而非教学质量通过。
- 真实数据库只读采集并保存脱敏快照 `tmp/quality/daily-quality-20261010/gold-cases.json`：扫描42份、教师确认候选11份240题、阻断31份；原评分、确认和归档不变。快照契约、无actual/evaluationRun及最新16题教师评分序列校验通过，第14题5分、总分37.5保留。SHA-256与阻断原因汇总为同目录snapshot-inspection.json，采集日志 `tmp/quality/daily-quality-collection-20261010.log`；原因计数可重叠，不能累加当作样本数。
- 对最新16题独立调用共享gradeSubmissionService，persist:false、沿用现行模型选择、显式总预算60000ms，无deep audit。实际约60030ms退出1，唯一主调用Astra为TEACHING_DEADLINE，未追加Sol，usage及费用未知。16题返回uncertain/null，available=false；质量CLI拒绝该失败样本，有效样本0、所有指标null、productionAccuracyClaim=false。输入、规则hash、执行记录及报告为同目录latest16-evaluation.json、其.run.json和latest16-quality.log。未重新OCR或写业务库，不推翻已确认37.5分。
- 回放输入显示sourceContextCount、questionTypeCount、layoutTypeCount均0，16题过程/置信度/坐标证据存在。此为待定位的输入覆盖缺口，尚未证明是超时根因，也未确认是原归档缺失还是采集/重建丢失。下一项先对照原归档与回放投影，修正有证据的丢失后再按现行预算分批评测；其余10份暂未回放。本次显式60秒低于策略默认总180秒/主调用120秒，不据此宣称默认日常链路失败或调整模型策略。
- 质量契约、采集、独立回放、批改和生成质量回归41/41通过、0跳过，日志 `tmp/quality/daily-quality-regression-20261010.log`；check:skills、check:generation:blueprint、check:api及git diff --check通过。源码编码检查1032文件仍仅有既有官方Prisma解包runtime/binary.js:126的1项告警，未改vendor或放宽守卫，不宣称全量编码通过。已有encoding-history-report.md与output/保留，不纳入本次提交。

### 2026-10-10 教师确认及独立归档状态回显修正

- 原标题和任务列表只读取工作流处理状态，归档提示仅保存在组件内存。现由服务端读取当前所读版本，派生 `reviewStatus` 并查询实际独立归档；归档摘要须通过生产共享完整性校验，且教师、工作流、学生及版本精确匹配。HTTP只返回白名单摘要，不返回完整归档证据；GET/list不执行确认或归档。
- Web标题和列表采用同一摘要显示“教师已确认”或“已归档”。整页刷新后从服务端恢复归档提示和禁用按钮；历史版本保持只读，新版本不继承旧版归档提示。工作流处理状态机、教师最终评分权限及独立归档门禁不变，没有增加模型调用或数据库迁移。
- 定向API、服务和仓储回归37/37通过；浏览器回归2/2通过，覆盖确认、归档后刷新、恢复新版本和桌面/窄屏。新增HTTP测试验证他人教师404、学生403、篡改归档不回显、读取不新增归档或错题；上述回归采用合成样本和内存数据库，不替代真实教学或PostgreSQL事务验收。Web类型检查和API检查通过。
- 真实API进程更新后，沿用工作流 `fcf3c914-9fc2-48c5-95e3-6a0f4fe24321` 进行只读Web回显验收：刷新当前批改与列表，再整页刷新、重新登录并选择同一任务，均显示版本5、37.5/60、16/16已确认，标题与列表显示已归档，归档提示保留且按钮禁用；第14题保持教师裁定5/5，控制台error/warn为空。整页刷新仍按现有行为回到登录入口，不宣称自动登录或自动选择任务。此次未重复确认、评分或归档；实际业务闭环证据仍引用下节记录。
- 编码检查1028个文件，仅报告既有官方Prisma解包文件 `tmp/quality/task9-prisma-package-20260926/package/runtime/binary.js:126` 的1处告警，未改该文件或放宽检查，不宣称全量编码通过。浏览器回归截图保留在本地 `E:/AppData/Cache/Temp/junhang-grading-state-ui-20261010/`；真实截图为 `tmp/quality/stage6-live-20260929/web-grading-state-restored-20261010.png` 与 `web-grading-archive-disabled-20261010.png`。

### 2026-10-10 教师最终评分、独立归档与真实数据库闭环

- 教师明确决定“第十四题为满分，整卷已进行审查，按照我们已批改的进行评分即可，然后进行独立归档和数据库闭环验收”。沿用真实工作流 `fcf3c914-9fc2-48c5-95e3-6a0f4fe24321`，先通过共享 HTTP `replace_question` 将第14题改为5/5、正确，记录教师裁定说明，形成版本4；保留原识别题干、学生作答、OCR置信度、坐标与过程证据，其他15题不变。此为教师评分裁定，不代表第14题OCR转写已修正或完整OCR金标已通过。
- 随后通过独立 `confirm` 确认16题，形成版本5，确认总分37.5/60，待核对0题。第1至16题最终分数依次为 `0、2、0、2、2、0、2、1、2、5、3、1、5、5、5、2.5`。本轮评分修订、确认、归档均无新增模型调用，最终得分以教师决定为准；只读基线验证 confirm 本身未创建归档或错题，也未改原提交、档案及报告。
- 单独执行版本5的 `archive`，归档ID为 `teaching-archive-d35077d7534db03e7aba257235f3fb17643c74dd9517e84b419e4584d9adeed8`。实际 PostgreSQL 新增独立 `Submission`（`GRADED`）及关联评分记录，得分37.5、`needsReview=false`、`archiveEligible=true`；生产共享归档完整性校验通过。原上传提交 `cmv0t8irl00016ybgyslmp1gd`、作业及题目、原评分和来源指纹均保留，不覆盖原记录。
- 新增8条教师已复核错题，题号为1、3、6、8、9、11、12、16，均绑定本次归档及来源提交。重放同版本归档返回同一ID、`replayed=true`，前后业务基线深比较一致，没有重复归档或重复错题；已有错题保持不变。
- 读取真实业务库并调用生产共享 `loadCurrentTeachingEvidence` 与 `buildProfileEvidencePack`，本份独立归档以confirmed批改证据入选一次、得分37.5，8条错题均进入证据包。原待复核上传记录只进入 `blockedEvidence`，没有混入已确认评分。已有学生档案和报告未被覆盖；本轮只验证档案证据准入，未生成或发布新的周/月报告。
- Web实际激活“刷新当前批改”后显示版本5、已确认16/16题、确认总分37.5，第14题正确且已确认；控制台error/warn为空。页面标题仍沿用工作流处理状态“待教师复核”，刷新未回显通过对话共享接口写入的归档，归档按钮仍可用；代码核实归档提示目前仅保存在当前页面操作状态。数据库已归档且重放无重复，界面回显问题留待下一阶段修正。本轮未再次通过Web确认或归档，不把截图当作Web执行归档的证据。
- 证据目录 `tmp/quality/stage6-live-20260929/`：`closure-inspect-20261010.json` 为完整操作前基线；`closure-confirm-20261010.json`、`closure-archive-20261010.json` 为共享HTTP执行及数据库边界证据；`closure-verify-20261010.json` 的12项检查全部为true；`web-grading-confirmed-archived-20261010.jpg` 为Web确认分数截图。原版本3复核材料保留历史内容，顶部注明已确认归档的最新状态。
- 本轮 `check:api` 通过，真实数据库连接正常；学生档案回归41/41通过，文档 `git diff --check` 通过。`check:encoding` 检查1011个文件，仅报告既有官方Prisma解包文件 `tmp/quality/task9-prisma-package-20260926/package/runtime/binary.js:126` 的1处告警，未自动修复、不宣称全量通过。此处新增证据为真实正向归档、幂等及档案证据准入，不冒充本轮重新进行了故障注入回滚或完整教学质量评测；先前隔离PostgreSQL事务16/16结果仍见2026-09-29记录。

### 2026-10-10 历史题型绑定修正、真实草稿与单题修正

- 原历史来源包缺少 context.itemType，但已登记 AssignmentItem 保留真实题型。旧执行适配器只读取来源包类型，16题均进入模型。现以服务端保存的题目类型兼容补齐；要求题号唯一且规范题干、答案、满分与来源包一致，类型及指纹绑定 archiveEvidence，读取时共享锁定题目行。来源包类型优先、旧归档沿用原绑定，不根据OCR或题号猜类型，不修改来源包及其指纹。未找到原导入请求证据，不把缺类型归因于对话导入规范化器。
- 只读离线诊断确认模型未解决题数由16降为13，仅第5–7题选择题本地比对；多空填空第1–4题仍保守送模型，计算/应用题仍核对过程。该诊断 persist:false、0次真实模型调用，不能单独证明超时已解决。
- 修正后仅执行一次新的真实共享HTTP创建，请求键 task9-real-grading-bound-types-policy-20261010，任务 fcf3c914-9fc2-48c5-95e3-6a0f4fe24321。约75秒返回版本2 ready_for_review，16题、0个结构问题；第14题题干冲突和第16题待应用教师转写均保留 uncertain/null。教师批准的本卷评分口径绑定在工作流 request.requirement，原来源包rubric与指纹未修改。这是本次真实成功证据，不宣称模型长期可用性或教学评分准确率已验收。
- 随后通过同一HTTP接口、稳定operationKey与expectedRevision=2，仅对q16执行 correct_recognition，并携带本题已确认评分口径。教师转写原样保存，单题重批形成版本3，建议2.5/6，最终决定权仍由教师。依据为列式2分、498×5正确0.5分，另外两次乘法及合计减法有独立错误；该建议不是教师金标。原OCR置信度0.9、坐标、页码及observedWork均未改，其余15题深比较保持不变。
- 创建与修正前后只读数据库比较：原提交及其评分/作业、全部错题、学生档案、报告均未变化；submissionStatus=NEEDS_REVIEW，无workflowArchive，确认0/16题、confirmedScore=null。模型只写待复核工作流版本，没有确认、归档或档案写入。
- 第14题原图末句实际为“两个班共领取多少张纸？”，当前OCR误识别为“多少张彩纸”，来源答案10000张与原图一致；学生答语写“10000张彩纸”，单位答语项如何评分仍由教师决定。此处原图核对尚未转化为工作流题干识别修正，现草稿继续score:null，不以文字说明替代执行证据。
- Web已实际打开版本3，展示16题、第16题原作答、“识别文字已由教师校正”、保留90%原置信度及2.5/6建议分。确认数仍0/16、归档按钮禁用，检查时控制台error/warn为空。截图 tmp/quality/stage6-live-20260929/web-grading-q16-corrected-20261010.jpg。当前视口截图不代替完整桌面/移动端验收。
- 新复核材料 tmp/quality/stage6-live-20260929/teacher-score-review-current-20261010.md 包含16题建议分、原始过程、逐题原图及待核对点；不覆盖早期历史复核材料。真实请求和修正证据分别为同目录 real-workflow-typed-policy-20261010.json、real-workflow-q16-corrected-20261010.json。
- 先复现缺陷再修正：定向回归33/33通过，相关确定性批改、审核门禁、工作流创建/校验回归61/61通过；check:skills及check:api通过。最终源码编码检查1007文件仅有既有官方Prisma解包文件 runtime/binary.js:126 的1处告警，未改vendor或放宽检查。第6项下一步为补齐第14题证据修正和教师评分复核，再按独立归档授权执行archive与数据库正向核验；第5项继续暂缓。

### 2026-10-10 第6项真实重试、教师评分口径与失败门禁

- 按教师要求执行一次新的共享HTTP真实批改，沿用提交 `cmv0t8irl00016ybgyslmp1gd`，不重复上传原图。稳定请求键为 `task9-real-grading-teacher-request-20261010`，新任务 `2d8e5aaf-eb5d-49c1-b415-bca606243e5b` 约180秒后为版本1 `failed`，返回 `WORKFLOW_CREATION_INCOMPLETE`、0道可复核题。证据 `tmp/quality/stage6-live-20260929/real-workflow-live-20261010.json`；未捕获本次内部模型诊断，不将昨日两模型的超时明细当作今日调用证据。
- 只读数据库核验仍为 `submissionStatus=NEEDS_REVIEW`、`workflowArchivePresent=false`、`gradingNeedsReview=true`。本次没有应用第16题转写、教师得分确认、归档或学生档案写入。已确认转写仍待真实草稿通过共享 `correct_recognition` 执行单题重批；不能直接修改OCR或把标准答案当学生作答。
- Web原5173端口不可用，已恢复现有Vite开发入口；实际登录并打开本轮失败任务，页面显示“服务可用”“处理失败”，手工评分、单题重批、题目确认和归档按钮均禁用。检查时控制台error/warn为空。归档区域截图 `tmp/quality/stage6-live-20260929/web-grading-failed-20261010.jpg`。这只证明失败边界，不能计为正向归档验收。
- 为区分基本运输可用性与整卷批改失败，额外各执行一次30秒/2048输出tokens的小JSON请求，复用当前共享教学模型运输、high推理及严格JSON协议，不发送学生数据、不落业务库、不自动重试。Astra在30010ms未返回；Sol在13386ms返回有效JSON，已返回usage合计4415tokens，费用未知。报告 `tmp/quality/stage6-live-20260929/transport-probe-20261010.json`。小请求成功不证明Sol可完成整卷，也不证明今日真实批改中两个模型均超时；不擅自改变主模型、调用预算或追加真实任务。
- 已从有效来源包及当前识别整理16题只读复核材料，来源总分60、指纹校验通过；第16题使用教师已确认转写，其余识别仍待核对。入口 `tmp/quality/stage6-live-20260929/teacher-review-20261010.md`，结构证据为同级 `teacher-review-evidence-20261010.json`。标准答案及过程复算不是学生金标，也没有据此写入评分。
- 教师确认采用本卷建议口径：第8–13题各5分按方法2/计算2/结果1；第14–15题各5分按列式2/计算2/结果及单位答语1；第16题6分按列式2/三次乘法各0.5及合计减法1.5/结果及单位答语1。选择、填空不要求过程分；正确的其他方法可给分，沿用前步错误但后续计算正确不重复扣分，新增独立错误另扣。此决定仅限本卷，不改变早前四题补弱练习口径。
- 教师再次明确“最终决定权还是由教师来进行评分”。本次仅记录 `policyConfirmed=true`、`scoresConfirmed=false`，不以确认评分口径替代逐题确认。决定文件 `tmp/quality/stage6-live-20260929/teacher-scoring-policy-20261010.json` 的 `businessApplied=false`；原来源包及指纹未改，待可用草稿与受验证的来源口径绑定后才能用于实际评分草稿，归档仍是独立动作。
- 第6项继续未完成：真实草稿、来源口径绑定、第16题识别修正、教师逐题评分确认、独立archive及正向数据库/学生档案边界核验仍待补齐。第5项继续暂缓，现有工作区产物和无关改动保留。
- 本轮 `check:api` 通过，数据库连接正常；定向 `git diff --check` 通过。`check:encoding` 检查1002个文件，仅有既有官方Prisma解包文件 `tmp/quality/task9-prisma-package-20260926/package/runtime/binary.js:126` 的1处告警、0自动修复，不宣称全量编码通过。本轮没有业务源码改动，不重复已通过的合成事务及大范围E2E，也不清理工作区。

### 2026-10-09 第6项真实输入、启动修复与超时诊断

- 本轮当前状态仍为未完成。沿用已实际上传的两页学生原图和16题原始识别，新提交为 `cmv0t8irl00016ybgyslmp1gd`；没有重复上传或用标准答案补造学生作答。真实工作流 `7abdec45-9ffd-487d-b003-7324459b08ba` 最终为版本1 `failed`，尚无可复核草稿。
- 教师明确确认第16题转写为“79×125=775；96×25=2900；498×5=2490；(2490+2900+775)-4765=700；答：还剩700枚”。此确认仅限识别，不是评分确认。记录位于 `tmp/quality/stage6-live-20260929/teacher-recognition-q16-20261009.json`，状态为待草稿产生后执行共享 `correct_recognition` 和单题重批；没有把这些错误计算改成标准答案，也没有直接改写业务OCR。
- 复现重复API启动会在端口绑定前执行恢复写入，影响正在执行的工作流。现改为先绑定端口，再恢复；恢复期间返回 `503 API_STARTING`，恢复失败关闭监听，端口冲突不执行恢复写入。启动、来源类型显示、策略及运行器32项聚焦回归通过，`check:api` 通过且业务数据库连接正常。
- 不落库诊断确认16题识别与有效来源包能够进入共享批改服务，输入证据充分。当前模型调用中 Astra 首次在120004ms超时，Sol替补在60002ms超时，两次usage及费用均未知，最终 `available=false`、`WORKFLOW_EXECUTION_FAILED`。报告为 `tmp/quality/stage6-live-20260929/workflow-diagnostic-live-7abdec45-20261009.json`；本报告是失败诊断，不能计为正向验收或批改正确率。
- 批改/参考任务在原180秒总预算内将首次调用上限设为120秒，保留一次替补机会；不增加总预算或追加次数。这一调度通过工程回归，但当前真实样本两次均超时，不能据此宣称模型可用性已解决。
- 失败边界只读复核已完成：工作流版本1快照仍为 `creationPending=true`，工作流状态为 `failed`，提交状态为 `NEEDS_REVIEW`，`workflowArchive` 不存在，`grading.needsReview=true`，且 `scoreConfirmed=false`、`recognitionCorrectionApplied=false`。因此本次超时没有越过教师复核或服务端归档门禁；第16题确认的转写仍等待可用批改草稿后通过共享 `correct_recognition` 修正。
- 提交前扩展到真实HTTP运输层适配器的本地回归63/63通过（模拟上游，不调用真实模型）。两条旧断言将“替补上限不大于首次上限”修正为“首次上限120秒，首次已耗时与替补上限之和不超过180秒”；保留两次调用、Astra/Sol顺序和可用性替补检查，首次提前失败仍可使用剩余总预算。
- 全量源码编码仍只有既有官方Prisma解包文件 `tmp/quality/task9-prisma-package-20260926/package/runtime/binary.js:126` 的1项告警（997文件）；未改vendor、删除证据或放宽检查。第6项仍待真实草稿、已确认识别修正、逐题教师评分复核、独立archive及数据库/学生档案边界验收，第5项继续按教师决定暂缓。

## 执行范围和证据边界

- 早期模型采样沿用既有 Web `http://127.0.0.1:5173/` 与 API `http://127.0.0.1:8787`，从独立进程调用当前源码，均为 `persist:false`；本日第6项启用检查另见下节。
- 隔离 Prisma Client 生成问题已修复，同服务器随机独立 schema 中的工作流表事务、发布/归档跨表事务及旧结构升级演练已通过。本日已迁移业务 schema 并启用工作流持久化；未归档真实批改，未修改默认 OCR 或模型路由。
- 早期CLI、HTTP及浏览器一致性场景使用合成模型和内存仓库；9月26日另补CLI/HTTP真实PostgreSQL工作流表验证，仍使用合成模型。真实模型采样使用共享执行器/服务层。这些证据不能拼成“生产 Web 与对话端已完整一致”。
- 生成采样为验收脚本明确构造的四年级数学、语文或英语教学要求，无指定教材或学生，尚非教师选定的留出任务。教师评价、教学通过、费用和未取得的 usage 保持未知；未代替教师确认。
- 本地结果位于 `tmp/quality/`，真实图片和脱敏 gold 不纳入文档。输入/输出哈希用于关联和检查篡改，不是独立执行或教师身份的密码学证明。
- 早期样本采集使用 `persist:false`；当时的综合生成、Flash OCR 和字段规范化未写入工作流、学生档案或正式归档。2026-09-30 的教师确认生成任务已持久化并正式导出，具体状态见下方当日记录。

### 2026-09-30 第6项教师确认与正式双卷 Web 验收

- 教师在对话中明确“生成内容为教师已复核”；真实 Web 四题均已确认并保存为版本3，任务 `c7f19aac-d04e-424f-bd83-24b745678393`。发布得到 Assignment `teaching-assignment-7b8651e9ae7cd2481b1027b515baf74f5436b5879290da5e1153a246d5b3aa64`，只读业务库核验 `draftReviewStatus=accepted`、`generationPipeline.gates.finalExported=true`。未绑定学生或对外分发。
- 用户恢复 Web 后，实际在 `http://127.0.0.1:5173/` 登录、恢复任务，激活“生成 PDF 预览”和“导出学生卷与解析卷”；页面显示双卷已导出且提供链接，控制台 error/warn 为空。本轮只验收桌面，不宣称移动端或完整独立 CLI 命令验收。
- 学生卷仅保留标题、四道算式和两列独立作答框。四题纯计算专项采用102mm作答空间，实际PDF为1页A4；四个正确答案120/12/50/13及解析、评分、考点、易错提醒完整保留在解析卷。新稿各题5分、方法/计算/结果2/2/1，不改早先另一份练习已确认的结果分2/2/1/1。
- 真实导出暴露解析卷空白尾页。停止专项/多日解析卷偶数页补齐后，运行资产元数据确认未补页但实际PDF仍2页；进一步去除末题尾部间距和空页脚，最新真实 Web 重导出后两卷均1页、未补页。综合卷既有偶数页策略保留。逐页渲染和PDF文本检查确认四题、答案及解析完整，无空白页、缺题或明显重叠。
- 版式检查补齐无“数学”字样的计算专项标题、括号后缀和全角中括号识别，仍拒绝空白页、综合卷改名及非算式内容。54项打印、导出复核边界与版式回归全部通过；其中修正既有测试工具缺少 `chineseWritingLineCount` 依赖的问题。生成蓝图、API数据库连接及本次学生卷 scoped layout 检查通过。全目录检查曾报告两份历史负数卷尾页过疏，本轮未处理，不声称历史目录整体通过。
- 源码/历史编码检查各发现1处既有 `tmp/quality/task9-prisma-package-20260926/package/runtime/binary.js:126` 告警，未自动修复，不宣称全量编码通过。当前双卷、文本、渲染图片、SHA-256及业务库选定字段核验保存在 `tmp/quality/stage6-live-20260929/current-export-20260930/`，Web截图为同级 `web-formal-export-20260930.png`；历史未确认记录保持。未写真实批改归档或学生档案；第6项剩余真实批改归档正向验收，第5项继续暂缓。

### 2026-10-08 第6项真实批改归档验收复核

- 真实 Web 已恢复并可进入教师批改工作台；现有待复核批次仍因缺少答案来源或原始识别证据而保持不可确认、不可归档。没有使用合成学生作答、导入 JSON 或历史结果字段绕过门禁。
- `collect:grading:gold` 只读 dry-run 扫描40份记录：10份、224题为既有教师确认历史批改，30份被阻断，`productionEligible=false`。该结果保留原有教师确认，不撤销历史归档结论，也不把历史确认改写为新工作流归档。
- 独立数据库只读盘点确认：10份有效且绑定当前作业来源包的历史记录均保留逐题历史作答和教师复核字段；但它们的 `content` 均没有当前 `gradeInput` 要求的原始 OCR/外部识别题包，且没有新的 `workflowArchive`。因此历史评分可以作为已确认历史证据，不能直接重放当前执行器，也不能据此伪造本次正向归档验收。
- 当前第6项唯一未完成证据已收窄为：通过 Web 或共享工作流入口提交一份真实学生作业，保留原始识别、有效答案来源和教师确认，然后由服务端完成一次真实 archive。完成该样本后，再补充归档字段、学生档案写入边界和 Web/对话共用链路的最终验收记录。

### 2026-09-29 第6项业务迁移与启用复核

- 迁移前对业务库完成 `pg_dump -Fc` 完整备份，并使用 `pg_restore --list` 验证归档可读；备份保留在仓库同级本地目录 `../君航AI助教-local-archive/workflow-migration-20260929/junhang_ai_tutor-before-teaching-workflows.dump`，不纳入 Git。回滚应先停止工作流写入，再按该备份和迁移前状态制定恢复步骤，不对当前业务库直接执行试验性恢复。
- 执行 `prisma migrate deploy` 后，`prisma migrate status` 确认 8/8 条迁移均已应用，包括 `202609110001_teaching_workflows`；schema 与当前 datamodel 的差异检查返回 `No difference detected`。Prisma Client v6.19.3 已重新生成，隔离 PostgreSQL 迁移及跨表发布/归档事务测试 16/16 通过，`check:api` 通过。随机测试 schema 已回收；这些事务使用合成 fixture，不代表正式教学发布。
- 本机 `.env` 已设置 `TEACHING_WORKFLOW_PERSISTENCE_ENABLED=true`，API 已重启。`/health` 返回 HTTP 200 且 `database.ok=true`；用项目烟测教师账号登录后，`GET /api/teaching/workflows?module=generation` 与 `module=grading` 均返回 HTTP 200、空列表。这证明运行进程加载了持久化服务并可查询当前业务库；未认证请求仍被权限层拒绝。开关仅在本机配置，不属于 Git 提交。
- 当前仍无教师选定的真实工作流内容供正式发布/归档；未以合成答案冒充教师确认，也未写入真实学生档案。本项技术迁移与只读 API 启用验收完成，教学内容、正式双卷发布和真实批改归档尚未验收。工作区 `output/` 及既有忽略产物继续保留。

### 2026-09-29 第6项真实 Web 操作验收

- 在 `http://127.0.0.1:5173/` 实际登录教师端，生成/批改持续工作台均显示“服务可用”；没有使用浏览器请求替身或合成服务。浏览器控制的鼠标动作未命中预期控件，改用控件键盘激活后登录和导航成功。页面无框架错误覆盖，检查时控制台 error/warn 为空。此轮仅检查桌面视口，未作移动端验收。
- 在 Web 提交一份不绑定学生的四年级4题计算验收请求，任务 `c7f19aac-d04e-424f-bd83-24b745678393` 从版本1处理中进入版本2 `ready_for_review`。题量4、总分20，逐题算术复核结果120/12/50/13全部正确，四题均未确认。新评分草稿为每题方法2分、计算2分、结果1分，不改变早先已确认练习的2/2/1/1结果分。
- 整页刷新后前端回到登录入口；重新登录并进入生成工作台可恢复同一任务及版本2。新建任务表单恢复默认10题和空要求，保存草稿仍为4题，此现象不当作原要求已完整回填。学生作答预览能隐藏答案、评分、考点及易错点。对话 CLI 共用的 `createTeachingWorkflowClient` 实际读取相同任务与历史版本1；未执行独立 CLI 进程，不声称完整 CLI 命令验收。
- 未确认时 Web 的 PDF 预览按钮禁用；向真实 API 提交该版本的 assignment 请求返回 `422 WORKFLOW_CONFIRMATION_REQUIRED`，未创建正式作业。四题及完整解析/评分已整理于 `tmp/quality/stage6-live-20260929/generation-review.md`，待教师确认本份新稿后才继续发布、预览及双卷正式导出。当前没有宣称 PDF 或正式发布验收通过。
- 实际从 Web 选择一个既有待复核批次，新批改任务 `69b6a722-b31c-4aa2-b308-43fad3f710e5` 保存为版本1 `needs_input`。只读核验确认源记录有20道识别题，但没有 `gradingSourcePackage`，外部答案来源为 `missing`，原记录为 `NEEDS_REVIEW`。工作台显示需补齐来源或识别、0题、不可确认/归档；真实 archive 请求返回 `409 WORKFLOW_VERSION_CONFLICT`，没有归档。该安全拦截不计为批改成功。
- 对当前页面其余3个可选批次作只读核验：同样没有有效来源包，且均为 `NEEDS_REVIEW`；它们不是可复用确认的工作流归档。没有撤销或重写其他历史教师确认，也没有用标准答案补造学生作答。原有批改入口可继续打开，原图实际加载成功（3024×4032），20道逐题结果可查看，未满足条件时确认归档按钮保持禁用。
- API/生成蓝图检查通过；本轮证据及安全响应摘要位于 `tmp/quality/stage6-live-20260929/result.json`，无会话密钥。当前新增的是一份未确认生成草稿和一份需补证据的批改占位，未创建正式作业、批改归档或学生档案证据。第6项还差新稿确认后的正式双卷链路，以及具有有效答案来源和真实作答的批改归档正向验收。既有 `output/`、编码历史报告改动和本地产物保留。
- 收口复核：再次在真实 Web 激活“刷新当前版本”后，四题草稿仍为版本2待复核，PDF预览仍禁用；控制台 error/warn 为空。`/health` 再次返回 `ok=true`、`database.ok=true`。`git diff --check` 通过；`check:encoding` 检查974个文件，仍仅在既有 `tmp/quality/task9-prisma-package-20260926/package/runtime/binary.js:126` 报1处告警，因此不宣称全量编码检查通过，也未修改该本地产物。

### 2026-09-29 第6项生产前技术验收重做（迁移前记录）

- API 基础健康检查通过：`http://127.0.0.1:8787/health` 返回 HTTP 200；`/api/status` 返回 HTTP 200，API 为 ready，数据库为 connected。
- 使用当前 `.env` 对业务库执行只读迁移状态核验：数据库为 `junhang_ai_tutor` 的 `public` schema，共发现8条迁移，已完成7条；`202609110001_teaching_workflows` 尚未执行。工作流迁移 SQL 当前仓库 checksum 为 `d4dff30256fab994de523eca5981b09d6610768d00cb2baa7d87686344181c7b`，业务库迁移历史中没有该条记录。
- 在 `READ ONLY` 事务中核对业务 schema：`TeachingWorkflow` 与 `TeachingWorkflowRevision` 两张表均不存在，未读取业务行、未执行迁移、未写入或修改业务数据。数据库“可连接”与“新增工作流表已可用”在当前状态下不是同一结论。
- `.env` 中 `TEACHING_WORKFLOW_PERSISTENCE_ENABLED` 未配置为 `true`。因此运行 API 的工作流路由仍按设计返回 `503 WORKFLOW_UNAVAILABLE`；这次复核确认当前503的直接原因是工作流持久化未启用，而不是普通 API 或数据库基础连接失败。既有禁用态 HTTP 回归也通过该边界验证。
- 本次聚焦回归结果：25项通过、0项失败、11项跳过。跳过项是需要真实工作流表的 PostgreSQL 持久化测试，不将跳过计为生产数据库验收通过。此次未备份、未迁移业务库、未启用开关、未重启 API、未执行真实发布/归档、未提交或清理工作区。
- 第6项当前结论：技术预检完成且边界明确，但生产落地验收未完成。后续只有在数据库备份与回滚步骤明确后，才进入业务迁移、持久化启用、API 重启和生成/批改/发布/归档真实链路验收。

## 已补齐的评测能力

1. 批改评测拒绝不可用、兜底、缺失结果、题号不齐、重复题号、非法结果集合、缺失执行来源和文本冒充图片验收。失败样本不进入正确率分母，但保留失败记录；须同时看覆盖数，不能只引用剩余样本的正确率。
2. 回放先校验教师 gold，构造请求时去掉 expected、actual、teacherReview 等评估标签；答案包作为合法评分依据保留。脱敏答案包重建为仅供评估的来源，不复用原正式资产指纹。
3. 回放记录独立 runner、输入/结果哈希、耗时、规则版本、调用与 usage；程序接口传入的模型覆盖实际进入 runner。`--model` 沿用单模型诊断模式，关闭额外尝试，故它不等于生产中的一次受限修复/可用性替补完整链路。
4. 回放新增逐份 `.progress.jsonl` 检查点，默认连续失败 3 次停止，输出剩余 case ID 和未完成状态。截断批次不允许宣称完整验收。已运行的旧进程不受此修改追溯影响。
5. 生成评测按 focused、multi_day、comprehensive、explanation 区分题量、题型、每日归属、讲解结构和答案解析要求，不再强迫专项或讲解套完整试卷。

## 真实模型结果

### 网关能力探针

使用实际配置的 Astra、Sol、Flash 网关，各测文本、JSON 和合成红色图片，共 9 项通过。每次上限 30 秒、2048 tokens、无协议自动重试。此项仅证明此次响应与基本输入兼容性，不证明手写识别、主观批改质量或供应商实际底层模型身份。

| 配置模型 | 文本 | JSON | 合成图像 |
| --- | ---: | ---: | ---: |
| gpt-6-astra | 5106ms | 3603ms | 2481ms |
| gpt-5.6-sol | 1766ms | 1738ms | 1930ms |
| deepseek-flash | 887ms | 564ms | 780ms |

证据：`tmp/quality/teaching-capabilities-20260917.json`。这些速度不能直接用于比较完整教学任务。

### 四类生成

每个任务共享 120000ms / 16000 tokens 预算；规则哈希为 `9d9dd7b01c9844361fa70bcd85caa5ad355dbc2850cb848627a1231962731f73`。

| 用途 | 耗时 | 模型尝试 | 已返回总 tokens | 实际结果 |
| --- | ---: | ---: | ---: | --- |
| 专项练习 | 54738ms | 1 | 4596 | 四题计算、每题5分，执行器快照有效，无兜底 |
| 每日练习 | 51878ms | 2 | 9108 | 两天各两题，分别进位加法/退位减法，快照有效，无兜底 |
| 综合小测 | 120034ms | 4 | 至少13990 | 填空/选择/计算分区返回，解决问题分区失败，产生兜底，快照和质量验收拒绝 |
| 讲解 | 46533ms | 1 | 4170 | 乘法分配律概念、推导、两个例题与易错辨析，快照及结构检查通过，无兜底 |

综合小测失败调用未返回 usage，不能将13990作为完整账单。所有费用未知。

2026-09-18 复测已修复综合工作流对 `audit.status="passed"` 的兼容判断。四个分区同时启动，四个分区均返回成功，耗时 71396ms，无动态兜底，内容质量校验通过，报告中的 `engineeringPassed=true`。兼容字段 `auditPassed=false` 仍保留在原始报告中，但不再作为唯一通过条件；本次 `productionReady=false` 仍正确表示尚未教师确认、持久化或正式导出。

证据：`tmp/quality/teaching-comprehensive-20260918-after-audit-fix.json`。该样本无教材和学生上下文，属于真实模型工程样本，不替代教师留出任务或正式教学验收。

证据：`tmp/quality/teaching-{focused,multiday,comprehensive,explanation}-20260917.json`。专项/每日文件生成时，runner 尚未添加通用质量字段；它们的通过结论来自执行器快照校验和本次内容抽查，不补写成当时已经跑过新版评测。

人工代码侧抽查（非教师验收）：专项四道加减法答案与解析正确；每日四题答案分别3965、9464、4665、3246，退位和验算正确；讲解两个例题结果721、2500，正向与反向分配律解释一致。每日题干含 `d1-1`、`d2-01` 等内部编号，作答格式为 null；应在交付前去除内部编号并验证打印作答空间。自动结构通过未覆盖这些呈现问题。没有为本轮样本生成/确认正式双卷 PDF。

### 教师 gold 批改

源文件 `tmp/quality/grading-gold-cases-20260909.json`，10份、224题，均为既有教师确认的数学生成材料批改。只读采集复核：40份候选，10份合格、30份阻断。已确认的对话归档按同一标准承认；本轮回放不会撤销其确认。

独立单份探针 `tmp/quality/grading-astra-20260917-probe.json`：20题、19ms，全部走客观题本地比较，状态一致率100%，总分绝对误差0。实际模型调用为0；这不是 Astra 主观题正确率。历史教师修改次数未记录，修改率为 null。

完整10份回放已结束，脚本与质量检查均以退出码1正确报告失败：1份成功、9份不可用。成功的仍是20题本地比较，不调用模型；其余5份耗尽约180秒预算，4份分别117.3、138.8、152.8、153.4秒后返回，运行元数据标记 `triggerClass=quality`。后四份已有模型响应，但未通过输出质量校验；当前记录不足以区分具体JSON或字段失败，不能编造唯一根因。

共记录9次Astra主调用、0次Sol；其中4次有usage，已知50766 tokens，其余5次usage未知，费用全部未知。批改规则哈希 `10f42f866aa61b5d0e7a793e2abf0e4155461cfbc83396f8937db46ff4cc3034`。可评估结果仅覆盖20/224题，剩余204题排除；报告中剩余题目的一致率100%绝不能表述为整批正确率。

证据：`tmp/quality/grading-astra-20260917-full.json` 及 `.run.json`。此次带 `--model gpt-6-astra`，属于单模型、无额外尝试的文本诊断，未重跑OCR，也未验证生产修复/替补策略。旧采集器保留题干、答案包和学生答案，但未保留题目的context、类型和独立observedWork；本批这两类上下文字段均为空。需要先核查哪些题依赖遗漏的材料/过程，再做完整主观质量比较，不能把本轮失败直接归因于Astra能力。教师确认仍有效，缺的是回放输入完整性证据。

新检查点另用首份本地比较样本实际运行：14ms、0模型调用，`.progress.jsonl`与最终样本文件一致，完成状态为true，未写库。证据：`tmp/quality/grading-astra-20260917-checkpoint.json`及伴随文件。

### 2026-09-18 批改回放诊断与证据补采

- 首次新增覆盖统计后真实回放输出 `tmp/quality/grading-astra-20260918-with-coverage.json`：第1份20题本地比较成功，随后3份各约180秒失败；连续失败保护停止，完成4/10，剩余6份未运行。质量评测退出1，不能以成功的20题代表224题整体准确率。
- 最小复测 `tmp/quality/grading-astra-20260918-classification-check.json` 仍是一份本地成功、一份180秒失败；原报告分类仍为 model_unavailable，未改写历史报告。根因是 runner 的 deadline 分支在写入 triggerClass 前提前返回，且回放没有识别 TEACHING_BUDGET_EXHAUSTED。现已补齐内部超时终止码、JSON错误和白名单字段校验码；修复后的超时分类通过真实执行器加受控停滞 transport 验证，未再次进行付费超时复测。
- 源采集器现保留已有的 context、题型、图形与识别 observedWork/bbox/page/引用，识别过程优先读取 content.ocrQuestions / content.ocr.questions，不用批改 studentProcess 或解析补作答。回放重建答案包及 assignmentItems 时保留上下文，null 置信度不算有效覆盖。失败日志只记分类和受控错误码，不记录供应商错误正文。
- 只读重新采集 `tmp/quality/grading-gold-20260918-evidence-v2.json`：扫描40份，继续保留10份教师确认 gold、224题；第一份恢复20个坐标字段。源记录仍无独立 context、题型和 observedWork。覆盖缺项仅是字段统计，不代表每一题必然需要该字段，更不能解释为已确认批改无效或模型失败的唯一原因。
- 两份 gold 共25题的 studentAnswer 是“教师复核确认作答正确/选择错误”这类结论摘要。它们仍保有有效教师确认，但不具备独立回放所需的原始作答。新增前置门禁遇到这类整字段摘要时以 evidence_insufficient 退出，不调用模型，不用标准答案反填，不撤销历史确认。
- `tmp/quality/grading-20260918-evidence-guard-v2.json` 用前两份重新采集记录验证：20题本地比较16ms，第二份含24个摘要的记录3ms被拦截，两份模型调用均为0；脚本退出1符合预期。这不是主观批改质量通过，也不是完整十份验收。
- 当前剩余工作：按原图/原始作答补齐这25题的独立证据；核查其余主观样本实际依赖的过程/材料，选择有完整输入的小批样本验证模型输出。不通过延长等待或扩大失败批次来替代证据补齐。
- 按用户最新安排，计划完成前不 stage、commit、push、清理或归档工作区；持久化开关及数据库后置安排保持不变。
- 本轮验证：采集、回放、gold契约、评测器、AI执行器及HTTP适配回归59/59通过；check:api（仅现有数据库连接）、check:skills、check:encoding（502文件、0问题）及git diff --check通过。回放质量报告仍为ok=false、productionAccuracyClaim=false，证据不足退出不能作为模型质量通过。

### 2026-09-18 原始作答恢复与裁剪对照

- 两份目标记录经只读数据库查询定位到教师对话归档，合计关联6个图片文件名；在该项目原对话的用户消息中找到对应嵌入JPEG，恢复到 `tmp/quality/grading-evidence-recovered-20260918/`。`manifest.json`记录附件名、对话行号、消息时间与SHA-256；逐份核对数据库imageEvidence集合一致。恢复的是当时对话保存的图像版本，不宣称与原始剪贴板PNG字节一致。
- 25题均已找到作答位置并生成裁剪对照：综合卷24题、小测1题。`transcription-candidates.json`保存独立补采候选，其中23题转写明确、2题字迹待核对；另补回11题可辨识过程和6题印刷选项。保留题号、来源包指纹、原图哈希、纸面页码、旋转及裁剪坐标，附件顺序不当作纸面页序。
- 待核对项为综合卷第4题第二个表示式的首个数字，以及第25题两处数值后的手写单位；两题studentAnswer保持null，局部可辨内容另存candidateText/observedWork，不按答案键补全。第23题仅转写未划去的过程，原草稿仍可从裁剪查看。
- `review.html`为本地独立对照页，展示全部25题及两项优先核对入口；裁剪避开学生姓名，不向外部发布。新转写尚未获得教师确认，候选包不是可直接回放的gold集合，replayEligible=false。原有教师批改确认继续有效，不要求重新确认历史评分。
- 数据恢复核验通过：6张原图及25张裁剪哈希、数据库附件绑定、25题缺项集合一一对应、原gold文件哈希未改变。此次0模型调用、0数据库写入；没有修改默认OCR、持久化开关、原归档或旧评测文件。
- 对照页以已有Playwright与无头Edge验证（Browser plugin not available）：1280×900、390×844无横向溢出，25张裁剪加载成功，疑点跳转与过程展开通过，无页面/控制台错误。源码编码506文件、历史编码513文件均0问题，git diff --check通过；这些检查只覆盖补采产物，不替代生产Web或模型验收。
- 下一步先核对新转写的两处歧义，并检查候选转写；确认后再生成新的评估副本和小批主观题回放。当前完成的是证据恢复，不是模型准确率或Task 9整体验收。

### 2026-09-18 小批主观题真实诊断与服务层证据修复

- 重新查看原图后，第4题数字和第25题手写单位仍保留待核对，没有把“继续操作”记为教师转写确认。本次选用综合卷第23、24题的清晰候选作答作诊断，独立于gold评测；没有修改历史教师评分，也没有宣称新转写已确认。
- 调用前发现服务层`normalizeSubmissionOcrQuestion`再次丢弃observedWork、page、sourceImageRef、cropRef和题型；本地比对还会在最终答案一致时跳过过程与评分点。新增3个回归先复现失败，再保留独立证据字段、printedPrompt及显式null作答/置信度；存在作答过程、主观题型或过程评分要求时交给模型判断，原有明确客观题仍可本地比对。HTTP集成测试进一步验证过程实际进入模型请求且确认标签不会混入。
- 首次真实诊断`tmp/quality/grading-recovered-subjective-probe-20260918.json`：2题，Astra high一次调用，35616ms，3163输入/1080输出tokens；结果为待复核5+5分。模型同时指出page=2/3与bbox.page=1冲突，定位到服务层无坐标时自动生成默认题框，而非原图证据冲突。
- 已移除服务层估算题框作为识别证据的行为：缺失、不完整、越界坐标保持null，不把typed-text-estimate清单作为真实题框；自动清单保留已知页码，缺失页码不补1。有效识别坐标保持原值，不再为小区域强行放大；结果规范化同样不补造默认框。
- 同题修复后复测`tmp/quality/grading-recovered-subjective-probe-20260918-location-fix.json`：24363ms，一次Astra调用，3110输入/725输出tokens，逐题过程和图片引用进入实际批改函数，bbox=null且纸面页码分别为2、3。返回仍为5+5分待复核，按展开四项、列式2分/计算2分/答语单位1分解释，未再出现默认页码冲突提示；archiveEligible=false、persist=false、原gold哈希未变化。
- 两次均限定60秒/6000输出tokens、禁止追加调用，未调用Sol或OCR、未写库。它们验证了清晰候选输入下的过程批改链路，不能证明教师确认gold正确率、错误/部分正确题覆盖、原图OCR准确率或生产Web完整验收。
- `check:services`真实烟测完成（130590ms）：问答、今日任务、生成草稿和听写计划均返回；生成样本标记usedDynamicFallback=true，20题/60分，只计链路运行，不计内容质量通过。`check:api`验证现有数据库连接成功，不代表新表迁移或PostgreSQL事务验收。
- 服务层、共享工作流、回放和API来源链路回归74/74通过。扩展回归发现旧来源测试仍扫描server.js中已迁出的实现，已改为调用当前共享输入构造器，实际验证登记包优先、题干/答案/分数/来源指纹一致、合法旧包回退和篡改包拒绝；PDF来源关联断言保留。该修正没有降低来源校验要求。
- 下一步仍需核对两处歧义与新转写，补充具有完整作答过程的错误及部分正确样本，再做教师金标对照；持久化开关保持关闭，提交和清理延后。

### 2026-09-20 错误与部分正确题对照

- 使用同一批已恢复原图，新增综合卷第28、29题的过程转写与裁剪，并复用分配律小测第6题裁剪。来源图片哈希、来源包指纹、题号及原gold哈希已核验；新转写仍为候选，不把继续实施指令视为教师确认。独立诊断和对照材料保存在 `tmp/quality/grading-error-evidence-20260920/`，入口为 `review.md`。
- 综合卷两题真实调用Astra high一次，44765ms。第28题识别到题干96被写成94，第29题识别到12.5×3.2误算39；两题均判partial、3/5分，与历史教师确认评分一致。反馈区分首错与后续沿用，不重复扣分，同时保留对细分计算分的教师复核提示。
- 小测第6题真实调用一次，22152ms：学生选D、标准选项C，模型能判断选项错误，但历史来源包的rubric为“按结构、过程与结果综合判分”，与选择题形式存在冲突，因此返回uncertain、score=null；历史教师结果为wrong、0分。此差异完整保留，不改写来源规则来提高一致率，不将其误报为超时或结构错误。
- 已向教师提出具体规则核对：该题是否仅按选项判分，正确2分、错误0分且不另计过程分。答案到达前不将该题规则改成已确认；后续如确认，只在新的独立诊断副本应用，历史档案和原gold保持不变。此前综合卷第4题数字、第25题单位仍未确认。
- 两次调用均限制60秒/6000输出tokens，无追加调用、无Sol、无OCR重跑；合计6072输入/2049输出tokens，费用未知。两份结果均needsTeacherReview=true、archiveEligible=false、persist=false。历史评分仅在调用完成后对照，不进入模型输入；原图/裁剪和输入哈希、过程字段传递及原gold未变校验通过。
- 本轮30项服务/回放回归通过，check:api确认现有数据库连接成功。2题评分一致、1题因来源规则冲突未定分，只作为小样本诊断，不计生产准确率；Task 9仍未完成。没有业务代码修改、数据库迁移、持久化启用、提交或清理。

### 同原图 OCR

从已登记外部作业只读取得两页原图，两条路线的 SHA-256 列表完全一致。默认识别路线保持 MiniMax。

| 路线 | 耗时 | 结果 | 限制 |
| --- | ---: | --- | --- |
| 现有 MiniMax | 18778ms | 返回20题，可用 | 没有教师确认转写，准确率未知 |
| Flash 初测 | 20325ms | FAILED，0题 | 不作为成功 OCR 样本 |
| Flash 带诊断复测 | 20832ms | FAILED，0题 | 4次返回均不是有效 JSON |

诊断复测仍用相同原图和原策略，只增加不含原始输出的调用统计。每次输出上限2000 tokens，四次 completion_tokens 均恰好2000；强烈提示输出预算耗尽与 JSON 不完整相关，但适配器未保留 finish_reason，不能据此断言唯一根因。当前8000总额度按两页分配，再为一次修复预留，单次因此只有2000。待下一步验证字段精简、按页或题区切分与额度分配，不能直接切默认路线。

2026-09-18 复测先将 Flash OCR 候选在结构校验前统一规范化：支持数字题号、`prompt/answer`、字符串置信度和 `pageRegion` 别名，并固定输出页码。随后将双页共享预算从16000提高到24000，即每页首轮12000 tokens。两页均返回有效 JSON，共20题，耗时51477ms，未超时；两次调用的 `validJson` 均为 true，题号、题干、学生作答、过程、bbox 和原图引用均已落地。证据：`tmp/quality/teaching-ocr-flash-20260918-after-24000.json`。

该结果只证明 Flash 候选链路在本次两页原图上能够完整返回结构化识别结果。没有教师逐题转写、裁剪对照或确认标签，`accuracy` 仍为 null；默认 MiniMax 路线保持不变，也未允许 Flash 自动归档或解除教师复核。

截至 9 月 18 日未做裁剪对照，未验证题号/手写/过程的准确率；返回20题也不证明现有路线识别正确。历史失败证据为 `tmp/quality/teaching-ocr-{current,flash,flash-diagnostic}-20260917.json`，最新成功证据为上述 `teaching-ocr-flash-20260918-after-24000.json`。9 月 24 日已补纸面裁剪和并排材料，见后文；教师准确率验收仍待完成。

## 工程与浏览器验证

- 评测/金标/采集/回放/CLI-HTTP 聚焦测试：32/32通过，包含失败先复现再修复的评测器用例。
- 浏览器生成3/3、批改2/2通过。Browser plugin not available，复用已有 Playwright 与 Edge，无安装。使用真实组件与临时HTTP服务，但模型/OCR/仓库为合成或内存实现。
- 真实Web入口5173显示登录及教师页旧入口回退；隔离工作台在5174验证。生成1480×980与390×844，批改1500×1000与390×844；断言无横向溢出、pageerror和框架遮罩。
- 交互覆盖：生成编辑/讲解确认/旧版本冲突保留文本；批改单题识别修正仅重判本题/独立确认归档/可信已确认归档复用。CLI与HTTP比较内容、教学上下文、来源证据、规则哈希、评分汇总和确认版本。
- 截图在系统临时目录 `junhang-generation-web-qa` 和 `junhang-grading-web-qa`；抽看生成窄屏及批改桌面截图，无明显重叠。截图为合成数据，不是实际学生批改验收。
- `check:api`、`check:generation:blueprint`、Web typecheck、`check:skills` 通过。API检查只证明现有数据库连接，不证明新增表事务通过。
- 源码编码最后复查480文件、历史编码483文件均0问题；历史检查按脚本行为更新既有 `docs/encoding-history-report.md`。未执行编码自动修复。定向 `git diff --check` 和OCR脚本语法检查通过。
- 本轮未修改运行时资料上下文或正式导出边界，未重复重型 `check:content-context`。Task 8 的旧实例 link-guard 证据保留在计划中，不算本轮新持久化链路证据。未执行新样本的 PDF layout/渲染验收。

## 复现入口

以下真实调用须使用新的输出路径；探针和生成每项预算写在脚本中。先选定任务或图片范围，再执行，不能作为日常无成本单测。

```powershell
npm.cmd run check:teaching:acceptance -- --mode probes --output tmp/quality/<new-probes>.json
npm.cmd run check:teaching:acceptance -- --mode generation --purpose focused --output tmp/quality/<new-generation>.json
npm.cmd run check:teaching:ocr -- --route current --output tmp/quality/<new-current>.json
npm.cmd run check:teaching:ocr -- --route flash --output tmp/quality/<new-flash>.json
npm.cmd run replay:grading:gold -- --gold tmp/quality/grading-gold-cases-20260909.json --output tmp/quality/<new-replay>.json --model gpt-6-astra --max-consecutive-failures 3
npm.cmd run check:grading:quality -- tmp/quality/<new-replay>.json
```

`check:grading:quality` 的 `ok` 仅表示评估输入/执行证据可用，正确率需单看且仅针对成功覆盖的样本；没有经教师批准的时长、成本、修改量阈值，不自动判定日常达标。

### 2026-09-22 生成题首标签修正与真实草稿打印检查

- 已保存的多日样本题干含`第1题（d1-1，5分）`及`【d2-01】`，共享链路此前直接传入Web快照和来源包。先以服务层回归复现，再在共享生成pipeline合并分区时移除与本分区dayId精确匹配的题首标签；正文中的相似字符、其他dayId、结构化每日归属、答案和分值保留。输出契约同时要求prompt只包含题目正文。没有修改历史样本、已确认版本或来源指纹。
- 回放还发现质量验收器没有读取服务层`metadata.score`，导致总分误报。已补齐字段读取；缺分和总分不一致仍然失败，未放宽断言。两项修复都有先失败后通过的回归。
- 复用真实模型已保存的专项4题、多日4题和综合18题，在隔离进程加载API现有纯打印函数，经无头Edge生成6份草稿PDF。多日输入通过当前生成服务和工作流校验器重新组装，transport只返回保存内容，明确标记synthetic回放；本轮0真实模型调用、0数据库写入、无教师确认或正式导出。脚本为`tmp/quality/preview-generation-20260922.mjs`。
- 完整证据目录为`tmp/quality/generation-print-20260922-v3/`：`render-report.json`记录输入哈希、题干、DOM作答区和页面错误；`multiday-replay.json`记录共享链路回放；`pdf-inspection.json`记录真实PDF尺寸和逐页文本；`layout-report.json`保留版式失败；`contact-sheet.png`及逐页PNG用于视觉检查。前两次脚本未完成的目录保留，不计成功验收。原3份模型样本哈希未改变。
- 6份PDF共12页，均为A4；学生卷均2页，专项/多日解析各1页、综合解析4页。DOM题量与答案包一致，解析含步骤和易错提醒，学生模板未包含答案/解析组件，页面无JS异常。图片检查未见明显重叠或裁切；数学计算区实测约18mm、综合解答区约28mm，竖式及验算书写是否足够仍需修正与教师体验验证。
- 版式检查只通过综合学生卷。专项及多日学生卷均失败：第一页底部留白约155.7mm，第二页约252.3mm，且第二页只有续页头和留白说明。多日卷将两天题目合并为“计算题”，未显示每日目标，标题还沿用第一天。保留失败，不能用默认2页的页数相等宣称可用。
- 综合卷另发现内容与评分矛盾：第11—14题结构化分值均为4分，题干标注及rubric给分点仍各合计5分。即使PDF版式检查通过，也不属于教学质量通过；不能只去掉题面5分或自动缩放rubric掩盖冲突。旧样本的engineeringPassed仅为当时结构检查记录，不提升为当前内容验收。
- 52项生成runtime/服务、工作流执行、质量检查与CLI/HTTP相关回归通过；`check:generation:blueprint`、`check:api`和`git diff --check`通过。源码编码532文件、历史编码539文件均0问题，未自动修复；历史检查按既有脚本更新编码报告。API检查仅证明现有数据库连通，不代表新增表事务通过。本轮未修改UI、正式导出门禁或数据库配置；Task 9仍未完成。

### 2026-09-22 分值、每日信息和分页修正

- 根因是综合生成后`assignAssessmentScores`重新分配数字分值，却保留模型的题干和rubric。现在综合分区在调用前取得共享分值计划`itemScores/targetScore`，系统规则明确逐题对应；模型返回后保留原分值，不再静默重分配。结构化分值与明确的题面标注、满分说明或可直接相加的评分点发生冲突时，pipeline/服务审查/工作流校验和质量验收均阻断通过。存在“各得”“每项”或条件给分的自然语言不能靠正则简单求和，仍交教师复核。
- 打印端使用统一`assessmentPrintPlan`读取purpose、来源包每日目标及顺序，供学生卷、解析卷和坐标清单复用。专项/多日按内容分页，导出适配器不再补双面留白页；综合默认页数保持不变。多日生成标题覆盖完整计划。专项和多日数学计算区由约18mm提高为32mm，带验算为48mm；图形、答案和来源题号保留。
- 同一综合样本另外发现第7—10题的选择题rubric写3分而结构化分值为2分。原始快照在当前工作流校验得到8个GENERATION_SCORE_CONFLICT，不修改原报告或历史来源。新独立候选逐题修订4题客观给分及4题计算评分点，使rubric、题干和既定60分答案包一致；属于助手编写的草稿修订，不是教师确认、不用于证明模型自行修复能力，也不是自动按比例缩放评分细则。
- 新脚本`tmp/quality/preview-generation-corrections-20260922.mjs`通过保存内容的transport回放实际生成服务及工作流校验，生成三份新的快照和答案包，再调用实际API纯打印函数。原样本SHA-256不变；真实模型调用0次、数据库写入0次，productionReady=false。第一次局部脚本运行发现“各得0.5分”不应当作单项累加，已加回归并保留失败目录；完成证据使用`tmp/quality/generation-print-corrected-20260922-v2/`。
- 完整证据包含`original-score-conflicts.json`、各purpose回放、`render-report.json`逐题前后修改、`pdf-inspection.json`真实尺寸及文本、`layout-report.json`和逐页PNG。共6份PDF、11页A4：专项学生/解析1+1页，多日1+2页，综合2+4页。三份学生卷均通过本地PDF版式检查；DOM题量完整、无溢出和JS异常，图片检查无明显裁切或重叠。每日目标同时显示在学生卷和解析卷，原样本的近空白第二页已消除。
- 版式检查器按明确的“专项练习/每日练习”页眉识别可变页数，仍拒绝空白页、错误页码或分页溢出；英语专项不再被要求补齐综合小测全部题型。导出适配器回归验证实际页数不符时不保存正式资产；该回归的文件/仓库/测量为隔离实现，真实PDF证据来自上述6份草稿，两者不能代替真实持久化HTTP验收。
- 最终合并回归116/116通过，覆盖评分、分区、runtime、规则加载、服务、工作流校验/发布/执行、打印与导出适配器、质量检查及CLI/HTTP契约；生成蓝图、Web typecheck、check:skills、check:api和git diff --check通过。源码编码550文件、历史编码557文件均0问题。完整内容E2E脚本会重置既有exports/markdown-ingestion-e2e目录并清理历史E2E文件，本轮按工作区保留约定未运行；本次使用同源打印、导出适配器与CLI/HTTP隔离测试验证。数据库迁移、新表事务、教师质量确认及正式双卷发布仍未完成，持久化保持关闭。

### 2026-09-22 新分值规则真实调用与失败诊断

- 新真实综合小测验收 `tmp/quality/teaching-comprehensive-20260922-live-scoring.json` 用时102928ms：Astra high四个分区各调用一次，填空/选择/计算通过，应用题分区质量校验失败。旧诊断仅给出domain_validation_failed，无法从该报告还原具体校验原因；没有保留失败题目正文，不推断为模型算错或预算截断。
- 定位并修复内部诊断丢失原因的问题：生成类固定错误码加入白名单，分区校验只保留已知末尾错误码，任意文本仍压成通用错误；不保存原始响应、分区注入文本或密钥。验收报告增加failureGates和partialGeneration，在快照创建之前被拦截也能说明部分生成、动态兜底和审查未通过，避免空validationIssues被误解为没有问题。模型职责、次数、预算及教学校验条件未改变。
- 修复后仅追加一次120秒预算的真实复测，`tmp/quality/teaching-comprehensive-20260922-diagnostic.json` 用时71372ms：前三个分区通过，应用题返回rubric_score_conflict。该错误码证明评分校验触发，但失败正文未保留，尚不能区分真实给分矛盾与自然语言校验误判。当前代码未对这次应用题内容作修复，不宣称新规则质量通过。
- 两次完整样本均被旧补题路径补为18题/68分：通过部分保留36分，缺失的4道应用题由每题8分的兜底补齐。usedDynamicFallback=true、audit未通过、WORKFLOW_SNAPSHOT_INVALID，未产生可用工作流快照、PDF或正式资产；不能为凑60分重新改写数字，也不能把该兜底卷当作验收通过。
- 两次共8个真实分区调用，27296输入/13700输出tokens，费用未知；没有额外Sol、OCR、数据库写入或教师确认。原报告与此前草稿均保留。本轮停止付费重试；下一步应在隔离诊断中保留经安全筛选的最小逐题评分证据，再区分模型内容问题与校验问题，并评估失败分区的局部修复，不能盲目重跑整卷。
- 两项诊断回归先失败后修复，新增完整服务回归验证“应用题评分冲突→分区拒绝→兜底被工作流阻断”。相关46项测试通过，日志为`tmp/quality/generation-live-diagnostic-tests-20260922.txt`；check:api通过且仅证明现有数据库连接。源码编码552文件、历史编码559文件均0问题，未自动修复；历史脚本更新既有编码报告。Task 9仍未完成，持久化、迁移、提交和清理继续后置。

### 2026-09-22 逐题评分证据、误判修复与内容保真

- 隔离脚本`tmp/quality/diagnose-solution-scoring-20260922.mjs`复用真实服务层上下文、分区和模型runner，只调用应用题分区一次，跳过其他分区，未写库。`solution-scoring-evidence-20260922.json`记录63997ms、3449输入/2030输出tokens及4题最小评分证据。前三题实际评分点为2+1+1+1+1=6，却被校验器按每个分号分句的末项误算为1+1+1=3；第四题因原有“每”字保守规则未作求和。此证据解释本次隔离样本，不反向断言之前未留正文的失败样本完全同因。
- 已修复共享`assessmentScoreIssues`：在原本允许直接求和的评分句中累计全部明确“得X分”，不只读取每个分句末项。回归先复现真实评分细则的误判，再验证相同细则通过、合计7分但score为6仍阻断。`solution-scoring-recheck-20260922.json`为同证据零调用重检，4题通过；未改分值、评分文字或历史确认。
- 修复后新真实完整生成`teaching-comprehensive-20260922-nested-score-fix.json`用时71702ms，4个分区均成功，18题60分，无动态兜底，工作流快照与来源包通过。这只是一份结构/分值样本，不等于稳定性或教师质量验收。
- 由该快照原样生成两份隔离草稿PDF，目录`tmp/quality/generation-live-print-20260922/`，学生2页/解析4页，均为A4；学生版式检查通过、两页无DOM题块越界，18题完整。解析是连续流HTML，DOM按单页高度测量的overflow为true，不能据此宣称无溢出；已检查实际4页PDF文本及四页拼图，没有明显裁切或题块断裂。原样本哈希保持不变，渲染0模型调用、0业务写入，不是正式HTTP双卷发布。
- 内容审查发现该已保存样本标题沿用首个分区“填空题草稿”，前4道填空的原解析被服务层`ensureAnalysisSteps`替换为通用三句。服务层此前把少于3步的已有推理整体覆盖，反而损失信息。已先用两步具体算式回归复现，再保留所有已有解析步骤；审查对齐当前pipeline/质量检查的非空结构要求，不再把“至少3句”当作完整性证明，内容是否充分仍需教师复核。综合标题改为整卷学科/年级/kind，教师指定标题优先；共享runtime-rules同步禁止模板凑步数。没有倒填丢失的模型解析或改写该旧样本/PDF。
- 这两项修复后的最后一次真实复测`teaching-comprehensive-20260922-preserved-analysis.json`用时68234ms：填空/选择/应用题通过，计算题出现rubric_score_conflict，整卷被拦截，无新快照或PDF。正文证据未保留，不能声称最新整卷成功，也未继续付费重试。已将评分证据白名单采集接入常用验收脚本，在模型解析/内部字段过滤后的校验处保留有限分值与rubric，不保留题干、原响应或配置，不进入API/工作流正式内容；本地HTTP模拟网关验证4次调用且失败分区证据可复查，无新增调用。
- 本轮共9个真实分区调用、31345输入/15585输出tokens，费用未知，无Sol追加、OCR、数据库写入或教师确认。84项聚焦回归通过，日志`tmp/quality/solution-scoring-final-tests-20260922.txt`；生成蓝图、check:skills、check:api与git diff --check通过。源码编码561文件、历史编码568文件均0问题；历史脚本更新既有报告，没有自动修复。API检查仅证明现有数据库连通。Task 9仍未完成，教师批改核对项、迁移、新表事务、持久化启用、提交和清理继续后置。

### 2026-09-22 计算题复测与选择题选项保真

- 单独运行计算题分区，复用真实服务层上下文、模型runner及原120秒/4000输出tokens预算，其余分区不调用模型。`tmp/quality/calculation-scoring-evidence-20260922.json`记录51805ms、4道每题4分均通过，保留逐题rubric；本次未复现评分冲突，不能替代旧失败正文或证明其根因已消除。因主动跳过其他分区，服务结果仍有兜底，不能按整卷成功统计。
- 带最小评分证据的整卷采样`teaching-comprehensive-20260922-stage9-evidence.json`用时68243ms，4个分区均成功，18题60分；标题正确，前6题两步具体解析保留。逐题审查却发现第7—10题所有选项为[object Object]，因此旧engineeringPassed=true属于检查漏项，教学质量不通过。已按该快照原样生成的草稿保留在`generation-stage9-evidence-print-20260922/`，只是失败证据，不交付教学；原始模型对象字段未保留，不能猜补丢失选项。
- 已复现服务层`normalizeStringList`把label/text对象转换成[object Object]，而pipeline仅检查数组长度、工作流只检查非空字符串，导致坏选项进入来源包。新增共享`assessment-options.js`：明确label/text对象等价转换成带字母的文本，已有字符串保留；遇到未知对象、缺失字段、标签矛盾或空选项拒绝整个列表，不丢选项、不重新编号。AI层、服务层、恢复/编辑工作流与质量验收采用相同有效性检查，规则正文要求options为带标识字符串数组。此转换的对象形态来自明确的兼容契约和合成回归，不伪称恢复了上述真实样本的原始对象。
- 两项回归先失败后修复，并补充不重排、不重复字母前缀、不吞坏选项及旧审查通过也不能接受占位符的测试。当前校验重读旧快照得到q7—q10四个GENERATION_OPTIONS_REQUIRED，证据为`task9-invalid-options-recheck-20260922.json`；输入SHA-256未变，0模型调用、未写库。额外单独选择题诊断49183ms返回4题普通字符串选项，未复现对象输出，作为有限样本保留在`choice-options-evidence-20260922.json`。
- 修正后最后一次真实整卷`teaching-comprehensive-20260922-options-fix.json`用时51348ms，填空/选择成功；计算/应用题无usage、无校验候选，runner记录triggerClass=configuration。现有记录没有HTTP状态/上游错误摘要，尚不能判断具体原因，也不能将其称为评分校验失败或超时。整卷动态兜底被工作流拒绝，无有效快照或PDF；本轮停止付费重试。
- 本轮共10个真实分区调用，已知28867输入/13019输出tokens，其中2次usage未知，费用未知，不能当作完整账单。89项聚焦回归通过，日志`task9-options-final-tests-20260922.txt`；生成蓝图、Skills、API现有数据库连通及Web typecheck通过。原打印证据、已确认历史评分、gold和用户素材未修改；未变更模型路由/预算/重试次数，未提交、清理、新表迁移、启用持久化或执行正式导出。Task 9仍未完成。

### 2026-09-22 安全失败诊断、最新综合/专项草稿与503证据

- 修复runner只保留笼统失败类别的问题：内部attempt新增可信数值HTTP状态和白名单上游/网络错误码，未知码只记unknown，原消息、地址、密钥及任意上游文本不保留；区分HTTP、网络传输、响应格式和未知失败。未调整路由、预算或重试策略。先用缺字段断言复现，再通过回归；模拟HTTP网关验证真实transport→runner→服务→验收报告的4个400错误均保留诊断，没有追加调用或形成快照。业务projection不增加这些内部字段。
- `tmp/quality/teaching-comprehensive-20260922-upstream-diagnostics.json`：114367ms，4个Astra分区成功，18题60分、无兜底，当前工作流/来源包及质量结构校验通过。逐题复算答案、选择项和评分点，未发现算术错误；第6、10题均采用彩笔平均分情境，教师需评估重复程度。旧configuration失败本次没有复现，不能反推其根因或宣布已修复上游故障。
- `tmp/quality/teaching-focused-20260922-final-sample.json`：101775ms，1个Astra调用成功，4道三位数进退位加减法、每题5分，答案及过程复算通过，无应用题夹带。第四题评分点含两个0.5分，人工核对合计5分；没有通过机械求和改变原rubric。标题较长换行，但PDF没有裁切。教师需判断标题、难度和书写空间。
- 两份最新草稿原样打印在`generation-upstream-diagnostics-print-20260922/`及`generation-focused-final-print-20260922/`：综合学生2页/解析3页，专项学生1页/解析1页，共4份7页A4，逐页查看PNG，无明显裁切/缺题，学生卷未出现答案区域。两次layout脚本均通过，脚本范围为学生卷；解析完整性由真实PDF文本和逐页图片检查支持。综合解析HTML连续流按单页DOM高度测得overflow=true，物理PDF正常分页，不能把该DOM测量描述为无溢出。隔离纯打印函数与Edge渲染不构成正式HTTP导出验收。
- `tmp/quality/teaching-multiday-20260922-final-sample.json`：32713ms失败。d1、d2的Astra主调用和各一次Sol可用性替补全部HTTP 503，usage均未知，无候选题目、无快照/PDF。这是本轮明确的上游可用性失败；没有伪装为题目质量错误，也没有追加付费重跑。停止后续讲解新调用，未换供应商或扩大预算。
- 使用9月17日保存的讲解样本进行当前共享validator零调用重检，通过；独立复算103×7＝721、36×25＋64×25＝2500，概念、推导、例题与易错辨析齐全。这只是旧样本重检，不算最新生成、正式讲解打印或教师验收。
- 教师查看入口`tmp/quality/task9-review-20260922/review.md`汇总两套PDF、22题评分点、内容观察、旧讲解复查和批改待核对材料；`evidence-summary.json`保存来源哈希及未知教师指标。新脚本仅组装本地证据，0模型调用、0写库、0内容修订，原样本哈希不变。第6题评分规则已再次作为具体问题提出，用户“继续操作”未视为选项2/0分的确认。
- 本轮9次真实调用，其中4次usage未知；已知18421输入/8511输出tokens，费用未知，不能作为完整账单。30项聚焦回归通过，日志`task9-diagnostics-final-tests-20260922.txt`；蓝图、API现有连接及Web typecheck通过。源码编码585文件、历史编码592文件均0问题，未自动修复；历史命令更新既有编码报告，定向diff检查通过。所有真实采样persist:false，无教师确认或正式发布。503、教师复核、三科/教材/学生薄弱点/留出任务、OCR转写gold、真实持久化跨入口与正式导出仍未验收，Task 9保持未完成。

### 2026-09-23 网关失败定位字段补齐

- 在实际HTTP transport保留有限诊断，再由教学runner重验字段后写入内部attempt：`upstreamDiagnostics.requestId/requestIdSource`、`reasonHint`、`retryAfterSeconds`，另记录每次调用的`startedAt`（UTC）和`elapsedMs`。耗时覆盖该attempt的调用及校验，不宣称为网关纯推理时间；未返回HTTP响应的网络/超时错误不会伪造响应头。
- 请求编号仅取`x-request-id`、`request-id`、`x-amzn-requestid`或`cf-ray`的8—128位字母/数字/下划线/连字符，过滤URL、可疑凭据格式及当前API密钥；缺失或不符合规则保持null。`cf-ray`是边缘代理跟踪编号，不能当作模型服务商请求编号，来源字段必须一并保留。没有采集任意响应头、响应正文或请求配置。
- 原因标签仅为上游措辞提示：无可用通道、过载、限流、维护、上游连接失败、账户限制、unknown。它们不构成已经核实的根因；不认识的文本保持unknown，不根据503直接猜测拥塞。Retry-After支持整数秒和标准HTTP日期，只保留0—86400秒，缺失、过期或异常值为null；目前仅记录，不增加等待、重试或改变路由。
- 先复现3项缺诊断失败，再用本地HTTP模拟验证503主调用和Sol单次替补、敏感字段过滤、错误200响应体、请求编号回退、HTTP日期及非法值。既有验收入口的HTTP→transport→runner→服务→报告测试确认新增字段贯穿本地记录；teacher/student/parent业务projection不包含诊断。50项相关测试通过：`tmp/quality/task9-gateway-final-tests-20260923.txt`；API检查通过。没有真实付费调用、数据库写入、迁移、提交或清理。
- 下次真实多日样本仍使用既有`check:teaching:acceptance -- --mode generation --purpose multi_day --output <新的本地JSON路径>`，不覆盖旧报告。失败后先看每次attempt的UTC时间、分区、角色、HTTP状态、reasonHint、requestIdSource/requestId及Retry-After，再以请求编号和时间对照网关日志；unknown且无编号时仍需网关端证据，不循环重跑。默认主模型/替补仍共用网关，独立备用通道或退避修改需在故障定位后决定。
- 9月22日四次503的原始响应头和原因正文未留存，本次不能补造历史字段，也没有证据宣布上游已恢复。该补齐完成的是故障可观测性，Task 9真实教学质量与持久化验收状态不变。

### 2026-09-23 多日与讲解最新真实采样

- 工作区守护只读检查仍因已有未收口文件与运行残留退出1，暂存区为空，未据此清理。沿用原120秒/16000输出token总预算、原并发与替补策略，采集新的多日及讲解报告；没有重跑已完成的综合/专项生成。
- `tmp/quality/teaching-multiday-20260923-diagnosed.json`：51482ms，两次Astra首次成功，无Sol/修复调用、无兜底。两天目标分别为进位加法/退位减法，各2道四位数竖式题，每题5分共20分；独立复算7783、8653、3646、4537全部一致，dayId/目标/题量完整。原SHA-256为`f89ecfb754f9e58ac43ae703b09d450c96bb083ca45baa30297baed89d0a1b57`。此请求没有限定三位数，不能误套专项样本的数位限制。
- 第4题主评分点1+2+1+1合计5分，但包含层级说明及0.5分子项，末句“每个高位及其在结果中的正确书写各占0.5分”可能有表述歧义，已列为教师评价点，不自行确认或改写。书写空间与难度仍需教师评价。
- 多日原样打印在`tmp/quality/generation-multiday-print-20260923/`，学生/解析各1页A4，共4题，两天标题在两卷均保留。layout脚本通过；两页实际PNG逐页检查无明显裁切/缺题，学生无答案区域，DOM题块无越界。输入哈希保持不变，0渲染模型调用、0业务写入；这仍是纯打印函数隔离渲染，不是正式HTTP导出。
- `tmp/quality/teaching-explanation-20260923-current.json`：41821ms，一次Astra首次成功，无兜底。当前快照包含概念、6步情境推导、两个正向/反向例题及5项易错辨析；独立复算103×24＝2472、36×27＋36×73＝3600，情境两种算法均为60颗，未发现数学错误。没有试卷题目/总分或伪造教师确认；正式讲解打印入口仍未覆盖，未临时套用试卷输出。
- 本轮共3次真实调用，输入10811/输出4237 tokens，用量均已返回，费用未知；没有503或额外替补。只能证明本次成功，不能补造9月22日失败响应或认定上游长期稳定。两份新报告都通过当前共享validator零调用重检，保存样本未改写。
- 新教师复核入口`tmp/quality/task9-review-20260923/review.md`包含多日双卷、4题评分点、完整新讲解、既有综合/专项及批改候选入口；`evidence-summary.json`关联来源哈希、调用耗时、usage和未知教师指标。教师修改题数、评分修改、可用于教学结论仍为null，未以“继续推进”替代具体复核。
- 20项打印、讲解权限/复核边界及CLI/HTTP验收回归通过，日志`task9-multiday-explanation-tests-20260923.txt`；生成蓝图通过。源码编码595文件、历史编码602文件均0问题，未自动修复，历史脚本更新既有报告；定向diff检查通过。本轮未改业务源码、模型规则或Web UI；没有为此重复大范围E2E、迁移、新表事务或持久化测试。Task 9保持未完成，提交和清理继续后置。

### 2026-09-23 语文、英语专项与四线格修正

- 验收脚本新增`--subject`，数学默认不变；语文、英语仅开放一份focused专项，保留120秒/16000输出tokens总预算。无效学科或不支持的用途在调用前拒绝。复现命令为`npm.cmd run check:teaching:acceptance -- --mode generation --subject 英语 --purpose focused --output tmp/quality/<new>.json`，语文替换学科即可；属于真实付费采样，不应作为普通单测反复执行。
- 英语真实样本`teaching-english-focused-20260923.json`用时60627ms，学校生活中译英4题20分；语文`teaching-chinese-focused-20260923.json`用时66407ms，成分残缺、搭配不当、重复啰唆、前后矛盾各1题，共20分。各一次Astra首次成功，无Sol、修复或兜底；合计7447输入/4052输出tokens，费用未知，均persist:false。
- 英语原始结构检查通过，但实际PDF四线格数量为0。根因是模型返回`answerFormat:{type:"english_four_line_grid",...}`，服务层字符串化后未识别，快照/来源包透传，而打印器只识别规范字符串。新增共享normalizeAssessmentAnswerFormat，只把明确同义格式规范化为`english-four-line`，服务层及工作流校验共同使用；不猜测未知格式、不采纳模型预填答案或排版几何参数。共享runtime-rules明确规范格式，回归覆盖真实服务和校验器至纯打印函数。
- `teaching-english-focused-20260923-format-recheck.json`是原保存输出的零调用重检，4题只更改作答格式，来源包重新构建；原题目、答案、解析、评分点和原报告哈希不变。它明确标记saved-response-recheck，历史attempts不是新调用，不能证明更新规则后模型必然返回规范格式。原失败PDF保留，修正稿在`generation-english-corrected-print-20260923/`。
- 语文原样草稿在`generation-chinese-print-20260923/`。两科学生/解析各1页，共4页A4，逐页图片和文本已检查，无明显裁切或缺题；英语4处空白四线格均位于题干下。语文每题实际只有单行作答区，未落实模型writingLines两行描述，长句书写空间仍待修正与教师实用性复核；专项页头还带通用题型说明，本轮未据此扩展模板重构。
- 语文原layout报告因末页189.9mm留白失败。现仅对明确专项/每日、真实单页且该页存在题目文本的短任务不要求填满A4；完整试卷、多页异常留白、空白页和错误页码仍拦截。新增规则一度误用全卷文本而放过空白页回归，已改为优先读取实际末页文本，原有效测试保留。两科最新`layout-final.json`通过，原失败报告不回写；不以留白豁免证明书写空间充分。
- 72项核心格式、服务、工作流校验、真实打印函数、验收、质量及版式回归全部通过，日志`task9-language-final-tests-20260923.txt`；生成蓝图和Web typecheck通过，API及Skills检查通过。API仍只证明现有连接。完整内容E2E涉及既有数据库及导出目录，本轮未运行，以同源打印和隔离测试验证本次修正，不宣称正式发布链路验收完成。
- 新复核入口`tmp/quality/task9-language-review-20260923/review.md`包含8题原文、解析、评分点、双卷链接及哈希摘要。英语单处拼写错误给3分、语文书写/标点给分等仅为模型草稿，不擅自升级为默认批改政策；teacherReview/teachingPassed均为null。未迁移、启用持久化、归档、提交或清理。Task 9仍未完成。
- 本轮源码编码618文件、历史编码625文件均0问题、0自动修复；历史检查按既有行为更新`docs/encoding-history-report.md`。git diff --check通过，暂存区仍为空。日志在`task9-language-encoding-20260923.txt`及`task9-language-encoding-history-20260923.txt`。

### 2026-09-23 语文作答行数与专项页头修正

- 定位到共享打印模板固定为语文解答题绘制一条紧凑横线，且专项页头直接展示综合printProfile.answerSpace。新增3项回归先复现失败，再修复同源模板；不改Web页面状态或已保存题目。
- 新chineseWritingLineCount仅解释语文非选择的填空/解答/操作/阅读题中明确的writingLines对象：正整数行数限制最多8行，无效值回退2行。渲染空白7mm横线，忽略预填内容和样式；answerSpaceMm采用相同行数计入分页估算。其他格式、学科及选择题保持原行为。共享runtime-rules补齐这项受限格式契约，不扩展模型路由、预算或调用。
- 专项/每日页头改为“学科 · 共N题”，N来自本次全部题目；题型与每日目标继续由原分区呈现，综合卷原说明保留。避免词汇专项出现“包含阅读”等并不存在的内容。
- 两份保存样本分别重印到`generation-chinese-refined-print-20260923/`与`generation-english-refined-print-20260923/`，没有修改或覆盖上一轮样本/PDF。4份PDF共4页A4，语文每题2条横线、英语每题1组四线格；两份学生卷layout通过，四页PNG逐页检查无明显裁切、重叠或缺题，无额外空白页。语文两行已实现，实际书写适配仍需教师试用，不用底部留白强行增加题目。
- `tmp/quality/task9-print-refinement-review-20260923/review.md`为新复核入口，evidence-summary.json记录来源与PDF哈希。校验确认两份来源哈希、答案包指纹和解析全文与前次一致；0模型调用、0业务写入、teacherReview=null。英语继续使用上一轮规范化重检快照，不冒充更新规则后的真实调用。
- 44项打印、来源导出、共享格式、工作流校验及版式回归通过；生成蓝图、Skills及API检查通过，API仅证明现有连接。本轮没有修改导出权限或持久化边界，未运行会操作现有数据库/导出目录的完整内容E2E；未做新表事务、迁移、正式发布、提交或清理。Task 9仍未完成。
- 收尾源码编码630文件、历史编码637文件均0问题、0自动修复；历史检查按既有行为更新编码报告。server.js语法检查及git diff --check通过，暂存区为空。日志为`task9-print-refinement-encoding-20260923.txt`和`task9-print-refinement-encoding-history-20260923.txt`。

### 2026-09-23 历史确认错题补弱与上下文修正

- 教师选择下一验收场景为“针对近期错题生成补弱练习”。从现有脱敏gold中选择9月3日已确认四年级数学记录`grading-2be54f928a5993b5`的第4/10/14/16题，跳过带涂改说明的第3题。历史确认有效，但未核实今天的掌握状态，也没有重新OCR、变更历史评分或假设已绑定当前数据库学生。
- 沿实际路径发现两处上下文差异：旧prepareAssessmentDraftInput默认不筛选未确认批改，而新工作流显式筛选；normalizeSignals遗漏studentAnswer/correctAnswer，同时modelInput顶层studentSignals仍沿用未规范化的原对象。3项回归分别先失败后修复：默认启用同一确认过滤，错题/批改/任务添加来源ref，答案字段按600字符上限保留，模型两处信号均使用同一白名单规范化结果。客户端字段白名单保持不变，不能上传自认已确认的信号。
- 真实样本`tmp/quality/teaching-remediation-20260923-live.json`耗时73999ms，一次Astra成功，4947输入/2363输出tokens，费用未知，无Sol/兜底。4条带来源的历史信号经共享服务和pipeline传入runner，4题20分通过工作流及质量校验。本地证据注入复用共享函数，不能算作当前数据库实时错题查询或生产Web持久化验收。
- 独立复算新题57×4－128＝100、620－（46＋79）×4＝120、900－（144÷9＋58）×7＝382、83×6－（432÷6＋89）＝337，解析及检查步骤一致。分别覆盖四类原题运算结构，以同类变式为主；是否需要单步过渡、难度是否合适、只写答案给1或2分的差别是否接受仍需教师评价，不能宣称补弱效果已验证。
- 原样打印`generation-remediation-print-20260923/`学生/解析各1页A4，layout通过，两页PNG逐页查看无明显裁切、缺题或历史答案泄漏；学生卷标题换行但完整。32mm脱式区是否足够由教师试用核对。原gold哈希不变，未覆盖旧报告/PDF，0业务写入。新入口`tmp/quality/task9-remediation-review-20260923/review.md`含双卷、原题号对应、给分点和证据摘要。
- 采样辅助脚本先因错误导出名停止，随后字段检查误匹配teacherReviewRequired，在实际调用前失败；9ms、0attempts失败报告`teaching-remediation-20260923.json`保留。改为精确字段名匹配后才有一次真实调用。新增补弱runtime-rules在请求启动后写入，实际规则hash以live报告为准，不声称该采样验证了后写入的规则。
- 67项上下文、确认过滤、权限/年级、教材门禁、执行器、服务和验收回归通过；生成蓝图、Skills、API和Web类型检查通过。完整check:content-context涉及既有数据库和exports目录，按用户保留约定继续后置；本次验证使用隔离依赖及一次共享链路真实生成，不宣称完整E2E通过。持久化、新表事务、提交和清理仍未执行，Task 9不勾选完成。
- 收尾源码编码639文件、历史编码646文件均0问题、0自动修复；语法和diff检查通过，暂存区为空。既有API/Web未重启，本次修正以当前源码独立进程验证，不声称正在运行的生产实例已完成更新。编码日志为`task9-remediation-encoding-20260923.txt`及`task9-remediation-encoding-history-20260923.txt`。

### 2026-09-24 错题补弱草稿证据一致性

- 原执行器只核对 generationContext.teaching/target，遗漏 studentSignals。4项回归先复现失败（日志 `tmp/quality/task9-context-red-20260924.txt`），再将规范化学习信号加入校验和修订前的同一比较函数。服务层对新命令保留证据变化的409错误，不再包成普通草稿422错误。
- 覆盖信号撤回、学生作答/正确答案/错误描述变更、历史字段缺失及生成期间变更。新增修订期间撤回回归，确认迟到结果不覆盖已保存快照。原HTTP恢复用例误用服务层revision字段，按现有接口改为restoreRevision；没有放宽断言或修改生产契约。
- 独立CLI进程与真实本地HTTP监听配合合成模型、内存仓库，两端创建结果、规范化错题依据及规则hash一致；伪造客户端studentSignals被过滤，证据修改后两端均拒绝新确认。历史版本和原成功确认命令可读/可重放，既有教师确认不被追溯撤销。未测试生产浏览器或真实新表事务。
- 94项执行器、讲解、服务生命周期/发布、信号及客户端回归通过（`tmp/quality/task9-context-regression-20260924.txt`），另11项验收脚本回归通过，共105项。生成蓝图、Skills、API检查通过，API检查确认数据库连通，不等于新增表事务通过。模块Playbook与API契约已同步证据变化后的处理顺序。
- 本轮0真实模型调用、0业务写入，未修改默认模型、Web界面或运行服务。完整check:content-context仍因操作既有数据库/导出目录而后置，持久化保持关闭。Task 9不勾选完成，提交和清理继续后置。

### 2026-09-24 来源依据变化的 Web 提示与编辑保留

- Web 共享请求函数此前把所有409统一提示为“版本或操作状态已变化……请刷新后比较”，未区分服务端已实现的WORKFLOW_EVIDENCE_CHANGED。新增浏览器断言先复现该文案错误，再只在api.ts按明确错误码映射安全提示：来源依据已变化，本地编辑、旧版本和已有确认保留；刷新不会更新旧草稿依据，由教师核对后决定是否另建任务。普通版本冲突提示保持原样，没有在页面重新组装上下文或自动换键重试。
- 浏览器使用真实本地HTTP、实际服务/执行器与内存仓库，在保存手工编辑前修改服务端错题cause。确认返回409及正确错误码，刷新后编辑和提示仍在、服务端版本/内容/确认未变；HTTP可读已有确认，主动放弃本地编辑后可查看版本1。监测到且仅有一次保存POST，没有自动重试或模型追加。合成模型共5次，仅供交互回归；0真实模型调用、0业务数据库写入。
- 生成浏览器3项、批改浏览器2项全部通过；原普通冲突、局部修改、确认、取消、历史恢复、打印门禁和不可用时旧入口仍通过。Web typecheck、生成蓝图、源码编码639文件0问题、git diff --check通过。首次运行曾超时；通过单动作10秒超时和创建响应断言定位新增测试在页面重载后题量回到10、而合成模型只产2题，已显式填写2题，不放宽服务端门禁。历史查看使用旧版本1，最新版本仍按当前状态返回。
- Browser插件未提供，沿用已有Playwright与无头Edge；通过PLAYWRIGHT_MODULE_PATH和PLAYWRIGHT_CHANNEL=msedge复现既有check:web:teaching-generation/check:web:teaching-grading入口。生成桌面1480×980及窄屏390×844截图已查看：提示完整、编辑内容保留、无横向溢出；没有页面运行异常或Vite错误遮罩。截图保存在系统临时目录E:/AppData/Cache/Temp/junhang-generation-web-qa-20260924-evidence/，关键文件为generation-evidence-desktop.png和generation-evidence-mobile.png。批改截图在同级junhang-grading-web-qa-20260924-evidence/。
- 恢复已停止的本地Web开发服务http://127.0.0.1:5173/，登录入口非空白检查通过。教师入口测试拦截API，持续工作台使用内存测试服务，不代表生产持久化已启用。未改模型、后端、教师确认、数据库或运行导出物；未迁移、提交或清理。Task 9仍保留以下教学质量、OCR/批改gold和真实持久化待验项。

### 2026-09-24 同原图 OCR 逐题裁剪对照

- 使用原保存的两张外部作业图片、现有路线和 Flash 候选的成功报告，按纸面两列五行位置生成 20 张独立裁剪；未使用任一路线未经验证的 bbox 作为裁剪依据。原图 EXIF 方向为 6，裁剪前按方向旋转。`tmp/quality/task9-ocr-review-20260924/review.html` 并排展示原始题干、作答、过程、页码、bbox 和原图引用；`manifest.json` 保留来源及裁剪 SHA-256。未改写原图和原报告，0 模型调用、0 数据库写入。
- 已逐题查看 20 张裁剪图。现有路线第 11–20 题的题目页码为 2、bbox 页码却为 1，不能直接叠加定位；第 7 题现有路线给出完整计算，但贴纸遮挡使原图无法确认；第 17 题候选路线给出完整过程，原图同样无法确认；第 19 题原图可见“460-126”，现有路线过程字段写成“400-126”。第 12、20 题有贴纸，空字符串不等于已确认空白；第 14 题过程局部被遮挡，候选完整展开也不能当作可见转写。
- 独立脚本核验两份报告与两张原图哈希、20 张裁剪哈希、20 题顺序和教师结论保持 null；无头 Edge 桌面 1365×900 与手机 390×844 下，20 张图片加载、题号跳转、无横向溢出或控制台错误。此项补齐的是教师可核对的同原图材料，非教师金标或识别准确率。默认 OCR 路线和历史评分/归档保持不变；Task 9 的 OCR 教师验收仍未完成。
- 核验命令 `node tmp/quality/task9-ocr-review-20260924/verify-review.mjs` 通过，已查看拼图及两种视口截图。源码编码 641 文件、历史编码 648 文件均 0 问题，未自动修复；历史检查按既有脚本更新编码报告。`check:api` 确认现有数据库连通，非新表事务验收；`git diff --check` 通过。未改业务代码、执行数据库迁移、提交或清理。

### 2026-09-24 批改三项教师核对入口

- 重新目视查看综合卷第4、25题及分配律小测第6题原裁剪；第4题数字、第25题单位仍无法仅凭现有图像可靠确认。新核对页 `tmp/quality/task9-grading-decision-20260924/review.md` 将这两项字迹问题与第6题独立诊断评分口径分开，嵌入已有裁剪并链接原图、完整对照及来源清单。
- 原图和裁剪的 SHA-256 与候选清单一致。保留第4、25题 `studentAnswer=null`、第6题模型草稿 `uncertain / score=null`；历史教师确认的0分和归档不受影响。没有新转写确认、新gold、模型调用或业务写入；Task 9仍未完成。
- 三题来源包指纹、6张原图/裁剪哈希、9处文件链接和原gold哈希核验通过。源码编码642文件、历史编码649文件均0问题、0自动修复；API检查通过，仍仅证明现有数据库连接。历史检查更新既有编码报告；本轮未修改业务代码，未提交、迁移或清理。

### 2026-09-24 教师确认三项局部转写

- 教师在当前对话明确确认：综合卷第4题第二个表示式首字为4；第25题两处手写单位为千米；分配律小测第6题手写选项为D。局部确认写入 `tmp/quality/task9-grading-decision-20260924/teacher-transcription-confirmation.json`，核对页同步标注。确认范围仅限这些字迹，不把其他候选文字或答句自动视为逐题金标。
- 第6题在新的独立诊断副本是否只按选项正确2分、错误0分仍未确认；来源包评分依据与选择题形式的冲突保留，旧模型草稿 `uncertain / score=null` 不改。原候选包、原gold、历史教师评分与归档不改；其余新转写、OCR金标和Task 9整体验收继续待办。

### 2026-09-26 选择题评分口径落实与第6题独立复测

- 教师明确确认第6题为选择题，不计过程分，数学只有计算题和应用题计过程分。生成与批改的共享runtime-rules已同步；答案解析仍保留解题步骤，但不把解析步骤作为客观题必须提交的作答。没有修改语文阅读、英语表达等既有评分范围。
- 服务层优先使用有效答案包、已有题目和参考答案的明确题型，随后才使用OCR题型。单选题在识别和答案可信时按单个选项比较，不再因通用过程rubric或草稿过程转交模型；填空、判断不获得过程分。计算和应用题保留过程评分门禁；缺失、低置信和含义不明的选项继续待复核。没有放宽未知题型的保守门禁。
- 共享assessmentScoreIssues新增rubric_process_conflict，拦截客观题明确过程给分文字；模型受限修复、生成服务审查和工作流手工编辑/恢复校验复用该规则。检查仅覆盖可明确识别的措辞，不宣称能穷尽所有自然语言评分冲突。旧综合测试夹具给选择/填空套用“按步骤评分”，已改为与题型一致的“按答案评分”，原有效断言保留。
- `tmp/quality/task9-grading-rule-20260926/choice-rule-diagnostic.json`记录教师确认、隔离输入及结果：原第6题D对C得0/2分，合成正向对照C得2/2分。保留原答案包及其冲突rubric，用当前共享服务验证题型优先；0模型调用、persist:false、0业务写入。原OCR置信度null保存在来源中，诊断有效可信度1只表示教师已确认选项，不是OCR测量或新的gold。原候选、原gold和旧诊断文件哈希核验不变，历史教师0分及归档继续有效。
- 回归先复现选择题错误转交模型、可信计算题类型未生效及生成缺少评分冲突检查，再验证修正。92项相关测试通过，日志位于同目录`regression.txt`；Skills、生成蓝图和API检查通过。API检查只证明现有数据库连通，不是新表事务验收。未重启运行API，当前源码隔离验证不能宣称运行实例已更新。未运行真实付费生成或完整内容E2E。
- 第6题评分规则待办已解除；其余转写、OCR教师gold、教学内容评价、真实持久化及正式发布仍待验。Task 9不勾选为全部完成，持久化关闭，迁移、提交和清理继续后置。

### 2026-09-26 批改工作流过程证据与未知置信度贯通

- 接续第6题评分口径，检查工作流创建/重判路径，复现原始observedWork未进入快照、逐题重判丢失过程与页码/图片引用、未知置信度被提升为1的问题。创建与重判现在保留可信题型、独立过程、页码、图片/裁剪引用和来源解析；测得置信度为null时全程保留null，教师答案修正仅为当前调用提供有效可信度，不能改写原识别数据。
- HTTP评分编辑回归进一步复现：题目白名单未回传observedWork，replace_question会丢失旧过程；服务层现把observedWork和题干、坐标一起作为不可由评分编辑覆盖的原证据保存。HTTP识别修正还暴露字段clone把null变成空对象，已对原证据字段使用保留null的复制，未扩大修改通用对象默认行为。
- 实际本地HTTP、共用执行器/判分服务与内存仓库验证第6题式样：初次未知识别产生合成uncertain草稿，教师修正选D后共享本地比较得到0/2分，无第二次模型调用；评分确认仍未完成、confirmedScore为null。计算题用合成模型验证原错误展开即使最终答案匹配也保留部分得分，创建与局部重判均收到相同原过程和位置，模型及评分编辑不能覆盖原过程。此处是工程回归，未把合成输出当作真实模型正确率，也未修改真实学生评分。
- 83项执行器、HTTP批改契约、服务生命周期/验证及客观题判分回归通过，日志`tmp/quality/task9-process-evidence-regression-final-20260926.txt`；前一失败日志保留。模块Playbook与API契约已同步。持久化开关关闭，未重启API或修改Web界面，0真实付费模型调用、0业务数据库写入，不声称新表事务或真实生产跨入口已经验收。
- 本轮解除的是过程证据与置信度在共用入口丢失的工程缺口。其余OCR转写、教学内容/书写空间评价及当前学生/教材留出任务仍待验；数据库迁移、新表真实事务、正式发布、提交和清理维持原先顺序，Task 9仍未整体完成。

### 2026-09-26 订正稿转写、教学评价与隔离PostgreSQL验收

- 教师明确选择按当前可见订正稿评分。20题独立目视转写中，第7、12、17、20题被遮挡，保持未知，不按空白计零；第10题漏写前半式、第14题局部涂改和第19题简写过程均照实保留。教师进一步确认第9题作答为72、誊写答案时写成76；新副本保留两处字迹，只确认最终作答，不代替过程分或整份金标确认。与此前综合卷/小测25题是不同样本，不混用题号。
- 四题补弱样本复算100、120、382、337，当前共享校验通过，已检查学生卷/解析卷既有渲染。助教评价为适合综合复测，首次补弱宜先拆基础步骤并强化完整等号链；教师明确允许依步骤数保留结果分2、2、1、1。此确认仅限本份评分点，不等于书写空间、完整教学质量或学生当前掌握度通过。原生成样本、PDF、OCR报告/原图/裁剪及旧候选哈希未变，0新增模型调用、0业务数据写入。
- 最新核对入口：`tmp/quality/task9-evidence-20260926/review.md`。教师原话记录`teacher-decisions.json`；确认后新副本为`ocr-visible-reviewed.json`、`teaching-sample-reviewed.json`，原候选和评价保留。
- 复现隔离Prisma生成缺少`runtime/library.d.ts`，核对prisma与@prisma/client均为6.19.3。获取同版本npm包并核验SHA512完整性，仅补回本地安装缺失的54个文件，未覆盖既有文件、升级版本、改锁文件或重新生成业务客户端。包差异及来源见`tmp/quality/task9-prisma-package-20260926/`；已有library.mjs.map差异保留，未宣称整个安装与官方包完全一致。
- 原9项真实PostgreSQL事务测试通过后，新增2项HTTP/对话客户端持久化测试，共11/11通过、0跳过：覆盖并发唯一创建、CAS无孤儿版本、幂等重放、教师隔离、历史不可变、失败回滚、检查点并发、中断恢复/取消迟到写，以及生成修订重读/确认和批改未知OCR经教师修正后的证据保留。模型输出、身份与学生解析为合成fixture，不是生产教学验收。日志`tmp/quality/task9-postgres-http-20260926.txt`。
- 数据库测试仅在现有PostgreSQL服务器的随机独立schema执行新增两表迁移，测试schema已回收；并非独立数据库服务器。独立只读核验`database-boundary.json`确认业务默认schema工作流表数量0、两次测试schema均消失、持久化开关仍关闭；没有迁移业务schema或读写业务行。Assignment/Submission正式发布和归档的真实跨表事务尚未覆盖。
- 共享HTTP测试工具新增显式repository注入，默认仍为内存仓库；64项相关HTTP、执行器与CLI回归通过，日志`tmp/quality/task9-http-fixture-regression-20260926.txt`。未重启运行API，未提交或清理工作区，Task 9仍待教学质量/金标、留出样本及生产落地验收。

- 本轮收尾：check:skills、check:api、check:generation:blueprint通过，20题副本、29处核对链接及原证据哈希核验通过。源码/历史编码检查各保留1项未通过：同版官方Prisma解包文件runtime/binary.js第126行的DOMException字符串含连续三个问号，触发乱码规则；与已安装依赖SHA-256一致，非本轮中文内容损坏。未修改供应商代码、删除核验文件或放宽守卫，故不能报告编码检查全通过。定位脚本tmp/quality/task9-evidence-20260926/inspect-vendor-encoding.mjs，完整检查日志task9-encoding-final-20260926.txt和task9-encoding-history-final-20260926.txt。

## 下一步和尚未解除的阻碍

1. 批改25题原图已恢复，综合卷第4题数字、第25题单位及小测第6题选项已获局部确认；第6题只按选项判分的规则已确认并完成独立复测（见9月26日记录），其余新转写候选仍需核对。原教师评分继续有效。所需证据确认齐全后才形成整份新的gold评估副本；四次约180秒失败的历史证据保留，长任务可用性尚未解决。
2. Flash 原图结构化返回、20题目视转写及纸面裁剪并排对照已完成；评分版本和第9题答案已确认，4题遮挡保持未知。其余逐字答案/过程仍待教师确认，完整gold与识别路线质量尚未验收。
3. 安全失败诊断、四类数学用途及语文/英语短专项样本已补齐；语文两行作答区和专项页头已修正。教师选定错题补弱场景后，已基于历史确认记录完成一次真实4题生成，入口`tmp/quality/task9-remediation-review-20260923/review.md`。本份结果分2、2、1、1已获教师认可；接下来确认教学贴合度与书写空间，再扩展当前学生错题、教材和教师留出任务；历史错题变式成功不等于当前掌握诊断、各科全部用途或补弱效果通过。讲解正式打印入口仍未覆盖；旧503/configuration失败原因尚未核实，单次恢复不视为稳定性通过。
4. 隔离Prisma Client、工作流两表事务及Assignment/Submission发布归档跨表事务已解除阻碍，后者11项真实PostgreSQL测试见9月26日记录。旧结构合成数据升级演练另有5项通过，见9月28日续记。仍需按约定处理真实业务结构/迁移历史核对、业务迁移、正式双卷PDF及生产启用；合成baseline不代表完整历史迁移链或生产升级验收，持久化继续关闭。

所有新脚本和报告仍在当前工作区。前序改动尚未按模块收口，本次未全量 stage、未提交混合改动、未清理素材。


### 2026-09-26 真实跨表事务与教学计划计算练习参考

- 新增 packages/db/src/teaching-workflow-publication.postgres.test.mjs，真实 PostgreSQL 独立随机schema、当前完整datamodel生成独立客户端并db push；使用真实HTTP/发布归档服务/仓储、学生权限及证据解析器，身份、题目和模型输出为合成fixture。11/11通过、0跳过：并发发布/归档唯一性、确认/版本/教师/退课/取消门禁、来源篡改与证据变化拒绝、零错题新版本替代当前证据而保留历史，以及真实SQL行锁阻塞并发修订。数据库触发器证实AssignmentItem失败回滚Assignment、Mistake失败回滚此前已插入的Submission和GradingResult，重试成功。日志 tmp/quality/task9-cross-table-expanded-20260926.txt。
- 测试schema已回收，只读复查 tmp/quality/task9-cross-table-boundary-20260926.json 确认业务schema工作流表仍0、持久化仍关闭、两个新测试schema均消失。此测试不是业务迁移升级验证、生产启用或真实学生教学验收；未重启API、未读写业务行。
- 教师否决旧四题学生卷，要求“一个标题＋题目内容＋作答空间”；简化单列版仅获“方向正确，题目或作答空间还需调整”。随后指定参考“教学计划”计算专项。已查阅同名对话及四年级20260914第1天学生卷：参考为20题/两页、每页两列五行大框。教师进一步说明按教学需求，生成时由老师明确题量、内容、年级和知识点，因此不把20题/2页硬设为默认。
- 共享API打印器现为纯数学focused计算题提供两列白底浅边框作答区，保留方法要求、取消冗余页头与分值；按成对行高度分页，较大作答区减少每页题量。批改位置清单同步两列顺序和估算框，真实导出仍用DOM测量校验；综合卷、多日目标和英语/语文结构保留。解析卷保留评分依据、完整步骤和易错点，源题与答案包不变。
- 原四题零模型调用重印双卷：tmp/quality/generation-remediation-reference-20260926/，学生/解析各1页A4，实际渲染与layout通过。答案100/120/382/337、教师已确认的结果分2/2/1/1保持；此确认不等于整份教学验收。20题重复合成内容仅用于分页压力检查，目录 tmp/quality/task9-reference-20item-layout-fixture-20260926，不作教学交付或原创内容样本。4题新布局仍待教师实用性评价，不标记通过。
- 31项打印/来源导出/布局回归通过（task9-reference-print-green-20260926.txt）。本轮未新增真实模型调用、未做业务迁移、正式导出、提交或清理。第九阶段仍待教学质量/OCR gold/留出任务及生产落地验收。

- 后续教师反馈“作答框需要加大”：每题净空白书写高度由32mm增至48mm，白底两列保留；分页随空间变化，不以参考样例20题/2页为硬要求。新四题双卷位于 tmp/quality/generation-remediation-reference-large-20260926，学生/解析各1页A4，实物渲染和layout通过，尚未获教师最终认可。旧版均保留。
- 放大后20题合成分页检查发现尾页偏空，已在保留题序及左右成对关系下平衡相邻页；最终8/6/6题共3页，目录 tmp/quality/task9-reference-large-layout-fixture-20260926-v2，layout通过。前述原20题fixture曾因隐藏指令被计入高度分为三页，修正后v2两页通过；这些中间样本只记录工程排版变化，不是新增教学内容。
- 蓝图、Skills和API检查通过。源码/历史编码各仍仅有1项官方Prisma解包文件runtime/binary.js告警，未改vendor、删除证据或放宽规则；不能称为全通过。日志 task9-reference-{blueprint,skills,api,encoding,history}-20260926.txt。最新31项打印/来源导出/布局回归及git diff --check通过，日志task9-reference-large-regression-20260926.txt；未执行提交或清理。


### 2026-09-26 训练阶段、连带错误评分与实际模型复测

- 教师要求补齐本轮评价中的缺口。generation/grading runtime-rules、模块入口及Playbook已明确首次补弱/巩固/复测结构，保持教师题量、年级和知识点。阶段沿用requirement或每日goal，不增加第二套前端prompt、stage枚举或推断当前掌握；共享服务测试验证原要求与历史信号同时进入模型上下文。
- 连带错误按本题权威rubric区分根源错误、后续保留项、独立新错及最终答案分；后续计算分只有明确允许错误传递时才可保留，规则不足且影响分数时uncertain/null。碰巧正确的答案不能抹掉可见错误过程。原四题结果分2/2/1/1及历史评分不改，新的评分建议待教师复核。
- 首次真实生成暴露“有过程分但仅正确结果得满分”矛盾。共享assessmentScoreIssues新增对明确措辞的冲突拦截，复现失败后修正，并验证服务层只走既有一次受限修复。该检查不能穷尽所有自然语言矛盾，语义复核仍保留。首次诊断脚本另错误预期quiz-standard，实际服务按正式练习使用formal-full；后续仅修正受控验收样例的预期预算，未改模型、路由、服务端预算或重试次数。首份不计教学通过且原报告保留。
- 修正后3份实际生成各4题20分，均一次Astra成功，无替补/兜底。12题通过独立精确算术复算，与本次提供的8道参考及本轮其他完整算式无重复。首次补弱为1道单步进位、2道短链乘减、1道括号综合；巩固/复测覆盖指定四结构。复测部分基本运算与巩固重合，只证明近迁移样本可用，不证明跨情境迁移、当前掌握或整个资源库去重。新样本仅结果1分与原四题评分是不同版本，不擅自视为教师已确认政策。
- 一次真实模型批改7份合成过程，实际得分3/1/0/2/5/null/1全部符合显式诊断细则，含规则模糊待复核与错误过程碰巧得到正确答案。此为语义诊断，不是7份真实学生作业、OCR金标或生产准确率。输入、解释、尝试和规则hash保留于tmp/quality/task9-carry-forward-live-20260926/grading.json。
- 本轮共5次真实模型调用，已知输入34491/输出10901 tokens，费用未知，未写业务数据库。原题零调用重印：tmp/quality/generation-remediation-readable-20260926，学生字号12磅、48mm作答空间，脱式解析逐行显示；学生1页/解析2页A4，渲染目视及学生卷layout通过。新解析独立分两页，未删解释以凑一页。
- 助教评价与12题/7场景汇总：tmp/quality/task9-practice-review-20260926/review.md。当前第九阶段仍待真实书写/教学及新评分草稿的教师确认、OCR完整gold、当前学生/教材/教师留出任务、业务迁移升级与生产正式双卷闭环。已完成的隔离跨表11项事务不再列为阻碍；持久化仍关闭，未重启API、提交或清理。

- 收尾验证：111项评分/共享服务/运行规则/工作流校验/打印回归通过，日志task9-stage-scoring-final-20260926.txt；Skills检查通过。12磅字号的20题合成分页为8/6/6题共3页，实物layout通过；失败中间样本均保留。蓝图/API及源码/历史编码完整结果分别见task9-stage-final-{blueprint,api,encoding,history}-20260926.txt，历史vendor告警未删除或放宽规则。

### 2026-09-28 补记旧结构升级演练

- 9月26日新增并执行 `packages/db/src/teaching-workflow-migration.postgres.test.mjs`，从 Git 固定旧版 datamodel（blob `3b6c352ed53c0650f36d1a751c2e51a5a7efeadb`）生成合成 baseline，在随机 PostgreSQL schema 中写入八类合成旧数据，再用 migrate deploy 执行仓库原字节工作流迁移。本次恢复时核对日志和报告，不重复运行已通过测试。
- 5/5通过、0跳过：旧记录/JSON/时间戳/关系保留；当前datamodel无drift且迁移checksum正确；重复deploy不改变历史和数据；工作流版本持久化及过期写拒绝；旧作业/批改仍可写入。日志 `tmp/quality/task9-migration-rehearsal-20260926.txt`；边界报告 `tmp/jh_migration_test_d14d07ade1d94a24bd061846b8fbf4a9/boundary.json` 确认测试schema已回收。
- 本项只证明旧版datamodel到当前结构的新增迁移，不覆盖完整历史迁移链、实际业务schema漂移或生产升级。0模型调用，未读写业务行、启用持久化、重启API、提交或清理工作区。教学评价、OCR完整gold、留出任务及生产正式双卷发布/归档仍待验，第九阶段不标为完成。
