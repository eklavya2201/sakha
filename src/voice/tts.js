// Sakha's voice on a call: Sarvam streaming text-to-speech.
//
// One socket per call, not per sentence — opening a fresh one costs a round trip
// that would land on the front of every single reply. Opened once while the page
// still says "जोड़ रहे हैं…", where nobody notices it.
//
// Wire protocol, confirmed against the live account:
//   send  {"type":"config","data":{speaker, target_language_code, pace,
//                                  output_audio_codec:"linear16", speech_sample_rate}}
//   send  {"type":"text","data":{"text":"…"}}
//   recv  {"type":"audio","data":{"content_type":"audio/pcm","audio":"<base64>"}}
//
// ⚠️ Two measured facts the design is shaped around. Don't re-litigate:
//
//  1. THE TWO MODELS CHUNK COMPLETELY DIFFERENTLY. For the same sentence, v2
//     returns ONE blob and v3 returned 62 chunks. So "the first audio message
//     means the sentence is done" was correct for v2 and would cut v3 off after
//     about 90ms. Completion is detected by the audio going quiet — see
//     handleMessage.
//  2. There is no `final` / `done` event on this socket at all. Waiting 8s after
//     a flush produced no non-audio message on either model, so the idle gap is
//     the only completion signal that exists.
//
// Why the WebSocket and not the far simpler POST /text-to-speech: measured on
// v3, the socket delivered its first audio in 219ms against 2250ms for the
// batch endpoint. Two seconds of extra dead air per sentence, on top of the
// 2.4s the caller already waits, is not a trade worth making for simpler code.
//
// Sample rate: the output is 22050 by default. `speech_sample_rate` is the
// parameter that actually changes it — `output_audio_sample_rate` and
// `sample_rate` are both silently ignored (asked for 16000 via each; only
// speech_sample_rate came back smaller, and by exactly the right ratio).

import WebSocket from "ws";
import { OUT_SAMPLE_RATE } from "./format.js";

const SARVAM_HOST = "api.sarvam.ai";
const MODEL = process.env.SARVAM_TTS_MODEL || "bulbul:v3";

// Voices are NOT shared between models, and picking a mismatched pair fails with
// HTTP 400 at synthesis time — which means Sakha greets nobody and the call is
// silent, with the reason buried in a log. Cheap to catch at boot instead.
//
// bulbul:v3 is the newer model and reportedly the better one; its roster is
// completely separate from v2's, so switching model means switching voice too.
const V2_SPEAKERS = ["anushka", "abhilash", "manisha", "vidya", "arya", "karun", "hitesh"];
const V3_SPEAKERS = [
  "aditya", "ritu", "priya", "neha", "rahul", "pooja", "rohan", "simran", "kavya", "amit", "dev",
  "ishita", "shreya", "ratan", "varun", "manan", "sumit", "roopa", "kabir", "aayan", "shubh",
  "ashutosh", "advait", "anand", "tanya", "tarun", "sunny", "mani", "gokul", "vijay", "shruti",
  "suhani", "mohit", "kavitha", "rehan", "soham", "rupali",
];

/** null when the pair is fine, otherwise what is wrong and how to fix it. */
export function ttsSpeakerWarning() {
  const wanted = MODEL.includes("v3") ? V3_SPEAKERS : V2_SPEAKERS;
  const speaker = process.env.SARVAM_TTS_SPEAKER || "aditya";
  if (wanted.includes(speaker)) return null;
  const other = MODEL.includes("v3") ? V2_SPEAKERS : V3_SPEAKERS;
  const hint = other.includes(speaker)
    ? `"${speaker}" belongs to the other model.`
    : `"${speaker}" is not a Sarvam voice.`;
  return `SARVAM_TTS_SPEAKER="${speaker}" is not compatible with ${MODEL} — ${hint} Sakha will be SILENT on every call. Voices for ${MODEL}: ${wanted.slice(0, 8).join(", ")}…`;
}

// aditya on bulbul:v3, chosen by listening to the same three-sentence reply in
// v2/karun and in three v3 voices. v3 is smoother through a sentence and the
// difference is not subtle.
//
// src/tts.js (WhatsApp) reads the same two env vars, so an elder who sends voice
// notes and then taps Call hears the same friend rather than a stranger with the
// same name. Change them together or Sakha becomes two different men.
const SPEAKER = process.env.SARVAM_TTS_SPEAKER || "aditya";

