// The phone page. Four screens, one job: get an elder from a link to a
// conversation in a single tap, and never make them read anything to do it.

(function () {
  var $ = function (id) { return document.getElementById(id); };

  var screens = {
    intro: $("screen-intro"),
    connecting: $("screen-connecting"),
    call: $("screen-call"),
    done: $("screen-done"),
  };
  var els = {
    name: $("name"), phone: $("phone"),
    start: $("btn-start"), again: $("btn-again"), end: $("btn-end"), mute: $("btn-mute"), mic: $("btn-mic"),
    introError: $("intro-error"), callError: $("call-error"),
    timer: $("timer"), stateText: $("state-text"), connectText: $("connect-text"),
    sky: $("sky"), field: $("field"), links: $("links"),
    subject: $("subject"), subjectTitle: $("subject-title"), subjectNote: $("subject-note"),
    said: $("said"), doneTitle: $("done-title"), doneNote: $("done-note"), mode: $("mode"),
  };

  var active = null;   // the live VoiceCall
  var session = null;  // what /api/voice/session returned
  var timers = { tick: null, level: null };
  var transcript = [];
  var lastAgentBody = null;

  // ── The constellation ─────────────────────────────────────────────────────
  // The shape of a life, not a menu. Each star is something an elder might be
  // carrying; the one nearest what they just said lights up and the sky drifts
  // toward it, so the screen is always quietly showing "I am following you".
  //
  // Matched on the CALLER's words, never Sakha's — the subject of a conversation
  // is set by the person whose conversation it is.
  var TOPICS = [
    { id: "self",   label: "आप",                   note: "जो मन में है, वही",        x: 50, y: 50, core: true },
    { id: "ghar",   label: "घर और परिवार",          note: "जो साथ हैं, जो दूर हैं",   x: 22, y: 27,
      words: /(घर|परिवार|बहू|दामाद|बेटा|बेटी|पति|पत्नी|भाई|बहन|अकेले रह)/ },
    { id: "bacche", label: "बच्चे और पोते-पोतियाँ", note: "जिनकी याद सबसे ज़्यादा आती है", x: 78, y: 30,
      words: /(पोता|पोती|पोत|नाती|बच्च|स्कूल|फ़ोन आया|फोन आया|विदेश|बाहर रह)/ },
    { id: "tabiyat",label: "तबीयत",                note: "शरीर कैसा चल रहा है",       x: 84, y: 62,
      words: /(तबीयत|तबियत|दर्द|दवा|दवाई|डॉक्टर|डाक्टर|घुटन|कमर|नींद|बीमार|शुगर|बीपी|चक्कर)/ },
    { id: "yaad",   label: "पुरानी यादें",          note: "जो बीत गया, पर रह गया",     x: 62, y: 82,
      words: /(याद|पहले|बचपन|गाँव|गांव|शादी|पुराने दिन|वो ज़माना|जवानी)/ },
    { id: "man",    label: "मन की बात",            note: "जो कहना मुश्किल है",        x: 26, y: 76,
      words: /(मन|अकेल|उदास|दुख|रोन|खुश|डर|चिंता|घबरा|भारी|बोझ|तनहा)/ },
    { id: "din",    label: "रोज़ का दिन",           note: "सुबह से शाम तक",            x: 12, y: 54,
      words: /(सुबह|शाम|खाना|चाय|मंदिर|पूजा|टहल|सैर|टीवी|अख़बार|अखबार|बाज़ार)/ },
  ];

  var stars = {};
  // null, not "self" — highlight() returns early when nothing changed, so
  // seeding this with a real topic would leave the centre star unlit until the
  // caller happened to change the subject.
  var currentTopic = null;

  function buildSky() {
    var svgNS = "http://www.w3.org/2000/svg";
    var core = TOPICS[0];
    TOPICS.forEach(function (t) {
      if (!t.core) {
        // Every star hangs off the centre: whatever they talk about, it is
        // still about them.
        var line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", core.x); line.setAttribute("y1", core.y);
        line.setAttribute("x2", t.x); line.setAttribute("y2", t.y);
        line.dataset.topic = t.id;
        els.links.appendChild(line);
      }
      var star = document.createElement("div");
      star.className = "star" + (t.core ? " core" : "");
      star.style.left = t.x + "%";
      star.style.top = t.y + "%";
      // Stagger the twinkle so the sky never pulses in unison.
      var dot = document.createElement("i");
      dot.style.animationDelay = (Math.random() * 4).toFixed(2) + "s";
      var label = document.createElement("span");
      label.textContent = t.label;
      star.appendChild(dot);
      star.appendChild(label);
      els.field.appendChild(star);
      stars[t.id] = star;
    });
    highlight("self");
  }

  function highlight(id) {
    if (id === currentTopic) return;
    currentTopic = id;
    var topic = TOPICS.filter(function (t) { return t.id === id; })[0] || TOPICS[0];

    Object.keys(stars).forEach(function (k) { stars[k].classList.toggle("hot", k === id); });
    var lines = els.links.querySelectorAll("line");
    for (var i = 0; i < lines.length; i++) lines[i].classList.toggle("hot", lines[i].dataset.topic === id);

    // Draw the sky toward the live star, the way Profound's constellation
    // leans into whatever is being discussed. Modest scale — an elder should
    // never feel the screen lurch.
    var scale = topic.core ? 1 : 1.28;
    var dx = (50 - topic.x) * (scale / 100) * 100;
    var dy = (50 - topic.y) * (scale / 100) * 100;
    els.field.style.transform = "translate(" + dx.toFixed(2) + "%," + dy.toFixed(2) + "%) scale(" + scale + ")";

    els.subjectTitle.textContent = topic.label;
    els.subjectNote.textContent = topic.note;
    els.subject.classList.remove("swap");
    void els.subject.offsetWidth; // restart the entrance animation
    els.subject.classList.add("swap");
  }

  function matchTopic(text) {
    for (var i = 1; i < TOPICS.length; i++) {
      if (TOPICS[i].words && TOPICS[i].words.test(text)) return TOPICS[i].id;
    }
    return null;
  }

  // ── Screens ───────────────────────────────────────────────────────────────

  function show(which) {
    Object.keys(screens).forEach(function (k) { screens[k].classList.toggle("on", k === which); });
    // The frame itself never scrolls — only the middle of a screen does — so a
    // screen has to be handed over already at the top rather than wherever the
    // last one was left.
    var scroller = screens[which].querySelector(".scroll");
    if (scroller) scroller.scrollTop = 0;
  }

  function fail(box, message) {
    box.textContent = message;
    box.classList.add("on");
  }

  function clearError(box) {
    box.textContent = "";
    box.classList.remove("on");
  }

  // Devanagari numerals on the clock, because everything else on this page is
  // in Hindi and a Latin "07:12" is the one thing that would look borrowed.
  var DIGITS = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];
  function hindiNumber(n) {
    return String(n).replace(/\d/g, function (d) { return DIGITS[+d]; });
  }
  function clock(seconds) {
    var m = Math.floor(seconds / 60), s = seconds % 60;
    return hindiNumber((m < 10 ? "0" : "") + m) + ":" + hindiNumber((s < 10 ? "0" : "") + s);
  }

  // ── Remembering who they are ──────────────────────────────────────────────
  // Kept on the phone, never in a login. The number is only the key to the
  // memory file the WhatsApp bot already writes — typing it is optional, and a
  // call without one simply is not remembered.

  try {
    els.name.value = localStorage.getItem("sakha.name") || "";
    els.phone.value = localStorage.getItem("sakha.phone") || "";
  } catch (e) { /* private mode; not worth mentioning to them */ }

  // A link can carry them, so a son can send his mother something she only has
  // to tap: /m?phone=98XXXXXXXX&name=कमला
  var params = new URLSearchParams(location.search);
  if (params.get("phone")) els.phone.value = params.get("phone");
  if (params.get("name")) els.name.value = params.get("name");

  function remember() {
    try {
      localStorage.setItem("sakha.name", els.name.value.trim());
      localStorage.setItem("sakha.phone", els.phone.value.trim());
    } catch (e) { /* noop */ }
  }

  // ── Sakha's voice on the phone itself ─────────────────────────────────────
  // Only used when the server has no Sarvam key and therefore sends no audio.
  // The phone's built-in Hindi voice is robotic, but it is the difference
  // between a page you can hold a conversation with today and one that waits on
  // an API key.

  var deviceVoice = null;
  function pickDeviceVoice() {
    if (!window.speechSynthesis) return null;
    var voices = speechSynthesis.getVoices() || [];
    for (var i = 0; i < voices.length; i++) if (voices[i].lang === "hi-IN") return voices[i];
    for (var j = 0; j < voices.length; j++) if (/^hi/.test(voices[j].lang)) return voices[j];
    return null;
  }
  if (window.speechSynthesis) {
    deviceVoice = pickDeviceVoice();
    speechSynthesis.onvoiceschanged = function () { deviceVoice = pickDeviceVoice(); };
  }

  function speakOnDevice(text) {
    if (!window.speechSynthesis) return;
    var u = new SpeechSynthesisUtterance(text);
    if (deviceVoice) u.voice = deviceVoice;
    u.lang = "hi-IN";
    u.rate = 0.92; // slowed, for the same reason Sarvam's pace is 0.9
    // Mute the microphone while the phone talks. Without this the demo VAD
    // hears the phone's own voice and answers it, and the call talks to itself.
    if (active) active.setMuted(true);
    u.onend = u.onerror = function () { if (active && !muted) active.setMuted(false); };
    speechSynthesis.speak(u);
  }

  // ── What Sakha is doing ───────────────────────────────────────────────────

  var STATES = {
    connecting: "जोड़ रहे हैं",
    speaking: "सखा बोल रहे हैं",
    thinking: "सखा सोच रहे हैं",
    listening: "अब आप बोलिए",
  };

  function setState(state) {
    els.stateText.textContent = STATES[state] || STATES.listening;
  }

  function record(role, text) {
    transcript.push({ role: role, text: text });
    if (role === "caller") {
      var topic = matchTopic(text);
      if (topic) highlight(topic);
    }
  }

  function renderTranscript() {
    els.said.innerHTML = "";
    transcript.forEach(function (t) {
      var el = document.createElement("div");
      el.className = "line " + t.role;
      var who = document.createElement("em");
      who.textContent = t.role === "agent" ? "सखा" : "आप";
      var body = document.createElement("span");
      body.textContent = t.text;
      el.appendChild(who);
      el.appendChild(body);
      els.said.appendChild(el);
    });
  }

  // The stars breathe with whoever is talking — the one thing on the call
  // screen that says "this is live" without using a word.
  function startAnimations(call) {
    stopAnimations();
    timers.tick = setInterval(function () {
      els.timer.textContent = clock(call.elapsedSeconds());
    }, 500);
    timers.level = setInterval(function () {
      var level = Math.min(1, Math.max(call.inputLevel, call.readOutputLevel()));
      var hot = stars[currentTopic];
      if (hot) hot.style.setProperty("--pulse", level.toFixed(2));
      els.sky.style.filter = "saturate(" + (1 + level * 0.5).toFixed(2) + ")";
    }, 80);
  }

  function stopAnimations() {
    if (timers.tick) clearInterval(timers.tick);
    if (timers.level) clearInterval(timers.level);
    timers.tick = timers.level = null;
    els.sky.style.filter = "";
  }

  // ── The call ──────────────────────────────────────────────────────────────

  var muted = false;

  function startCall() {
    clearError(els.introError);
    clearError(els.callError);
    transcript = [];
    lastAgentBody = null;
    muted = false;
    els.mute.classList.remove("off");
    els.mute.textContent = "🎙️";
    els.timer.textContent = clock(0);
    highlight("self");
    els.start.disabled = true;
    els.again.disabled = true;
    remember();
    show("connecting");
    setState("connecting");

    SakhaVoice.start({
      phone: els.phone.value,
      name: els.name.value,
      onStatus: function (status, detail) {
        if (status === "error") {
          fail(els.callError, detail || "कुछ गड़बड़ हो गई।");
          show("call");
        }
        if (status === "ended") endCall();
      },
      onError: function (message) {
        // Before the call screen exists, the error belongs on the intro screen —
        // otherwise a microphone refusal shows on a screen nobody is looking at.
        fail(active ? els.callError : els.introError, message);
        if (!active) show("intro");
      },
      onEvent: function (msg) {
        if (msg.event === "state") {
          // The greeting is the first audio; that is the moment the call is
          // really happening, so that is when the call screen appears.
          if (screens.connecting.classList.contains("on")) show("call");
          setState(msg.state);
        }
        if (msg.event === "transcript" && msg.final) {
          record(msg.role, msg.text);
          if (session && session.voice === "device" && msg.role === "agent") speakOnDevice(msg.text);
        }
      },
    })
      .then(function (result) {
        active = result.call;
        session = result.session;
        startAnimations(active);
        if (session.mode !== "live") {
          els.mode.textContent = session.mode === "demo" ? "डेमो मोड" : "आंशिक मोड — कुछ API बाक़ी हैं";
        }
      })
      .catch(function (e) {
        console.error(e);
        els.start.disabled = false;
        els.again.disabled = false;
        if (!screens.call.classList.contains("on")) show("intro");
      });
  }

  function endCall() {
    if (active) {
      active.stop();
      active = null;
    }
    if (window.speechSynthesis) speechSynthesis.cancel();
    stopAnimations();
    els.start.disabled = false;
    els.again.disabled = false;

    renderTranscript();
    var kept = els.phone.value.trim() && transcript.length;
    els.doneTitle.textContent = transcript.length ? "बात ख़त्म हुई" : "बात नहीं हो पाई";
    els.doneNote.textContent = kept
      ? "सखा ने आपकी बातें याद रख लीं। जब मन करे, फिर बुलाइए।"
      : "जब मन करे, फिर बुलाइए। नंबर डालेंगे तो सखा आपको याद रख पाएगा।";
    show("done");
  }

  // ── The microphone, asked for on its own ──────────────────────────────────
  // Granting it here means the call itself starts silently, with no system
  // dialog landing on top of the one screen we asked them to look at.

  function micGranted() {
    els.mic.textContent = "माइक चालू है ✓";
    els.mic.disabled = true;
  }

  // If they already allowed it on a previous visit, the button is just clutter.
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions
      .query({ name: "microphone" })
      .then(function (p) { if (p.state === "granted") micGranted(); })
      .catch(function () { /* Firefox and Safari do not report this; leave it */ });
  }

  els.mic.addEventListener("click", function () {
    clearError(els.introError);
    els.mic.disabled = true;
    els.mic.textContent = "इजाज़त माँग रहे हैं…";
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(function (stream) {
        // Release it immediately. Holding the track open would leave the
        // phone's recording indicator lit while they are still reading.
        stream.getTracks().forEach(function (t) { t.stop(); });
        micGranted();
      })
      .catch(function () {
        els.mic.disabled = false;
        els.mic.textContent = "माइक की इजाज़त दीजिए";
        fail(els.introError, "माइक की इजाज़त नहीं मिली। फ़ोन की सेटिंग में इस पन्ने को माइक की इजाज़त दीजिए।");
      });
  });

  els.start.addEventListener("click", startCall);
  els.again.addEventListener("click", startCall);
  els.end.addEventListener("click", endCall);

  els.mute.addEventListener("click", function () {
    if (!active) return;
    muted = active.setMuted(!muted);
    els.mute.classList.toggle("off", muted);
    els.mute.textContent = muted ? "🔇" : "🎙️";
    els.mute.setAttribute("aria-label", muted ? "माइक चालू कीजिए" : "माइक बंद कीजिए");
  });

  // Hanging up by closing the tab must still release the microphone and let the
  // server file the call, rather than waiting for the socket to time out.
  window.addEventListener("pagehide", function () { if (active) active.stop(); });

  buildSky();
})();
