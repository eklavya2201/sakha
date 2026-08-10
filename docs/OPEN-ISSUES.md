# Open issues

Ordered by what would hurt a real elderly user most. Each has where it lives,
how to reproduce it, and what "fixed" looks like. Nothing here is speculative —
every one was either measured or is a known gap.

---

## 1. Memory is erased on every restart when deployed free — **fix built, needs a database provisioned**

**Severity: this kills the product, not just a feature.**

Render's free tier has no persistent disk. `data/users/<phone>.json` is wiped on
every deploy and every wake from sleep. An elder who tells Sakha about her
grandson on Tuesday meets a stranger on Wednesday.

Memory *is* the product. Everything else — the voice, the scripture, the
panchang — is replaceable; being remembered is not.

**The fix now exists:** set `DATABASE_URL` to any Postgres and `src/memory.js`
keeps each person's memory in one `jsonb` row instead of a file. Same shape,
same normalized phone key, nothing outside the module knows. If the database is
unreachable mid-call it warns loudly and falls back to the local file rather
than crashing a call in progress. The boot line and `/healthz` report which
store is live (`"memory":"postgres"`).

Verified against a real local Postgres 16 (2026-08-10): facts, history and the
minute ledger survive a wiped-files fresh-process "redeploy"; `grantMinutes`
credits correctly; unreachable-DB fallback works; `npm run voice:check` passes
end to end with `DATABASE_URL` set.

- **Where:** `src/memory.js`, `render.yaml` (`DATABASE_URL` env var)
- **Still to do (human):** provision a Postgres (Render free Postgres / Neon /
  Supabase), set `DATABASE_URL` in the Render dashboard, deploy, then confirm
  `/healthz` says `"memory":"postgres"` and a fact survives a redeploy
- **Not yet verified:** a *hosted* Postgres — the TLS branch of the connection
  code is reasoned, not tested (see [NOT-VERIFIED.md](NOT-VERIFIED.md))
- **Do not ship to real elders before the deployed check is done**

---

## 2. Turn latency: 2.4s, and ~1.6s of it is still unexplained

Measured, twice, consistently:

| | speech ends → transcript |
|---|---|
| Sarvam alone, isolated process | **0.75s** |
| Same audio, inside the running server | **2.4s** |

Moving audio to binary frames removed real CPU work but **did not move the
harness number**. So either the remaining cost is elsewhere, or the harness is
flattering itself.

**Leading hypothesis:** `npm run voice:check` feeds audio with
`setTimeout(64ms)`, which drifts ~10% slower than real time, so trailing silence
reaches Sarvam later than it would from a real phone. If that is right, a real
phone is already faster than 2.4s and this issue is smaller than it looks.

- **Where:** `src/voice/stt.js`, `scripts/voice-check.js`
- **The instrumentation now exists:** every live turn logs
  `[stt] turn latency: transcript +Xms after END_SPEECH, +Yms after last audio frame`.
  Mic frames flow continuously, so "after last frame" isolates our send path and
  "after END_SPEECH" is Sarvam's share
- **Next step:** read that line on the **deployed** instance from a **real
  phone**. Do not tune anything until that number exists
- **Already ruled out:** `high_vad_sensitivity=true` cut an 8.5s sentence to
  `"राधे राधे।"`. It is not a latency knob, it is a truncation knob

---

## 3. Never tested on a real phone, by anyone building it

Everything verified so far is byte counts and timings from a headless harness.
The following have **never executed once** against real hardware:

- iOS Safari's audio rules — suspended `AudioContext`, the tap-gesture
  requirement, `binaryType` handling
- Whether echo cancellation actually stops Sakha hearing himself on speakerphone
  (the barge-in design assumes it mostly does)
- Whether an elder can find and press the button at all

- **Where:** `public/voiceClient.js`, `public/m.js`
- **Fix:** open `/m` on an actual iPhone and an actual cheap Android, over the
  ngrok tunnel or the deployed URL. `localhost` will not resolve on a phone
- **Watch for:** silence with no error (that is the `binaryType` failure mode),
  and Sakha cutting himself off ~3 words in (that is echo leaking into the mic)

---

## 4. "Laggy" was reported and never definitively diagnosed

A tester said *"still very laggy… not satisfying at all"*. Two completely
different bugs produce that sentence and they have different fixes:

