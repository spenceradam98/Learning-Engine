"""Terminal helpers built on rich."""
from __future__ import annotations

from typing import Iterable, Iterator, List, Optional

from rich.console import Console
from rich.markup import escape
from rich.markdown import Markdown
from rich.panel import Panel
from rich.prompt import Confirm, IntPrompt, Prompt
from rich.table import Table

try:  # Lets long pasted lines through on macOS (the plain terminal caps a line at 1024 chars).
    import readline  # noqa: F401
except ImportError:  # pragma: no cover
    pass

from . import config
from .llm_client import LLMError

console = Console()
LETTERS = "ABCD"


def title(text: str) -> None:
    console.rule("[bold cyan]{}".format(text))


def info(text: str) -> None:
    console.print("[cyan]{}[/]".format(text))


def ok(text: str) -> None:
    console.print("[green]{}[/]".format(text))


def warn(text: str) -> None:
    console.print("[yellow]{}[/]".format(text))


def error(text: str) -> None:
    console.print("[bold red]{}[/]".format(text))


def markdown(text: str) -> None:
    console.print(Markdown(text))


def ask(text: str, default: Optional[str] = None, password: bool = False) -> str:
    return Prompt.ask(text, default=default, password=password) or ""


def ask_int(text: str, default: int) -> int:
    return IntPrompt.ask(text, default=default)


def confirm(text: str, default: bool = True) -> bool:
    return Confirm.ask(text, default=default)


def choose(text: str, options: List[str]) -> int:
    """Numbered menu. Returns the chosen index."""
    for i, opt in enumerate(options, 1):
        console.print("  [bold]{}[/]. {}".format(i, opt))
    while True:
        raw = Prompt.ask(text)
        if raw.isdigit() and 1 <= int(raw) <= len(options):
            return int(raw) - 1
        warn("Type a number from 1 to {}.".format(len(options)))


def ask_multiline(text: str) -> str:
    """Read pasted text until a line containing only END (or Ctrl-D)."""
    console.print("[bold]{}[/]\n[dim]Paste the text, then type END on its own line and press "
                  "Enter.[/]".format(text))
    lines = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if line.strip() == "END":
            break
        lines.append(line)
    return "\n".join(lines).strip()


def stream(chunks: Iterable[str], label: str = "Thinking") -> str:
    """Show a spinner until the model starts writing, then print as it goes."""
    it: Iterator[str] = iter(chunks)
    parts = []
    with console.status("[cyan]{}... (a local model can take a minute)".format(label)):
        try:
            first = next(it)
        except StopIteration:
            first = ""
    if first:
        parts.append(first)
        console.print(first, end="", markup=False, highlight=False)
    for chunk in it:
        parts.append(chunk)
        console.print(chunk, end="", markup=False, highlight=False)
    console.print()
    return "".join(parts)


def spin(label: str):
    return console.status("[cyan]{}...".format(label))


def show_question(q: dict, n: int, total: int, difficulty: int) -> None:
    body = "[bold]{}[/]\n\n".format(escape(q["question"]))
    body += "\n".join("  [bold cyan]{}[/]  {}".format(LETTERS[i], escape(c)) for i, c in enumerate(q["choices"]))
    console.print(Panel(body, title="Question {}/{}".format(n, total),
                        subtitle="level {}/5 · {}".format(difficulty, escape(q.get("subtopic", ""))),
                        border_style="cyan"))


def ask_answer() -> Optional[str]:
    """Returns 'A'-'D', or None to quit."""
    while True:
        raw = Prompt.ask("Your answer [bold](A/B/C/D, Q to stop)[/]").strip().upper()
        if raw in ("Q", "QUIT"):
            return None
        if raw in LETTERS and raw:
            return raw
        warn("Type A, B, C or D.")


def ask_confidence() -> int:
    raw = Prompt.ask("How sure were you? [bold]1[/]=guess  [bold]2[/]=fairly  [bold]3[/]=certain",
                     choices=["1", "2", "3"], default="2")
    return int(raw)


def show_result(q: dict, result: dict) -> None:
    right = escape(q["choices"][result["answer_index"]])
    if result["correct"]:
        console.print("[bold green]Correct![/] {}".format(right))
    else:
        console.print("[bold red]Not quite.[/] The answer was [bold]{}. {}[/]".format(
            LETTERS[result["answer_index"]], right))
    console.print("[dim]{}[/]".format(escape(result["explanation"])))
    if result["change"] == "up":
        ok("Three in a row. Moving up to level {}.".format(result["difficulty"]))
    elif result["change"] == "down":
        warn("Dropping to level {} so we can rebuild the basics.".format(result["difficulty"]))


def topics_table(rows: List[dict]) -> None:
    t = Table(title="Topics")
    for col in ("Key", "Topic", "Questions", "Level", "Answered", "Accuracy"):
        t.add_column(col)
    for r in rows:
        t.add_row(r["key"], escape(r["name"]), str(r["questions"]), "{}/5".format(r["difficulty"]),
                  str(r["answered"]), "{:.0%}".format(r["accuracy"]) if r["answered"] else "-")
    console.print(t)


def mastery_table(rep: dict) -> None:
    t = Table(title="{}: confidence by subtopic".format(rep["name"]))
    t.add_column("Subtopic")
    t.add_column("Mastery")
    t.add_column("Right / seen")
    for s in rep["subtopics"]:
        m = s["mastery"]
        colour = "red" if m < 0.45 else "yellow" if m < config.WEAK_THRESHOLD else "green"
        bar = "#" * int(round(m * 10))
        t.add_row(escape(s["subtopic"]), "[{}]{:<10} {:.0%}[/]".format(colour, bar, m),
                  "{}/{}".format(s["correct"], s["seen"]))
    console.print(t)


def llm_error(e: LLMError) -> None:
    error(escape(str(e)))
