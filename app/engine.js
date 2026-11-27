// Learning Engine: everything that isn't drawing the page.
// Runs entirely in the browser. Your AI key and your work are kept in this
// browser's storage and are only ever sent to the AI provider you choose.
// This mirrors the Python engine in ../engine (same data format), so backups
// move between the two.

export const APP_VERSION = "2.2.0";

// ---------------------------------------------------------------- settings ---

// "kind" says how we talk to it: "http" (OpenAI-style web API), "chrome"
// (Chrome's built-in Gemini Nano), "webllm" (a model downloaded into the
// browser) or "auto" (the best no-setup option that works, with fallbacks).
export const PROVIDERS = {
  auto: {
    kind: "auto", label: "Automatic (no setup)", url: "", model: "", needsKey: false, keyless: true,
  },
  chrome: {
    kind: "chrome", label: "Chrome's built-in AI", url: "", model: "Gemini Nano", needsKey: false, keyless: true,
  },
  pollinations: {
    kind: "http", label: "Free shared AI (Pollinations)",
    url: "https://text.pollinations.ai/openai", model: "", needsKey: false, keyless: true, slow: true,
  },
  webllm: {
    kind: "webllm", label: "Private AI on this computer", url: "", model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    needsKey: false, keyless: true,
  },
  gemini: {
    label: "Google Gemini (free tier)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash", needsKey: true, keyUrl: "https://aistudio.google.com/apikey",
  },
  groq: {
    label: "Groq (free tier, very fast)",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile", needsKey: true, keyUrl: "https://console.groq.com/keys",
  },
  openrouter: {
    label: "OpenRouter (free models)",
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "meta-llama/llama-3.3-70b-instruct:free", needsKey: true, keyUrl: "https://openrouter.ai/keys",
  },
  custom: {
    label: "Other OpenAI-compatible service", url: "", model: "", needsKey: true, keyUrl: "",
  },
  local: {
    label: "Local model (llama.cpp on this computer)",
    url: "http://localhost:8080/v1/chat/completions", model: "local", needsKey: false, keyUrl: "",
    localOnly: true,
  },
};
export const DEFAULT_PROVIDER = "auto";

export const TOPICS = {
  midi: {
    name: "MIDI (theory, protocol and practical use in DAWs)",
    subtopics: [
      "MIDI messages and channels", "note on/off, velocity and aftertouch",
      "control change, program change and automation", "MIDI timing, clock and sync",
      "MIDI in DAWs: recording, quantising and editing", "MIDI routing, ports and hardware connections",
      "General MIDI, MPE and MIDI 2.0", "music theory for MIDI programming",
    ],
  },
  sound: {
    name: "Applied sound principles (acoustics, signal processing, psychoacoustics)",
    subtopics: [
      "sound waves, frequency and wavelength", "decibels and signal levels",
      "room acoustics and reflections", "EQ and filters", "dynamics processing: compression and gating",
      "sampling, bit depth and digital audio", "phase and comb filtering",
      "psychoacoustics and perception of loudness",
    ],
  },
  live: {
    name: "Live sound techniques (PA setup, mic placement, gain staging, feedback)",
    subtopics: [
      "PA system setup and speaker placement", "microphone types and polar patterns",
      "mic placement for instruments and vocals", "gain staging through the signal chain",
      "feedback causes and management", "monitor mixes and wedges vs in-ear",
      "mixing desk signal flow, auxes and inserts", "soundcheck workflow and troubleshooting",
    ],
  },
};

export const DIFFICULTY_MIN = 1, DIFFICULTY_MAX = 5, DIFFICULTY_START = 2;
export const UP_AFTER = 3, DOWN_AFTER = 2, WEAK_THRESHOLD = 0.6;
export const DIFFICULTY_LABELS = {
  1: "beginner: basic definitions and facts",
  2: "foundation: core concepts and simple applications",
  3: "intermediate: applying concepts to realistic situations",
  4: "advanced: troubleshooting, trade-offs and multi-step reasoning",
  5: "expert: edge cases, deep theory and professional practice",
};
export const ASSIGNMENT_PREFIX = "assignment-";
const HISTORY_LIMIT = 1500;
const MAX_CONTEXT_CHARS = 6000;
export const BUSY_RETRY_DELAYS = [2, 5, 10];  // seconds, for HTTP 503 / 429
const JSON_RETRIES = 2;

// ----------------------------------------------------------------- storage ---
// A tiny wrapper so tests can use an in-memory store instead of localStorage.

export class Store {
  constructor(backend) {
    this.b = backend || memoryBackend();
  }
  get(key, fallback) {
    let raw = null;
    try { raw = this.b.getItem("le:" + key); } catch (e) { return fallback; }
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch (e) {
      try { this.b.setItem("le:broken:" + key, raw); } catch (e2) { /* ignore */ }
      return fallback;
    }
  }
  set(key, value) {
    try {
      this.b.setItem("le:" + key, JSON.stringify(value));
    } catch (e) {
      throw new Error("Couldn't save: this browser's storage is full. Download a backup, " +
        "then delete old question banks or assignments.");
    }
  }
  remove(key) { try { this.b.removeItem("le:" + key); } catch (e) { /* ignore */ } }
  keys(prefix) {
    const out = [];
    try {
      for (let i = 0; i < this.b.length; i++) {
        const k = this.b.key(i);
        if (k && k.startsWith("le:" + prefix)) out.push(k.slice(3 + prefix.length));
      }
    } catch (e) { /* ignore */ }
    return out.sort();
  }
}

export function memoryBackend() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => Array.from(m.keys())[i] || null,
    get length() { return m.size; },
  };
}

export function nowIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" +
    pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}
