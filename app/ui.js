// Draws the page and wires up the buttons. All the logic lives in engine.js.
import * as E from "./engine.js";

const $ = (id) => document.getElementById(id);
const LETTERS = "ABCD";
const store = new E.Store(window.localStorage);
let SETTINGS = E.loadSettings(store), QUIZ = null, ASSIGN = null, LESSON = null, MODELS = null, MOD = null;
const assignments = new E.Assignments(store), modules = new E.Modules(store);
// Shows "busy, trying again" while the AI client retries, so nothing looks frozen.
function onRetry(n, total, wait) {
  const b = $("busy-note");
  if (!n) { b.classList.add("hidden"); return; }
  b.textContent = "The AI is busy or asked us to wait. Trying again" + (wait ? " in " + Math.round(wait) + " seconds" : "") +
    " (" + n + " of " + total + ")...";
  b.classList.remove("hidden");
}
function onProgress(text, frac) {
  const b = $("busy-note");
  if (frac != null && frac >= 1) { b.classList.add("hidden"); return; }
  b.textContent = text + (frac != null ? " " + Math.round(frac * 100) + "%" : "");
  b.classList.remove("hidden");
}
// One AI client for the whole page, so Automatic remembers which option worked.
let LLM_CACHE = null, LLM_FOR = "";
function llm() {
  const sig = JSON.stringify(SETTINGS);
  if (!LLM_CACHE || LLM_FOR !== sig) { LLM_CACHE = E.makeLLM(SETTINGS, {onRetry, onProgress, store}); LLM_FOR = sig; }
  return LLM_CACHE;
}

// ---------------------------------------------------------------- helpers ---
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}
// Tiny, safe Markdown: escapes everything first, then adds headings, bold, italics, code and lists.
function md(text) {
  const lines = esc(text).split("\n");
  let html = "", list = null;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, "$1<i>$2</i>");
  const close = () => { if (list) { html += "</" + list + ">"; list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^\s*#{1,6}\s+(.*)/))) { close(); html += "<h3>" + inline(m[1]) + "</h3>"; }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== "ul") { close(); html += "<ul>"; list = "ul"; } html += "<li>" + inline(m[1]) + "</li>"; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); html += "<ol>"; list = "ol"; } html += "<li>" + inline(m[1]) + "</li>"; }
    else if (!line.trim()) close();
    else { close(); html += "<p>" + inline(line) + "</p>"; }
  }
  close();
  return html;
}
function note(el, kind, text) { el.innerHTML = '<div class="note ' + kind + '">' + esc(text) + "</div>"; }
function thinking(el) { el.innerHTML = '<p class="thinking"></p>'; }
function busy(btn, on) { if (btn) btn.disabled = on; }
function safe(fn) {
  return async (...a) => {
    try { return await fn(...a); } catch (e) { console.error(e); showBanner("bad", e.message); }
  };
}
function showBanner(kind, text, actionLabel, action) {
  const b = $("banner");
  b.innerHTML = '<div class="note ' + kind + '">' + esc(text) +
    (actionLabel ? ' <button class="btn secondary" id="banner-act">' + esc(actionLabel) + "</button>" : "") + "</div>";
  if (actionLabel) $("banner-act").onclick = () => { b.innerHTML = ""; action(); };
}
function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], {type: type || "text/plain"}));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function needAI() {
  if (E.isConfigured(SETTINGS)) return false;
  showTab("settings");
  note($("set-msg"), "warn", "First add your free AI key here, then try again.");
  return true;
}

// Streams AI text into `el` as it's written. Returns the full text, or null on error.
async function streamTo(makeIter, el, append) {
  const box = document.createElement("div");
  box.className = "thinking";
  if (!append) el.innerHTML = "";
  el.appendChild(box);
  let text = "";
  try {
    for await (const chunk of makeIter()) {
      text += chunk;
      box.className = "out";
      box.innerHTML = md(text);
    }
    box.className = "out";
    box.innerHTML = md(text);
    return text;
  } catch (e) {
    box.className = "";
    note(box, "bad", text ? "Stopped part way: " + e.message : e.message);
    return null;
  }
}

// ------------------------------------------------------------------- tabs ---
function showTab(name) {
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll("main > section").forEach((s) => s.classList.toggle("hidden", s.id !== "tab-" + name));
  if (name === "quiz") { loadToday(); loadTopics(); }
  if (name === "review") loadReview();
  if (name === "generate") loadTopics();
  if (name === "assign") loadModules();
  if (name === "settings") fillSettings();
}
$("nav").addEventListener("click", (e) => { if (e.target.dataset.tab) showTab(e.target.dataset.tab); });

function showStatus() {
  $("ai").textContent = !E.isConfigured(SETTINGS) ? "AI: not set up yet" : SETTINGS.keyless ? "AI: " + SETTINGS.label
    : "AI: " + (SETTINGS.provider === "local" ? "local model" : SETTINGS.model);
}

// --------------------------------------------------------- today & topics ---
function loadToday() {
  const s = E.stats(store);
  $("st-streak").textContent = s.streak;
  $("st-today").textContent = s.answeredToday;
  $("st-due").textContent = s.dueTotal;
  $("st-due-list").innerHTML = s.due.length
    ? '<p class="muted">Spaced review brings back questions just before you\'d forget them. Questions you miss come back today; ones you get right come back after 1, 3, 7, 14 then 30 days.</p>' +
      s.due.map((r) => '<div class="list-item"><div>' + esc(r.name) + ' <span class="pill">' + r.due + ' due</span></div><button class="btn secondary" data-review="' + esc(r.key) + '">Review now</button></div>').join("")
    : '<p class="muted">' + (s.studiedToday ? "Nothing due for review. Nice work today." : "Nothing due for review. Take a quiz to keep your streak going.") + "</p>";
}
$("st-due-list").addEventListener("click", (e) => { if (e.target.dataset.review) startQuiz(e.target.dataset.review, "review"); });

