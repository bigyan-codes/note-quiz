import { loadModel, LLAMA_3_2_1B_INST_Q4_0, completion, unloadModel } from '@qvac/sdk';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { buildQuizPrompt, parseQuiz, buildGradePrompt, parseGrade } from './prompts.js';

const MODEL = LLAMA_3_2_1B_INST_Q4_0;
const MAX_NOTES_WORDS = 800;

async function getNotes() {
  const filePath = process.argv[2];
  if (filePath) {
    try {
      return readFileSync(filePath, 'utf8').trim();
    } catch {
      console.error(`Could not read file: ${filePath}`);
      process.exit(1);
    }
  }
  console.log('Paste your notes below, then press Ctrl+D when finished:\n');
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString().trim();
}

function prepareNotes(raw) {
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length < 20) {
    console.error('Notes are too short - paste at least ~20 words.');
    process.exit(1);
  }
  if (words.length > MAX_NOTES_WORDS) {
    console.warn(`Notes truncated to ${MAX_NOTES_WORDS} words to fit the model context.`);
    return words.slice(0, MAX_NOTES_WORDS).join(' ');
  }
  return raw;
}

async function ask(modelId, prompt) {
  const result = completion({
    modelId,
    history: [{ role: 'user', content: prompt }],
    stream: true,
  });
  let text = '';
  for await (const token of result.tokenStream) text += token;
  return text;
}

function makeReader() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

function askQuestion(rl, query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  const notes = prepareNotes(await getNotes());

  console.log('\nLoading model (first run downloads it, this may take a while)...');
  const modelId = await loadModel({
    modelSrc: MODEL,
    onProgress: (p) =>
      process.stderr.write(`\rDownloading ${(p.percentage ?? 0).toFixed(0)}%`),
  });
  console.log('\nModel loaded.\n');

  console.log('Generating quiz...\n');
  const quizRaw = await ask(modelId, buildQuizPrompt(notes));
  let questions = parseQuiz(quizRaw);

  if (questions.length < 5) {
    console.warn(`Only ${questions.length} questions parsed - retrying...`);
    const retryRaw = await ask(modelId, buildQuizPrompt(notes));
    const retryQuestions = parseQuiz(retryRaw);
    if (retryQuestions.length > questions.length) questions = retryQuestions;
  }

  if (questions.length === 0) {
    console.error('No questions could be generated. Try shorter or clearer notes.');
    await unloadModel({ modelId });
    process.exit(1);
  }

  const results = [];
  const rl = makeReader();

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    console.log(`\nQ${i + 1}. ${q}`);
    const answer = await askQuestion(rl, 'Your answer: ');
    console.log('Grading...');

    const gradeRaw = await ask(modelId, buildGradePrompt(notes, q, answer));
    const { verdict, reason } = parseGrade(gradeRaw);
    results.push({ question: q, answer, verdict, reason });
    console.log(`  -> ${verdict}\n  ${reason}`);
  }

  rl.close();

  const correct = results.filter((r) => r.verdict === 'CORRECT').length;
  const partial = results.filter((r) => r.verdict === 'PARTIALLY CORRECT').length;
  console.log('\n========== SCORECARD ==========');
  console.log(`Correct: ${correct}  |  Partially correct: ${partial}  |  Total: ${results.length}`);
  const missed = results.filter((r) => r.verdict === 'INCORRECT');
  if (missed.length) {
    console.log('\nMissed questions:');
    missed.forEach((r, i) => console.log(`  ${i + 1}. ${r.question}`));
  }
  console.log('===============================\n');

  await unloadModel({ modelId });
  console.log('Model unloaded. Done.');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