export function todayStr(d) {
  d = d || new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
export function addDays(dayStr, n) {
  const [y, m, d] = dayStr.split("-").map(Number);
  return todayStr(new Date(y, m - 1, d + n));
}

export function isLocalPage(loc) {
  const h = (loc || (typeof location !== "undefined" ? location : {})).hostname || "";
  return h === "localhost" || h === "127.0.0.1";
}

// Settings remember a key and model per service, so switching to a no-setup
// option and back doesn't lose your key. Older single-service settings still load.
export function loadSettings(store, providerOverride) {
  const s = store.get("settings", {}) || {};
  const saved = Object.assign({}, s.saved || {});
  if (s.provider && !s.saved && PROVIDERS[s.provider])
    saved[s.provider] = {url: s.url || "", model: s.model || "", apiKey: s.apiKey || ""};
  let provider = providerOverride || s.provider;
  if (!PROVIDERS[provider]) provider = DEFAULT_PROVIDER;
  const p = PROVIDERS[provider], mine = saved[provider] || {};
  return {
    provider, label: p.label, kind: p.kind,
    url: (provider === "custom" ? mine.url : p.url) || p.url,
    model: (p.kind === "http" && mine.model) || p.model,
    apiKey: mine.apiKey || "",
    needsKey: p.needsKey, keyless: !!p.keyless,
  };
}
export function saveSettings(store, s) {
  const cur = store.get("settings", {}) || {};
  const saved = Object.assign({}, cur.saved || {});
  if (cur.provider && !cur.saved && PROVIDERS[cur.provider])
    saved[cur.provider] = {url: cur.url || "", model: cur.model || "", apiKey: cur.apiKey || ""};
  saved[s.provider] = {url: s.url || "", model: s.model || "", apiKey: s.apiKey || ""};
  store.set("settings", {provider: s.provider, saved});
}
export function isConfigured(settings) {
  if (settings.keyless) return true;
  return !!(settings.url && (!settings.needsKey || settings.apiKey));
}

// --------------------------------------------------------------- AI client ---

export class LLMError extends Error {}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

export const ONLINE_TIMEOUT_SEC = 45;   // wait this long for an online service to start answering
export const LOCAL_TIMEOUT_SEC = 300;   // a local model on an old Mac is slow
export const STREAM_IDLE_SEC = 60;      // give up if a streamed answer goes quiet this long

// Pulls the human-readable message out of an error reply (OpenAI or Google style).
export function errorMessage(text) {
  try {
    let d = JSON.parse(text);
    if (Array.isArray(d)) d = d[0];
    const e = d && (d.error || d);
    const m = e && (e.message || (typeof e === "string" ? e : ""));
    if (m) return String(m).slice(0, 300);
  } catch (e) { /* not JSON */ }
  return String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

// Gemini 2.5+ "thinks" before answering, which is slow and eats the answer's
// token budget. Turn it off (Flash) or down (Pro, Gemini 3) for quick replies.
export function reasoningEffort(provider, model) {
  if (provider !== "gemini") return null;
  const m = String(model || "").toLowerCase();
  if (/2\.5-flash/.test(m)) return "none";
  if (/gemini-(2\.5|[3-9])/.test(m)) return "low";
  return null;
}

class Timeout extends Error {}
class NetworkFail extends Error {}

export class LLM {
  constructor(settings, opts) {
    opts = opts || {};
    this.s = settings;
    this.fetch = opts.fetch || ((...a) => fetch(...a));
    this.sleep = opts.sleep || ((sec) => sleepMs(sec * 1000));
    this.isLocal = settings.provider === "local";
    this.timeoutSec = opts.timeoutSec || (this.isLocal ? LOCAL_TIMEOUT_SEC : ONLINE_TIMEOUT_SEC);
    this.idleSec = opts.idleSec || (this.isLocal ? LOCAL_TIMEOUT_SEC : STREAM_IDLE_SEC);
    this.schemaOk = this.isLocal;
    this.reasoning = reasoningEffort(settings.provider, settings.model);
    this.onRetry = opts.onRetry || (() => {});  // (try number, of how many); 0 = done
    // Free shared services ask you to wait between requests (HTTP 402/429 with
    // Retry-After); allow longer waits and more tries for them.
    this.shared = !!(PROVIDERS[settings.provider] || {}).slow;
    this.delays = opts.delays || (this.shared ? [5, 15, 30, 45, 60] : BUSY_RETRY_DELAYS);
    this.maxWait = this.shared ? 75 : 30;
  }
  describe() { return this.isLocal ? "local model" : this.s.label + (this.s.model ? " · " + this.s.model : ""); }
  headers() {
    const h = {"Content-Type": "application/json"};
    if (this.s.apiKey) h.Authorization = "Bearer " + this.s.apiKey;
    if (this.s.provider === "openrouter") h["X-Title"] = "Learning Engine";
    return h;
  }
  payload(messages, temperature, maxTokens, stream, schema) {
    const p = {model: this.s.model || "local", messages, temperature, max_tokens: maxTokens, stream: !!stream};
    if (this.shared) {
      delete p.model;   // let the free service use its default free model
      p.stream = false; // and ask for whole answers (streaming isn't documented there)
      p.max_tokens = maxTokens + 1500;  // its default model reasons before answering
    }
    if (this.s.provider === "gemini") p.max_tokens = maxTokens + 2048;  // room for any thinking
    if (this.reasoning) p.reasoning_effort = this.reasoning;
    if (schema && this.schemaOk) p.response_format = {type: "json_object", schema};
    return p;
  }
  async postOnce(payload) {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; if (ctl) ctl.abort(); }, this.timeoutSec * 1000);
    try {
      return await this.fetch(this.s.url, {method: "POST", headers: this.headers(), body: JSON.stringify(payload),
        signal: ctl ? ctl.signal : undefined});
    } catch (e) {
      if (timedOut) throw new Timeout();
      throw new NetworkFail(e && e.message);
    } finally {
      clearTimeout(timer);
    }
  }
  offlineOr(msg) {
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      return new LLMError("This computer seems to be offline. Check your internet connection and try again.");
    return new LLMError(msg);
  }
  async post(payload) {
    if (!this.s.url) throw new LLMError("No AI chosen yet. Open Settings and pick one.");
    if (this.s.needsKey && !this.s.apiKey) throw new LLMError("No API key yet. Open Settings and paste your free key.");
    const delays = this.delays.slice(), total = this.delays.length;
    const name = this.s.label + (this.s.model ? " (" + this.s.model + ")" : "");
    for (;;) {
      let r;
      try {
        r = await this.postOnce(payload);
      } catch (e) {
        if (this.isLocal) {
          if (e instanceof Timeout) throw new LLMError("The local model took longer than " + this.timeoutSec + " seconds. Try again or use a smaller model.");
          throw new LLMError("Can't reach the local model. Is llama-server running?");
        }
        // A busy or rate-limited service sometimes answers in a way the browser
        // can only see as a dropped connection, so treat it like "busy": retry.
        if (delays.length) {
          this.onRetry(total - delays.length + 1, total);
          await this.sleep(delays.shift());
          continue;
        }
        this.onRetry(0);
        if (e instanceof Timeout)
          throw this.offlineOr(name + " didn't answer within " + this.timeoutSec + " seconds, even after a few tries. " +
            "It's probably overloaded. Wait a minute and try again, or pick a lighter model (such as gemini-2.5-flash-lite) or another service in Settings.");
        throw this.offlineOr("Couldn't get an answer from " + name + ", even after a few tries. Usually this means the free service is " +
          "overloaded or your free daily limit is used up. Wait a minute and try again, or pick another model or service in Settings.");
      }
      if ([402, 429, 500, 502, 503, 504].includes(r.status) && (r.status !== 402 || this.shared) && delays.length) {
        let wait = delays.shift();
        const ra = parseFloat((r.headers && r.headers.get && r.headers.get("Retry-After")) || "0");
        if (ra > wait) wait = Math.min(this.maxWait, ra);
        this.onRetry(total - delays.length, total, wait);
        await this.sleep(wait);
        continue;
      }
      this.onRetry(0);
      if (r.ok) return r;
      const text = await r.text().catch(() => "");
      const msg = errorMessage(text);
      const low = msg.toLowerCase();
      if (r.status === 400 && payload.response_format) {
        this.schemaOk = false;
        payload = Object.assign({}, payload);
        delete payload.response_format;
        continue;
      }
      if (r.status === 400 && payload.reasoning_effort && /reason|think/.test(low)) {
        this.reasoning = null;  // this model can't change its thinking: ask without it
        payload = Object.assign({}, payload);
        delete payload.reasoning_effort;
        continue;
      }
      if (r.status === 401 || r.status === 403 || (r.status === 400 && /api.?key/.test(low)))
        throw new LLMError("The AI service rejected your key. Copy it again from the provider's website, paste it in Settings and click Save." +
          (msg ? " (It said: " + msg + ")" : ""));
      if (this.shared && (r.status === 402 || r.status === 429))
        throw new LLMError("The free shared AI is busy with other people right now. Wait a minute and try again, " +
          "or choose another option in Settings (your own free key is much faster).");
      if (r.status === 429)
        throw new LLMError("You've hit the free usage limit for " + name + ". Wait a minute (or until tomorrow for a daily limit), or pick another model in Settings." +
          (msg ? " (It said: " + msg + ")" : ""));
      if (r.status >= 500)
        throw new LLMError(name + " is overloaded right now. Wait a minute and try again, or pick a different model in Settings.");
      if (r.status === 404)
        throw new LLMError("The AI service doesn't know the model '" + this.s.model + "'. Pick another one in Settings." + (msg ? " (It said: " + msg + ")" : ""));
      throw new LLMError("The AI service said: " + (msg || "error HTTP " + r.status) + " (HTTP " + r.status + ")");
    }
  }
  async chat(messages, opts) {
    opts = opts || {};
    const r = await this.post(this.payload(messages, opts.temperature ?? 0.7, opts.maxTokens || 700, false, opts.schema));
    let data;
    try { data = await r.json(); } catch (e) { throw new LLMError("Unexpected reply from the AI service."); }
    try { return data.choices[0].message.content || ""; } catch (e) {
      throw new LLMError("Unexpected reply from the AI service: " + JSON.stringify(data).slice(0, 200));
    }
  }
  // Yields text chunks as the model writes them.
  async *stream(messages, opts) {
    opts = opts || {};
    const payload = this.payload(messages, opts.temperature ?? 0.7, opts.maxTokens || 700, true);
    const r = await this.post(payload);
    if (!payload.stream) {  // service answered in one go
      let data;
      try { data = await r.json(); } catch (e) { throw new LLMError("Unexpected reply from the AI service."); }
      const text = (((data.choices || [])[0] || {}).message || {}).content || "";
      if (!text) throw new LLMError("The AI sent an empty answer. Try again.");
      yield text;
      return;
    }
    if (!r.body || !r.body.getReader) {  // no streaming support: return it in one go
      yield* parseSse(await r.text());
      return;
    }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      let timer;
      const idle = new Promise((_, reject) => { timer = setTimeout(() => reject(new Timeout()), this.idleSec * 1000); });
      let res;
      try {
        res = await Promise.race([reader.read(), idle]);
      } catch (e) {
        reader.cancel().catch(() => {});
        if (e instanceof Timeout) throw new LLMError("The AI stopped answering part way through. Try again.");
        throw new LLMError("The connection dropped part way through the answer. Try again.");
      } finally {
        clearTimeout(timer);
      }
      if (res.done) break;
      buf += dec.decode(res.value, {stream: true});
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        const chunk = sseChunk(line);
        if (chunk === null) return;
        if (chunk) yield chunk;
      }
    }
    const last = sseChunk(buf);
    if (last) yield last;
  }
  async chatJson(messages, schema, validate, opts) {
    opts = opts || {};
    let convo = messages.slice(), lastError = "no attempt made";
    for (let i = 0; i <= JSON_RETRIES; i++) {
      const text = await this.chat(convo, {temperature: opts.temperature ?? 0.4, maxTokens: opts.maxTokens || 600, schema});
      try { return validate(extractJson(text)); } catch (e) {
        if (e instanceof LLMError) throw e;
        lastError = e.message;
        convo = messages.concat([
          {role: "assistant", content: text.slice(0, 1500)},
          {role: "user", content: "That was not valid (" + lastError + "). Reply again with ONLY the JSON object, nothing else."},
        ]);
      }
    }
    throw new LLMError("The AI kept returning unusable output (" + lastError + ").");
  }
  async check() {
    const reply = await this.chat([{role: "user", content: "Reply with the word OK."}], {temperature: 0, maxTokens: 20});
    return "Connected to " + this.describe() + ". It replied: " + (reply.trim().slice(0, 40) || "(an empty reply, but the connection works)");
  }
}

