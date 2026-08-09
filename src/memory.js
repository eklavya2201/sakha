import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "users");
const HISTORY_LIMIT = 24; // ~12 exchanges kept in context

function userFile(waId) {
  return join(DATA_DIR, `${waId.replace(/\D/g, "")}.json`);
}

// ── The free trial ──────────────────────────────────────────────────────────
// Talk time is tracked in the same per-person file as everything else, because
// it is the same person: one file, one write, no second store to fall out of
// step with the first.
//
// Enforced entirely on the server. The browser is told how much is left only so
// it can say so kindly — nothing about the meter is trusted from the client.
const FREE_TRIAL_MS = Number(process.env.FREE_TRIAL_MINUTES || 15) * 60 * 1000;

export async function loadUser(waId) {
  let user;
  try {
    user = JSON.parse(await readFile(userFile(waId), "utf8"));
  } catch {
    user = { facts: [], history: [] };
  }
  // Older files predate the meter; a missing ledger means an untouched trial.
  if (!user.minutes) user.minutes = { usedMs: 0, grantedMs: FREE_TRIAL_MS };
  return user;
}

/** Talk time this person still has, in milliseconds. Never negative. */
export function remainingMs(mem) {
  const m = mem?.minutes || {};
  return Math.max(0, (m.grantedMs ?? FREE_TRIAL_MS) - (m.usedMs || 0));
}

/** Add paid (or gifted) minutes. The payment webhook will call this. */
export async function grantMinutes(waId, minutes) {
  const mem = await loadUser(waId);
  mem.minutes.grantedMs = (mem.minutes.grantedMs || 0) + minutes * 60 * 1000;
  await persist(waId, mem, []);
  return remainingMs(mem);
}

// Claude requires messages to alternate and to start with the user. WhatsApp
// always appends a user/assistant pair so it stays aligned on its own, but a
// phone call does not: Sakha speaks first, an elder can say two things before
// Sakha answers, and trimming to the last 24 can cut mid-pair. Left alone, one
// call would make every later WhatsApp message 400.
function normalizeHistory(history) {
  const merged = [];
  for (const turn of history) {
    if (!turn?.content) continue;
    const last = merged[merged.length - 1];
    // Two turns in the same voice are one turn as far as the model is concerned.
    if (last && last.role === turn.role) last.content += " " + turn.content;
    else merged.push({ ...turn });
  }
  const trimmed = merged.slice(-HISTORY_LIMIT);
  // A window that opens on Sakha talking has no question in front of it.
  while (trimmed.length && trimmed[0].role !== "user") trimmed.shift();
  return trimmed;
}

async function persist(waId, mem, newFacts) {
  mem.history = normalizeHistory(mem.history);
  for (const fact of newFacts || []) {
    if (!mem.facts.includes(fact)) mem.facts.push(fact);
  }
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(userFile(waId), JSON.stringify(mem, null, 2));
}

export async function saveExchange(waId, mem, userText, replyText, newFacts) {
  mem.history.push({ role: "user", content: userText }, { role: "assistant", content: replyText });
  await persist(waId, mem, newFacts);
}

/**
 * File a finished phone call against the same memory the WhatsApp bot uses.
 *
 * The same file on purpose: someone who sends voice notes on Monday and taps
 * Call on Thursday must be met by a friend who remembers Monday. Two stores
 * would make Sakha two people who happen to share a voice.
 *
 * @param {Array<{role: "caller"|"agent", text: string}>} turns - in spoken order
 */
export async function saveCall(waId, mem, turns, newFacts, usedMs = 0) {
  for (const turn of turns) {
    if (!turn?.text) continue;
    mem.history.push({ role: turn.role === "caller" ? "user" : "assistant", content: turn.text });
  }
  // Metered here rather than in its own write, so a call cannot be remembered
  // without being billed or billed without being remembered.
  if (usedMs > 0) {
    mem.minutes = mem.minutes || { usedMs: 0, grantedMs: FREE_TRIAL_MS };
    mem.minutes.usedMs = (mem.minutes.usedMs || 0) + usedMs;
    mem.minutes.lastCallAt = new Date().toISOString();
  }
  await persist(waId, mem, newFacts);
}
