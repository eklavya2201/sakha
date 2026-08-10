# What has NOT been verified

A separate list from [OPEN-ISSUES.md](OPEN-ISSUES.md) on purpose. Those are
things known to be wrong. These are things **nobody has ever checked** — which
is more dangerous, because they currently read as working.

If you are about to put this in front of a real elderly person, read this page
first. It is the honest inventory of what could embarrass you.

---

## Verified, and how

So the rest of the page has a baseline. These are genuinely measured:

| Claim | Evidence |
|---|---|
| The call path works end to end | `npm run voice:check` — session, socket, greeting, transcript, reply |
| Sarvam hears Hindi correctly | 8.5s of clean Hindi transcribed word-perfect |
| Sakha's audio is complete, not truncated | greeting arrives whole (~6s) after the idle-completion fix |
| Scripture stays quiet when it should | 7/7, with silence-expected cases in the majority |
| Rules stay quiet when they should | 11/11, same design |
| Crisis wording is detected | 8/8 including the negative "बाज़ार से सामान उठा ले आई" |
| The free trial meters, blocks and restores | fresh 200 → spent 402 → granted 200 |
| Panchang matches the real calendar | weekday 40/40; Amavasya gaps 29–30 days |
| The page fits a 375×812 phone | no page scroll, buttons above the fold |
| Memory survives a "redeploy" with `DATABASE_URL` set | real local Postgres 16: write facts + ledger, wipe the files, fresh process reads them back; unreachable-DB fallback warns and uses files; `voice:check` passes with the DB live |

Everything below has **no** row like that.

---

## 1. How it sounds

The audio was accepted by ear over exported `.wav` samples, **not** in a live
call. Nobody has heard the actual pipeline output — the fades, the joins between
the two spoken pieces, the 120ms inter-sentence pause, the acknowledgement
landing before the reply.

Those samples were made by the batch API. The call uses the streaming socket.
They are not the same code path.

## 2. Any real phone

No iPhone. No Android. Not once. Specifically unexercised:

- iOS Safari suspending `AudioContext` even inside a user gesture
- `ws.binaryType = "arraybuffer"` on Safari's WebSocket
- The microphone permission sheet interrupting the flow
- Whether the breathing edge animates smoothly or chugs
- Whether the Google Fonts request succeeds (it is blocked in the dev browser,
  so the Devanagari serif headline has never actually been seen)

## 3. Any real elderly voice

Every STT result comes from `sample-reply.wav`, which is Sarvam's own TTS: clean,
close-mic, perfectly articulated, no background noise. The opposite of the target
user in every dimension that matters.

Unmeasured: thin or breathy voices, regional accents, dentures, a television in
the room, a phone held at chin height, Hinglish code-mixing mid-sentence.

**This is the assumption the entire product rests on.**

## 4. Echo cancellation on speakerphone

The barge-in design assumes the browser's echo cancellation mostly stops Sakha
hearing himself. That assumption has never met a real speaker in a real room.

If it is wrong the symptom is specific and easy to recognise: **Sakha starts a
sentence, gets ~3 words in, and stops.** He is interrupting himself.

## 5. More than one caller at once

One call has ever run at a time. Two provider sockets plus a Claude stream per
call, on an 0.1 CPU free instance.

## 6. A call that lasts a realistic length

The longest exercised call is ~20 seconds. Untested over 10–15 minutes:

- The 15-minute `MAX_CALL_MS` cap firing
- Conversation history reaching `MAX_HISTORY` and rolling
- The TTS socket surviving that long, or reconnecting cleanly
- Memory of a long call being written correctly at the end

## 7. The WhatsApp half, since the voice changed

`src/tts.js` now reads `SARVAM_TTS_MODEL` and `SARVAM_TTS_SPEAKER` from env
because it had `bulbul:v2` hardcoded and would have broken when the call moved to
v3. **The fix is reasoned, not tested** — no voice note has been sent since.

Send one. It is one message and it either comes back in `aditya`'s voice or it
does not.

## 8. Deployment

`render.yaml` is syntactically valid, complete, and **has never been deployed**.
Unknown until it runs: whether the Singapore region behaves, whether 4.5MB of
committed corpus slows the build, whether 0.1 CPU can hold two WebSockets and a
Claude stream at once, and whether the health check passes on a cold start while
the corpus is still indexing.

Also unknown: **a hosted Postgres.** The memory store was verified against a
local Postgres 16 in Docker, which does not use TLS. The `ssl` branch that a
Render/Neon/Supabase connection string takes is reasoned, not tested. After the
first deploy with `DATABASE_URL`, check `/healthz` says `"memory":"postgres"` —
if it does but facts still vanish, look for the loud
`memory: postgres … failed` warnings in the logs; the fallback may be quietly
writing to the doomed local files.

## 9. Whether an elder can use it at all

The whole design rests on assumptions about a user nobody has watched:

- That they will tap a link a relative sent
- That they will grant a microphone permission written in English
- That they will speak to a screen showing one word
- That "बात शुरू कीजिए" reads as an invitation rather than an instruction

**One session watching one real elderly person use this would teach more than
everything else on this page.** Do that before building anything else.
