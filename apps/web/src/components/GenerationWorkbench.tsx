import { useCallback, useEffect, useRef, useState } from "react";
import type { StudentProfile } from "@junhang/core";
import { createTeachingWorkflow, executeTeachingWorkflow, exportAssessmentDraft, exportAssessmentPrint, getTeachingWorkflow,
  listTeachingWorkflows, publishTeachingAssignment, type TeachingExplanation, type TeachingQuestion,
  type TeachingWorkflowCommand, type TeachingWorkflowSummary, type TeachingWorkflowView } from "../api";

const statusLabels: Record<string, string> = { queued: "排队中", running: "处理中", ready_for_review: "可编辑 / 待复核", confirmed: "已确认",
  failed: "处理失败，原版本保留", needs_input: "需要补齐条件", cancelled: "已取消", interrupted: "处理中断", historical: "历史版本" };
const itemTypes = [["calculation", "计算"], ["fill", "填空"], ["choice", "选择"], ["solution", "解答"], ["reading", "阅读"], ["writing", "写作"]];
const asText = (value: unknown) => typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2);
const running = (status?: string) => status === "queued" || status === "running";
const key = () => crypto.randomUUID();
type Edit = { workflowId: string; revision: number; target: string; value: TeachingQuestion | TeachingExplanation };
type Props = { teacherId: string; students: StudentProfile[]; active: boolean; onLegacy: () => void;
  textbook?: { assetId: string; chapterId?: string; title: string }; onMaterials: () => void };

