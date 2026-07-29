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

