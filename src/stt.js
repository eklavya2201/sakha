// Sarvam AI speech-to-text (saarika) — built for Indian languages and Hinglish.
export async function transcribe(wavBuf) {
  const form = new FormData();
  form.append("file", new Blob([wavBuf], { type: "audio/wav" }), "audio.wav");
  form.append("model", process.env.SARVAM_STT_MODEL || "saarika:v2.5");
  form.append("language_code", "unknown"); // auto-detect

  const res = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: { "api-subscription-key": process.env.SARVAM_API_KEY },
    body: form,
  });
  if (!res.ok) throw new Error(`Sarvam STT ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { transcript: data.transcript, languageCode: data.language_code || "hi-IN" };
}
