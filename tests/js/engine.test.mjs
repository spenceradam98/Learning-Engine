// Run with: node --test tests/js/engine.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../../app/engine.js";

const q = (id, opts = {}) => Object.assign({id, subtopic: "EQ and filters", difficulty: 2, answer_index: 0,
  question: "Question " + id + " about things?", choices: ["a", "b", "c", "d"], explanation: "x"}, opts);

function fakeResponse(status, body, headers = {}) {
  return {status, ok: status >= 200 && status < 300, headers: {get: (k) => headers[k] || null},
    json: async () => body, text: async () => JSON.stringify(body), body: null};
}
const settings = (over = {}) => Object.assign({provider: "gemini", label: "Gemini", url: "https://x/v1/chat/completions",
  model: "m", apiKey: "k", needsKey: true}, over);

test("extractJson handles fences, chatter and trailing commas", () => {
  assert.deepEqual(E.extractJson('Sure!\n```json\n{"a": [1, 2]}\n```'), {a: [1, 2]});
  assert.deepEqual(E.extractJson('Answer: {"q": "What is {this}?", "c": [1, 2,],}'), {q: "What is {this}?", c: [1, 2]});
  assert.throws(() => E.extractJson("I cannot do that."));
});

test("validateQuestion accepts letters and rejects bad questions", () => {
  const out = E.validateQuestion({question: "What does CC stand for?", choices: ["A) Control Change", "B) Channel", "C) Clock", "D) Cue"], answer: "A", explanation: "CC."});
  assert.equal(out.answer_index, 0);
  assert.equal(out.choices[0], "Control Change");
  assert.throws(() => E.validateQuestion({question: "Too few choices here?", choices: ["a", "b"], answer_index: 0, explanation: "x"}));
  assert.throws(() => E.validateQuestion({question: "Duplicate choices?", choices: ["a", "a", "b", "c"], answer_index: 0, explanation: "x"}));
});

test("retries when the service is busy (503) then succeeds", async () => {
  const calls = [], waits = [];
  const replies = [fakeResponse(503, {}), fakeResponse(429, {}, {"Retry-After": "7"}),
    fakeResponse(200, {choices: [{message: {content: "OK"}}]})];
  const llm = new E.LLM(settings(), {fetch: async (...a) => { calls.push(a); return replies.shift(); }, sleep: async (s) => waits.push(s)});
  assert.equal(await llm.chat([{role: "user", content: "hi"}]), "OK");
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [2, 7]);
});

test("gives a clear message when still busy after the retries", async () => {
  const llm = new E.LLM(settings(), {fetch: async () => fakeResponse(503, {}), sleep: async () => {}});
  await assert.rejects(llm.chat([{role: "user", content: "hi"}]), /overloaded/);
});

test("needs a key before calling the AI", async () => {
  const llm = new E.LLM(settings({apiKey: ""}), {fetch: async () => { throw new Error("should not call"); }});
  await assert.rejects(llm.chat([{role: "user", content: "hi"}]), /API key/);
});

test("model list: Gemini prefixes stripped, non-chat models dropped", () => {
  const out = E.parseModels({data: [{id: "models/gemini-2.5-flash"}, {id: "models/text-embedding-004"}, {id: "models/imagen-3"}, {id: "models/gemini-2.0-flash"}]}, "gemini");
  assert.deepEqual(out.map((m) => m.id), ["gemini-2.0-flash", "gemini-2.5-flash"]);
});

test("model list: OpenRouter shows only free models", () => {
  const out = E.parseModels({data: [{id: "a/paid", pricing: {prompt: "0.001", completion: "0.002"}},
    {id: "b/x:free", pricing: {prompt: "0", completion: "0"}}, {id: "c/zero", pricing: {prompt: "0", completion: "0"}}]}, "openrouter");
  assert.deepEqual(out.map((m) => m.id), ["b/x:free", "c/zero"]);
});

test("listModels calls /models with the key", async () => {
  let seen = null;
  const models = await E.listModels(settings({provider: "groq"}), async (url, opts) => { seen = [url, opts.headers.Authorization];
    return fakeResponse(200, {data: [{id: "llama-3.3-70b-versatile"}, {id: "whisper-large-v3"}]}); });
  assert.deepEqual(seen, ["https://x/v1/models", "Bearer k"]);
  assert.deepEqual(models.map((m) => m.id), ["llama-3.3-70b-versatile"]);
});

