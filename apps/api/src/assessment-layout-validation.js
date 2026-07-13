function pageCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.round(count) : null;
}

export function assessmentPageBalanceFillRatio(input = {}) {
  const pageTotal = pageCount(input.pageCount) || 1;
  const itemCount = Number(input.itemCount || 0);
  const subject = String(input.subject || "");
  const kind = String(input.kind || "");
  if (pageTotal === 2 && subject.includes("英语") && kind.includes("小测") && itemCount <= 12) {
    return 0.72;
  }
  return 0.5;
}

export function buildAssessmentLayoutValidation(input = {}) {
  const plannedPageCount = pageCount(input.plannedPageCount);
  const htmlPageCount = pageCount(input.htmlPageCount);
  const pdfPageCount = pageCount(input.pdfPageCount);
  const measuredPageCount = pageCount(input.measuredPageCount);
  const pdfGenerated = input.pdfGenerated === true;
  const measurementOk = input.measurementOk === true;
  const pageMetrics = Array.isArray(input.pageMetrics) ? input.pageMetrics : [];
  const isEnglishQuiz = String(input.subject || "").includes("英语") && String(input.kind || "").includes("小测");
  const issues = [];

  if (!plannedPageCount) {
    issues.push("缺少目标页数，无法确认 PDF 排版。");
  }
  if (!htmlPageCount) {
    issues.push("无法读取 HTML 预分页页数。");
  } else if (plannedPageCount && htmlPageCount !== plannedPageCount) {
    issues.push(`HTML 预分页页数 ${htmlPageCount} 与目标页数 ${plannedPageCount} 不一致。`);
  }
  if (!pdfGenerated || !pdfPageCount) {
    issues.push("无法读取 PDF 实际页数。");
  } else if (plannedPageCount && pdfPageCount !== plannedPageCount) {
    issues.push(`PDF 实际页数 ${pdfPageCount} 与目标页数 ${plannedPageCount} 不一致。`);
  }
  if (!measurementOk) {
    issues.push("浏览器布局测量失败，无法确认题目坐标与页面留白。");
  }
  if (measuredPageCount && plannedPageCount && measuredPageCount !== plannedPageCount) {
    issues.push(`浏览器测量页数 ${measuredPageCount} 与目标页数 ${plannedPageCount} 不一致。`);
  }
  if (isEnglishQuiz) {
    for (let index = 0; index < Math.max(0, pageMetrics.length - 1); index += 1) {
      const blankMm = Number(pageMetrics[index]?.bottomBlankMm || 0);
      if (blankMm >= 120) {
        issues.push(`第 ${index + 1} 页后续仍有内容，但本页底部留白 ${blankMm.toFixed(1)}mm，疑似预分页和真实分页脱节。`);
      }
    }
  }
  const finalMetric = pageMetrics[pageMetrics.length - 1] || {};
  const finalBlankMm = Number(finalMetric.bottomBlankMm || 0);
  if (isEnglishQuiz && finalBlankMm >= 125) {
    issues.push(`末页底部留白 ${finalBlankMm.toFixed(1)}mm，疑似题量或作答区分配不足。`);
  }

  const ok = issues.length === 0;
  return {
    version: "assessment-layout-validation-v1",
    ok,
    coordinateManifestValid: ok && measurementOk,
    plannedPageCount,
    htmlPageCount,
    pdfPageCount,
    measuredPageCount,
    pdfGenerated,
    measurementOk,
    pageMetrics,
    issues
  };
}