// ------------------------------------------------- no-setup AI options ---

// Chrome's built-in AI (Gemini Nano): free, private (stays on the computer), no key.
// Needs a recent Chrome on a fairly powerful computer (Google: macOS 13+ or
// Windows 10/11, 16 GB RAM). Returns "available", "downloadable",
// "downloading" or "unavailable".
export async function chromeAIStatus(g) {
  g = g || globalThis;
  try {
    if (!g.LanguageModel || !g.LanguageModel.availability) return "unavailable";
    return await g.LanguageModel.availability({expectedInputs: [{type: "text", languages: ["en"]}],
      expectedOutputs: [{type: "text", languages: ["en"]}]});
  } catch (e) { return "unavailable"; }
}

function splitMessages(messages) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  const last = rest.pop() || {content: ""};
  return {system, history: rest, prompt: last.content};
}

export class ChromeLLM extends LLM {
  constructor(settings, opts) {
    super(Object.assign({}, settings, {provider: "chrome", label: PROVIDERS.chrome.label, model: "Gemini Nano", url: "chrome"}), opts);
    this.g = (opts && opts.global) || globalThis;
    this.onProgress = (opts && opts.onProgress) || (() => {});
  }
  describe() { return "Chrome's built-in AI"; }
  async session(messages) {
    const LM = this.g.LanguageModel;
    if (!LM) throw new LLMError("Chrome's built-in AI isn't available in this browser or on this computer.");
    const {system, history, prompt} = splitMessages(messages);
    const initialPrompts = (system ? [{role: "system", content: system}] : []).concat(history);
    const onProgress = this.onProgress;
    try {
      const sess = await LM.create({
        initialPrompts,
        expectedInputs: [{type: "text", languages: ["en"]}], expectedOutputs: [{type: "text", languages: ["en"]}],
        monitor(m) { m.addEventListener("downloadprogress", (e) => onProgress("Setting up Chrome's built-in AI (one-time download)", e.loaded)); },
      });
      return {sess, prompt};
    } catch (e) {
      throw new LLMError("Chrome's built-in AI couldn't start: " + ((e && e.message) || e));
    }
  }
  async chat(messages) {
    const {sess, prompt} = await this.session(messages);
    try { return await sess.prompt(prompt); } catch (e) {
      throw new LLMError("Chrome's built-in AI stopped: " + ((e && e.message) || e));
    } finally { if (sess.destroy) sess.destroy(); }
  }
  async *stream(messages) {
    const {sess, prompt} = await this.session(messages);
    try {
      for await (const chunk of sess.promptStreaming(prompt)) yield chunk;
    } catch (e) {
      throw new LLMError("Chrome's built-in AI stopped: " + ((e && e.message) || e));
    } finally { if (sess.destroy) sess.destroy(); }
  }
}

// A small open model downloaded once into the browser and run on the
// computer's graphics chip (WebGPU). Private and free, but needs a download
// of about 1 GB and a reasonably recent computer.
export const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm@0.2.79";
export const WEBLLM_MODELS = ["Qwen2.5-1.5B-Instruct-q4f16_1-MLC", "Llama-3.2-1B-Instruct-q4f16_1-MLC"];
let webllmEngine = null, webllmModel = null;

export async function webgpuSupported(g) {
  g = g || globalThis;
  try { return !!(g.navigator && g.navigator.gpu && await g.navigator.gpu.requestAdapter()); } catch (e) { return false; }
}

export async function webllmDownloaded(store) {
  return !!(store && (store.get("meta", {}) || {}).webllm_ready);
}

export class WebLLMClient extends LLM {
  constructor(settings, opts) {
    super(Object.assign({}, settings, {provider: "webllm", label: PROVIDERS.webllm.label, url: "webllm"}), opts);
    this.onProgress = (opts && opts.onProgress) || (() => {});
    this.store = opts && opts.store;
    this.importer = (opts && opts.importer) || ((url) => import(url));
  }
  describe() { return "private AI on this computer" + (webllmModel ? " (" + webllmModel.split("-q4")[0] + ")" : ""); }
  async engine() {
    if (webllmEngine) return webllmEngine;
    if (!(await webgpuSupported())) throw new LLMError("This computer or browser can't run the private AI (it needs WebGPU, found in recent Chrome on most computers from about 2016 onwards).");
    let lib;
    try { lib = await this.importer(WEBLLM_URL); } catch (e) {
      throw new LLMError("Couldn't load the private AI software. Check your internet connection and try again.");
    }
    let lastErr = null;
    for (const model of WEBLLM_MODELS) {
      try {
        webllmEngine = await lib.CreateMLCEngine(model, {initProgressCallback: (p) =>
          this.onProgress("Downloading the private AI (one time only): " + (p.text || ""), p.progress)});
        webllmModel = model;
        if (this.store) this.store.set("meta", Object.assign(this.store.get("meta", {}) || {}, {webllm_ready: model}));
        return webllmEngine;
      } catch (e) { lastErr = e; }
    }
    throw new LLMError("The private AI couldn't start on this computer: " + ((lastErr && lastErr.message) || lastErr));
  }
  async chat(messages, opts) {
    opts = opts || {};
    const eng = await this.engine();
    const r = await eng.chat.completions.create({messages, temperature: opts.temperature ?? 0.7, max_tokens: opts.maxTokens || 700});
    return ((r.choices || [])[0] || {}).message?.content || "";
  }
  async *stream(messages, opts) {
    opts = opts || {};
    const eng = await this.engine();
    const chunks = await eng.chat.completions.create({messages, temperature: opts.temperature ?? 0.7, max_tokens: opts.maxTokens || 700, stream: true});
    for await (const c of chunks) {
      const t = c.choices && c.choices[0] && c.choices[0].delta && c.choices[0].delta.content;
      if (t) yield t;
    }
  }
}

// "Automatic": tries the no-setup options best-first and falls back to the
// next one if one isn't available or fails:
//   1. Chrome's built-in AI, if this computer already has it (private, fast)
//   2. the private downloaded AI, if it was downloaded before (private)
//   3. the free shared AI (Pollinations), which works anywhere but is slow
export class AutoLLM extends LLM {
  constructor(settings, opts) {
    super(Object.assign({}, settings, {provider: "auto", label: PROVIDERS.auto.label, url: "auto"}), opts);
    this.opts = opts || {};
    this.chosen = null;
    this.candidates = this.opts.candidates || null;  // tests can pass their own list
  }
  describe() { return this.chosen ? this.chosen.describe() : "the best free option available"; }
  async list() {
    if (this.candidates) return this.candidates;
    const out = [];
    if ((await chromeAIStatus(this.opts.global)) === "available") out.push(new ChromeLLM({}, this.opts));
    if (await webllmDownloaded(this.opts.store)) out.push(new WebLLMClient({}, this.opts));
    out.push(new LLM(loadSettings(new Store(), "pollinations"), this.opts));
    this.candidates = out;
    return out;
  }
  async order() {
    const all = await this.list();
    return this.chosen ? [this.chosen].concat(all.filter((c) => c !== this.chosen)) : all;
  }
  async chat(messages, opts) {
    let last = null;
    for (const c of await this.order()) {
      try { const t = await c.chat(messages, opts); this.chosen = c; return t; } catch (e) {
        if (!(e instanceof LLMError)) throw e;
        last = e;
      }
    }
    throw last || new LLMError("No free AI option is working right now. Try again in a minute, or add your own free key in Settings.");
  }
  async *stream(messages, opts) {
    let last = null;
    for (const c of await this.order()) {
      let started = false;
      try {
        for await (const chunk of c.stream(messages, opts)) { started = true; this.chosen = c; yield chunk; }
        if (started) return;
        this.chosen = c;
        return;
      } catch (e) {
        if (started || !(e instanceof LLMError)) throw e;  // can't switch half way through an answer
        last = e;
      }
    }
    throw last || new LLMError("No free AI option is working right now.");
  }
  async check() {
    const reply = await this.chat([{role: "user", content: "Reply with the word OK."}], {temperature: 0, maxTokens: 20});
    return "Working: using " + this.describe() + ". It replied: " + (reply.trim().slice(0, 40) || "(empty)");
  }
}

// One place that turns settings into the right kind of AI client.
export function makeLLM(settings, opts) {
  const kind = (PROVIDERS[settings.provider] || {}).kind;
  if (kind === "auto") return new AutoLLM(settings, opts);
  if (kind === "chrome") return new ChromeLLM(settings, opts);
  if (kind === "webllm") return new WebLLMClient(settings, opts);
  return new LLM(settings, opts);
}

// Returns text, "" for nothing, or null for the end of the stream.
function sseChunk(line) {
  line = line.trim();
  if (!line.startsWith("data:")) return "";
  const data = line.slice(5).trim();
  if (data === "[DONE]") return null;
  try {
    const d = JSON.parse(data).choices[0].delta || {};
    return d.content || "";
  } catch (e) { return ""; }
}
function* parseSse(text) {
  for (const line of text.split("\n")) {
    const c = sseChunk(line);
    if (c === null) return;
    if (c) yield c;
  }
}

