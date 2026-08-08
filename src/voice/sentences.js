// Pull complete sentences off a streaming buffer, leaving a half-written tail
// behind for the next chunk. The sentence is the unit of speech: waiting for a
// whole reply before synthesising any of it adds seconds of dead air to a call.
//
// The danda (।) is Hindi's full stop and has to end a sentence here, or a Hindi
// reply streams as one long block and is spoken all at once.
//
// A sentence is only complete once WHITESPACE follows the stop — never merely
// the end of the buffer. Mid-stream the buffer legitimately ends at "14416." or
// "1." with more digits still in flight, and treating that dot as a full stop
// would have Sakha say a helpline number in two halves.
const SENTENCE_RE = /^([\s\S]*?[।?!.])\s+/;

// `flush` is for when the stream has ended and nothing more is coming, so
// whatever remains is by definition the last sentence.
export function takeCompleteSentences(buffer, { flush = false } = {}) {
  const sentences = [];
  let rest = String(buffer);
  let m;
  while ((m = SENTENCE_RE.exec(rest))) {
    const s = m[1].trim();
    if (s) sentences.push(s);
    rest = rest.slice(m[0].length);
  }
  if (flush) {
    const tail = rest.trim();
    if (tail) sentences.push(tail);
    rest = "";
  }
  return { sentences, rest };
}