// 1.0 — normal speed, chosen by LISTENING after 0.9 was picked by reasoning.
//
// The argument for slowing him was real: hearing loss past seventy takes the
// high frequencies first and slower speech is easier to follow. But 0.9 plus a
// lowered pitch did not sound gentle, it sounded DULL — and Sakha is meant to
// carry some of Krishna's liveliness, which is the whole reason an elder would
// want to talk to him rather than be managed by him.
//
// Clarity is bought back where it costs nothing: the pause BETWEEN sentences
// below, which gives an elder time to catch up without making each sentence
// drag. Quick and warm, but never rushing you.
const PACE = Number(process.env.SARVAM_TTS_PACE || 1.0);

// 0 — karun's own pitch. Lowering it was tried at -0.2, -0.4 and -0.6 and every
// one of them made him sound heavier and more tired, not warmer. Deep plus slow
// is how you get a voice nobody wants to ring back.
//
// Range is roughly -0.75 to 0.75. Must match SARVAM_TTS_PITCH in src/tts.js, or
// the WhatsApp Sakha and the calling Sakha become two different men.
const PITCH = Number(process.env.SARVAM_TTS_PITCH || 0);

// Ceiling on one sentence, and a safety net rather than a latency control:
// tripping it means something is already wrong. It has to exist because every
// spoken line goes through one serial queue in relay.js, so a single socket that
// never answers would silence Sakha for the rest of the call while the caller
// hears nothing and no error is raised anywhere.
const SPEAK_TIMEOUT_MS = Number(process.env.TTS_SPEAK_TIMEOUT_MS || 12000);

// How long a silence on the socket means "this sentence is finished". See the
// note in handleMessage — this is the only completion signal Sarvam gives.
//
// 700ms, and it is deliberately generous. Measured in ISOLATION the largest gap
// between chunks was 219ms, so 400 looked like plenty — but inside a live call
// the same greeting came back 3.1s long against 5.75s standalone, because this
// process is simultaneously pushing microphone frames at Sarvam and reading a
// Claude stream, and a busy event loop delays these callbacks. Cutting a
// sentence off mid-word is far worse than holding the queue an extra moment.
//
// Costs nothing audible: v3 generates ~3x faster than real time, so the browser
// playback queue stays well ahead even with this pause after every sentence.
const IDLE_DONE_MS = Number(process.env.TTS_IDLE_DONE_MS || 700);

export function ttsConfigured() {
  return Boolean(process.env.SARVAM_API_KEY);
}

export function ttsConfigError() {
  if (ttsConfigured()) return null;
  return "SARVAM_API_KEY is not set, so Sakha has no voice. (The same key does the hearing.)";
}

export function ttsStatusLine() {
  return `Sarvam ${MODEL} (${SPEAKER}, pace ${PACE}, pitch ${PITCH}, ${OUT_SAMPLE_RATE}Hz)`;
}

class SarvamTts {
  constructor({ language = "hi-IN", onError } = {}) {
    this.language = language;
    this.onError = onError || (() => {});
    this.ws = null;
    this.ready = null;
    this.pending = null;
    this.closed = false;
    // Late audio from a sentence abandoned mid-way has to be droppable. Sarvam
    // gives no per-request id to filter on, so a monotonic counter does the same
    // job: a chunk is handed to whoever is current, and anything arriving for an
    // abandoned request finds `pending` has already moved on.
    this.seq = 0;
  }

