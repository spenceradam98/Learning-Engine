"""Terminal commands. main.py turns command-line arguments into calls here."""
from __future__ import annotations

from typing import Optional

from rich.markup import escape

from . import backup, config, generator, models, review, stats, topics, ui
from .assignments import GENERAL, AssignmentStore, module_key
from .llm_client import LLMClient, LLMError
from .progress import Progress
from .question_bank import QuestionBank
from .quiz import QuizSession
from .tutor import Tutor


def pick_topic(name: Optional[str]) -> Optional[str]:
    if name:
        try:
            return topics.resolve(name)
        except KeyError:
            ui.error("Unknown topic '{}'. Use midi, sound or live.".format(name))
            return None
    keys = list(config.TOPICS)
    i = ui.choose("Which topic?", [config.TOPICS[k]["name"] for k in keys])
    return keys[i]


# --- setup & status --------------------------------------------------------------

def cmd_check() -> None:
    llm = LLMClient()
    ui.info("AI provider: {}".format(llm.describe()))
    try:
        with ui.spin("Checking"):
            msg = llm.check()
        ui.ok(msg)
    except LLMError as e:
        ui.llm_error(e)


def cmd_setup() -> None:
    ui.title("Choose your AI")
    current = config.load_settings()
    keys = list(config.PROVIDERS)
    ui.info("Currently using: {}".format(current["label"]))
    i = ui.choose("Which one?", [config.PROVIDERS[k]["label"] for k in keys])
    key = keys[i]
    preset = config.PROVIDERS[key]
    same = current["provider"] == key
    url = preset["url"]
    if key == "custom" or not url:
        url = ui.ask("Chat completions URL (ends in /v1/chat/completions)",
                     default=current["url"] if same else None)
    api_key = ""
    if preset["needs_key"]:
        if preset["key_url"]:
            ui.info("Get a free key at {}".format(preset["key_url"]))
        typed = ui.ask("Paste your API key (hidden; Enter keeps the saved one)" if same and current["api_key"]
                       else "Paste your API key (hidden)", password=True)
        api_key = typed.strip() or (current["api_key"] if same else "")
    model = preset["model"]
    if key != "local":
        model = _pick_model(key, url, api_key, current["model"] if same else preset["model"])
    config.save_settings(key, url, model, api_key)
    ui.ok("Saved to settings.json.")
    if key != "local":
        ui.warn("Note: with an online provider, your questions and pasted assignment text are "
                "sent to that service.")
    cmd_check()


def _pick_model(provider: str, url: str, api_key: str, suggested: str) -> str:
    """Show the provider's current models to choose from; type one if the list can't load."""
    preset = config.PROVIDERS[provider]
    try:
        with ui.spin("Loading the list of available models"):
            found = models.list_models({"provider": provider, "url": url, "api_key": api_key,
                                        "needs_key": preset["needs_key"]})
    except LLMError as e:
        ui.warn("{} Type a model name instead.".format(escape(str(e))))
        return ui.ask("Model name", default=suggested or None)
    ids = [m["id"] for m in found]
    pick = models.preferred(found, suggested, preset["model"])
    # Put the suggested model first so pressing 1 is always a safe choice.
    if pick in ids:
        ids.remove(pick)
        ids.insert(0, pick)
    shown = ids[:40]
    labels = [escape(m) + (" [dim](current)[/]" if m == suggested else "") for m in shown]
    labels.append("Type a model name myself")
    if len(ids) > len(shown):
        ui.info("Showing 40 of {} models.".format(len(ids)))
    i = ui.choose("Which model? (1 is a good default)", labels)
    if i == len(shown):
        return ui.ask("Model name", default=suggested or None)
    return shown[i]


def cmd_backup() -> None:
    path = backup.write_backup()
    ui.ok("Saved a backup of all your work to {}".format(path))
    ui.info("You can open this file in the online app too: Settings > Restore from a backup.")


def cmd_restore(path: Optional[str]) -> None:
    if not path:
        path = ui.ask("Drag the backup file into this window (or type its path), then press Enter")
    path = path.strip().strip("'\"")
    try:
        counts = backup.restore_backup(path)
    except ValueError as e:
        ui.error(str(e))
        return
    ui.ok("Restored {questions} questions, progress for {topics} topics and {assignments} "
          "assignments. (Your previous data was saved in data/backups/ first.)".format(**counts))


def cmd_review_due(topic: Optional[str], n: int = 20) -> None:
    rows = stats.due_by_topic()
    if topic:
        try:
            key = topics.resolve(topic)
        except KeyError:
            ui.error("Unknown topic '{}'.".format(topic))
            return
        rows = [r for r in rows if r["key"] == key]
    if not rows:
        ui.ok("Nothing is due for review right now.")
        return
    if len(rows) == 1:
        key = rows[0]["key"]
    else:
        i = ui.choose("Which topic?", ["{} ({} due)".format(escape(r["name"]), r["due"]) for r in rows])
        key = rows[i]["key"]
    run_quiz(key, n, mode="review")