function topicRows() {
  return E.allTopicKeys(store).map((key) => {
    const info = E.topicInfo(store, key);
    return Object.assign({key, name: info.name, questions: new E.QuestionBank(store, key).length}, new E.Progress(store, key).totals());
  });
}
function loadTopics() {
  const rows = topicRows();
  const opts = (list) => list.map((t) => '<option value="' + esc(t.key) + '">' + esc(t.name) + "</option>").join("");
  const mods = rows.filter((t) => !t.key.startsWith(E.ASSIGNMENT_PREFIX)), asg = rows.filter((t) => t.key.startsWith(E.ASSIGNMENT_PREFIX));
  for (const sel of [$("quiz-topic"), $("gen-topic")]) {
    const keep = sel.value;
    sel.innerHTML = '<optgroup label="Modules">' + opts(mods) + "</optgroup>" + (asg.length ? '<optgroup label="Assignments">' + opts(asg) + "</optgroup>" : "");
    if (keep && rows.some((t) => t.key === keep)) sel.value = keep;
  }
  $("topics-table").innerHTML = "<table><tr><th>Topic</th><th>Questions</th><th>Level</th><th>Answered</th><th>Accuracy</th></tr>" +
    rows.map((t) => "<tr><td>" + esc(t.name) + "</td><td>" + t.questions + "</td><td>" + t.difficulty + "/5</td><td>" +
      t.answered + "</td><td>" + (t.answered ? Math.round(t.accuracy * 100) + "%" : "-") + "</td></tr>").join("") + "</table>";
}

// ------------------------------------------------------------------- quiz ---
async function startQuiz(topic, mode) {
  showTab("quiz");
  const msg = $("quiz-setup-msg");
  if (mode !== "review" && needAI()) return;
  const key = topic || $("quiz-topic").value;
  msg.innerHTML = "";
  try {
    if (key.startsWith(E.ASSIGNMENT_PREFIX)) {
      thinking(msg);
      await E.concepts(llm(), assignments, assignments.get(key.slice(E.ASSIGNMENT_PREFIX.length)));
      msg.innerHTML = "";
    }
    const s = new E.QuizSession(store, llm(), key, Math.max(1, Math.min(50, +$("quiz-n").value || 10)), mode);
    if (mode === "review" && !s.length) { note(msg, "good", "Nothing due for review in that topic."); return; }
    QUIZ = {s};
    if (!s.bank.length) note(msg, "warn", "No saved questions yet, so they'll be made as you go.");
    $("quiz-title").textContent = (mode === "review" ? "Review: " : "") + s.info.name;
    $("quiz-box").classList.remove("hidden");
    $("quiz-setup").classList.add("hidden");
    $("today-card").classList.add("hidden");
    nextQuestion();
  } catch (e) { note(msg, "bad", e.message); }
}
async function nextQuestion() {
  const body = $("quiz-body"), s = QUIZ.s;
  thinking(body);
  try {
    const q = await s.next();
    if (!q) return showSummary(s.summary());
    QUIZ.chosen = null;
    $("quiz-meta").textContent = "Question " + (s.results.length + 1) + "/" + s.length + (s.mode === "review" ? " · review" : " · level " + s.difficulty + "/5");
    body.innerHTML = '<p class="muted">' + esc(q.subtopic || "") + "</p><h3>" + esc(q.question) + "</h3>" +
      q.choices.map((c, i) => '<button class="choice" data-i="' + i + '"><b>' + LETTERS[i] + "</b>" + esc(c) + "</button>").join("") +
      '<div id="conf" class="hidden"><label>How sure were you?</label><div class="btns">' +
      '<button class="btn secondary" data-c="1">Guessing</button><button class="btn secondary" data-c="2">Fairly sure</button>' +
      '<button class="btn secondary" data-c="3">Certain</button></div></div><div id="quiz-result"></div>';
  } catch (e) {
    body.innerHTML = "";
    note(body, "bad", e.message);
    body.insertAdjacentHTML("beforeend", '<div class="btns"><button class="btn" id="quiz-retry">Try again</button></div>');
  }
}
$("quiz-body").addEventListener("click", async (e) => {
  const choice = e.target.closest(".choice"), conf = e.target.closest("[data-c]");
  if (!QUIZ) return;
  if (choice && QUIZ.chosen === null) {
    QUIZ.chosen = +choice.dataset.i;
    document.querySelectorAll(".choice").forEach((b) => { b.disabled = true; b.style.opacity = b === choice ? 1 : 0.6; });
    $("conf").classList.remove("hidden");
  } else if (conf && !conf.disabled) {
    document.querySelectorAll("[data-c]").forEach((b) => (b.disabled = true));
    try { showAnswer(QUIZ.s.answer(QUIZ.chosen, +conf.dataset.c)); } catch (err) { note($("quiz-result"), "bad", err.message); }
  } else if (e.target.id === "quiz-next") {
    if (QUIZ.s.finished) showSummary(QUIZ.s.summary()); else nextQuestion();
  } else if (e.target.id === "quiz-retry") nextQuestion();
});
async function showAnswer(r) {
  document.querySelectorAll(".choice").forEach((b, i) => {
    b.style.opacity = 1;
    if (i === r.answer_index) b.classList.add("right");
    else if (i === r.chosen) b.classList.add("wrong");
  });
  $("conf").classList.add("hidden");
  const out = $("quiz-result");
  let html = '<div class="note ' + (r.correct ? "good" : "bad") + '">' + (r.correct ? "Correct! " : "Not quite. ") + esc(r.explanation) + "</div>";
  if (r.change === "up") html += '<div class="note good">Three in a row. Moving up to level ' + r.difficulty + ".</div>";
  if (r.change === "down") html += '<div class="note warn">Dropping to level ' + r.difficulty + " so we can rebuild the basics.</div>";
  html += '<div id="reexplain"></div>';
  out.innerHTML = html;
  if (r.reexplain && E.isConfigured(SETTINGS)) {
    const box = $("reexplain");
    box.innerHTML = "<h3>Let's go over this again</h3>";
    await streamTo(() => QUIZ.s.reexplain(), box, true);
  }
  out.insertAdjacentHTML("beforeend", '<div class="btns"><button class="btn" id="quiz-next">' + (QUIZ.s.finished ? "See results" : "Next question") + "</button></div>");
  $("quiz-next").focus();
}
function showSummary(s) {
  $("quiz-meta").textContent = "Finished";
  $("quiz-body").innerHTML = "<h3>You got " + s.correct + "/" + s.answered + " right</h3>" +
    (s.mode === "review" ? "<p>Review done. Missed ones will come back again soon.</p>" : "<p>Level " + s.start_difficulty + " → " + s.end_difficulty + "</p>") +
    (s.weak_spots.length ? "<p>Weakest right now: " + s.weak_spots.map((w) => esc(w.subtopic)).join(", ") + "</p>" : "") +
    '<div class="btns"><button class="btn" id="quiz-again">Done</button></div>';
  $("quiz-again").onclick = resetQuiz;
  QUIZ = null;
}
function resetQuiz() {
  QUIZ = null;
  $("quiz-box").classList.add("hidden");
  $("quiz-setup").classList.remove("hidden");
  $("today-card").classList.remove("hidden");
  $("quiz-setup-msg").innerHTML = "";
  loadToday(); loadTopics(); maybeRemindBackup();
}
$("quiz-start").onclick = () => startQuiz();
$("quiz-stop").onclick = () => { if (QUIZ && QUIZ.s.results.length) return showSummary(QUIZ.s.summary()); resetQuiz(); };

