const mathChapterDraftCatalog = {
  "三年级-上册": [["第一单元", "时、分、秒"], ["第二单元", "万以内的加法和减法（一）"], ["第三单元", "测量"], ["第四单元", "万以内的加法和减法（二）"], ["第五单元", "倍的认识"], ["第六单元", "多位数乘一位数"], ["第七单元", "长方形和正方形"], ["第八单元", "分数的初步认识"], ["第九单元", "数学广角：集合"], ["第十单元", "总复习"]],
  "三年级-下册": [["第一单元", "位置与方向（一）"], ["第二单元", "除数是一位数的除法"], ["第三单元", "复式统计表"], ["第四单元", "两位数乘两位数"], ["第五单元", "面积"], ["第六单元", "年、月、日"], ["第七单元", "小数的初步认识"], ["第八单元", "数学广角：搭配（二）"], ["第九单元", "总复习"]],
  "四年级-上册": [["第一单元", "大数的认识"], ["第二单元", "公顷和平方千米"], ["第三单元", "角的度量"], ["第四单元", "三位数乘两位数"], ["第五单元", "平行四边形和梯形"], ["第六单元", "除数是两位数的除法"], ["第七单元", "条形统计图"], ["第八单元", "数学广角：优化"], ["第九单元", "总复习"]],
  "四年级-下册": [["第一单元", "四则运算"], ["第二单元", "观察物体（二）"], ["第三单元", "运算定律"], ["第四单元", "小数的意义和性质"], ["第五单元", "三角形"], ["第六单元", "小数的加法和减法"], ["第七单元", "图形的运动（二）"], ["第八单元", "平均数与条形统计图"], ["第九单元", "数学广角：鸡兔同笼"], ["第十单元", "总复习"]],
  "五年级-上册": [["第一单元", "小数乘法"], ["第二单元", "位置"], ["第三单元", "小数除法"], ["第四单元", "可能性"], ["第五单元", "简易方程"], ["第六单元", "多边形的面积"], ["第七单元", "数学广角：植树问题"], ["第八单元", "总复习"]],
  "五年级-下册": [["第一单元", "观察物体（三）"], ["第二单元", "因数与倍数"], ["第三单元", "长方体和正方体"], ["第四单元", "分数的意义和性质"], ["第五单元", "图形的运动（三）"], ["第六单元", "分数的加法和减法"], ["第七单元", "折线统计图"], ["第八单元", "数学广角：找次品"], ["第九单元", "总复习"]],
  "六年级-上册": [["第一单元", "分数乘法"], ["第二单元", "位置与方向（二）"], ["第三单元", "分数除法"], ["第四单元", "比"], ["第五单元", "圆"], ["第六单元", "百分数（一）"], ["第七单元", "扇形统计图"], ["第八单元", "数学广角：数与形"], ["第九单元", "总复习"]],
  "六年级-下册": [["第一单元", "负数"], ["第二单元", "百分数（二）"], ["第三单元", "圆柱与圆锥"], ["第四单元", "比例"], ["第五单元", "数学广角：鸽巢问题"], ["第六单元", "整理和复习"]]
};

function chapterDraftKey(chapter = {}) {
  return String(chapter.unit || chapter.title || "").trim().toLowerCase().replace(/\s+/g, "");
}

function chapter(asset, unit, title, index, extras = {}) {
  return {
    id: `${asset.id}-unit-${index + 1}`,
    unit,
    title,
    pageStart: null,
    pageEnd: null,
    focusItems: extras.focusItems || [],
    dictationItems: extras.dictationItems || [],
    readingSupport: extras.readingSupport || "章节目录草案需由教师结合当前教材目录核对；仅用于确认生成范围。"
  };
}

export function chapterDraftsForTextbookAsset(asset = {}) {
  const mathChapters = asset.subject === "数学" ? mathChapterDraftCatalog[`${asset.grade}-${asset.volume}`] : null;
  if (mathChapters) return mathChapters.map(([unit, title], index) => chapter(asset, unit, title, index));
  if (asset.subject === "英语") {
    return Array.from({ length: 6 }, (_, index) => {
      const unit = `Unit ${index + 1}`;
      return chapter(asset, unit, `${unit} 预习与跟读`, index, {
        focusItems: ["新单词", "重点句型", "课本音频跟读"],
        dictationItems: [`请从${unit}课本词汇表核对后补充单词`]
      });
    });
  }
  if (asset.subject === "语文") {
    return Array.from({ length: 8 }, (_, index) => {
      const unit = `第${["一", "二", "三", "四", "五", "六", "七", "八"][index]}单元`;
      return chapter(asset, unit, `${unit} 课文学习`, index, {
        focusItems: ["难字词", "重点句", "朗读节奏"],
        dictationItems: [`请从${unit}课后生字词核对后补充词语`]
      });
    });
  }
  return [];
}

export function mergeTextbookChapterDrafts(asset = {}, existingChapters = []) {
  const existing = Array.isArray(existingChapters) ? existingChapters : [];
  const drafts = chapterDraftsForTextbookAsset(asset);
  if (!existing.length || !drafts.length) return existing.length ? existing : drafts;
  const existingKeys = new Set(existing.map(chapterDraftKey).filter(Boolean));
  return [...existing, ...drafts.filter((item) => !existingKeys.has(chapterDraftKey(item)))];
}