def show_today() -> None:
    s = stats.summary()
    bits = ["{}-day streak".format(s["streak"]), "{} answered today".format(s["answered_today"])]
    if s["due_total"]:
        bits.append("{} due for review".format(s["due_total"]))
    ui.info(" · ".join(bits))


def cmd_topics() -> None:
    rows = []
    for key, t in config.TOPICS.items():
        tot = Progress(key).totals()
        rows.append({"key": key, "name": t["name"], "questions": len(QuestionBank(key)), **tot})
    for key, m in topics.saved_modules().items():
        if key not in config.TOPICS and isinstance(m, dict) and m.get("name"):
            tot = Progress(key).totals()
            rows.append({"key": key, "name": m["name"], "questions": len(QuestionBank(key)), **tot})
    for a in AssignmentStore().list():
        key = topics.ASSIGNMENT_PREFIX + a["id"]
        tot = Progress(key).totals()
        rows.append({"key": key, "name": a["title"], "questions": len(QuestionBank(key)), **tot})
    ui.topics_table(rows)


# --- generate / quiz / review -------------------------------------------------------

def cmd_generate(topic: Optional[str], n: int = 10, level: Optional[int] = None) -> None:
    key = pick_topic(topic)
    if not key:
        return
    _generate(key, n, level)


def _generate(key: str, n: int, level: Optional[int] = None) -> None:
    info = topics.get(key)
    ui.title("Generating {} questions: {}".format(n, info.name))
    llm = LLMClient()
    state = {"status": None}

    def on_progress(done: int, total: int, msg: str) -> None:
        if state["status"] is not None and done < total:
            state["status"].update("[cyan]Question {}/{}: {}...".format(done + 1, total, msg))

    try:
        with ui.spin("Starting") as status:
            state["status"] = status
            res = generator.generate(key, n, llm=llm, difficulty=level, on_progress=on_progress)
    except LLMError as e:
        ui.llm_error(e)
        return
    ui.ok("Added {} new questions ({} in the bank now).".format(len(res["added"]), res["total_in_bank"]))
    if res["duplicates"]:
        ui.info("{} came out as repeats and were skipped.".format(res["duplicates"]))
    if res["failed"]:
        ui.warn("{} couldn't be made (the model's output was unusable).".format(res["failed"]))


def cmd_quiz(topic: Optional[str], n: int = 10) -> None:
    key = pick_topic(topic)
    if key:
        run_quiz(key, n)


def run_quiz(key: str, n: int = 10, mode: str = "adaptive") -> None:
    session = QuizSession(key, length=n, mode=mode)
    n = session.length
    if mode == "review":
        ui.title("Review: {}".format(session.info.name))
        ui.info("{} questions due. Your level doesn't change in a review.".format(n))
    else:
        ui.title("Quiz: {}".format(session.info.name))
        ui.info("Starting at level {}/5. 3 right in a row moves you up; 2 wrong moves you down."
                .format(session.difficulty))
    if len(session.bank) == 0 and mode != "review":
        ui.warn("No questions yet, so I'll make them as we go. Run `generate` first to skip the waits.")
    while not session.finished:
        try:
            with ui.spin("Finding a level {} question".format(session.difficulty)):
                q = session.next_question()
        except LLMError as e:
            ui.llm_error(e)
            break
        if q is None:
            ui.warn("Ran out of questions at this level.")
            break
        ui.show_question(q, len(session.results) + 1, n, session.difficulty)
        letter = ui.ask_answer()
        if letter is None:
            break
        conf = ui.ask_confidence()
        result = session.answer(ui.LETTERS.index(letter), conf)
        ui.show_result(q, result)
        if result["reexplain"]:
            ui.title("Let's go over this again")
            try:
                ui.stream(session.reexplain_stream(), "Preparing an explanation")
            except LLMError as e:
                ui.llm_error(e)
        ui.console.print()
    s = session.summary()
    if s["answered"]:
        ui.title("Done")
        ui.ok("You got {}/{} right. Level {} -> {}.".format(s["correct"], s["answered"],
                                                          s["start_difficulty"], s["end_difficulty"]))
        if s["weak_spots"]:
            ui.warn("Weakest right now: " + escape(", ".join(w["subtopic"] for w in s["weak_spots"])))