test("progress saves, adapts difficulty and schedules reviews", () => {
  const store = new E.Store();
  const p = new E.Progress(store, "live");
  for (let i = 0; i < 3; i++) p.record(q("c" + i), 0, 2);
  assert.equal(new E.Progress(store, "live").difficulty, 3);
  p.record(q("w1"), 1, 3);
  const st = p.data.question_stats;
  assert.equal(st.c0.box, 1);
  assert.equal(st.c0.due, E.addDays(E.todayStr(), 1));
  assert.equal(st.w1.due, E.todayStr());
  assert.deepEqual(p.dueIds(), ["w1"]);
});

test("a lucky guess doesn't push a question further away", () => {
  const s = {};
  E.schedule(s, true, "2026-01-01");
  assert.equal(s.due, "2026-01-02");
  E.schedule(s, true, "2026-01-02");
  assert.equal(s.due, "2026-01-05");
  E.schedule(s, false, "2026-01-05");
  assert.deepEqual([s.box, s.due], [1, "2026-01-05"]);
});

test("review quiz only asks due questions and keeps the level", async () => {
  const store = new E.Store();
  const bank = new E.QuestionBank(store, "midi");
  bank.questions = [q("a"), q("b"), q("c")]; bank.save();
  const p = new E.Progress(store, "midi");
  p.record(bank.byId("a"), 1, 2); p.record(bank.byId("b"), 0, 3);
  const s = new E.QuizSession(store, null, "midi", 10, "review");
  assert.equal(s.length, 1);
  const first = await s.next();
  assert.equal(first.id, "a");
  s.answer(0, 3);
  assert.ok(s.finished);
  assert.equal(new E.Progress(store, "midi").difficulty, E.DIFFICULTY_START);
});

test("streak counts days in a row ending today or yesterday", () => {
  assert.equal(E.streak(new Set(["2026-03-01", "2026-03-02", "2026-03-03"]), "2026-03-03"), 3);
  assert.equal(E.streak(new Set(["2026-03-01", "2026-03-02"]), "2026-03-03"), 2);
  assert.equal(E.streak(new Set(["2026-03-01"]), "2026-03-03"), 0);
});

