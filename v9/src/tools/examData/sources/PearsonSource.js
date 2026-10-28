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
    month: "NOV", year: 2022, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries November 2022",
    url: `${PEARSON_DAM}/GCSE/2211-gcse-9-1-subject-grade-boundaries-v1.pdf`,
    verifiedAt: "2026-10-22",
    contentHash: "be7017f77ad1961228e0d52f31b736e6c5a0fb87bf268499ef96fe7a0319049f",
    note: "1MA1 H 194/165/137/104/71/38/21 U=0 · F 173/135/100/66/32 (same published thresholds as June 2022)"
  },
  {
    month: "NOV", year: 2021, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) Maths and English grade boundaries November 2021",
    url: `${PEARSON_DAM}/GCSE/2111_GCSE_9-1_Maths_and_Eng_Subject_Grade_Boundaries.pdf`,
    verifiedAt: "2026-10-22",
    contentHash: "2c8e66a7ddfbc6109a59c21a294e315019bb6acdc36ed940f950787dd7bce800",
    note: "1MA1 H 187/154/122/93/65/37/23 U=0 · F 166/134/100/66/32"
  },
  {
    month: "NOV", year: 2020, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) Maths and English grade boundaries November 2020",
    url: `${PEARSON_DAM}/GCSE/grade-boundaries-nov-2020-gcse-9-1-maths-eng.pdf`,
    verifiedAt: "2026-10-22",
    contentHash: "a0af8a8f430f8e3555968cd78ca10a5ddbeed1fc0fba98c059422f550bea25bf",
    note: "1MA1 H 189/157/126/96/66/37/22 U=0 · F 165/136/99/63/27"
  },
  {
    month: "JUN", year: 2019, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries June 2019",
    url: `${PEARSON_DAM}/GCSE/1906-gcse-9-1-subject-grade-boundaries.pdf`,
    verifiedAt: "2026-10-22",
    contentHash: "e46d8d997ff8eef5bfd7426e1dc543930041650caf463191e8d85ad0b1b65498",
    note: "1MA1 H 198/167/137/108/80/52/38 U=0 · F 184/149/111/73/36"
  },
  {
    month: "NOV", year: 2019, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries November 2019",
    url: `${PEARSON_DAM}/GCSE/1911-gcse-9-1-subject-grade-boundaries.pdf`,
    verifiedAt: "2026-10-22",
    contentHash: "8827710b1480d5af006fbfbe0b69056fd32dace4c7b8a5971b5d179638ae1066",
    note: "1MA1 H 197/165/133/103/73/43/28 U=0 · F 166/142/104/67/30"
  },
  {
    month: "JUN", year: 2018, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries June 2018",
    url: `${PEARSON_DAM}/GCSE/1806-GCSE-9-1-Subject-Grade-Boundaries.pdf`,
    verifiedAt: "2026-10-22",
    contentHash: "f679d338107e848af3ff7e4681d434dc94671474f3bd69cdf2da64ab0dadee36",
    note: "1MA1 H 202/170/139/109/79/50/35 U=0 · F 169/136/101/66/31"
  },
  {
    month: "NOV", year: 2018, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries November 2018",
    url: `${PEARSON_DAM}/GCSE/1811-GCSE-9-1-Subject-Grade-Boundaries.pdf`,
    verifiedAt: "2026-10-22",
    contentHash: "b93bfd49ed4d5160ec76bea052506ff02b14257482b5da88e4a4d7f0389fea1d",
    note: "1MA1 H 194/159/125/95/66/37/22 U=0 · F 167/132/96/61/26"
  },
  {
    month: "JUN", year: 2017, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries June 2017",
    url: `${PEARSON_DAM}/GCSE/1706-gcse-9-1-grade-boundaries-v1.pdf`,
    verifiedAt: "2026-10-22",
    contentHash: "c5ecde0591d2d5e36c8094f7240d99bcca3be4315c04fe5bb984df885f517543",
    note: "1MA1 H 190/157/124/96/68/41/27 U=0 · F 158/122/90/58/26"
  },
  {
    month: "NOV", year: 2017, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries November 2017",
    url: `${PEARSON_DAM}/GCSE/1711-gcse-9-1-grade-boundaries.pdf`,
    verifiedAt: "2026-10-22",
    contentHash: "d16bf1963864e823781d18b07408ae037edc6851a39dc3aaebad900ea5fd4b0d",
    note: "1MA1 H 189/150/112/85/58/32/19 U=0 · F 145/113/83/53/23"
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
    month: "NOV", year: 2023, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries November 2023",
    url: `${PEARSON_DAM}/GCSE/2311-gcse-9-1-subject-grade-boundaries.pdf`,
    verifiedAt: "2026-10-22",
    contentHash: "1fbcb21eab131c3f63b90f6d85c6b6812244a087581a459cf2ac4cec0e8ac2fa",
    note: "1MA1 H 203/174/145/112/79/47/31 U=0 · F 175/140/104/68/33"
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
  },
  {
    month: "JUN", year: 2026, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries June 2026",
    url: `${PEARSON_DAM}/GCSE/grade-boundaries-june-2026-gcse.pdf`,
    verifiedAt: "2026-10-22",
    contentHash: "9acaf7b8308d0cd95fef53398d73bc794a70054e5fd5f7f7f096e34b840acffc",
    note: "1MA1 H 208/177/146/114/82/50/34 U=0 · F 181/151/110/69/29"
  }
]);