export function extractJson(text) {
  if (!text || !text.trim()) throw new Error("empty reply");
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  const cands = [];
  let m;
  while ((m = fence.exec(text))) cands.push(m[1]);
  cands.push(text);
  for (let c of cands) {
    c = c.trim();
    try { return JSON.parse(c); } catch (e) { /* keep looking */ }
    const block = firstBalanced(c);
    if (!block) continue;
    for (const attempt of [block, block.replace(/,\s*([}\]])/g, "$1")]) {
      try { return JSON.parse(attempt); } catch (e) { /* next */ }
    }
  }
  throw new Error("no JSON object found");
}
function firstBalanced(text) {
  let start = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === "{" || text[i] === "[") { start = i; break; }
  if (start < 0) return null;
  const open = text[start], close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

// ----------------------------------------------------------- model picker ---

const NOT_CHAT = ["whisper", "tts", "embed", "imagen", "veo", "aqa", "guard", "orpheus",
  "moderation", "dall-e", "image", "native-audio", "audio", "live", "learnlm", "computer-use", "robotics", "lyria"];

export function modelsUrl(chatUrl) {
  let u = (chatUrl || "").trim().replace(/\/+$/, "");
  if (u.endsWith("/chat/completions")) u = u.slice(0, -"/chat/completions".length);
  return u + "/models";
}

function isFree(it) {
  if (String(it.id || "").endsWith(":free")) return true;
  const p = it.pricing;
  return !!(p && Number(p.prompt) === 0 && Number(p.completion) === 0);
}

export function parseModels(data, provider) {
  let items = Array.isArray(data) ? data : (data && (data.data || data.models));
  if (!Array.isArray(items)) throw new LLMError("The provider's model list was in an unexpected format.");
  const out = [], seen = new Set();
  for (let it of items) {
    if (typeof it === "string") it = {id: it};
    if (!it || typeof it !== "object" || it.active === false) continue;
    let id = String(it.id || it.name || "").trim();
    if (id.startsWith("models/")) id = id.slice(7);
    const low = id.toLowerCase();
    if (!id || seen.has(id) || NOT_CHAT.some((w) => low.includes(w))) continue;
    // Gemma models on Gemini's API reject the instructions this app sends.
    if (provider === "gemini" && low.startsWith("gemma")) continue;
    seen.add(id);
    out.push({id, free: isFree(it)});
  }
  let res = out;
  if (provider === "openrouter") {
    const free = out.filter((x) => x.free);
    if (free.length) res = free;
  }
  res.sort((a, b) => a.id.toLowerCase().localeCompare(b.id.toLowerCase()));
  return res;
}

export async function listModels(settings, fetchFn) {
  fetchFn = fetchFn || ((...a) => fetch(...a));
  if (!settings.url) throw new LLMError("No API address set.");
  if (settings.needsKey && !settings.apiKey && settings.provider !== "openrouter")
    throw new LLMError("Paste your API key first, then the model list can be loaded.");
  const headers = {};
  if (settings.apiKey) headers.Authorization = "Bearer " + settings.apiKey;
  let r;
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), 15000);
  try { r = await fetchFn(modelsUrl(settings.url), {headers, signal: ctl ? ctl.signal : undefined}); } catch (e) {
    throw new LLMError("Couldn't load the model list (no answer from the service). The suggested model usually works.");
  } finally { clearTimeout(timer); }
  if (!r.ok) {
    const msg = errorMessage(await r.text().catch(() => ""));
    if (r.status === 401 || r.status === 403 || (r.status === 400 && /api.?key/i.test(msg)))
      throw new LLMError("The key was rejected. Copy it again from the provider's website and paste it here." + (msg ? " (It said: " + msg + ")" : ""));
    throw new LLMError("Couldn't load the model list (HTTP " + r.status + (msg ? ": " + msg : "") + ").");
  }
  let data;
  try { data = await r.json(); } catch (e) { throw new LLMError("The provider's model list was in an unexpected format."); }
  const models = parseModels(data, settings.provider);
  if (!models.length) throw new LLMError("The provider didn't list any chat models. You can type a model name instead.");
  return models;
}

// ---------------------------------------------------------------- prompts ---

const TUTOR_SYSTEM = "You are a patient, accurate tutor for a music technology student. " +
  "Explain clearly with concrete examples from studios, DAWs and live gigs. Be concise. Use short paragraphs or bullet points.";
const COACH_SYSTEM = "You are a writing coach for a college student. Your job is to help the student " +
  "learn and write their OWN assignment. You must NEVER write any part of the assignment for them: " +
  "no finished paragraphs, no sample essays, no rewritten versions of their text. Instead you explain " +
  "concepts, ask guiding questions, suggest structure as headings with notes, point out problems, and " +
  "give hints. If asked to write the assignment, kindly refuse and offer coaching instead.";

export const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    question: {type: "string"},
    choices: {type: "array", items: {type: "string"}, minItems: 4, maxItems: 4},
    answer_index: {type: "integer", minimum: 0, maximum: 3},
    explanation: {type: "string"},
  },
  required: ["question", "choices", "answer_index", "explanation"],
};
const CONCEPTS_SCHEMA = {
  type: "object",
  properties: {concepts: {type: "array", minItems: 2, maxItems: 8, items: {
    type: "object", properties: {name: {type: "string"}, why: {type: "string"}}, required: ["name", "why"]}}},
  required: ["concepts"],
};
const EXAMPLE = '{"question": "Which MIDI message tells a synth to start playing a note?", ' +
  '"choices": ["Note On", "Program Change", "Control Change", "Pitch Bend"], "answer_index": 0, ' +
  '"explanation": "A Note On message carries the note number and velocity and starts the note. The others change sounds, controls or pitch."}';

export function trim(text, limit) {
  limit = limit || MAX_CONTEXT_CHARS;
  text = (text || "").trim();
  return text.length <= limit ? text : text.slice(0, limit) + "\n[...trimmed to fit the model...]";
}

export const prompts = {
  question(topicName, subtopic, difficulty, avoid, context, contextKind) {
    const parts = ["Write ONE multiple-choice quiz question.", "Topic: " + topicName, "Focus: " + subtopic,
      "Difficulty " + difficulty + "/5 (" + (DIFFICULTY_LABELS[difficulty] || "") + ")."];
    if (context) parts.push((contextKind === "notes" ? "Use these notes about the student's course as a guide:" : "Base the question on this assignment brief:") +
      '\n"""\n' + trim(context, 2500) + '\n"""');
    if (avoid && avoid.length) parts.push("Do NOT repeat these existing questions:\n- " + avoid.map((a) => a.slice(0, 120)).join("\n- "));
    parts.push("Rules: exactly 4 choices, exactly one correct, wrong choices must be plausible, no 'all of the above'. " +
      "answer_index is 0-3. Explanation is 1-3 sentences and says why the answer is right.",
    "Reply with ONLY a JSON object like this example:", EXAMPLE);
    return [{role: "system", content: "You write accurate exam questions. You reply only with JSON."},
      {role: "user", content: parts.join("\n")}];
  },
  reexplain(q, chosen) {
    const choices = q.choices.map((c, i) => "ABCD"[i] + ". " + c).join("\n");
    const picked = chosen == null ? "(no answer)" : q.choices[chosen];
    return [{role: "system", content: TUTOR_SYSTEM}, {role: "user", content:
      "I'm struggling with " + (q.subtopic || "this") + ". I just got this wrong.\n\nQuestion: " + q.question + "\n" + choices +
      "\n\nI answered: " + picked + "\nCorrect answer: " + q.choices[q.answer_index] + "\n\n" +
      "Re-teach the underlying concept from scratch in simple terms (under 200 words): 1) the core idea, " +
      "2) why my answer was tempting but wrong, 3) a real-world example, 4) one memory tip."}];
  },
  weakSpots(topicName, weak, misses) {
    const lines = weak.map((w) => "- " + w.subtopic + " (mastery " + Math.round(w.mastery * 100) + "%, " + w.seen + " answered)");
    const miss = misses.map((m) => "- " + m.slice(0, 150)).join("\n") || "- none recorded";
    return [{role: "system", content: TUTOR_SYSTEM}, {role: "user", content:
      "Topic: " + topicName + "\nMy weakest areas:\n" + lines.join("\n") + "\n\nQuestions I recently got wrong:\n" + miss +
      "\n\nGive me a short study plan (under 250 words): for each weak area, the key idea I am probably missing and " +
      "one practical exercise I can do (in a DAW or with real gear)."}];
  },
  brief(a) {
    let out = "Assignment: " + a.title + "\n";
    if (a.course) out += "Course: " + a.course + "\n";
    out += 'Brief:\n"""\n' + trim(a.brief_text) + '\n"""\n';
    if (a.rubric_text) out += 'Marking rubric:\n"""\n' + trim(a.rubric_text, 2000) + '\n"""\n';
    return out;
  },
  concepts(a) {
    return [{role: "system", content: "You analyse assignment briefs. You reply only with JSON."}, {role: "user", content:
      prompts.brief(a) + "\nList the 3-6 key concepts or skills the student must understand to do this assignment well. " +
      'Reply ONLY with JSON like: {"concepts": [{"name": "Gain staging", "why": "The brief asks you to set up a mixer signal chain without clipping."}]}'}];
  },
  learn(a, c) {
    return [{role: "system", content: TUTOR_SYSTEM}, {role: "user", content: prompts.brief(a) +
      '\nTeach me the concept "' + c.name + '" (' + (c.why || "") + "). Under 300 words: explain the idea, give a concrete " +
      "example, show how it connects to this assignment, and end with two questions I should be able to answer before I start writing."}];
  },
  followup(a, c, history, question) {
    return [{role: "system", content: TUTOR_SYSTEM + ' The student is studying "' + c.name + '" for the assignment "' + a.title + '".'}]
      .concat(history.slice(-6), [{role: "user", content: question}]);
  },
  outline(a) {
    return [{role: "system", content: COACH_SYSTEM}, {role: "user", content: prompts.brief(a) +
      "\nHelp me plan my answer. Give a suggested structure as section headings only. Under each heading list: what that " +
      "section needs to achieve, 2-3 guiding questions I should answer in my own words, and which rubric points it covers. " +
      "Do not write any sentences of the assignment itself."}];
  },
  hint(a, stuck) {
    return [{role: "system", content: COACH_SYSTEM}, {role: "user", content: prompts.brief(a) +
      "\nI'm stuck on this part: " + stuck + "\n\nGive me hints and guiding questions to get unstuck, without writing it for me. Under 200 words."}];
  },
  feedback(a, draft) {
    return [{role: "system", content: COACH_SYSTEM}, {role: "user", content: prompts.brief(a) +
      '\nHere is my draft:\n"""\n' + trim(draft, 4000) + '\n"""\n\n' +
      "Give feedback like a tutor marking against the brief and rubric:\n1. What is working well\n" +
      "2. What is missing or weak, mapped to rubric points\n3. Accuracy problems (wrong facts or terms)\n" +
      "4. Three specific things to improve next, as instructions or questions\n" +
      "Quote at most a few words of my draft to point at things. Do NOT rewrite my sentences or give replacement text."}];
  },
};

