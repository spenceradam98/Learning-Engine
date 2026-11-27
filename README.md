# Learning Engine

A personal adaptive tutor for the modules (class subjects) on your music course. It starts with:

- **MIDI**: theory, protocol and practical use in DAWs
- **Applied sound principles**: acoustics, signal processing, psychoacoustics
- **Live sound practices**: PA setup, mic placement, gain staging, feedback management
- **Music business and marketing**, **Creative project labs** and **Music composition**
- **Your own modules**: add any class subject, with your course notes to guide the questions
- **Your college assignments**, each filed in its module's folder: paste in a brief, learn the concepts it needs, get writing coaching, and quiz yourself on it

It runs **online in Chrome** (nothing to install, easy to share), or on your Mac in the **terminal**. The AI can be a **free online API** or a **local model** (fully offline, Mac only).

## Use it online (no Terminal needed)

Open **https://spenceradam98.github.io/Learning-Engine/** in Chrome.

1. It works straight away: no account, no key. Pick a topic and start a quiz. The app uses a free AI automatically (see **Choosing the AI** below).
2. To install it like an app, click the install icon at the right of Chrome's address bar, or the **Install app** button at the top of the page.
3. To share it, send people the link above (it's also under Settings, with a **Copy link** button).

Good to know:

- Nobody needs an account. Anyone who adds their own key (optional, under Settings > Advanced) keeps it in their own browser; it is never put on the website or shared.
- **Your work saves automatically in your browser**: progress, question banks, assignments, drafts, notes and lessons. Nobody else can see it. It stays on that computer and in that browser, so use **Settings > Download a backup** now and then, and **Restore from a backup** to move it to another computer.
- If the AI says it's busy, the app waits and tries again a few times by itself. If it still fails, wait a minute or pick another model or service in Settings.

### Choosing the AI

In **Settings > Choose your AI**:

| Option | Setup | Privacy | Speed and quality |
|---|---|---|---|
| **Automatic** (default) | None | Uses the most private option available | Picks Chrome's built-in AI, then the private AI if downloaded, then the free shared AI, and switches if one fails |
| **Chrome's built-in AI** | None, on computers that have it | Stays on your computer | Good and fast, but needs a recent Chrome on a newer computer (macOS 13+ or Windows 10/11, 16 GB memory) |
| **Free shared AI** (Pollinations) | None | Text is sent to Pollinations, a free third-party service | Slow: about one request every 45 seconds per person. No guarantee it stays available |
| **Private AI on this computer** | One-time download, about 1 GB | Stays on your computer, works offline | Needs WebGPU (recent Chrome, most computers from about 2016). Simpler, less accurate answers |
| **Your own free key** (Gemini, Groq, OpenRouter) | About a minute, needs an account | Text is sent to that service | Fastest and most reliable |

### Putting it online (Adam, one time only)

The app is published by GitHub for free whenever the `main` branch changes. Turn this on once:

1. Open https://github.com/spenceradam98/Learning-Engine/settings/pages
2. Under **Build and deployment > Source**, choose **GitHub Actions**. (Nothing else to fill in.)
3. Open the **Actions** tab, click **Publish the app**, then **Run workflow** (or just merge a change into `main`).
4. After about a minute the site is live at the link above.

Built for a 2014 Intel MacBook Pro on macOS 11 with its built-in Python 3.8. The only dependencies are `requests` and `rich`.

---

## 1. Install (once)

Open **Terminal** and run:

```bash
cd ~
git clone https://github.com/spenceradam98/Learning-Engine.git learning-engine
cd learning-engine
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

Each time you open a new Terminal window, run `cd ~/learning-engine && source .venv/bin/activate` first.

## 2. Choose your AI

You need **one** of these. You can switch at any time.

### Option A: Free online API (quickest to set up, fast)

1. Get a free API key. **Groq** is the fastest and easiest:
   - Groq: https://console.groq.com/keys
   - Google Gemini: https://aistudio.google.com/apikey
   - OpenRouter: https://openrouter.ai/keys (use a model whose name ends in `:free`)
2. Run `python main.py setup`, pick the provider and paste your key. It then shows the
   models that provider currently offers, so you can pick one instead of typing a name.
3. Run `python main.py check` to confirm it works.

Your key is saved in `settings.json` in this folder. That file is never committed to git.
With an online provider, your questions and any assignment text you paste are sent to that service.
Free tiers have rate limits. If you see a "rate limit" message, wait a minute.
Free model names change over time. If you get "doesn't know the model", run `setup` again and pick a current one from the list.
If a service says it's busy (HTTP 503) or slow down (429), the app waits and retries up to three times automatically.

### Option B: Local model (offline, private, slower)

This builds [llama.cpp](https://github.com/ggml-org/llama.cpp) and downloads Qwen2.5 7B Instruct (Q4_K_M, about 4.7 GB). With 16 GB of RAM that fits comfortably.

```bash
xcode-select --install          # only if you don't already have Apple's command line tools
bash scripts/setup_llama.sh     # builds llama-server and downloads the model (allow 20-40 min)
```

Then, **every time** you want to use the engine, start the model in its own Terminal window and leave it open:

```bash
cd ~/learning-engine
bash scripts/start_llm.sh
```

Wait until it prints `server is listening`. Then, in another window, run `python main.py check`.

**Speed:** on a 2014 MacBook Pro, the 7B model writes roughly 2–4 words per second, so making one quiz question takes 30–60 seconds. Generate questions ahead of time (see below) so quizzes don't wait. For about twice the speed, use the 3B model:

```bash
bash scripts/setup_llama.sh 3b
bash scripts/start_llm.sh 3b
```

If you used `setup` to pick an online API, run `python main.py setup` and choose **Local model** to switch back.

## 3. Use it

### In Chrome

```bash
python main.py web
```

Chrome opens at **http://localhost:5050**. This is the same app as the online version, with one extra: you can choose the **local model**. Leave the Terminal window open while you use it, and press Ctrl+C there to stop.
The app only listens on your own Mac, so nobody else on your network can open it.

The browser app keeps its own copy of your work in Chrome, and asks for your key once in Settings. To bring in work you saved with the terminal version (or the older browser version), open **Settings** and click **Bring in my saved work from this computer's app folder**.

### In the terminal

```bash
python main.py                  # menu with every option
```

Or run commands directly:

| Command | What it does |
|---|---|
| `python main.py generate midi` | Make 10 new questions on a topic (`midi`, `sound`, `live`). Add `-n 5` for a different count or `--level 3` to fix the difficulty |
| `python main.py quiz live` | Adaptive quiz from the question bank. Add `-n 20` for a longer quiz |
| `python main.py due` | Spaced-repetition review: only the questions due today |
| `python main.py backup` / `restore <file>` | Save all your work to one file, or restore it. The file also works in the online app |
| `python main.py review` | Review weak spots across all topics, with an AI study plan. Add a topic to narrow it down, or `--no-plan` to skip the plan |
| `python main.py topics` | Question counts, levels and accuracy |
| `python main.py assignment add` | Paste in a new assignment brief and rubric, and choose which module's folder it goes in |
| `python main.py assignment list` | Your assignments and their ids, grouped by module folder |
| `python main.py assignment learn <id>` | Learn the key concepts the assignment needs, with follow-up questions |
| `python main.py assignment write <id>` | Writing coach: plan, hints when you're stuck, feedback on your draft |
| `python main.py assignment quiz <id>` | Adaptive quiz on that assignment's concepts |
| `python main.py setup` / `check` | Choose the AI and test the connection |

When the terminal asks you to paste text, paste it, type `END` on its own line, and press Enter.

## How it adapts

- Every topic has a level from 1 (beginner) to 5 (expert). You start at 2.
- **3 correct in a row** moves you up a level.
- **2 wrong in a row** moves you down a level, and the AI re-teaches the concept you missed.
- After each answer you say how sure you were (guess, fairly sure or certain). Each subtopic gets a confidence score from your answers. Being wrong when you were certain lowers it the most.
- **Weak spots** lists subtopics below 60%, your recently missed questions and a study plan.
- Quizzes prefer questions you haven't seen, sometimes bring back ones you got wrong, and lean towards your weakest subtopics.
- If the bank runs out at your level, a new question is made on the spot.
- **Spaced review:** every question you answer is scheduled to come back. Miss it and it's due again today; get it right (and not by guessing) and it comes back after 1, 3, 7, 14, then 30 days. The **Today** panel shows your daily streak, how many you've answered today and what's due.

## Modules: one folder per class subject

Open the **Modules** tab. Each module is a folder with its own questions, progress, spaced review, notes and assignments, so nothing mixes between subjects.

- **Add a module**: give it a name, and optionally a short description and your course notes or syllabus. The questions follow your notes. Leave the subtopics blank and the AI suggests some.
- **Open a module** to quiz it, review what's due, make questions, edit it, write your own notes (they save as you type), or **Download this folder** as a .zip.
- **Assignments live inside a module.** Add an assignment from inside the module it belongs to. You can move it to another module from its **Brief** tab.
- **Deleting a module** deletes its questions and progress, but never its assignments: they move to the **General** folder.
- The starter modules can be renamed, edited or deleted like any other. Assignments you saved before modules existed are in **General**.
- **Settings > Download everything as folders (.zip)** gives you one folder per module, each with its notes and its own assignments.

## Assignments: coaching, not ghost-writing

The writing coach is built to help you write **your own** assignment. It explains concepts, suggests a structure as headings with guiding questions, gives hints when you're stuck, and gives feedback on your draft against the brief and rubric. It's instructed never to write paragraphs of the assignment for you or rewrite your text.

Each assignment also gets its own question bank and progress, so you can quiz yourself on what it needs.

## Your data

In the browser app (online or `python main.py web`), everything is saved in Chrome's storage for that site. Use **Settings > Download a backup** to keep a copy.

The terminal version stores JSON files in `data/`, and makes an automatic daily backup in `data/backups/` (the last 10 are kept):

- `data/questions/<topic>.json`: the question bank
- `data/progress/<topic>.json`: answers, streaks, level and subtopic confidence
- `data/assignments/<module>/<id>.json`: one folder per module, each holding only that module's assignments (brief, rubric, key concepts, outline and drafts with feedback). For example `data/assignments/composition/film-cue.json`. Assignments with no module go in `data/assignments/general/`. You can move an assignment by moving its file to another module's folder.
- `data/modules.json`: modules you made in the browser app, after restoring a browser backup here

These files are git-ignored, so they stay on your Mac. `python main.py backup` saves everything to one file you can also restore in the online app.

## Troubleshooting

- **"Can't reach the model at http://localhost:8080"**: the local model isn't running. Start it with `bash scripts/start_llm.sh` and wait for `server is listening`.
- **"still loading the model"**: wait a minute. The first load from disk is slow.
- **The model took too long**: the default timeout is 300 seconds. Raise it with `export LE_LLM_TIMEOUT=600`, or switch to the 3B model or an online API.
- **`setup_llama.sh` fails to build**: the newest llama.cpp sometimes needs a newer compiler than macOS 11 has. Try an older release:
  `cd ~/llama.cpp && git fetch --depth 1 origin tag b4500 && git checkout b4500`, then run the script again.
- **The model download fails**: download the `.gguf` file in your browser from the Hugging Face page (search "bartowski Qwen2.5-7B-Instruct-GGUF") and put it in `learning-engine/models/`.
- **Port 5050 is busy**: run `python main.py web --port 5051`.

## For developers

```
main.py                 command line entry point
engine/config.py        settings, topics, AI providers, adaptive thresholds
engine/llm_client.py    OpenAI-compatible client, streaming, JSON extraction and retries
engine/prompts.py       every prompt and JSON schema
engine/question_bank.py storing, validating and picking questions
engine/progress.py      per-topic progress and confidence scores
engine/adaptive.py      the level up/down rules (pure logic)
engine/generator.py     making questions with the AI, one at a time
engine/quiz.py          quiz sessions (shared by terminal and browser)
engine/review.py        weak spot reports and study plans
engine/assignments.py   assignment storage
engine/tutor.py         learn and writing-coach features
engine/ui.py, cli.py    terminal interface
engine/models.py        fetching each provider's model list
engine/stats.py         streaks and reviews due
engine/backup.py        one-file backup and restore (same format as the browser app)
engine/web.py           serves app/ on localhost (Python's built-in web server)
app/                    the browser app: static files, no build step, hosted on GitHub Pages
  engine.js             all logic (AI client, questions, progress, spaced review, backups)
  ui.js, index.html     the page
  sw.js, manifest       installable app and offline support
.github/workflows/      tests, and publishing app/ to GitHub Pages
scripts/                llama.cpp setup and start scripts
tests/                  unit tests and a fake model server
```

Run the tests with `python -m unittest discover -s tests -t .` and `node --test tests/js/engine.test.mjs`.
To try the app without a model, run `python tests/fake_llm_server.py` in one window. It pretends to be llama-server on port 8080 and returns canned questions. Then run `python main.py web` and pick **Local model** in Settings.

Local models get extra protection against broken output. Questions are requested one at a time with a JSON schema, which llama-server enforces as a grammar. Replies are then parsed tolerantly (code fences, extra chatter and trailing commas are handled), validated, and retried up to twice with a correction prompt.
