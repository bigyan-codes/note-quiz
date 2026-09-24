export function buildQuizPrompt(notes) {
  return `You are a quiz generator. Read the NOTES and write exactly 5 short-answer
questions that test understanding of the notes.
Rules:
- Output ONLY the questions, one per line, numbered 1. to 5.
- No answers, no headings, no commentary.
- Each question must be answerable in 1-2 sentences using only the notes.

NOTES:
"""
${notes}
"""`;
}

export function parseQuiz(raw) {
  const lines = raw.split('\n');
  const questions = [];
  for (const line of lines) {
    const match = line.match(/^\s*\d+[.)]\s*(.+)/);
    if (match) questions.push(match[1].trim());
  }
  return questions.slice(0, 5);
}

export function buildGradePrompt(notes, question, answer) {
  return `You are a strict but fair quiz grader. Decide whether the STUDENT ANSWER is
correct based only on the NOTES.
Reply in exactly this format:
VERDICT: CORRECT | PARTIALLY CORRECT | INCORRECT
REASON: one or two sentences

NOTES:
"""
${notes}
"""
QUESTION: ${question}
STUDENT ANSWER: ${answer}`;
}

export function parseGrade(raw) {
  const verdictMatch = raw.match(/VERDICT:\s*(CORRECT|PARTIALLY CORRECT|INCORRECT)/i);
  const reasonMatch = raw.match(/REASON:\s*([\s\S]+)/i);
  return {
    verdict: verdictMatch ? verdictMatch[1].toUpperCase() : 'UNKNOWN',
    reason: reasonMatch ? reasonMatch[1].trim() : raw.trim(),
  };
}
