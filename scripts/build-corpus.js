// Turn the downloaded scripture into something Sakha can search mid-call.
//
//   node scripts/build-corpus.js
//
// Reads data/corpus/raw/ (gitignored), writes corpus/index.json (committed, so
// the deploy has it). Run once after downloading; nothing here runs during a call.
//
// ── On copyright, because it decided the design ─────────────────────────────
// The Sanskrit is ancient and Wilson's Vishnu Purana (1840) is long out of
// copyright. The modern Hindi and English GITA translations in this dataset are
// a different matter — Swami Ramsukhdas and the rest are recent enough that
// their publishers may well hold rights.
//
// So those translations are used as SEARCH TEXT ONLY. They are what a caller's
// words are matched against, and they are shown to Claude as context — but the
// persona already forbids reciting anything ("दादी-नानी वाली आसान भाषा में"),
// so what an elder actually hears is Sakha's own paraphrase with a citation,
// never someone's copyrighted sentence read aloud. Keep it that way.

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "data", "corpus", "raw");
const OUT = join(ROOT, "corpus"); // committed — raw/ stays under data/ and is not

// sacred-texts is a 1990s-era HTML archive: named entities for every accented
// transliteration character, and there are thousands of them per file.
const ENTITIES = {
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù",
  acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
  auml: "ä", euml: "ë", iuml: "ï", ouml: "ö", uuml: "ü",
  ntilde: "ñ", ccedil: "ç", aring: "å", oslash: "ø",
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–",
};

function decode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    // Wilson marks long vowels and retroflexes with entities that survive as
    // combining marks; strip what is left so search is not fighting diacritics.
    .replace(/&[a-z#0-9]+;/gi, "");
}

function stripTags(html) {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Bhagavad Gita ───────────────────────────────────────────────────────────
// One chunk per verse. 701 of them, each small and self-contained, which is the
// ideal shape for retrieval — a caller asking about grief should get the verse
// about grief, not the chapter it sits in.

async function buildGita() {
  const verses = JSON.parse(await readFile(join(RAW, "gita-verse.json"), "utf8"));
  const translations = JSON.parse(await readFile(join(RAW, "gita-translation.json"), "utf8"));

  const byVerse = new Map();
  for (const t of translations) {
    if (!byVerse.has(t.verse_id)) byVerse.set(t.verse_id, []);
    byVerse.get(t.verse_id).push(t);
  }

  const clean = (s) =>
    String(s || "")
      .replace(/।।\d+\.\d+।।/g, " ")       // the verse number repeated inside the text
      .replace(/\(टिप्पणी[^)]*\)/g, " ")   // footnote markers in the Hindi
      .replace(/\s+/g, " ")
      .trim();

  return verses.map((v) => {
    const t = byVerse.get(v.id) || [];
    // Hindi first — it is what an elder speaks, so it is what their words will
    // actually match against.
    const hindi = t.filter((x) => x.lang === "hindi").map((x) => clean(x.description));
    const english = t.filter((x) => x.lang === "english").map((x) => clean(x.description));

    return {
      id: `gita-${v.chapter_number}-${v.verse_number}`,
      source: "गीता",
      sourceEn: "Bhagavad Gita",
      cite: `गीता ${v.chapter_number}.${v.verse_number}`,
      sanskrit: clean(v.text),
      // Everything a caller might phrase their trouble in. Only ever searched
      // and shown to Claude — never spoken verbatim. See the note at the top.
      search: [...hindi, ...english].join(" \n "),
      hindi: hindi[0] || "",
      english: english[0] || "",
    };
  });
}

// ── Vishnu Purana ───────────────────────────────────────────────────────────
// Chunked by passage rather than by file: a chapter runs to thousands of words,
// and handing Claude a whole chapter to answer one question is both slow and a
// good way to get a vague answer.

const MAX_CHUNK = 900; // characters — roughly a long paragraph

async function buildVishnuPurana() {
  const dir = join(RAW, "vp");
  let files;
  try {
    files = (await readdir(dir)).filter((f) => /^vp\d+\.htm$/.test(f)).sort();
  } catch (e) {
    console.log("  (no vp/ directory — skipping the Vishnu Purana)");
    return [];
  }

  const chunks = [];
  for (const file of files) {
    const html = await readFile(join(dir, file), "utf8");

    const rawTitle = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || file;
    const title = decode(rawTitle)
      .replace(/\s*\|\s*Internet Sacred Text Archive\s*$/i, "")
      .replace(/^The Vishnu Purana:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();

    let body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [])[1] || html;
    // Wilson's footnotes are longer than his text in places and are mostly
    // philological argument with other translators — useless to a caller.
    body = body.split(/<h[1-4][^>]*>\s*Footnotes/i)[0];
    // The nav furniture repeats on all 187 pages and would otherwise dominate
    // the term statistics.
    body = body.replace(/<center>[\s\S]*?<\/center>/gi, "");

    const text = stripTags(body)
      .replace(/^.*?at sacred-texts\.com\s*/is, "")
      .replace(/Next:.*$/is, "")
      .trim();

    if (text.length < 200) continue; // title pages and indexes

    // Split on paragraphs, then glue them back up to MAX_CHUNK so a chunk is a
    // whole thought rather than a fragment.
    let buf = "";
    const flush = () => {
      const t = buf.trim();
      if (t.length > 150) {
        chunks.push({
          id: `vp-${file.replace(/\D/g, "")}-${chunks.length}`,
          source: "विष्णु पुराण",
          sourceEn: "Vishnu Purana",
          cite: `विष्णु पुराण — ${title}`,
          sanskrit: "",
          search: t,
          hindi: "",
          english: t,
        });
      }
      buf = "";
    };
    for (const para of text.split(/\n\n+/)) {
      if ((buf + para).length > MAX_CHUNK) flush();
      buf += (buf ? "\n\n" : "") + para;
    }
    flush();
  }
  return chunks;
}

const gita = await buildGita();
console.log(`Gita:          ${gita.length} verses`);
const vp = await buildVishnuPurana();
console.log(`Vishnu Purana: ${vp.length} passages`);

const docs = [...gita, ...vp];
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "index.json"), JSON.stringify({ builtAt: new Date().toISOString(), docs }));

const bytes = JSON.stringify({ docs }).length;
console.log(`\nWrote corpus/index.json — ${docs.length} passages, ${(bytes / 1024 / 1024).toFixed(1)}MB`);
console.log(`Sources: Gita (Sanskrit PD; modern translations SEARCH-ONLY, never spoken verbatim)`);
console.log(`         Vishnu Purana, tr. H.H. Wilson 1840 — public domain`);