  connect() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://${SARVAM_HOST}/text-to-speech/ws?model=${encodeURIComponent(MODEL)}`, {
        headers: { "Api-Subscription-Key": process.env.SARVAM_API_KEY },
      });
      this.ws = ws;

      ws.on("open", () => {
        // Config must be the first message on the socket, before any text.
        ws.send(
          JSON.stringify({
            type: "config",
            data: {
              speaker: SPEAKER,
              target_language_code: this.language,
              pace: PACE,
              pitch: PITCH,
              output_audio_codec: "linear16", // raw pcm_s16le — no container to strip
              speech_sample_rate: OUT_SAMPLE_RATE,
            },
          })
        );
        resolve();
      });
      ws.on("message", (raw) => this.handleMessage(raw));
      ws.on("error", (e) => {
        this.onError(`TTS socket error: ${e.message}`);
        reject(e);
      });
      ws.on("close", (code) => {
        this.ws = null;
        this.ready = null;
        // A mid-call close would otherwise leave speak() hanging forever, and a
        // caller hearing nothing with no error is the worst version of this bug.
        if (!this.closed && this.pending) {
          this.pending.reject(new Error(`TTS socket closed mid-sentence (code ${code})`));
          this.pending = null;
        }
      });
    });
    return this.ready;
  }

  handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    const pending = this.pending;
    if (!pending) return; // late audio for a sentence the caller talked over

    if (msg.type === "audio" && typeof msg.data?.audio === "string") {
      pending.onAudio(Buffer.from(msg.data.audio, "base64"));
      // A sentence is finished when the audio STOPS arriving.
      //
      // There is no `final` event on this socket — measured on both models,
      // waiting 8s after a flush produced no non-audio message at all. And the
      // two models chunk completely differently: v2 returns one blob per
      // sentence, v3 returned 62 for the same sentence. So "first chunk means
      // done" was right for v2 and would cut v3 off after its first 90ms.
      //
      // An idle gap is the only signal available. v3 delivers 4.2s of audio in
      // 1.7s wall-clock, so chunks arrive far faster than they play — a quiet
      // stretch this long reliably means the sentence is over, not that the
      // network hiccuped.
      clearTimeout(pending.idle);
      pending.idle = setTimeout(() => {
        if (this.pending?.seq !== pending.seq) return;
        this.pending = null;
        pending.resolve();
      }, IDLE_DONE_MS);
      return;
    }
    if (msg.type === "error") {
      this.pending = null;
      pending.reject(new Error(msg.data?.message || "Sarvam reported a TTS error"));
    }
  }

  /**
   * Speak one sentence.
   * @param {string} text
   * @param {(pcm: Buffer) => void} onAudio - raw pcm_s16le mono @ OUT_SAMPLE_RATE
   * @param {AbortSignal} [signal] - abort to drop it mid-way (barge-in)
   */
  async speak(text, onAudio, signal) {
    if (!text || !text.trim()) return;
    if (signal?.aborted) return;
    await this.connect();
    if (signal?.aborted) return;

    const mine = ++this.seq;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending?.seq !== mine) return;
        this.pending = null;
        this.onError(`TTS timed out waiting for a sentence (${SPEAK_TIMEOUT_MS}ms)`);
        // Resolve rather than reject: whatever arrived has already been played,
        // and the next sentence should still get its turn.
        resolve();
      }, SPEAK_TIMEOUT_MS);

      // Declared before settle() so both the hard timeout and the idle timer can
      // be cleared on every exit path. A stray idle timer would resolve a
      // sentence that was already aborted, letting the next one start early.
      const entry = { onAudio, seq: mine, idle: null };

      const settle = (fn) => (v) => {
        clearTimeout(timeout);
        clearTimeout(entry.idle);
        fn(v);
      };
      resolve = settle(resolve);
      reject = settle(reject);

      entry.resolve = resolve;
      entry.reject = reject;
      this.pending = entry;

      const onAbort = () => {
        if (this.pending?.seq !== mine) return;
        this.pending = null;
        // Resolve, not reject: an interrupted sentence is a normal event on a
        // phone call, not a failure.
        resolve();
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        this.ws.send(JSON.stringify({ type: "text", data: { text } }));
        // ⚠️ NOT OPTIONAL. Sarvam buffers incoming text and only synthesises once
        // it has enough, which is right for a token stream and wrong for us: we
        // hand it one complete sentence at a time and there is no "more" coming.
        //
        // Without this, SHORT lines are never synthesised at all — measured:
        // "जी।" returned nothing in 9s with no error, while a full sentence came
        // back in 0.9s. That is precisely the acknowledgements in fillers.js, so
        // the line whose whole job is to cover the 2.4s gap would instead go
        // silent and hold the serial speech chain until the 12s timeout fired.
        // A 2.4s pause became a 12s dead line, on most turns.
        this.ws.send(JSON.stringify({ type: "flush" }));
      } catch (e) {
        this.pending = null;
        reject(e);
      }
    });
  }

  close() {
    this.closed = true;
    this.pending = null;
    const ws = this.ws;
    this.ws = null;
    this.ready = null;
    if (ws && ws.readyState <= WebSocket.OPEN) {
      try {
        ws.close();
      } catch (e) {
        /* already gone */
      }
    }
  }
}

