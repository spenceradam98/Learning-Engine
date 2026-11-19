#!/usr/bin/env python3
"""Learning Engine: an adaptive tutor for MIDI, sound principles, live sound
and your own college assignments.

Run with no arguments for the menu, or `python main.py --help` for commands.
"""
from __future__ import annotations

import argparse
import sys

if sys.version_info < (3, 8):
    sys.exit("Learning Engine needs Python 3.8 or newer.")

from engine import cli, config  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="main.py", description="Adaptive learning engine.")
    sub = p.add_subparsers(dest="cmd")

    sub.add_parser("menu", help="interactive menu (the default)")
    w = sub.add_parser("web", help="open the browser version (Chrome)")
    w.add_argument("--port", type=int, default=5050)
    w.add_argument("--no-browser", action="store_true", help="don't open Chrome automatically")
    sub.add_parser("setup", help="choose the AI: local model or a free online API")
    sub.add_parser("check", help="test the AI connection")
    sub.add_parser("topics", help="list topics, question counts and progress")

    g = sub.add_parser("generate", help="generate new questions on a topic")
    g.add_argument("topic", nargs="?", help="midi, sound or live")
    g.add_argument("-n", type=int, default=10, help="how many (default 10)")
    g.add_argument("--level", type=int, choices=range(1, 6), help="fix the difficulty (1-5)")

    q = sub.add_parser("quiz", help="adaptive quiz from the question bank")
    q.add_argument("topic", nargs="?")
    q.add_argument("-n", type=int, default=10, help="number of questions (default 10)")

    r = sub.add_parser("review", help="review weak spots")
    r.add_argument("topic", nargs="?")
    r.add_argument("--no-plan", action="store_true", help="skip the AI study plan")

    a = sub.add_parser("assignment", help="college assignments: add, list, learn, write, quiz, delete")
    asub = a.add_subparsers(dest="action")
    asub.add_parser("add", help="paste in a new assignment brief")
    asub.add_parser("list", help="list your assignments")
    for name, text in (("learn", "learn the concepts an assignment needs"),
                       ("write", "writing coach: plan, hints and draft feedback"),
                       ("quiz", "quiz yourself on an assignment's concepts"),
                       ("delete", "delete an assignment")):
        x = asub.add_parser(name, help=text)
        x.add_argument("id", nargs="?", help="assignment id (see `assignment list`)")
        if name == "quiz":
            x.add_argument("-n", type=int, default=10)
    return p


def main(argv=None) -> None:
    args = build_parser().parse_args(argv)
    config.ensure_dirs()
    cmd = args.cmd or "menu"
    try:
        if cmd == "menu":
            cli.menu()
        elif cmd == "web":
            from engine import web
            web.serve(port=args.port, open_browser=not args.no_browser)
        elif cmd == "setup":
            cli.cmd_setup()
        elif cmd == "check":
            cli.cmd_check()
        elif cmd == "topics":
            cli.cmd_topics()
        elif cmd == "generate":
            cli.cmd_generate(args.topic, args.n, args.level)
        elif cmd == "quiz":
            cli.cmd_quiz(args.topic, args.n)
        elif cmd == "review":
            cli.cmd_review(args.topic, plan=not args.no_plan)
        elif cmd == "assignment":
            action = args.action or "list"
            if action == "add":
                cli.cmd_assignment_add()
            elif action == "list":
                cli.cmd_assignment_list()
            elif action == "learn":
                cli.cmd_assignment_learn(args.id)
            elif action == "write":
                cli.cmd_assignment_write(args.id)
            elif action == "quiz":
                cli.cmd_assignment_quiz(args.id, args.n)
            elif action == "delete":
                cli.cmd_assignment_delete(args.id)
    except (KeyboardInterrupt, EOFError):
        print("\nBye.")


if __name__ == "__main__":
    main()