- **Slow to reply** → issue #2 above
- **Janky screen** → the CSS. Three large `filter: blur(58px)` elements
  animating continuously, `backdrop-filter` on cards, and an edge shadow
  rewritten ~12×/second. On a budget Android that is real GPU work

- **Where:** `public/m.html` (`.sky-bg`, `.card`, `.edge`)
- **Next step:** **ask the tester which one it is** before changing anything.
  Fixing the wrong one costs a day and teaches nothing
- **If it is the screen:** drop `backdrop-filter`, replace the animated
  `box-shadow` with an `opacity` transition on a pre-rendered gradient layer,
  and cut the blur radius. All three are cheap changes

---

## 5. Practice rules are a first draft and are not authoritative

`src/voice/rules.js` is North-India-leaning, written from general knowledge, and
**never reviewed by anyone who actually keeps these customs.** Regional and
family variation is real and large.

The design already limits the blast radius — Sakha describes and defers rather
than ruling, every entry carries its tradition and a `varies` level, and he is
told that a caller correcting him is right. But the content itself is unverified.

- **Where:** `src/voice/rules.js`
- **Fix:** correct entries as real calls surface them; that was the stated plan.
  Each rule has an `id`, so a call log naming `hair-weekday` points straight at
  the line to change
- **Never:** let a rule override health. That guard is in `renderRules()` and in
  the persona; keep both

---

## 6. The crisis detector is regex-based and its recall is unmeasured

`src/voice/safety.js` decides one thing only: whether the free-trial meter is
allowed to end a call. It is deliberately over-eager — a false positive costs a
few free minutes, a false negative costs something that cannot be refunded.

It scores 8/8 on a hand-written set, which proves nothing about real distressed
speech, especially transcribed by STT that may mangle exactly the quiet, broken
sentences that matter most.

- **Where:** `src/voice/safety.js`
- **Fix:** as real transcripts accumulate, check them against the pattern and add
  what it missed. **Track misses, not hits**
- **Note:** this is *not* the product's crisis response — the persona handles
  that, speaking Tele-MANAS 14416 aloud. This only guards the meter

---

## 7. Barge-in cannot fire until the caller stops talking

Sarvam gives no interim results, so the earliest trustworthy signal is a
finished transcript. Talking over Sakha therefore does not cut him off until you
stop. Acceptable — elders interrupt rarely, and an agent that talks over itself
is far worse — but it is not the same as real barge-in.

- **Where:** `src/voice/relay.js` (`handleBargeIn`, `BARGE_IN_MIN_WORDS`)
- **Only real fix:** a recogniser with interim results. Deepgram has them and
  worse Hindi; that trade has been rejected once already

---

## 8. Concurrency has never been exercised

Exactly one call at a time has ever run. Each call holds two provider WebSockets
plus a Claude stream, and the free Render instance has **0.1 CPU**. Two
simultaneous calls have not been tried, let alone ten.

- **Where:** `src/voice/relay.js` (one `RelayCall` per socket — no shared state
  between calls, which is the right shape, but untested)
- **Fix:** run `npm run voice:check` from three terminals at once against the
  deployed instance and watch the turn latency
- **Expect:** the free tier to fall over first

---

## 9. The only test fixture is Sakha's own synthetic voice

`sample-reply.wav` is Sarvam TTS output — clean, close-mic, perfectly
articulated. Real callers are the opposite: thin elderly voices, regional
accents, a television in the background, a phone held at chin height.

STT accuracy on that has **never been measured**, and it is the single
assumption the whole product rests on.

- **Fix:** record 10–20 real utterances from actual elderly speakers, keep them
  as fixtures, and check the transcripts by hand
- **Until then:** treat "STT works" as unproven, not as verified

---

## 10. WhatsApp token expires every ~24h

The Meta test-console token dies daily. The symptom is confusing: the WhatsApp
half 401s every morning while `/m` keeps working perfectly.

- **Fix:** a permanent system-user token in the Meta dashboard
- **Or:** drop the WhatsApp half entirely — see [ROADMAP-PAID.md](ROADMAP-PAID.md)

---

## 11. Anonymous callers can reset their own free trial

Clearing the phone field gives a fresh 5-minute call every time. This is
**deliberate**: the page's whole promise is that an elder can talk in one tap
without an account, and hardening it costs more than it saves at this stage.

Revisit only when the trial is actually converting to money.

- **Where:** `src/voice/session.js` (`ANON_CALL_MS`)
