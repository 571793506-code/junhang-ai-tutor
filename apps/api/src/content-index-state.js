export function summarizeContentIndexState(index = {}) {
  const documents = Array.isArray(index?.documents) ? index.documents : [];
  const available = documents.length > 0;
  return {
    available,
    documentCount: documents.length,
    documents,
    reason: available ? null : "CONTENT_INDEX_NO_MARKDOWN_DOCUMENTS"
  };
}

export function isNoMarkdownDocumentsError(error) {
  return [error?.stderr, error?.stdout, error?.message]
    .filter(Boolean)
    .some((value) => String(value).includes("CONTENT_INDEX_NO_MARKDOWN_DOCUMENTS"));
}
