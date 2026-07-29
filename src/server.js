import "dotenv/config";
import express from "express";
import { downloadMedia, uploadAudio, sendVoiceNote, sendText } from "./whatsapp.js";
import { oggToWav, wavToOggOpus } from "./audio.js";
import { transcribe } from "./stt.js";
import { synthesize } from "./tts.js";
import { converse } from "./brain.js";
import { loadUser, saveExchange } from "./memory.js";

const app = express();
app.use(express.json());

const seen = new Set(); // WhatsApp retries webhooks; dedupe by message id

// Webhook verification handshake (Meta calls this once when you set the URL)
app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === process.env.VERIFY_TOKEN
  ) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/webhook", (req, res) => {
  res.sendStatus(200); // ack fast; Meta retries slow responses
  const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message || seen.has(message.id)) return;
  seen.add(message.id);
  if (seen.size > 1000) seen.clear();

  handleMessage(message).catch((err) => console.error("[sakha] failed:", err));
});

async function handleMessage(message) {
  const from = message.from;
  let userText;
  let languageCode = "hi-IN";
  const isVoice = message.type === "audio";

  if (isVoice) {
    const ogg = await downloadMedia(message.audio.id);
    const stt = await transcribe(await oggToWav(ogg));
    userText = stt.transcript;
    languageCode = stt.languageCode;
  } else if (message.type === "text") {
    userText = message.text.body;
  } else {
    return; // stickers, images etc. — ignore for now
  }
  if (!userText?.trim()) return;

  console.log(`[sakha] ${from} (${message.type}): ${userText}`);
  const mem = await loadUser(from);
  const { reply, risk, new_facts } = await converse(userText, mem);
  console.log(`[sakha] reply (risk=${risk}): ${reply}`);

  if (isVoice) {
    const wav = await synthesize(reply, languageCode);
    const mediaId = await uploadAudio(await wavToOggOpus(wav));
    await sendVoiceNote(from, mediaId);
