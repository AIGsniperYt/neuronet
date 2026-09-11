// Wrapper around the vendored Mozilla pdf.js build (v6.3.289).
// Exposes getDocument + GlobalWorkerOptions so the scraper can extract text
// from exam-board PDF fact sheets. The worker file is same-origin, so the
// module worker spawns without any bundler or CDN setup.
//
// We use the LEGACY build: the modern build requires APIs Node.js does not
// provide (Node runs the canonical ingestion pipeline against real PDFs in
// tests/examdata_live.mjs). The legacy build is the pdf.js-recommended entry
// for Node environments and stays API-identical in the browser.
export * from "./pdf.legacy.min.mjs";