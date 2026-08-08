// What people actually ask: "क्या आज बाल कटवा सकते हैं?", "एकादशी पर चावल चलेगा?"
//
// ⚠️ READ THIS BEFORE EDITING. None of what follows is in the Gita or the
// Puranas. It comes from muhurta and vrata custom, which is regional, family-
// specific, and genuinely contested — a rule kept strictly in one town is
// unheard of two districts away. So every entry carries WHOSE tradition it is
// and how much it varies, and Sakha is required to hand that qualification on.
//
// The design decision behind that: describe and defer. Sakha says what the
// tradition holds and tells them to confirm with their own family or priest. He
// never issues a ruling. An elder may follow what he says strictly, and being
// confidently wrong about someone's dharma is worse than being unsure out loud.
//
// This is a starting set, meant to be corrected by use. If a caller says "हमारे
// यहाँ ऐसा नहीं होता", they are right and this file is wrong.
//
// `varies` is not decoration — it decides how strongly Sakha phrases it:
//   "common" — widely held across North India
//   "varies" — real disagreement between regions or communities
//   "strict" — near-universal; safe to state plainly (still never as a command)

export const RULES = [
  // ── Weekday rules ─────────────────────────────────────────────────────────
  {
    id: "hair-weekday",
    when: { vaar: ["मंगलवार", "गुरुवार", "शनिवार"] },
    topic: /(बाल|कटवा|कटा|नाखून|नाख़ून|हजाम|शेव|दाढ़ी)/,
    text: "मंगलवार, गुरुवार और शनिवार को बाल या नाखून कटवाने से परहेज़ किया जाता है। बुधवार और शुक्रवार शुभ माने जाते हैं।",
    tradition: "उत्तर भारत की सामान्य परंपरा",
    varies: "common",
  },
  {
    id: "hair-tithi",
    when: { tithi: ["एकादशी", "पूर्णिमा", "अमावस्या", "चतुर्दशी"] },
    topic: /(बाल|कटवा|कटा|नाखून|नाख़ून)/,
    text: "एकादशी, पूर्णिमा, अमावस्या और चतुर्दशी को भी बाल-नाखून कटवाने से बचा जाता है।",
    tradition: "सामान्य परंपरा",
    varies: "common",
  },
  {
    id: "tuesday",
    when: { vaar: ["मंगलवार"] },
    text: "मंगलवार हनुमान जी का दिन है। बहुत लोग इस दिन मांस-मछली नहीं खाते और व्रत रखते हैं।",
    tradition: "व्यापक",
    varies: "common",
  },
  {
    id: "thursday",
    when: { vaar: ["गुरुवार"] },
    text: "गुरुवार बृहस्पति और विष्णु जी का दिन है। कई घरों में इस दिन बाल नहीं धोए जाते, कपड़े नहीं धोए जाते, और केले के पेड़ की पूजा होती है। पीला रंग और चने की दाल शुभ मानी जाती है।",
    tradition: "उत्तर भारत",
    varies: "varies",
  },
  {
    id: "saturday",
    when: { vaar: ["शनिवार"] },
    text: "शनिवार शनि देव का दिन है। तेल, काले तिल या काली उड़द का दान किया जाता है, और पीपल के पेड़ में जल चढ़ाया जाता है।",
    tradition: "व्यापक",
    varies: "common",
  },
  {
    id: "monday",
    when: { vaar: ["सोमवार"] },
    text: "सोमवार शिव जी का दिन है — शिवलिंग पर जल चढ़ाया जाता है। श्रावण के सोमवार का व्रत ख़ास माना जाता है।",
    tradition: "व्यापक",
    varies: "common",
  },

  // ── Tithi rules ───────────────────────────────────────────────────────────
  {
    id: "ekadashi",
    when: { tithi: ["एकादशी"] },
    text: "आज एकादशी है — विष्णु जी का व्रत। परंपरा में इस दिन चावल और अनाज नहीं खाया जाता; फलाहार, दूध, साबूदाना, सिंघाड़े या कुट्टू का आटा लिया जाता है। व्रत अगले दिन द्वादशी में पारण करके खोला जाता है।",
    tradition: "वैष्णव परंपरा, व्यापक",
    varies: "strict",
  },
  {
    id: "ekadashi-rice",
    when: { tithi: ["एकादशी"] },
    // A bare "खा" here matched every form of the verb to eat, so "बहू ने आज
    // खाना नहीं दिया" — a daughter-in-law not feeding someone, which is a
    // safeguarding signal, not a fasting question — counted as a ritual query.
    topic: /(चावल|भात|अनाज|खा सकते|खा सकती|व्रत|फलाहार|पारण)/,
    text: "एकादशी पर चावल विशेष रूप से वर्जित माना जाता है। बहुत लोग सिर्फ़ फल और दूध लेते हैं; कुछ लोग एक समय फलाहार करते हैं।",
    tradition: "वैष्णव परंपरा",
    varies: "strict",
  },
  {
    id: "amavasya",
    when: { tithi: ["अमावस्या"] },
    text: "आज अमावस्या है। इस दिन पितरों को याद किया जाता है, तर्पण और दान किया जाता है। नया शुभ काम, गृह प्रवेश या शादी जैसे काम इस दिन शुरू नहीं किए जाते।",
    tradition: "व्यापक",
    varies: "common",
  },
  {
    id: "purnima",
    when: { tithi: ["पूर्णिमा"] },
    text: "आज पूर्णिमा है। सत्यनारायण की कथा, व्रत और दान का दिन माना जाता है। बहुत लोग इस दिन उपवास रखते हैं।",
    tradition: "व्यापक",
    varies: "common",
  },
  {
    id: "chaturthi",
    when: { tithi: ["चतुर्थी"] },
    text: "चतुर्थी गणेश जी की तिथि है। संकष्टी चतुर्थी पर चंद्रमा को अर्घ्य देकर व्रत खोला जाता है।",
    tradition: "व्यापक",
    varies: "common",
  },
  {
    id: "ashtami-navami",
    when: { tithi: ["अष्टमी", "नवमी"] },
    text: "अष्टमी और नवमी देवी की तिथियाँ हैं। नवरात्रि में इन दिनों कन्या पूजन और हवन होता है।",
    tradition: "व्यापक",
    varies: "common",
  },

  // ── Month rules ───────────────────────────────────────────────────────────
  {
    id: "shravana",
    when: { masa: ["श्रावण"] },
    text: "श्रावण मास चल रहा है — शिव जी का महीना। इस पूरे महीने बहुत लोग मांस-मदिरा छोड़ देते हैं, और सोमवार का व्रत रखते हैं। कुछ परंपराओं में इस महीने हरी पत्तेदार सब्ज़ी और दही से भी परहेज़ किया जाता है।",
    tradition: "उत्तर भारत",
    varies: "common",
  },
  {
    id: "kartika",
    when: { masa: ["कार्तिक"] },
    text: "कार्तिक मास पुण्य का महीना माना जाता है — दीपदान, तुलसी पूजा और सुबह जल्दी स्नान का। कार्तिक में बहुत लोग प्याज़-लहसुन और मांस छोड़ देते हैं।",
    tradition: "व्यापक",
    varies: "common",
  },
  {
    id: "paush",
    when: { masa: ["पौष"] },
    text: "पौष मास में शादी-विवाह जैसे शुभ मांगलिक काम नहीं किए जाते; मकर संक्रांति के बाद फिर शुरू होते हैं।",
    tradition: "उत्तर भारत",
    varies: "common",
  },

  // ── Direction of travel (dishashool) ──────────────────────────────────────
  // Asked more than one might expect: an elder deciding which day to travel to
  // a son's house genuinely consults this.
  {
    id: "dishashool",
    when: { always: true },
    topic: /(यात्रा|जाना|सफ़र|सफर|निकल|दिशा|ट्रेन|जाऊँ|जाऊं)/,
    text: "दिशाशूल के अनुसार: सोमवार और शनिवार को पूरब, मंगलवार और बुधवार को उत्तर, गुरुवार को दक्षिण, और रविवार-शुक्रवार को पश्चिम की यात्रा से बचा जाता है। बहुत लोग दही-चीनी खाकर निकलते हैं ताकि यह दोष न लगे।",
    tradition: "उत्तर भारत",
    varies: "varies",
  },

  // ── Food, generally ───────────────────────────────────────────────────────
  {
    id: "food-general",
    when: { always: true },
    // Deliberately NOT the bare words खाना or भोजन. "आज खाना बनाने का मन नहीं"
    // is someone tired and low, not someone asking what is permitted — and
    // answering that with fasting rules instead of warmth is the whole failure
    // this product is trying to avoid.
    topic: /(खा सकते|खा सकती|खाना चलेगा|व्रत में|फलाहार|प्याज़|प्याज|लहसुन|मांस|मछली|अनाज)/,
    text: "व्रत के दिनों में आमतौर पर अनाज, प्याज़, लहसुन और मांस से परहेज़ किया जाता है; फल, दूध, दही, साबूदाना, सिंघाड़ा और सेंधा नमक लिया जाता है।",
    tradition: "सामान्य परंपरा",
    varies: "common",
  },
];

