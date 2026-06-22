import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@junhang/db";

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function decodeBase64url(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function secret(config) {
  return config.SESSION_SECRET || config.ACCESS_CODE_PEPPER || "junhang-local-session-secret";
}

function sign(value, config) {
  return createHmac("sha256", secret(config)).update(value).digest("base64url");
}

export function createSessionToken(config, payload, ttlSeconds = 60 * 60 * 24 * 14) {
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
    jti: randomUUID()
  };
  const encoded = base64url(JSON.stringify(body));
  return `${encoded}.${sign(encoded, config)}`;
}

export function verifySessionToken(config, token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded, config);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length) return null;
  if (!timingSafeEqual(expectedBuffer, signatureBuffer)) return null;

  const payload = JSON.parse(decodeBase64url(encoded));
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return null;
  return payload;
}

export function readBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] || null;
}

export function requireSession(config, allowedRoles = []) {
  return async (req, res, next) => {
    const session = verifySessionToken(config, readBearerToken(req));
    if (!session) {
      return res.status(401).json({
        ok: false,
        error: "SESSION_REQUIRED",
        message: "登录已失效，请重新登录。"
      });
    }
    if (allowedRoles.length && !allowedRoles.includes(session.role)) {
      return res.status(403).json({
        ok: false,
        error: "SESSION_FORBIDDEN",
        message: "当前账号无权执行该操作。"
      });
    }
    if (session.role === "student") {
      const students = await prisma.$queryRaw`
        SELECT "currentSessionJti", "loginEnabled"
        FROM "Student"
        WHERE "id" = ${session.studentId}
        LIMIT 1
      `;
      const student = students[0];
      if (!student || !student.loginEnabled) {
        return res.status(401).json({
          ok: false,
          error: "STUDENT_ACCESS_DISABLED",
          message: "学生端登录权限已关闭，请联系老师。"
        });
      }
      if (student.currentSessionJti && student.currentSessionJti !== session.jti) {
        return res.status(401).json({
          ok: false,
          error: "SESSION_REPLACED",
          message: "该学生账号已在其他设备登录，本设备已自动退出。"
        });
      }
    }
    req.session = session;
    next();
  };
}
