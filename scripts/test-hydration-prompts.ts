/**
 * Local check: same two prompts as ChatGPT hydration prefill → parseNaturalLanguage.
 * Run: pnpm exec tsx scripts/test-hydration-prompts.ts
 */
import { parseNaturalLanguage } from "../web/src/ReminderApp.tsx";

const HYDRATION_DEDUP_KEY = "__reminder_hydration_sigs";

function mockSessionStorage() {
  const mem = new Map<string, string>();
  (globalThis as any).sessionStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
  };
}

function simulateHydrationDedup(prefill: string) {
  const refSet = new Set<string>();
  const isHydrationSignatureSeen = (sig: string): boolean => {
    if (refSet.has(sig)) return true;
    try {
      const stored = sessionStorage.getItem(HYDRATION_DEDUP_KEY);
      if (stored) {
        const sigs: string[] = JSON.parse(stored);
        if (sigs.includes(sig)) return true;
      }
    } catch {}
    return false;
  };
  const markHydrationSignature = (sig: string) => {
    refSet.add(sig);
    try {
      const stored = sessionStorage.getItem(HYDRATION_DEDUP_KEY);
      const sigs: string[] = stored ? JSON.parse(stored) : [];
      if (!sigs.includes(sig)) sigs.push(sig);
      sessionStorage.setItem(HYDRATION_DEDUP_KEY, JSON.stringify(sigs.slice(-20)));
    } catch {}
  };

  // Mirrors ReminderApp hydration: infer from prefill → create intent, empty query
  const infer = { action: "create" as const };
  const effectiveAction = infer.action;
  const effectiveQuery = "";
  const signature = JSON.stringify({
    prefill,
    action: effectiveAction || "",
    query: effectiveQuery,
  });

  const firstAlreadySeen = isHydrationSignatureSeen(signature);
  if (!firstAlreadySeen) markHydrationSignature(signature);
  const secondAlreadySeen = isHydrationSignatureSeen(signature);

  return { signature, firstAlreadySeen, secondAlreadySeen };
}

console.log("=== parseNaturalLanguage (widget input after hydration prefill) ===\n");

const prompt1 = "Add a reminder to call mom.";
const r1 = parseNaturalLanguage(prompt1);
console.log(`Prompt 1: ${JSON.stringify(prompt1)}`);
console.log(`  title:   ${JSON.stringify(r1.title)}`);
console.log(`  expect:  "Call mom" (not "Reminder to call mom")\n`);

const prompt2 = "Add a reminder to call mom tomorrow.";
const r2 = parseNaturalLanguage(prompt2);
console.log(`Prompt 2: ${JSON.stringify(prompt2)}`);
console.log(`  title:   ${JSON.stringify(r2.title)}`);
console.log(`  dueDate: ${r2.dueDate} (tomorrow vs today)`);
console.log(`  expect:  title "Call mom", dueDate = tomorrow\n`);

console.log("=== duplicate hydration (same signature twice, sessionStorage + ref) ===\n");
mockSessionStorage();
const dedup = simulateHydrationDedup(prompt2);
console.log(`signature: ${dedup.signature}`);
console.log(`1st hydration — already seen (skip): ${dedup.firstAlreadySeen} (expect false)`);
console.log(`2nd hydration — already seen (skip): ${dedup.secondAlreadySeen} (expect true)`);
console.log(
  !dedup.firstAlreadySeen && dedup.secondAlreadySeen
    ? "OK: duplicate hydration signature is deduped."
    : "FAIL: dedup mismatch"
);

function printParsed(label: string, prefill: string) {
  const p = parseNaturalLanguage(prefill);
  console.log(`\n${label}`);
  console.log(`  prefill: ${JSON.stringify(prefill)}`);
  console.log(`  title:            ${JSON.stringify(p.title)}`);
  console.log(`  dueDate:          ${p.dueDate}`);
  console.log(`  dueTime:          ${p.dueTime ?? "(none)"}`);
  console.log(`  recurrence:       ${p.recurrence}`);
  console.log(`  recurrenceInterval: ${p.recurrenceInterval ?? "(none)"}`);
  console.log(`  recurrenceUnit:     ${p.recurrenceUnit ?? "(none)"}`);
  console.log(`  confidence:       ${p.confidence}`);
}

console.log("\n\n=== Hydration case A: call mom tomorrow 5pm ===");
printParsed(
  "Expected: title Call mom, tomorrow, 17:00, daily/none as designed",
  "Remind me to call mom tomorrow at 5pm."
);

console.log("\n\n=== Hydration case B: daily vitamins 9am ===");
printParsed(
  "Expected: title Take vitamins (or similar), daily, 09:00",
  "Set a daily reminder to take vitamins at 9am."
);
