// Short Hindi acknowledgements, spoken the instant a turn ends so the caller
// hears something while Claude is still writing.
//
// On this pipeline the gap is real and unavoidable: Sarvam confirms the turn,
// then Claude takes ~1-2s for a first sentence, then Sarvam synthesises the
// whole sentence before a byte of audio exists. Two to three seconds of silence
// on a phone call reads as "the line went dead" — to an elder especially, who
// will start saying "hello? hello?" over the reply that is about to arrive.
//
// Every line here is fixed, so each is synthesised once and replayed forever
// (see the phrase cache in tts.js). They are also deliberately non-committal:
// Sakha has not heard the reply yet, so an acknowledgement must never agree,
// sympathise or promise anything.
const ACKS = ["जी…", "अच्छा…", "हम्म…", "जी, सुन रहा हूँ…", "अच्छा, समझा…"];

// Said when the caller sounds distressed. Not a response to what they said —
// just a softer noise to sit in front of it.
const GENTLE = ["हम्म…", "जी…"];

// Rough distress markers, only good enough to pick a softer filler. The real
// classification is Claude's job; getting this wrong costs one interjection.
const HEAVY = /(अकेल|उदास|रो|दुख|तकलीफ़|तकलीफ|बीमार|दर्द|मर|याद आ|बोझ)/;

/**
 * Pick something to say while thinking, or null to stay quiet.
 * @param {string} heard - what the caller just said
 * @param {string|null} last - the previous acknowledgement, never repeated
 */
export function pickAcknowledgement(heard, last = null) {
  const text = String(heard || "");
  // Nothing in front of a one-word answer — "जी" before "जी" is absurd, and a
  // short turn usually gets a short reply anyway, so the gap is small.
  if (text.trim().split(/\s+/).length < 3) return null;

  const pool = HEAVY.test(text) ? GENTLE : ACKS;
  const choices = pool.filter((p) => p !== last);
  return choices[Math.floor(Math.random() * choices.length)] || null;
}

/** Every fixed line, so the TTS cache can buy them once at boot. */
export function allFixedPhrases() {
  return [...new Set([...ACKS, ...GENTLE])];
}