// -------------------------------------------------------------- questions ---

const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
const stripLetter = (c) => String(c).replace(/^\s*[A-Da-d][).:]\s+/, "").trim();

export function validateQuestion(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("expected a JSON object");
  if (Array.isArray(obj.questions) && obj.questions.length) {
    obj = obj.questions[0];
    if (!obj || typeof obj !== "object") throw new Error("expected a JSON object");
  }
  const q = String(obj.question || "").trim();
  let choices = obj.choices || obj.options;
  if (q.length < 10) throw new Error("question text missing or too short");
  if (!Array.isArray(choices) || choices.length !== 4) throw new Error("need exactly 4 choices");
  choices = choices.map(stripLetter);
  if (choices.some((c) => !c)) throw new Error("a choice is empty");
  if (new Set(choices.map(norm)).size !== 4) throw new Error("choices must all be different");
  let ans = obj.answer_index !== undefined ? obj.answer_index : obj.answer;
  if (typeof ans === "string") {
    const s = ans.trim();
    if (s.length === 1 && "ABCD".includes(s.toUpperCase())) ans = "ABCD".indexOf(s.toUpperCase());
    else if (/^\d+$/.test(s)) ans = parseInt(s, 10);
    else { const i = choices.findIndex((c) => norm(c) === norm(stripLetter(s))); ans = i >= 0 ? i : null; }
  }
  if (typeof ans !== "number" || !Number.isInteger(ans) || ans < 0 || ans > 3) throw new Error("answer_index must be 0-3");
  const explanation = String(obj.explanation || "").trim();
  if (!explanation) throw new Error("explanation missing");
  return {question: q, choices, answer_index: ans, explanation};
}

