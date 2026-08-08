// Finding the right verse while an elder is still on the line.
//
// BM25 over a local index, in plain JavaScript, with no embedding call and no
// vector database. That is a deliberate choice and it is about latency and cost:
// retrieval here runs BETWEEN the transcript and Claude, on the same turn, so it
// has to finish in single-digit milliseconds and cost nothing. An embedding
// round trip would add a second to a gap that is already 2.4s, and would bill on
// every turn of every call forever.
//
// Lexical search is weaker than embeddings at matching a paraphrase. It is
// strong at exactly what happens here: someone says "अकेला" or "डर लगता है" and
// there are verses that use those words. The prefix trick below covers most of
// what Hindi inflection would otherwise break.
//
// ⚠️ Sakha must NOT quote from this. The passages go to Claude as context and
// come back as his own words with a citation — see the copyright note in
// scripts/build-corpus.js. The persona enforces the paraphrase.

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const INDEX_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "corpus", "index.json");

// BM25's two knobs, at their standard values. k1 controls how fast repeating a
// term stops helping; b controls how much a long passage is penalised. Wilson's
// paragraphs are far longer than a Gita verse, so b matters here — without it
// the Purana would win every query on sheer word count.
const K1 = 1.5;
const B = 0.75;

// Words that appear everywhere and mean nothing for retrieval. An elder's
// sentence is mostly these, and without stripping them "क्या मैं यह कर सकता हूँ"
// matches half the corpus.
const STOP = new Set([
  "और","का","की","के","को","में","से","है","हैं","था","थे","थी","यह","वह","ये","वे","मैं","मुझे","मेरा","मेरी",
  "आप","आपका","आपकी","हम","हमारा","तुम","कि","जो","तो","ही","भी","पर","एक","न","नहीं","क्या","कर","करना","किया",
  "हो","होता","होती","होने","गया","गई","रहा","रही","लिए","साथ","अपने","अपनी","इस","उस","जब","तब","सब","कुछ",
  // Added after the first retrieval test, where "आज घुटनों में दर्द है" and
  // "नाश्ते में क्या बनाऊँ आज" both pulled verses purely on the word आज. Common
  // conversational words are exactly what an elder's sentence is made of, and
  // every one of them left in here is a false match waiting to happen.
  "आज","कल","अब","फिर","बहुत","कोई","वाला","वाली","वाले","लगता","लगती","रहता","रहती","बात","बातें","जाता","जाती",
  "चला","चली","देना","लेना","सकता","सकती","चाहिए","बता","बताइए","कहना","कहा","अच्छा","ठीक","जैसे","ऐसे","यहाँ","वहाँ",
  "the","and","of","to","in","is","are","was","were","that","this","it","for","with","as","by","on","at","from",
  "his","her","he","she","they","which","be","been","or","not","but","a","an",
]);

// ── The vocabulary gap ──────────────────────────────────────────────────────
// The single biggest retrieval failure, and it is not a tuning problem.
//
// These translations are written in tatsama Hindi — Sanskrit words carried over
// whole: मृत्यु, भय, क्रोध, शोक. Elders on the phone speak the everyday register:
// मौत, डर, गुस्सा, दुख. They are the same concepts in different words, so a
// lexical index matches none of them.
//
// Measured: "मौत से डर लगता है मुझे" returned NOTHING, in a text whose most
// famous passage is about exactly that (गीता 2.20). Embeddings would have caught
// it; this map is the cheap way to get most of that benefit for free.
//
// Expanded at query time only, so the index stays honest.
const SYNONYMS = {
  मौत: ["मृत्यु", "मरण"], मरना: ["मृत्यु", "मरण"], मरने: ["मृत्यु", "मरण"],
  डर: ["भय"], डरता: ["भय"], डरती: ["भय"], घबराहट: ["भय"], घबरा: ["भय"],
  गुस्सा: ["क्रोध"], गुस्से: ["क्रोध"], नाराज़: ["क्रोध"],
  दुख: ["शोक", "दुःख"], दुखी: ["शोक", "दुःख"], उदास: ["शोक", "विषाद"], रोना: ["शोक"],
  अकेला: ["एकांत", "एकाकी", "अकेले"], अकेले: ["एकांत", "एकाकी"], अकेलापन: ["एकांत", "एकाकी"],
  चिंता: ["शोक", "व्यथा"], परेशान: ["व्यथा", "क्लेश"], तकलीफ़: ["क्लेश", "दुःख"],
  शांति: ["शान्ति"], मन: ["मन", "चित्त"], "याद": ["स्मृति"],
  बुढ़ापा: ["वृद्ध", "जरा"], बीमारी: ["रोग", "व्याधि"], बीमार: ["रोग"],
  भगवान: ["ईश्वर", "परमात्मा"], आत्मा: ["आत्मा", "जीव"], "कर्म": ["कर्म"],
  मोह: ["मोह", "आसक्ति"], लगाव: ["आसक्ति", "मोह"], "त्याग": ["त्याग", "वैराग्य"],
};

