// The call, in the browser: microphone → WebSocket → speaker.
//
// The entire "phone call" is this file plus a socket. There is no app, no
// meeting, no peer connection — the phone's own browser streams raw PCM to our
// server and plays the reply back. Nothing here decides anything, which is why
// swapping what does the hearing or the speaking never touches this file.
//
// Plain script, no build step, matching the rest of the project.

(function (global) {
  // Must match IN_SAMPLE_RATE in src/voice/format.js. The OUTPUT rate is not
  // hardcoded — it arrives in the session config, because the two directions run
  // at different rates: the mic at what the recogniser wants, Sakha's voice at
  // the higher rate the synthesiser actually produced. Playing 22050 audio as if
  // it were 16000 would make him sound slow and deep, which is a miserable thing
  // to diagnose from a live call.
  var SAMPLE_RATE = 16000;
  var DEFAULT_OUT_RATE = 22050;
  // Frames per chunk. 1024 ≈ 64ms at 16kHz — small enough that turn ends feel
  // prompt, large enough that we are not sending hundreds of tiny messages a
  // second over an elder's mobile data.
  var FRAME_SIZE = 1024;

  // The capture worklet runs on the audio thread and does nothing but fill a
  // buffer and hand it over. Kept dumb on purpose: work here is work done in the
  // real-time audio callback, where an overrun becomes a dropout.
  var WORKLET_SOURCE = [
    "class SakhaCaptureProcessor extends AudioWorkletProcessor {",
    "  constructor() { super(); this._buffer = new Float32Array(" + FRAME_SIZE + "); this._offset = 0; }",
    "  process(inputs) {",
    "    const channel = inputs[0] && inputs[0][0];",
    "    if (!channel) return true;",
    "    let read = 0;",
    "    while (read < channel.length) {",
    "      const space = this._buffer.length - this._offset;",
    "      const take = Math.min(space, channel.length - read);",
    "      this._buffer.set(channel.subarray(read, read + take), this._offset);",
    "      this._offset += take; read += take;",
    "      if (this._offset === this._buffer.length) {",
    "        const out = this._buffer;",
    "        this._buffer = new Float32Array(" + FRAME_SIZE + "); this._offset = 0;",
    "        this.port.postMessage(out, [out.buffer]);", // transferred, not copied
    "      }",
    "    }",
    "    return true;",
    "  }",
    "}",
    "registerProcessor('sakha-capture-processor', SakhaCaptureProcessor);",
  ].join("\n");

  function floatToPcm16(input) {
    var out = new Int16Array(input.length);
    for (var i = 0; i < input.length; i++) {
      var s = Math.max(-1, Math.min(1, input[i]));
      // Asymmetric on purpose: Int16 runs -32768..32767, so scaling both
      // directions by 32767 would clip quiet negatives differently.
      out[i] = s < 0 ? s * 32768 : s * 32767;
    }
    return out;
  }

  // Linear resample, and it runs almost always: phones hand back a 44.1k or 48k
  // AudioContext whatever you ask for, and sending 48k audio labelled 16k makes
  // the caller sound slow and deep to the recogniser — which looks like a
  // transcription problem and is not one.
  function resample(input, fromRate, toRate) {
    if (fromRate === toRate) return input;
    var ratio = fromRate / toRate;
    var length = Math.round(input.length / ratio);
    var out = new Float32Array(length);
    for (var i = 0; i < length; i++) {
      var pos = i * ratio;
      var idx = Math.floor(pos);
      var frac = pos - idx;
      var a = input[idx] || 0;
      var b = input[idx + 1] !== undefined ? input[idx + 1] : a;
      out[i] = a + (b - a) * frac;
    }
    return out;
  }

  function pcm16ToBase64(pcm) {
    var bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    var binary = "";
    var CHUNK = 0x8000; // fromCharCode.apply on a whole frame can blow the arg limit
    for (var i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function base64ToPcm16(b64) {
    var binary = atob(b64);
    var buffer = new ArrayBuffer(binary.length);
    var bytes = new Uint8Array(buffer);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Int16Array(buffer);
  }

  function VoiceCall(options) {
    this.options = options || {};
    this.status = "idle";
    this.ws = null;
    this.streamId =
      global.crypto && global.crypto.randomUUID
        ? global.crypto.randomUUID()
        : "sakha-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    this.mediaStream = null;
    this.captureContext = null;
    this.captureSource = null;
    this.captureWorklet = null;
    this.workletUrl = null;
    this.playbackContext = null;
    this.playbackQueueTime = 0;
    this.scheduledSources = [];
    this.muted = false;
    this.startedAt = null;
    this.outRate = (this.options.config && this.options.config.output_sample_rate) || DEFAULT_OUT_RATE;
    // Whether Sakha ever actually spoke. Distinguishes "they hung up" from "the
    // connection died before anything happened", which look identical otherwise.
    this.receivedAudio = false;
    this.inputLevel = 0;
    this.outputLevel = 0;
    this.outputAnalyser = null;
    this._analyserBuf = null;
  }

  VoiceCall.prototype.setStatus = function (next, detail) {
    if (this.status === next) return;
    this.status = next;
    if (this.options.onStatus) this.options.onStatus(next, detail || null);
  };

  VoiceCall.prototype.fail = function (message) {
    if (this.options.onError) this.options.onError(message);
    this.setStatus("error", message);
    // A failure at any point must release the microphone. Otherwise the phone's
    // recording indicator stays on with nothing telling them the call is over.
    this.stop();
  };

  VoiceCall.prototype.start = function () {
    var self = this;
    this.setStatus("connecting");
    // Microphone FIRST. On a phone this shows a permission sheet, and asking
    // before opening the socket means someone who declines never burns a ticket
    // — and, more importantly, keeps the whole chain inside the tap that started
    // it, which is what iOS requires to let any audio play at all.
    return this.startCapture()
      .then(function () {
        return self.openSocket();
      })
      .then(function () {
        self.startedAt = Date.now();
      })
      .catch(function (e) {
        var message = e && e.message ? e.message : "बात शुरू नहीं हो पाई।";
        self.fail(self.friendlyError(message, e));
        throw e;
      });
  };

  VoiceCall.prototype.friendlyError = function (message, e) {
    var name = e && e.name;
    if (name === "NotAllowedError" || /permission/i.test(message)) {
      return "सखा को सुनने के लिए माइक की इजाज़त चाहिए। इजाज़त दीजिए और फिर से बटन दबाइए।";
    }
    if (name === "NotFoundError") return "इस फ़ोन में माइक नहीं मिला।";
    if (name === "NotReadableError") return "माइक किसी दूसरे ऐप में चल रहा है। उसे बंद करके फिर कोशिश कीजिए।";
    return message;
  };

  VoiceCall.prototype.startCapture = function () {
    var self = this;
    return navigator.mediaDevices
      .getUserMedia({
        audio: {
          channelCount: 1,
          // All three matter far more on a phone held to a face in a room with a
          // television on than on a laptop. Without echo cancellation Sakha
          // hears his own voice through the speaker and answers himself.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then(function (stream) {
        self.mediaStream = stream;
        var Ctx = global.AudioContext || global.webkitAudioContext;
        self.captureContext = new Ctx({ sampleRate: SAMPLE_RATE });
        self.playbackContext = new Ctx({ sampleRate: self.outRate });
        var resumes = [];
        // iOS hands back suspended contexts even inside a gesture; without this
        // the caller hears nothing and there is no error to explain why.
        if (self.captureContext.state === "suspended") resumes.push(self.captureContext.resume());
        if (self.playbackContext.state === "suspended") resumes.push(self.playbackContext.resume());
        return Promise.all(resumes);
      })
      .then(function () {
        self.playbackQueueTime = self.playbackContext.currentTime;
        self.outputAnalyser = self.playbackContext.createAnalyser();
        self.outputAnalyser.fftSize = 256;
        self.outputAnalyser.connect(self.playbackContext.destination);
        self._analyserBuf = new Uint8Array(self.outputAnalyser.frequencyBinCount);

        var blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
        self.workletUrl = URL.createObjectURL(blob);
        return self.captureContext.audioWorklet.addModule(self.workletUrl);
      })
      .then(function () {
        self.captureSource = self.captureContext.createMediaStreamSource(self.mediaStream);
        self.captureWorklet = new AudioWorkletNode(self.captureContext, "sakha-capture-processor", {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 1,
        });
        var actualRate = self.captureContext.sampleRate;
        self.captureWorklet.port.onmessage = function (event) {
          var frame = event.data;
          self.trackInputLevel(frame);
          if (self.muted) return;
          self.sendChunk(floatToPcm16(resample(frame, actualRate, SAMPLE_RATE)));
        };
        self.captureSource.connect(self.captureWorklet);
      });
  };

  VoiceCall.prototype.trackInputLevel = function (frame) {
    var peak = 0;
    for (var i = 0; i < frame.length; i += 8) {
      var v = frame[i] < 0 ? -frame[i] : frame[i];
      if (v > peak) peak = v;
    }
    // Decay rather than snap, so the circle breathes instead of flickering.
    this.inputLevel = Math.max(peak, this.inputLevel * 0.82);
  };

  VoiceCall.prototype.readOutputLevel = function () {
    if (!this.outputAnalyser) return 0;
    this.outputAnalyser.getByteTimeDomainData(this._analyserBuf);
    var peak = 0;
    for (var i = 0; i < this._analyserBuf.length; i++) {
      var v = Math.abs(this._analyserBuf[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    this.outputLevel = Math.max(peak, this.outputLevel * 0.8);
    return this.outputLevel;
  };

  VoiceCall.prototype.openSocket = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      var ws = new WebSocket(self.options.signedUrl);
      // Without this, binary frames arrive as Blobs and the ArrayBuffer check in
      // handleMessage silently drops every one of them — a completely silent
      // call with no error anywhere.
      ws.binaryType = "arraybuffer";
      self.ws = ws;
      var opened = false;

      ws.addEventListener(
        "open",
        function () {
          opened = true;
          ws.send(
            JSON.stringify({ event: "start", stream_id: self.streamId, config: self.options.config })
          );
          self.setStatus("connected");
          resolve();
        },
        { once: true }
      );

      ws.addEventListener("message", function (event) {
        self.handleMessage(event.data);
      });

      ws.addEventListener("error", function () {
        if (opened) return;
        var message = "सखा तक पहुँच नहीं पाए। इंटरनेट देखकर फिर कोशिश कीजिए।";
        self.fail(message);
        reject(new Error(message));
      });

      ws.addEventListener("close", function (event) {
        // Always record why. A close with no explanation is the most confusing
        // failure here: the call sheet vanishes a second after it opens, which
        // looks like our bug and usually isn't.
        console.warn("[voice] socket closed", event.code, event.reason || "(no reason given)");
        if (!opened) {
          var message = "सखा से जुड़ नहीं पाए (" + event.code + ").";
          self.fail(message);
          reject(new Error(message));
          return;
        }
        // Closed after opening but before Sakha said anything: the call never
        // really started, so say so rather than letting the screen close itself.
        if (!self.receivedAudio && self.status !== "error" && !self.options.silentServer) {
          self.fail("बात जुड़ते ही कट गई। एक बार फिर कोशिश कीजिए।");
          return;
        }
        if (self.status !== "error") self.setStatus("ended");
      });
    });
  };

  VoiceCall.prototype.handleMessage = function (data) {
    // Speech arrives as a binary frame; only control messages are JSON.
    if (data instanceof ArrayBuffer) {
      this.receivedAudio = true;
      this.playPcmBuffer(new Int16Array(data));
      return;
    }
    if (typeof data !== "string") return;
    var msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      return;
    }

    switch (msg.event) {
      case "ack":
        // The server may assign its own stream id; every media_input after this
        // has to carry that one, not ours.
        if (typeof msg.stream_id === "string") this.streamId = msg.stream_id;
        break;
      case "media_output":
        if (msg.media && typeof msg.media.payload === "string") {
          this.receivedAudio = true;
          this.playPcm(msg.media.payload);
        }
        break;
      case "clear":
        // The caller talked over Sakha. Audio already scheduled would keep
        // playing over them for as long as the queue is deep.
        this.flushPlayback();
        break;
      case "error":
        this.fail(msg.message || "कुछ गड़बड़ हो गई।");
        break;
      default:
        break;
    }
    if (this.options.onEvent) this.options.onEvent(msg);
  };

  // Raw binary, not base64 inside JSON.
  //
  // This runs ~16 times a second for the whole call, and the server does the
  // same in reverse. Measured: Sarvam confirms a turn 0.75s after someone stops
  // speaking when tested on its own, but 2.4s inside the running server — the
  // provider was never the slow part, the encoding was. Binary also drops about
  // a third of the bytes, which matters on an elder's mobile data.
  VoiceCall.prototype.sendChunk = function (pcm) {
    var ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(pcm.buffer);
    } catch (e) {
      /* socket closed between the check and the write */
    }
  };

  VoiceCall.prototype.playPcm = function (payload) {
    this.playPcmBuffer(base64ToPcm16(payload));
  };

  VoiceCall.prototype.playPcmBuffer = function (pcm) {
    if (!pcm || !pcm.length) return;
    var ctx = this.playbackContext;
    if (!ctx) return;

    // Tagged with the rate it was SYNTHESISED at, not the capture rate. If the
    // browser refused that rate for the context, Web Audio resamples on playback
    // for free — what matters is that the buffer is labelled honestly.
    var buffer = ctx.createBuffer(1, pcm.length, this.outRate);
    var channel = buffer.getChannelData(0);
    for (var i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;

    var source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputAnalyser || ctx.destination);

    // The queue cursor is the whole trick for gapless playback: each chunk
    // starts exactly where the last one ended, never at "now". Clamping to
    // currentTime recovers if the network stalled long enough for the cursor to
    // fall into the past.
    var startAt = Math.max(this.playbackQueueTime, ctx.currentTime);
    source.start(startAt);
    this.playbackQueueTime = startAt + buffer.duration;

    var self = this;
    this.scheduledSources.push(source);
    source.onended = function () {
      var i = self.scheduledSources.indexOf(source);
      if (i >= 0) self.scheduledSources.splice(i, 1);
    };
  };

  VoiceCall.prototype.flushPlayback = function () {
    for (var i = 0; i < this.scheduledSources.length; i++) {
      try {
        this.scheduledSources[i].stop();
      } catch (e) {
        /* already finished */
      }
    }
    this.scheduledSources = [];
    if (this.playbackContext) this.playbackQueueTime = this.playbackContext.currentTime;
  };

  VoiceCall.prototype.setMuted = function (muted) {
    this.muted = Boolean(muted);
    // Disable the track too, so the mute is real at the device level and not
    // just a flag we could forget to check.
    if (this.mediaStream) {
      var tracks = this.mediaStream.getAudioTracks();
      for (var i = 0; i < tracks.length; i++) tracks[i].enabled = !this.muted;
    }
    return this.muted;
  };

  VoiceCall.prototype.elapsedSeconds = function () {
    return this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
  };

  // Teardown is exhaustive and order-sensitive on purpose: a leaked MediaStream
  // track leaves the phone's microphone indicator on after the call, which reads
  // as "it is still listening to me".
  VoiceCall.prototype.stop = function () {
    this.flushPlayback();

    var worklet = this.captureWorklet;
    this.captureWorklet = null;
    if (worklet) {
      try {
        worklet.port.onmessage = null;
        worklet.port.close();
        worklet.disconnect();
      } catch (e) {
        /* already torn down */
      }
    }
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }
    var src = this.captureSource;
    this.captureSource = null;
    if (src) {
      try {
        src.disconnect();
      } catch (e) {
        /* noop */
      }
    }
    var stream = this.mediaStream;
    this.mediaStream = null;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });

    var ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ event: "stop" }));
        ws.close();
      } catch (e) {
        /* noop */
      }
    }
    var capture = this.captureContext;
    this.captureContext = null;
    if (capture && capture.state !== "closed") capture.close().catch(function () {});

    var playback = this.playbackContext;
    this.playbackContext = null;
    this.outputAnalyser = null;
    if (playback && playback.state !== "closed") playback.close().catch(function () {});

    if (this.status !== "error") this.setStatus("ended");
  };

  // Ask our server for a session, then open the call. Two steps on purpose: the
  // credential is minted per call and single-use, so it cannot be lifted out of
  // the page and reused.
  function startVoiceCall(options) {
    var opts = options || {};
    return fetch("/api/voice/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: opts.phone || null, name: opts.name || null }),
    })
      .then(function (res) {
        return res.json().then(function (session) {
          if (!res.ok) {
            var err = new Error(session.error || "अभी बात शुरू नहीं हो पा रही।");
            // TRIAL_SPENT is the product working, not a fault — the page shows
            // it as a plain message rather than a failure.
            err.code = session.code || null;
            throw err;
          }
          return session;
        });
      })
      .then(function (session) {
        var call = new VoiceCall({
          signedUrl: session.signedUrl,
          config: session.config,
          // In demo mode the server sends no audio at all — the page speaks
          // Sakha's lines itself — so "nothing was ever heard" is not a failure.
          silentServer: session.voice === "device",
          onStatus: opts.onStatus,
          onError: opts.onError,
          onEvent: opts.onEvent,
        });
        return call.start().then(function () {
          return { call: call, session: session };
        });
      });
  }

  global.SakhaVoice = { VoiceCall: VoiceCall, start: startVoiceCall, SAMPLE_RATE: SAMPLE_RATE };
})(window);
