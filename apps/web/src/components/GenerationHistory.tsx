import { useState } from "react";
import type { AssignmentCard, StudentProfile } from "@junhang/core";
import type { AssessmentGenerationJob } from "../api";

const processing = (status: string) => ["queued", "generating", "exporting_draft", "cancelling"].includes(status);
const jobLabels: Record<string, string> = { queued: "排队中", generating: "生成中", exporting_draft: "准备草稿文件", cancelling: "取消中", ready_for_review: "待审查", failed: "生成失败", cancelled: "已取消" };
const reviewLabel = (item: AssignmentCard) => item.draftReviewStatus === "accepted" ? "教师已确认" : item.draftReviewStatus === "rejected" ? "已否决" : "待教师审查";

export function GenerationHistory({ assignments, jobs, students, printAssets, onCancel, onRefresh }: {
  assignments: AssignmentCard[]; jobs: AssessmentGenerationJob[]; students: StudentProfile[];
  printAssets: { id: string; title: string; url: string }[];
  onCancel: (id: string) => void; onRefresh: () => Promise<void>;
}) {
  const [studentId, setStudentId] = useState("");
  const [grade, setGrade] = useState("");
  const [subject, setSubject] = useState("");
  const [state, setState] = useState("all");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const matches = (title: string, target: string, itemGrade: string, itemSubject: string, itemStudent: string | null) =>
    (!studentId || studentId === itemStudent) && (!grade || grade === itemGrade) && (!subject || subject === itemSubject)
    && `${title} ${target}`.toLowerCase().includes(search.trim().toLowerCase());
  const rows = assignments.filter(item => matches(item.title, item.studentName || "", item.targetGrade || "", item.subject, item.studentId)
    && (state === "all" || (state === "pending" && item.draftReviewStatus !== "accepted" && item.draftReviewStatus !== "rejected")
      || (state === "accepted" && item.draftReviewStatus === "accepted") || (state === "rejected" && item.draftReviewStatus === "rejected")
      || (state === "exported" && Boolean(item.finalExportAssets?.studentPaper || item.finalExportAssets?.answerAnalysis))));
  const assignmentIds = new Set(assignments.map(item => item.id));
  const pendingJobs = jobs.filter(job => (!job.assignmentId || !assignmentIds.has(job.assignmentId))
    && matches(job.title, job.targetLabel || "", String(job.request.targetGrade || ""), job.subject, String(job.request.studentId || ""))
    && (state === "all" || (state === "processing" && processing(job.status)) || (state === "pending" && job.status === "ready_for_review")
      || (state === "rejected" && ["failed", "cancelled"].includes(job.status))));
  const linkedAssets = new Set(assignments.flatMap(item => [item.draftReviewAsset?.id, item.finalExportAssets?.studentPaper?.id, item.finalExportAssets?.answerAnalysis?.id]).filter(Boolean));
  const otherAssets = printAssets.filter(asset => !linkedAssets.has(asset.id));
  const grades = [...new Set([...students.map(s => s.grade), ...assignments.map(a => a.targetGrade || ""), ...jobs.map(j => String(j.request.targetGrade || ""))].filter(Boolean))];
  return <section className="panel full generation-history" aria-label="历史生成材料">
    <div className="tw-heading"><div><h2>历史生成材料与打印记录</h2><p>查看已保存材料、题目和文件。新建、修改及教师确认请前往“生成与继续修改”。</p></div>
      <button className="secondary-button" disabled={refreshing} onClick={async () => {
        setRefreshing(true); setNotice("");
        try { await onRefresh(); setNotice("材料记录已刷新。"); } catch { setNotice("刷新未完成，请稍后重试，已有记录仍可查看。"); }
        finally { setRefreshing(false); }
      }}>刷新材料记录</button></div>
    {notice && <p role="status">{notice}</p>}
    <div className="generation-history-filters" aria-label="生成记录筛选">
      <label>年级<select value={grade} onChange={e => setGrade(e.target.value)}><option value="">全部年级</option>{grades.map(g => <option key={g}>{g}</option>)}</select></label>
      <label>学生<select value={studentId} onChange={e => setStudentId(e.target.value)}><option value="">全部学生</option>{students.map(s => <option key={s.id} value={s.id}>{s.displayName} · {s.grade}</option>)}</select></label>
      <label>科目<select value={subject} onChange={e => setSubject(e.target.value)}><option value="">全部科目</option>{["语文", "数学", "英语"].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>状态<select value={state} onChange={e => setState(e.target.value)}>{[["all", "全部记录"], ["pending", "待审查"], ["accepted", "教师已确认"], ["processing", "生成中"], ["exported", "已导出"], ["rejected", "失败/否决"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>搜索<input value={search} onChange={e => setSearch(e.target.value)} placeholder="学生姓名或材料标题" /></label>
    </div>
    <p className="muted-line">当前显示 {rows.length} 份材料、{pendingJobs.length} 项生成记录。草稿和已确认材料分别标记，查看不会改变复核状态。</p>
    <div className="generation-history-list">
      {rows.map(item => <details className="generation-history-record" key={item.id}>
        <summary><strong>{item.title}</strong><span>{item.targetGrade || "年级未记录"} · {item.studentName || "年级材料"} · {item.subject} · {item.kind}</span><span>{reviewLabel(item)} · {item.finalExportAssets?.studentPaper || item.finalExportAssets?.answerAnalysis ? "已有正式文件" : "未正式导出"}</span></summary>
        <div className="generation-history-details">
          <dl><div><dt>题量 / 总分</dt><dd>{item.gradingSourceQuestionCount || item.audit?.itemCount || item.items.length} 题 / {item.totalScore} 分</dd></div>
            <div><dt>难度</dt><dd>{item.difficulty || "未记录"}</dd></div>
            <div><dt>批改来源</dt><dd>{item.gradingEligible ? "可供批改选择" : "尚不可供批改选择"}</dd></div>
            <div><dt>打印检查</dt><dd>{item.layoutValidation ? item.layoutValidation.ok ? "通过" : "待调整" : "未记录"}</dd></div></dl>
          {item.draftRequest?.requirement && <div><h3>教师要求</h3><p>{item.draftRequest.requirement}</p></div>}
          {item.generationContextSummary && <p>教学范围：{[item.generationContextSummary.textbook?.title, item.generationContextSummary.textbook?.chapterTitle, ...(item.generationContextSummary.knowledgePoints || [])].filter(Boolean).join(" · ") || "按教师要求"}</p>}
          {item.draftReviewFeedback && <p>复核记录：{item.draftReviewFeedback}</p>}
          <div className="button-row">
            {item.draftReviewAsset && <a className="draft-pdf-link" href={item.draftReviewAsset.url} target="_blank" rel="noreferrer">查看草稿 PDF</a>}
            {item.finalExportAssets?.studentPaper && <a className="draft-pdf-link" href={item.finalExportAssets.studentPaper.url} target="_blank" rel="noreferrer">学生卷 PDF</a>}
            {item.finalExportAssets?.answerAnalysis && <a className="draft-pdf-link" href={item.finalExportAssets.answerAnalysis.url} target="_blank" rel="noreferrer">答案解析 PDF</a>}
          </div>
          {item.items.length ? <div><h3>题目预览</h3><ol>{item.items.map((prompt, index) => <li key={index}>{prompt}</li>)}</ol></div> : <p>暂无可预览题目，请查看已有文件。</p>}
        </div>
      </details>)}
      {pendingJobs.map(job => <div className="generation-history-record generation-history-job" key={job.id}>
        <strong>{job.title}</strong><span>{job.subject} · {job.targetLabel || "对象未记录"} · {jobLabels[job.status] || "待核对"}</span><p>{job.message}</p>
        {job.draftAsset && <a className="draft-pdf-link" href={job.draftAsset.url} target="_blank" rel="noreferrer">查看草稿 PDF</a>}
        {processing(job.status) && <button className="secondary-button" disabled={job.status === "cancelling"} onClick={() => onCancel(job.id)}>取消本次生成</button>}
      </div>)}
      {!rows.length && !pendingJobs.length && <p className="review-empty">暂无符合条件的材料记录。</p>}
    </div>
    {otherAssets.length > 0 && <details className="generation-history-record"><summary>其他打印文件（{otherAssets.length}）<span>尚未关联到材料的已保存文件，不参与上方筛选</span></summary><div className="print-asset-list">{otherAssets.map(asset => <a key={asset.id} href={asset.url} target="_blank" rel="noreferrer">{asset.title}</a>)}</div></details>}
  </section>;
}