function shortId() {
  const a = new Uint8Array(5);
  (globalThis.crypto || {getRandomValues: (x) => x.map(() => Math.floor(Math.random() * 256))}).getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class QuestionBank {
  constructor(store, topic) {
    this.store = store; this.topic = topic;
    this.questions = store.get("questions:" + topic, []) || [];
  }
  save() { this.store.set("questions:" + this.topic, this.questions); }
  get length() { return this.questions.length; }
  byId(id) { return this.questions.find((q) => q.id === id) || null; }
  isDuplicate(text) { const n = norm(text); return this.questions.some((q) => norm(q.question) === n); }
  add(cleaned, subtopic, difficulty, source) {
    if (this.isDuplicate(cleaned.question)) return null;
    const q = Object.assign({}, cleaned, {id: shortId(), topic: this.topic, subtopic, difficulty: +difficulty,
      type: "mcq", source: source || "generated", created_at: nowIso()});
    this.questions.push(q);
    this.save();
    return q;
  }
  recentTexts(subtopic, limit) {
    return this.questions.filter((q) => !subtopic || q.subtopic === subtopic).slice(-(limit || 8)).map((q) => q.question);
  }
  // Same rules as the Python version: unseen first, sometimes missed ones, weak subtopics weighted up.
  pick(difficulty, exclude, qstats, mastery, rand) {
    rand = rand || Math.random;
    const ex = new Set(exclude || []);
    for (const spread of [0, 1]) {
      const pool = this.questions.filter((q) => Math.abs(q.difficulty - difficulty) <= spread && !ex.has(q.id));
      if (!pool.length) continue;
      const unseen = pool.filter((q) => !(q.id in qstats));
      const missed = pool.filter((q) => qstats[q.id] && qstats[q.id].last_correct === false);
      const order = missed.length && rand() < 0.3 ? [missed, unseen, pool] : [unseen, missed, pool];
      for (const g of order) if (g.length) return weightedChoice(g, g.map((q) => 1.2 - (mastery[q.subtopic] ?? 0.5)), rand);
    }
    return null;
  }
}
function weightedChoice(items, weights, rand) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// --------------------------------------------------------------- progress ---

const ANSWER_SCORE = {"true3": 1.0, "true2": 0.85, "true1": 0.6, "false1": 0.3, "false2": 0.15, "false3": 0.0};
export function answerScore(correct, confidence) {
  return ANSWER_SCORE[String(!!correct) + Math.min(3, Math.max(1, confidence | 0))];
}

export function adaptiveUpdate(difficulty, cs, ws, correct) {
  if (correct) {
    cs += 1;
    if (cs >= UP_AFTER) { const n = Math.min(DIFFICULTY_MAX, difficulty + 1); return {difficulty: n, cs: 0, ws: 0, change: n !== difficulty ? "up" : null, reexplain: false}; }
    return {difficulty, cs, ws: 0, change: null, reexplain: false};
  }
  ws += 1;
  if (ws >= DOWN_AFTER) { const n = Math.max(DIFFICULTY_MIN, difficulty - 1); return {difficulty: n, cs: 0, ws: 0, change: n !== difficulty ? "down" : null, reexplain: true}; }
  return {difficulty, cs: 0, ws, change: null, reexplain: false};
}

// Spaced repetition (Leitner boxes): right moves a question up a box and pushes
// its next review further away; wrong sends it back to box 1, due today.
export const REVIEW_INTERVAL_DAYS = {1: 1, 2: 3, 3: 7, 4: 14, 5: 30};
export function schedule(stats, correct, today) {
  today = today || todayStr();
  if (correct) {
    stats.box = Math.min(5, (stats.box || 0) + 1);
    stats.due = addDays(today, REVIEW_INTERVAL_DAYS[stats.box]);
  } else { stats.box = 1; stats.due = today; }
}
export function isDue(stats, today) {
  today = today || todayStr();
  if (stats.due) return stats.due <= today;
  return stats.last_correct === false;
}

function blankProgress() {
  return {current_difficulty: DIFFICULTY_START, streak: {correct: 0, wrong: 0}, history: [], subtopic_stats: {}, question_stats: {}};
}

export class Progress {
  constructor(store, topic) {
    this.store = store; this.topic = topic;
    this.data = Object.assign(blankProgress(), store.get("progress:" + topic, {}) || {});
  }
  save() { this.store.set("progress:" + this.topic, this.data); }
  get difficulty() { return this.data.current_difficulty | 0; }
  record(q, chosen, confidence, adapt) {
    if (adapt === undefined) adapt = true;
    const correct = chosen != null && chosen === q.answer_index, d = this.data;
    d.history.push({question_id: q.id, subtopic: q.subtopic || "general", difficulty: q.difficulty || this.difficulty,
      chosen, correct, confidence, ts: nowIso()});
    if (d.history.length > HISTORY_LIMIT) d.history.splice(0, d.history.length - HISTORY_LIMIT);
    const sub = q.subtopic || "general";
    const s = d.subtopic_stats[sub] || (d.subtopic_stats[sub] = {seen: 0, correct: 0, mastery: 0.5});
    s.seen += 1; s.correct += correct ? 1 : 0;
    s.mastery = Math.round(((1 - 0.35) * s.mastery + 0.35 * answerScore(correct, confidence)) * 10000) / 10000;
    s.last_seen = nowIso();
    const qs = d.question_stats[q.id] || (d.question_stats[q.id] = {seen: 0, correct: 0});
    qs.seen += 1; qs.correct += correct ? 1 : 0; qs.last_correct = correct;
    schedule(qs, correct && confidence >= 2);
    let dec = {difficulty: this.difficulty, change: null, reexplain: false};
    if (adapt) {
      dec = adaptiveUpdate(this.difficulty, d.streak.correct, d.streak.wrong, correct);
      d.current_difficulty = dec.difficulty;
      d.streak = {correct: dec.cs, wrong: dec.ws};
    }
    this.save();
    return dec;
  }
  weakSpots(threshold) {
    threshold = threshold ?? WEAK_THRESHOLD;
    return this.allSubtopics().filter((r) => r.seen && r.mastery < threshold);
  }
  allSubtopics() {
    return Object.entries(this.data.subtopic_stats).map(([k, v]) => Object.assign({subtopic: k}, v)).sort((a, b) => a.mastery - b.mastery);
  }
  recentMisses(limit) {
    const out = [];
    for (let i = this.data.history.length - 1; i >= 0 && out.length < (limit || 8); i--) {
      const h = this.data.history[i];
      if (!h.correct && !out.includes(h.question_id)) out.push(h.question_id);
    }
    return out;
  }
  dueIds(today) {
    return Object.entries(this.data.question_stats).filter(([, s]) => isDue(s, today))
      .sort((a, b) => String(a[1].due || "").localeCompare(String(b[1].due || ""))).map(([id]) => id);
  }
  totals() {
    const h = this.data.history, right = h.filter((x) => x.correct).length;
    return {answered: h.length, correct: right, accuracy: h.length ? right / h.length : 0, difficulty: this.difficulty};
  }
}

// ------------------------------------------------------------ assignments ---

const slug = (t) => (t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "assignment");

export const GENERAL_MODULE = "general";

// Every assignment lives in exactly one module's folder. Assignments made
// before modules existed (or whose module was deleted) go into "General".
export class Assignments {
  constructor(store) { this.store = store; }
  all() {
    const all = this.store.get("assignments", {}) || {};
    const mods = new Modules(this.store);
    let changed = false;
    for (const a of Object.values(all)) {
      if (!a.module || !mods.has(a.module)) { a.module = ensureGeneralModule(this.store); changed = true; }
    }
    if (changed) this.store.set("assignments", all);
    return all;
  }
  list(module) {
    return Object.values(this.all()).filter((a) => !module || a.module === module).sort((a, b) => a.title.localeCompare(b.title));
  }
  move(id, module) {
    if (!new Modules(this.store).has(module)) throw new Error("That module no longer exists.");
    const a = this.get(id);
    a.module = module;
    this.save(a);
    return a;
  }
  get(id) { const a = this.all()[id]; if (!a) throw new Error("That assignment no longer exists."); return a; }
  save(a) { const all = this.all(); a.updated_at = nowIso(); all[a.id] = a; this.store.set("assignments", all); }
  add(f) {
    if (!(f.title || "").trim() || !(f.brief || "").trim()) throw new Error("An assignment needs a title and the brief text.");
    const all = this.all(), base = slug(f.title);
    let id = base, n = 2;
    while (all[id]) id = base + "-" + n++;
    const a = {id, title: f.title.trim(), course: (f.course || "").trim(), due: (f.due || "").trim(),
      brief_text: f.brief.trim(), rubric_text: (f.rubric || "").trim(), concepts: [], outline: "", drafts: [],
      working_draft: "", notes: "", lessons: {}, hints: [], created_at: nowIso(),
      module: new Modules(this.store).has(f.module) ? f.module : ensureGeneralModule(this.store)};
    this.save(a);
    return a;
  }
  remove(id) {
    const all = this.all(); delete all[id]; this.store.set("assignments", all);
    this.store.remove("questions:" + ASSIGNMENT_PREFIX + id);
    this.store.remove("progress:" + ASSIGNMENT_PREFIX + id);
  }
}

export function validateConcepts(obj) {
  const items = obj && !Array.isArray(obj) ? obj.concepts : obj;
  if (!Array.isArray(items)) throw new Error("expected a list of concepts");
  const out = [];
  for (const it of items) {
    if (typeof it === "string" && it.trim()) out.push({name: it.trim(), why: ""});
    else if (it && typeof it === "object" && String(it.name || "").trim()) out.push({name: String(it.name).trim(), why: String(it.why || "").trim()});
  }
  if (out.length < 2) throw new Error("need at least 2 concepts");
  return out.slice(0, 8);
}

export async function concepts(llm, assignments, a, refresh) {
  if (a.concepts && a.concepts.length && !refresh) return a.concepts;
  a.concepts = await llm.chatJson(prompts.concepts(a), CONCEPTS_SCHEMA, validateConcepts, {temperature: 0.3, maxTokens: 500});
  assignments.save(a);
  return a.concepts;
}

// Assignment work as a Markdown file you can keep, print or hand in alongside your draft.
export function assignmentMarkdown(a) {
  const out = ["# " + a.title, ""];
  const meta = [a.course, a.due ? "due " + a.due : ""].filter(Boolean).join(" · ");
  if (meta) out.push("_" + meta + "_", "");
  out.push("## Brief", "", a.brief_text, "");
  if (a.rubric_text) out.push("## Rubric", "", a.rubric_text, "");
  if (a.notes) out.push("## My notes", "", a.notes, "");
  if (a.working_draft) out.push("## My current draft", "", a.working_draft, "");
  if (a.outline) out.push("## Plan (from the writing coach)", "", a.outline, "");
  (a.drafts || []).forEach((d, i) => out.push("## Feedback " + (i + 1) + " (" + String(d.ts).replace("T", " ") + ")", "", d.feedback, ""));
  for (const [name, msgs] of Object.entries(a.lessons || {})) {
    out.push("## Lesson: " + name, "");
    for (const m of msgs) out.push(m.role === "user" ? "**Me:** " + m.content : m.content, "");
  }
  return out.join("\n");
}

// ----------------------------------------------------------------- topics ---

// ---------------------------------------------------------------- modules ---
// A module is a class subject you study (MIDI, Music composition, ...). Each
// one has its own question bank, progress, spaced review and notes. Modules
// live in this browser's storage; the first time the app runs it creates the
// built-in ones plus some starter modules, all of which you can edit or delete.

export const STARTER_MODULES = {
  "music-business": {
    name: "Music business and marketing",
    description: "How the music industry works and how artists earn, promote and protect their music.",
    subtopics: ["copyright, publishing and ownership", "royalties and collecting societies", "record deals and contracts",
      "streaming, distribution and release planning", "music marketing and social media", "branding and building an audience",
      "live music business and touring", "music industry careers, networking and freelancing"],
  },
  "creative-labs": {
    name: "Creative project labs",
    description: "Planning, making and reflecting on creative music projects.",
    subtopics: ["reading a brief and planning a project", "creative research and reference tracks", "collaboration and teamwork",
      "production workflow and file management", "critical listening and giving feedback", "reflective practice and evaluation",
      "presenting and pitching your work", "time management and meeting deadlines"],
  },
  "composition": {
    name: "Music composition",
    description: "Writing and developing musical ideas, from melody and harmony to form and arranging.",
    subtopics: ["melody writing", "harmony and chord progressions", "rhythm and groove", "song structure and form",
      "motifs and thematic development", "arranging and orchestration", "counterpoint and voice leading", "composing for film, games and media"],
  },
};

function seedModules(store) {
  const mods = {};
  for (const [k, t] of Object.entries(TOPICS)) mods[k] = {key: k, name: t.name, description: "", notes: "", my_notes: "", subtopics: t.subtopics.slice(), created_at: nowIso()};
  mods.live.name = "Live sound practices (PA setup, mic placement, gain staging, feedback)";
  for (const [k, t] of Object.entries(STARTER_MODULES)) mods[k] = Object.assign({key: k, notes: "", my_notes: "", created_at: nowIso()}, JSON.parse(JSON.stringify(t)));
  // Anything already studied under a name we don't know becomes a module, so no work is lost.
  for (const k of store.keys("questions:").concat(store.keys("progress:"))) {
    if (!mods[k] && !k.startsWith(ASSIGNMENT_PREFIX) && SAFE_KEY.test(k))
      mods[k] = {key: k, name: k.replace(/-/g, " "), description: "", notes: "", my_notes: "", subtopics: ["general"], created_at: nowIso()};
  }
  return mods;
}

export class Modules {
  constructor(store) { this.store = store; }
  all() {
    let mods = this.store.get("modules", null);
    if (!mods || typeof mods !== "object") {
      mods = seedModules(this.store);
      this.store.set("modules", mods);
    }
    return mods;
  }
  list() { return Object.values(this.all()).sort((a, b) => a.name.localeCompare(b.name)); }
  has(key) { return !!this.all()[key]; }
  get(key) { const m = this.all()[key]; if (!m) throw new Error("That module no longer exists."); return m; }
  save(m) { const all = this.all(); m.updated_at = nowIso(); all[m.key] = m; this.store.set("modules", all); }
  add(f) {
    const name = (f.name || "").trim();
    if (!name) throw new Error("Give the module a name.");
    const all = this.all();
    if (Object.values(all).some((m) => m.name.toLowerCase() === name.toLowerCase())) throw new Error("You already have a module called that.");
    let base = slug(name);
    if (base.startsWith(ASSIGNMENT_PREFIX)) base = "m-" + base;
    let key = base, n = 2;
    while (all[key] || this.store.get("questions:" + key, null) || this.store.get("progress:" + key, null)) key = base + "-" + n++;
    const m = {key, name: name.slice(0, 120), description: (f.description || "").trim().slice(0, 500), notes: (f.notes || "").trim(),
      my_notes: "", subtopics: cleanSubtopics(f.subtopics), created_at: nowIso()};
    this.save(m);
    return m;
  }
  update(key, f) {
    const m = this.get(key);
    if (f.name !== undefined) {
      const name = String(f.name).trim();
      if (!name) throw new Error("Give the module a name.");
      if (this.list().some((x) => x.key !== key && x.name.toLowerCase() === name.toLowerCase())) throw new Error("You already have a module called that.");
      m.name = name.slice(0, 120);
    }
    if (f.description !== undefined) m.description = String(f.description).trim().slice(0, 500);
    if (f.notes !== undefined) m.notes = String(f.notes).trim();
    if (f.my_notes !== undefined) m.my_notes = String(f.my_notes);
    if (f.subtopics !== undefined) m.subtopics = cleanSubtopics(f.subtopics);
    this.save(m);
    return m;
  }
  // Deletes the module with its questions and progress. Its assignments are
  // never deleted with it: they move to the "General" folder.
  remove(key) {
    const all = this.all();
    delete all[key];
    this.store.set("modules", all);
    this.store.remove("questions:" + key);
    this.store.remove("progress:" + key);
    const asg = this.store.get("assignments", {}) || {};
    const moved = Object.values(asg).filter((a) => a.module === key);
    if (moved.length) {
      const general = key === GENERAL_MODULE ? null : ensureGeneralModule(this.store);
      if (!general) {  // deleting General itself while it holds work: recreate it
        const a2 = this.all(); a2[GENERAL_MODULE] = {key: GENERAL_MODULE, name: "General", description: "", notes: "", my_notes: "",
          subtopics: ["study skills and key ideas"], created_at: nowIso()}; this.store.set("modules", a2);
      }
      for (const a of moved) a.module = GENERAL_MODULE;
      this.store.set("assignments", asg);
    }
    return moved.length;
  }
}

export function ensureGeneralModule(store) {
  const mods = new Modules(store);
  if (!mods.has(GENERAL_MODULE)) {
    const all = mods.all();
    all[GENERAL_MODULE] = {key: GENERAL_MODULE, name: "General", description: "Assignments that aren't in a specific module yet.",
      notes: "", my_notes: "", subtopics: ["study skills and key ideas"], created_at: nowIso()};
    store.set("modules", all);
  }
  return GENERAL_MODULE;
}

export function cleanSubtopics(v) {
  const list = (Array.isArray(v) ? v : String(v || "").split(/\n|;/)).map((x) => String(x).replace(/^\s*[-*•\d.)]+\s*/, "").trim())
    .filter(Boolean).map((x) => x.slice(0, 120));
  const uniq = Array.from(new Set(list)).slice(0, 12);
  return uniq.length ? uniq : [];
}

