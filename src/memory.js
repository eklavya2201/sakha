import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "users");
const HISTORY_LIMIT = 24; // ~12 exchanges kept in context

function userFile(waId) {
  return join(DATA_DIR, `${waId.replace(/\D/g, "")}.json`);
}

export async function loadUser(waId) {
  try {
    return JSON.parse(await readFile(userFile(waId), "utf8"));
  } catch {
    return { facts: [], history: [] };
  }
}

export async function saveExchange(waId, mem, userText, replyText, newFacts) {
  mem.history.push({ role: "user", content: userText }, { role: "assistant", content: replyText });
  mem.history = mem.history.slice(-HISTORY_LIMIT);
  for (const fact of newFacts) {
    if (!mem.facts.includes(fact)) mem.facts.push(fact);
  }
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(userFile(waId), JSON.stringify(mem, null, 2));
}