// --------------------------------------------------------------- generate ---
async function runGenerate(key, n, level, onMsg) {
  return E.generate(store, llm(), key, n, {level, onProgress: onMsg});
}
$("gen-go").onclick = async () => {
  if (needAI()) return;
  const btn = $("gen-go"), n = Math.max(1, Math.min(20, +$("gen-n").value || 10));
  busy(btn, true);
  $("gen-result").innerHTML = "";
  $("gen-status").classList.remove("hidden");
  $("gen-bar").max = n; $("gen-bar").value = 0;
  $("gen-msg").textContent = "Starting...";
  try {
    const x = await runGenerate($("gen-topic").value, n, $("gen-level").value || null, (done, total, msg) => {
      $("gen-bar").value = done;
      $("gen-msg").textContent = done < total ? "Question " + (done + 1) + "/" + total + ": " + msg : "Done";
    });
    note($("gen-result"), "good", "Added " + x.added + " new questions (" + x.total + " in the bank)." +
      (x.duplicates ? " " + x.duplicates + " repeats skipped." : "") + (x.failed ? " " + x.failed + " couldn't be made." : ""));
  } catch (e) { note($("gen-result"), "bad", e.message); }
  $("gen-status").classList.add("hidden");
  busy(btn, false);
  loadTopics();
};

// ----------------------------------------------------------------- review ---
function loadReview() {
  const el = $("review-body");
  const reports = E.progressKeys(store).map((k) => E.report(store, k)).filter((r) => r.subtopics.length);
  if (!reports.length) { el.innerHTML = '<div class="card"><h2>Weak spots</h2><p>No quiz history yet. Take a quiz first.</p></div>'; return; }
  el.innerHTML = reports.map((r, i) => {
    const rows = r.subtopics.map((s) => {
      const pct = Math.round(s.mastery * 100), col = s.mastery < 0.45 ? "var(--bad)" : s.mastery < 0.6 ? "var(--warn)" : "var(--good)";
      return "<tr><td>" + esc(s.subtopic) + '</td><td><div class="bar"><span style="width:' + pct + "%;background:" + col + '"></span></div></td><td>' + pct + "%</td><td>" + s.correct + "/" + s.seen + "</td></tr>";
    }).join("");
    const misses = r.misses.slice(0, 5).map((m) => "<li>" + esc(m.question) + ' <span class="muted">(answer: ' + esc(m.answer) + ")</span></li>").join("");
    return '<div class="card"><h2>' + esc(r.name) + '</h2><p class="muted">' + r.totals.answered + " answered · " + Math.round(r.totals.accuracy * 100) +
      "% correct · level " + r.totals.difficulty + "/5</p><table><tr><th>Subtopic</th><th>Confidence</th><th></th><th>Right/seen</th></tr>" + rows + "</table>" +
      (misses ? "<h3>Recently missed</h3><ul>" + misses + "</ul>" : "") +
      (r.weak.length ? '<div class="btns"><button class="btn" data-plan="' + i + '">Make me a study plan</button></div><div></div>'
        : '<div class="note good">No weak spots right now. Nice work.</div>') + "</div>";
  }).join("");
  el.querySelectorAll("[data-plan]").forEach((b) => {
    b.onclick = async () => {
      if (needAI()) return;
      busy(b, true);
      await streamTo(() => E.studyPlan(llm(), reports[+b.dataset.plan]), b.parentNode.nextElementSibling);
      busy(b, false);
    };
  });
}

// ---------------------------------------------------------------- modules ---
// Each module is a folder: its own questions, progress, notes and assignments.
function loadModules() {
  flushModNotes();
  MOD = null;
  $("assign-detail").classList.add("hidden");
  $("mod-view").classList.add("hidden");
  $("mod-list-view").classList.remove("hidden");
  const today = E.todayStr();
  $("mod-list").innerHTML = modules.list().map((m) => {
    const n = assignments.list(m.key).length, bank = new E.QuestionBank(store, m.key).length, p = new E.Progress(store, m.key);
    const due = p.dueIds(today).length, t = p.totals();
    const bits = [n + (n === 1 ? " assignment" : " assignments"), bank + " questions"];
    if (t.answered) bits.push(Math.round(t.accuracy * 100) + "% correct");
    if (due) bits.push(due + " due");
    return '<button class="folder" data-mod="' + esc(m.key) + '"><b>' + esc(m.name) + '</b><span class="muted">' + esc(bits.join(" · ")) + "</span>" +
      (m.description ? '<span class="muted">' + esc(m.description) + "</span>" : "") + "</button>";
  }).join("") || '<p class="muted">No modules yet. Add one for each class subject.</p>';
}
$("mod-list").addEventListener("click", (e) => { const f = e.target.closest("[data-mod]"); if (f) openModule(f.dataset.mod); });
$("mod-new").onclick = () => { $("mod-form").classList.remove("hidden"); $("mf-msg").innerHTML = ""; $("mf-name").focus(); };
$("mf-cancel").onclick = () => $("mod-form").classList.add("hidden");
$("mf-save").onclick = async () => {
  const btn = $("mf-save"), msg = $("mf-msg");
  let m;
  try {
    m = modules.add({name: $("mf-name").value, description: $("mf-desc").value, notes: $("mf-notes").value, subtopics: $("mf-subs").value});
  } catch (e) { note(msg, "bad", e.message); return; }
  if (!m.subtopics.length) {
    busy(btn, true);
    msg.innerHTML = '<p class="thinking">Asking the AI to suggest subtopics</p>';
    let subs = null;
    try { if (E.isConfigured(SETTINGS)) subs = await E.suggestSubtopics(llm(), m); } catch (e) { console.warn(e); }
    onRetry(0);
    modules.update(m.key, {subtopics: subs || ["key ideas of " + m.name, "terms and definitions", "practical skills"]});
    busy(btn, false);
  }
  ["mf-name", "mf-desc", "mf-notes", "mf-subs"].forEach((id) => ($(id).value = ""));
  msg.innerHTML = "";
  $("mod-form").classList.add("hidden");
  loadTopics();
  openModule(m.key);
};

