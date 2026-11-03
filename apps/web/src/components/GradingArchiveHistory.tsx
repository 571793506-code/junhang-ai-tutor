import { useEffect, useState } from "react";
import { getGradingWorkbench, listGradingWorkbenches, teachingImageUrl, type GradingWorkbench } from "../api";

const statuses = { correct: "正确", wrong: "错误", partial: "部分正确", uncertain: "待核对" };
const dateLabel = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("zh-CN") : "未记录";

function Scores({ record }: { record: GradingWorkbench }) {
  return <div className="gw-summary">{record.scoreGroups?.length ? record.scoreGroups.map(group =>
    <strong key={group.id}>{group.label}：{group.score ?? "待核对"} / {group.maxScore}</strong>
  ) : <strong>总分：{record.score ?? "未记录"}</strong>}</div>;
}

export function GradingArchiveHistory({ active }: { active: boolean }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState({ search: "", page: 1 });
  const [refresh, setRefresh] = useState(0);
  const [list, setList] = useState<Awaited<ReturnType<typeof listGradingWorkbenches>> | null>(null);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get("gradingArchive") || "");
  const [record, setRecord] = useState<GradingWorkbench | null>(null);
  const [detailError, setDetailError] = useState("");
  const [questionId, setQuestionId] = useState("");

  useEffect(() => {
    if (!active) return;
    const url = new URL(window.location.href);
    url.searchParams.set("gradingArchive", selectedId);
    window.history.replaceState(null, "", url);
  }, [active, selectedId]);

  useEffect(() => {
    if (!active) return;
    let current = true;
    setList(null); setListError("");
    listGradingWorkbenches({ ...query, pageSize: 20, reviewState: "archived" }).then(result => {
      if (!current) return;
      if (result.reviewState !== "archived") {
        setListError("当前服务尚未支持归档历史，请更新服务后重试。"); return;
      }
      setList(result);
    }).catch(() => { if (current) setListError("归档列表加载失败，请稍后重试。"); });
    return () => { current = false; };
  }, [active, query, refresh]);

  useEffect(() => {
    if (!active || !selectedId) return;
    let current = true;
    setRecord(null); setDetailError(""); setQuestionId("");
    getGradingWorkbench(selectedId).then(result => {
      if (!current) return;
      if (!result.workbench.archivedAt || result.workbench.status !== "archived") {
        setDetailError("此记录尚未完成独立归档，请在待复核工作台处理。"); return;
      }
      const questions = [...result.workbench.questions].sort((a, b) => String(a.questionNo).localeCompare(String(b.questionNo), "zh-CN", { numeric: true }));
      setRecord({ ...result.workbench, questions });
      setQuestionId(questions[0]?.id || "");
    }).catch(() => { if (current) setDetailError("归档详情加载失败或无权查看，请刷新重试。"); });
    return () => { current = false; };
  }, [active, selectedId, refresh]);

  const detail = record?.submissionId === selectedId ? record : null;
  const question = detail?.questions.find(item => item.id === questionId);
  return <section className="panel full teaching-workbench grading-history" hidden={!active} aria-label="已归档批改记录">
    <div className="tw-heading"><div><h2>已归档记录</h2><p>查看教师最终评分、逐题记录和原卷。此处仅供查阅。</p></div><span className="tw-status">只读</span></div>
    <form className="gw-toolbar" onSubmit={event => { event.preventDefault(); setSelectedId(""); setQuery({ search: search.trim(), page: 1 }); }}>
      <label>检索归档记录<input value={search} onChange={event => setSearch(event.target.value)} placeholder="学生姓名或试卷标题" /></label>
      <button className="primary-button" type="submit">查询</button>
      <button className="secondary-button" type="button" onClick={() => setRefresh(value => value + 1)}>刷新记录</button>
    </form>
    <div className="gh-grid">
      <aside aria-label="归档列表">
        {listError ? <p className="tw-notice" role="alert">{listError}</p> : !list ? <p role="status">正在读取归档记录…</p> : <>
          <p>已找到 {list.pagination.total} 份{list.pagination.capped ? "（仅检索最近500次已评分提交）" : ""}</p>
          {!list.workbenches.length && <p className="tw-empty">没有找到已归档记录。</p>}
          <div className="tw-task-list">{list.workbenches.map(item => <button type="button" key={item.submissionId}
            className={selectedId === item.submissionId ? "selected" : ""} aria-pressed={selectedId === item.submissionId} onClick={() => setSelectedId(item.submissionId)}>
            <strong>{item.studentName} · {item.title}</strong><small>{item.subject} · {item.kind} · {dateLabel(item.archivedAt)}</small><Scores record={item} />
          </button>)}</div>
          <div className="button-row">
            <button type="button" className="secondary-button" disabled={query.page <= 1} onClick={() => setQuery(value => ({ ...value, page: value.page - 1 }))}>上一页</button>
            <span>{list.pagination.page} / {list.pagination.totalPages} 页</span>
            <button type="button" className="secondary-button" disabled={!list.pagination.hasMore} onClick={() => setQuery(value => ({ ...value, page: value.page + 1 }))}>下一页</button>
          </div>
        </>}
      </aside>
      <div aria-label="归档详情" aria-live="polite">
        {!selectedId ? <p className="tw-empty">选择一份归档记录查看。</p> : detailError ? <p className="tw-notice" role="alert">{detailError}</p> : !detail ? <p role="status">正在读取归档详情…</p> : <>
          <h3>教师最终评分</h3><p>{detail.studentName} · {detail.title}</p><Scores record={detail} />
          <p className="muted-line">归档时间：{dateLabel(detail.archivedAt)} · 提交时间：{dateLabel(detail.submittedAt)}</p>
          <p>共 {detail.questions.length} 题；教师已确认 {detail.questions.filter(item => item.reviewedByTeacher).length} 题；
            错误或部分正确 {detail.questions.filter(item => item.status === "wrong" || item.status === "partial").length} 题。</p>
          <nav className="gw-question-picker" aria-label="查看归档题目">{detail.questions.map(item => <button type="button" key={item.id}
            aria-pressed={questionId === item.id} onClick={() => setQuestionId(item.id)}>第 {item.questionNo} 题 · {statuses[item.status]}</button>)}</nav>
          {question && <article className="gw-question-detail" aria-label={`第${question.questionNo}题归档详情`}>
            <h3>第 {question.questionNo} 题 · {statuses[question.status]} · {question.score ?? "未记录"} / {question.maxScore ?? "未记录"} 分</h3>
            <h4>题目</h4><p>{question.prompt || "未提供题干"}</p>
            <h4>学生作答</h4><p>{question.studentAnswer || "未提供可读转写，请查看原卷与教师备注。"}</p>
            {!!question.studentProcess?.length && <p>{question.studentProcess.join("\n")}</p>}
            <h4>参考答案</h4><p>{question.correctAnswer || "未提供"}</p>
            <h4>答案解析</h4><p>{question.explanation || "未提供"}</p>
            {question.errorStep && <><h4>错因记录</h4><p>{question.errorStep}</p></>}
            {question.knowledgePoint && <p>知识点：{question.knowledgePoint}</p>}
            {question.teacherNote && <><h4>教师备注</h4><p>{question.teacherNote}</p></>}
          </article>}
          {!detail.questions.length && <p className="tw-notice">本记录没有可展示的逐题明细。</p>}
          <details className="gh-originals"><summary>查看原卷（{detail.pages.filter(item => item.imageUrl).length} 页）</summary>
            {detail.pages.filter(item => item.imageUrl).map(item => <ArchiveImage key={item.id} page={item} />)}
            {!detail.pages.some(item => item.imageUrl) && <p>本记录未保留原卷图片。</p>}
          </details>
        </>}
      </div>
    </div>
  </section>;
}

function ArchiveImage({ page }: { page: GradingWorkbench["pages"][number] }) {
  const url = teachingImageUrl(page.imageUrl);
  const [broken, setBroken] = useState("");
  return <div className="gw-evidence gh-image">{!url || broken === url ? <p className="tw-notice">第 {page.pageNumber} 页原图暂不可用。</p> : <>
    <a href={url} target="_blank" rel="noreferrer">打开第 {page.pageNumber} 页原图</a>
    <img src={url} loading="lazy" alt={`归档原卷第 ${page.pageNumber} 页`} onError={() => setBroken(url)} />
  </>}</div>;
}
