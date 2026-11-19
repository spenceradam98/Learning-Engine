# Learning Engine

A personal adaptive tutor for:

- **MIDI**: theory, protocol and practical use in DAWs
- **Applied sound principles**: acoustics, signal processing, psychoacoustics
- **Live sound**: PA setup, mic placement, gain staging, feedback management
- **Your college assignments**: paste in a brief, learn the concepts it needs, get writing coaching, and quiz yourself on it

It runs on your Mac in the **terminal** or in **Chrome**. The AI can be a **local model** (fully offline) or a **free online API** (much faster on older Macs).

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
2. Run `python main.py setup`, pick the provider and paste your key.
   In the browser version, use the **AI settings** tab instead.
3. Run `python main.py check` to confirm it works.

Your key is saved in `settings.json` in this folder. That file is never committed to git.
With an online provider, your questions and any assignment text you paste are sent to that service.
Free tiers have rate limits. If you see a "rate limit" message, wait a minute.
Free model names change over time. If you get "doesn't know the model", run `setup` again and type a current model name from the provider's website.

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

Chrome opens at **http://localhost:5050**. The page has tabs for Quiz me, Generate, Weak spots, Assignments and AI settings. Leave the Terminal window open while you use it, and press Ctrl+C there to stop.
The app only listens on your own Mac, so nobody else on your network can open it.
Pasting long assignment briefs and drafts is easiest here.

### In the terminal

```bash
python main.py                  # menu with every option
```

Or run commands directly:

| Command | What it does |
|---|---|
| `python main.py generate midi` | Make 10 new questions on a topic (`midi`, `sound`, `live`). Add `-n 5` for a different count or `--level 3` to fix the difficulty |
| `python main.py quiz live` | Adaptive quiz from the question bank. Add `-n 20` for a longer quiz |
| `python main.py review` | Review weak spots across all topics, with an AI study plan. Add a topic to narrow it down, or `--no-plan` to skip the plan |
| `python main.py topics` | Question counts, levels and accuracy |
| `python main.py assignment add` | Paste in a new assignment brief and rubric |
| `python main.py assignment list` | Your assignments and their ids |
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

## Assignments: coaching, not ghost-writing

The writing coach is built to help you write **your own** assignment. It explains concepts, suggests a structure as headings with guiding questions, gives hints when you're stuck, and gives feedback on your draft against the brief and rubric. It's instructed never to write paragraphs of the assignment for you or rewrite your text.

Each assignment also gets its own question bank and progress, so you can quiz yourself on what it needs.

## Your data

Everything is stored as JSON files in `data/`:

- `data/questions/<topic>.json`: the question bank
- `data/progress/<topic>.json`: answers, streaks, level and subtopic confidence
- `data/assignments/<id>.json`: the brief, rubric, key concepts, outline and drafts with feedback

These files are git-ignored, so they stay on your Mac. To back them up, copy the `data` folder.

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
engine/web.py           browser version (Python's built-in web server, no Flask)
web/index.html          browser page (no external files, works offline)
scripts/                llama.cpp setup and start scripts
tests/                  unit tests and a fake model server
```

Run the tests with `python -m unittest discover -s tests -t .`.
To try the app without a model, run `python tests/fake_llm_server.py` in one window. It pretends to be llama-server on port 8080 and returns canned questions.

Local models get extra protection against broken output. Questions are requested one at a time with a JSON schema, which llama-server enforces as a grammar. Replies are then parsed tolerantly (code fences, extra chatter and trailing commas are handled), validated, and retried up to twice with a correction prompt.
