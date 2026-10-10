import { useCallback, useEffect, useRef, useState } from "react";
import { archiveTeachingGrading, createGradingWorkflow, executeGradingWorkflow, getGradingWorkflow, listTeachingWorkflows,
  teachingImageUrl, type GradingWorkflowPage, type GradingWorkflowQuestion, type GradingWorkflowView, type TeachingWorkflowCommand, type TeachingWorkflowSummary } from "../api";

type Source = { submissionId: string; studentId: string; assignmentId: string; title: string; studentName: string };
type Props = { teacherId: string; active: boolean; sources: Source[]; onLegacy: () => void; onArchived: () => void };
type Edit = { id: string; revision: number; questionId: string; mode: "recognition" | "score"; answer: string; blank: boolean;
  status: GradingWorkflowQuestion["status"]; score: string; explanation: string; knowledgePoint: string; errorStep: string; suggestedPractice: string };
const text = (v: unknown) => typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
const key = () => crypto.randomUUID();
const running = (s?: string) => s === "running" || s === "queued";
const labels: Record<string, string> = { queued: "排队中", running: "处理中", ready_for_review: "待教师复核", confirmed: "已确认", historical: "历史版本", cancelled: "已取消", failed: "处理失败", needs_input: "需补齐来源或识别", interrupted: "已中断" };
const currentArchive = (t: TeachingWorkflowSummary) => t.archive?.workflowId === t.id && t.archive.revision === t.revision && t.archive.status === "archived" ? t.archive : null;
const reviewLabel = (t: TeachingWorkflowSummary) => ["ready_for_review", "confirmed"].includes(t.status)
  ? currentArchive(t) ? "已归档" : t.reviewStatus === "teacher_confirmed" ? "教师已确认" : labels[t.status] : labels[t.status] || "待检查";
const statuses = { correct: "正确", wrong: "错误", partial: "部分正确", uncertain: "待核对" };
const needsRecognitionReview = (q: GradingWorkflowQuestion) => q.studentAnswer == null || !q.reviewedByTeacher && !q.recognitionCorrectedByTeacher && q.confidence != null && q.confidence < 0.62;
const dubious = (q: GradingWorkflowQuestion) => q.status === "uncertain" || needsRecognitionReview(q);

function EvidenceImage({ page, question }: { page?: GradingWorkflowPage; question?: GradingWorkflowQuestion }) {
  const url = teachingImageUrl(page?.imageUrl);
  const [brokenUrl, setBrokenUrl] = useState("");
  const box = question?.bbox;
  const sameImage = !!page && (!question?.sourceImageRef || page.imageRefs?.includes(question.sourceImageRef));
  const sameCrop = (question?.cropRef || null) === (page?.cropRef || null);
  const located = sameImage && sameCrop && box && box.page === page?.pageNumber && [box.x, box.y, box.w, box.h].every(Number.isFinite)
    && box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0 && box.x + box.w <= 1 && box.y + box.h <= 1;
  return <div className="gw-evidence">
    {!url || brokenUrl === url ? <p className="tw-notice">原图暂不可用，请回到原批次检查图片。</p> : <>
      <div className="gw-image-wrap"><img src={url} alt={`作业原图第 ${page?.pageNumber} 页`} onError={() => setBrokenUrl(url)} />
        {located && <span className="gw-image-region" data-testid="grading-question-region" aria-label={`第${question?.questionNo}题原图区域`}
          style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />}</div>
      <a href={url} target="_blank" rel="noreferrer">打开原图核对</a>
      {!located && <p className="muted-line">没有与此原图匹配的可靠位置，请查看完整图片核对。</p>}
    </>}
    <small>图片质量：{page?.qualityStatus === "unknown" ? "未提供" : ["usable", "ready", "good"].includes(page?.qualityStatus || "") ? "可用" : "需核对"}。位置标记不代表识别正确。</small>
  </div>;
}

