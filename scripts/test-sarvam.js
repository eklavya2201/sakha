// Round-trip test: Hindi text → Sarvam TTS → wav file → ffmpeg ogg → wav → Sarvam STT → transcript.
// Run: node scripts/test-sarvam.js
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { synthesize } from "../src/tts.js";
import { transcribe } from "../src/stt.js";
import { wavToOggOpus, oggToWav } from "../src/audio.js";

const SAMPLE =
  "राधे राधे! मैं आपका सखा हूँ। आप कैसे हैं? आज मन कैसा है, मुझे बताइए। मैं यहीं हूँ, आपकी बात सुनने के लिए।";

console.log("1. TTS: synthesizing sample Hindi...");
const wav = await synthesize(SAMPLE, "hi-IN");
await writeFile("sample-reply.wav", wav);
console.log(`   ok — sample-reply.wav (${(wav.length / 1024).toFixed(0)} KB). Play it to hear Sakha's voice.`);

console.log("2. ffmpeg: wav -> ogg/opus (WhatsApp voice-note format)...");
const ogg = await wavToOggOpus(wav);
await writeFile("sample-reply.ogg", ogg);
console.log(`   ok — sample-reply.ogg (${(ogg.length / 1024).toFixed(0)} KB)`);

console.log("3. STT: transcribing the ogg back (simulates an incoming voice note)...");
const { transcript, languageCode } = await transcribe(await oggToWav(ogg));
console.log(`   ok — detected ${languageCode}`);
console.log(`   original:   ${SAMPLE}`);
console.log(`   transcript: ${transcript}`);
