# 🪈 Krishna Sakha — WhatsApp Voice Companion for Elders

A WhatsApp voice bot for elderly people in India who are lonely or quietly depressed — often unable to share their feelings with their own children. They send a **voice note** in Hindi/Hinglish; **Sakha** (a warm companion inspired by Krishna's friendship with Arjuna) listens, understands, replies with a **voice note**, remembers them across conversations, and quietly watches for emotional-crisis signals.

> Not a scripture Q&A bot. The product is **companionship** — listening, remembering, checking in — with Bhagavad Gita wisdom woven in lightly, only when it fits.

## Why this product

- India has 150M+ people over 60; loneliness among elders (children moved away, widowhood, emotional invisibility at home) is widespread and rising.
- This generation will never open a "mental health app" — stigma is total. But **talking to God is already their most natural emotional outlet**. Devotion is the culturally accepted interface for emotional expression.
- WhatsApp voice notes are the one digital interface every elder with a smartphone already knows. No app install, no learning curve.
- Paying customer (later): the guilt-carrying son/daughter in Bangalore or abroad who wants someone talking to Maa every day.

## How it works

```
Elder sends WhatsApp voice note (ogg/opus)
   → Meta webhook → download media → ffmpeg → wav
   → Sarvam STT "saarika" (auto-detects Hindi / Hinglish / regional)
   → Claude claude-opus-5:
        persona (cached) + this user's remembered facts + chat history
        returns JSON: { reply, risk, new_facts }
   → Sarvam TTS "bulbul" (karun voice, pace 0.9 — calm, slowed for elders)
   → ffmpeg → ogg/opus → upload → reply as WhatsApp voice note
```

- Text messages get text replies (same brain).
- **Memory**: `data/users/<phone>.json` — durable facts (grandchildren's names, the son who doesn't call, knee pain, upcoming Ekadashi) + last ~12 exchanges, injected into every conversation. Memory is what turns a bot into a relationship.
- **Safety**: every message is classified `none / distress / crisis`. On `crisis` (self-harm signals, incl. Hindi idioms), the voice reply stays warm and mentions **Tele-MANAS 14416**; a text with **14416** and **Elder Line 14567** is also sent so the numbers persist on screen. Persona hard-blocks medical/financial advice and future predictions, and never claims to *be* God.
- Claude call uses structured JSON output, prompt caching on the persona, `effort: low` for voice-snappy latency, and the server-side refusal-fallback beta.

## Project structure

```
src/server.js        Express webhook (verify + receive, dedupe, orchestration)
src/whatsapp.js      Cloud API: download/upload media, send voice note / text
src/stt.js           Sarvam speech-to-text (saarika, auto language)
src/tts.js           Sarvam text-to-speech (bulbul, slow calm voice)
src/audio.js         ffmpeg ogg↔wav conversions (ffmpeg-static, no install)
src/brain.js         Claude persona + memory + safety classification
src/memory.js        per-user JSON store (facts + history)
scripts/test-sarvam.js  TTS→ffmpeg→STT round-trip test (no WhatsApp needed)
docs/API-SETUP-GUIDE.md teammate-ready guide to obtain all API keys
start-sakha.bat      one-click: server + ngrok static tunnel
```

## Running it

```sh
npm install
copy .env.example .env   # fill in keys — see docs/API-SETUP-GUIDE.md
start-sakha.bat          # launches server (port 3000) + ngrok tunnel
```

Webhook URL (static, configure once in Meta app → WhatsApp → Configuration):
`https://reid-mediatorial-noncreditably.ngrok-free.dev/webhook` — verify token `sakha-verify`, subscribe to the **messages** field.

Test the audio pipeline alone (only needs the Sarvam key):

```sh
node scripts/test-sarvam.js   # writes sample-reply.wav — listen to Sakha's voice
```

## 📊 Progress

| Date | Milestone | Status |
|---|---|---|
| 2026-07-26 | Idea: Krishna voice bot → pivoted to elder-companionship focus | ✅ |
| 2026-07-26 | Full MVP pipeline scaffolded (webhook → STT → Claude → TTS → voice note) | ✅ |
| 2026-07-26 | Server boot + webhook verification smoke-tested | ✅ |
| 2026-07-26 | Sarvam key live — TTS/STT round-trip verified (near-perfect Hindi transcript) | ✅ |
| 2026-07-26 | ngrok static domain wired + one-click `start-sakha.bat` | ✅ |
| 2026-07-26 | API setup guide written for teammate (`docs/API-SETUP-GUIDE.md`) | ✅ |
| — | Anthropic API key (~$5 credits) | ⏳ pending |
| — | Meta app + WhatsApp token + Phone number ID (teammate; blocked once on "account too new") | ⏳ pending |
| — | First end-to-end voice conversation on WhatsApp | ⏳ next |
| — | Persona tuning with real elder testers (family pilot, 5–10 users) | ⏳ next |

## 🗺️ Future plans

**Phase 1 — working MVP (now)**
- [ ] Keys in `.env`, webhook configured, first live voice note
- [ ] `test-chat.js` CLI to tune persona quality without WhatsApp
- [ ] Family pilot: 5–10 real elders; log what they actually talk about (expect: 80% loneliness/family, 15% health, 5% scripture)

**Phase 2 — the retention engine**
- [ ] **Proactive morning message** — shloka of the day + "Kaise ho aaj?" via approved WhatsApp template (paid, opens the 24h reply window)
- [ ] Follow-ups on remembered things: "Kal Rahul ka phone aaya tha?" — proactive care is the emotional hole this product fills
- [ ] Festival & Ekadashi awareness (panchang data as a tool — computed, never LLM-guessed)
- [ ] Onboarding: language, tradition/sampradaya, family contact for crisis escalation (with elder's consent)

**Phase 3 — product & scale**
- [ ] Permanent Meta token + business verification + real WhatsApp number
- [ ] Deploy to a server (AWS EC2, same pattern as Synqit) — no laptop/ngrok
- [ ] Postgres/SQLite instead of JSON files; conversation analytics (PostHog)
- [ ] Family dashboard: "Maa talked today, mood seemed okay" — strictly consent-first
- [ ] Regional languages beyond Hindi (Sarvam supports 10+); female voice option (dadi may prefer a sakhi)

**Phase 4 — monetization (validate first)**
- [ ] Subscription ₹99–199/mo paid by children (free tier: limited daily conversation)
- [ ] Festival premium packs (Navratri/Shravan guides), puja-booking referrals — the Astrotalk/Sri Mandir playbook

## Costs (testing)

| Service | Cost |
|---|---|
| WhatsApp Cloud API | Free (replies within 24h window are free; only phase-2 templates cost) |
| Sarvam STT/TTS | Free signup credits |
| ngrok | Free (static dev domain) |
| Anthropic Claude | ~$5 minimum credits; ~₹1–2 per exchange on Opus 5 (persona cached). Use `CLAUDE_MODEL=claude-haiku-4-5` for cheap plumbing tests |

## Key risks / design rules

1. **STT on elderly speech** is the make-or-break technical risk — validate with real elders early (slow, dialect-heavy, noisy phone audio).
2. **Never let "Krishna" say something harmful.** One viral screenshot ends the product. Safety classification is in the main loop, not optional; boundaries are in the persona; crisis → human helplines.
3. **Don't claim to be God** — Sakha is a companion *inspired by* Krishna's friendship. Regional/sampradaya differences (fasting rules, panchang) must be user-configurable, never assumed.
