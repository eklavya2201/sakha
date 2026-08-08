// Hearing the caller: Sarvam streaming speech-to-text.
//
// The hard part of a voice agent is not transcription, it is knowing WHEN THE
// CALLER HAS FINISHED TALKING. Answer too early and you cut off an elder drawing
// breath mid-sentence; answer too late and the call feels dead. Sarvam's socket
// does that judgement for us and says so out loud, which is why this file leans
// on its VAD rather than hand-rolling one off frame amplitude.
//
// The wire protocol below was confirmed against the live account, not read off a
// docs page — the reference docs do not state the message shapes. Measured:
//
//   send    {"audio":{"data":<base64 pcm>,"sample_rate":"16000","encoding":"audio/wav"}}
//   recv    {"type":"events","data":{"signal_type":"START_SPEECH","occured_at":…}}
//           {"type":"events","data":{"signal_type":"END_SPEECH","occured_at":…}}
//           {"type":"data","data":{"transcript":"…","language_code":"hi-IN",…}}
//
// `encoding: "audio/wav"` is what the field is called even though we send raw
// PCM; the codec actually comes from ?input_audio_codec=pcm_s16le. Measured
// latency on 8.9s of Hindi: END_SPEECH, then the transcript 0.30s later.
//
// Two signals come out of here and the relay needs both:
//   speechStarted → someone is talking. During playback this may be barge-in.
//   turn          → they finished a thought. Go think and reply.
// There are no interim results, so unlike a Deepgram-style engine there is
// nothing to speculate on: the first text we ever see is the whole turn.

import WebSocket from "ws";
import { SAMPLE_RATE } from "./format.js";

const SARVAM_HOST = "api.sarvam.ai";

// hi-IN by default because that is who this is for. Sarvam wants a concrete
// language on the streaming socket — unlike the batch API in src/stt.js, which
// takes "unknown" and auto-detects. If a caller's family speaks Marathi or
// Bangla at home, set it per deployment rather than hoping detection is kind.
const LANGUAGE = process.env.SARVAM_STT_LANGUAGE || "hi-IN";
const MODEL = process.env.SARVAM_STT_MODEL || "saarika:v2.5";

// Elders pause. They pause mid-sentence to find a word, and they pause because
// they are crying, and both of those are places you must not interrupt. High
// sensitivity makes the socket call the end of a turn sooner, which is exactly
// wrong here, so it is off unless someone deliberately turns it on.
const HIGH_VAD = process.env.SARVAM_STT_HIGH_VAD === "true";

export function sttConfigured() {
  return Boolean(process.env.SARVAM_API_KEY);
}

export function sttConfigError() {
  if (sttConfigured()) return null;
  return "SARVAM_API_KEY is not set, so Sakha cannot hear the caller.";
}

class SarvamStt {
  constructor({ onSpeechStarted, onTurn, onError }) {
    this.onSpeechStarted = onSpeechStarted || (() => {});
    this.onTurn = onTurn || (() => {});
    this.onError = onError || (() => {});
    this.ws = null;
    this.closed = false;
  }

  start() {
    const params = new URLSearchParams({
      "language-code": LANGUAGE, // hyphen, not underscore — the socket 400s on language_code
      model: MODEL,
      mode: "transcribe",
      sample_rate: String(SAMPLE_RATE),
      input_audio_codec: "pcm_s16le",
      vad_signals: "true", // without this there are no START/END_SPEECH events and no turns
      high_vad_sensitivity: String(HIGH_VAD),
    });

    const ws = new WebSocket(`wss://${SARVAM_HOST}/speech-to-text/ws?${params}`, {
      headers: { "Api-Subscription-Key": process.env.SARVAM_API_KEY },
    });
    this.ws = ws;

    ws.on("message", (raw) => this.handleMessage(raw));
    ws.on("error", (e) => {
      // A call that ends before the socket finished connecting is a short call,
      // not a fault. Reporting it just trains people to ignore this log line.
      if (this.closed) return;
      this.onError(`STT socket error: ${e.message}`);
    });
    ws.on("close", (code, reason) => {
      this.ws = null;
      if (!this.closed) this.onError(`STT socket closed unexpectedly (${code} ${reason || "no reason"})`);
    });
    return this;
  }

  handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }

    if (msg.type === "events") {
      if (msg.data?.signal_type === "START_SPEECH") this.onSpeechStarted();
      // END_SPEECH is deliberately NOT the turn. It means the audio went quiet;
      // the words arrive ~300ms later in a `data` message, and replying to an
      // empty turn would have Sakha talk over the transcript of it.
      return;
    }

    if (msg.type === "data") {
      const text = msg.data?.transcript?.trim();
      if (text) this.onTurn(text, msg.data?.language_code || LANGUAGE);
      return;
    }

    if (msg.type === "error") {
      this.onError(`Sarvam STT: ${msg.data?.message || "unknown error"}`);
    }
  }

  /** Feed raw pcm_s16le mono at SAMPLE_RATE. */
  write(pcm) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(
        JSON.stringify({
          audio: { data: pcm.toString("base64"), sample_rate: String(SAMPLE_RATE), encoding: "audio/wav" },
        })
      );
    } catch (e) {
      /* socket died between the check and the write */
    }
  }

  close() {
    this.closed = true;
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) {
      try {
        ws.close();
      } catch (e) {
        /* noop */
      }
    }
  }
}

// ── Demo engine ─────────────────────────────────────────────────────────────
// Hears real audio and detects real turns, but invents the words.
//
// It exists so the whole call — the microphone, the socket, turn-taking, the
// reply, playback, the page — can be built and demonstrated before anybody buys
// an API key, which is the order this was asked to be built in. You talk, it
// notices you talked and notices you stopped, and hands the relay the next line
// from a script of things an elder might actually say.
//
// The VAD is deliberately crude (frame RMS against a fixed floor). Sarvam's is
// better and this is not trying to compete with it — it only has to be right
// often enough that a person testing the page feels the turn land.
const DEMO_TURNS = [
  "नमस्ते बेटा, मैं ठीक हूँ।",
  "आजकल घर में अकेला ही रहता हूँ, बेटा विदेश में है।",
  "घुटनों में दर्द रहता है, पर चल लेता हूँ।",
  "पोती रिया का फ़ोन कल आया था, बहुत अच्छा लगा।",
  "बस, मन थोड़ा भारी रहता है शाम को।",
];

const DEMO_SILENCE_MS = 900; // quiet for this long after speech = end of turn
const DEMO_RMS_FLOOR = 0.02; // ~-34dBFS. Above room tone, below a spoken voice.

class DemoStt {
  constructor({ onSpeechStarted, onTurn }) {
    this.onSpeechStarted = onSpeechStarted || (() => {});
    this.onTurn = onTurn || (() => {});
    this.demo = true;
    this.speaking = false;
    this.quietFor = 0;
    this.index = 0;
  }

  start() {
    return this;
  }

  write(pcm) {
    const samples = pcm.length >> 1;
    if (!samples) return;
    let sum = 0;
    // Every 8th sample: this runs ~20 times a second and only drives a threshold.
    for (let i = 0; i < samples; i += 8) {
      const v = pcm.readInt16LE(i * 2) / 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.ceil(samples / 8));
    const ms = (samples / SAMPLE_RATE) * 1000;

    if (rms > DEMO_RMS_FLOOR) {
      this.quietFor = 0;
      if (!this.speaking) {
        this.speaking = true;
        this.onSpeechStarted();
      }
      return;
    }
    if (!this.speaking) return;
    this.quietFor += ms;
    if (this.quietFor < DEMO_SILENCE_MS) return;

    this.speaking = false;
    this.quietFor = 0;
    this.onTurn(DEMO_TURNS[this.index++ % DEMO_TURNS.length], LANGUAGE);
  }

  close() {}
}

export function makeStt(options) {
  if (!sttConfigured()) return new DemoStt(options);
  return new SarvamStt(options).start();
}

export { SarvamStt, DemoStt };
