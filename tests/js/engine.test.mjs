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
  assert.deepEqual(counts, {topics: 1, questions: 1, assignments: 1});
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