def cmd_review(topic: Optional[str], plan: bool = True) -> None:
    if topic:
        try:
            keys = [topics.resolve(topic)]
        except KeyError:
            ui.error("Unknown topic '{}'.".format(topic))
            return
    else:
        keys = review.topic_keys_with_progress()
    if not keys:
        ui.warn("No quiz history yet. Take a quiz first.")
        return
    for key in keys:
        rep = review.report(key)
        if not rep["subtopics"]:
            continue
        ui.title("Review: {}".format(rep["name"]))
        t = rep["totals"]
        ui.info("{} answered, {:.0%} correct, current level {}/5".format(
            t["answered"], t["accuracy"], t["difficulty"]))
        ui.mastery_table(rep)
        if not rep["weak"]:
            ui.ok("No weak spots below {:.0%}. Nice work.".format(config.WEAK_THRESHOLD))
            continue
        if rep["misses"]:
            ui.console.print("[bold]Recently missed:[/]")
            for m in rep["misses"][:5]:
                ui.console.print("  - {} [dim](answer: {})[/]".format(escape(m["question"]), escape(m["answer"])),
                                 markup=True, highlight=False)
        if plan:
            ui.console.print("\n[bold]Study plan[/]")
            try:
                ui.stream(review.study_plan_stream(rep), "Writing a study plan")
            except LLMError as e:
                ui.llm_error(e)


# --- assignments -------------------------------------------------------------------

def _get_assignment(aid: Optional[str]) -> Optional[dict]:
    store = AssignmentStore()
    items = store.list()
    if not items:
        ui.warn("No assignments yet. Add one with `assignment add`.")
        return None
    if aid:
        try:
            return store.get(aid)
        except KeyError:
            ui.error("No assignment with id '{}'.".format(aid))
            return None
    i = ui.choose("Which assignment?", ["{} [dim]({} · {})[/]".format(
        escape(a["title"]), escape(topics.module_name(a["module"])), a["id"]) for a in items])
    return items[i]


def _known_modules() -> list:
    """Module folders to offer: the built-in topics, General, and any folders you've made."""
    keys = [GENERAL] + list(config.TOPICS) + list(topics.STARTER_NAMES) + list(topics.saved_modules())
    for k in AssignmentStore().modules():
        keys.append(k)
    seen, out = set(), []
    for k in keys:
        if k not in seen:
            seen.add(k)
            out.append(k)
    return out


def _choose_module() -> str:
    keys = _known_modules()
    opts = ["{} [dim]({})[/]".format(escape(topics.module_name(k)), k) for k in keys] + ["A new module..."]
    i = ui.choose("Which module (folder) is it for?", opts)
    if i < len(keys):
        return keys[i]
    name = ui.ask("New module name (e.g. Music composition)")
    return module_key(name) if name.strip() else GENERAL


def cmd_assignment_add() -> None:
    ui.title("Add an assignment")
    title = ui.ask("Title")
    module = _choose_module()
    course = ui.ask("Course code (optional)", default="")
    due = ui.ask("Due date (optional)", default="")
    brief = ui.ask_multiline("Paste the assignment brief / task description.")
    rubric = ""
    if ui.confirm("Do you have a marking rubric or criteria to paste too?", default=False):
        rubric = ui.ask_multiline("Paste the rubric.")
    try:
        a = AssignmentStore().add(title, brief, course=course, due=due, rubric_text=rubric, module=module)
    except ValueError as e:
        ui.error(str(e))
        return
    ui.ok("Saved as '{}' in the {} folder (data/assignments/{}/).".format(
        a["id"], escape(topics.module_name(a["module"])), a["module"]))
    try:
        with ui.spin("Working out the key concepts"):
            concepts = Tutor().concepts(a)
        ui.info("Key concepts: " + escape(", ".join(c["name"] for c in concepts)))
    except LLMError as e:
        ui.warn("Couldn't analyse it yet ({}). I'll try again when you use learn or quiz.".format(
            escape(str(e))))


def cmd_assignment_list() -> None:
    items = AssignmentStore().list()
    if not items:
        ui.warn("No assignments yet. Add one with `assignment add`.")
        return
    current = None
    for a in sorted(items, key=lambda x: (x["module"] != GENERAL, x["module"], x["title"].lower())):
        if a["module"] != current:
            current = a["module"]
            ui.console.print("\n[bold]📁 {}[/]  [dim]data/assignments/{}/[/]".format(
                escape(topics.module_name(current)), current))
        extra = " · due {}".format(a["due"]) if a.get("due") else ""
        ui.console.print("  [bold]{}[/]  {}{}  [dim]{} drafts reviewed[/]".format(
            a["id"], escape(a["title"]), escape(extra), len(a.get("drafts", []))))


def _concepts(tutor: Tutor, a: dict) -> Optional[list]:
    try:
        with ui.spin("Working out the key concepts"):
            return tutor.concepts(a)
    except LLMError as e:
        ui.llm_error(e)
        return None


