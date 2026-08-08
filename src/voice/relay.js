// One live call: browser ⇄ this relay ⇄ Sarvam + Claude + Sarvam.
//
//     mic → AudioWorklet → PCM ──WS──►  relay.js (here)
//                                          ├─► stt.js    Sarvam, turn detection
//                                          ├─► brain.js  Claude, sentence by sentence
//                                          └─► tts.js    Sarvam bulbul, karun
//     speaker ◄── PCM ◄──WS─────────────────┘
//
// Everything the elder hears is decided in this file: when Sakha starts talking,
// when he stops, and what happens when they talk over each other. The providers
// only hear, think and speak.
//
// public/voiceClient.js knows nothing but "PCM over a WebSocket" — start / ack /
// media_input / media_output / clear — and that is what makes swapping a
// provider a server-side change. If you find yourself editing the browser to
// accommodate this file, the seam is in the wrong place.

import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { IN_SAMPLE_RATE, silence } from "./format.js";
import { makeStt } from "./stt.js";
import { makeTts, ttsConfigured, cacheablePhrases, prewarmPhrases } from "./tts.js";
import { speakReply, speakDemoReply, brainConfigured, reviewCall, MAX_HISTORY } from "./brain.js";
import { pickAcknowledgement, allFixedPhrases } from "./fillers.js";
import { buildIntroduction } from "./prompt.js";
import { findScripture, renderScripture } from "./scripture.js";
import { loadUser, saveCall } from "../memory.js";

export const RELAY_PATH = "/voice/stream";

// Register the lines Sakha repeats across every call so each is bought once and
// replayed thereafter. The anonymous greeting qualifies because it is a fixed
// string; a greeting with someone's name in it is unique per caller and is
// deliberately left out.
cacheablePhrases([buildIntroduction({}), ...allFixedPhrases()]);

/**
 * Buy the repeated lines at boot, so no caller waits for them.
 *
 * OFF in development, on in production, because this is real money on every
 * single boot: the greeting plus five acknowledgements, re-synthesised each time
 * the process starts because the cache lives in memory. While building, the
 * server restarts constantly and no caller is waiting, so that spend buys
 * nothing at all. Deployed it is worth it — and on a free instance that sleeps
 * after 15 minutes, "the first caller after a wake-up" is very often the only
 * caller, usually the person being shown a demo.
 *
 * Force it either way with VOICE_PREWARM=true/false.
 */
export function warmVoiceCache() {
  const setting = process.env.VOICE_PREWARM;
  const wanted = setting === undefined ? process.env.NODE_ENV === "production" : setting === "true";
  if (!wanted) return Promise.resolve({ warmed: 0, skipped: "prewarm off (set VOICE_PREWARM=true to force)" });
  return prewarmPhrases([buildIntroduction({}), ...allFixedPhrases()]);
}

// Echo mode proves the transport with no AI in the path at all, so when a call
// is broken you can answer "is it us or is it them?" with one env var. Read per
// call rather than captured at import, so a preflight can exercise both.
function relayMode() {
  return (process.env.VOICE_RELAY_MODE || "agent").toLowerCase();
}

// A call that never hangs up bills forever. Fifteen minutes is past a real
// conversation with a lonely person and well short of a stuck socket running
// overnight. Elders do talk for a while; this is not the place to be stingy.
const MAX_CALL_MS = Number(process.env.VOICE_MAX_CALL_MS || 15 * 60 * 1000);

// The pause a person leaves at a full stop. Sarvam's `pace` already slows the
// words; this slows the RHYTHM, which is the part that makes speech easy to
// follow when your hearing is going. It goes into the audio stream rather than
// being a timer, so the browser's playback queue schedules it exactly like
// speech — a setTimeout here would race the queue and land in the wrong place.
// Raised from 420 when the words themselves sped up to pace 1.0. This is where
// clarity for an older ear is bought now: the breath between sentences rather
// than dragging out each one. Lively, but never rushing you.
const SENTENCE_PAUSE_MS = Number(process.env.VOICE_SENTENCE_PAUSE_MS || 520);

// Recognised words needed to interrupt Sakha mid-sentence.
//
// ⚠️ Barge-in here waits for a TRANSCRIPT, never for the raw START_SPEECH event,
// and that is not an oversight. On speakerphone — which is how an elder holds a
// phone — Sakha's own voice leaks back into the microphone and fires voice
// activity constantly. Cutting on that signal makes him interrupt HIMSELF: three
// words in, silence. From the caller's side that is "he started talking and then
// stopped", which reads as a broken line.
//
// Sarvam gives no interim results, so the earliest trustworthy signal is the
// finished transcript. The cost is that an interruption only lands once the
// caller has stopped talking. That is the right trade for this product: elders
// interrupt rarely, and an agent that talks over itself is far worse than one
// that finishes its sentence.
const BARGE_IN_MIN_WORDS = Number(process.env.VOICE_BARGE_IN_MIN_WORDS || 2);

