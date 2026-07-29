// Sarvam AI text-to-speech (bulbul) — deep, calm Indian voice, slowed for elders.
export async function synthesize(text, languageCode = "hi-IN") {
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": process.env.SARVAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: text.slice(0, 1400),
      target_language_code: languageCode,
      speaker: process.env.SARVAM_TTS_SPEAKER || "karun",
      model: "bulbul:v2",
      pace: Number(process.env.SARVAM_TTS_PACE || 0.9),
    }),
  });
  if (!res.ok) throw new Error(`Sarvam TTS ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return Buffer.from(data.audios[0], "base64"); // wav
}