export function GradingWorkbench({ teacherId, active, sources, onLegacy, onArchived }: Props) {
  const storageKey = `junhang.grading-workflow.v1.${teacherId}`;
  const [tasks, setTasks] = useState<TeachingWorkflowSummary[]>([]);
  const [view, setView] = useState<GradingWorkflowView | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const busyRef = useRef(""); const currentId = useRef(""); const readSeq = useRef(0); const mounted = useRef(true);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const creation = useRef<{ signature: string; key: string } | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [questionId, setQuestionId] = useState(""); const [pageNumber, setPageNumber] = useState(1);
  const [region, setRegion] = useState("question"); const [onlyDoubts, setOnlyDoubts] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null); const [instruction, setInstruction] = useState("");
  const [checked, setChecked] = useState(false); const [history, setHistory] = useState(1);
  const [head, setHead] = useState({ revision: 0, status: "" });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; readSeq.current++; }; }, []);
  const fail = useCallback((error: unknown) => {
    if (!mounted.current) return;
    const e = error as Error & { unavailable?: boolean };
    if (e.unavailable) { setAvailable(false); setMessage(""); }
    else setMessage(e.message || "操作未完成，已保存的内容仍保留。");
  }, []);
  const apply = useCallback((next: GradingWorkflowView) => {
    currentId.current = next.id; setView(next); setChecked(false);
    if (next.status !== "historical") {
      setHead({ revision: next.revision, status: next.status });
      setTasks((old) => [next, ...old.filter((t) => t.id !== next.id)]);
    }
    setQuestionId((old) => next.content.questions.some((q) => q.id === old) ? old : next.content.questions.find(dubious)?.id || next.content.questions[0]?.id || "");
    try { localStorage.setItem(storageKey, next.id); } catch { /* Optional last ID, never evidence or confirmations. */ }
  }, [storageKey]);
  const load = useCallback(async (id: string, revision?: number) => {
    const seq = ++readSeq.current;
    if (currentId.current !== id) { setView(null); }
    currentId.current = id;
    try { const result = await getGradingWorkflow(id, revision); if (mounted.current && seq === readSeq.current) { apply(result.workflow); setAvailable(true); } }
    catch (error) { if (seq === readSeq.current) fail(error); }
  }, [apply, fail]);
  const refreshList = useCallback(async () => {
    try { const result = await listTeachingWorkflows("grading"); if (mounted.current) { setTasks(result.workflows); setAvailable(true); } }
    catch (error) { fail(error); }
  }, [fail]);
  useEffect(() => {
    if (!active) return;
    void refreshList();
    if (!currentId.current) { let id = ""; try { id = localStorage.getItem(storageKey) || ""; } catch { /* optional */ } if (id) void load(id); }
  }, [active, load, refreshList, storageKey]);
  const hasRunning = tasks.some((t) => running(t.status));
  useEffect(() => {
    if (!active || available === false || !(hasRunning || busy === "create" || busy === "revise" || running(view?.status))) return;
    const timer = window.setInterval(() => { void refreshList(); if (currentId.current && (running(view?.status) || busy === "revise")) void load(currentId.current); }, 3000);
    return () => window.clearInterval(timer);
  }, [active, available, hasRunning, busy, view?.status, refreshList, load]);
  const question = view?.content.questions.find((q) => q.id === questionId);
  useEffect(() => { setPageNumber(question?.bbox?.page || question?.page || 1); setChecked(false); }, [question?.id, question?.bbox?.page, question?.page, view?.id]);
  const start = (name: string) => { if (busyRef.current) return false; busyRef.current = name; setBusy(name); setMessage(""); return true; };
  const finish = () => { busyRef.current = ""; if (mounted.current) setBusy(""); };
  const create = async () => {
    const source = sources.find((s) => s.submissionId === sourceId);
    if (!source || !start("create")) return;
    const request = { studentId: source.studentId, submissionId: source.submissionId, assignmentId: source.assignmentId, title: source.title };
    const signature = JSON.stringify(request);
    if (creation.current?.signature !== signature) creation.current = { signature, key: key() };
    currentId.current = ""; readSeq.current++; setView(null);
    try {
      const result = await createGradingWorkflow(creation.current.key, request);
      if (mounted.current && (!currentId.current || currentId.current === result.workflow.id)) { apply(result.workflow); setRegion("question"); }
      await refreshList();
    } catch (error) { fail(error); } finally { finish(); }
  };
  const command = async (input: Omit<TeachingWorkflowCommand, "operationKey" | "expectedRevision">, revision = view?.revision, clear = false) => {
    if (!view || !revision || !start(input.action)) return;
    const id = view.id; const signature = JSON.stringify({ id, revision, input });
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: key() };
    try {
      const result = await executeGradingWorkflow(id, { ...input, expectedRevision: revision, operationKey: attempt.current.key });
      if (mounted.current && currentId.current === id) { readSeq.current++; apply(result.workflow);
        if (clear) { setEdit(null); setInstruction(""); }
        setMessage(input.action === "confirm" ? "已确认当前题目；归档仍需单独提交。" : "已保存新版本，请核对改动后的题目。"); }
    } catch (error) { fail(error); } finally { finish(); }
  };
  const cancel = async () => {
    if (!view || !running(view.status)) return;
    const id = view.id;
    try { const result = await executeGradingWorkflow(id, { action: "cancel", operationKey: key(), expectedRevision: view.revision });
      if (mounted.current && currentId.current === id) { readSeq.current++; apply(result.workflow); setMessage("本次处理已取消，已保存版本保留。"); } await refreshList();
    } catch (error) { fail(error); }
  };
  const archive = async () => {
    if (!view || !start("archive")) return;
    try { const result = await archiveTeachingGrading(view.id, view.revision); if (mounted.current && currentId.current === view.id) {
      setView((current) => current?.id === result.workflowId && current.revision === result.revision
        ? { ...current, archive: { id: result.id, workflowId: result.workflowId, revision: result.revision, status: "archived" } } : current);
      setMessage("当前确认版本已归档。"); onArchived(); await refreshList();
    } } catch (error) { fail(error); } finally { finish(); }
  };
  const beginEdit = (mode: Edit["mode"]) => {
    if (!view || !question) return;
    setEdit({ id: view.id, revision: view.revision, questionId, mode, answer: text(question.studentAnswer), blank: false,
      status: question.status, score: question.score == null ? "" : String(question.score), explanation: question.explanation || "", knowledgePoint: question.knowledgePoint || "",
      errorStep: question.errorStep || "", suggestedPractice: question.suggestedPractice || "" });
  };
  const dirty = !!edit || !!instruction.trim();
  const writable = available === true && !!view && !busy && !running(view.status) && !["historical", "cancelled"].includes(view.status) && !view.issues.length;
  const editMatches = edit?.id === view?.id && edit?.revision === view?.revision && edit?.questionId === questionId;
  const scoreValid = !!edit && (edit.status === "uncertain" || edit.score.trim() !== "" && Number.isFinite(Number(edit.score)) && Number(edit.score) >= 0 && Number(edit.score) <= (question?.maxScore ?? 0)
    && (edit.status !== "correct" || Number(edit.score) === question?.maxScore) && (edit.status !== "wrong" || Number(edit.score) === 0) && (edit.status !== "partial" || Number(edit.score) > 0 && Number(edit.score) < (question?.maxScore ?? 0)));
  const save = () => {
    if (!edit || !editMatches || !question) return;
    const patch = edit.mode === "recognition" ? { type: "correct_recognition", questionId, value: { studentAnswer: edit.blank ? "" : edit.answer } }
      : { type: "replace_question", questionId, value: { ...question, status: edit.status, score: edit.status === "uncertain" ? null : Number(edit.score),
        explanation: edit.explanation, knowledgePoint: edit.knowledgePoint, errorStep: edit.errorStep, suggestedPractice: edit.suggestedPractice } };
    void command({ action: "revise", targetQuestionIds: [questionId], patch }, edit.revision, true);
  };
  const summary = view?.content.gradingSummary;
  const archived = view ? currentArchive(view) : null;
  const canArchive = writable && !dirty && !!view?.content.questions.length && view.content.questions.every((q) => q.reviewedByTeacher && !dubious(q)) && summary?.confirmedScore != null;
  const shownQuestions = (view?.content.questions || []).filter((q) => !onlyDoubts || dubious(q)).slice().sort((a, b) => Number(dubious(b)) - Number(dubious(a)));
  const pages = view?.content.pages || [];
  const page = pages.find((p) => p.pageNumber === pageNumber);
  return <section className="teaching-workbench panel full grading-continuous" aria-label="持续批改工作台" hidden={!active}>
    <div className="tw-heading"><div><h2>持续批改工作台</h2><p>核对原图与作答，逐题修改和确认；全部确认后单独归档。</p></div><span className="tw-status">{available === null ? "检查服务中" : available ? "服务可用" : "服务暂未启用"}</span></div>
    {available === false && <div className="tw-notice" role="status">持续批改服务暂未启用，原有批改入口仍可使用。<button onClick={onLegacy}>原有批改与来源管理</button><button onClick={() => void refreshList()}>重新检查</button></div>}
    {message && <p className="tw-notice" role="status">{message}</p>}
    <div className="gw-toolbar"><label>已上传批次<select aria-label="已上传批次" value={sourceId} disabled={!!busy || dirty} onChange={(e) => setSourceId(e.target.value)}><option value="">选择已登记的作业</option>{sources.map((s) => <option key={s.submissionId} value={s.submissionId}>{s.studentName} · {s.title}</option>)}</select></label>
      <button className="primary-button" disabled={available !== true || !!busy || dirty || !sourceId} onClick={() => void create()}>{busy === "create" ? "正在准备批改…" : "从此批次开始持续批改"}</button>
      <button className="secondary-button" disabled={!!busy || dirty} onClick={() => { creation.current = null; setMessage("再次开始将新建独立任务，请先核对已有任务。"); }}>按此批次另建任务</button>
      <button className="secondary-button" onClick={onLegacy}>原有批改与来源管理</button></div>
    <p className="muted-line">上传、识别和答案来源登记沿用原入口；没有可靠来源或识别证据的任务会要求补齐。这里不会自动重跑整批图片。</p>
    <div className="gw-task-bar"><label>继续已有任务<select aria-label="继续已有批改任务" value={view?.id || ""} disabled={dirty || !!busy && busy !== "create"} onChange={(e) => { if (e.target.value) void load(e.target.value); }}><option value="">选择任务</option>{tasks.map((t) => <option key={t.id} value={t.id}>{text(t.request.title) || "批改任务"} · 版本 {t.revision} · {reviewLabel(t)}</option>)}</select></label><button className="secondary-button" onClick={() => void refreshList()}>刷新任务列表</button></div>
    {!view ? <p className="tw-empty">选择已上传批次开始，或继续对话中已经保存的批改任务。</p> : <>
      <div className="tw-heading"><h3>{view.content.title || text(view.request.title) || "批改草稿"} · 版本 {view.revision} · {reviewLabel(view)}</h3><button className="secondary-button" disabled={!!busy && busy !== "create"} onClick={() => void load(view.id)}>刷新当前批改</button></div>
      {view.issues.map((i) => <p className="tw-notice" key={i.code}>{i.message}</p>)}
      {running(view.status) && <button onClick={() => void cancel()}>取消本次处理</button>}
      {head.status === "cancelled" && <p className="tw-notice">本任务已取消，保存版本可查看；继续请主动新建任务。</p>}
      <div className="gw-summary"><span>逐题暂计：{summary?.score ?? "待核对"}{summary?.score != null ? ` / ${summary.totalScore ?? "—"}` : ""}</span><span>已确认 {summary?.confirmedCount ?? 0} / {view.content.questions.length} 题</span><span>确认总分：{summary?.confirmedScore ?? "待逐题确认"}</span></div>
      <nav className="gw-mobile-tabs" aria-label="批改工作区域">{[["image", "原图"], ["question", "逐题核对"], ["edit", "修改与归档"]].map(([id, label]) => <button key={id} aria-pressed={region === id} onClick={() => setRegion(id)}>{label}</button>)}</nav>
      <div className="gw-grid" data-region={region}>
        <aside className="gw-original"><h3>作业原图</h3><label>页码<select aria-label="原图页码" value={pageNumber} onChange={(e) => setPageNumber(Number(e.target.value))}>{pages.map((p) => <option key={p.pageNumber} value={p.pageNumber}>第 {p.pageNumber} 页</option>)}</select></label><EvidenceImage page={page} question={question} /></aside>
        <div className="gw-questions"><label className="tw-check"><input type="checkbox" checked={onlyDoubts} disabled={dirty || !!busy} onChange={(e) => setOnlyDoubts(e.target.checked)} />只看疑点题</label>
          <div className="gw-question-picker">{shownQuestions.map((q) => <button key={q.id} disabled={dirty || !!busy} aria-pressed={questionId === q.id} onClick={() => { setQuestionId(q.id); setChecked(false); }}>第 {q.questionNo} 题 · {statuses[q.status]}{q.reviewedByTeacher ? " · 已确认" : ""}</button>)}</div>
          {onlyDoubts && !shownQuestions.length && <p>没有待核对的疑点题。取消筛选可继续逐题确认。</p>}
          {question && <a className="gw-analysis-link" href="#grading-current-question">查看本题题干与作答 ↓</a>}
        </div>
        <aside className="gw-edit"><h3>当前题修改与确认</h3>
          <button className="secondary-button" disabled={!writable || dirty || !question} onClick={() => beginEdit("recognition")}>修正识别并仅重批本题</button>
          <button className="secondary-button" disabled={!writable || dirty || !question || needsRecognitionReview(question)} onClick={() => beginEdit("score")}>手工修正本题评分</button>
          {edit && <><p className="tw-notice">未保存编辑基于版本 {edit.revision}。{!editMatches && "当前版本已变化，文本已保留；请比较后重新编辑。"}</p><fieldset className="tw-editor-lock" disabled={!!busy}>
            {edit.mode === "recognition" ? <><label>核对后的学生作答<textarea aria-label="核对后的学生作答" value={edit.answer} onChange={(e) => setEdit({ ...edit, answer: e.target.value, blank: false })} /></label>{!edit.answer.trim() && <label className="tw-check"><input type="checkbox" checked={edit.blank} onChange={(e) => setEdit({ ...edit, blank: e.target.checked })} />已核对原图，确为空白作答</label>}</> : <>
              <label>本题判定<select aria-label="本题判定" value={edit.status} onChange={(e) => { const status = e.target.value as Edit["status"]; setEdit({ ...edit, status, score: status === "correct" ? String(question?.maxScore ?? "") : status === "wrong" ? "0" : status === "uncertain" ? "" : edit.score }); }}>{Object.entries(statuses).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
              <label>本题得分<input aria-label="本题得分" type="number" min={0} max={question?.maxScore ?? 0} step="any" disabled={edit.status === "uncertain"} value={edit.score} onChange={(e) => setEdit({ ...edit, score: e.target.value })} /></label>
              {([['explanation', '评分依据与解析'], ['knowledgePoint', '知识点'], ['errorStep', '错因定位'], ['suggestedPractice', '后续练习']] as const).map(([field, label]) => <label key={field}>{label}<textarea aria-label={label} value={edit[field]} onChange={(e) => setEdit({ ...edit, [field]: e.target.value })} /></label>)}
            </>}
          </fieldset><button className="primary-button" disabled={!writable || !editMatches || (edit.mode === "recognition" ? !edit.answer.trim() && !edit.blank : !scoreValid || !edit.explanation.trim() || !edit.knowledgePoint.trim())} onClick={save}>{edit.mode === "recognition" ? "保存识别修正并重批本题" : "保存本题评分草稿"}</button><button className="secondary-button" disabled={!!busy} onClick={() => setEdit(null)}>放弃本地修改</button></>}
          <label>本题重判要求<textarea aria-label="本题重判要求" disabled={!!busy || !!edit} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="例如：学生换了计算方法，请结合过程核对是否合理。" /></label>
          <button className="primary-button" disabled={!writable || !!edit || !instruction.trim() || !question || needsRecognitionReview(question)} onClick={() => void command({ action: "revise", targetQuestionIds: [questionId], instruction }, view.revision, true)}>按要求仅重判本题</button>
          <label className="tw-check"><input type="checkbox" checked={checked} disabled={!writable || dirty || !question || dubious(question)} onChange={(e) => setChecked(e.target.checked)} />我已核对当前题的作答、得分和解析</label>
          <button className="secondary-button" disabled={!writable || dirty || !checked || !question || dubious(question)} onClick={() => void command({ action: "confirm", targetQuestionIds: [questionId] })}>确认当前题目</button>
          <h3>版本与归档</h3><label>历史版本<input aria-label="批改历史版本" type="number" min={1} max={head.revision} value={history} onChange={(e) => setHistory(Number(e.target.value))} /></label>
          <button className="secondary-button" disabled={!!busy || dirty || !Number.isSafeInteger(history) || history < 1 || history > head.revision} onClick={() => void load(view.id, history)}>查看批改历史版本</button>
          {view.status === "historical" && <><p>历史内容只读；恢复会新增版本，不覆盖已归档记录。</p><button className="secondary-button" disabled={!!busy || dirty || head.status === "cancelled"} onClick={() => void command({ action: "restore", restoreRevision: view.revision }, head.revision)}>恢复批改为新版本</button></>}
          <p>只确认已检查的当前题。全部确认后，由服务端再次校验来源、图片证据和权限。</p><button className="primary-button" disabled={!canArchive || archived?.workflowId === view.id && archived.revision === view.revision} onClick={() => void archive()}>归档当前确认版本</button>
          {archived?.workflowId === view.id && <p role="status">版本 {archived.revision} 已归档。后续修改需要重新确认并另行归档。</p>}
        </aside>
      </div>
      {question && <article className="gw-question-detail" id="grading-current-question" aria-label="本题题干与学生作答"><h3>第 {question.questionNo} 题 · 题干与学生作答</h3><h4>题干</h4><p>{question.printedPrompt || question.prompt || "缺少题干"}</p><h4>学生作答</h4><p>{question.studentAnswer == null ? "尚未可靠识别，不能按空白计零分" : question.studentAnswer === "" ? "已识别为空白作答" : text(question.studentAnswer)}</p>
        <small>{question.recognitionCorrectedByTeacher ? "识别文字已由教师校正" : "请对照原图核对识别文字"}{question.confidence != null ? ` · 原识别置信度 ${Math.round(question.confidence * 100)}%` : ""}</small>
        <h4>本题得分：{statuses[question.status]} · {question.score ?? "待核对"} / {question.maxScore ?? "—"}</h4>
        <a className="gw-analysis-link" href="#grading-current-analysis">查看本题评分与解析 ↓</a>
      </article>}
      {question && <section className="gw-analysis" id="grading-current-analysis" aria-label="本题评分与解析">
        <header className="gw-analysis-heading"><h3>第 {question.questionNo} 题 · 评分与解析</h3><span>{question.reviewedByTeacher ? "教师已确认" : "待教师复核"} · {question.score ?? "待核对"} / {question.maxScore ?? "—"}</span></header>
        <div className="gw-analysis-section"><h4>可信参考答案与评分依据</h4><p>{text(question.correctAnswer) || "尚无可靠答案来源"}</p><p>{text(question.rubric) || "评分依据请在原来源中核对"}</p></div>
        <div className="gw-analysis-section"><h4>评分依据与解析</h4><p>{question.explanation || "暂无解析，请核对作答与评分依据。"}</p></div>
        <div className="gw-analysis-section"><h4>考点</h4><p>{question.knowledgePoint || "待补齐"}</p></div>
        {question.errorStep && <div className="gw-analysis-section"><h4>错因定位</h4><p>{question.errorStep}</p></div>}
        {question.suggestedPractice && <div className="gw-analysis-section"><h4>后续练习</h4><p>{question.suggestedPractice}</p></div>}
      </section>}
    </>}
  </section>;
}
