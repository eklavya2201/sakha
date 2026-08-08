// One audio format for the entire call, in both directions.
//
// 16kHz mono pcm_s16le, chosen so there is not a single resample step between
// the elder's microphone and their speaker:
//   - Sarvam STT takes pcm_s16le and we ask it for 16000 (its own batch API
//     wants 16k wav too, so this is its native rate).
//   - Sarvam TTS is 22050 by default, but `speech_sample_rate: 16000` in the
//     config genuinely changes the output — measured, see tts.js.
//   - The browser resamples once from whatever rate its AudioContext gives it,
//     which is the only conversion anywhere in the pipeline.
//
// 16k is also half the bytes of 22.05k over an elder's mobile data, and speech
// loses nothing at this rate. If you change it, change it here only — every
// other file reads it from this one.
export const SAMPLE_RATE = 16000;

/** Silent PCM. Used to pace speech, so the pause is scheduled by the playback
 *  queue exactly like audio rather than by a timer that races it. */
export function silence(ms) {
  return Buffer.alloc(Math.round((SAMPLE_RATE * ms) / 1000) * 2);
}
