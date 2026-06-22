const mojibakeTextReplacements = [
  ["鑻辫", "英语"],
  ["璇枃", "语文"],
  ["鏁板", "数学"],
  ["缁冧範", "练习"],
  ["璇曞嵎", "试卷"],
  ["灏忔祴", "小测"],
  ["浣滀笟", "作业"],
  ["鍥剧墖", "图片"],
  ["鎻愪氦", "提交"],
  ["涓婁紶", "上传"],
  ["鎵规敼", "批改"],
  ["璁板綍", "记录"],
  ["鍩虹", "基础"],
  ["鎻愰珮", "提高"],
  ["鍥伴毦", "困难"],
  ["鎸囧畾鏃ユ湡", "指定日期"],
  ["浠婃棩", "今日"],
  ["濮撳悕", "姓名"],
  ["鏃ユ湡", "日期"],
  ["寰楀垎", "得分"],
  ["涓昏鑰佸笀", "主讲老师"],
  ["鍔╂暀", "助教"],
  ["绠＄悊鍛?", "管理员"],
  ["AI鐢熸垚", "AI生成"],
  ["鏁欏笀", "教师"],
  ["瀛︾敓", "学生"],
  ["瀹堕暱", "家长"],
  ["鐢ㄨВ鏋?", "用解析"],
  ["澶嶆牳", "复核"],
  ["瑙ｆ瀽", "解析"],
  ["绛旀", "答案"],
  ["鑰冪偣", "考点"],
  ["鏈懆", "本周"],
  ["鏈湀", "本月"],
  ["鏈熶腑", "期中"],
  ["鏈熸湯", "期末"],
  ["娴嬭瘯", "测试"],
  ["鏆傚仠", "暂停"],
  ["鍦ㄨ", "在读"],
  ["闇€澶嶆牳", "需复核"],
  ["寰呭畬鎴?", "待完成"],
  ["杩涜涓?", "进行中"],
  ["宸插畬鎴?", "已完成"],
  ["宸叉彁浜?", "已提交"],
  ["宸叉壒鏀?", "已批改"],
  ["宸叉帉鎻?", "已掌握"],
  ["寰呰姝?", "待订正"],
  ["澶嶄範涓?", "复习中"],
  ["寰呭紑閫?", "待开通"],
  ["宸插紑閫?", "已开通"],
  ["宸插仠鐢?", "已停用"],
  ["寰呯粦瀹?", "待绑定"],
  ["宸茬粦瀹?", "已绑定"],
  ["寰呮挱鎶?", "待播报"],
  ["宸叉挱鎶?", "已播报"],
  ["宸插綊妗?", "已归档"],
  ["寰呭紑濮?", "待开始"],
  ["寰呰窡璇?", "待跟读"],
  ["璺熻涓?", "跟读中"],
  ["缃戠粶璇锋眰澶辫触", "网络请求失败"],
  ["鍥剧墖涓婁紶澶辫触", "图片上传失败"],
  ["宸查€€璇?", "已退课"],
  ["鏈帉鎻?", "未掌握"],
  ["鎺屾彙涓嶇ǔ", "掌握不稳"],
  ["闇€宸╁浐", "需巩固"]
];

const suspiciousPattern = /(?:[鑻璇鏁缁鍩鎻鍥鎸浠婃棩濮寰涓昏鐢熸垚澶嶆牳瑙绛旈鏈闇宸呮帉鍚鏂骞啓闃熷垪嵁浠嬭瘝]|锟斤拷|锛\?|绗\?|椤\?|�|��|�{2,}|\?{3,})/;

export function normalizeDisplayText(value) {
  let text = String(value ?? "");
  const colonCount = (text.match(/：/g) || []).length;
  if (colonCount > 6 && colonCount > text.length * 0.25) {
    text = text.replace(/：/g, "");
  }
  for (const [bad, good] of mojibakeTextReplacements) {
    text = text.split(bad).join(good);
  }
  return text
    .replace(/锟斤拷/g, "")
    .replace(/锛\?/g, "：")
    .replace(/绗\?/g, "第")
    .replace(/椤\?/g, "页")
    .replace(/�/g, "");
}

export function normalizeDisplayPayload(value) {
  if (typeof value === "string") return normalizeDisplayText(value);
  if (Array.isArray(value)) return value.map((item) => normalizeDisplayPayload(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      normalizeDisplayText(key),
      normalizeDisplayPayload(item)
    ])
  );
}

export function inspectEncodingPayload(value, options = {}) {
  const maxIssues = Number(options.maxIssues || 100);
  const issues = [];
  const visit = (item, path = "$") => {
    if (issues.length >= maxIssues) return;
    if (typeof item === "string") {
      const normalized = normalizeDisplayText(item);
      if (normalized !== item || suspiciousPattern.test(item)) {
        issues.push({
          path,
          value: item.slice(0, 160),
          normalized: normalized.slice(0, 160),
          changed: normalized !== item
        });
      }
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (suspiciousPattern.test(key) || normalizeDisplayText(key) !== key) {
        issues.push({
          path: `${path}.${key}`,
          value: key.slice(0, 160),
          normalized: normalizeDisplayText(key).slice(0, 160),
          changed: true,
          key: true
        });
      }
      visit(child, `${path}.${key}`);
    }
  };
  visit(value);
  return {
    ok: issues.length === 0,
    issueCount: issues.length,
    issues
  };
}

export function encodingGuardStatus(value) {
  const report = inspectEncodingPayload(value, { maxIssues: 20 });
  return {
    ok: report.ok,
    issueCount: report.issueCount,
    checkedAt: new Date().toISOString()
  };
}