const SUBTOPICS_SCHEMA = {type: "object", properties: {subtopics: {type: "array", items: {type: "string"}, minItems: 4, maxItems: 10}}, required: ["subtopics"]};
export function validateSubtopics(obj) {
  const items = obj && !Array.isArray(obj) ? obj.subtopics : obj;
  if (!Array.isArray(items)) throw new Error("expected a list of subtopics");
  const out = cleanSubtopics(items.map((x) => (x && typeof x === "object" ? x.name : x)));
  if (out.length < 3) throw new Error("need at least 3 subtopics");
  return out.slice(0, 10);
}

// Asks the AI to split a new module into 6-8 study areas, guided by its notes.
export async function suggestSubtopics(llm, m) {
  const parts = ["A college music technology student is studying the module \"" + m.name + "\"."];
  if (m.description) parts.push("Description: " + m.description);
  if (m.notes) parts.push('Course notes or syllabus:\n"""\n' + trim(m.notes, 3000) + '\n"""');
  parts.push("List 6-8 subtopics to quiz them on, each a short phrase, covering the module evenly. " +
    'Reply ONLY with JSON like: {"subtopics": ["copyright basics", "royalties"]}');
  return llm.chatJson([{role: "system", content: "You plan college courses. You reply only with JSON."}, {role: "user", content: parts.join("\n")}],
    SUBTOPICS_SCHEMA, validateSubtopics, {temperature: 0.3, maxTokens: 400});
}

export function topicInfo(store, key) {
  if (key.startsWith(ASSIGNMENT_PREFIX)) {
    const a = new Assignments(store).get(key.slice(ASSIGNMENT_PREFIX.length));
    const subs = (a.concepts || []).map((c) => c.name);
    return {key, name: "Assignment: " + a.title, subtopics: subs.length ? subs : ["key ideas in the brief"], context: a.brief_text, contextKind: "brief"};
  }
  const mods = new Modules(store);
  if (mods.has(key)) {
    const m = mods.get(key);
    const context = [m.description, m.notes].filter(Boolean).join("\n\n");
    return {key, name: m.name, subtopics: m.subtopics && m.subtopics.length ? m.subtopics.slice() : ["key ideas of " + m.name],
      context: context || null, contextKind: "notes"};
  }
  throw new Error("Unknown topic " + key);
}

export function allTopicKeys(store) {
  const asg = new Assignments(store).list();  // first, so old assignments are filed into General before modules are listed
  return new Modules(store).list().map((m) => m.key).concat(asg.map((a) => ASSIGNMENT_PREFIX + a.id));
}

// -------------------------------------------------------------- generator ---

export function planDifficulties(n, centre) {
  const pattern = [0, 0, 1, 0, -1, 1, 0, 0, -1, 1];
  return Array.from({length: n}, (_, i) => Math.max(DIFFICULTY_MIN, Math.min(DIFFICULTY_MAX, centre + pattern[i % pattern.length])));
}

export async function generateOne(llm, bank, info, subtopic, difficulty, source) {
  const cleaned = await llm.chatJson(prompts.question(info.name, subtopic, difficulty, bank.recentTexts(subtopic, 6), info.context, info.contextKind),
    QUESTION_SCHEMA, validateQuestion, {temperature: 0.6, maxTokens: 500});
  return bank.add(cleaned, subtopic, difficulty, source);
}

