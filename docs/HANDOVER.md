# Handover — where Krishna Sakha actually stands

Written to be picked up cold, in another terminal, by someone who was not here
when it was built. Everything below is either verified or explicitly marked as
not verified. Where a decision looks strange, the reason is given — most of the
strange-looking ones are load-bearing.

Companion documents:

- [OPEN-ISSUES.md](OPEN-ISSUES.md) — what is broken or risky, with repros
- [NOT-VERIFIED.md](NOT-VERIFIED.md) — what has never been tested, and why that matters
- [TESTING.md](TESTING.md) — how to check each part, including the Hindi test card
- [ROADMAP-PAID.md](ROADMAP-PAID.md) — payment, retention, and what to build next

---

## What this is

Two ways for a lonely elder to talk to "Sakha", a warm Hindi companion:

1. **WhatsApp voice notes** — the original. Send a voice note, get one back.
2. **A live call in a phone browser at `/m`** — open a link, tap once, talk.
   This is the one worth developing; see [ROADMAP-PAID.md](ROADMAP-PAID.md).

Both share **one brain, one persona and one memory file per person**, so someone
who sends voice notes on Monday and taps Call on Thursday meets a friend who
remembers Monday. That is the product. Everything else is plumbing.

## Run it

```bash
npm install
npm start                 # http://localhost:3005/m
npm run voice:check       # full call path, no microphone or human needed
```

The boot line is the source of truth about what is switched on:

```
Voice calls [live]: Sarvam saarika → Claude (claude-sonnet-5) → Sarvam bulbul:v3 (aditya, pace 1, pitch 0, 24000Hz)
panchang: रविवार, कृष्ण पक्ष एकादशी, मृगशिरा नक्षत्र, श्रावण मास
scripture: 2152 passages (गीता 701, विष्णु पुराण 1451)
```

`[live]` = all three keys present. `[partial]` / `[demo]` = something is missing
and Sakha is faking that part. **The page still runs a whole call in demo mode
with no keys at all** — that is how it was built before the APIs were bought,
and it is the fastest way to tell "our bug" from "their outage".

## The shape of a call

```
Elder taps one button
   → mic → AudioWorklet → 16kHz PCM ──binary WS──► src/voice/relay.js
        ├─► stt.js        Sarvam streaming; ITS VAD decides when a turn ended
        ├─► scripture.js  BM25 over Gita + Purana, ~1ms, no API call
        ├─► rules.js      today's practice customs, gated on ritual intent
        ├─► brain.js      Claude streams a reply, split into sentences
        └─► tts.js        Sarvam bulbul:v3, streamed back
   ◄── 24kHz PCM ──binary WS── speaker
```

`relay.js` decides everything the elder hears — when Sakha starts, when he
stops, what happens when they talk over each other. The providers only hear,
think and speak. `public/voiceClient.js` knows nothing but "PCM over a socket";
if you find yourself editing the browser to accommodate the server, the seam is
in the wrong place.

**Retrieval sits between the transcript and Claude, not as a tool call.** It is
local lexical search, so it costs no round trip on a turn the caller is already
waiting through.

## Code map

| File | What it owns |
|---|---|
| `src/server.js` | WhatsApp webhook, `/m`, `/api/voice/session`, `/healthz` |
| `src/voice/relay.js` | **one live call** — turn lifecycle, barge-in, speech queue, the free-trial meter, teardown |
| `src/voice/session.js` | who is calling, their minute balance, the single-use ticket |
| `src/voice/stt.js` | Sarvam streaming STT (+ a keyless demo engine) |
| `src/voice/tts.js` | Sarvam streaming TTS (+ phrase cache, model/voice compatibility check) |
| `src/voice/brain.js` | Claude streamed by sentence + the after-call review |
| `src/voice/prompt.js` | Sakha's persona **for a call** (shorter turns than WhatsApp) |
| `src/voice/safety.js` | crisis wording — **only** decides whether the meter may end a call |
| `src/voice/scripture.js` | BM25 over `corpus/index.json` |
| `src/voice/panchang.js` | today's tithi/nakshatra/vaar, in Hindi |
| `src/voice/rules.js` | curated vrat/food/auspicious-day custom — **not** scripture |
| `src/memory.js` | per-person JSON: facts, history, **and the minute ledger** |
| `public/m.*` | the phone page: intro → connecting → call → done |

## Decisions that look odd and are not

Each of these cost a debugging session. Please read before "simplifying" them.

- **Audio is binary, not JSON.** Sarvam confirms a turn 0.75s after speech stops
  in isolation and 2.4s inside the running server; the difference was our own
  event loop base64-encoding every frame. See [OPEN-ISSUES.md](OPEN-ISSUES.md) #1
  — this is **not fully solved**.
- **`ws.binaryType = "arraybuffer"` in the browser.** Without it every audio
  frame is silently dropped and the call is totally silent with no error.
- **Every `text` sent to Sarvam TTS is followed by a `flush`.** Without it short
  lines are never synthesised at all — `"जी।"` returned 0 bytes in 9s with no
  error — and they hold the speech queue until the 12s timeout.
- **TTS completion is detected by silence (700ms), not an event.** There is no
  `final` event on that socket. v2 sent 1 chunk per sentence, v3 sends ~65.
- **Only the FIRST audio chunk is faded in.** Fading every chunk was right for
  v2 and became a tremolo through every word on v3.
- **`high_vad_sensitivity` stays off.** It cut an 8.5s sentence to `"राधे राधे।"`
  — it ends a turn the moment someone draws breath, which is how elders speak.
- **Barge-in waits for a transcript, never the speech-start event.** On
  speakerphone Sakha's own voice leaks into the mic and he interrupts himself.
- **Scripture and rules return NOTHING on most turns.** That is correct. Someone
  saying she is lonely wants to be heard, not answered with a verse.
- **A crisis signal disables the free-trial meter.** Not negotiable — see
  `src/voice/safety.js` and [OPEN-ISSUES.md](OPEN-ISSUES.md) #6.

## Keys

Three, and only two matter for `/m`:

| Key | For | Without it |
|---|---|---|
| `SARVAM_API_KEY` | hearing **and** speaking | Sakha is deaf and mute; page falls back to the phone's own voice |
| `ANTHROPIC_API_KEY` | thinking | replies come from a 5-line script |
| `WHATSAPP_TOKEN` + `PHONE_NUMBER_ID` + `VERIFY_TOKEN` | the voice-note half only | `/m` is unaffected |

Deliberately **not** used: Deepgram (its Aura TTS has no Hindi voice at all) and
ElevenLabs (weaker Hindi, and it would make the call voice differ from the
WhatsApp voice). Sarvam is the one provider good at exactly what this product is
made of.
