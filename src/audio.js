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
