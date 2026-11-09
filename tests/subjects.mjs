import { parseSubjectName, subjectKey, subjectDisplay, compareSubjectRecords, groupSubjectRecords, migrateSubjectIdentity } from "../src/subjectModel.js";
let passed = 0; let failed = 0;
const check = (name, value) => { if (value) { passed++; console.log(`ok   ${name}`); } else { failed++; console.log(`FAIL ${name}`); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b));
export async function run() {
  eq("plain subject parse", parseSubjectName("Biology"), { name: "Biology", level: "" });
  eq("qualified subject parse", parseSubjectName("Biology (A-Level)"), { name: "Biology", level: "A-Level" });
  eq("subject parse collapses whitespace", parseSubjectName("  Biology   ( A-Level ) "), { name: "Biology", level: "A-Level" });
  eq("empty subject parse", parseSubjectName(" "), { name: "", level: "" });
  eq("parenthetical-only remains literal", parseSubjectName("(A-Level)"), { name: "(A-Level)", level: "" });
  eq("subject key includes level", subjectKey("Biology", "A-Level"), "Biology (A-Level)");
  eq("blank level key is name", subjectKey("Biology", " "), "Biology");
  eq("blank display level is General", subjectDisplay({ name: "Biology", level: "" }), { name: "Biology", level: "General" });
  const records = [{ name: "Bio", level: "A-Level", order: 1 }, { name: "Biology", level: "A-Level", order: 0 }, { name: "Biology", level: "GCSE", order: 0 }, { name: "Physics", level: "", order: 0 }];
  check("comparator sorts order then name within level", compareSubjectRecords(records[1], records[0]) < 0);
  eq("groups sort levels with General last", groupSubjectRecords(records).map((g) => g.label), ["A-Level", "GCSE", "General"]);
  const input = { nodes: [{ id: "n1", subject: "Biology", meta: { hierarchyPath: ["Biology"] } }, { id: "n2", type: "subject", name: "Biology (A-Level)", subject: "Biology (A-Level)" }], quotes: [{ id: "q1", subject: "Maths" }, { id: "q2", subject: "Maths (A-Level)" }], cues: [], decks: [], cards: [] };
  const before = structuredClone(input); const migrated = migrateSubjectIdentity(input);
  eq("migration creates four unique keys", migrated.subjects.map((s) => s.key), ["Biology", "Biology (A-Level)", "Maths", "Maths (A-Level)"]);
  eq("migration allows two duplicate display names", migrated.subjects.filter((s) => s.name === "Biology").length, 2);
  check("migration stamps all owner records", [...migrated.nodes, ...migrated.quotes].every((r) => r.subjectId));
  eq("migration preserves legacy subject labels", migrated.nodes.map((n) => n.subject), input.nodes.map((n) => n.subject));
  eq("migration preserves hierarchy paths", migrated.nodes[0].meta.hierarchyPath, input.nodes[0].meta.hierarchyPath);
  const unchanged = Object.fromEntries(Object.entries(migrated).filter(([k]) => k !== "subjects").map(([k, rows]) => [k, rows.map(({ subjectId, ...r }) => r)]));
  eq("migration changes only subjectId on inputs", unchanged, before);
  return { passed, failed };
}