def cmd_assignment_learn(aid: Optional[str]) -> None:
    a = _get_assignment(aid)
    if not a:
        return
    tutor = Tutor()
    concepts = _concepts(tutor, a)
    if not concepts:
        return
    while True:
        ui.title("Learn: {}".format(a["title"]))
        i = ui.choose("Pick a concept to learn (or the last option to go back)",
                      ["{} [dim]- {}[/]".format(escape(c["name"]), escape(c["why"])) for c in concepts] + ["Back"])
        if i == len(concepts):
            return
        c = concepts[i]
        history = []
        try:
            text = ui.stream(tutor.learn_stream(a, c), "Preparing a lesson")
        except LLMError as e:
            ui.llm_error(e)
            continue
        history.append({"role": "assistant", "content": text})
        while True:
            qtext = ui.ask("\nAsk a follow-up question (Enter to go back)", default="")
            if not qtext.strip():
                break
            try:
                ans = ui.stream(tutor.followup_stream(a, c, history, qtext), "Thinking")
            except LLMError as e:
                ui.llm_error(e)
                break
            history += [{"role": "user", "content": qtext}, {"role": "assistant", "content": ans}]


def cmd_assignment_write(aid: Optional[str]) -> None:
    a = _get_assignment(aid)
    if not a:
        return
    tutor = Tutor()
    ui.info("Writing coach: I'll help you plan, get unstuck and improve your own draft. "
            "I won't write the assignment for you.")
    while True:
        ui.title("Write: {}".format(a["title"]))
        i = ui.choose("What do you need?", [
            "Plan it: suggested structure and guiding questions",
            "I'm stuck: get hints on a part",
            "Feedback on my draft",
            "See my saved outline",
            "Back",
        ])
        try:
            if i == 0:
                text = ui.stream(tutor.outline_stream(a), "Planning")
                tutor.save_outline(a, text)
            elif i == 1:
                stuck = ui.ask("What part are you stuck on, and what have you tried?")
                if stuck.strip():
                    ui.stream(tutor.hint_stream(a, stuck), "Thinking")
            elif i == 2:
                draft = ui.ask_multiline("Paste your draft (or the section you want feedback on).")
                if draft:
                    fb = ui.stream(tutor.feedback_stream(a, draft), "Reading your draft")
                    tutor.save_feedback(a, draft, fb)
                    ui.ok("Feedback saved with this draft.")
            elif i == 3:
                if a.get("outline"):
                    ui.markdown(a["outline"])
                else:
                    ui.warn("No outline yet. Choose 'Plan it' first.")
            else:
                return
        except LLMError as e:
            ui.llm_error(e)


def cmd_assignment_quiz(aid: Optional[str], n: int = 10) -> None:
    a = _get_assignment(aid)
    if not a:
        return
    if not _concepts(Tutor(), a):
        return
    key = topics.ASSIGNMENT_PREFIX + a["id"]
    if len(QuestionBank(key)) < 5 and ui.confirm(
            "Make 5 questions from this assignment first? (saves waiting during the quiz)"):
        _generate(key, 5)
    run_quiz(key, n)


def cmd_assignment_delete(aid: Optional[str]) -> None:
    a = _get_assignment(aid)
    if a and ui.confirm("Delete '{}' and its drafts? Its quiz questions stay.".format(a["title"]),
                        default=False):
        AssignmentStore().delete(a["id"])
        ui.ok("Deleted.")


# --- interactive menu ------------------------------------------------------------------

def menu() -> None:
    config.ensure_dirs()
    ui.title("Learning Engine")
    ui.info("AI: {}".format(LLMClient().describe()))
    show_today()
    if backup.auto_backup():
        ui.info("Saved today's automatic backup in data/backups/.")
    actions = [
        ("Quiz me", lambda: cmd_quiz(None)),
        ("Review questions due today (spaced repetition)", lambda: cmd_review_due(None)),
        ("Generate 10 new questions", lambda: cmd_generate(None)),
        ("Review weak spots", lambda: cmd_review(None)),
        ("Assignments: learn", lambda: cmd_assignment_learn(None)),
        ("Assignments: writing coach", lambda: cmd_assignment_write(None)),
        ("Assignments: quiz", lambda: cmd_assignment_quiz(None)),
        ("Assignments: add new", cmd_assignment_add),
        ("Topics and progress", cmd_topics),
        ("Choose AI (local or free online)", cmd_setup),
        ("Check the AI connection", cmd_check),
        ("Back up all my work to a file", cmd_backup),
        ("Quit", None),
    ]
    while True:
        ui.console.print()
        i = ui.choose("Choose", [a[0] for a in actions])
        fn = actions[i][1]
        if fn is None:
            return
        try:
            fn()
        except KeyboardInterrupt:
            ui.warn("\nStopped.")