test("backup round-trips and never includes the key", () => {
  const a = new E.Store();
  E.saveSettings(a, settings({apiKey: "secret-key"}));
  const bank = new E.QuestionBank(a, "sound"); bank.questions = [q("x")]; bank.save();
  new E.Progress(a, "sound").record(q("x"), 0, 2);
  const asg = new E.Assignments(a).add({title: "Live report", brief: "Write about a gig."});
  asg.working_draft = "my draft"; new E.Assignments(a).save(asg);
  const file = JSON.stringify(E.exportBackup(a));
  assert.ok(!file.includes("secret-key"));
  const b = new E.Store();
  const counts = E.importBackup(b, JSON.parse(file));
  assert.equal(counts.topics, 1); assert.equal(counts.questions, 1); assert.equal(counts.assignments, 1);
  assert.ok(counts.modules >= 1);
  assert.equal(new E.Assignments(b).get("live-report").module, "general");
  assert.equal(new E.Assignments(b).get("live-report").working_draft, "my draft");
  assert.equal(new E.Progress(b, "sound").totals().answered, 1);
  assert.throws(() => E.importBackup(b, {hello: 1}), /isn't a Learning Engine backup/);
});

test("import ignores unsafe topic names", () => {
  const b = new E.Store();
  E.importBackup(b, {app: "learning-engine", questions: {"../evil": [q("x")], "ok": [q("y")]}, progress: {}, assignments: {}});
  assert.deepEqual(b.keys("questions:"), ["ok"]);
});

test("streams text chunks from server-sent events", async () => {
  const sse = 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n';
  const llm = new E.LLM(settings(), {fetch: async () => ({status: 200, ok: true, headers: {get: () => null}, text: async () => sse, body: null})});
  let out = "";
  for await (const c of llm.stream([{role: "user", content: "hi"}])) out += c;
  assert.equal(out, "Hello");
});

test("generate fills the bank, one question at a time", async () => {
  const store = new E.Store();
  let n = 0;
  const llm = new E.LLM(settings(), {fetch: async () => fakeResponse(200, {choices: [{message: {content: JSON.stringify({
    question: "Generated question number " + (++n) + "?", choices: ["w", "x", "y", "z"], answer_index: 1, explanation: "Because."})}}]})});
  const res = await E.generate(store, llm, "midi", 3);
  assert.equal(res.added, 3);
  assert.equal(new E.QuestionBank(store, "midi").length, 3);
});

test("assignment export includes draft, notes and feedback", () => {
  const md = E.assignmentMarkdown({title: "T", brief_text: "B", working_draft: "D", notes: "N", drafts: [{ts: "2026-01-01T10:00:00", feedback: "F"}], lessons: {}});
  for (const part of ["# T", "## My notes", "N", "## My current draft", "D", "F"]) assert.ok(md.includes(part), part);
});

// ---- connection problems (the "stuck thinking" bug) ----
const gemini = (over = {}) => settings(Object.assign({provider: "gemini", label: "Google Gemini", model: "gemini-2.5-flash"}, over));

test("a dropped connection is retried like a busy service, then explained", async () => {
  let calls = 0;
  const waits = [];
  const llm = new E.LLM(gemini(), {fetch: async () => { calls++; throw new TypeError("Failed to fetch"); }, sleep: async (s) => waits.push(s)});
  await assert.rejects(llm.chat([{role: "user", content: "hi"}]), /overloaded or your free daily limit/);
  assert.equal(calls, 4);
  assert.deepEqual(waits, [2, 5, 10]);
});

test("recovers when a retry after a dropped connection works", async () => {
  const replies = [() => { throw new TypeError("Failed to fetch"); }, () => fakeResponse(200, {choices: [{message: {content: "OK"}}]})];
  const llm = new E.LLM(gemini(), {fetch: async () => replies.shift()(), sleep: async () => {}});
  assert.equal(await llm.chat([{role: "user", content: "hi"}]), "OK");
});

test("gives up on a request that never answers instead of hanging", async () => {
  const hang = (url, opts) => new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const llm = new E.LLM(gemini(), {fetch: hang, sleep: async () => {}, timeoutSec: 0.05});
  const t0 = Date.now();
  await assert.rejects(llm.chat([{role: "user", content: "hi"}]), /didn't answer within/);
  assert.ok(Date.now() - t0 < 2000);
});

test("Gemini's bad-key reply (HTTP 400) says so clearly", async () => {
  const body = [{error: {code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT"}}];
  const llm = new E.LLM(gemini(), {fetch: async () => fakeResponse(400, body), sleep: async () => {}});
  await assert.rejects(llm.chat([{role: "user", content: "hi"}]), /rejected your key.*API key not valid/);
});

test("quota errors show Google's own message", async () => {
  const body = {error: {message: "You exceeded your current quota"}};
  const llm = new E.LLM(gemini(), {fetch: async () => fakeResponse(429, body), sleep: async () => {}});
  await assert.rejects(llm.chat([{role: "user", content: "hi"}]), /free usage limit.*exceeded your current quota/);
});

test("Gemini thinking is turned down, and dropped if a model refuses it", async () => {
  assert.equal(E.reasoningEffort("gemini", "gemini-2.5-flash"), "none");
  assert.equal(E.reasoningEffort("gemini", "gemini-2.5-flash-lite"), "none");
  assert.equal(E.reasoningEffort("gemini", "gemini-2.5-pro"), "low");
  assert.equal(E.reasoningEffort("gemini", "gemini-2.0-flash"), null);
  assert.equal(E.reasoningEffort("groq", "gemini-2.5-flash"), null);
  const sent = [];
  const replies = [fakeResponse(400, {error: {message: "reasoning_effort is not supported for this model"}}),
    fakeResponse(200, {choices: [{message: {content: "OK"}}]})];
  const llm = new E.LLM(gemini({model: "gemini-2.5-pro"}), {fetch: async (u, o) => { sent.push(JSON.parse(o.body)); return replies.shift(); }});
  assert.equal(await llm.chat([{role: "user", content: "hi"}], {maxTokens: 100}), "OK");
  assert.equal(sent[0].reasoning_effort, "low");
  assert.equal(sent[0].max_tokens, 2148);
  assert.equal(sent[1].reasoning_effort, undefined);
});

test("errorMessage handles both error shapes and plain text", () => {
  assert.equal(E.errorMessage('[{"error":{"message":"boom"}}]'), "boom");
  assert.equal(E.errorMessage('{"error":{"message":"bang"}}'), "bang");
  assert.equal(E.errorMessage("<html><b>Bad</b> gateway</html>"), "Bad gateway");
});

test("Gemini model list drops image, audio, live and Gemma models", () => {
  const out = E.parseModels({data: ["models/gemini-2.5-flash", "models/gemini-2.5-flash-image", "models/gemini-2.5-flash-native-audio-dialog",
    "models/gemini-live-2.5-flash", "models/gemma-3-27b-it"].map((id) => ({id}))}, "gemini");
  assert.deepEqual(out.map((m) => m.id), ["gemini-2.5-flash"]);
});

test("a stream that goes quiet stops with a message", async () => {
  const body = {getReader: () => ({read: () => new Promise(() => {}), cancel: async () => {}})};
  const llm = new E.LLM(gemini(), {fetch: async () => ({status: 200, ok: true, headers: {get: () => null}, body}), idleSec: 0.05});
  await assert.rejects((async () => { for await (const c of llm.stream([{role: "user", content: "hi"}])) void c; })(), /stopped answering/);
});

// ---- no-setup AI options ----
test("new users start on Automatic, which needs no key", () => {
  const s = E.loadSettings(new E.Store());
  assert.equal(s.provider, "auto");
  assert.ok(E.isConfigured(s));
});

test("old single-service settings still load, and keys are kept per service", () => {
  const st = new E.Store();
  st.set("settings", {provider: "gemini", url: "", model: "gemini-2.5-flash", apiKey: "old-key"});
  assert.equal(E.loadSettings(st).apiKey, "old-key");
  E.saveSettings(st, {provider: "auto"});
  assert.equal(E.loadSettings(st).provider, "auto");
  assert.equal(E.loadSettings(st, "gemini").apiKey, "old-key");  // not lost by switching
});

test("free shared AI: no model or key sent, waits when asked (402 + Retry-After), whole answers", async () => {
  const sent = [], waits = [];
  const replies = [fakeResponse(402, {error: "slow down"}, {"Retry-After": "40"}),
    fakeResponse(200, {choices: [{message: {content: "Hello there"}}]})];
  const llm = E.makeLLM(E.loadSettings(new E.Store(), "pollinations"),
    {fetch: async (u, o) => { sent.push([u, o]); return replies.shift(); }, sleep: async (s) => waits.push(s)});
  let out = "";
  for await (const c of llm.stream([{role: "user", content: "hi"}])) out += c;
  assert.equal(out, "Hello there");
  assert.equal(sent[0][0], "https://text.pollinations.ai/openai");
  const body = JSON.parse(sent[0][1].body);
  assert.equal(body.model, undefined);
  assert.equal(body.stream, false);
  assert.equal(sent[0][1].headers.Authorization, undefined);
  assert.deepEqual(waits, [40]);
});

test("free shared AI explains when it stays busy", async () => {
  const llm = E.makeLLM(E.loadSettings(new E.Store(), "pollinations"), {fetch: async () => fakeResponse(402, {}), sleep: async () => {}});
  await assert.rejects(llm.chat([{role: "user", content: "hi"}]), /busy with other people/);
});

function fakeChrome(status, reply) {
  const made = [];
  return {made, LanguageModel: {
    availability: async () => status,
    create: async (o) => { made.push(o); return {prompt: async (p) => reply + ":" + p, promptStreaming: async function* () { yield reply; yield "!"; }, destroy() {}}; },
  }};
}

test("Chrome's built-in AI: system and history go in initialPrompts, last message is the prompt", async () => {
  const g = fakeChrome("available", "nano");
  assert.equal(await E.chromeAIStatus(g), "available");
  assert.equal(await E.chromeAIStatus({}), "unavailable");
  const llm = new E.ChromeLLM({}, {global: g});
  const out = await llm.chat([{role: "system", content: "S"}, {role: "assistant", content: "A"}, {role: "user", content: "Q"}]);
  assert.equal(out, "nano:Q");
  assert.deepEqual(g.made[0].initialPrompts, [{role: "system", content: "S"}, {role: "assistant", content: "A"}]);
  let streamed = "";
  for await (const c of llm.stream([{role: "user", content: "x"}])) streamed += c;
  assert.equal(streamed, "nano!");
});

test("Automatic prefers Chrome's AI when this computer has it, else the shared AI", async () => {
  const g = fakeChrome("available", "nano");
  const auto = E.makeLLM(E.loadSettings(new E.Store()), {global: g, store: new E.Store(),
    fetch: async () => { throw new Error("should not call the shared AI"); }});
  assert.ok(auto instanceof E.AutoLLM);
  assert.equal(await auto.chat([{role: "user", content: "Q"}]), "nano:Q");
  assert.equal(auto.describe(), "Chrome's built-in AI");
  const auto2 = E.makeLLM(E.loadSettings(new E.Store()), {global: fakeChrome("unavailable", "x"), store: new E.Store(),
    fetch: async () => fakeResponse(200, {choices: [{message: {content: "shared"}}]})});
  assert.equal(await auto2.chat([{role: "user", content: "Q"}]), "shared");
  assert.match(auto2.describe(), /Pollinations/);
});

test("Automatic falls back to the next option when one fails", async () => {
  const bad = {chat: async () => { throw new E.LLMError("down"); }, async *stream() { throw new E.LLMError("down"); }, describe: () => "bad"};
  const good = {chat: async () => "ok", async *stream() { yield "o"; yield "k"; }, describe: () => "good"};
  const auto = new E.AutoLLM({}, {candidates: [bad, good]});
  assert.equal(await auto.chat([{role: "user", content: "Q"}]), "ok");
  assert.equal(auto.describe(), "good");
  let s = "";
  for await (const c of new E.AutoLLM({}, {candidates: [bad, good]}).stream([{role: "user", content: "Q"}])) s += c;
  assert.equal(s, "ok");
  const allBad = new E.AutoLLM({}, {candidates: [bad]});
  await assert.rejects(allBad.chat([{role: "user", content: "Q"}]), /down/);
});

test("quizzes work end to end on Automatic with JSON questions", async () => {
  const store = new E.Store();
  const q = JSON.stringify({question: "Which message starts a MIDI note?", choices: ["Note On", "Note Off", "CC", "Clock"], answer_index: 0, explanation: "Note On starts it."});
  const llm = E.makeLLM(E.loadSettings(store), {global: {}, store, fetch: async () => fakeResponse(200, {choices: [{message: {content: q}}]})});
  const s = new E.QuizSession(store, llm, "midi", 1);
  const got = await s.next();
  assert.equal(got.choices[0], "Note On");
});

test("private AI says clearly when the computer can't run it", async () => {
  const c = new E.WebLLMClient({}, {importer: async () => { throw new Error("no"); }});
  await assert.rejects(c.chat([{role: "user", content: "hi"}]), /can't run the private AI|WebGPU/);
});

// ------------------------------------------------------------- modules ---

test("first run creates the built-in and starter modules and keeps old work", () => {
  const st = new E.Store();
  new E.Progress(st, "midi").record(q("a"), 0, 2);
  st.set("questions:old-topic", [q("z")]);
  const mods = new E.Modules(st);
  for (const k of ["midi", "sound", "live", "music-business", "creative-labs", "composition", "old-topic"]) assert.ok(mods.has(k), k);
  assert.match(mods.get("live").name, /Live sound practices/);
  assert.equal(new E.Progress(st, "midi").totals().answered, 1);
});

test("modules can be added, renamed, edited and deleted", () => {
  const st = new E.Store(), mods = new E.Modules(st);
  const m = mods.add({name: "Studio Recording", description: "Tracking bands", notes: "Week 1: mics", subtopics: "- mic choice\n- tracking\n- overdubs"});
  assert.equal(m.key, "studio-recording");
  assert.deepEqual(m.subtopics, ["mic choice", "tracking", "overdubs"]);
  assert.throws(() => mods.add({name: "studio recording"}), /already have/);
  assert.throws(() => mods.add({name: "  "}), /name/);
  mods.update(m.key, {name: "Studio recording practice", my_notes: "remember the DI"});
  assert.equal(mods.get(m.key).name, "Studio recording practice");
  assert.equal(mods.get(m.key).my_notes, "remember the DI");
  assert.equal(mods.add({name: "Assignment helper"}).key, "m-assignment-helper");
  new E.QuestionBank(st, m.key).questions = [];
  mods.remove(m.key);
  assert.ok(!mods.has(m.key));
});

test("each assignment lives in exactly one module folder", () => {
  const st = new E.Store(), mods = new E.Modules(st), asg = new E.Assignments(st);
  const comp = asg.add({title: "Film cue", brief: "Write a 1 minute cue.", module: "composition"});
  const biz = asg.add({title: "Release plan", brief: "Plan a single release.", module: "music-business"});
  const loose = asg.add({title: "Essay", brief: "Write an essay.", module: "no-such-module"});
  assert.equal(comp.module, "composition");
  assert.equal(loose.module, "general");
  assert.deepEqual(asg.list("composition").map((a) => a.id), ["film-cue"]);
  assert.deepEqual(asg.list("music-business").map((a) => a.id), ["release-plan"]);
  asg.move("film-cue", "music-business");
  assert.deepEqual(asg.list("music-business").map((a) => a.id), ["film-cue", "release-plan"]);
  assert.deepEqual(asg.list("composition"), []);
  assert.throws(() => asg.move("film-cue", "nope"), /no longer exists/);
  // Deleting a module never deletes its assignments; they move to General.
  assert.equal(mods.remove("music-business"), 2);
  assert.deepEqual(asg.list("general").map((a) => a.id).sort(), ["essay", "film-cue", "release-plan"]);
  // Even deleting General while it holds work keeps the work.
  mods.remove("general");
  assert.ok(mods.has("general"));
  assert.equal(asg.list("general").length, 3);
});

test("assignments saved before modules existed go into General", () => {
  const st = new E.Store();
  st.set("assignments", {old: {id: "old", title: "Old one", brief_text: "brief"}});
  const a = new E.Assignments(st).get("old");
  assert.equal(a.module, "general");
  assert.ok(new E.Modules(st).has("general"));
});

test("a module's notes guide its questions", () => {
  const st = new E.Store();
  const m = new E.Modules(st).add({name: "Live sound lab", description: "Gigs", notes: "We use a Yamaha CL5 desk.", subtopics: ["desk"]});
  const info = E.topicInfo(st, m.key);
  assert.equal(info.contextKind, "notes");
  assert.match(info.context, /CL5/);
  const msg = E.prompts.question(info.name, "desk", 2, [], info.context, info.contextKind)[1].content;
  assert.match(msg, /notes about the student's course/);
  assert.match(msg, /CL5/);
  assert.ok(E.allTopicKeys(st).includes(m.key));
});

test("suggested subtopics are cleaned and checked", () => {
  assert.deepEqual(E.validateSubtopics({subtopics: ["1. Melody", "Harmony", "Harmony", "- Form"]}), ["Melody", "Harmony", "Form"]);
  assert.throws(() => E.validateSubtopics({subtopics: ["one", "two"]}));
  assert.throws(() => E.validateSubtopics({nope: 1}));
});

test("modules and their folders survive a backup", () => {
  const a = new E.Store();
  const m = new E.Modules(a).add({name: "Sync licensing", notes: "brief notes", subtopics: ["fees"]});
  new E.Assignments(a).add({title: "Pitch", brief: "Pitch a track.", module: m.key});
  const b = new E.Store();
  E.importBackup(b, JSON.parse(JSON.stringify(E.exportBackup(a))));
  assert.equal(new E.Modules(b).get(m.key).notes, "brief notes");
  assert.equal(new E.Assignments(b).get("pitch").module, m.key);
  // A backup from the terminal version names folders the browser hasn't seen yet.
  const c = new E.Store();
  E.importBackup(c, {app: "learning-engine", questions: {}, progress: {},
    assignments: {gig: {id: "gig", title: "Gig review", brief_text: "Review a gig.", module: "live-events"}}});
  assert.ok(new E.Modules(c).has("live-events"));
  assert.equal(new E.Assignments(c).get("gig").module, "live-events");
});

test("folder download has one folder per module with only its own assignments", () => {
  const st = new E.Store(), asg = new E.Assignments(st);
  asg.add({title: "Film cue", brief: "Write a cue.", module: "composition"});
  asg.add({title: "Release plan", brief: "Plan it.", module: "music-business"});
  const files = E.moduleFiles(st);
  const paths = files.map((f) => f.path);
  assert.ok(paths.includes("Music composition/Assignments/Film cue.txt"));
  assert.ok(paths.includes("Music business and marketing/Assignments/Release plan.txt"));
  assert.ok(!paths.some((p) => p.startsWith("Music composition/") && p.includes("Release plan")));
  assert.deepEqual(E.moduleFiles(st, "composition").map((f) => f.path), ["Music composition/About this module.txt", "Music composition/Assignments/Film cue.txt"]);
  const zip = E.makeZip(files);
  assert.deepEqual(Array.from(zip.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  const end = zip.length - 22;
  assert.deepEqual(Array.from(zip.slice(end, end + 4)), [0x50, 0x4b, 0x05, 0x06]);
  assert.equal(zip[end + 10] | (zip[end + 11] << 8), files.length);
  assert.equal(E.safeName('a/b:c?'), "a-b-c-");
});
