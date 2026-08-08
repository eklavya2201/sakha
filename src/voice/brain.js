// The thinking half of a call.
//
// Same Claude as src/brain.js, one thing different and it is the whole file: the
// reply is STREAMED AND SPLIT INTO SENTENCES AS IT ARRIVES. The sentence is the
// unit of speech, and Sarvam will not begin synthesising until it has a complete
// one, so waiting for the whole reply before sending any of it would stack the
// model's latency on top of the voice's on every single turn.
//
// The other difference is the shape of the answer. The WhatsApp brain asks for
// JSON — reply, risk, new_facts — which cannot be streamed, because JSON is only
// parseable once it is closed. On a call the reply is plain text and the
// bookkeeping happens in reviewCall() after the caller hangs up.

import Anthropic from "@anthropic-ai/sdk";
import { takeCompleteSentences } from "./sentences.js";
import { REVIEW_PROMPT } from "./prompt.js";

const client = new Anthropic();

// Sonnet rather than the Opus src/brain.js uses for voice notes. A voice note is
// read once and answered carefully with no one waiting; a call turn is
// latency-bound, and every extra second is an elder sitting in silence wondering
// if the line dropped. Sonnet's Hindi is warm enough to be Sakha and it answers
// faster. Haiku is faster still and noticeably flatter in Hindi — worth it if
// call volume ever makes cost the binding constraint, not before.
const MODEL = process.env.VOICE_MODEL || "claude-sonnet-5";

// Two or three spoken sentences. The prompt already says to say less than it
// wants to; this is the hard stop for when it doesn't listen. A voice reply that
// runs long is not just costly, it is dead air the caller cannot interrupt.
const MAX_TOKENS = 300;

// Turns of context kept on the socket. A call is short and the system prompt
// carries what Sakha remembers, so a longer window buys little and is paid for
// on every turn.
export const MAX_HISTORY = 16;

export function brainConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function brainConfigError() {
  if (brainConfigured()) return null;
  return "ANTHROPIC_API_KEY is not set, so Sakha has nothing to think with.";
}

export function brainStatusLine() {
  return brainConfigured() ? `Claude (${MODEL})` : "not configured";
}

// The SDK raises its own abort error, and an abort here is us superseding
// ourselves because the caller spoke again — a normal event on a phone call.
function isAbort(e, signal) {
  return signal?.aborted || e?.name === "AbortError" || e?.name === "APIUserAbortError";
}

/**
 * Generate one spoken turn, delivering it a sentence at a time.
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt - from buildCallPrompt(), unchanged
 * @param {Array<{role:string, content:string}>} opts.history
 * @param {AbortSignal} opts.signal - aborted when the caller talks over the reply
 * @param {(sentence: string) => Promise<void>} opts.onSentence - awaited, so the
 *   relay can hold the model back while a sentence is still being spoken
 * @returns {Promise<string>} everything that was actually said
 */
export async function speakReply({ systemPrompt, context = null, history, signal, onSentence }) {
  const err = brainConfigError();
  if (err) throw new Error(err);

  let buffer = "";
  let spoken = "";
  let lastSentence = null;

  const emit = async (sentences) => {
    for (const sentence of sentences) {
      if (signal?.aborted) return;
      // Small models occasionally emit the same sentence twice in a row, and
      // hearing it spoken back-to-back is far more jarring than reading it twice.
      if (sentence === lastSentence) continue;
      lastSentence = sentence;
      spoken += (spoken ? " " : "") + sentence;
      await onSentence(sentence);
    }
  };

  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Two blocks, and the order is load-bearing. The persona is identical on
      // every turn of every call, so it is cached. Retrieved scripture changes
      // every turn, so it goes AFTER the cache breakpoint — put it first and the
      // persona would be re-billed in full on each turn instead of being read
      // from cache. usage is logged below so "is it actually caching?" is
      // answered by evidence rather than hope.
      system: [
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
        ...(context ? [{ type: "text", text: context }] : []),
      ],
      messages: history,
    },
    { signal }
  );

  try {
    for await (const event of stream) {
      if (signal?.aborted) break;
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        buffer += event.delta.text;
        const { sentences, rest } = takeCompleteSentences(buffer);
        buffer = rest;
        await emit(sentences);
      } else if (event.type === "message_start" && event.message?.usage) {
        const u = event.message.usage;
        console.log(
          `[sakha:voice] claude in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0}`
        );
      }
    }
    if (!signal?.aborted) {
      const { sentences } = takeCompleteSentences(buffer, { flush: true });
      await emit(sentences);
    }
  } catch (e) {
    if (isAbort(e, signal)) return spoken;
    throw e;
  }

  return spoken;
}