// ── Demo engine ─────────────────────────────────────────────────────────────
// Produces no audio at all, on purpose.
//
// With no Sarvam key there is no way to make Hindi speech on the server, and a
// beep would prove nothing. Instead the page speaks Sakha's lines with the
// phone's own built-in Hindi voice — it already receives every line as text for
// the transcript, so this costs no extra protocol (see speakOnDevice in m.js).
// The result is a call you can actually hold, in a robotic voice, with no key.
//
// It still takes the time a sentence would take to say. Without that, the relay
// would think it had finished speaking instantly, flip back to "listening", and
// start hearing the phone's own voice as the caller's next turn.
class DemoTts {
  constructor() {
    this.demo = true;
  }

  async speak(text, onAudio, signal) {
    if (!text || signal?.aborted) return;
    // ~13 characters a second, which is roughly Devanagari at a slow pace.
    const ms = Math.min(9000, 700 + (text.length / 13) * 1000);
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
  }

  close() {}
}

// ── The phrase cache ────────────────────────────────────────────────────────
// A handful of lines are byte-identical on every call: the anonymous greeting
// and the acknowledgements in fillers.js. Re-synthesising them per call is paid
// for per call, and an acknowledgement fires on most turns — so a five-turn call
// spends a real share of its characters on audio already bought.
//
// It makes Sakha faster as well as cheaper: a cached line skips the round trip
// entirely, and the acknowledgement is precisely the line whose whole job is to
// land fast.
//
// Deliberately NOT general-purpose. Only exact strings from a known fixed set
// are stored — Claude's replies never repeat, so caching them would grow without
// bound and never be read.
const phraseCache = new Map(); // text -> Buffer[]

export function cacheablePhrases(phrases) {
  for (const p of phrases) if (p && !phraseCache.has(p)) phraseCache.set(p, null);
}

export function phraseCacheStats() {
  let ready = 0;
  for (const v of phraseCache.values()) if (v) ready++;
  return { known: phraseCache.size, ready };
}

/**
 * Buy the fixed lines once at boot so no caller waits for them.
 *
 * Failures are swallowed: a cold cache costs a little latency, but a server that
 * refuses to start because a TTS provider had a slow minute costs the product.
 */
export async function prewarmPhrases(phrases) {
  if (!ttsConfigured()) return { warmed: 0, skipped: "no Sarvam key" };
  const wanted = phrases.filter((p) => p && !phraseCache.get(p));
  if (!wanted.length) return { warmed: 0 };

  const engine = new SarvamTts({ onError: () => {} });
  let warmed = 0;
  try {
    for (const phrase of wanted) {
      try {
        const chunks = [];
        await engine.speak(phrase, (pcm) => chunks.push(pcm), null);
        if (chunks.length) {
          phraseCache.set(phrase, chunks);
          warmed++;
        }
      } catch (e) {
        /* one phrase failing is not worth abandoning the rest */
      }
    }
  } finally {
    engine.close();
  }
  return { warmed };
}

/** Serves the fixed phrases from memory. Same speak() signature, so the relay
 *  cannot tell the difference. */
class CachedTts {
  constructor(engine) {
    this.engine = engine;
    this.demo = Boolean(engine.demo);
  }

  async speak(text, onAudio, signal) {
    const key = text?.trim();
    const cached = key ? phraseCache.get(key) : undefined;

    if (cached) {
      for (const chunk of cached) {
        if (signal?.aborted) return;
        onAudio(chunk);
      }
      return;
    }

    const collecting = key && phraseCache.has(key) ? [] : null;
    await this.engine.speak(
      text,
      (pcm) => {
        if (collecting) collecting.push(pcm);
        onAudio(pcm);
      },
      signal
    );
    // Only store a complete phrase. One cut short by barge-in would otherwise be
    // cached truncated and replayed truncated for the rest of time.
    if (collecting && collecting.length && !signal?.aborted) phraseCache.set(key, collecting);
  }

  close() {
    this.engine.close();
  }
}

export function makeTts({ language = "hi-IN", onError } = {}) {
  const engine = ttsConfigured() ? new SarvamTts({ language, onError }) : new DemoTts();
  return new CachedTts(engine);
}

export { SarvamTts, DemoTts };
