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