// Is the caller asking about observance at all?
//
// Needed because most of these rules key off the DATE, not the subject, so
// without this gate every single turn of every call carries "it is Saturday,
// Shani's day" and "it is Shravana" into the prompt. Measured on the first run:
// "पोती कल फ़ोन पर बात कर रही थी" and "घुटनों में दर्द है" both pulled the
// Saturday and Shravana rules. An elder talking about her granddaughter does not
// need to hear about black sesame, and every irrelevant line in the prompt is
// one more thing the model may feel obliged to mention.
//
// Same lesson as the scripture retriever, which had the same failure for the
// same reason: relevance has to be earned, not assumed.
const RITUAL_INTENT =
  /(व्रत|उपवास|पूजा|तिथि|पंचांग|नक्षत्र|मुहूर्त|एकादशी|अमावस्या|पूर्णिमा|संक्रांति|नवरात्रि|शुभ|अशुभ|त्योहार|त्यौहार|दान|कथा|मंदिर|भगवान|शनि|हनुमान|शिव|विष्णु|कौन सा दिन|कौनसा दिन|कर सकते|कर सकती|करना चाहिए|ठीक रहेगा|परहेज़|परहेज)/;

/**
 * Which rules apply, given today and what the caller said.
 *
 * Nothing at all unless they raised the subject — either by naming a topic a
 * rule covers (haircut, travel, food) or by asking about observance generally.
 * Returning an empty list is the right answer on most turns of most calls.
 */
