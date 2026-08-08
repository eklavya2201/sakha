// What day it is, in the calendar an elder actually lives by.
//
// "क्या आज बाल कटवा सकते हैं?" is not a question any book answers. It depends on
// today's tithi, vaar and nakshatra — so no amount of searching the Puranas
// helps, and this is a calculation instead. Computed once when a call starts and
// dropped into the system prompt, so answering costs nothing mid-call.
//
// ── Two things that are easy to get wrong ───────────────────────────────────
//
// 1. THE TITHI AT SUNRISE is the day's tithi, not the tithi right now. Panchang
//    convention names a day for whatever tithi was running when the sun came up,
//    even if it changes an hour later. mhah-panchang exposes both and they
//    routinely disagree — on the day this was written, calendar() said Dasami
//    and calculate() said Ekadasi. Using the second would have had Sakha telling
//    people it was Ekadashi on Dashami.
//
// 2. The library returns names in ODIA (ଦଶମୀ), not Hindi. The Hindi comes from
//    mapping its romanised name_en_IN, not its index — index conventions differ
//    between the fields (Masa ino 3 is Shravana, which is not the third month in
//    any ordering we use) and mapping the name is robust against that.
//
// Verified before being trusted: weekday matched the real calendar on 40/40
// sampled dates, and Amavasya-to-Amavasya came out 29-30 days against a true
// synodic month of 29.53.

import { MhahPanchang } from "mhah-panchang";

// Delhi. Tithi boundaries shift by minutes across India, which is far below the
// precision of anything Sakha says — he speaks in days, and always tells people
// to confirm. Override per deployment if that ever stops being true.
const LAT = Number(process.env.PANCHANG_LAT || 28.6139);
const LON = Number(process.env.PANCHANG_LON || 77.209);

const panchang = new MhahPanchang();

const TITHI_HI = {
  Pratipada: "प्रतिपदा", Dwitiya: "द्वितीया", Tritiya: "तृतीया", Chaturthi: "चतुर्थी",
  Panchami: "पंचमी", Sasti: "षष्ठी", Saptami: "सप्तमी", Astami: "अष्टमी", Navami: "नवमी",
  Dasami: "दशमी", Ekadasi: "एकादशी", Dwadasi: "द्वादशी", Trayodasi: "त्रयोदशी",
  Chaturdasi: "चतुर्दशी", Purnima: "पूर्णिमा", Amavasya: "अमावस्या",
};

const NAKSHATRA_HI = {
  Ashwini: "अश्विनी", Bharani: "भरणी", Krittika: "कृत्तिका", Rohini: "रोहिणी",
  Mrigashirsha: "मृगशिरा", Ardra: "आर्द्रा", Punarvasu: "पुनर्वसु", Pushya: "पुष्य",
  Ashlesha: "आश्लेषा", Magha: "मघा", "Purva Phalguni": "पूर्वा फाल्गुनी",
  "Uttara Phalguni": "उत्तरा फाल्गुनी", Hasta: "हस्त", Chitra: "चित्रा", Swati: "स्वाति",
  Vishakha: "विशाखा", Anuradha: "अनुराधा", Jyeshtha: "ज्येष्ठा", Mula: "मूल",
  "Purva Ashadha": "पूर्वाषाढ़ा", "Uttara Ashadha": "उत्तराषाढ़ा", Shravana: "श्रवण",
  Dhanishtha: "धनिष्ठा", Shatabhisha: "शतभिषा", "Purva Bhadrapada": "पूर्वा भाद्रपदा",
  "Uttara Bhadrapada": "उत्तरा भाद्रपदा", Revati: "रेवती",
};

const MASA_HI = {
  Chaitra: "चैत्र", Vaisakha: "वैशाख", Jyeshtha: "ज्येष्ठ", Ashadha: "आषाढ़",
  Srabana: "श्रावण", Shravana: "श्रावण", Bhadrapada: "भाद्रपद", Aswina: "आश्विन",
  Ashwin: "आश्विन", Kartika: "कार्तिक", Margashirsha: "मार्गशीर्ष", Pausha: "पौष",
  Magha: "माघ", Phalguna: "फाल्गुन",
};

