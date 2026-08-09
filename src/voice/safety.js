// A crisis signal, detected DURING the call rather than after it.
//
// The after-call review in brain.js is the careful one — Claude reads the whole
// transcript and classifies it properly. This is the crude one, and it exists
// for a single purpose: THE FREE-MINUTE TIMER MUST NEVER CUT OFF SOMEONE IN
// CRISIS.
//
// Hanging up on a lonely person at fifteen minutes because their trial expired
// is bad. Doing it in the middle of the sentence where they first admit they do
// not want to live is a different category of thing, and no amount of revenue
// makes it acceptable.
//
// So this runs on every caller turn, in a millisecond, with no API call. It is
// deliberately over-eager: a false positive costs a few minutes of free talk
// time, and a false negative costs something that cannot be refunded. When in
// doubt it should fire.
//
// It is NOT the product's crisis response — the persona handles that, speaking
// the Tele-MANAS number aloud (see CRISIS in prompt.js). This only decides
// whether the meter is allowed to end the call.

// Hindi as it is actually spoken, not as it is written in a safeguarding manual.
// The idioms matter more than the clinical words: almost nobody says "आत्महत्या"
// out loud, and plenty of people say "अब जीने की इच्छा नहीं".
const CRISIS = new RegExp(
  [
    "जीने की इच्छा नहीं",
    "जीने का मन नहीं",
    "जी कर क्या",
    "जीकर क्या",
    "मरना चाहता",
    "मरना चाहती",
    "मर जाऊँ",
    "मर जाउ",
    "मर जाना",
    "मौत आ जाए",
    "मौत आ जाये",
    // Words come BETWEEN the two halves in real speech — "भगवान मुझे उठा ले"
    // was missed by a plain "भगवान उठा ले", which is exactly the phrasing an
    // elder is most likely to use. Allow a short gap.
    "(भगवान|ईश्वर|ऊपरवाला|प्रभु|राम)[^।.!?]{0,24}(उठा ले|बुला ले|ले जाए|ले जाये)",
    "ऊपर बुला ले",
    "मुक्ति दे",
    "ख़त्म कर दूँ",
    "खत्म कर दूँ",
    "ज़िंदगी ख़त्म",
    "जिंदगी खत्म",
    "बोझ हूँ",
    "बोझ बन",
    "किसी को फ़र्क़ नहीं",
    "किसी को फर्क नहीं",
    "कोई मतलब नहीं",
    "सब ख़त्म",
    "हार गया",
    "हार गई",
    "आत्महत्या",
    "जान दे",
    "नींद की गोली",
    "suicide",
    "kill myself",
    "end my life",
    "want to die",
  ].join("|")
);

// Not crisis, but heavy enough that ending the call on a timer would be unkind.
// These only extend the call; they do not trigger any of the crisis response.
const DISTRESS = /(बहुत अकेल|कोई नहीं है|रोता रहता|रोती रहती|कोई पूछता नहीं|छोड़ के चले गए|बहुt दुख|बहुत दुख)/;

/**
 * Should the meter be forbidden from ending this call?
 * @param {string} text - a caller turn, as transcribed
 */
export function looksLikeCrisis(text) {
  return CRISIS.test(String(text || ""));
}

export function looksLikeDistress(text) {
  const t = String(text || "");
  return CRISIS.test(t) || DISTRESS.test(t);
}
