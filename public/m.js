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
    start: $("btn-start"), again: $("btn-again"), end: $("btn-end"),
    mute: $("btn-mute"), cc: $("btn-cc"), ctaHint: $("cta-hint"),
    introError: $("intro-error"), callError: $("call-error"),
    timer: $("timer"), stateText: $("state-text"), connectText: $("connect-text"),
    edge: $("edge"), ccBox: $("cc"),
    said: $("said"), doneTitle: $("done-title"), doneNote: $("done-note"), mode: $("mode"),
  };

  var active = null;   // the live VoiceCall
  var session = null;  // what /api/voice/session returned
  var timers = { tick: null, level: null };
  var transcript = [];
  var muted = false;
  var showCaptions = false;

  // ── Screens ───────────────────────────────────────────────────────────────

  function show(which) {
    Object.keys(screens).forEach(function (k) { screens[k].classList.toggle("on", k === which); });
    // The glass only breathes during a call. On the other screens it would just
    // be an orange vignette with nothing behind it.
    els.edge.style.display = which === "call" ? "block" : "none";
    // Helplines are hidden once the call is up — that screen is one word by
    // design, and Sakha speaks the number himself if it is ever warranted.
    document.querySelector(".wrap").classList.toggle("in-call", which === "call" || which === "connecting");
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
  function clock(seconds) {
    var m = Math.floor(seconds / 60), s = seconds % 60;
    var pad = function (n) { return String(n).length < 2 ? "0" + n : String(n); };
    return (pad(m) + ":" + pad(s)).replace(/\d/g, function (d) { return DIGITS[+d]; });
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
    u.rate = 0.95;
    // Mute the microphone while the phone talks. Without this the demo VAD
    // hears the phone's own voice and answers it, and the call talks to itself.
    if (active) active.setMuted(true);
    u.onend = u.onerror = function () { if (active && !muted) active.setMuted(false); };
    speechSynthesis.speak(u);
  }

  // ── What Sakha is doing ───────────────────────────────────────────────────
  // One word, under his name. Everything else that used to be on this screen —
  // the constellation, the topic labels, the running transcript — is gone: an
  // elder on a call should be looking at nothing, or at one word.

  var STATES = {
    connecting: "जोड़ रहे हैं…",
    speaking: "सखा बोल रहे हैं",
    thinking: "सोच रहे हैं…",
    listening: "सुन रहे हैं",
  };

  function setState(state) {
    els.stateText.textContent = STATES[state] || STATES.listening;
  }

  function record(role, text) {
    transcript.push({ role: role, text: text });
    if (showCaptions) renderCaptions();
  }

  // Only the last couple of lines. A wall of text on a call screen is exactly
  // what this redesign removed.
  function renderCaptions() {
    els.ccBox.innerHTML = "";
    transcript.slice(-2).forEach(function (t) {
      var p = document.createElement("p");
      p.className = t.role;
      p.textContent = t.text;
      els.ccBox.appendChild(p);
    });
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

  // ── The breathing edge ────────────────────────────────────────────────────
  // The only thing on the call screen that moves, and the only thing that says
  // "it can hear you" without a word. Orange while the caller speaks, gold
  // while Sakha does, and a slow idle pulse in between so the phone never looks
  // like it has hung up.

  function startAnimations(call) {
    stopAnimations();
    timers.tick = setInterval(function () {
      els.timer.textContent = clock(call.elapsedSeconds());
    }, 500);

    timers.level = setInterval(function () {
      var input = call.inputLevel || 0;
      var output = call.readOutputLevel() || 0;
      var agentTalking = output > 0.02 && output >= input;
      // Scaled up: conversational speech peaks well below 1.0, and an edge that
      // only blooms when someone shouts is an edge that never blooms.
      var level = Math.min(1, Math.max(input, output) * 1.8);
      els.edge.classList.toggle("agent", agentTalking);
      els.edge.classList.toggle("idle", level < 0.05);
      els.edge.style.setProperty("--glow", level.toFixed(3));
    }, 80);
  }

  function stopAnimations() {
    if (timers.tick) clearInterval(timers.tick);
    if (timers.level) clearInterval(timers.level);
    timers.tick = timers.level = null;
    els.edge.classList.remove("agent");
    els.edge.classList.add("idle");
    els.edge.style.setProperty("--glow", "0");
  }

  // ── The call ──────────────────────────────────────────────────────────────

  function startCall() {
    clearError(els.introError);
    clearError(els.callError);
    transcript = [];
    muted = false;
    showCaptions = false;
    els.ccBox.classList.remove("on");
    els.cc.classList.remove("on");
    els.mute.classList.remove("off");
    els.mute.textContent = "🎙️";
    els.timer.textContent = clock(0);
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
        if (session.mode !== "live" && els.mode) {
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

  // ── One button, two jobs ──────────────────────────────────────────────────
  // It asks for the microphone first, then becomes the call button. Never both
  // at once: two buttons side by side made an elder choose between them, and
  // the choice was meaningless — you always need both, in that order.

  var micReady = false;

  function setCta(state) {
    if (state === "asking") {
      els.start.disabled = true;
      els.start.textContent = "इजाज़त माँग रहे हैं…";
      els.ctaHint.textContent = "फ़ोन पूछेगा — “Allow” दबाइए";
      return;
    }
    els.start.disabled = false;
    if (state === "ready") {
      micReady = true;
      els.start.textContent = "बात शुरू कीजिए";
      els.ctaHint.textContent = "बटन दबाइए और बोलिए";
    } else {
      micReady = false;
      els.start.textContent = "माइक चालू कीजिए";
      els.ctaHint.textContent = "सखा को सुनने के लिए माइक की इजाज़त चाहिए";
    }
  }

  // Already allowed on a previous visit? Then skip straight to the call button
  // rather than making them grant something they have already granted.
  // Safari and Firefox do not answer this query, so those callers get the extra
  // tap — which is honest and costs one second.
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions
      .query({ name: "microphone" })
      .then(function (p) { if (p.state === "granted") setCta("ready"); })
      .catch(function () { /* unsupported; leave it on the mic step */ });
  }

  function requestMic() {
    clearError(els.introError);
    setCta("asking");
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(function (stream) {
        // Release it immediately. Holding the track open would leave the
        // phone's recording indicator lit while they are still reading — which
        // looks like it started listening before they said to.
        stream.getTracks().forEach(function (t) { t.stop(); });
        setCta("ready");
      })
      .catch(function () {
        setCta("mic");
        fail(els.introError, "माइक की इजाज़त नहीं मिली। फ़ोन की सेटिंग में इस पन्ने को माइक की इजाज़त दीजिए, फिर दोबारा कोशिश कीजिए।");
      });
  }

  els.start.addEventListener("click", function () {
    if (micReady) startCall();
    else requestMic();
  });
  els.again.addEventListener("click", startCall);
  els.end.addEventListener("click", endCall);

  els.mute.addEventListener("click", function () {
    if (!active) return;
    muted = active.setMuted(!muted);
    els.mute.classList.toggle("off", muted);
    els.mute.textContent = muted ? "🔇" : "🎙️";
    els.mute.setAttribute("aria-label", muted ? "माइक चालू कीजिए" : "माइक बंद कीजिए");
  });

  // Captions off by default. On, for someone who hears badly and would rather
  // read the last thing Sakha said than ask him to repeat it.
  els.cc.addEventListener("click", function () {
    showCaptions = !showCaptions;
    els.ccBox.classList.toggle("on", showCaptions);
    els.cc.classList.toggle("on", showCaptions);
    if (showCaptions) renderCaptions();
  });

  // Hanging up by closing the tab must still release the microphone and let the
  // server file the call, rather than waiting for the socket to time out.
  window.addEventListener("pagehide", function () { if (active) active.stop(); });
})();