function openModule(key) {
  flushModNotes();
  const m = modules.get(key);
  MOD = key;
  $("mod-list-view").classList.add("hidden");
  $("assign-detail").classList.add("hidden");
  $("mod-view").classList.remove("hidden");
  $("me-form").classList.add("hidden");
  $("assign-form").classList.add("hidden");
  $("mv-msg").innerHTML = "";
  $("mv-title").textContent = m.name;
  $("mv-desc").textContent = m.description || "";
  const p = new E.Progress(store, key), t = p.totals(), due = p.dueIds().length;
  $("mv-stats").textContent = new E.QuestionBank(store, key).length + " questions saved · level " + t.difficulty + "/5" +
    (t.answered ? " · " + Math.round(t.accuracy * 100) + "% correct" : "") + (due ? " · " + due + " due for review" : "") +
    " · subtopics: " + (m.subtopics || []).join(", ");
  $("mv-review").classList.toggle("hidden", !due);
  $("mv-notes").value = m.my_notes || "";
  $("mv-notes-saved").textContent = m.my_notes ? "saved" : "";
  $("af-mod").textContent = m.name;
  const list = assignments.list(key);
  $("assign-list").innerHTML = list.length ? list.map((a) =>
    '<div class="list-item"><div><b>' + esc(a.title) + '</b><div class="muted">' + esc([a.course, a.due ? "due " + a.due : ""].filter(Boolean).join(" · ")) +
    '</div></div><button class="btn secondary" data-open="' + esc(a.id) + '">Open</button></div>').join("")
    : '<p class="muted">No assignments in this module yet. Add one and paste in the brief.</p>';
}
$("mv-back").onclick = () => loadModules();
$("mv-quiz").onclick = () => startQuiz(MOD);
$("mv-review").onclick = () => startQuiz(MOD, "review");
$("mv-gen").onclick = () => { const k = MOD; showTab("generate"); $("gen-topic").value = k; };
$("mv-zip").onclick = safe(() => {
  flushModNotes();
  const m = modules.get(MOD);
  download(E.safeName(m.name) + ".zip", E.makeZip(E.moduleFiles(store, MOD)), "application/zip");
});
$("mv-edit").onclick = () => {
  const m = modules.get(MOD);
  $("me-name").value = m.name; $("me-desc").value = m.description || ""; $("me-notes").value = m.notes || "";
  $("me-subs").value = (m.subtopics || []).join("\n");
  $("me-msg").innerHTML = "";
  $("me-form").classList.remove("hidden");
  $("me-name").focus();
};
$("me-cancel").onclick = () => $("me-form").classList.add("hidden");
$("me-save").onclick = () => {
  try {
    const subs = E.cleanSubtopics($("me-subs").value);
    if (!subs.length) throw new Error("Add at least one subtopic, one per line.");
    modules.update(MOD, {name: $("me-name").value, description: $("me-desc").value, notes: $("me-notes").value, subtopics: subs});
    loadTopics();
    openModule(MOD);
    note($("mv-msg"), "good", "Module saved.");
  } catch (e) { note($("me-msg"), "bad", e.message); }
};
$("me-suggest").onclick = async () => {
  if (needAI()) return;
  const btn = $("me-suggest");
  busy(btn, true);
  thinking($("me-msg"));
  try {
    const subs = await E.suggestSubtopics(llm(), {name: $("me-name").value || modules.get(MOD).name, description: $("me-desc").value, notes: $("me-notes").value});
    $("me-subs").value = subs.join("\n");
    note($("me-msg"), "good", "Here are some suggestions. Change them if you like, then click Save changes.");
  } catch (e) { note($("me-msg"), "bad", e.message); }
  onRetry(0);
  busy(btn, false);
};
$("me-delete").onclick = () => {
  const m = modules.get(MOD), n = assignments.list(MOD).length;
  if (!confirm('Delete the module "' + m.name + '" and its questions and progress from this browser?' +
    (n ? " Its " + n + " assignment" + (n === 1 ? "" : "s") + " will be kept in the General folder." : ""))) return;
  modules.remove(MOD);
  MOD = null;
  loadTopics();
  loadModules();
};
// "My notes" for a module, autosaved like assignment notes.
const flushModNotes = (() => {
  let timer = null, key = null;
  const flush = () => {
    if (timer === null) return;
    clearTimeout(timer); timer = null;
    try {
      if (key && modules.has(key)) modules.update(key, {my_notes: $("mv-notes").value});
      $("mv-notes-saved").textContent = "saved " + new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
    } catch (e) { $("mv-notes-saved").textContent = e.message; }
  };
  $("mv-notes").addEventListener("input", () => {
    key = MOD;
    $("mv-notes-saved").textContent = "saving...";
    clearTimeout(timer);
    timer = setTimeout(flush, 700);
  });
  $("mv-notes").addEventListener("blur", flush);
  window.addEventListener("pagehide", flush);
  return flush;
})();