// Devanagari, Latin, digits. Everything else is a separator.
const TOKEN_RE = /[ऀ-ॿa-zA-Z0-9]+/g;

/**
 * Tokens for indexing and querying.
 *
 * Each long Devanagari word also yields a 4-character prefix, which is a crude
 * stand-in for a stemmer: Hindi inflects heavily at the END of a word, so
 * अकेला / अकेले / अकेलापन all share "अकेल". Without this, a caller saying
 * "अकेले" would miss every verse that says "अकेला" — which is precisely the
 * kind of question this exists to answer.
 */
function tokenize(text) {
  const out = [];
  for (const raw of String(text).toLowerCase().match(TOKEN_RE) || []) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.push(raw);
    if (raw.length >= 5 && /[ऀ-ॿ]/.test(raw)) out.push(raw.slice(0, 4) + "~");
  }
  return out;
}

let index = null; // { docs, df, idf, len, avgLen, postings }

/**
 * Load and index the corpus. Called once at boot — roughly 2000 passages, which
 * takes well under a second and then never touches disk again.
 *
 * Missing corpus is NOT an error — someone may have deleted it, or a fork may
 * strip it. Rebuild with scripts/build-corpus.js. Sakha without scripture is
 * still Sakha — he just cannot cite anything.
 */
export async function loadScripture() {
  if (index) return index;
  let docs;
  try {
    docs = JSON.parse(await readFile(INDEX_PATH, "utf8")).docs;
  } catch (e) {
    index = { docs: [], postings: new Map(), idf: new Map(), len: [], avgLen: 0 };
    return index;
  }

  const postings = new Map(); // term -> [[docIndex, termFreq], …]
  const len = new Array(docs.length).fill(0);

  docs.forEach((doc, i) => {
    // The citation is searched too, so "गीता" or "पुराण" in a question pulls
    // that source up rather than being thrown away.
    const tokens = tokenize(`${doc.search} ${doc.sanskrit} ${doc.cite}`);
    len[i] = tokens.length;
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [term, freq] of tf) {
      if (!postings.has(term)) postings.set(term, []);
      postings.get(term).push([i, freq]);
    }
  });

  const N = docs.length;
  const avgLen = len.reduce((a, b) => a + b, 0) / (N || 1);
  const idf = new Map();
  for (const [term, list] of postings) {
    // Standard BM25 idf, floored at a small positive number so a term in almost
    // every passage contributes nothing rather than something negative.
    idf.set(term, Math.max(0.01, Math.log(1 + (N - list.length + 0.5) / (list.length + 0.5))));
  }

  index = { docs, postings, idf, len, avgLen };
  return index;
}

export function scriptureReady() {
  return Boolean(index?.docs?.length);
}

export function scriptureStatusLine() {
  if (!index) return "scripture: not loaded";
  if (!index.docs.length) return "scripture: none (run `node scripts/build-corpus.js`)";
  const sources = new Map();
  for (const d of index.docs) sources.set(d.source, (sources.get(d.source) || 0) + 1);
  return `scripture: ${index.docs.length} passages (${[...sources].map(([s, n]) => `${s} ${n}`).join(", ")})`;
}

/**
 * Find passages that speak to what the caller just said.
 *
 * @param {string} query - the caller's own words, as transcribed
 * @param {object} [opts]
 * @param {number} [opts.k] - how many passages to return
 * @param {number} [opts.minScore] - below this, return NOTHING.
 *
 *   The threshold is the important parameter and it exists to protect the
 *   product, not the latency. Sakha is a companion, not a scripture bot: an
 *   elder saying she is lonely wants to be heard, not answered with a verse.
 *   Returning nothing is the correct result for most turns of most calls, and
 *   the persona only weaves scripture in "when it truly fits".
 */