export function GenerationWorkbench({ teacherId, students, active, onLegacy, textbook, onMaterials }: Props) {
  const selectionKey = `junhang.generation-workflow.v1.${teacherId}`;
  const [tasks, setTasks] = useState<TeachingWorkflowSummary[]>([]);
  const [view, setView] = useState<TeachingWorkflowView | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const busyRef = useRef("");
  const selectedId = useRef("");
  const readSequence = useRef(0);
  const mounted = useRef(true);
  const [selection, setSelection] = useState("");
  const [edit, setEdit] = useState<Edit | null>(null);
  const [instruction, setInstruction] = useState("");
  const [studentPreview, setStudentPreview] = useState(false);
  const [region, setRegion] = useState("content");
  const [historyRevision, setHistoryRevision] = useState(1);
  const [latestRevision, setLatestRevision] = useState(0);
  const [latestStatus, setLatestStatus] = useState("");
  const [assets, setAssets] = useState<Array<{ title: string; url: string }>>([]);
  const [preview, setPreview] = useState<{ workflowId: string; revision: number; assignmentId: string; ok: boolean; url: string; issues: string[] } | null>(null);
  const [requirement, setRequirement] = useState("");
  const [subject, setSubject] = useState("数学");
  const [grade, setGrade] = useState("四年级");
  const [studentId, setStudentId] = useState("");
  const [purpose, setPurpose] = useState("focused");
  const [kind, setKind] = useState("练习");
  const [count, setCount] = useState(10);
  const [type, setType] = useState("calculation");
  const [dayGoals, setDayGoals] = useState("巩固基础\n应用与辨析");
  const [useTextbook, setUseTextbook] = useState(false);
  const requestAttempt = useRef<{ signature: string; requestKey: string } | null>(null);
  const commandAttempt = useRef<{ signature: string; operationKey: string } | null>(null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; readSequence.current++; }; }, []);
  const failure = useCallback((error: unknown) => {
    if (!mounted.current) return;
    const e = error as Error & { unavailable?: boolean; status?: number };
    setMessage(e.message || "操作未完成，请稍后检查任务。");
    if (e.unavailable) setAvailable(false);
  }, []);
  const apply = useCallback((next: TeachingWorkflowView) => {
    setView(next); setLatestRevision((old) => next.status === "historical" ? old : next.revision);
    if (next.status !== "historical") setLatestStatus(next.status);
    setSelection((old) => next.content.questions.some((q) => q.id === old) ? old : next.content.questions[0]?.id || "");
    selectedId.current = next.id;
    try { localStorage.setItem(selectionKey, next.id); } catch { /* The server remains authoritative. */ }
    if (next.status !== "historical") setTasks((old) => [next, ...old.filter((t) => t.id !== next.id)]);
  }, [selectionKey]);
  const load = useCallback(async (id: string, revision?: number) => {
    const sequence = ++readSequence.current;
    if (selectedId.current !== id) setView(null);
    selectedId.current = id;
    try {
      const result = await getTeachingWorkflow(id, revision);
      if (mounted.current && sequence === readSequence.current) { apply(result.workflow); setAvailable(true); }
    } catch (error) { if (sequence === readSequence.current) failure(error); }
  }, [apply, failure]);
  const refreshList = useCallback(async () => {
    try {
      const result = await listTeachingWorkflows();
      if (!mounted.current) return;
      setTasks(result.workflows); setAvailable(true);
    } catch (error) { failure(error); }
  }, [failure]);
  useEffect(() => {
    if (!active) return;
    void refreshList();
    if (!selectedId.current) {
      let id = ""; try { id = localStorage.getItem(selectionKey) || ""; } catch { /* optional last selection */ }
      if (id) void load(id);
    }
  }, [active, refreshList, load, selectionKey]);
  const hasRunning = tasks.some((t) => running(t.status));
  useEffect(() => {
    if (!active || available === false || !(hasRunning || busy === "create" || busy === "revise" || running(view?.status))) return;
    const timer = window.setInterval(() => {
      void refreshList();
      if (selectedId.current && (running(view?.status) || busy === "revise")) void load(selectedId.current);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [active, available, hasRunning, busy, view?.status, refreshList, load]);

  const start = (action: string) => { if (busyRef.current) return false; busyRef.current = action; setBusy(action); setMessage(""); return true; };
  const finish = () => { busyRef.current = ""; if (mounted.current) setBusy(""); };
  const create = async () => {
    if (!requirement.trim() || !start("create")) return;
    const selectedStudent = students.find((s) => s.id === studentId && s.canReceiveNewWork);
    const request: Record<string, unknown> = { requirement: requirement.trim(), subject, grade: selectedStudent?.grade || grade, purpose,
      ...(purpose !== "explanation" ? { kind } : {}), targetScope: studentId ? "student" : "grade", ...(studentId ? { studentId } : {}),
      ...(purpose === "focused" ? { requestedItemCount: count, requestedItemTypes: [type] } : {}),
      ...(purpose === "multi_day" ? { dayPlan: dayGoals.split("\n").map((goal) => goal.trim()).filter(Boolean).map((goal, i) => ({ dayId: `d${i + 1}`, goal, requestedItemCount: count, requestedItemTypes: [type] })) } : {}),
      ...(useTextbook && textbook ? { textbookAssetId: textbook.assetId, textbookChapterId: textbook.chapterId } : {}) };
    const signature = JSON.stringify(request);
    if (requestAttempt.current?.signature !== signature) requestAttempt.current = { signature, requestKey: key() };
    selectedId.current = ""; readSequence.current++; setView(null); setEdit(null); setPreview(null); setAssets([]); setRegion("content");
    try {
      const result = await createTeachingWorkflow({ module: "generation", requestKey: requestAttempt.current.requestKey, request });
      if (mounted.current && (!selectedId.current || selectedId.current === result.workflow.id)) apply(result.workflow);
      if (mounted.current) setMessage(running(result.workflow.status) ? "任务处理中，可在任务列表打开并检查进度。" : result.workflow.issues[0]?.message || "草稿已保存，请检查内容后确认。");
      await refreshList();
    } catch (error) { failure(error); } finally { finish(); }
  };
  const command = async (input: Omit<TeachingWorkflowCommand, "operationKey" | "expectedRevision">, revision = view?.revision, clear = false) => {
    if (!view || !revision || !start(input.action)) return;
    const id = view.id;
    const signature = JSON.stringify({ id, ...input, expectedRevision: revision });
    if (commandAttempt.current?.signature !== signature) commandAttempt.current = { signature, operationKey: key() };
    try {
      const result = await executeTeachingWorkflow(id, { ...input, expectedRevision: revision, operationKey: commandAttempt.current.operationKey });
      if (mounted.current && selectedId.current === id) {
        readSequence.current++; apply(result.workflow); setPreview(null); setAssets([]);
        if (clear) { setEdit(null); setInstruction(""); }
        setMessage("版本已保存。修改后的内容需要重新确认。");
        if (input.action === "confirm") setMessage("已记录你的内容确认。");
      }
    } catch (error) { failure(error); } finally { finish(); }
  };
  const cancel = async () => {
    if (!view || !running(view.status)) return;
    const id = view.id;
    try {
      const result = await executeTeachingWorkflow(id, { action: "cancel", operationKey: key(), expectedRevision: view.revision });
      if (mounted.current && selectedId.current === id) { readSequence.current++; apply(result.workflow); setMessage("已请求取消，已保存版本保留。"); }
      await refreshList();
    } catch (error) { failure(error); }
  };
  const previewPdf = async () => {
    if (!view || !start("preview")) return;
    setPreview(null); setAssets([]);
    try {
      const published = await publishTeachingAssignment(view.id, view.revision);
      const result = await exportAssessmentDraft(published.assignment.id);
      if (mounted.current && selectedId.current === view.id) {
        setPreview({ workflowId: view.id, revision: view.revision, assignmentId: published.assignment.id, ok: result.layoutValidation.ok, url: result.asset.url, issues: result.layoutValidation.issues });
        setMessage(result.layoutValidation.ok ? "预览已完成，可导出学生卷与解析卷。" : "内容确认已保留，排版尚未通过，暂不能正式导出。");
      }
    } catch { setMessage("预览未完成，请核对内容确认、权限与排版状态。已有内容仍然保留。"); } finally { finish(); }
  };
  const exportPdfs = async () => {
    if (!preview?.ok || !start("export")) return;
    try {
      const result = await exportAssessmentPrint(preview.assignmentId);
      if (!result.asset?.url || !result.analysisAsset?.url) throw new Error("PDF incomplete");
      setAssets([result.asset, result.analysisAsset]); setMessage("学生卷与解析卷已导出。");
    } catch { setMessage("正式导出未完成，请检查排版与确认状态。不会将缺少解析的结果标记为完成。"); } finally { finish(); }
  };

  const isExplanation = view?.content.purpose === "explanation";
  const selected = view?.content.questions.find((q) => q.id === selection);
  const editable = !!view && !running(view.status) && !["historical", "cancelled"].includes(view.status) && !view.issues.length;
  const confirmed = isExplanation ? view?.content.explanation?.reviewedByTeacher === true : !!view?.content.questions.length && view.content.questions.every((q) => q.reviewedByTeacher);
  const dirty = !!edit || !!instruction.trim();
  const editMatches = edit?.workflowId === view?.id && edit?.revision === view?.revision && (isExplanation ? edit?.target === "explanation" : edit?.target === selection);
  const canWrite = editable && !busy && available === true;
  const target = isExplanation ? { targetExplanation: true as const } : { targetQuestionIds: selected ? [selected.id] : [] };
  const beginEdit = () => {
    const value = isExplanation ? view?.content.explanation : selected;
    if (view && value) setEdit({ workflowId: view.id, revision: view.revision, target: isExplanation ? "explanation" : selection, value: structuredClone(value) });
  };
  return <section className="teaching-workbench panel full" aria-label="持续生成工作台" hidden={!active}>
    <div className="tw-heading"><div><h2>持续生成工作台</h2><p>先看内容，再局部修改、确认。对话与网页继续同一份成果。</p></div><span className="tw-status">{available === null ? "检查服务中" : available ? "服务可用" : "服务暂未启用"}</span></div>
    {available === false && <div className="tw-notice" role="status">持续编辑服务暂未启用。你可以继续使用原有生成与打印。<button onClick={onLegacy}>原有生成与打印</button><button onClick={() => void refreshList()}>重新检查</button></div>}
    {message && <p className="tw-notice" role="status">{message}</p>}
    <nav className="tw-mobile-tabs" aria-label="工作区域">{[["request", "要求与任务"], ["content", "内容成果"], ["edit", "修改与版本"]].map(([id, label]) => <button key={id} aria-pressed={region === id} onClick={() => setRegion(id)}>{label}</button>)}</nav>
    <div className="tw-grid" data-region={region}>
      <aside className="tw-request">
        <h3>教学要求</h3>
        <label>学科<select value={subject} onChange={(e) => setSubject(e.target.value)}>{["语文", "数学", "英语"].map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>年级<select value={grade} onChange={(e) => { setGrade(e.target.value); setStudentId(""); }}>{["三年级", "四年级", "五年级", "六年级", "七年级"].map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>教学对象<select value={studentId} onChange={(e) => setStudentId(e.target.value)}><option value="">本年级通用</option>{students.filter((s) => s.canReceiveNewWork && s.grade === grade).map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
        <label>教学用途<select aria-label="教学用途" value={purpose} onChange={(e) => setPurpose(e.target.value)}><option value="focused">专项巩固</option><option value="comprehensive">综合测评</option><option value="multi_day">多日训练</option><option value="explanation">概念讲解</option></select></label>
        {purpose !== "explanation" && <label>内容类型<select value={kind} onChange={(e) => setKind(e.target.value)}>{["练习", "小测", "试卷"].map((s) => <option key={s}>{s}</option>)}</select></label>}
        {["focused", "multi_day"].includes(purpose) && <><label>题型<select value={type} onChange={(e) => setType(e.target.value)}>{itemTypes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>{purpose === "multi_day" ? "每天题量" : "题量"}<input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} /></label></>}
        {purpose === "multi_day" && <label>每日目标（每行一天）<textarea value={dayGoals} onChange={(e) => setDayGoals(e.target.value)} /></label>}
        <label>具体要求<textarea aria-label="具体要求" value={requirement} onChange={(e) => setRequirement(e.target.value)} placeholder="例如：10道四年级进位加法，先基础后应用；每题有解析和易错提醒。" /></label>
        <label className="tw-check"><input type="checkbox" checked={useTextbook} disabled={!textbook} onChange={(e) => setUseTextbook(e.target.checked)} />引用已选教材章节</label>
        <small>{textbook?.title || "未选择教材；教材相关要求请先选择已审批资料。"}</small><button className="secondary-button" onClick={onMaterials}>选择教材资料</button>
        <button className="primary-button" disabled={available !== true || !!busy || dirty || !requirement.trim() || grade === "七年级" && subject !== "数学" || (["focused", "multi_day"].includes(purpose) && (!Number.isInteger(count) || count < 1 || count > 100)) || purpose === "multi_day" && !dayGoals.trim()} onClick={() => void create()}>{busy === "create" ? "正在生成…" : "生成内容草稿"}</button>
        <button className="secondary-button" disabled={!!busy} onClick={() => { requestAttempt.current = null; setMessage("下一次提交将创建独立新任务，请先核对已有任务。"); }}>按相同要求另建任务</button>
        <h3>我的任务</h3><button className="secondary-button" onClick={() => void refreshList()}>刷新任务列表</button>
        <div className="tw-task-list">{tasks.map((task) => <button key={task.id} disabled={dirty || !!busy && busy !== "create"} className={task.id === view?.id ? "selected" : ""} onClick={() => { setEdit(null); setPreview(null); setAssets([]); setLatestRevision(task.revision); void load(task.id); setRegion("content"); }}><strong>{String(task.request.title || task.request.requirement || "教学任务")}</strong><small>版本 {task.revision} · {statusLabels[task.status] || "待检查"}</small></button>)}</div>
      </aside>
      <div className="tw-content">
        {!view ? <div className="tw-empty"><h3>{busy === "create" ? "正在准备教学内容" : "从一份教学要求开始"}</h3><p>{busy === "create" ? "任务列表会自动刷新。你可以打开处理中的任务检查进度或取消。" : "生成后在这里查看题目、讲解和解析；已有对话任务可以从左侧继续。"}</p></div> : <>
          <div className="tw-heading"><div><h3>{view.content.title || "教学草稿"}</h3><p>版本 {view.revision} · {statusLabels[view.status] || "待检查"}</p></div><button className="secondary-button" disabled={!!busy && busy !== "create"} onClick={() => void load(view.id)}>刷新当前版本</button></div>
          {view.issues.map((issue) => <p className="tw-notice" key={issue.code}>{issue.message}</p>)}
          {running(view.status) && <button className="secondary-button" onClick={() => void cancel()}>取消本次处理</button>}
          {latestStatus === "cancelled" && <p className="tw-notice">本任务已取消，保存的内容仍可查看。继续生成请填写要求并新建任务。</p>}
          {!isExplanation && !!view.content.questions.length && <label className="tw-check"><input type="checkbox" checked={studentPreview} onChange={(e) => setStudentPreview(e.target.checked)} />学生作答预览（隐藏答案）</label>}
          {isExplanation && view.content.explanation ? <article className="tw-explanation"><h3>{view.content.explanation.concept}</h3><ol>{view.content.explanation.steps.map((s, i) => <li key={i}>{s}</li>)}</ol><h4>例题与解析</h4>{view.content.explanation.workedExamples.map((example, i) => <div className="tw-example" key={i}><strong>{example.prompt}</strong><p>{asText(example.answer)}</p><ol>{example.analysisSteps.map((s, n) => <li key={n}>{s}</li>)}</ol></div>)}<h4>易错点</h4><ul>{view.content.explanation.commonMistakes.map((s, i) => <li key={i}>{s}</li>)}</ul><p>{view.content.explanation.reviewedByTeacher ? "内容已确认" : "待教师确认"}</p></article> : view.content.questions.map((q) => <article className={`tw-question ${q.id === selection ? "selected" : ""}`} key={q.id}>
            {q.dayId && <small>{view.content.days.find((d) => d.dayId === q.dayId)?.goal || q.dayId}</small>}
            {q.sharedMaterialId && <blockquote>{view.content.sharedMaterials.find((m) => m.id === q.sharedMaterialId)?.text}</blockquote>}
            <div className="tw-heading"><strong>第 {q.questionNo} 题 · {q.score} 分</strong><button disabled={!!edit || !!busy} aria-pressed={selection === q.id} onClick={() => { setSelection(q.id); setRegion("edit"); }}>选择此题</button></div>
            <p>{q.prompt}</p>{q.options?.map((o, i) => <p key={i}>{o}</p>)}
            {q.figure != null && <p className="tw-notice">此题包含图形，请在 PDF 预览中核对图形与标注。</p>}
            {!studentPreview && <div className="tw-answer"><strong>答案：{asText(q.answer)}</strong><ol>{q.analysisSteps?.map((s, i) => <li key={i}>{s}</li>)}</ol><p>评分依据：{asText(q.rubric)}</p><p>考点：{q.knowledgePoint}</p><p>易错点：{q.commonMistake}</p><small>{q.reviewedByTeacher ? "已确认" : "待确认"}</small></div>}
          </article>)}
        </>}
      </div>
      <aside className="tw-edit">
        <h3>修改与确认</h3><p>{isExplanation ? "当前操作对象：整份讲解" : selected ? `当前操作对象：第 ${selected.questionNo} 题` : "先选择一个内容单元"}</p>
        {edit && <p className="tw-notice">本地编辑基于版本 {edit.revision}，尚未保存。{!editMatches && "当前版本已变化；编辑已保留，请比较后重新整理。"}</p>}
        <button className="secondary-button" disabled={!canWrite || !!edit || (!isExplanation && !selected)} onClick={beginEdit}>手工编辑内容</button>
        {edit && <><fieldset className="tw-editor-lock" disabled={!!busy}><ContentEditor value={edit.value} explanation={edit.target === "explanation"} onChange={(value) => setEdit({ ...edit, value })} /></fieldset>
          <button className="primary-button" disabled={!canWrite || !editMatches} onClick={() => void command({ action: "revise", ...target, patch: edit.target === "explanation" ? { type: "replace_explanation", value: edit.value } : { type: "replace_question", questionId: edit.target, value: edit.value } }, edit.revision, true)}>保存内容修改</button>
          <button className="secondary-button" disabled={!!busy} onClick={() => setEdit(null)}>放弃本地编辑</button></>}
        <label>修改要求<textarea aria-label="修改要求" disabled={!!busy} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={isExplanation ? "例如：用小棒说明进位，保留例题。" : "例如：保留考点，降低这一题的计算难度。"} /></label>
        <button className="primary-button" disabled={!canWrite || !!edit || !instruction.trim() || (!isExplanation && !selected)} onClick={() => void command({ action: "revise", ...target, instruction }, view?.revision, true)}>{busy === "revise" ? "正在修订…" : "按要求修改所选内容"}</button>
        <button className="secondary-button" disabled={!canWrite || dirty || (!isExplanation && !selected)} onClick={() => void command({ action: "confirm", ...target })}>{isExplanation ? "确认整份讲解" : "确认所选题目"}</button>
        {!isExplanation && <button className="secondary-button" disabled={!canWrite || dirty || !view?.content.questions.length} onClick={() => void command({ action: "confirm", targetQuestionIds: view!.content.questions.map((q) => q.id) })}>已逐题核对，确认全部</button>}
        <h3>历史版本</h3><label>查看版本<input type="number" min={1} max={latestRevision || 1} value={historyRevision} onChange={(e) => setHistoryRevision(Number(e.target.value))} /></label>
        <button className="secondary-button" disabled={!view || !!busy || dirty || !Number.isInteger(historyRevision) || historyRevision < 1 || historyRevision > latestRevision} onClick={() => view && void load(view.id, historyRevision)}>查看历史版本</button>
        {view?.status === "historical" && <><p>历史内容只读。恢复会新增版本；当前最新版本不会被覆盖。</p><button className="secondary-button" disabled={!!busy || dirty || latestStatus === "cancelled"} onClick={() => void command({ action: "restore", restoreRevision: view.revision }, latestRevision)}>恢复为新版本</button></>}
        <h3>预览与导出</h3>{isExplanation ? <p>讲解可编辑和确认，正式讲解打印尚未开放。</p> : <><p>全部内容确认后单独生成预览，排版通过才能正式导出。</p><button className="secondary-button" disabled={!canWrite || dirty || !confirmed} onClick={() => void previewPdf()}>生成 PDF 预览</button>
          {preview && preview.workflowId === view?.id && preview.revision === view?.revision && <><a href={preview.url} target="_blank" rel="noreferrer">打开教师预览 PDF</a>{preview.issues.map((s, i) => <p key={i}>{s}</p>)}<button className="primary-button" disabled={!!busy || dirty || !preview.ok || view?.status === "historical"} onClick={() => void exportPdfs()}>导出学生卷与解析卷</button></>}
          {assets.map((asset) => <a key={asset.url} href={asset.url} target="_blank" rel="noreferrer">{asset.title}</a>)}</>}
      </aside>
    </div>
  </section>;
}

function ContentEditor({ value, explanation, onChange }: { value: TeachingQuestion | TeachingExplanation; explanation: boolean; onChange: (value: TeachingQuestion | TeachingExplanation) => void }) {
  const field = (name: string, label: string, lines = false) => <label key={name}>{label}<textarea aria-label={label} value={lines ? ((value as any)[name] || []).join("\n") : asText((value as any)[name])} onChange={(e) => onChange({ ...value, [name]: lines ? e.target.value.split("\n") : e.target.value })} /></label>;
  if (explanation) {
    const e = value as TeachingExplanation;
    return <div className="tw-editor">{field("concept", "概念")}{field("steps", "讲解步骤（每行一步）", true)}
      {e.workedExamples.map((example, index) => <fieldset key={index}><legend>例题 {index + 1}</legend>{([['prompt', '例题题干'], ['answer', '例题答案'], ['analysisSteps', '例题解析（每行一步）']] as const).map(([name, label]) => <label key={name}>{label}<textarea value={name === "analysisSteps" ? example.analysisSteps.join("\n") : asText(example[name])} onChange={(event) => onChange({ ...e, workedExamples: e.workedExamples.map((old, i) => i === index ? { ...old, [name]: name === "analysisSteps" ? event.target.value.split("\n") : event.target.value } : old) })} /></label>)}</fieldset>)}
      {field("commonMistakes", "易错点（每行一项）", true)}</div>;
  }
  return <div className="tw-editor">{field("prompt", "题干")}{field("answer", "标准答案")}{field("analysisSteps", "解析步骤（每行一步）", true)}{field("rubric", "评分依据")}{field("knowledgePoint", "知识点")}{field("commonMistake", "易错提醒")}
    {(value as TeachingQuestion).options?.length ? field("options", "选项（每行一项）", true) : null}
    <p>分值：{(value as TeachingQuestion).score} 分（保持当前评分结构）</p></div>;
}