// ── Tickets ─────────────────────────────────────────────────────────────────
// Minted by POST /api/voice/session and redeemed here. Short-lived and
// single-use because the URL reaches the browser, so it must be worthless the
// moment it has been used once.
const TICKET_TTL_MS = 5 * 60 * 1000;
const tickets = new Map();

export function mintRelayTicket(payload) {
  const token = randomUUID();
  tickets.set(token, { ...payload, expiresAt: Date.now() + TICKET_TTL_MS });
  // Opportunistic sweep — an endpoint anyone can hit should never accumulate
  // unbounded state just because nobody redeemed what it handed out.
  if (tickets.size > 200) {
    const now = Date.now();
    for (const [k, v] of tickets) if (v.expiresAt < now) tickets.delete(k);
  }
  return token;
}

function redeemTicket(token) {
  const ticket = tickets.get(token);
  if (!ticket) return null;
  tickets.delete(token); // single use
  if (ticket.expiresAt < Date.now()) return null;
  return ticket;
}

function send(ws, message) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(message));
  } catch (e) {
    /* socket died between the check and the write */
  }
}

/**
 * One live call. Owns the STT socket, the TTS socket, the conversation and the
 * turn lifecycle, and tears all of it down exactly once.
 */
class RelayCall {
  constructor(ws, ticket) {
    this.ws = ws;
    this.ticket = ticket;
    this.streamId = null;
    this.stt = null;
    this.tts = null;
    this.history = [];
    // Turn serialisation: a caller who speaks again mid-generation must ABORT
    // the in-flight turn, not race it. Two replies interleaving into one audio
    // queue is unintelligible.
    this.turnSeq = 0;
    this.inFlight = null;
    this.speaking = false;
    this.closed = false;
    this.state = null;
    this.lastAck = null;
    // What was actually said, kept so it can be filed against this person's
    // memory when they hang up. Text only — no audio is written anywhere, on
    // this path or the WhatsApp one.
    this.turns = [];
    // Everything spoken goes through one chain. The TTS socket carries a single
    // request at a time, so two overlapping speak() calls would cut each other
    // off — and the acknowledgement is deliberately spoken WHILE Claude is still
    // writing, which is exactly the overlap that would break it.
    this.speechChain = Promise.resolve();
    this.startedAt = Date.now();
    this.timeout = setTimeout(() => this.stop("call exceeded the maximum duration"), MAX_CALL_MS);
  }

  log(message) {
    console.log(`[sakha:call] (${this.ticket.phone || "anonymous"}) ${message}`);
  }

  // ── Protocol ──────────────────────────────────────────────────────────────

  handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return; // the client only ever sends JSON; anything else is not ours
    }
    switch (msg.event) {
      case "start":
        this.handleStart(msg);
        break;
      case "media_input":
        this.handleAudio(msg);
        break;
      case "stop":
        this.stop("caller hung up");
        break;
      default:
        break;
    }
  }

  handleStart(msg) {
    if (this.streamId) return; // already started; ignore a duplicate
    this.streamId = msg.stream_id || randomUUID();

    const format = msg.config?.input_format;
    if (format && format !== `pcm_${IN_SAMPLE_RATE}`) {
      // Not fatal, but mislabelled audio makes the caller sound slow and deep to
      // the recogniser, which is a miserable thing to debug from a live call.
      this.log(`⚠️ client announced input_format=${format}, expected pcm_${IN_SAMPLE_RATE}`);
    }

    send(this.ws, { event: "ack", stream_id: this.streamId });
    this.log(`call started (${relayMode()} mode)`);

    if (relayMode() === "echo") return;

    this.startAgent().catch((e) => {
      console.error("[sakha:call] could not start:", e.message);
      send(this.ws, { event: "error", message: "सखा से बात शुरू नहीं हो पाई। कृपया फिर से कोशिश कीजिए।" });
      this.stop("agent failed to start");
    });
  }

  async startAgent() {
    this.tts = makeTts({
      language: this.ticket.language || "hi-IN",
      onError: (m) => console.error(`[sakha:call] ${m}`),
    });

    this.stt = makeStt({
      language: this.ticket.language || "hi-IN",
      onSpeechStarted: () => this.handleSpeechStarted(),
      onTurn: (text) => this.handleTurn(text),
      onError: (m) => console.error(`[sakha:call] ${m}`),
    });

    // Speak first. Beyond being the right thing to do when someone picks up,
    // this is what proves the audio round trip: the page treats a socket that
    // closes before any audio arrived as a failed call, not a hang-up.
    this.setState("speaking");
    this.sendAgentText(this.ticket.introduction);
    await this.speak(this.ticket.introduction, null);
    this.setState("listening");
  }

  handleAudio(msg) {
    const payload = msg.media?.payload;
    if (typeof payload !== "string") return;

    if (relayMode() === "echo") {
      // Straight back out. If the caller hears themselves, the transport, the
      // framing and the playback queue are all proven, and anything still broken
      // is above this line.
      send(this.ws, { event: "media_output", media: { payload } });
      return;
    }
    this.stt?.write(Buffer.from(payload, "base64"));
  }

  // ── Turn taking ───────────────────────────────────────────────────────────

  // Tell the page what Sakha is doing so it can show it. Cheap, and it is the
  // difference between "सोच रहे हैं…" and a screen that looks frozen — which,
  // on a pipeline that needs a couple of seconds to answer, is the entire
  // difference in how the wait feels.
  setState(state) {
    if (this.state === state) return;
    this.state = state;
    send(this.ws, { event: "state", state });
  }

  // Send a finished line to the page AND keep it. One helper rather than a
  // `send` next to a `push` at each place Sakha speaks: those drift apart, and a
  // transcript missing the lines the caller actually heard is worse than none.
  sendAgentText(text) {
    if (!text) return;
    send(this.ws, { event: "transcript", role: "agent", text, final: true });
    this.turns.push({ role: "agent", text, at: new Date().toISOString() });
  }

  // Raw voice activity. Deliberately does NOT cut the reply — see the note on
  // BARGE_IN_MIN_WORDS. Kept because it is still the earliest sign someone is
  // there, and the page uses it to show that Sakha is hearing them.
  handleSpeechStarted() {
    if (!this.speaking) send(this.ws, { event: "hearing" });
  }

  handleBargeIn(heardText) {
    if (!this.speaking) return;
    // Two things must happen and neither is enough alone: stop generating and
    // synthesising here, and tell the browser to throw away what it has already
    // buffered — otherwise Sakha keeps talking over them for as long as the
    // playback queue is deep.
    this.log(`caller spoke over the reply ("${heardText.slice(0, 30)}") — cutting it`);
    this.abortTurn();
    send(this.ws, { event: "clear" });
  }

  abortTurn() {
    if (this.inFlight) {
      this.inFlight.abort();
      this.inFlight = null;
    }
    this.speaking = false;
  }

  async handleTurn(text) {
    if (!text || this.closed) return;

    if (this.speaking && text.trim().split(/\s+/).length >= BARGE_IN_MIN_WORDS) {
      this.handleBargeIn(text);
    }

    send(this.ws, { event: "transcript", role: "caller", text, final: true });
    this.turns.push({ role: "caller", text, at: new Date().toISOString() });

    const myTurn = ++this.turnSeq;
    this.abortTurn();
    const controller = new AbortController();
    this.inFlight = controller;

    this.history.push({ role: "user", content: text });
    if (this.history.length > MAX_HISTORY) this.history = this.history.slice(-MAX_HISTORY);

    this.speaking = true;
    this.setState("thinking");

    // Say something NOW, while Claude is still writing. Deliberately not
    // awaited: the whole point is that it plays during generation, and the
    // speech chain keeps the ordering correct anyway.
    const ack = pickAcknowledgement(text, this.lastAck);
    if (ack) {
      this.lastAck = ack;
      this.sendAgentText(ack);
      this.speak(ack, controller.signal);
    }

    try {
      const onSentence = async (sentence) => {
        if (myTurn !== this.turnSeq) return;
        this.setState("speaking");
        this.sendAgentText(sentence);
        await this.speak(sentence, controller.signal);
      };

      // Look for scripture that speaks to what they just said. This sits
      // BETWEEN the transcript and Claude on purpose: it is a local lexical
      // search that finishes in about a millisecond, so it costs no API call and
      // adds nothing measurable to a gap that is already 2.4 seconds. An
      // embedding lookup here would have been a second of extra silence on every
      // single turn.
      //
      // Most turns find nothing, and that is the intended result — someone
      // saying she is lonely wants to be heard, not answered with a verse.
      const passages = findScripture(text);
      if (passages.length) this.log(`scripture offered: ${passages.map((p) => p.cite).join(", ")}`);

      const spoken = brainConfigured()
        ? await speakReply({
            systemPrompt: this.ticket.systemPrompt,
            context: renderScripture(passages),
            history: this.history,
            signal: controller.signal,
            onSentence,
          })
        : await speakDemoReply({ signal: controller.signal, onSentence });

      if (spoken && myTurn === this.turnSeq) this.history.push({ role: "assistant", content: spoken });
    } catch (e) {
      if (e.name !== "AbortError" && !controller.signal.aborted) {
        console.error("[sakha:call] turn failed:", e.message);
        // Say something rather than going silent. Silence on a phone call is
        // indistinguishable from the line being dead, and an elder will hang up.
        await this.speakSentence("माफ़ कीजिए, मैं वह सुन नहीं पाया। ज़रा फिर से कहिए।", null).catch(() => {});
      }
    } finally {
      if (myTurn === this.turnSeq) {
        this.speaking = false;
        this.inFlight = null;
        this.setState("listening");
      }
    }
  }

  // Queue something to say. Returns a promise that settles when it has finished
  // being synthesised, so callers can apply backpressure — but callers that do
  // NOT await it (the acknowledgement) still get correct ordering.
  speak(text, signal) {
    this.speechChain = this.speechChain
      .then(() => this.speakSentence(text, signal))
      .catch((e) => {
        if (e?.name !== "AbortError") console.error("[sakha:call] speech failed:", e.message);
      });
    return this.speechChain;
  }

  async speakSentence(text, signal) {
    if (!text || !this.tts || this.closed) return;
    await this.tts.speak(
      text,
      (pcm) => {
        if (signal?.aborted || this.closed) return;
        send(this.ws, { event: "media_output", media: { payload: pcm.toString("base64") } });
      },
      signal
    );
    if (SENTENCE_PAUSE_MS > 0 && !signal?.aborted && !this.closed && !this.tts.demo) {
      send(this.ws, { event: "media_output", media: { payload: silence(SENTENCE_PAUSE_MS).toString("base64") } });
    }
  }

  // ── Teardown ──────────────────────────────────────────────────────────────

  /**
   * File the finished call against this person's memory — the same file the
   * WhatsApp bot reads and writes.
   *
   * Fire-and-forget by design. stop() runs on socket close, where there is
   * nothing left to await into, and a disk write that fails must never keep a
   * call from tearing down: a call that will not end holds an STT socket, a TTS
   * socket and a timer open.
   *
   * A caller who gave no phone number has no memory to write to, and nothing is
   * stored at all. That is the intended outcome, not a gap — with no identity
   * there is no next call to inform.
   */
  persist(reason) {
    if (!this.ticket.phone || !this.turns.length) return;
    const phone = this.ticket.phone;
    const turns = this.turns;

    (async () => {
      const mem = await loadUser(phone);
      const { new_facts, risk, summary } = await reviewCall({ turns, knownFacts: mem.facts });
      await saveCall(phone, mem, turns, new_facts);
      console.log(
        `[sakha:call] (${phone}) saved ${turns.length} turns, ${new_facts.length} new fact(s), risk=${risk}${
          summary ? ` — ${summary}` : ""
        }`
      );
      // Loud on purpose. This is the line a human should be able to grep for.
      if (risk === "crisis") {
        console.warn(`[sakha:call] ⚠️  CRISIS SIGNAL on the call with ${phone}. Someone should follow up.`);
      }
    })().catch((e) => console.error("[sakha:call] could not save the call:", e.message));
  }

  stop(reason) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timeout);
    this.abortTurn();
    try {
      this.stt?.close();
    } catch (e) {
      /* noop */
    }
    try {
      this.tts?.close();
    } catch (e) {
      /* noop */
    }
    const seconds = Math.round((Date.now() - this.startedAt) / 1000);
    this.log(`call ended after ${seconds}s (${reason})`);
    this.persist(reason);
    if (this.ws.readyState <= WebSocket.OPEN) {
      try {
        this.ws.close();
      } catch (e) {
        /* noop */
      }
    }
  }
}

/**
 * Mount the relay on the existing HTTP server.
 *
 * `noServer` rather than letting ws own a port: the relay must be reachable on
 * the same origin as the page — it goes through the same ngrok tunnel the
 * WhatsApp webhook uses, and a second listener would need a second tunnel.
 */
export function attachVoiceRelay(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });

  server.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    } catch (e) {
      socket.destroy();
      return;
    }
    // Leave every other upgrade alone — this server may grow another one, and
    // silently swallowing them would be a bad afternoon for whoever adds it.
    if (url.pathname !== RELAY_PATH) return;

    const ticket = redeemTicket(url.searchParams.get("token") || "");
    if (!ticket) {
      // 401 before the handshake completes, so the browser reports a clean
      // failure instead of a socket that opens and then dies for no stated reason.
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const call = new RelayCall(ws, ticket);
      ws.on("message", (raw) => call.handleMessage(raw));
      ws.on("close", () => call.stop("socket closed"));
      ws.on("error", (e) => {
        console.error("[sakha:call] socket error:", e.message);
        call.stop("socket error");
      });
    });
  });

  return wss;
}
