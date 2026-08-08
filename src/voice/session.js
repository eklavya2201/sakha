// Starting a call: work out who is ringing, mint a credential, hand the browser
// a URL. The audio itself never touches this file.
//
// The prompt is deliberately NOT returned to the browser. It is stored against
// the ticket and read back when the socket opens, because the socket terminates
// on our own server — sending Sakha's instructions to the page and trusting them
// back would hand an anonymous caller an edit box for the persona, the
// boundaries and the crisis rules.

import { loadUser } from "../memory.js";
import { buildCallPrompt, buildIntroduction } from "./prompt.js";
import { getPanchang, renderPanchang } from "./panchang.js";
import { mintRelayTicket, RELAY_PATH } from "./relay.js";
import { IN_SAMPLE_RATE, OUT_SAMPLE_RATE } from "./format.js";
import { sttConfigured } from "./stt.js";
import { ttsConfigured, ttsStatusLine } from "./tts.js";
import { brainConfigured, brainStatusLine } from "./brain.js";

/**
 * Indian mobile number → the same key WhatsApp uses (91XXXXXXXXXX), so a call
 * and a voice note from the same person land in the same memory file.
 * Returns null for anything that isn't plausibly one — a call still works, it
 * just won't be remembered.
 */
export function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return null;
}

/**
 * Which parts of Sakha are actually switched on.
 *
 * "demo" is a first-class state, not a failure: the whole call — microphone,
 * socket, turn-taking, playback, the page — runs with no keys at all, using
 * rough energy VAD for turns, a scripted brain, and the phone's own built-in
 * voice. It exists so the flow could be built and demonstrated before any API
 * was bought, and it stays because it is the fastest way to tell "our bug" from
 * "their outage" when a live call breaks.
 */
export function voiceMode() {
  if (sttConfigured() && ttsConfigured() && brainConfigured()) return "live";
  if (!sttConfigured() && !ttsConfigured() && !brainConfigured()) return "demo";
  return "partial";
}

export function voiceStatusLine() {
  const hear = sttConfigured() ? "Sarvam saarika" : "demo VAD (no SARVAM_API_KEY)";
  const think = brainConfigured() ? brainStatusLine() : "demo script (no ANTHROPIC_API_KEY)";
  const speak = ttsConfigured() ? ttsStatusLine() : "the phone's own voice (no SARVAM_API_KEY)";
  return `Voice calls [${voiceMode()}]: ${hear} → ${think} → ${speak}`;
}

/**
 * Everything the browser needs to open the socket.
 *
 * @param {object} opts
 * @param {string|null} opts.phone - typed on the page; identifies the memory
 * @param {string|null} opts.name  - only used if we have never met them
 * @param {string} opts.origin     - this server's own origin, for the ws:// URL
 */
export async function createCallSession({ phone = null, name = null, origin = "" } = {}) {
  const waId = normalizePhone(phone);

  // An unknown number is not an error — it is someone's first call. loadUser()
  // returns an empty memory for anyone it has not met.
  const mem = waId ? await loadUser(waId) : { facts: [], history: [] };
  const caller = { name: name ? String(name).trim().slice(0, 40) : null, facts: mem.facts };

  // Today, once, at the start of the call. It cannot change mid-conversation and
  // computing it here keeps "क्या आज बाल कटवा सकते हैं?" free to answer — no
  // lookup, no tool call, no second of silence.
  //
  // It goes inside the CACHED half of the prompt deliberately: it is identical
  // for every caller all day, so every call after the first reads it from cache
  // rather than paying for it again.
  const panchang = getPanchang();

  const token = mintRelayTicket({
    phone: waId,
    language: process.env.SARVAM_STT_LANGUAGE || "hi-IN",
    systemPrompt: [buildCallPrompt(caller), renderPanchang(panchang)].filter(Boolean).join("\n\n"),
    introduction: buildIntroduction(caller),
    // Kept on the ticket so each turn can match rules against it without
    // recomputing, and so a call spanning midnight keeps the day it started on.
    panchang,
  });

  const wsOrigin = String(origin).replace(/^http/, "ws");
  return {
    mode: voiceMode(),
    signedUrl: `${wsOrigin}${RELAY_PATH}?token=${encodeURIComponent(token)}`,
    expiresInSeconds: 300,
    // The two rates travel to the browser rather than being hardcoded there, so
    // changing either is a one-line change on this side. The microphone runs at
    // the rate the recogniser wants; Sakha's voice comes back at the rate the
    // synthesiser actually produced.
    config: {
      input_format: `pcm_${IN_SAMPLE_RATE}`,
      sample_rate: IN_SAMPLE_RATE,
      output_sample_rate: OUT_SAMPLE_RATE,
    },
    // "device" tells the page to speak Sakha's lines with the phone's own Hindi
    // voice, because with no Sarvam key the server cannot make audio at all.
    voice: ttsConfigured() ? "sarvam" : "device",
    caller: {
      known: Boolean(waId && mem.facts.length),
      name: caller.name,
      remembers: mem.facts.length,
    },
  };
}