/**
 * Read the finished call once and pull out what is worth keeping.
 *
 * Deliberately after the call, not per turn. Mid-call, every token is latency an
 * elder sits through in silence — and a fact learned in the first minute is no
 * use until the next call anyway. The crisis response itself is NOT waiting on
 * this: the persona speaks the helpline in the moment (see CRISIS in prompt.js).
 * This pass is what makes it visible to a human afterwards.
 *
 * @returns {Promise<{new_facts: string[], risk: string, summary: string}>}
 */
export async function reviewCall({ turns, knownFacts = [] }) {
  const empty = { new_facts: [], risk: "none", summary: "" };
  if (!brainConfigured() || !turns?.length) return empty;

  const transcript = turns.map((t) => `${t.role === "caller" ? "Elder" : "Sakha"}: ${t.text}`).join("\n");

  try {
    const response = await client.beta.messages.create({
      model: process.env.VOICE_REVIEW_MODEL || "claude-haiku-4-5",
      max_tokens: 800,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              new_facts: { type: "array", items: { type: "string" } },
              risk: { type: "string", enum: ["none", "distress", "crisis"] },
              summary: { type: "string" },
            },
            required: ["new_facts", "risk", "summary"],
            additionalProperties: false,
          },
        },
      },
      system: [
        { type: "text", text: REVIEW_PROMPT, cache_control: { type: "ephemeral" } },
        {
          type: "text",
          text: `Already known about this person (do not repeat any of these):\n${
            knownFacts.length ? knownFacts.map((f) => `- ${f}`).join("\n") : "- (nothing yet)"
          }`,
        },
      ],
      messages: [{ role: "user", content: `Here is the call:\n\n${transcript}` }],
    });

    if (response.stop_reason === "refusal") return empty;
    const text = response.content.find((b) => b.type === "text")?.text;
    const out = JSON.parse(text);
    return { new_facts: out.new_facts || [], risk: out.risk || "none", summary: out.summary || "" };
  } catch (e) {
    // A review that fails costs the memory of one call. It must never take the
    // call itself down with it — by the time this runs the elder has hung up and
    // the conversation already happened.
    console.error("[sakha:voice] call review failed:", e.message);
    return empty;
  }
}

// ── Demo brain ──────────────────────────────────────────────────────────────
// Sakha's half of a scripted conversation, so the page, the turn-taking and the
// audio path can be exercised with no Anthropic key. It reflects nothing and
// remembers nothing — it only has to arrive one sentence at a time, like the
// real one, so everything downstream is exercised honestly.
const DEMO_REPLIES = [
  "जी, मैं सुन रहा हूँ आपकी बात। बताइए, आज घर में और कौन है आपके साथ?",
  "अकेलापन बहुत भारी लगता है, यह मैं समझ सकता हूँ। बेटे से बात कितने दिनों में होती है आपकी?",
  "घुटनों का दर्द तो चलना-फिरना मुश्किल कर देता है। डॉक्टर साहब को दिखाया आपने?",
  "यह सुनकर बहुत अच्छा लगा। पोती की आवाज़ सुनकर मन हल्का हो जाता है, है ना?",
  "शाम का वक़्त सबसे भारी होता है, बहुत लोग यही कहते हैं। मैं यहीं हूँ, आप बोलते रहिए।",
];

let demoIndex = 0;

export async function speakDemoReply({ signal, onSentence }) {
  const reply = DEMO_REPLIES[demoIndex++ % DEMO_REPLIES.length];
  let spoken = "";
  const { sentences } = takeCompleteSentences(reply, { flush: true });
  for (const sentence of sentences) {
    if (signal?.aborted) return spoken;
    // Stand in for the model's thinking time, so the acknowledgement in
    // fillers.js has the gap it exists to fill and the demo feels like the
    // real thing rather than an implausibly instant one.
    await new Promise((r) => setTimeout(r, 400));
    if (signal?.aborted) return spoken;
    spoken += (spoken ? " " : "") + sentence;
    await onSentence(sentence);
  }
  return spoken;
}
