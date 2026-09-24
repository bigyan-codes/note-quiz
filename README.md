# NoteQuiz

Turns your own study notes into a graded quiz, fully offline.

## QVAC functions used
- `loadModel`
- `completion` (called twice: quiz generation + answer grading)
- `unloadModel`

## SDK version
`@qvac/sdk` 0.19.x

## Requirements
- Node.js >= 22.17
- npm >= 10.9

## Install
    npm install

## Run — Web UI (recommended for demo)
    node server.js

Then open http://localhost:3000 in your browser. Paste your notes,
click Generate Quiz, answer the questions, and click Submit Answers.

## Run — CLI
    node index.js sample-notes.txt

Or run with no argument and paste notes into the terminal (Ctrl+D to finish).

**Note:** The first run downloads the model file via the SDK. That is a one-time
SDK download — inference itself runs 100% on-device.

## Privacy
All inference runs on-device. Your notes and answers never leave your machine.
