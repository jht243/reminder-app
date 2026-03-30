/**
 * Deterministic local hydration checks.
 * Run: pnpm exec tsx scripts/test-hydration-prompts.ts
 */
import { parseNaturalLanguage } from "../web/src/ReminderApp.tsx";

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.error(`FAIL: ${msg}`);
};
const pass = (msg: string) => console.log(`PASS: ${msg}`);

const formatLocalDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const today = new Date();
today.setHours(0, 0, 0, 0);
const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);
const in3Days = new Date(today);
in3Days.setDate(in3Days.getDate() + 3);

const expectParse = (prompt: string, expected: { title: string; dueDate: string }) => {
  const parsed = parseNaturalLanguage(prompt);
  if (parsed.title !== expected.title) {
    fail(`${JSON.stringify(prompt)} title expected ${JSON.stringify(expected.title)} got ${JSON.stringify(parsed.title)}`);
  } else {
    pass(`${JSON.stringify(prompt)} title => ${parsed.title}`);
  }
  if (parsed.dueDate !== expected.dueDate) {
    fail(`${JSON.stringify(prompt)} dueDate expected ${expected.dueDate} got ${parsed.dueDate}`);
  } else {
    pass(`${JSON.stringify(prompt)} dueDate => ${parsed.dueDate}`);
  }
};

console.log("=== Target prompt regression checks ===");
expectParse("remind me to call mom", {
  title: "Call mom",
  dueDate: formatLocalDate(today),
});
expectParse("remind me to call dad tomorrow", {
  title: "Call dad",
  dueDate: formatLocalDate(tomorrow),
});
expectParse("remind me to call my uncle in 3 days", {
  title: "Call my uncle",
  dueDate: formatLocalDate(in3Days),
});

console.log("\n=== Existing behavior invariant ===");
const invariant = parseNaturalLanguage("remind me to call mom");
if (invariant.title === "Call mom") {
  pass("Existing 'remind me to call mom' behavior unchanged");
} else {
  fail(`Invariant broke: expected 'Call mom' got ${JSON.stringify(invariant.title)}`);
}

console.log("\n=== Event-order candidate scoring simulation ===");
const isNonEmptyString = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isBoilerplateInput = (text: string): boolean =>
  /^((add|set|create)\s+)?(a\s+)?(daily\s+|weekly\s+|monthly\s+)?reminders?\.?$/i.test(text) ||
  /^remind\s+me\.?$/i.test(text);
const hydrationQualitySignals = (data: any) => {
  const natural = typeof data?.natural_input === "string" ? data.natural_input.trim() : "";
  const title = typeof data?.title === "string" ? data.title.trim() : "";
  return {
    hasNaturalInput: isNonEmptyString(natural) && !isBoilerplateInput(natural),
    hasTitle: isNonEmptyString(title) && !isBoilerplateInput(title),
    hasDateHint: isNonEmptyString(data?.due_date),
    hasTimeHint: isNonEmptyString(data?.due_time),
    hasRecurrenceHint: isNonEmptyString(data?.recurrence) && data.recurrence !== "none",
    hasQueryHint: isNonEmptyString(data?.complete_query),
    hasAction: isNonEmptyString(data?.action),
  };
};
const scoreHydrationCandidate = (data: any): number => {
  const q = hydrationQualitySignals(data);
  let score = 0;
  if (q.hasNaturalInput) score += 60;
  if (q.hasTitle) score += 30;
  if (q.hasDateHint) score += 20;
  if (q.hasTimeHint) score += 15;
  if (q.hasRecurrenceHint) score += 10;
  if (q.hasQueryHint) score += 8;
  if (q.hasAction) score += 2;
  score += Math.min(Object.keys(data || {}).length, 10);
  return score;
};
const weakCandidate = { action: "create", natural_input: "remind me" };
const strongCandidate = {
  action: "create",
  natural_input: "remind me to call dad tomorrow",
  title: "call dad",
  due_date: formatLocalDate(tomorrow),
};
const weakScore = scoreHydrationCandidate(weakCandidate);
const strongScore = scoreHydrationCandidate(strongCandidate);
if (strongScore > weakScore) {
  pass(`Strong candidate wins (${strongScore} > ${weakScore})`);
} else {
  fail(`Candidate scoring broken (${strongScore} <= ${weakScore})`);
}

console.log("\n=== Dedupe signature strength simulation ===");
const buildHydrationSignature = (prefill: string, action: string, query: string, data: any) => {
  const structuredHint = {
    hasTitle: typeof data.title === "string" && data.title.trim().length > 0 ? 1 : 0,
    hasDueDate: typeof data.due_date === "string" && data.due_date.trim().length > 0 ? 1 : 0,
    hasDueTime: typeof data.due_time === "string" && data.due_time.trim().length > 0 ? 1 : 0,
    hasRecurrence: typeof data.recurrence === "string" && data.recurrence.trim().length > 0 ? 1 : 0,
    prefillWords: prefill ? prefill.trim().split(/\s+/).length : 0,
  };
  return JSON.stringify({ prefill, action, query, hint: structuredHint });
};
const weakSig = buildHydrationSignature("remind me to call dad tomorrow", "create", "", {
  action: "create",
  natural_input: "remind me to call dad tomorrow",
});
const strongSig = buildHydrationSignature("remind me to call dad tomorrow", "create", "", {
  action: "create",
  natural_input: "remind me to call dad tomorrow",
  title: "call dad",
  due_date: formatLocalDate(tomorrow),
});
if (weakSig !== strongSig) {
  pass("Weak vs strong payload signatures differ");
} else {
  fail("Weak and strong signatures collide");
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll hydration tests passed.");
