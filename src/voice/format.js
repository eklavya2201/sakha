// The audio format of a call. Two rates, not one, and the split is deliberate.
//
// The first version ran everything at 16kHz so there would be no resampling
// anywhere. That is right for the microphone and wrong for Sakha's voice: 16k
// throws away everything above 8kHz, which is the part of speech that carries
// clarity, and it made him sound muffled — the thing you notice immediately and
// cannot name.
//
// So each direction gets the rate that suits it:
//
//   IN  16000  what Sarvam's recogniser wants. Its batch API takes 16k wav and
//              the streaming socket is told sample_rate=16000, so this is its
//              native rate. Higher buys no accuracy and costs an elder's mobile
//              data on every frame, all call long.
//
//   OUT 22050  bulbul's own native rate. Asking for 16k made Sarvam downsample
//              its own output before sending it; asking for 22050 gets what the
//              model actually produced. The browser resamples once on playback,
//              which is free and inaudible — unlike the detail thrown away by
//              synthesising at 16k, which cannot be recovered.
//
// ⚠️ On the TTS side `speech_sample_rate` is the ONLY parameter that changes the
// rate. `output_audio_sample_rate` and `sample_rate` are accepted and silently
// ignored — measured against the live account, don't re-litigate.
export const IN_SAMPLE_RATE = 16000;
export const OUT_SAMPLE_RATE = Number(process.env.VOICE_OUT_SAMPLE_RATE || 22050);

/** Silent PCM at the OUTPUT rate — this only ever goes to the speaker. Used to
 *  pace speech, so the pause is scheduled by the browser's playback queue
 *  exactly like audio rather than by a timer that races it. */
export function silence(ms) {
  return Buffer.alloc(Math.round((OUT_SAMPLE_RATE * ms) / 1000) * 2);
}
