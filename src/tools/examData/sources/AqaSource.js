// AQA's verified acquisition path currently lives in ../boundaries.js, where
// official archive links are fetched and PDF rows are parsed from actual bytes.
// Keep this module's historical adapter surface, but fail closed until the
// general ExamDataSource contract has a real AQA XLSX/PDF implementation.

export const AQA_HOST = "https://filestore.aqa.org.uk";
export const AQA_FILE_BASE = `${AQA_HOST}/over/stat_pdf`;
export const AQA_PAGE_BASE = "https://www.aqa.org.uk/exams-administration/results-days/grade-boundaries";
export const AQA_PAGE_ARCHIVE = `${AQA_PAGE_BASE}/archive`;

export async function discover() {
  return {
    resources: [],
    incomplete: true,
    metadataUnknown: 0,
    reason: "SOURCE_ADAPTER_NOT_IMPLEMENTED"
  };
}

export async function fetchSource(resource) {
  return {
    ok: false,
    reason: "SOURCE_ADAPTER_NOT_IMPLEMENTED",
    url: resource && resource.url || null
  };
}

export async function parseSource() {
  return { ok: false, reason: "SOURCE_ADAPTER_NOT_IMPLEMENTED", rows: [], problems: [] };
}
