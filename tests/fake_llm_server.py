"""A fake llama-server for testing without a real model.

    python tests/fake_llm_server.py      # listens on localhost:8080

Returns canned questions (sometimes wrapped in chatter, like a small model
would) and streams short explanations.
"""
import itertools
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

counter = itertools.count(1)


def question(n):
    q = {"question": "Fake question number {} about signal flow?".format(n),
         "choices": ["Mic to preamp", "Amp to mic", "Speaker to desk", "Fader to cable"],
         "answer_index": 0, "explanation": "Signal flows from the mic into the preamp."}
    text = json.dumps(q)
    return "Sure! Here it is:\n```json\n" + text + "\n```" if n % 3 == 0 else text


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        prompt = body["messages"][-1]["content"]
        if "key concepts" in prompt:
            content = json.dumps({"concepts": [{"name": "Gain staging", "why": "Brief asks for it"},
                                               {"name": "Feedback control", "why": "Stage monitors"}]})
        elif "multiple-choice" in prompt or "valid" in prompt:
            n = next(counter)
            content = "not json at all" if n % 7 == 0 else question(n)
        else:
            content = "**Core idea:** this is a streamed explanation.\n- point one\n- point two"
        if body.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for i in range(0, len(content), 8):
                chunk = {"choices": [{"delta": {"content": content[i:i + 8]}}]}
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            return
        out = json.dumps({"choices": [{"message": {"role": "assistant", "content": content}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
