import { prisma } from "@junhang/db";

let cached = null;

export async function checkDatabaseStatus({ force = false } = {}) {
  const now = Date.now();
  if (!force && cached && now - cached.checkedAtMs < 2500) return cached;

  if (!process.env.DATABASE_URL) {
    cached = {
      ok: false,
      checkedAt: new Date().toISOString(),
      checkedAtMs: now,
      reason: "DATABASE_URL is not configured"
    };
    return cached;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    cached = {
      ok: true,
      checkedAt: new Date().toISOString(),
      checkedAtMs: now,
      reason: "connected"
    };
  } catch (error) {
    cached = {
      ok: false,
      checkedAt: new Date().toISOString(),
      checkedAtMs: now,
      reason: error instanceof Error ? error.message : String(error)
    };
  }

  return cached;
}

export async function requireDatabase(req, res, next) {
  const status = await checkDatabaseStatus();
  if (!status.ok) {
    return res.status(503).json({
      ok: false,
      error: "DATABASE_UNAVAILABLE",
      message: "数据库当前不可用，真实落库操作暂时不能执行。",
      database: status
    });
  }
  next();
}

export async function persistenceOptions(input = {}) {
  if (input.persist === false) {
    return {
      options: { persist: false },
      persistence: { requested: false, active: false, reason: "request disabled persistence" }
    };
  }

  const database = await checkDatabaseStatus();
  return {
    options: { persist: database.ok },
    persistence: {
      requested: true,
      active: database.ok,
      reason: database.ok ? "database connected" : database.reason
    }
  };
}