// ------------------------------------------------------------ assignments ---
$("assign-list").addEventListener("click", (e) => { if (e.target.dataset.open) openAssignment(e.target.dataset.open); });
$("assign-new").onclick = () => { $("assign-form").classList.remove("hidden"); $("af-msg").innerHTML = ""; $("af-title").focus(); };
$("af-cancel").onclick = () => $("assign-form").classList.add("hidden");
$("af-save").onclick = () => {
  try {
    const a = assignments.add({title: $("af-title").value, course: $("af-course").value, due: $("af-due").value,
      brief: $("af-brief").value, rubric: $("af-rubric").value, module: MOD});
    ["af-title", "af-course", "af-due", "af-brief", "af-rubric"].forEach((id) => ($(id).value = ""));
    $("assign-form").classList.add("hidden");
    $("af-msg").innerHTML = "";
    openAssignment(a.id);
  } catch (e) { note($("af-msg"), "bad", e.message); }
};
function reloadAssign() { ASSIGN = assignments.get(ASSIGN.id); return ASSIGN; }
function saveAssign(change) {
  const a = reloadAssign();  // re-read so two tabs don't overwrite each other's changes
  change(a);
  assignments.save(a);
  ASSIGN = a;
}
function openAssignment(id) {
  flushModNotes();
  ASSIGN = assignments.get(id); LESSON = null;
  MOD = ASSIGN.module;
  $("mod-list-view").classList.add("hidden");
  $("mod-view").classList.add("hidden");
  $("assign-detail").classList.remove("hidden");
  $("ad-back").textContent = "← Back to " + modules.get(MOD).name;
  $("ad-move").innerHTML = modules.list().map((m) => '<option value="' + esc(m.key) + '">' + esc(m.name) + "</option>").join("");
  $("ad-move").value = MOD;
  $("ad-move-msg").innerHTML = "";
  $("ad-title").textContent = ASSIGN.title;
  $("ad-meta").textContent = [ASSIGN.course, ASSIGN.due ? "due " + ASSIGN.due : ""].filter(Boolean).join(" · ");
  $("ad-brief-text").innerHTML = "<h3>Brief</h3>" + md(ASSIGN.brief_text) + (ASSIGN.rubric_text ? "<h3>Rubric</h3>" + md(ASSIGN.rubric_text) : "");
  $("aw-out").innerHTML = ""; $("aq-msg").innerHTML = ""; $("ad-lesson").classList.add("hidden");
  $("aw-draft").value = ASSIGN.working_draft || "";
  $("aw-notes").value = ASSIGN.notes || "";
  $("aw-draft-saved").textContent = ASSIGN.working_draft ? "saved" : "";
  $("aw-notes-saved").textContent = ASSIGN.notes ? "saved" : "";
  renderSaved();
  showSub("learn");
  loadConcepts(false);
}
function renderSaved() {
  const bits = [];
  if (ASSIGN.outline) bits.push('<details><summary>Your plan</summary><div class="out">' + md(ASSIGN.outline) + "</div></details>");
  (ASSIGN.hints || []).slice().reverse().forEach((h) => bits.push("<details><summary>Hints: " + esc(h.stuck.slice(0, 60)) +
    '</summary><div class="out">' + md(h.text) + "</div></details>"));
  (ASSIGN.drafts || []).slice().reverse().forEach((d) => bits.push("<details><summary>Feedback from " + esc(String(d.ts).replace("T", " ")) +
    '</summary><div class="out">' + md(d.feedback) + "</div></details>"));
  $("aw-saved").innerHTML = bits.join("") || "Nothing saved yet.";
}
// Autosave: saves a moment after you stop typing, and when you leave the page.
function autosave(textareaId, field, labelId) {
  let timer = null;
  const flush = () => {
    if (timer === null || !ASSIGN) return;
    clearTimeout(timer); timer = null;
    try {
      const v = $(textareaId).value;
      saveAssign((a) => { a[field] = v; });
      $(labelId).textContent = "saved " + new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
    } catch (e) { $(labelId).textContent = e.message; }
  };
  $(textareaId).addEventListener("input", () => {
    $(labelId).textContent = "saving...";
    clearTimeout(timer);
    timer = setTimeout(flush, 700);
  });
  $(textareaId).addEventListener("blur", flush);
  window.addEventListener("pagehide", flush);
  return flush;
}
const flushDraft = autosave("aw-draft", "working_draft", "aw-draft-saved");
const flushNotes = autosave("aw-notes", "notes", "aw-notes-saved");

async function loadConcepts(refresh) {
  const el = $("ad-concepts");
  if (!E.isConfigured(SETTINGS) && !(ASSIGN.concepts || []).length) {
    el.innerHTML = '<p class="muted">Add your AI key in Settings and the key concepts will appear here.</p>';
    return;
  }
  thinking(el);
  try {
    const cs = await E.concepts(llm(), assignments, reloadAssign(), refresh);
    const lessons = ASSIGN.lessons || {};
    el.innerHTML = cs.map((c, i) => '<div class="list-item"><div><b>' + esc(c.name) + '</b><div class="muted">' + esc(c.why) +
      '</div></div><button class="btn secondary" data-learn="' + i + '">' + (lessons[c.name] ? "Open my lesson" : "Teach me") + "</button></div>").join("") +
      '<div class="btns"><button class="btn secondary" id="ad-reconcepts">Re-analyse the brief</button></div>';
    $("ad-reconcepts").onclick = () => { if (!needAI()) loadConcepts(true); };
  } catch (e) { note(el, "bad", e.message); }
}
function renderLesson(name, msgs) {
  const out = $("ad-lesson-out");
  out.innerHTML = "<h3>" + esc(name) + "</h3>" + msgs.map((m) => m.role === "user" ? '<div class="me">' + esc(m.content) + "</div>" : '<div class="out">' + md(m.content) + "</div>").join("");
}
$("ad-concepts").addEventListener("click", async (e) => {
  const i = e.target.dataset.learn;
  if (i === undefined) return;
  const c = ASSIGN.concepts[+i], saved = (ASSIGN.lessons || {})[c.name];
  LESSON = {concept: +i, name: c.name};
  $("ad-lesson").classList.remove("hidden");
  if (saved && saved.length && !e.target.dataset.fresh) {
    renderLesson(c.name, saved);
    $("ad-lesson-out").insertAdjacentHTML("beforeend", '<div class="btns"><button class="btn secondary" data-learn="' + i + '" data-fresh="1" id="ad-fresh">Teach me again from scratch</button></div>');
    $("ad-fresh").onclick = (ev) => { ev.stopPropagation(); teach(+i); };
    return;
  }
  teach(+i);
});
async function teach(i) {
  if (needAI()) return;
  const c = ASSIGN.concepts[i], out = $("ad-lesson-out");
  LESSON = {concept: i, name: c.name};
  out.innerHTML = "<h3>" + esc(c.name) + "</h3>";
  const text = await streamTo(() => llm().stream(E.prompts.learn(ASSIGN, c), {temperature: 0.6, maxTokens: 600}), out, true);
  if (text) saveAssign((a) => { a.lessons = a.lessons || {}; a.lessons[c.name] = [{role: "assistant", content: text}]; });
}
async function askFollowup() {
  const q = $("ad-follow").value.trim();
  if (!q || !LESSON || needAI()) return;
  $("ad-follow").value = "";
  const out = $("ad-lesson-out"), c = ASSIGN.concepts[LESSON.concept];
  const history = ((ASSIGN.lessons || {})[c.name] || []).slice();
  out.insertAdjacentHTML("beforeend", '<div class="me">' + esc(q) + "</div>");
  busy($("ad-follow-go"), true);
  const text = await streamTo(() => llm().stream(E.prompts.followup(ASSIGN, c, history, q), {temperature: 0.6, maxTokens: 450}), out, true);
  if (text) saveAssign((a) => { a.lessons = a.lessons || {}; a.lessons[c.name] = history.concat([{role: "user", content: q}, {role: "assistant", content: text}]); });
  busy($("ad-follow-go"), false);
}
$("ad-follow-go").onclick = askFollowup;
$("ad-follow").addEventListener("keydown", (e) => { if (e.key === "Enter") askFollowup(); });

