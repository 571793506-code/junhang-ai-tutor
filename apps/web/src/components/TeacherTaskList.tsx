import { useState } from "react";
import type { LearningTaskCard, StudentProfile } from "@junhang/core";

function taskDay(task: LearningTaskCard) {
  const value = task.dueAt || task.createdAt;
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function TeacherTaskList({ tasks, students, studentId }: { tasks: LearningTaskCard[]; students: StudentProfile[]; studentId: string }) {
  const [scope, setScope] = useState("selected");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("");
  const [paging, setPaging] = useState({ filter: "", page: 0 });
  const filter = `${scope}:${studentId}:${date}:${status}`;
  const filtered = tasks.filter((task) => (scope === "all" || task.studentId === studentId) && (!date || taskDay(task) === date) && (!status || task.status === status))
    .sort((a, b) => taskDay(b).localeCompare(taskDay(a)));
  const lastPage = Math.max(0, Math.ceil(filtered.length / 10) - 1);
  const currentPage = Math.min(paging.filter === filter ? paging.page : 0, lastPage);
  const selectedName = students.find((student) => student.id === studentId)?.displayName || "未选择学生";
  return <div className="teacher-task-list">
    <div className="template-controls">
      <label>查看范围<select aria-label="任务学生范围" value={scope} onChange={(e) => setScope(e.target.value)}><option value="selected">当前学生：{selectedName}</option><option value="all">全部学生</option></select></label>
      <label>任务日期<input aria-label="任务日期" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>完成状态<select aria-label="任务完成状态" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option>{["待完成", "进行中", "已完成", "需复核"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <button className="secondary-button" onClick={() => { setScope("selected"); setDate(""); setStatus(""); }}>重置筛选</button>
    </div>
    <p className="muted-line">共 {filtered.length} 项 · 按任务日期从近到远展示。历史记录缺少日期时标为“日期未记录”，不归入指定日期。</p>
    <div className="record-list">{filtered.slice(currentPage * 10, currentPage * 10 + 10).map((task) => <details className="daily-task-card ui-disclosure" key={task.id}>
      <summary><strong>{task.title}</strong><span>{task.studentName} · {task.subject} · {taskDay(task) || "日期未记录"} · {task.minutes}分钟</span><b>{task.status}</b></summary>
      <p className="preserve-lines">{task.description || task.summary || "暂无具体任务说明"}</p>
      {!!task.knowledgePoints?.length && <p className="muted-line">知识点：{task.knowledgePoints.join(" / ")}</p>}
    </details>)}{!filtered.length && <p className="review-empty">当前条件下没有任务，可调整学生、日期或完成状态。</p>}</div>
    {filtered.length > 10 && <div className="button-row"><button className="secondary-button" disabled={currentPage === 0} onClick={() => setPaging({ filter, page: currentPage - 1 })}>上一页</button><span>第 {currentPage + 1} / {lastPage + 1} 页</span><button className="secondary-button" disabled={currentPage === lastPage} onClick={() => setPaging({ filter, page: currentPage + 1 })}>下一页</button></div>}
  </div>;
}
