import fs from "node:fs";
import path from "node:path";
import multer from "multer";

const uploadRoot = path.resolve(process.cwd(), "storage", "uploads");
const generatedRoot = path.resolve(process.cwd(), "storage", "generated");

export function storageUploadRoot() {
  return uploadRoot;
}

export function storageGeneratedRoot() {
  return generatedRoot;
}

export function publicUploadUrl(fileName, request) {
  if (!fileName) return null;
  const origin = request ? `${request.protocol}://${request.get("host")}` : "";
  const safePath = String(fileName).split("/").map((part) => encodeURIComponent(part)).join("/");
  return `${origin}/uploads/${safePath}`;
}

export function publicGeneratedUrl(fileName, request) {
  if (!fileName) return null;
  const origin = request ? `${request.protocol}://${request.get("host")}` : "";
  return `${origin}/generated/${encodeURIComponent(fileName)}`;
}

function todayFolder() {
  return new Date().toISOString().slice(0, 10);
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    const dir = path.join(uploadRoot, todayFolder());
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const safeName = file.originalname
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "");
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName || "upload"}`);
  }
});

export const submissionImageUpload = multer({
  storage,
  limits: {
    fileSize: 30 * 1024 * 1024
  }
});

export const teachingMaterialUpload = multer({
  storage,
  limits: {
    fileSize: 80 * 1024 * 1024,
    files: 8
  }
});

export function uploadedFileMeta(files = []) {
  return files.map((file) => ({
    fieldName: file.fieldname,
    originalName: file.originalname,
    fileName: file.filename,
    mimeType: file.mimetype,
    size: file.size,
    path: file.path,
    relativePath: path.relative(uploadRoot, file.path).split(path.sep).join("/"),
    url: publicUploadUrl(path.relative(uploadRoot, file.path).split(path.sep).join("/"))
  }));
}
