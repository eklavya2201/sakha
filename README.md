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
