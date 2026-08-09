// Preflight for the phone call: `npm run voice:check`.
//
// Impersonates the browser end to end — mints a session, opens the relay socket,
// listens for Sakha's greeting, then feeds recorded Hindi speech in real time as
// if someone were talking, and waits for the transcript and the reply.
//
// It exists because the alternative way to find out that a call is broken is to
// hand a phone to an elderly person and watch. Every stage below is reported
// separately, with timings, so a failure names the provider that caused it
// instead of "the call didn't work".
//
// Boots its own server on a spare port and kills it afterwards, so it is one
// command and it cannot collide with an instance you already have running.

import "dotenv/config";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import ffmpegPath from "ffmpeg-static";
import { allFixedPhrases } from "../src/voice/fillers.js";

// The acknowledgement Sakha speaks while Claude is still writing is a real
// agent line, so counting lines alone let this check pass on "हम्म…" without
// Claude ever having answered — which is the single thing stage 5 exists to
// prove. Exclude the fixed phrases and wait for something Claude actually wrote.
const FILLERS = new Set(allFixedPhrases());

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.VOICE_CHECK_PORT || 3099);
const BASE = `http://127.0.0.1:${PORT}`;
const SAMPLE = join(ROOT, "sample-reply.wav");

const IN_RATE = 16000;   // what we feed the recogniser
const OUT_RATE = Number(process.env.VOICE_OUT_SAMPLE_RATE || 24000); // what Sakha is synthesised at
const FRAME_BYTES = 2048; // 1024 samples ≈ 64ms, same as the browser sends

let failures = 0;
const t0 = Date.now();
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => {
  failures++;
  console.log(`  ❌ ${m}`);
};
const info = (m) => console.log(`     ${m}`);

function waitFor(predicate, ms, what) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (predicate()) {
        clearInterval(tick);
        resolve(Date.now() - started);
      } else if (Date.now() - started > ms) {
        clearInterval(tick);
        reject(new Error(`timed out after ${ms}ms waiting for ${what}`));
      }
    }, 50);
  });
}

