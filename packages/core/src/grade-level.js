const CHINESE_GRADES = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

function gradeNumber(value) {
  const text = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!text) return null;
  if (/高中|大学|幼儿园/.test(text)) return null;
  const chinese = text.match(/([一二三四五六七八九])年级?/);
  if (chinese) return CHINESE_GRADES[chinese[1]];
  const junior = text.match(/初([一二三])/);
  if (junior) return CHINESE_GRADES[junior[1]] + 6;
  const numeric = text.match(/(?:^|[^0-9])([1-9])(?:年级)?(?:上册|下册)?$/);
  return numeric ? Number(numeric[1]) : null;
}

export function normalizeGradeLevel(value) {
  const level = gradeNumber(value);
  if (!level || level < 1 || level > 9) return null;
  return {
    level,
    stage: level >= 7 ? "middle" : "primary",
    label: `${Object.entries(CHINESE_GRADES).find(([, number]) => number === level)?.[0] || level}年级`
  };
}

export function gradeLevelLabel(value) {
  return normalizeGradeLevel(value)?.label || "";
}
