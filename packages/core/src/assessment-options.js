const optionText = (value) => typeof value === "string" && value.trim() && !/\[object\s+Object\]/i.test(value);

// Convert only an explicit label/text pair. Never infer a missing label or drop
// an invalid option: either action could silently change the correct answer.
export function normalizeAssessmentOptions(value) {
  const options = typeof value === "string" ? value.split(/\n|；|;/) : value;
  if (!Array.isArray(options)) return [];
  const normalized = [];
  for (const option of options) {
    if (optionText(option)) { normalized.push(option.trim()); continue; }
    if (!option || typeof option !== "object" || Array.isArray(option) ||
      typeof option.label !== "string" || !/^[A-Z]$/.test(option.label.trim()) || !optionText(option.text)) return [];
    const label = option.label.trim();
    const text = option.text.trim();
    const prefix = text.match(/^([A-Z])[.．、:：)）]\s*/);
    if (prefix && prefix[1] !== label) return [];
    normalized.push(prefix ? text : `${label}. ${text}`);
  }
  return normalized;
}

export function assessmentChoiceOptionsValid(options) {
  return Array.isArray(options) && options.length >= 2 && options.every(optionText);
}