async function coach(btn, messages, maxTokens, after) {
  if (needAI()) return;
  busy(btn, true);
  const text = await streamTo(() => llm().stream(messages, {temperature: 0.5, maxTokens}), $("aw-out"));
  busy(btn, false);
  if (text && after) { after(text); renderSaved(); }
}
$("aw-plan").onclick = (e) => coach(e.target, E.prompts.outline(ASSIGN), 700, (t) => saveAssign((a) => { a.outline = t; }));
$("aw-hint").onclick = (e) => {
  const stuck = $("aw-stuck").value.trim();
  if (stuck) coach(e.target, E.prompts.hint(ASSIGN, stuck), 400, (t) => saveAssign((a) => { (a.hints = a.hints || []).push({stuck, text: t, ts: E.nowIso()}); }));
};
$("aw-feedback").onclick = (e) => {
  flushDraft();
  const draft = $("aw-draft").value;
  if (!draft.trim()) { note($("aw-out"), "warn", "Write or paste your draft in the box first."); return; }
  coach(e.target, E.prompts.feedback(ASSIGN, draft), 800, (t) => saveAssign((a) => { (a.drafts = a.drafts || []).push({text: draft, feedback: t, ts: E.nowIso()}); }));
};
$("ad-export").onclick = () => {
  flushDraft(); flushNotes();
  download(E.safeName(reloadAssign().title) + ".txt", E.assignmentMarkdown(ASSIGN));
};
$("aq-go").onclick = () => startQuiz(E.ASSIGNMENT_PREFIX + ASSIGN.id);
$("aq-gen").onclick = async () => {
  if (needAI()) return;
  const btn = $("aq-gen");
  busy(btn, true);
  thinking($("aq-msg"));
  try {
    await E.concepts(llm(), assignments, reloadAssign());
    const x = await runGenerate(E.ASSIGNMENT_PREFIX + ASSIGN.id, 5, null, (d, t) => { $("aq-msg").innerHTML = '<p class="muted">Making question ' + Math.min(d + 1, t) + " of " + t + "...</p>"; });
    note($("aq-msg"), "good", "Added " + x.added + " questions (" + x.total + " in this assignment's bank).");
  } catch (e) { note($("aq-msg"), "bad", e.message); }
  busy(btn, false);
};
$("ad-back").onclick = () => { flushDraft(); flushNotes(); const k = reloadAssign().module; ASSIGN = null; openModule(k); };
$("ad-move-go").onclick = () => {
  try {
    flushDraft(); flushNotes();
    const a = assignments.move(ASSIGN.id, $("ad-move").value);
    ASSIGN = a; MOD = a.module;
    $("ad-back").textContent = "← Back to " + modules.get(MOD).name;
    note($("ad-move-msg"), "good", "Moved to " + modules.get(MOD).name + ".");
  } catch (e) { note($("ad-move-msg"), "bad", e.message); }
};
$("ad-delete").onclick = () => {
  if (!confirm("Delete this assignment, its drafts, notes and quiz questions from this browser?")) return;
  const k = ASSIGN.module;
  assignments.remove(ASSIGN.id);
  ASSIGN = null;
  openModule(k);
};
function showSub(name) {
  document.querySelectorAll("#ad-nav button").forEach((b) => b.classList.toggle("active", b.dataset.sub === name));
  ["learn", "write", "aquiz", "brief"].forEach((s) => $("ad-" + s).classList.toggle("hidden", s !== name));
}
$("ad-nav").addEventListener("click", (e) => { if (e.target.dataset.sub) showSub(e.target.dataset.sub); });

