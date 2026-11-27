import json

from engine import backup, config, prompts, topics
from engine.assignments import AssignmentStore, module_key
from tests.helpers import TempDataTest


class ModuleFolderTests(TempDataTest):
    def test_each_assignment_lives_in_its_module_folder(self):
        store = AssignmentStore()
        a = store.add("Film cue", "Write a cue.", module="composition")
        b = store.add("Release plan", "Plan a release.", module="music-business")
        self.assertTrue((config.ASSIGNMENTS_DIR / "composition" / "film-cue.json").exists())
        self.assertTrue((config.ASSIGNMENTS_DIR / "music-business" / "release-plan.json").exists())
        self.assertEqual([x["id"] for x in store.list("composition")], [a["id"]])
        self.assertEqual([x["id"] for x in store.list("music-business")], [b["id"]])
        self.assertEqual(store.get("film-cue")["module"], "composition")
        self.assertEqual(sorted(store.modules()), ["composition", "music-business"])

    def test_ids_stay_unique_across_folders_and_default_to_general(self):
        store = AssignmentStore()
        store.add("Essay", "One.", module="composition")
        second = store.add("Essay", "Two.")
        self.assertEqual(second["id"], "essay-2")
        self.assertEqual(second["module"], "general")
        with self.assertRaises(ValueError):
            store.add("Bad", "x", module="../evil")

    def test_move_and_save_keep_one_copy(self):
        store = AssignmentStore()
        store.add("Gig review", "Review a gig.", module="live")
        a = store.move("gig-review", "music-business")
        a["working_draft"] = "draft"
        store.save(a)
        self.assertFalse((config.ASSIGNMENTS_DIR / "live" / "gig-review.json").exists())
        self.assertEqual(len(store.list()), 1)
        self.assertEqual(store.get("gig-review")["working_draft"], "draft")

    def test_old_loose_assignments_move_into_general(self):
        (config.ASSIGNMENTS_DIR / "rep.json").write_text(json.dumps({"id": "rep", "title": "Rep", "brief_text": "B"}))
        store = AssignmentStore()
        self.assertFalse((config.ASSIGNMENTS_DIR / "rep.json").exists())
        self.assertTrue((config.ASSIGNMENTS_DIR / "general" / "rep.json").exists())
        self.assertEqual(store.get("rep")["module"], "general")

    def test_backup_keeps_folders_both_ways(self):
        AssignmentStore().add("Film cue", "Write a cue.", module="composition")
        data = backup.export_backup()
        self.assertEqual(data["assignments"]["film-cue"]["module"], "composition")
        # A backup from the browser app, with its own modules.
        f = config.DATA_DIR / "from-browser.json"
        f.write_text(json.dumps({"app": "learning-engine", "questions": {}, "progress": {},
                                 "assignments": {"pitch": {"id": "pitch", "title": "Pitch", "brief_text": "B",
                                                           "module": "sync-licensing"},
                                                 "odd": {"id": "odd", "title": "Odd", "brief_text": "B",
                                                         "module": "../x"}},
                                 "modules": {"sync-licensing": {"name": "Sync licensing", "subtopics": ["fees"],
                                                                "notes": "Our class uses the PRS guide."}}}))
        counts = backup.restore_backup(f)
        self.assertEqual(counts["assignments"], 2)
        self.assertEqual(counts["modules"], 1)
        self.assertTrue((config.ASSIGNMENTS_DIR / "sync-licensing" / "pitch.json").exists())
        self.assertTrue((config.ASSIGNMENTS_DIR / "general" / "odd.json").exists())
        info = topics.get("sync-licensing")
        self.assertEqual(info.name, "Sync licensing")
        self.assertEqual(info.context_kind, "notes")
        msg = prompts.question_messages(info.name, "fees", 2, [], context=info.context,
                                        context_kind=info.context_kind)[1]["content"]
        self.assertIn("notes about the student's course", msg)
        self.assertIn("modules", backup.export_backup())

    def test_module_key(self):
        self.assertEqual(module_key("Music Composition"), "music-composition")
        self.assertEqual(module_key("Assignment ideas"), "m-assignment-ideas")
        self.assertEqual(module_key("!!!"), "general")