export async function generate(store, llm, key, n, opts) {
  opts = opts || {};
  const info = topicInfo(store, key), bank = new QuestionBank(store, key);
  const levels = opts.level ? Array(n).fill(+opts.level) : planDifficulties(n, new Progress(store, key).difficulty);
  const source = key.startsWith(ASSIGNMENT_PREFIX) ? "assignment:" + key.slice(ASSIGNMENT_PREFIX.length) : "generated";
  let added = 0, failed = 0, dupes = 0;
  for (let i = 0; i < n; i++) {
    const counts = {};
    info.subtopics.forEach((s) => (counts[s] = 0));
    bank.questions.forEach((q) => { if (q.subtopic in counts) counts[q.subtopic]++; });
    const sub = info.subtopics.reduce((best, s) => (counts[s] < counts[best] ? s : best), info.subtopics[0]);
    if (opts.onProgress) opts.onProgress(i, n, sub + " (level " + levels[i] + ")");
    try {
      const q = await generateOne(llm, bank, info, sub, levels[i], source);
      if (q) added++; else dupes++;
    } catch (e) {
      failed++;
      if (/reach|key|rate limit|overloaded|model '|No AI/.test(e.message)) throw e;
    }
  }
  if (opts.onProgress) opts.onProgress(n, n, "done");
  return {added, failed, duplicates: dupes, total: bank.length};
}

// ------------------------------------------------------------------- quiz ---

export class QuizSession {
  // mode "adaptive" (normal) or "review" (spaced-repetition: only questions due today)
  constructor(store, llm, key, length, mode) {
    this.store = store; this.llm = llm; this.key = key; this.mode = mode || "adaptive";
    this.info = topicInfo(store, key);
    this.bank = new QuestionBank(store, key);
    this.progress = new Progress(store, key);
    this.dueQueue = this.mode === "review" ? this.progress.dueIds().filter((id) => this.bank.byId(id)) : [];
    this.length = this.mode === "review" ? Math.min(length, this.dueQueue.length) : length;
    this.asked = []; this.results = []; this.current = null; this.lastWrong = null;
    this.startDifficulty = this.progress.difficulty;
  }
  get finished() { return this.results.length >= this.length; }
  get difficulty() { return this.progress.difficulty; }
  async next() {
    if (this.finished) return null;
    if (this.current) return this.current;
    let q = null;
    if (this.mode === "review") {
      q = this.bank.byId(this.dueQueue.shift());
    } else {
      const mastery = {};
      for (const [k, v] of Object.entries(this.progress.data.subtopic_stats)) mastery[k] = v.mastery;
      q = this.bank.pick(this.difficulty, this.asked, this.progress.data.question_stats, mastery);
      if (!q) {
        const weak = this.progress.weakSpots().map((w) => w.subtopic).filter((s) => this.info.subtopics.includes(s));
        const sub = weak[0] || this.info.subtopics[Math.floor(Math.random() * this.info.subtopics.length)];
        q = await generateOne(this.llm, this.bank, this.info, sub, this.difficulty, "generated");
      }
    }
    this.current = q;
    return q;
  }
  answer(chosen, confidence) {
    const q = this.current;
    if (!q) throw new Error("No question waiting for an answer");
    const before = this.difficulty;
    const dec = this.progress.record(q, chosen, confidence, this.mode !== "review");
    const correct = chosen != null && chosen === q.answer_index;
    this.asked.push(q.id);
    const r = {correct, chosen, answer_index: q.answer_index, explanation: q.explanation,
      difficulty_before: before, difficulty: dec.difficulty, change: dec.change, reexplain: dec.reexplain};
    this.results.push(r);
    this.lastWrong = correct ? null : {q, chosen};
    this.current = null;
    return r;
  }
  reexplain() {
    if (!this.lastWrong) return (async function* () {})();
    return this.llm.stream(prompts.reexplain(this.lastWrong.q, this.lastWrong.chosen), {temperature: 0.6, maxTokens: 450});
  }
  summary() {
    return {answered: this.results.length, correct: this.results.filter((r) => r.correct).length,
      start_difficulty: this.startDifficulty, end_difficulty: this.difficulty, weak_spots: this.progress.weakSpots().slice(0, 3),
      mode: this.mode};
  }
}

// ------------------------------------------------------------ review/stats ---

export function progressKeys(store) { return store.keys("progress:"); }

export function report(store, key) {
  const prog = new Progress(store, key), bank = new QuestionBank(store, key);
  const misses = prog.recentMisses().map((id) => bank.byId(id)).filter(Boolean)
    .map((q) => ({question: q.question, answer: q.choices[q.answer_index], subtopic: q.subtopic || ""}));
  let name = key;
  try { name = topicInfo(store, key).name; } catch (e) { /* deleted assignment */ }
  return {topic: key, name, totals: prog.totals(), subtopics: prog.allSubtopics(), weak: prog.weakSpots(), misses};
}

export function studyPlan(llm, rep) {
  const weak = rep.weak.length ? rep.weak : rep.subtopics.slice(0, 3);
  return llm.stream(prompts.weakSpots(rep.name, weak, rep.misses.map((m) => m.question)), {temperature: 0.5, maxTokens: 500});
}

export function streak(daySet, today) {
  today = today || todayStr();
  let d = daySet.has(today) ? today : addDays(today, -1), n = 0;
  while (daySet.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

export function stats(store, today) {
  today = today || todayStr();
  const days = new Set(), due = [];
  let answeredToday = 0;
  for (const key of progressKeys(store)) {
    let info;
    try { info = topicInfo(store, key); } catch (e) { continue; }
    const p = new Progress(store, key), bank = new QuestionBank(store, key);
    for (const h of p.data.history) {
      const d = String(h.ts || "").slice(0, 10);
      if (!d) continue;
      days.add(d);
      if (d === today) answeredToday++;
    }
    const n = p.dueIds(today).filter((id) => bank.byId(id)).length;
    if (n) due.push({key, name: info.name, due: n});
  }
  return {streak: streak(days, today), studiedToday: days.has(today), answeredToday, daysStudied: days.size,
    dueTotal: due.reduce((a, r) => a + r.due, 0), due};
}

// ----------------------------------------------------- folder downloads ---
// A .zip with one folder per module, each holding its own notes and its own
// assignments, so the downloaded files are organised the same way as the app.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
// Minimal "stored" (uncompressed) zip writer: [{path, text}] -> Uint8Array.
export function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const u16 = (v) => [v & 0xFF, (v >>> 8) & 0xFF];
  const u32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
  for (const f of files) {
    const name = enc.encode(f.path), data = enc.encode(f.text), crc = crc32(data);
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
    const local = new Uint8Array([...u32(0x04034b50), ...common]);
    parts.push(local, name, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = parts.concat(central, [end]), out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of all) { out.set(p, pos); pos += p.length; }
  return out;
}

export function safeName(s) {
  return String(s || "untitled").replace(/[\\/:*?"<>|\x00-\x1f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60) || "untitled";
}

export function moduleText(m) {
  const out = ["# " + m.name, ""];
  if (m.description) out.push(m.description, "");
  out.push("## Subtopics", "", ...(m.subtopics || []).map((x) => "- " + x), "");
  if (m.notes) out.push("## Course notes", "", m.notes, "");
  if (m.my_notes) out.push("## My notes", "", m.my_notes, "");
  return out.join("\n");
}

// Files for one module (or every module), laid out as folders.
export function moduleFiles(store, onlyKey) {
  const files = [], used = new Set();
  const mods = new Modules(store), asg = new Assignments(store);
  for (const m of mods.list()) {
    if (onlyKey && m.key !== onlyKey) continue;
    let folder = safeName(m.name.replace(/\s*\(.*\)\s*$/, ""));
    while (used.has(folder)) folder += " (" + m.key + ")";
    used.add(folder);
    files.push({path: folder + "/About this module.txt", text: moduleText(m)});
    for (const a of asg.list(m.key)) files.push({path: folder + "/Assignments/" + safeName(a.title) + ".txt", text: assignmentMarkdown(a)});
  }
  return files;
}

// ---------------------------------------------------------- backup/restore ---
// The same file format as `python main.py backup`. Your API key is never included.

export function exportBackup(store) {
  const out = {app: "learning-engine", version: 1, exported_at: nowIso(), questions: {}, progress: {}, assignments: {}};
  for (const k of store.keys("questions:")) out.questions[k] = store.get("questions:" + k, []);
  for (const k of store.keys("progress:")) out.progress[k] = store.get("progress:" + k, {});
  out.assignments = store.get("assignments", {}) || {};
  out.modules = new Modules(store).all();
  return out;
}

const SAFE_KEY = /^[a-z0-9-]{1,80}$/;

// Merges a backup into this browser. Questions are merged by id; for progress,
// whichever copy has more answers wins; assignments are added or replaced.
export function importBackup(store, data) {
  if (!data || data.app !== "learning-engine" || typeof data.questions !== "object")
    throw new Error("That file isn't a Learning Engine backup.");
  const counts = {topics: 0, questions: 0, assignments: 0};
  for (const [k, qs] of Object.entries(data.questions || {})) {
    if (!SAFE_KEY.test(k) || !Array.isArray(qs)) continue;
    const bank = new QuestionBank(store, k), have = new Set(bank.questions.map((q) => q.id));
    for (const q of qs) {
      if (!q || typeof q !== "object" || !q.id || have.has(q.id)) continue;
      try { validateQuestion(q); } catch (e) { continue; }
      bank.questions.push(q); have.add(q.id); counts.questions++;
    }
    bank.save();
  }
  for (const [k, p] of Object.entries(data.progress || {})) {
    if (!SAFE_KEY.test(k) || !p || typeof p !== "object" || !Array.isArray(p.history)) continue;
    const mine = new Progress(store, k);
    if (p.history.length >= mine.data.history.length) {
      store.set("progress:" + k, Object.assign(blankProgress(), p));
      counts.topics++;
    }
  }
  const all = store.get("assignments", {}) || {};
  for (const [id, a] of Object.entries(data.assignments || {})) {
    if (!SAFE_KEY.test(id) || !a || typeof a !== "object" || a.id !== id || !a.title || !a.brief_text) continue;
    all[id] = a; counts.assignments++;
  }
  store.set("assignments", all);
  // Modules: add or update the ones in the file; make sure every imported bank has a module.
  const mods = new Modules(store), have = mods.all();
  counts.modules = 0;
  for (const [k, m] of Object.entries(data.modules || {})) {
    if (!SAFE_KEY.test(k) || k.startsWith(ASSIGNMENT_PREFIX) || !m || typeof m !== "object" || !String(m.name || "").trim()) continue;
    have[k] = {key: k, name: String(m.name).trim().slice(0, 120), description: String(m.description || "").slice(0, 500),
      notes: String(m.notes || ""), my_notes: String(m.my_notes || ""), subtopics: cleanSubtopics(m.subtopics || []),
      created_at: m.created_at || nowIso()};
    counts.modules++;
  }
  // Banks, and assignment folders from the terminal version, that have no module yet get one.
  const asgModules = Object.values(data.assignments || {}).map((a) => (a && typeof a.module === "string" ? a.module : "")).filter(Boolean);
  for (const k of Object.keys(data.questions || {}).concat(Object.keys(data.progress || {}), asgModules)) {
    if (SAFE_KEY.test(k) && !k.startsWith(ASSIGNMENT_PREFIX) && !have[k])
      have[k] = {key: k, name: k === GENERAL_MODULE ? "General" : TOPICS[k] ? TOPICS[k].name : k.replace(/-/g, " "), description: "", notes: "", my_notes: "",
        subtopics: TOPICS[k] ? TOPICS[k].subtopics.slice() : ["general"], created_at: nowIso()};
  }
  store.set("modules", have);
  store.set("meta", Object.assign(store.get("meta", {}) || {}, {last_import: nowIso()}));
  return counts;
}

export function hasAnyWork(store) {
  // (modules alone don't count: everyone starts with some)
  return store.keys("progress:").length > 0 || store.keys("questions:").length > 0 || new Assignments(store).list().length > 0;
}
