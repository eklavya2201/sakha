# 🪈 Krishna Sakha — WhatsApp Voice Companion for Elders

A WhatsApp voice bot for elderly people in India who are lonely or quietly depressed — often unable to share their feelings with their own children. They send a **voice note** in Hindi/Hinglish; **Sakha** (a warm companion inspired by Krishna's friendship with Arjuna) listens, understands, replies with a **voice note**, remembers them across conversations, and quietly watches for emotional-crisis signals.

> Not a scripture Q&A bot. The product is **companionship** — listening, remembering, checking in — with Bhagavad Gita wisdom woven in lightly, only when it fits.

---

## ⚡ Current status (read this first)

**Everything is built and wired. Exactly ONE thing is missing: the Anthropic API key.**

| Piece | Status |
|---|---|
| Code (webhook → STT → Claude → TTS → voice note) | ✅ done, tested |
| Sarvam key (speech-to-text + text-to-speech) | ✅ in `.env`, round-trip verified |
| Meta app "SAKHA" + WhatsApp test number | ✅ created, outbound tested |
| Webhook (callback URL + `messages` subscribed + app subscribed to WABA) | ✅ verified — inbound "hi" reached the server |
| ngrok static tunnel | ✅ `reid-mediatorial-noncreditably.ngrok-free.dev` |
| **Anthropic API key** | ❌ **the only missing piece** |

**To make it fully work:** get a key at console.anthropic.com (needs ~$5 min credits) → open `.env` → set `ANTHROPIC_API_KEY=sk-ant-...` → run `start-sakha.bat` → send a Hindi voice note to the test number. That's it.

> ⚠️ `.env` is NOT in this repo (it holds secrets). Get it from Eklavya privately, or rebuild it from `.env.example` + the values in "Meta/WhatsApp reference" below.

---

## How it works

```
Elder sends WhatsApp voice note (ogg/opus)
   → Meta webhook POST → our Express server (port 3005)
   → download media → ffmpeg → wav
   → Sarvam STT "saarika" (auto-detects Hindi / Hinglish / regional)
   → Claude claude-opus-5:
        persona (cached) + this user's remembered facts + chat history
        returns JSON: { reply, risk, new_facts }
   → Sarvam TTS "bulbul" (karun voice, pace 0.9 — calm, slowed for elders)
   → ffmpeg → ogg/opus → upload → reply as WhatsApp voice note
```

- Text messages get text replies (same brain).
- **Memory**: `data/users/<phone>.json` — durable facts (grandchildren's names, the son who doesn't call, knee pain) + last ~12 exchanges, injected into every conversation. Memory is what turns a bot into a relationship.
- **Safety**: every message is classified `none / distress / crisis`. On `crisis` (self-harm signals, incl. Hindi idioms), the voice reply stays warm and mentions **Tele-MANAS 14416**; a text with **14416** and **Elder Line 14567** is also sent so the numbers persist on screen. The persona hard-blocks medical/financial advice and future predictions, and never claims to *be* God.

## Project structure

```
src/server.js        Express webhook (verify + receive, dedupe, orchestration)
src/whatsapp.js      Cloud API: download/upload media, send voice note / text
src/stt.js           Sarvam speech-to-text (saarika, auto language)
src/tts.js           Sarvam text-to-speech (bulbul, slow calm voice)
src/audio.js         ffmpeg ogg↔wav conversions (ffmpeg-static, no install needed)
src/brain.js         Claude persona + memory + safety classification
src/memory.js        per-user JSON store (facts + history)
scripts/test-sarvam.js  TTS→ffmpeg→STT round-trip test (no WhatsApp needed)
docs/API-SETUP-GUIDE.md how the API keys were obtained (for reference/redo)
start-sakha.bat      one-click: server + ngrok tunnel
.env                 secrets — NOT committed; ask Eklavya
```

## Running it (teammate quick start)

Prereqs: Node 18+, the `.env` file (from Eklavya), ngrok installed **and logged into Eklavya's ngrok account** (the static domain belongs to it — see note below).

```sh
git clone https://github.com/eklavya2201/sakha
cd sakha
npm install
# put .env in the project root, add ANTHROPIC_API_KEY
start-sakha.bat        # opens 2 windows: server (port 3005) + ngrok tunnel
```

Then from a **verified test phone** (currently +91 7208530905), message the test number **+1 555-145-3364** on WhatsApp:
- send a voice note → get a voice note back in Sakha's voice
- send text → get text back
- watch the "Sakha server" window: every message logs as `[sakha] <phone> (audio|text): <transcript>`

Test the audio pipeline alone (needs only the Sarvam key):

```sh
node scripts/test-sarvam.js    # writes sample-reply.wav — listen to Sakha's voice
```

### Things that WILL bite you (read before debugging)

| Symptom | Cause / fix |
|---|---|
| WhatsApp API returns 401 / "Session has expired" | The **temporary Meta token dies every ~24h**. Get a fresh one: Meta dashboard → SAKHA app → WhatsApp → API Setup → copy Access token → paste into `.env` `WHATSAPP_TOKEN` → restart server |
| Port 3005? not 3000? | 3000 is occupied by another project on Eklavya's machine. `.env` sets `PORT=3005` and the bat file tunnels 3005. Keep them in sync if you change it |
| ngrok fails: "endpoint already online" | Someone else (or another window) is already running the tunnel on this domain. Close the other one |
| ngrok fails: domain not authorized | The static domain belongs to Eklavya's ngrok account. Either use his authtoken (`ngrok config add-authtoken ...`) or claim your own free static domain and update BOTH `start-sakha.bat` and the Meta webhook callback URL |
| Messages don't reach the server at all | Check the ngrok window for incoming POSTs. If nothing arrives: (1) server+tunnel must be running, (2) the app must be subscribed to the WABA — re-run: `curl -X POST "https://graph.facebook.com/v23.0/1345800221066824/subscribed_apps" -H "Authorization: Bearer <WHATSAPP_TOKEN>"` |
| A new phone gets no replies | Only **verified recipients** can talk to the test number (free tier, max 5). Add: Meta dashboard → WhatsApp → API Setup → "To" field → add number + OTP |
| Claude call fails | `ANTHROPIC_API_KEY` missing/empty in `.env`, or credits exhausted |

### Meta/WhatsApp reference (our live config)

| Thing | Value |
|---|---|
| Meta app | SAKHA (app id `1048986851331467`) |
| WhatsApp Business Account (WABA) id | `1345800221066824` |
| Test number | +1 555-145-3364 |
| Phone Number ID (goes in `.env`) | `1315841411603828` |
| Verified recipient(s) | +91 7208530905 |
| Webhook callback | `https://reid-mediatorial-noncreditably.ngrok-free.dev/webhook` |
| Verify token | `sakha-verify` |
| Subscribed webhook field | `messages` |

## 📊 Progress

| Date | Milestone | Status |
|---|---|---|
| 2026-07-26 | Idea → pivoted to elder-companionship focus | ✅ |
| 2026-07-26 | Full MVP pipeline scaffolded + smoke-tested | ✅ |
| 2026-07-26 | Sarvam key live — TTS/STT round-trip verified (near-perfect Hindi) | ✅ |
| 2026-07-26 | ngrok static domain wired + one-click `start-sakha.bat` | ✅ |
| 2026-07-27 | Meta app SAKHA created, test number claimed, outbound template delivered | ✅ |
| 2026-07-27 | Webhook verified + `messages` subscribed + app↔WABA subscription fixed | ✅ |
| 2026-07-27 | **Inbound proven**: "hi" from +91 phone reached server, failed only at missing Claude key | ✅ |
| 2026-07-29 | Repo `eklavya2201/sakha` (private), 30-commit history | ✅ |
| — | Anthropic API key (~$5 credits) | ⏳ **only blocker** |
| — | First end-to-end voice conversation on WhatsApp | ⏳ next |
| — | Persona tuning with real elder testers (family pilot, 5–10 users) | ⏳ next |

## 🗺️ Future plans

**Phase 1 — working MVP (now)**
- [ ] Anthropic key in → first live voice conversation
- [ ] `test-chat.js` CLI to tune persona quality without WhatsApp
- [ ] Family pilot: 5–10 real elders; log what they actually talk about (expect: 80% loneliness/family, 15% health, 5% scripture)

**Phase 2 — the retention engine**
- [ ] **Proactive morning message** — shloka of the day + "Kaise ho aaj?" via approved WhatsApp template (paid, opens the 24h reply window)
- [ ] Follow-ups on remembered things: "Kal Rahul ka phone aaya tha?"
- [ ] Festival & Ekadashi awareness (panchang as a computed tool — never LLM-guessed dates)
- [ ] Onboarding: language, tradition/sampradaya, family contact for crisis escalation (with elder's consent)

**Phase 3 — product & scale**
- [ ] Permanent Meta token (System User) + business verification + real WhatsApp number
- [ ] Deploy to a server (AWS EC2) — no laptop/ngrok
- [ ] SQLite/Postgres instead of JSON files; conversation analytics
- [ ] Family dashboard: "Maa talked today, mood seemed okay" — strictly consent-first
- [ ] Regional languages beyond Hindi (Sarvam supports 10+); female voice option

**Phase 4 — monetization (validate first)**
- [ ] Subscription ₹99–199/mo paid by children (free tier: limited daily conversation)
- [ ] Festival premium packs, puja-booking referrals — the Astrotalk/Sri Mandir playbook

## Costs

| Service | Cost |
|---|---|
| WhatsApp Cloud API | Free (replies within 24h window are free; only phase-2 templates cost) |
| Sarvam STT/TTS | Free signup credits |
| ngrok | Free (static dev domain) |
| Anthropic Claude | ~$5 min credits; ~₹1–2 per exchange on Opus 5 (persona cached). Use `CLAUDE_MODEL=claude-haiku-4-5` in `.env` for cheap plumbing tests |

## Key risks / design rules

1. **STT on elderly speech** is the make-or-break technical risk — validate with real elders early (slow, dialect-heavy, noisy audio).
2. **Never let "Krishna" say something harmful.** One viral screenshot ends the product. Safety classification runs on every message; boundaries live in the persona; crisis → human helplines.
3. **Don't claim to be God** — Sakha is a companion *inspired by* Krishna's friendship. Regional/sampradaya differences must be user-configurable, never assumed.
4. **Secrets stay out of git** — `.env`, `data/`, audio files are gitignored. Share keys over private DMs only.
