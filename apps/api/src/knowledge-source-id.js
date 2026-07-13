import { createHash } from "node:crypto";

function sourceIdentity(document = {}) {
  return String(
    document.relativeMarkdownPath
      || document.markdownPath
      || document.sourcePath
      || document.title
      || "unnamed-source"
  ).replace(/\\/g, "/");
}

export function stableKnowledgeSourceId(document = {}) {
  const digest = createHash("sha256").update(sourceIdentity(document)).digest("hex").slice(0, 40);
  return `ks_${digest}`;
}

export async function resolveKnowledgeSourceId(prisma, document = {}) {
  const markdownPath = document.relativeMarkdownPath || document.markdownPath || null;
  const sourcePath = document.sourcePath || null;
  const where = markdownPath ? { markdownPath } : sourcePath ? { sourcePath } : null;
  if (where) {
    const existing = await prisma.knowledgeSource.findFirst({ where, select: { id: true } });
    if (existing?.id) return existing.id;
  }
  return stableKnowledgeSourceId(document);
}