export function findScripture(query, { k = 3, minScore = 3.5 } = {}) {
  if (!index?.docs?.length) return [];
  const terms = tokenize(query);
  if (!terms.length) return [];

  // Expand the everyday register into the Sanskritic words the translations
  // actually use. Query-time only — see SYNONYMS.
  const expanded = new Set(terms);
  for (const t of terms) for (const syn of SYNONYMS[t] || []) for (const s of tokenize(syn)) expanded.add(s);

  const scores = new Map();
  const hitTerms = new Map(); // docIndex -> Set of distinct query terms it matched
  for (const term of expanded) {
    const list = index.postings.get(term);
    if (!list) continue;
    const idf = index.idf.get(term);
    for (const [i, freq] of list) {
      const norm = 1 - B + (B * index.len[i]) / (index.avgLen || 1);
      scores.set(i, (scores.get(i) || 0) + idf * ((freq * (K1 + 1)) / (freq + K1 * norm)));
      if (!hitTerms.has(i)) hitTerms.set(i, new Set());
      // Count the prefix and its full word as one term, or "अकेला" would look
      // like two independent pieces of evidence when it is only one.
      hitTerms.get(i).add(term.replace(/~$/, "").slice(0, 4));
    }
  }
  if (!scores.size) return [];

  return [...scores.entries()]
    .map(([i, score]) => ({
      i,
      score,
      // The Gita is nudged ahead of the Purana on equal footing: it is short,
      // it is about exactly what these callers are carrying — grief, duty,
      // fear, death — and a verse cites cleanly as "गीता 2.47", where a Purana
      // passage cites as a chapter of narrative.
      boosted: score * (index.docs[i].source === "गीता" ? 1.25 : 1),
      doc: index.docs[i],
    }))
    .sort((a, b) => b.boosted - a.boosted)
    // Two DISTINCT query words, not just a high score. One common word in
    // common with a passage is a coincidence, and the test that proved it was
    // "नाश्ते में क्या बनाऊँ आज" pulling three verses on the strength of "आज"
    // alone. Sakha quoting the Gita at someone asking what to cook is the exact
    // failure that would make him feel like a machine.
    .filter((r) => r.boosted >= minScore && (hitTerms.get(r.i)?.size || 0) >= 2)
    .slice(0, k)
    .map((r) => r.doc);
}

/**
 * Render passages for the system prompt.
 *
 * Explicitly labelled as OPTIONAL and as reference-not-script, because the
 * failure mode of putting text in front of a language model is that it feels
 * obliged to use it. Most turns should ignore this entirely.
 */
export function renderScripture(passages) {
  if (!passages?.length) return null;
  const body = passages
    .map((p) => {
      const lines = [`[${p.cite}]`];
      if (p.sanskrit) lines.push(`संस्कृत: ${p.sanskrit}`);
      if (p.hindi) lines.push(`अर्थ: ${p.hindi}`);
      else if (p.english) lines.push(`(English source): ${p.english.slice(0, 700)}`);
      return lines.join("\n");
    })
    .join("\n\n");

  return `शास्त्र से कुछ पंक्तियाँ जो शायद इस बात से जुड़ती हैं। यह सिर्फ़ आपके लिए संदर्भ है — ज़रूरी नहीं कि इस्तेमाल करें:

${body}

इनका इस्तेमाल कैसे करें:
- ज़्यादातर बार इनकी ज़रूरत नहीं होती। अगर वे सिर्फ़ अपना मन हल्का कर रहे हैं, तो पहले सुनिए — श्लोक मत सुनाइए।
- अगर बात सचमुच बैठती है, तो एक विचार अपने शब्दों में, दादी-नानी वाली आसान भाषा में कहिए। ऊपर लिखा हुआ पढ़कर मत सुनाइए।
- कहाँ से है वह हल्के से बता दीजिए ("गीता में कृष्ण अर्जुन से यही कहते हैं…")।
- अगर यहाँ जो लिखा है वह उनकी बात से मेल नहीं खाता, तो इसे पूरी तरह छोड़ दीजिए।`;
}
