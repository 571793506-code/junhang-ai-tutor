import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(process.argv[2] || process.env.JH_MINIAPP_TARGET || "C:\\Users\\86188\\WeChatProjects\\miniapp-1");
const ignoredDirs = new Set(["node_modules", "miniprogram_npm"]);
const providerNeedles = ["DeepSeek", "MiniMax", "minimax", "deepseek", "gpt", "GPT"];
const encodingMarkerFixtureFiles = new Set(["utils/encodingGuard.js"]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) walk(fullPath, files);
      continue;
    }
    if (entry.isFile() && /\.(js|json|wxml|wxss)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

function relative(filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

const failures = [];

if (!fs.existsSync(root)) {
  failures.push({ type: "project", message: `miniapp-1 not found: ${root}` });
} else {
  const files = walk(root);
  const projectConfigPath = path.join(root, "project.config.json");
  const appJsonPath = path.join(root, "app.json");

  let projectConfig = null;
  let appJson = null;

  try {
    projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, "utf8"));
  } catch (error) {
    failures.push({ type: "json", file: relative(projectConfigPath), message: error.message });
  }

  try {
    appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
  } catch (error) {
    failures.push({ type: "json", file: relative(appJsonPath), message: error.message });
  }

  if (projectConfig?.projectArchitecture !== "multiPlatform") {
    failures.push({ type: "config", file: "project.config.json", message: "projectArchitecture must remain multiPlatform" });
  }

  for (const file of files.filter((item) => item.endsWith(".js"))) {
    try {
      new vm.Script(fs.readFileSync(file, "utf8"), { filename: file });
    } catch (error) {
      failures.push({ type: "js", file: relative(file), message: error.message });
    }
  }

  for (const file of files.filter((item) => item.endsWith(".json"))) {
    try {
      JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      failures.push({ type: "json", file: relative(file), message: error.message });
    }
  }

  for (const page of appJson?.pages || []) {
    for (const ext of [".js", ".wxml", ".wxss", ".json"]) {
      const pageFile = path.join(root, `${page}${ext}`);
      if (!fs.existsSync(pageFile)) failures.push({ type: "page", file: `${page}${ext}`, message: "page file missing" });
    }
  }

  const assessmentPagePath = path.join(root, "pages/teacher/assessments/index.js");
  if (fs.existsSync(assessmentPagePath)) {
    const source = fs.readFileSync(assessmentPagePath, "utf8");
    if (source.includes("试卷式排版")) {
      failures.push({
        type: "generation-boundary",
        file: relative(assessmentPagePath),
        message: "assessment page must not append the old exam-style layout prompt; submit kind, subject, grade, difficulty, requirement, and pages to the service layer"
      });
    }
  }

  const apiUtilPath = path.join(root, "utils/api.js");
  if (fs.existsSync(apiUtilPath)) {
    const source = fs.readFileSync(apiUtilPath, "utf8");
    const requiredApiNeedles = [
      "/api/ai/vocabulary",
      "/api/classroom/devices/",
      "/api/content/index/rebuild",
      "/api/grading/workbench",
      "/api/students/${studentId}/profile/draft",
      "getStudentProfile",
      "listGradingWorkbenches",
      "updateGradingWorkbenchQuestion",
      "archiveGradingWorkbench",
      "draftStudentProfile"
    ];
    for (const needle of requiredApiNeedles) {
      if (!source.includes(needle)) {
        failures.push({
          type: "api-contract",
          file: relative(apiUtilPath),
          message: `missing miniprogram API wrapper: ${needle}`
        });
      }
    }
  }

  const contentPageJsPath = path.join(root, "pages/teacher/content/index.js");
  const contentPageWxmlPath = path.join(root, "pages/teacher/content/index.wxml");
  if (fs.existsSync(contentPageJsPath) && fs.existsSync(contentPageWxmlPath)) {
    const jsSource = fs.readFileSync(contentPageJsPath, "utf8");
    const wxmlSource = fs.readFileSync(contentPageWxmlPath, "utf8");
    const requiredContentNeedles = [
      { source: jsSource, needle: "rebuildContentIndex", message: "teacher content page must call service-layer content index rebuild API" },
      { source: jsSource, needle: "exports/markdown-ingestion", message: "teacher content page must use the standard markdown ingestion source directory" },
      { source: jsSource, needle: "exports/content-index", message: "teacher content page must use the standard content index output directory" },
      { source: wxmlSource, needle: "bindtap=\"rebuildContentIndex\"", message: "teacher content page must expose a content index rebuild action" }
    ];
    for (const item of requiredContentNeedles) {
      if (!item.source.includes(item.needle)) {
        failures.push({
          type: "content-index",
          file: item.source === jsSource ? relative(contentPageJsPath) : relative(contentPageWxmlPath),
          message: item.message
        });
      }
    }
  }

  const studentProfileJsPath = path.join(root, "pages/student/profile/index.js");
  const studentProfileWxmlPath = path.join(root, "pages/student/profile/index.wxml");
  if (fs.existsSync(studentProfileJsPath) && fs.existsSync(studentProfileWxmlPath)) {
    const jsSource = fs.readFileSync(studentProfileJsPath, "utf8");
    const wxmlSource = fs.readFileSync(studentProfileWxmlPath, "utf8");
    const requiredStudentProfileNeedles = [
      { source: jsSource, needle: "getStudentProfile", message: "student profile page must use the dedicated profile API instead of bootstrap-only data" },
      { source: jsSource, needle: "publishedProfileText", message: "student profile page must handle teacher-published profile text" },
      { source: jsSource, needle: "unresolvedMistakes", message: "student profile page must use unresolved mistakes from profile API" },
      { source: wxmlSource, needle: "publishedProfileText", message: "student profile page must show teacher-published feedback when available" },
      { source: wxmlSource, needle: "未发布", message: "student profile page must show unpublished feedback empty state" }
    ];
    for (const item of requiredStudentProfileNeedles) {
      if (!item.source.includes(item.needle)) {
        failures.push({
          type: "student-profile",
          file: item.source === jsSource ? relative(studentProfileJsPath) : relative(studentProfileWxmlPath),
          message: item.message
        });
      }
    }
  }

  const gradingDetailJsPath = path.join(root, "pages/teacher/grading-detail/index.js");
  const gradingDetailWxmlPath = path.join(root, "pages/teacher/grading-detail/index.wxml");
  if (fs.existsSync(gradingDetailJsPath) && fs.existsSync(gradingDetailWxmlPath)) {
    const jsSource = fs.readFileSync(gradingDetailJsPath, "utf8");
    const wxmlSource = fs.readFileSync(gradingDetailWxmlPath, "utf8");
    const requiredDetailNeedles = [
      { source: jsSource, needle: "archiveGradingWorkbench", message: "grading detail page must call service-layer archive API" },
      { source: jsSource, needle: "submitArchive", message: "grading detail page must expose teacher archive submit handler" },
      { source: wxmlSource, needle: "bindtap=\"submitArchive\"", message: "grading detail page must provide teacher archive button" },
      { source: wxmlSource, needle: "bindinput=\"setReviewScore\"", message: "grading detail page must require teacher score input before low-confidence archive" },
      { source: wxmlSource, needle: "bindinput=\"setReviewNote\"", message: "grading detail page must allow teacher review note input" },
      { source: jsSource, needle: "updateGradingWorkbenchQuestion", message: "grading detail page must call service-layer question review API" },
      { source: jsSource, needle: "submitQuestionReview", message: "grading detail page must expose teacher question review submit handler" },
      { source: wxmlSource, needle: "bindtap=\"startQuestionReview\"", message: "grading detail page must let teacher select a question to review" },
      { source: wxmlSource, needle: "bindtap=\"submitQuestionReview\"", message: "grading detail page must provide teacher question review button" }
    ];
    for (const item of requiredDetailNeedles) {
      if (!item.source.includes(item.needle)) {
        failures.push({
          type: "grading-review",
          file: item.source === jsSource ? relative(gradingDetailJsPath) : relative(gradingDetailWxmlPath),
          message: item.message
        });
      }
    }
  }

  for (const file of files) {
    const fileName = relative(file);
    const source = fs.readFileSync(file, "utf8");
    for (const needle of providerNeedles) {
      if (source.includes(needle)) {
        failures.push({ type: "provider-leak", file: fileName, message: `contains ${needle}` });
      }
    }
    if (!encodingMarkerFixtureFiles.has(fileName) && /�|锟斤拷|鐨|涓|乱码/.test(source)) {
      failures.push({ type: "encoding", file: fileName, message: "contains suspicious mojibake marker" });
    }
  }

  console.log(JSON.stringify({
    ok: failures.length === 0,
    root,
    architecture: projectConfig?.projectArchitecture || null,
    appid: projectConfig?.appid || null,
    checkedFiles: files.length,
    failures
  }, null, 2));
}

if (failures.length) process.exitCode = 1;