const VAAR_HI = {
  Sunday: "रविवार", Monday: "सोमवार", Tuesday: "मंगलवार", Wednesday: "बुधवार",
  Thursday: "गुरुवार", Friday: "शुक्रवार", Saturday: "शनिवार",
};

// Fall back to the romanised name rather than dropping it. A caller hearing
// "Uttara Ashadha" is mildly odd; hearing nothing where a nakshatra should be
// makes Sakha sound broken.
const hindi = (map, name) => map[name] || name || null;

/**
 * Today, as the panchang sees it.
 * @param {Date} [when]
 * @returns {object|null} null if the calculation fails — never throw into a call
 */
export function getPanchang(when = new Date()) {
  try {
    const cal = panchang.calendar(when, LAT, LON); // sunrise-based — the day's tithi
    const now = panchang.calculate(when); // instantaneous, for the end time

    const tithiEn = cal.Tithi?.name_en_IN;
    const pakshaEn = cal.Paksha?.name_en_IN; // "Shukla" | "Krishna"

    return {
      date: when,
      tithi: hindi(TITHI_HI, tithiEn),
      tithiEn,
      paksha: pakshaEn === "Krishna" ? "कृष्ण पक्ष" : "शुक्ल पक्ष",
      pakshaEn,
      nakshatra: hindi(NAKSHATRA_HI, cal.Nakshatra?.name_en_IN),
      masa: hindi(MASA_HI, cal.Masa?.name_en_IN),
      vaar: hindi(VAAR_HI, now.Day?.name_en_UK),
      vaarEn: now.Day?.name_en_UK,
      // When the CURRENT tithi runs out. Useful because a fast is kept by the
      // tithi, not by the clock: "एकादशी कल सुबह तक है" is the real answer to
      // "when do I break it".
      tithiEndsAt: now.Tithi?.end ? new Date(now.Tithi.end) : null,
      // The three that carry almost all the practical questions.
      isEkadashi: tithiEn === "Ekadasi",
      isPurnima: tithiEn === "Purnima",
      isAmavasya: tithiEn === "Amavasya",
    };
  } catch (e) {
    console.error("[sakha:panchang] could not compute:", e.message);
    return null;
  }
}

/** For the boot line, so it is obvious at a glance that this is working. */
export function panchangStatusLine(p = getPanchang()) {
  if (!p) return "panchang: unavailable";
  return `panchang: ${p.vaar}, ${p.paksha} ${p.tithi}, ${p.nakshatra} नक्षत्र, ${p.masa} मास`;
}

/**
 * Render for the system prompt.
 *
 * Carries the honesty rule with it rather than leaving it to the persona, so it
 * cannot drift apart from the facts it qualifies: panchang genuinely differs
 * between regions and almanacs — amanta and purnimanta month naming disagree by
 * a fortnight, and sunrise moves the boundary. Sakha states what today is and
 * tells them to confirm anything that matters.
 */
export function renderPanchang(p = getPanchang()) {
  if (!p) return null;
  const time = p.tithiEndsAt
    ? p.tithiEndsAt.toLocaleString("hi-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", day: "numeric", month: "long" })
    : null;

  return `आज का पंचांग (${p.date.toLocaleDateString("hi-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" })}):
- वार: ${p.vaar}
- तिथि: ${p.paksha} ${p.tithi}${time ? ` (यह तिथि ${time} तक)` : ""}
- नक्षत्र: ${p.nakshatra}
- मास: ${p.masa}

इसका इस्तेमाल कैसे करें:
- अगर वे पूछें कि आज कौन-सी तिथि है, कौन-सा व्रत है, या आज कोई काम करना ठीक है या नहीं — तो यही आज का दिन है, इसी के हिसाब से बताइए।
- तिथि सूर्योदय के समय की है, जैसा पंचांग में गिना जाता है।
- ⚠️ पंचांग हर जगह एक जैसा नहीं होता — उत्तर और दक्षिण भारत में महीनों की गिनती अलग है, और अलग-अलग पंचांगों में थोड़ा फ़र्क़ आता है। इसलिए जो भी बताएँ, उसके साथ यह भी कह दीजिए कि अपने घर के पंचांग या पंडित जी से पक्का कर लें।`;
}