// --------------------------------------------------------------- settings ---
const KEYLESS = ["auto", "chrome", "pollinations", "webllm"];
const AI_TEXT = {
  auto: "Recommended. Works straight away with no account or key. Uses Chrome's built-in AI if this computer has it, " +
    "otherwise the private AI if you've downloaded it, otherwise the free shared AI. If one stops working it switches to the next.",
  chrome: "Private: everything stays on this computer. Free, no account. Needs a recent Chrome on a newer computer " +
    "(Google lists macOS 13+ or Windows 10/11 with 16 GB of memory).",
  pollinations: "No account or key. Your questions and any assignment text are sent to Pollinations, a free public service " +
    "run by a third party, with no guarantee it stays available. Slow: it lets each person send roughly one request every " +
    "45 seconds, so a 10-question quiz can take several minutes. Generate questions ahead of time to avoid waits.",
  webllm: "Private: downloads a small AI (about 1 GB) into this browser once, then runs on this computer, even offline. " +
    "Needs a fairly recent computer and Chrome (WebGPU). Its answers are simpler and less accurate than the online AIs.",
};
let AI_STATUS = {};
function advancedKeys() {
  return Object.keys(E.PROVIDERS).filter((k) => !KEYLESS.includes(k) && (!E.PROVIDERS[k].localOnly || E.isLocalPage()));
}
async function refreshAIStatus() {
  const chrome = await E.chromeAIStatus();
  const gpu = await E.webgpuSupported();
  const ready = (store.get("meta", {}) || {}).webllm_ready;
  AI_STATUS = {
    chrome: chrome === "available" ? ["good", "ready on this computer"] : chrome === "unavailable" ? ["bad", "not available on this computer"]
      : ["", "Chrome needs a large one-time download first"],
    webllm: ready ? ["good", "downloaded"] : gpu ? ["", "not downloaded yet"] : ["bad", "not supported on this computer"],
    pollinations: ["", "slow, shared"],
    auto: ["good", "no setup"],
  };
  AI_STATUS.chromeRaw = chrome; AI_STATUS.gpu = gpu;
  renderAIOptions();
}
function renderAIOptions() {
  const cur = SETTINGS.provider;
  const rows = KEYLESS.map((k) => {
    const st = AI_STATUS[k] || ["", ""];
    const off = (k === "chrome" && AI_STATUS.chromeRaw === "unavailable") || (k === "webllm" && AI_STATUS.gpu === false);
    return '<label class="ai-opt' + (cur === k ? " on" : "") + (off ? " off" : "") + '"><input type="radio" name="ai" value="' + k + '"' +
      (cur === k ? " checked" : "") + (off ? " disabled" : "") + "><div><b>" + esc(E.PROVIDERS[k].label) + "</b>" +
      (st[1] ? '<span class="tag ' + st[0] + '">' + esc(st[1]) + "</span>" : "") + '<p class="why">' + esc(AI_TEXT[k]) + "</p></div></label>";
  });
  const keyed = !KEYLESS.includes(cur);
  rows.push('<label class="ai-opt' + (keyed ? " on" : "") + '"><input type="radio" name="ai" value="__own"' + (keyed ? " checked" : "") +
    "><div><b>My own free key</b>" + (keyed ? '<span class="tag good">' + esc(SETTINGS.label) + "</span>" : "") +
    '<p class="why">Fastest and most reliable. Takes about a minute to set up with a Google, Groq or OpenRouter account. Set it up under Advanced below.</p></div></label>');
  $("ai-options").innerHTML = rows.join("");
  $("webllm-box").classList.toggle("hidden", cur !== "webllm" || !!(store.get("meta", {}) || {}).webllm_ready);
}
$("ai-options").addEventListener("change", (e) => {
  const k = e.target.value;
  if (k === "__own") { $("adv").open = true; $("set-key").focus(); return; }
  E.saveSettings(store, {provider: k});
  SETTINGS = E.loadSettings(store);
  showStatus();
  renderAIOptions();
  note($("set-msg"), "good", "Now using: " + SETTINGS.label + ".");
});
$("webllm-go").onclick = async () => {
  const btn = $("webllm-go");
  busy(btn, true);
  $("webllm-bar").classList.remove("hidden");
  try {
    await new E.WebLLMClient({}, {store, onProgress: (text, frac) => { $("webllm-msg").textContent = text; if (frac != null) $("webllm-bar").value = frac; }}).engine();
    $("webllm-msg").textContent = "Done. The private AI is ready and works offline from now on.";
    refreshAIStatus();
  } catch (e) { $("webllm-msg").textContent = e.message; }
  $("webllm-bar").classList.add("hidden");
  busy(btn, false);
};
function fillSettings() {
  const sel = $("set-provider"), keys = advancedKeys();
  sel.innerHTML = keys.map((k) => '<option value="' + k + '">' + esc(E.PROVIDERS[k].label) + "</option>").join("");
  const last = (store.get("settings", {}) || {}).lastKeyed;
  sel.value = keys.includes(SETTINGS.provider) ? SETTINGS.provider : keys.includes(last) ? last : "gemini";
  if (keys.includes(SETTINGS.provider)) $("adv").open = true;
  renderAIOptions();
  refreshAIStatus();
  onProvider(true);
  fillBackupInfo();
}
function currentForm() {
  const k = $("set-provider").value, p = E.PROVIDERS[k], saved = E.loadSettings(store, k);
  const typed = $("set-key").value.trim();
  return {provider: k, label: p.label, needsKey: p.needsKey, kind: p.kind,
    url: k === "custom" ? $("set-url").value.trim() : p.url,
    apiKey: typed || saved.apiKey,
    model: modelValue() || p.model};
}
function modelValue() {
  const pick = $("set-model-pick").value;
  return pick && pick !== "__type" ? pick : $("set-model").value.trim();
}
function onProvider() {
  const k = $("set-provider").value, p = E.PROVIDERS[k], saved = E.loadSettings(store, k);
  $("set-url").value = k === "custom" ? saved.url : "";
  $("set-url-wrap").classList.toggle("hidden", k !== "custom");
  $("set-model-wrap").classList.toggle("hidden", k === "local");
  $("set-key-wrap").classList.toggle("hidden", !p.needsKey);
  $("set-key").value = "";
  $("set-key").placeholder = saved.apiKey ? "Saved in this browser. Leave blank to keep it." : "Paste your key";
  $("set-keylink").innerHTML = p.keyUrl ? 'Get a free key at <a href="' + esc(p.keyUrl) + '" target="_blank" rel="noopener">' + esc(p.keyUrl) + "</a>" :
    (k === "local" ? "Make sure llama-server is running (see README)." : "");
  $("adv-msg").innerHTML = "";
  MODELS = null;
  setModelChoices(null, saved.model || p.model);
  if (k !== "local") loadModels(true);
}
function setModelChoices(models, want) {
  const sel = $("set-model-pick");
  const ids = (models || []).map((m) => m.id);
  if (want && !ids.includes(want)) ids.unshift(want);  // keep the saved one visible even if not listed
  sel.innerHTML = ids.map((id) => {
    const m = (models || []).find((x) => x.id === id);
    return '<option value="' + esc(id) + '">' + esc(id) + (m && m.free && $("set-provider").value === "openrouter" ? " (free)" : "") + "</option>";
  }).join("") + '<option value="__type">Type a model name myself...</option>';
  sel.value = want && ids.includes(want) ? want : (ids[0] || "__type");
  $("set-model").value = want || "";
  $("set-model-type-wrap").classList.toggle("hidden", sel.value !== "__type");
}
$("set-model-pick").onchange = () => $("set-model-type-wrap").classList.toggle("hidden", $("set-model-pick").value !== "__type");
async function loadModels(quiet) {
  const f = currentForm(), msg = $("set-model-msg");
  if (f.provider === "local") return;
  if (f.needsKey && !f.apiKey && f.provider !== "openrouter") {
    msg.textContent = "Paste your key, then click Refresh list to see the available models.";
    return;
  }
  if (f.provider === "custom" && !f.url) { msg.textContent = "Enter the API address first."; return; }
  msg.textContent = "Loading the list of models...";
  try {
    MODELS = await E.listModels(f);
    setModelChoices(MODELS, modelValue() || f.model);
    msg.textContent = MODELS.length + " models available. Pick one, or keep the suggested one.";
  } catch (e) {
    msg.textContent = e.message + " You can type a model name instead.";
    if (!quiet) { $("set-model-pick").value = "__type"; $("set-model-type-wrap").classList.remove("hidden"); }
  }
}
$("set-load-models").onclick = () => loadModels(false);
$("set-key").addEventListener("change", () => loadModels(true));
$("set-url").addEventListener("change", () => loadModels(true));
$("set-provider").onchange = () => onProvider();
$("set-save").onclick = () => {
  const f = currentForm();
  if (f.provider === "custom" && !/^https?:\/\//.test(f.url)) { note($("adv-msg"), "bad", "Enter the API address (it starts with https://)."); return; }
  if (f.needsKey && !f.apiKey) { note($("adv-msg"), "bad", "Paste your API key first."); return; }
  try {
    E.saveSettings(store, f);
    store.set("settings", Object.assign(store.get("settings", {}), {lastKeyed: f.provider}));
    SETTINGS = E.loadSettings(store);
    showStatus();
    $("banner").innerHTML = "";
    onProvider();
    renderAIOptions();
    note($("adv-msg"), "good", "Saved. Now using " + SETTINGS.label + " · " + SETTINGS.model + ". Click Test the AI to check it works.");
  } catch (e) { note($("adv-msg"), "bad", e.message); }
};
$("set-check").onclick = async () => {
  thinking($("set-msg"));
  try { note($("set-msg"), "good", await llm().check()); } catch (e) { note($("set-msg"), "bad", e.message); }
  onRetry(0);
};
$("set-forget").onclick = () => {
  const k = $("set-provider").value;
  if (!confirm("Remove your " + E.PROVIDERS[k].label + " key from this browser? Your work stays.")) return;
  const saved = E.loadSettings(store, k);
  const was = SETTINGS.provider;
  E.saveSettings(store, Object.assign({}, saved, {provider: k, apiKey: ""}));
  E.saveSettings(store, {provider: was === k ? "auto" : was});  // switch back to no-setup if that key was in use
  SETTINGS = E.loadSettings(store);
  showStatus();
  fillSettings();
  note($("adv-msg"), "good", "Key removed from this browser." + (was === k ? " Switched to Automatic (no setup)." : ""));
};

// ------------------------------------------------------------ backups ---
function fillBackupInfo() {
  const meta = store.get("meta", {}) || {};
  $("bk-last").textContent = meta.last_backup ? "Last backup downloaded: " + meta.last_backup.replace("T", " ").slice(0, 16) : "No backup downloaded yet.";
  $("bk-legacy").classList.toggle("hidden", !E.isLocalPage());
  $("share-link").textContent = location.protocol === "https:" ? location.origin + location.pathname : "(appears here once the app is online)";
  $("version").textContent = "Learning Engine " + E.APP_VERSION;
}
function downloadBackup() {
  download("learning-engine-backup-" + E.todayStr() + ".json", JSON.stringify(E.exportBackup(store), null, 1), "application/json");
  store.set("meta", Object.assign(store.get("meta", {}) || {}, {last_backup: E.nowIso()}));
  fillBackupInfo();
}
$("bk-download").onclick = safe(downloadBackup);
$("bk-zip").onclick = safe(() => download("learning-engine-modules-" + E.todayStr() + ".zip", E.makeZip(E.moduleFiles(store)), "application/zip"));
$("bk-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const counts = E.importBackup(store, JSON.parse(await file.text()));
    note($("bk-msg"), "good", "Restored: " + counts.questions + " questions, progress for " + counts.topics + " topics and " + counts.assignments + " assignments" + (counts.modules ? ", " + counts.modules + " modules" : "") + ".");
  } catch (err) { note($("bk-msg"), "bad", err instanceof SyntaxError ? "That file isn't a Learning Engine backup." : err.message); }
};
$("bk-legacy").onclick = async () => {
  thinking($("bk-msg"));
  try {
    const r = await fetch("api/export");
    if (!r.ok) throw new Error("Couldn't read the app folder (HTTP " + r.status + "). Start the app with `python main.py web`.");
    const counts = E.importBackup(store, await r.json());
    note($("bk-msg"), "good", "Brought in " + counts.questions + " questions, progress for " + counts.topics + " topics and " + counts.assignments + " assignments" + (counts.modules ? ", " + counts.modules + " modules" : "") + ".");
  } catch (err) { note($("bk-msg"), "bad", err.message); }
};
$("bk-wipe").onclick = () => {
  if (!confirm("Delete ALL your progress, questions, assignments and your key from this browser? Download a backup first if you might want it.")) return;
  for (const k of store.keys("")) store.remove(k);
  location.reload();
};
function maybeRemindBackup() {
  if (!E.hasAnyWork(store)) return;
  const meta = store.get("meta", {}) || {}, last = (meta.last_backup || "").slice(0, 10);
  if (!last || last <= E.addDays(E.todayStr(), -7))
    showBanner("warn", "Your work is saved in this browser. It's a good idea to download a backup now and then.", "Download a backup", downloadBackup);
}

