// examData/sources/PearsonSource.js — verified Pearson/Edexcel source catalogue.
//
// Every entry below: URL confirmed HTTP 200 + application/pdf + %PDF magic
// bytes + content sha-256, and the subject table it carries (verified
// separately). `verifiedAt` is the date of that verification. Nothing here is
// a guess.
//
// Runtime acquisition for the tracker does NOT use this list: it goes through
// ingest.js → ../boundaries.js, which downloads and re-verifies the official
// document itself. This catalogue is the known-series baseline for the
// scraper's Pearson discovery (gradeBoundaries.js PEARSON_VERIFIED) and for
// subjects.js, which fetches the newest verified PDF to enumerate subjects.

const PEARSON_DAM = "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries";

export const VERIFIED_CATALOGUE = Object.freeze([
  {
    month: "JUN", year: 2022, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries June 2022",
    url: `${PEARSON_DAM}/GCSE/2206-gcse-9-1-subject-grade-boundaries.pdf`,
    verifiedAt: "2026-09-10",
    contentHash: "acc74f63d54bccf000a2298d33300cfdae50d1989f42a3918cd95c6c7dc1defa",
    note: "1MA1 H 194/165/137/104/71/38/21 U=0 · F 173/135/100/66/32"
  },
  {
    month: "JUN", year: 2023, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries June 2023",
    url: `${PEARSON_DAM}/GCSE/2306-gcse-9-1-subject-grade-boundaries.pdf`,
    verifiedAt: "2026-09-10",
    contentHash: "e771cfc307bfa8ac399fe9ff83a1fe4984a255d3624a9ba6e9fb1b5970eb90c4",
    note: "1MA1 H 203/174/145/112/79/47/31 U=0 · F 182/147/109/71/33"
  },
  {
    month: "JUN", year: 2024, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries June 2024",
    url: `${PEARSON_DAM}/GCSE/grade-boundaries-june-2024-gcse.pdf`,
    verifiedAt: "2026-09-10",
    contentHash: "403eff5e8824aab3fae3d22142955fcf9f110cc4aafb907e27115d40e933412a",
    note: "1MA1 H 197/167/137/105/73/42/26 U=0 · F 175/142/103/65/27"
  },
  {
    month: "NOV", year: 2024, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries November 2024",
    url: `${PEARSON_DAM}/GCSE/grade-boundaries-november-2024-gcse.pdf`,
    verifiedAt: "2026-09-10",
    contentHash: "fda6336bedcee5bc51a6604875ac989a5ab65c64084a9859a05818d293bb62f1",
    note: "confirmed real PDF"
  },
  {
    month: "JUN", year: 2025, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries June 2025",
    url: `${PEARSON_DAM}/GCSE/grade-boundaries-june-2025-gcse.pdf`,
    verifiedAt: "2026-09-10",
    contentHash: "68230dc99d8a9f839c2978606c1f38eb35552b3c163c84562a5095cfceebd91c",
    note: "1MA1 H 217/186/156/121/87/53/36 U=0"
  },
  {
    month: "NOV", year: 2025, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries November 2025",
    url: `${PEARSON_DAM}/GCSE/grade-boundaries-november-2025-gcse.pdf`,
    verifiedAt: "2026-09-10",
    contentHash: "324174e2cc1489b630ac29785ceea8b811b50a53352e7a7f5927a66531414ea7",
    note: "confirmed real PDF"
  }
]);