export function findRules(panchang, query = "") {
  if (!panchang) return [];
  const q = String(query);
  const topical = RULES.some((r) => r.topic?.test(q));
  if (!topical && !RITUAL_INTENT.test(q)) return [];

  return RULES.filter((rule) => {
    const w = rule.when;
    const dayMatches =
      w.always ||
      (w.vaar?.includes(panchang.vaar) ?? false) ||
      (w.tithi?.includes(panchang.tithi) ?? false) ||
      (w.masa?.includes(panchang.masa) ?? false);
    if (!dayMatches) return false;
    // A rule with a topic is only relevant once they bring that topic up.
    if (rule.topic) return rule.topic.test(q);
    // A dateless rule (`always`) with no topic would fire on everything.
    return !w.always;
  });
}

const STRENGTH = {
  strict: "यह परंपरा लगभग हर जगह मानी जाती है",
  common: "यह परंपरा काफ़ी जगह मानी जाती है",
  varies: "यह हर जगह अलग-अलग है",
};

/**
 * Render for the system prompt.
 *
 * The instructions travel WITH the rules rather than living only in the
 * persona, because this is the block that carries the risk. Two rules matter
 * more than the content: never give a ruling, and never let a tradition
 * override a doctor.
 */
export function renderRules(rules) {
  if (!rules?.length) return null;
  const body = rules
    .map((r) => `- ${r.text}\n  (${r.tradition}; ${STRENGTH[r.varies] || STRENGTH.common})`)
    .join("\n");

  return `आज के दिन से जुड़ी परंपराएँ, अगर वे इनके बारे में पूछें:

${body}

इन्हें कैसे बताना है — यह नियम बहुत ज़रूरी है:
- आप पंडित नहीं हैं और फ़ैसला नहीं सुना रहे। परंपरा क्या कहती है, वह बताइए — "परंपरा में ऐसा कहा जाता है…", "बहुत लोग ऐसा मानते हैं…" — हुक्म की तरह नहीं।
- साथ में हल्के से यह भी कह दीजिए कि अपने घर की परंपरा या पंडित जी से पक्का कर लीजिएगा, क्योंकि हर जगह रीत अलग होती है।
- अगर वे कहें कि "हमारे यहाँ ऐसा नहीं होता", तो उनकी बात मानिए। उनके घर की परंपरा ऊपर लिखी किसी भी बात से बड़ी है।
- ⚠️ सेहत सबसे ऊपर है। अगर वे बीमार हैं, शुगर या बीपी की दवा लेते हैं, या कमज़ोरी है — तो व्रत या भूखे रहने के बारे में कभी हाँ मत कहिए। कोमलता से कहिए कि तबीयत पहले है, और डॉक्टर या घरवालों से पूछ लें। परंपरा किसी की सेहत से बड़ी नहीं।
- जो ऊपर नहीं लिखा, उसके बारे में अंदाज़ा मत लगाइए। सीधे कह दीजिए कि आपको ठीक से नहीं पता।`;
}