// --------------------------------------------------------- install & share ---
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("install-btn").classList.remove("hidden");
});
$("install-btn").onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  $("install-btn").classList.add("hidden");
};
window.addEventListener("appinstalled", () => $("install-btn").classList.add("hidden"));
$("share-copy").onclick = async () => {
  try { await navigator.clipboard.writeText($("share-link").textContent); $("share-copy").textContent = "Copied"; }
  catch (e) { $("share-copy").textContent = "Select the link and copy it"; }
};
// Other tabs of the app may change your data: keep this one in step.
window.addEventListener("storage", (e) => {
  if (e.key === "le:settings") { SETTINGS = E.loadSettings(store); showStatus(); }
});

// ------------------------------------------------------------------ start ---
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
showStatus();
loadToday();
loadTopics();
if (!E.isConfigured(SETTINGS)) {
  showTab("settings");  // an own-key service with its key removed
} else if (!(store.get("meta", {}) || {}).welcomed) {
  store.set("meta", Object.assign(store.get("meta", {}) || {}, {welcomed: E.nowIso()}));
  if (SETTINGS.provider === "auto")
    showBanner("good", "Welcome! No setup needed: the app uses a free AI automatically. Pick a module and start a quiz, or open Modules to add your own class subjects. " +
      "(The free shared AI can be slow. For faster answers, add your own free key in Settings.)");
} else {
  maybeRemindBackup();
}
