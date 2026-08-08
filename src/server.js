import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadMedia, uploadAudio, sendVoiceNote, sendText } from "./whatsapp.js";
import { oggToWav, wavToOggOpus } from "./audio.js";
import { transcribe } from "./stt.js";
import { synthesize } from "./tts.js";
import { converse } from "./brain.js";
import { loadUser, saveExchange } from "./memory.js";
import { attachVoiceRelay, warmVoiceCache } from "./voice/relay.js";
import { createCallSession, voiceStatusLine, voiceMode } from "./voice/session.js";
import { loadScripture, scriptureStatusLine } from "./voice/scripture.js";
import { panchangStatusLine } from "./voice/panchang.js";
import { ttsSpeakerWarning } from "./voice/tts.js";

const app = express();
app.use(express.json());

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
app.use(express.static(PUBLIC_DIR));

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
  } else {
    await sendText(from, reply);
  }

  // Crisis: also leave the helplines on screen as text, so they persist.
  if (risk === "crisis") {
    await sendText(
      from,
      "आप अकेले नहीं हैं। Tele-MANAS हेल्पलाइन 14416 पर किसी भी समय मुफ़्त बात कर सकते हैं। बुज़ुर्गों के लिए Elder Line: 14567."
    );
  }

  await saveExchange(from, mem, userText, reply, new_facts);
}

// ── Phone calls from the browser ────────────────────────────────────────────
// The other way in: the elder (or, far more often, their son or daughter) opens
// a link on a phone and taps one big button. No app, no WhatsApp, no number to
// save — which matters because the people who most need this are the least
// likely to install anything.

// Five calls per ten minutes per device. Someone starting over after a dropped
// connection stays well inside this; a script does not.
const started = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const hits = (started.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  hits.push(now);
  started.set(ip, hits);
  if (started.size > 500) for (const [k, v] of started) if (!v.some((t) => now - t < 10 * 60 * 1000)) started.delete(k);
  return hits.length > 5;
}

app.post("/api/voice/session", async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "थोड़ी देर रुककर फिर कोशिश कीजिए।" });
  }
  try {
    // Behind ngrok the real protocol is in x-forwarded-proto, not req.protocol —
    // get this wrong and the page tries ws:// from an https:// origin, which the
    // browser blocks as mixed content with a message that names nothing.
    const proto = req.get("x-forwarded-proto") || req.protocol || "http";
    const session = await createCallSession({
      phone: req.body?.phone || null,
      name: req.body?.name || null,
      origin: `${proto}://${req.get("host")}`,
    });
    console.log(
      `[sakha:call] session (${session.caller.known ? `known, ${session.caller.remembers} facts` : "new"}) mode=${session.mode}`
    );
    res.json(session);
  } catch (e) {
    console.error("[sakha:call] session failed:", e.message);
    res.status(502).json({ error: "अभी बात शुरू नहीं हो पा रही। थोड़ी देर में फिर कोशिश कीजिए।" });
  }
});

// The phone page. Its own file rather than a route of anything else — it is a
// different surface with a different design (large type, one button, Hindi).
app.get("/m", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "m.html")));

// The deployed URL is the thing people actually paste into a message, and a
// bare domain answering 404 looks broken to whoever was sent it.
app.get("/", (_req, res) => res.redirect("/m"));

// For the host's health check. Deliberately not "/" — that is a redirect, and a
// checker that does not follow redirects would read it as the service being down.
app.get("/healthz", (_req, res) => res.json({ ok: true, voice: voiceMode() }));

const port = process.env.PORT || 3000;

// An explicit http.Server rather than app.listen(), because the relay is a
// WebSocket endpoint on this same origin and needs the `upgrade` event.
const server = http.createServer(app);
attachVoiceRelay(server);

server.listen(port, () => {
  console.log(`Krishna Sakha listening on http://localhost:${port}`);
  console.log(`Phone page: http://localhost:${port}/m`);
  console.log(voiceStatusLine());
  // Indexed once, in memory, before the first caller. Missing corpus is not an
  // error — Sakha without scripture is still Sakha, he just cannot cite.
  loadScripture()
    .then(() => console.log(scriptureStatusLine()))
    .catch((e) => console.warn(`⚠️  Could not load scripture: ${e.message}`));
  console.log(panchangStatusLine());
  // A mismatched model/voice pair 400s at synthesis time, which presents as a
  // completely silent call rather than as an error. Say it loudly at boot.
  const speakerWarning = ttsSpeakerWarning();
  if (speakerWarning) console.warn(`⚠️  ${speakerWarning}`);
  if (voiceMode() === "demo") {
    console.log("  ↳ demo mode: no keys needed. Turns are detected from real speech, the words are scripted.");
  }
  // Buy the greeting and the acknowledgements once, now, rather than making the
  // first caller wait for each. Not awaited: a provider having a slow minute
  // must not hold up the server accepting requests.
  warmVoiceCache()
    .then((r) => r.warmed && console.log(`Voice: pre-synthesised ${r.warmed} repeated line(s).`))
    .catch((e) => console.warn(`⚠️  Could not pre-warm the voice cache: ${e.message}`));
});
