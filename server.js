import { loadModel, LLAMA_3_2_1B_INST_Q4_0, completion, unloadModel } from '@qvac/sdk';
import { createServer } from 'node:http';
import { buildQuizPrompt, parseQuiz, buildGradePrompt, parseGrade } from './prompts.js';

const MODEL = LLAMA_3_2_1B_INST_Q4_0;
const PORT = 3000;
const MAX_NOTES_WORDS = 800;

let modelId = null;
let modelReady = false;
let modelError = null;

async function ask(prompt) {
  const result = completion({
    modelId,
    history: [{ role: 'user', content: prompt }],
    stream: true,
  });
  let text = '';
  for await (const token of result.tokenStream) text += token;
  return text;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>NoteQuiz</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; background: #f7f7f8; color: #222; line-height: 1.5; }
  h1 { margin-bottom: 4px; }
  .sub { color: #666; margin-top: 0; }
  textarea { width: 100%; height: 140px; padding: 10px; font-size: 14px; border: 1px solid #ccc; border-radius: 6px; resize: vertical; box-sizing: border-box; }
  button { background: #111; color: #fff; border: 0; padding: 10px 18px; border-radius: 6px; font-size: 14px; cursor: pointer; margin-top: 10px; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .card { background: #fff; padding: 16px 20px; border-radius: 8px; margin-top: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .q { font-weight: 600; margin-bottom: 8px; }
  input[type="text"] { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
  .verdict { font-weight: 700; margin-top: 8px; }
  .CORRECT { color: #15803d; }
  .PARTIALLY { color: #b45309; }
  .INCORRECT { color: #b91c1c; }
  .reason { color: #555; font-size: 14px; }
  .score { font-size: 18px; font-weight: 700; }
  .status { color: #666; font-size: 14px; margin-top: 12px; }
  .error { color: #b91c1c; }
</style>
</head>
<body>
<h1>NoteQuiz</h1>
<p class="sub">Paste your study notes. Get a quiz. All on-device.</p>

<div id="notes-stage">
  <textarea id="notes" placeholder="Paste your notes here (at least ~20 words)..."></textarea>
  <button id="gen-btn">Generate Quiz</button>
</div>

<div id="status" class="status"></div>
<div id="quiz-stage"></div>
<div id="score-stage"></div>

<script>
const notesEl = document.getElementById('notes');
const genBtn = document.getElementById('gen-btn');
const statusEl = document.getElementById('status');
const quizStage = document.getElementById('quiz-stage');
const scoreStage = document.getElementById('score-stage');

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Request failed');
  return res.json();
}

genBtn.addEventListener('click', async () => {
  const notes = notesEl.value.trim();
  if (notes.split(/\\s+/).filter(Boolean).length < 20) {
    statusEl.textContent = 'Notes are too short — paste at least ~20 words.';
    statusEl.className = 'status error';
    return;
  }
  genBtn.disabled = true;
  statusEl.textContent = 'Waiting for model... (first run downloads it)';
  statusEl.className = 'status';
  quizStage.innerHTML = '';
  scoreStage.innerHTML = '';

  try {
    const { questions } = await api('/api/quiz', { notes });
    statusEl.textContent = 'Answer each question below.';
    const answers = [];
    questions.forEach((q, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = '<div class="q">Q' + (i + 1) + '. ' + q + '</div>';
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Your answer...';
      input.dataset.index = i;
      card.appendChild(input);
      quizStage.appendChild(card);
      answers.push(input);
    });

    const submit = document.createElement('button');
    submit.textContent = 'Submit Answers';
    submit.id = 'submit-btn';
    quizStage.appendChild(submit);

    submit.addEventListener('click', async () => {
      submit.disabled = true;
      statusEl.textContent = 'Grading...';
      const results = [];
      for (let i = 0; i < questions.length; i++) {
        const answer = answers[i].value.trim();
        try {
          const grade = await api('/api/grade', { notes, question: questions[i], answer });
          results.push({ ...grade, question: questions[i] });
        } catch (e) {
          results.push({ verdict: 'UNKNOWN', reason: e.message, question: questions[i] });
        }
      }
      statusEl.textContent = '';
      renderScore(results);
    });
  } catch (e) {
    statusEl.textContent = e.message;
    statusEl.className = 'status error';
  } finally {
    genBtn.disabled = false;
  }
});

function renderScore(results) {
  const correct = results.filter(r => r.verdict === 'CORRECT').length;
  const partial = results.filter(r => r.verdict === 'PARTIALLY CORRECT').length;
  scoreStage.innerHTML = '';

  const summary = document.createElement('div');
  summary.className = 'card';
  summary.innerHTML = '<div class="score">Score: ' + correct + ' correct, ' + partial + ' partially correct, out of ' + results.length + '</div>';
  scoreStage.appendChild(summary);

  results.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    const verdictClass = r.verdict.split(' ')[0];
    card.innerHTML =
      '<div class="q">Q' + (i + 1) + '. ' + r.question + '</div>' +
      '<div class="verdict ' + verdictClass + '">' + r.verdict + '</div>' +
      '<div class="reason">' + (r.reason || '') + '</div>';
    scoreStage.appendChild(card);
  });
}
</script>
</body>
</html>`;

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
    return;
  }

  if (req.method === 'GET' && req.url === '/api/status') {
    return json(res, 200, { ready: modelReady, error: modelError });
  }

  if (req.method === 'POST' && req.url === '/api/quiz') {
    if (!modelReady) return json(res, 503, { error: 'Model is still loading. Please wait.' });
    try {
      const { notes } = await readBody(req);
      const raw = await ask(buildQuizPrompt(notes));
      let questions = parseQuiz(raw);
      if (questions.length < 5) {
        const retry = await ask(buildQuizPrompt(notes));
        const retryQuestions = parseQuiz(retry);
        if (retryQuestions.length > questions.length) questions = retryQuestions;
      }
      if (questions.length === 0) return json(res, 500, { error: 'No questions could be generated.' });
      return json(res, 200, { questions });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  if (req.method === 'POST' && req.url === '/api/grade') {
    if (!modelReady) return json(res, 503, { error: 'Model is still loading. Please wait.' });
    try {
      const { notes, question, answer } = await readBody(req);
      const raw = await ask(buildGradePrompt(notes, question, answer));
      const { verdict, reason } = parseGrade(raw);
      return json(res, 200, { verdict, reason });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, async () => {
  console.log(`NoteQuiz server running at http://localhost:${PORT}`);
  console.log('Loading model (first run downloads it)...');
  try {
    modelId = await loadModel({
      modelSrc: MODEL,
      onProgress: (p) =>
        process.stderr.write(`\\rDownloading ${(p.percentage ?? 0).toFixed(0)}%`),
    });
    modelReady = true;
    console.log('\\nModel loaded. Open http://localhost:' + PORT + ' in your browser.');
  } catch (e) {
    modelError = e.message;
    console.error('Failed to load model:', e);
  }
});

process.on('SIGINT', async () => {
  console.log('\\nShutting down...');
  if (modelId) await unloadModel({ modelId });
  process.exit(0);
});
