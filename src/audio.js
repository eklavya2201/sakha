import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, unlink } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);

async function convert(inputBuf, inExt, outExt, args) {
  const base = join(tmpdir(), `sakha-${randomUUID()}`);
  const inFile = `${base}.${inExt}`;
  const outFile = `${base}.${outExt}`;
  await writeFile(inFile, inputBuf);
  try {
    await run(ffmpegPath, ["-y", "-i", inFile, ...args, outFile]);
    return await readFile(outFile);
  } finally {
    await unlink(inFile).catch(() => {});
    await unlink(outFile).catch(() => {});
  }
}

// WhatsApp voice notes arrive as ogg/opus; Sarvam STT wants 16kHz mono wav.
export function oggToWav(buf) {
  return convert(buf, "ogg", "wav", ["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"]);
}

// Sarvam TTS returns wav; WhatsApp renders ogg/opus as a voice note.
export function wavToOggOpus(buf) {
  return convert(buf, "wav", "ogg", ["-c:a", "libopus", "-b:a", "24k", "-ac", "1"]);
}
