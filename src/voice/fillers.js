// The short sound Sakha makes the instant a turn ends, while Claude is still
// writing. Without it the caller gets 2-3 seconds of nothing, which on a phone
// reads as a dead line — an elder will start saying "हलो? हलो?" over the reply
// that is about to arrive.
//
// ⚠️ The two rules below came from listening to real calls, and both are about
// when NOT to make a sound:
//
// 1. NEVER acknowledge a question. Someone asks "आज कौन-सी तिथि है?" and hearing
//    "अच्छा…" before the answer is wrong — you do not say "I see" to a question,
//    you answer it. Reported directly: "I asked how are you, he said 'अच्छा,
//    मैं ठीक हूँ' — that अच्छा I didn't want."
//
// 2. The acknowledgement must MATCH what was said. A cheerful "अच्छा!" after
//    someone says their knees hurt is worse than silence, because it proves
//    nobody was listening.
//
// The pause placement matters too, and it is handled in relay.js: nothing is
// inserted after an acknowledgement. The gap belongs BEFORE the sound, as
// thinking time — "…अच्छा, तो ऐसा कीजिए" is a person considering something,
// while "अच्छा… [silence] …तो ऐसा कीजिए" is a machine buffering.

// Someone is asking, not telling. Question words, and the auxiliary
// constructions Hindi uses to ask permission — which is most of what the ritual
// rules exist to answer.
const IS_QUESTION =
  /(\?|क्या |कैसे|कब |कहाँ|कहां|कौन|क्यों|कितन|सकते हैं|सकती हैं|सकता हूँ|सकती हूँ|चाहिए|बताइए|बताओ|है क्या|ठीक रहेगा)/;

// Heavy — loneliness, grief, feeling like a burden. Anything cheerful here is a
// small betrayal.
const HEAVY = /(अकेल|उदास|दुख|दुःख|रो |रोता|रोती|तन्हा|बोझ|याद आ|छोड़ के चल|गुज़र गए|गुजर गए|मन नहीं लगता|कोई नहीं)/;

// The body. Distinct from grief: the right noise is sympathy, not solemnity.
const PAIN = /(दर्द|तकलीफ़|तकलीफ|बीमार|तबीयत|घुटन|कमर|चक्कर|नींद नहीं|दवा|कमज़ोरी|कमजोरी)/;

// Good news. Elders ring to share these too, and meeting them with a neutral
// "जी…" is its own kind of not-listening.
const GLAD = /(अच्छा लगा|खुश|मज़ा|मजा|शादी|जन्मदिन|त्योहार|आए थे|आई थी|फ़ोन किया|फोन किया|मिलने आ|पास हो गया|ठीक हूँ|अच्छी हूँ|अच्छा हूँ)/;

const BUCKETS = {
  heavy: ["हम्म…", "जी…", "अच्छा…"],
  pain: ["अरे…", "ओहो…", "हम्म…"],
  glad: ["अच्छा!", "वाह!", "अरे वाह…"],
  neutral: ["जी…", "अच्छा…", "हम्म…", "जी, सुन रहा हूँ…"],
};

/**
 * Pick something to say while thinking, or null to stay quiet.
 * @param {string} heard - what the caller just said
 * @param {string|null} last - the previous one, never repeated back to back
 */
export function pickAcknowledgement(heard, last = null) {
  const text = String(heard || "").trim();

  // A question gets an answer, not a noise. See rule 1 above.
  if (IS_QUESTION.test(text)) return null;

  // Nothing in front of a one-word answer — "जी" before "जी" is absurd, and a
  // short turn usually gets a short reply anyway, so the gap is small.
  if (text.split(/\s+/).length < 3) return null;

  const bucket = HEAVY.test(text) ? "heavy" : PAIN.test(text) ? "pain" : GLAD.test(text) ? "glad" : "neutral";
  const choices = BUCKETS[bucket].filter((p) => p !== last);
  return choices[Math.floor(Math.random() * choices.length)] || null;
}

/** Every fixed line, so the TTS cache can buy them once at boot. */
export function allFixedPhrases() {
  return [...new Set(Object.values(BUCKETS).flat())];
}
