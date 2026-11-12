import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeGradeLevel } from "@junhang/core";
import type { AssignmentCard, StudentProfile } from "@junhang/core";
import { listGradingCollections, type GradingCollectionRecord, type uploadSubmission } from "../api";
import { createRequestKey } from "../request-key";

type UploadInput = { studentId: string; subject: AssignmentCard["subject"]; kind: string; title: string; images: File[];
  assignmentId: string; collectionBatchId: string; collectionTitle: string; materialType: "generated_assessment" };
type Batch = { id: string; assignmentId: string; title: string };
const level = (grade?: string | null) => normalizeGradeLevel(grade)?.level || 0;
const emptyFiles: File[] = [];
function readBatch(key: string): Batch | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value && typeof value.id === "string" && value.id.trim() && value.id.length <= 120 &&
      typeof value.assignmentId === "string" && value.assignmentId.trim() &&
      typeof value.title === "string" ? value : null;
  } catch { return null; }
}

export function GradingCollection({ teacherId, students, assignments, initialAssignmentId, active, onUpload, onRefreshMaterials, renderPicker }: {
  teacherId: string; students: StudentProfile[]; assignments: AssignmentCard[]; initialAssignmentId?: string; active: boolean;
  onUpload: (input: UploadInput) => Promise<Awaited<ReturnType<typeof uploadSubmission>> | undefined>;
  onRefreshMaterials: () => void | Promise<unknown>;
  renderPicker: (files: File[], setFiles: React.Dispatch<React.SetStateAction<File[]>>) => React.ReactNode;
}) {
  const storageKey = `junhang.grading-collection.v1.${teacherId}`;
  const [batch, setBatch] = useState<Batch | null>(() => readBatch(storageKey));
  const [grade, setGrade] = useState(() => level(students.find(s => s.canReceiveNewWork)?.grade));
  const [subject, setSubject] = useState("数学");
  const [kind, setKind] = useState("练习");
  const [assignmentId, setAssignmentId] = useState(batch?.assignmentId || "");
  const [title, setTitle] = useState(batch?.title || "");
  const [studentId, setStudentId] = useState("");
  const [mode, setMode] = useState("multiple");
  const [drafts, setDrafts] = useState<Record<string, File[]>>({});
  const [records, setRecords] = useState<GradingCollectionRecord[]>([]);
  const [capped, setCapped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyReady, setHistoryReady] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const inFlight = useRef(false);
  const refreshVersion = useRef(0);
  const entryApplied = useRef("");
  const eligible = assignments.filter(a => a.gradingEligible === true);
  const source = eligible.find(a => a.id === assignmentId && level(a.targetGrade) === grade);
  const hasDrafts = Object.values(drafts).some(files => files.length > 0);
  const locked = Boolean(batch) || hasDrafts || busy;
  const roster = students.filter(s => s.canReceiveNewWork && level(s.grade) === grade && (!source?.studentId || s.id === source.studentId));
  const selectedStudent = roster.find(s => s.id === studentId);
  const files = drafts[studentId] || emptyFiles;
  const submitted = records.filter(r => r.batchId === batch?.id);
  const currentRecord = submitted.find(r => r.studentId === studentId);
  const choices = eligible.filter(a => level(a.targetGrade) === grade && a.subject === subject && a.kind === kind);
  const batches = [...new Map(records.map(record => [record.batchId, record])).values()];
  const setFiles: React.Dispatch<React.SetStateAction<File[]>> = action => setDrafts(current => ({ ...current,
    [studentId]: typeof action === "function" ? action(current[studentId] || []) : action }));
  const previews = useMemo(() => files.map(file => URL.createObjectURL(file)), [files]);
  useEffect(() => () => previews.forEach(url => URL.revokeObjectURL(url)), [previews]);
  const refresh = useCallback(async (batchId = batch?.id) => {
    const version = ++refreshVersion.current;
    setLoading(true); setHistoryReady(false);
    try {
      // A restored batch may be older than the recent-history window.
      const [recent, exact] = await Promise.all([listGradingCollections(), batchId ? listGradingCollections(batchId) : null]);
      if (version !== refreshVersion.current) return;
      setRecords([...new Map([...recent.submissions, ...(exact?.submissions || [])].map(r => [r.submissionId, r])).values()]);
      setCapped(recent.capped || Boolean(exact?.capped)); setHistoryError(""); setHistoryReady(true);
    } catch (e) { if (version === refreshVersion.current) setHistoryError(e instanceof Error ? e.message : String(e)); }
    finally { if (version === refreshVersion.current) setLoading(false); }
  }, [batch?.id]);
  useEffect(() => { if (active) void refresh(); }, [active, refresh]);
  useEffect(() => () => { refreshVersion.current++; }, []);
  useEffect(() => {
    if (!hasDrafts) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDrafts]);
  useEffect(() => {
    try { if (batch) localStorage.setItem(storageKey, JSON.stringify(batch)); else localStorage.removeItem(storageKey); } catch { /* Server history remains authoritative. */ }
  }, [batch, storageKey]);
  useEffect(() => {
    const a = assignments.find(item => item.id === (batch?.assignmentId || initialAssignmentId));
    if (!a || (!batch && (!a.gradingEligible || !initialAssignmentId || entryApplied.current === initialAssignmentId || hasDrafts))) return;
    setGrade(level(a.targetGrade)); setSubject(a.subject); setKind(a.kind); setAssignmentId(a.id);
    if (!batch) { setTitle(`${a.title} · ${new Date().toLocaleDateString()}`); entryApplied.current = initialAssignmentId || ""; }
  }, [assignments, batch?.assignmentId, initialAssignmentId, hasDrafts]);
  useEffect(() => {
    if (!roster.some(s => s.id === studentId)) setStudentId("");
  }, [roster.map(s => s.id).join("|"), studentId]);
  function newBatch() {
    if (hasDrafts || busy) return;
    entryApplied.current = "";
    setBatch(null); setStudentId(""); setMessage(""); setError("");
  }
  function openBatch(record: GradingCollectionRecord) {
    if (hasDrafts || busy) return;
    setBatch({ id: record.batchId, assignmentId: record.assignmentId, title: record.title }); setTitle(record.title); setAssignmentId(record.assignmentId);
    setMessage("已恢复批次，已提交的学生不会重复上传。");
  }
  async function upload() {
    if (inFlight.current || !source || !selectedStudent || !files.length || currentRecord || loading || !historyReady) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const currentBatch = batch || { id: `batch-${createRequestKey()}`, assignmentId: source.id, title: title.trim() || source.title };
      setBatch(currentBatch);
      const result = await onUpload({ studentId: selectedStudent.id, subject: source.subject, kind: source.kind,
        title: `${currentBatch.title} · ${selectedStudent.displayName}`, images: files, assignmentId: source.id,
        collectionBatchId: currentBatch.id, collectionTitle: currentBatch.title, materialType: "generated_assessment" });
      if (!result?.ok || !result.result.persisted?.submissionId) throw new Error("未收到有效提交回执，请保留照片并重试当前批次。");
      refreshVersion.current++;
      const record: GradingCollectionRecord = { batchId: currentBatch.id, title: currentBatch.title, assignmentId: source.id,
        studentId: selectedStudent.id, submissionId: result.result.persisted.submissionId, imageCount: files.length,
        status: result.result.structured?.persistedStatus || "SUBMITTED", submittedAt: new Date().toISOString() };
      setRecords(current => [...current.filter(r => r.submissionId !== record.submissionId), record]);
      setDrafts(current => ({ ...current, [selectedStudent.id]: [] }));
      const done = new Set([...submitted.map(r => r.studentId), selectedStudent.id]);
      const index = roster.findIndex(s => s.id === selectedStudent.id);
      const next = mode === "multiple" ? [...roster.slice(index + 1), ...roster.slice(0, index)].find(s => !done.has(s.id)) : undefined;
      if (next) setStudentId(next.id);
      setMessage(`${selectedStudent.displayName}的 ${files.length} 页已独立提交${mode === "single" ? "，已保留当前学生" : next ? `，请为${next.displayName}采集照片` : "，本名单已全部提交"}。批改结果仍需教师复核和独立归档。`);
      void refresh(currentBatch.id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="grading-collection" aria-label="同卷多人采集">
    <div className="collection-heading"><div><h3>系统生成材料批改</h3><p>先选年级与材料，再明确选择学生。单人和多人均独立保存作答，共用已认可材料的答案包。</p></div>
      <button className="secondary-button" disabled={busy || loading} onClick={async () => {
        try { await onRefreshMaterials(); await refresh(); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      }} type="button">刷新材料与批次</button></div>
    {batch && initialAssignmentId && initialAssignmentId !== batch.assignmentId ? <p className="context-note">已保留上次采集批次。本次打开的是另一份材料；请先上传待传照片，再点击“新建另一批次”切换到该材料。</p> : null}
    <label className="field-label">批改人数模式<select value={mode} disabled={busy} onChange={e => setMode(e.target.value)}><option value="single">单人批改</option><option value="multiple">同卷多人批改</option></select></label>
    <p className="muted-line">{mode === "single" ? "上传后停留在当前学生，便于单独核对。" : "上传后自动选中下一位未提交学生，便于连续采集。"}切换模式会保留已选学生和待传照片。</p>
    <div className="template-controls">
      <label>采集年级<select value={grade} disabled={locked} onChange={e => { setGrade(Number(e.target.value)); setAssignmentId(""); }}>
        <option value={0}>请选择年级</option>{[...new Set(students.filter(s => s.canReceiveNewWork).map(s => level(s.grade)))].filter(Boolean).sort().map(n => <option key={n} value={n}>{normalizeGradeLevel(n)?.label || `${n}年级`}</option>)}</select></label>
      <label>采集科目<select value={subject} disabled={locked} onChange={e => { setSubject(e.target.value); setAssignmentId(""); }}>{["语文", "数学", "英语"].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>采集类型<select value={kind} disabled={locked} onChange={e => { setKind(e.target.value); setAssignmentId(""); }}>{["练习", "小测", "试卷", "作业", "听写"].map(k => <option key={k}>{k}</option>)}</select></label>
    </div>
    <label className="field-label">本批次试卷<select value={assignmentId} disabled={locked} onChange={e => { const a = choices.find(a => a.id === e.target.value); setAssignmentId(e.target.value); setTitle(a ? `${a.title} · ${new Date().toLocaleDateString()}` : ""); }}>
      <option value="">请选择教师已认可的同年级材料</option>{choices.map(a => <option key={a.id} value={a.id}>{a.title} · {a.gradingSourceQuestionCount || a.items.length}题{a.studentId ? " · 指定学生" : ""}</option>)}</select></label>
    {!choices.length ? <p className="context-note">本年级暂无符合条件的材料。对话生成材料需在审查后明确回复认可，再同步到这里。</p> : null}
    {batch && !source ? <p className="context-note blocked">该批次材料当前不可用，原提交仍保留。请刷新并核对材料状态。</p> : null}
    <div className="template-controls"><label>采集批次名称<input value={title} disabled={locked} onChange={e => setTitle(e.target.value)} placeholder="例如：四年级数学周测 11月11日" /></label>
      <button className="secondary-button" type="button" disabled={hasDrafts || busy} onClick={newBatch}>新建另一批次</button>
      <label>继续已有批次<select value={batch?.id || ""} disabled={hasDrafts || busy} onChange={e => { const record = records.find(r => r.batchId === e.target.value); if (record) openBatch(record); }}><option value="">选择已保存的采集批次</option>{batches.map(r => <option key={r.batchId} value={r.batchId}>{r.title} · {new Date(r.submittedAt).toLocaleDateString()}</option>)}</select></label>
    </div>
    <p className="muted-line">{batch ? `本批次已提交 ${submitted.length} 位学生。` : "首次上传时建立新批次。"}切换学生会保留本页尚未提交的照片；刷新前请先上传，照片不会缓存在浏览器中。修改已提交作答请新建批次，保留原记录。</p>
    {capped ? <p className="context-note">此列表仅展示最近200条提交；当前批次另行读取。</p> : null}
    <div hidden={mode !== "multiple"}><div className="collection-roster" aria-label="采集学生名单">{roster.map(s => <button key={s.id} aria-pressed={studentId === s.id} className={studentId === s.id ? "primary-button" : "secondary-button"} disabled={busy} onClick={() => setStudentId(s.id)} type="button"><strong>{s.displayName}</strong><span>{submitted.some(r => r.studentId === s.id) ? "已提交" : drafts[s.id]?.length ? `待上传 ${drafts[s.id].length} 页` : "待采集"}</span></button>)}</div></div>
    {mode === "single" ? <label className="field-label">批改学生<select value={studentId} disabled={busy} onChange={e => setStudentId(e.target.value)}><option value="">请明确选择学生</option>{roster.map(s => <option key={s.id} value={s.id}>{s.displayName}{submitted.some(r => r.studentId === s.id) ? " · 已提交" : drafts[s.id]?.length ? ` · 待上传 ${drafts[s.id].length} 页` : ""}</option>)}</select></label> : null}
    {roster.length && !selectedStudent ? <p className="context-note">请先点选学生，再加入该学生的作答照片。</p> : null}
    {!roster.length ? <p>该年级暂无可采集学生。</p> : null}
    {selectedStudent ? <div className="collection-current"><h4>当前学生：{selectedStudent.displayName}</h4>
      {currentRecord ? <p role="status">已提交 {currentRecord.imageCount} 页。请在持续批改中复核{mode === "multiple" ? "，或选择下一位学生" : "；再次提交该学生的新作答请新建批次"}。</p> : null}
      <fieldset disabled={busy}>
        {!currentRecord && source ? renderPicker(files, setFiles) : null}
        <ol className="collection-pages">{files.map((file, index) => <li key={`${index}-${file.name}`}><img src={previews[index]} alt={`待上传第${index + 1}页`} /><span>第{index + 1}页 · {file.name}</span>
          <button type="button" className="secondary-button" disabled={index === 0} onClick={() => setFiles(current => { const copy = [...current]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; return copy; })}>前移</button>
          <button type="button" className="secondary-button" onClick={() => setFiles(current => current.filter((_, i) => i !== index))}>移除</button></li>)}</ol>
        {!currentRecord ? <button className="primary-button" disabled={!files.length || !source || busy || loading || !historyReady} onClick={() => void upload()} type="button">{busy ? "正在上传" : mode === "single" ? "上传该学生作答" : "上传该学生并切换下一位"}</button> : null}
      </fieldset>
    </div> : null}
    {loading ? <p role="status">正在核对已保存的批次…</p> : null}
    {message ? <p role="status">{message}</p> : null}{error || historyError ? <p role="alert" className="context-note blocked">{error || historyError} 待上传照片会保留在当前页面。</p> : null}
  </section>;
}
