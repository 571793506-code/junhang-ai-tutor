const replacements = [
  ["鑻辫", "英语"],
  ["璇枃", "语文"],
  ["鏁板", "数学"],
  ["缁冧範", "练习"],
  ["璇曞嵎", "试卷"],
  ["鍥剧墖", "图片"],
  ["鎻愪氦", "提交"],
  ["涓婁紶", "上传"],
  ["缃戠粶璇锋眰澶辫触", "网络请求失败"],
  ["鍥剧墖涓婁紶澶辫触", "图片上传失败"],
  ["闇€澶嶆牳", "需复核"],
  ["寰呭畬鎴?", "待完成"],
  ["杩涜涓?", "进行中"],
  ["宸插畬鎴?", "已完成"],
  ["宸叉彁浜?", "已提交"],
  ["宸叉壒鏀?", "已批改"]
];

function normalizeText(value) {
  let text = String(value == null ? "" : value);
  replacements.forEach(([bad, good]) => {
    text = text.split(bad).join(good);
  });
  return text
    .replace(/锟斤拷/g, "")
    .replace(/锛\?/g, "：")
    .replace(/绗\?/g, "第")
    .replace(/椤\?/g, "页")
    .replace(/�/g, "");
}

function normalizePayload(value) {
  if (typeof value === "string") return normalizeText(value);
  if (Array.isArray(value)) return value.map((item) => normalizePayload(item));
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).reduce((result, key) => {
    result[normalizeText(key)] = normalizePayload(value[key]);
    return result;
  }, {});
}

module.exports = {
  normalizeText,
  normalizePayload
};