async function bootServer() {
  const child = spawn(process.execPath, [join(ROOT, "src", "server.js")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d.toString()));
  child.stderr.on("data", (d) => (log += d.toString()));

  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/m`);
      if (res.ok) return { child, log: () => log };
    } catch (e) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error(`server did not start on ${PORT}:\n${log}`);
}

async function callerAudio() {
  // Sakha's own recorded voice, used as the caller. It is real Hindi speech at a
  // realistic level, which is what the recogniser and its VAD need — synthetic
  // tones prove nothing about either.
  const out = join(ROOT, ".voice-check.raw");
  await run(ffmpegPath, ["-y", "-i", SAMPLE, "-ar", String(IN_RATE), "-ac", "1", "-f", "s16le", out]);
  const buf = await readFile(out);
  await unlink(out).catch(() => {});
  return buf;
}

async function main() {
  console.log("\n🪈 Sakha — phone call preflight\n");

  console.log("1. Server");
  const { child, log } = await bootServer();
  ok(`booted on ${PORT}`);
  const mode = /Voice calls \[(\w+)\]/.exec(log())?.[1] || "unknown";
  info((log().split("\n").find((l) => l.startsWith("Voice calls")) || "").trim());
  if (mode === "demo") info("no keys set — turns are real, the words are scripted");

  try {
    console.log("\n2. Session");
    const res = await fetch(`${BASE}/api/voice/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "9999999999", name: "जाँच" }),
    });
    const session = await res.json();
    if (!res.ok) throw new Error(session.error || `HTTP ${res.status}`);
    ok(`ticket minted, mode=${session.mode}, voice=${session.voice}`);
    if (session.caller.known) info(`caller is known: ${session.caller.remembers} remembered fact(s)`);

    console.log("\n3. Call");
    const state = {
      ack: false,
      audioBytes: 0,
      agentLines: [],
      callerLines: [],
      states: [],
      error: null,
    };
    const ws = new WebSocket(session.signedUrl);
    ws.on("message", (raw, isBinary) => {
      // Speech comes back as raw binary now; only control messages are JSON.
      if (isBinary) {
        state.audioBytes += raw.length;
        return;
      }
      let m;
      try {
        m = JSON.parse(raw.toString());
      } catch (e) {
        return;
      }
      if (m.event === "ack") state.ack = true;
      else if (m.event === "media_output") state.audioBytes += Buffer.from(m.media.payload, "base64").length;
      else if (m.event === "state") state.states.push(m.state);
      else if (m.event === "error") state.error = m.message;
      else if (m.event === "transcript" && m.final) {
        (m.role === "agent" ? state.agentLines : state.callerLines).push(m.text);
      }
    });

    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
      setTimeout(() => reject(new Error("socket never opened (is the ticket being rejected?)")), 8000);
    });
    ws.send(JSON.stringify({ event: "start", stream_id: "voice-check", config: session.config }));
    await waitFor(() => state.ack, 5000, "ack");
    ok("socket open, ticket accepted");

    // The greeting. Its arrival is what proves the whole outbound path —
    // Claude's prompt, the TTS socket and the audio framing — in one event.
    await waitFor(() => state.agentLines.length > 0, 20000, "Sakha's greeting");
    ok(`greeting: "${state.agentLines[0]}"`);
    if (session.voice === "sarvam") {
      await waitFor(() => state.audioBytes > 0, 20000, "greeting audio");
      // Wait for it to STOP arriving before measuring. bulbul:v3 streams a
      // sentence as ~65 chunks over a couple of seconds, so measuring at the
      // first byte reported 0.3s of a 5.7s greeting and failed the check —
      // an assertion written when v2 returned the whole thing in one blob.
      let stable = 0;
      for (let seen = -1; stable < 800; stable += 100) {
        if (state.audioBytes !== seen) {
          seen = state.audioBytes;
          stable = 0;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      const seconds = state.audioBytes / (OUT_RATE * 2);
      ok(`greeting audio: ${state.audioBytes} bytes ≈ ${seconds.toFixed(1)}s of speech`);
      if (seconds < 0.5) bad("that is too short to be a spoken sentence — check the TTS sample rate");
    } else {
      info("no audio expected — the page speaks Sakha's lines on the phone itself");
    }

    console.log("\n4. Hearing the caller");
    const pcm = await callerAudio();
    info(`feeding ${(pcm.length / (IN_RATE * 2)).toFixed(1)}s of Hindi speech in real time…`);
    const spokeAt = Date.now();
    for (let i = 0; i < pcm.length; i += FRAME_BYTES) {
      if (ws.readyState !== WebSocket.OPEN) break;
      ws.send(pcm.subarray(i, i + FRAME_BYTES), { binary: true });
      await new Promise((r) => setTimeout(r, 64));
    }
    // The number that decides how the call FEELS: how long an elder sits in
    // silence after they stop talking, before Sakha reacts at all. Measured from
    // the last frame of speech, not from the start of it.
    const silentAt = Date.now();
    // Trailing silence, because the end of a turn is defined by silence — the
    // recogniser has nothing to end on if the audio simply stops arriving.
    const quiet = Buffer.alloc(FRAME_BYTES);
    for (let i = 0; i < 30 && ws.readyState === WebSocket.OPEN; i++) {
      ws.send(quiet, { binary: true });
      await new Promise((r) => setTimeout(r, 64));
    }

    try {
      const waited = await waitFor(() => state.callerLines.length > 0, 12000, "a transcript of the caller");
      ok(`heard: "${state.callerLines[0]}"`);
      const gap = (Date.now() - silentAt) / 1000;
      info(`turn confirmed ${gap.toFixed(1)}s after the caller stopped talking (${((Date.now() - spokeAt) / 1000).toFixed(1)}s after they began)`);
      if (gap > 2.5) info(`⚠️  ${gap.toFixed(1)}s of silence is long enough to feel like a dead line — see the latency note in the README`);
      void waited;
    } catch (e) {
      bad(e.message);
      info("nothing was transcribed — check SARVAM_API_KEY and the language on the STT socket");
    }

    console.log("\n5. Replying");
    const realReply = () => state.agentLines.slice(1).filter((l) => !FILLERS.has(l));
    try {
      await waitFor(() => realReply().length > 0, 30000, "a reply Claude actually wrote");
      ok(`replied: "${realReply().join(" ")}"`);
      const acks = state.agentLines.slice(1).filter((l) => FILLERS.has(l));
      if (acks.length) info(`(spoke "${acks[0]}" into the gap first, as intended)`);
      info(`states seen: ${state.states.join(" → ")}`);
    } catch (e) {
      bad(e.message);
    }

    if (state.error) bad(`relay reported: ${state.error}`);

    ws.close();
  } finally {
    child.kill();
  }

  console.log(`\n${failures ? `❌ ${failures} problem(s)` : "✅ the call path works end to end"} (${since()})\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(`\n❌ preflight could not finish: ${e.message}\n`);
  process.exit(1);
});
