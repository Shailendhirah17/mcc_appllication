const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const cors = require('cors');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for PDF in-memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// Helper: Get local network IP for mobile phone join
function getLocalNetworkIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// In-Memory Game Store
const games = new Map();
// Temporary cache of parsed question sets by sessionId
const questionSets = new Map();

// --- Built-in Smart Extractor & Heuristic MCQ Generator ---
function extractPreformattedMCQs(text) {
  const questions = [];

  // 1. Check if there is an Answer Key section at the end or within the document
  const answerKeyMap = new Map();
  const answerKeySectionMatch = text.match(/(?:^|\n)\s*(?:Answers|Answer\s*Key|Solutions)\s*[:\-\n]([\s\S]+)$/i);
  if (answerKeySectionMatch) {
    const keyText = answerKeySectionMatch[1];
    // Find patterns like "1. A", "1) B", "1-C", "1: D", "Q1: A", "1 A"
    const keyPairs = keyText.matchAll(/(?:Q(?:uestion)?\.?\s*)?(\d+)[\.\)\:\-\s]+\(?([A-Da-d])\)?/g);
    for (const kp of keyPairs) {
      const qNum = parseInt(kp[1], 10);
      const letter = kp[2].toUpperCase();
      const idx = ['A', 'B', 'C', 'D'].indexOf(letter);
      if (idx !== -1) {
        answerKeyMap.set(qNum, idx);
      }
    }
  }

  // 2. Split into Question Blocks (e.g. "1. ", "Q1. ", "Question 1:", etc.)
  const qBlocks = text.split(/(?=(?:^|\n)\s*(?:Q(?:uestion)?\.?\s*\d+|\d+[\.\)]\s+))/i);

  for (const block of qBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Detect question number
    const qNumMatch = trimmed.match(/^(?:Q(?:uestion)?\.?\s*)?(\d+)[\.\)\:\s]/i);
    const qNum = qNumMatch ? parseInt(qNumMatch[1], 10) : null;

    // Marker-based option parser (supports both same-line and multiline, plus parentheses inside option text like O(1) or blur())
    const markerRegex = /(?:^|[\s\t\n]+)(?:\(([A-Da-d])\)|([A-Da-d])[\.\)]|\[([A-Da-d])\])\s+/g;
    const markers = [];
    let match;
    while ((match = markerRegex.exec(trimmed)) !== null) {
      const letter = (match[1] || match[2] || match[3]).toUpperCase();
      markers.push({
        letter,
        index: match.index + (match[0].length - match[0].trimStart().length),
        endIndex: match.index + match[0].length
      });
    }

    const posA = markers.find(m => m.letter === 'A');
    const posB = markers.find(m => m.letter === 'B' && (!posA || m.index > posA.index));
    const posC = markers.find(m => m.letter === 'C' && (!posB || m.index > posB.index));
    const posD = markers.find(m => m.letter === 'D' && (!posC || m.index > posC.index));

    if (posA && posB && posC && posD) {
      let qText = trimmed.substring(0, posA.index)
        .replace(/^(?:Q(?:uestion)?\.?\s*)?\d+[\.\)\:\s]*/i, '')
        .replace(/\n+/g, ' ')
        .trim();

      let optA = trimmed.substring(posA.endIndex, posB.index).replace(/\n+/g, ' ').trim();
      let optB = trimmed.substring(posB.endIndex, posC.index).replace(/\n+/g, ' ').trim();
      let optC = trimmed.substring(posC.endIndex, posD.index).replace(/\n+/g, ' ').trim();
      let remaining = trimmed.substring(posD.endIndex).trim();

      // Check if remainder has inline answer/note
      const ansSplit = remaining.search(/(?:^|[\s\n])(?:Answer|Ans|Correct(?:\s*Option)?|Key)\s*[:\-\s]/i);
      let optD = ansSplit !== -1 ? remaining.substring(0, ansSplit).replace(/\n+/g, ' ').trim() : remaining.split('\n')[0].trim();

      // Clean trailing answer artifacts if any
      const cleanOpt = (s) => s.replace(/(?:Answer|Ans|Correct|Key|Note)\s*[:\-\s][\s\S]*$/i, '').trim();
      const options = [cleanOpt(optA), cleanOpt(optB), cleanOpt(optC), cleanOpt(optD)];

      // Find answer
      let answerIndex = 0;
      let explanation = '';

      const inlineAnsMatch = trimmed.match(/(?:Answer|Ans|Correct(?:\s*Option)?|Key)\s*[:\-\s]\s*\(?([A-Da-d])\)?/i);
      if (inlineAnsMatch) {
        const letter = inlineAnsMatch[1].toUpperCase();
        answerIndex = ['A', 'B', 'C', 'D'].indexOf(letter);
        if (answerIndex === -1) answerIndex = 0;
      } else if (qNum && answerKeyMap.has(qNum)) {
        answerIndex = answerKeyMap.get(qNum);
      }

      // Check note / explanation
      const noteMatch = trimmed.match(/(?:Note|Explanation|Reason)\s*[:\-\s]\s*([^\n\r]+)/i);
      if (noteMatch) {
        explanation = noteMatch[1].trim();
      } else {
        explanation = `Correct answer is option ${['A', 'B', 'C', 'D'][answerIndex]}: ${options[answerIndex]}`;
      }

      questions.push({
        question: qText || `Question ${questions.length + 1}`,
        options,
        answerIndex,
        explanation
      });
    }
  }

  return questions;
}

// Fallback intelligent NLP concept question generator from document text
function generateHeuristicMCQs(text, count = 15) {
  const cleanText = text.replace(/\r/g, '').replace(/\t/g, ' ');
  const rawSentences = cleanText.split(/(?<=[.?!])\s+/);
  
  // Filter for informative, substantive sentences
  const sentences = rawSentences
    .map(s => s.trim())
    .filter(s => s.length > 35 && s.length < 220 && !s.startsWith('http') && !s.includes('©') && !s.includes('Page '));

  // Extract key terms/definitions
  const questions = [];
  const extractedTerms = [];

  // Identify definition-like sentences (e.g., "X is defined as...", "X refers to...", "X is a...")
  for (const s of sentences) {
    const isDef = s.match(/^([A-Z][A-Za-z0-9\s\-]{2,30})\s+(?:is|are|refers to|means|represents|was|were)\s+([a-z].+)/i);
    if (isDef && isDef[1].length < 35) {
      extractedTerms.push({
        term: isDef[1].trim(),
        definition: isDef[2].trim().replace(/[.;,]$/, '')
      });
    }
  }

  // Generate questions from definitions
  for (const item of extractedTerms) {
    if (questions.length >= count) break;
    // Question: "Which of the following refers to [definition]?" or "What is [term]?"
    const question = `What does "${item.term}" refer to or describe?`;
    const correctOpt = item.definition.charAt(0).toUpperCase() + item.definition.slice(1);
    
    // Pick 3 distractors from other definitions or sentences
    const otherDefs = extractedTerms
      .filter(t => t.term !== item.term)
      .map(t => t.definition.charAt(0).toUpperCase() + t.definition.slice(1));
    
    const distractors = [
      otherDefs[0] || 'The inverse property of the primary subject matter',
      otherDefs[1] || 'An auxiliary mechanism used exclusively for backup routines',
      otherDefs[2] || 'A secondary attribute that operates independently of the core state'
    ];

    const options = [correctOpt, ...distractors.slice(0, 3)];
    // Shuffle options while tracking correct index
    const correctVal = options[0];
    const shuffled = [...options].sort(() => Math.random() - 0.5);
    const answerIndex = shuffled.indexOf(correctVal);

    questions.push({
      question,
      options: shuffled,
      answerIndex,
      explanation: `${item.term}: ${item.definition}`
    });
  }

  // If still need more questions, use key sentence cloze/comprehension
  for (let i = 0; i < sentences.length && questions.length < count; i++) {
    const sentence = sentences[i];
    // Find capitalized noun or important phrase
    const words = sentence.split(/\s+/);
    if (words.length < 7) continue;

    // Pick a prominent word or phrase to blank out
    const candidates = words.filter(w => w.length > 5 && /^[A-Za-z]+$/.test(w));
    if (candidates.length === 0) continue;
    const targetWord = candidates[Math.floor(candidates.length / 2)];
    
    const clozeQuestion = sentence.replace(new RegExp(`\\b${targetWord}\\b`, 'i'), '__________');
    const correctOpt = targetWord;

    const commonDistractors = ['Mechanism', 'Protocol', 'Variable', 'Function', 'Process', 'Component', 'Strategy', 'Framework']
      .filter(w => w.toLowerCase() !== targetWord.toLowerCase());

    const options = [
      correctOpt,
      commonDistractors[0] || 'Parameter',
      commonDistractors[1] || 'Operation',
      commonDistractors[2] || 'Element'
    ];

    const shuffled = [...options].sort(() => Math.random() - 0.5);
    const answerIndex = shuffled.indexOf(correctOpt);

    questions.push({
      question: `Fill in the blank: "${clozeQuestion}"`,
      options: shuffled,
      answerIndex,
      explanation: `The correct word is "${targetWord}". Context: "${sentence}"`
    });
  }

  // Ensure minimum count of 10 questions with engaging fallback items if text was very short
  while (questions.length < 10) {
    const idx = questions.length + 1;
    questions.push({
      question: `Sample Knowledge Question ${idx}: Which property is essential for real-time multiplayer systems?`,
      options: ['Low latency synchronization', 'Manual batch refreshes', 'Sequential disk seek', 'Single-threaded blocking IO'],
      answerIndex: 0,
      explanation: 'Low latency synchronization enables instantaneous updates across all participants.'
    });
  }

  return questions;
}

// Call Google Gemini API to generate structured MCQs
async function generateGeminiMCQs(text, apiKey, requestedCount = 15) {
  const prompt = `You are an expert quizmaster and educator.
Read the following text excerpt from a document and generate exactly ${requestedCount} engaging, educational Multiple Choice Questions (MCQs).
Rules:
1. Each question must have exactly 4 plausible options.
2. Only one option must be unequivocally correct.
3. answerIndex must be an integer from 0 to 3 indicating the zero-based index of the correct option.
4. Keep questions concise and suitable for a fast-paced Kahoot-style quiz.
5. Provide a brief explanation for the correct answer.

Return ONLY a valid JSON array of objects with the following schema:
[
  {
    "question": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "answerIndex": 0,
    "explanation": "Brief explanation why this option is correct."
  }
]

Document Text:
"""
${text.slice(0, 15000)}
"""`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.3
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const rawOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawOutput) {
    throw new Error('No output returned from Gemini API');
  }

  const parsed = JSON.parse(rawOutput);
  if (!Array.isArray(parsed)) {
    throw new Error('Gemini did not return an array of questions');
  }

  return parsed.map((q, idx) => ({
    question: q.question || `Question ${idx + 1}`,
    options: Array.isArray(q.options) && q.options.length === 4 ? q.options : ['Option A', 'Option B', 'Option C', 'Option D'],
    answerIndex: typeof q.answerIndex === 'number' && q.answerIndex >= 0 && q.answerIndex <= 3 ? q.answerIndex : 0,
    explanation: q.explanation || ''
  }));
}

// --- REST API Endpoints ---

// Network Info endpoint
app.get('/api/network-info', (req, res) => {
  const localIp = getLocalNetworkIp();
  res.json({
    localIp,
    port: PORT,
    joinUrl: `http://${localIp}:${PORT}/join.html`
  });
});

// Dedicated 100-Question Exam Bank Loader
app.get('/api/sample-100', async (req, res) => {
  try {
    const fs = require('fs');
    const pdfPath = path.join(__dirname, 'sample_data', 'sample_100_quiz.pdf');
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: 'Sample 100-question PDF not found.' });
    }
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfData = await pdfParse(pdfBuffer);
    const extracted = extractPreformattedMCQs(pdfData.text);

    const liveQuestions = extracted.slice(0, 10);
    const remainingQuestions = extracted.slice(10);

    const sessionId = 'session_100_' + Date.now();
    questionSets.set(sessionId, {
      allQuestions: extracted,
      liveQuestions,
      remainingQuestions,
      createdAt: Date.now()
    });

    res.json({
      success: true,
      sessionId,
      methodUsed: 'preformatted_extracted',
      totalGenerated: extracted.length,
      liveCount: liveQuestions.length,
      remainingCount: remainingQuestions.length,
      liveQuestions,
      remainingQuestions
    });
  } catch (err) {
    console.error('Error loading sample 100:', err);
    res.status(500).json({ error: err.message });
  }
});

// PDF Upload & MCQ Generation
app.post('/api/upload-pdf', upload.single('pdf'), async (req, res) => {
  try {
    let extractedText = '';

    if (req.file) {
      const pdfData = await pdfParse(req.file.buffer);
      extractedText = pdfData.text || '';
    } else if (req.body.text) {
      extractedText = req.body.text;
    } else {
      return res.status(400).json({ error: 'Please upload a PDF file or provide text content.' });
    }

    if (!extractedText.trim()) {
      return res.status(400).json({ error: 'No readable text could be extracted from the document.' });
    }

    const apiKey = req.headers['x-gemini-key'] || req.body.apiKey || process.env.GEMINI_API_KEY;
    const requestedCount = req.body.count === 'all' ? 999999 : parseInt(req.body.count || '100', 10);

    let allQuestions = [];
    let methodUsed = 'heuristic';

    if (apiKey && apiKey.trim()) {
      try {
        allQuestions = await generateGeminiMCQs(extractedText, apiKey.trim(), Math.min(requestedCount, 100));
        methodUsed = 'gemini';
      } catch (geminiErr) {
        console.warn('Gemini API call failed, falling back to smart heuristic extractor:', geminiErr.message);
      }
    }

    if (allQuestions.length === 0) {
      // Check for preformatted MCQs first
      const preformatted = extractPreformattedMCQs(extractedText);
      if (preformatted.length >= 5) {
        allQuestions = preformatted;
        methodUsed = 'preformatted_extracted';
      } else {
        allQuestions = generateHeuristicMCQs(extractedText, Math.min(requestedCount, 100));
        methodUsed = 'smart_heuristic';
      }
    }

    if (allQuestions.length > requestedCount) {
      allQuestions = allQuestions.slice(0, requestedCount);
    }

    // Partition: First 10 are designated for the live quiz, remaining are for download
    const liveQuestions = allQuestions.slice(0, 10);
    const remainingQuestions = allQuestions.slice(10);

    const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    questionSets.set(sessionId, {
      allQuestions,
      liveQuestions,
      remainingQuestions,
      createdAt: Date.now()
    });

    res.json({
      success: true,
      sessionId,
      methodUsed,
      totalGenerated: allQuestions.length,
      liveCount: liveQuestions.length,
      remainingCount: remainingQuestions.length,
      liveQuestions,
      remainingQuestions
    });
  } catch (error) {
    console.error('Error processing PDF:', error);
    res.status(500).json({ error: 'Failed to process PDF: ' + error.message });
  }
});

// Download endpoint for Remaining or All MCQs
app.get('/api/download-questions', (req, res) => {
  const { sessionId, type = 'remaining', format = 'json' } = req.query;
  const set = questionSets.get(sessionId);

  if (!set) {
    return res.status(404).json({ error: 'Quiz session expired or not found.' });
  }

  const questionsToExport = type === 'all' ? set.allQuestions : (set.remainingQuestions.length > 0 ? set.remainingQuestions : set.allQuestions);
  const filename = `mcq_${type}_questions_${Date.now()}`;

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    return res.send(JSON.stringify(questionsToExport, null, 2));
  }

  if (format === 'csv') {
    const csvRows = [
      ['Question Number', 'Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer', 'Explanation']
    ];

    questionsToExport.forEach((q, idx) => {
      csvRows.push([
        idx + 1,
        `"${(q.question || '').replace(/"/g, '""')}"`,
        `"${(q.options[0] || '').replace(/"/g, '""')}"`,
        `"${(q.options[1] || '').replace(/"/g, '""')}"`,
        `"${(q.options[2] || '').replace(/"/g, '""')}"`,
        `"${(q.options[3] || '').replace(/"/g, '""')}"`,
        ['A', 'B', 'C', 'D'][q.answerIndex] || 'A',
        `"${(q.explanation || '').replace(/"/g, '""')}"`
      ]);
    });

    const csvContent = csvRows.map(r => r.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(csvContent);
  }

  // Format as Printable Text / Study Sheet
  let txt = `========================================================\n`;
  txt += `MCQ EXAM QUESTION BANK (${type.toUpperCase()} - ${questionsToExport.length} Questions)\n`;
  txt += `Generated on ${new Date().toLocaleString()}\n`;
  txt += `========================================================\n\n`;

  questionsToExport.forEach((q, idx) => {
    txt += `Q${idx + 1}. ${q.question}\n`;
    txt += `   [A] ${q.options[0]}\n`;
    txt += `   [B] ${q.options[1]}\n`;
    txt += `   [C] ${q.options[2]}\n`;
    txt += `   [D] ${q.options[3]}\n`;
    txt += `   --> Correct Answer: [${['A', 'B', 'C', 'D'][q.answerIndex]}] ${q.options[q.answerIndex]}\n`;
    if (q.explanation) {
      txt += `   --> Note: ${q.explanation}\n`;
    }
    txt += `\n`;
  });

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.txt"`);
  res.send(txt);
});

// --- Socket.IO Real-Time Kahoot Engine ---

function generatePin() {
  let pin;
  do {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
  } while (games.has(pin));
  return pin;
}

io.on('connection', (socket) => {
  // Host creates a game session with the loaded 10 questions
  socket.on('host:create_game', ({ questions, timePerQuestion = 20 }) => {
    const pin = generatePin();
    // Ensure strictly max 10 questions for live game
    const liveQuestions = questions.slice(0, 10);

    const game = {
      pin,
      hostSocketId: socket.id,
      state: 'LOBBY', // LOBBY, COUNTDOWN, QUESTION, LEADERBOARD, FINAL
      questions: liveQuestions,
      currentQuestionIndex: -1,
      timePerQuestion: Math.max(5, Math.min(120, timePerQuestion)),
      currentTimeLeft: timePerQuestion,
      timerInterval: null,
      players: new Map(), // socketId -> { id, nickname, avatar, score, streak, lastPointsEarned }
      currentAnswers: new Map() // socketId -> { optionIndex, timeElapsed }
    };

    games.set(pin, game);
    socket.join(pin);
    socket.gamePin = pin;
    socket.isHost = true;

    socket.emit('host:game_created', {
      pin,
      totalQuestions: liveQuestions.length,
      timePerQuestion: game.timePerQuestion
    });
  });

  // Student joins from phone
  socket.on('player:join', ({ pin, nickname, avatar = '🚀' }) => {
    const trimmedPin = (pin || '').toString().trim();
    const game = games.get(trimmedPin);

    if (!game) {
      return socket.emit('player:join_error', { message: 'Game PIN not found. Please check and try again.' });
    }

    if (game.state !== 'LOBBY') {
      return socket.emit('player:join_error', { message: 'This game has already started.' });
    }

    const cleanNickname = (nickname || '').trim().slice(0, 20) || `Player_${Math.floor(Math.random() * 900 + 100)}`;
    
    // Check duplicate name
    for (const player of game.players.values()) {
      if (player.nickname.toLowerCase() === cleanNickname.toLowerCase()) {
        return socket.emit('player:join_error', { message: 'This nickname is already taken in this room.' });
      }
    }

    const player = {
      id: socket.id,
      nickname: cleanNickname,
      avatar,
      score: 0,
      streak: 0,
      lastPointsEarned: 0,
      history: [] // record of results per question
    };

    game.players.set(socket.id, player);
    socket.join(trimmedPin);
    socket.gamePin = trimmedPin;
    socket.isHost = false;

    // Confirm to player
    socket.emit('player:join_success', {
      pin: trimmedPin,
      player
    });

    // Notify host of updated roster
    const playerList = Array.from(game.players.values()).map(p => ({
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar
    }));

    io.to(game.hostSocketId).emit('host:player_joined', {
      players: playerList,
      totalPlayers: playerList.length
    });
  });

  // Host starts the game
  socket.on('host:start_game', () => {
    const game = games.get(socket.gamePin);
    if (!game || !socket.isHost) return;

    if (game.players.size === 0) {
      return socket.emit('host:alert', { message: 'Need at least 1 student to join before starting!' });
    }

    // Trigger 3-second get ready countdown
    game.state = 'COUNTDOWN';
    io.to(game.pin).emit('game:get_ready', { count: 3 });

    setTimeout(() => {
      startNextQuestion(game);
    }, 3200);
  });

  // Host triggers next question or scoreboard
  socket.on('host:next', () => {
    const game = games.get(socket.gamePin);
    if (!game || !socket.isHost) return;

    if (game.state === 'QUESTION') {
      // Force finish question early
      finishQuestion(game);
    } else if (game.state === 'LEADERBOARD') {
      if (game.currentQuestionIndex + 1 < game.questions.length) {
        startNextQuestion(game);
      } else {
        showFinalPodium(game);
      }
    }
  });

  // Student submits an answer
  socket.on('player:submit_answer', ({ optionIndex }) => {
    const game = games.get(socket.gamePin);
    if (!game || game.state !== 'QUESTION') return;

    const player = game.players.get(socket.id);
    if (!player) return;

    // Reject if already answered this question
    if (game.currentAnswers.has(socket.id)) return;

    const timeElapsed = game.timePerQuestion - game.currentTimeLeft;
    game.currentAnswers.set(socket.id, {
      optionIndex: parseInt(optionIndex, 10),
      timeElapsed
    });

    // Acknowledge to player
    socket.emit('player:answer_recorded', {
      optionIndex
    });

    // Notify host of live response count
    const totalAnswered = game.currentAnswers.size;
    const totalPlayers = game.players.size;

    io.to(game.hostSocketId).emit('host:answer_count_update', {
      totalAnswered,
      totalPlayers,
      allAnswered: totalAnswered >= totalPlayers
    });

    // NOTE: Answers and results are ONLY revealed when:
    // 1) The timer expires naturally (currentTimeLeft <= 0), OR
    // 2) The host clicks the "Skip Timer / Reveal" button.
    // Early finish is NOT triggered automatically, keeping players in anticipation.
  });

  // Host Reconnects after page refresh
  socket.on('host:reconnect', ({ pin, sessionId }) => {
    const game = games.get(pin);
    if (game) {
      game.hostSocketId = socket.id;
      socket.join(pin);
      socket.gamePin = pin;
      socket.isHost = true;

      const currentQ = (game.currentQuestionIndex >= 0 && game.currentQuestionIndex < game.questions.length)
        ? game.questions[game.currentQuestionIndex]
        : null;

      socket.emit('host:restore_state', {
        pin: game.pin,
        state: game.state,
        totalQuestions: game.questions.length,
        currentQuestionIndex: game.currentQuestionIndex,
        currentTimeLeft: Math.max(0, game.currentTimeLeft),
        timePerQuestion: game.timePerQuestion,
        question: currentQ ? currentQ.question : '',
        options: currentQ ? currentQ.options : [],
        players: Array.from(game.players.values()).map(p => ({
          id: p.id,
          nickname: p.nickname,
          avatar: p.avatar,
          score: p.score,
          streak: p.streak
        })),
        totalPlayers: game.players.size,
        totalAnswered: game.currentAnswers.size,
        allAnswered: game.currentAnswers.size >= game.players.size,
        lastResult: game.lastQuestionResult || null,
        finalResults: game.lastFinalResults || null
      });
    } else if (sessionId && questionSets.has(sessionId)) {
      socket.emit('host:restore_review', questionSets.get(sessionId));
    } else {
      socket.emit('host:session_expired');
    }
  });

  // Student Reconnects after page refresh on phone
  socket.on('player:reconnect', ({ pin, nickname }) => {
    const trimmedPin = (pin || '').toString().trim();
    const game = games.get(trimmedPin);
    if (!game) {
      return socket.emit('player:session_expired', { message: 'Game session not found or ended.' });
    }

    // Find player by nickname
    let player = null;
    let oldSocketId = null;
    for (const [sId, p] of game.players.entries()) {
      if (p.nickname.toLowerCase() === (nickname || '').toLowerCase()) {
        player = p;
        oldSocketId = sId;
        break;
      }
    }

    if (!player) {
      return socket.emit('player:session_expired', { message: 'Player record not found.' });
    }

    // Update socket mapping
    game.players.delete(oldSocketId);
    player.id = socket.id;
    game.players.set(socket.id, player);

    if (game.currentAnswers.has(oldSocketId)) {
      const ans = game.currentAnswers.get(oldSocketId);
      game.currentAnswers.delete(oldSocketId);
      game.currentAnswers.set(socket.id, ans);
    }

    socket.join(trimmedPin);
    socket.gamePin = trimmedPin;
    socket.isHost = false;

    const currentQ = (game.currentQuestionIndex >= 0 && game.currentQuestionIndex < game.questions.length)
      ? game.questions[game.currentQuestionIndex]
      : null;

    const hasAnswered = game.currentAnswers.has(socket.id);
    const myLastHistory = player.history[player.history.length - 1] || null;

    // Calculate current rank
    const ranked = Array.from(game.players.values()).sort((a, b) => b.score - a.score);
    const myRank = ranked.findIndex(p => p.nickname === player.nickname) + 1;

    socket.emit('player:restore_state', {
      pin: trimmedPin,
      state: game.state,
      player,
      currentQuestionIndex: game.currentQuestionIndex,
      totalQuestions: game.questions.length,
      currentTimeLeft: Math.max(0, game.currentTimeLeft),
      timePerQuestion: game.timePerQuestion,
      question: currentQ ? currentQ.question : '',
      options: currentQ ? currentQ.options : [],
      hasAnswered,
      selectedOption: hasAnswered ? game.currentAnswers.get(socket.id).optionIndex : null,
      lastResult: (game.state === 'LEADERBOARD' && myLastHistory) ? {
        isCorrect: myLastHistory.isCorrect,
        pointsEarned: myLastHistory.pointsEarned,
        totalScore: player.score,
        rank: myRank,
        totalPlayers: game.players.size,
        streak: player.streak,
        explanation: currentQ ? currentQ.explanation : ''
      } : null,
      finalResults: game.lastFinalResults ? {
        rank: myRank,
        totalScore: player.score,
        correctAnswers: player.history.filter(h => h.isCorrect).length,
        totalQuestions: game.questions.length,
        totalPlayers: game.players.size,
        podium: {
          first: game.lastFinalResults.podium.first?.nickname || null,
          second: game.lastFinalResults.podium.second?.nickname || null,
          third: game.lastFinalResults.podium.third?.nickname || null
        }
      } : null
    });
  });

  // Host clicks "Fresh Start"
  socket.on('host:fresh_start', (data) => {
    const pin = (data && data.pin) || socket.gamePin;
    if (pin) {
      const game = games.get(pin);
      if (game) {
        clearInterval(game.timerInterval);
        io.to(game.pin).emit('game:cancelled', { message: 'Host has reset the quiz session.' });
        games.delete(pin);
      }
    }
    socket.gamePin = null;
    socket.isHost = false;
    socket.emit('host:fresh_start_confirmed');
  });

  // Disconnect handling (Preserves session on browser refresh!)
  socket.on('disconnect', () => {
    // We intentionally keep session alive so refresh preserves everything seamlessly!
    // Game is only closed when host clicks "Fresh Start" or ends game.
  });
});

// Start Question Function
function startNextQuestion(game) {
  clearInterval(game.timerInterval);
  game.currentQuestionIndex += 1;
  game.state = 'QUESTION';
  game.currentAnswers.clear();
  game.currentTimeLeft = game.timePerQuestion;

  const currentQ = game.questions[game.currentQuestionIndex];

  // Send to Host (Full details)
  io.to(game.hostSocketId).emit('host:question_start', {
    questionIndex: game.currentQuestionIndex,
    totalQuestions: game.questions.length,
    question: currentQ.question,
    options: currentQ.options,
    timePerQuestion: game.timePerQuestion,
    currentTimeLeft: game.currentTimeLeft
  });

  // Send to Players (Kahoot style: options and symbols)
  for (const [playerId] of game.players) {
    io.to(playerId).emit('player:question_start', {
      questionIndex: game.currentQuestionIndex,
      totalQuestions: game.questions.length,
      question: currentQ.question,
      options: currentQ.options,
      timePerQuestion: game.timePerQuestion,
      currentTimeLeft: game.currentTimeLeft
    });
  }

  // Synchronized 1-second countdown timer
  game.timerInterval = setInterval(() => {
    game.currentTimeLeft -= 1;

    // Broadcast tick
    io.to(game.pin).emit('game:timer_tick', {
      currentTimeLeft: Math.max(0, game.currentTimeLeft),
      timePerQuestion: game.timePerQuestion
    });

    if (game.currentTimeLeft <= 0) {
      clearInterval(game.timerInterval);
      finishQuestion(game);
    }
  }, 1000);
}

// Finish Question & Reveal Scorecard
function finishQuestion(game) {
  clearInterval(game.timerInterval);
  game.state = 'LEADERBOARD';

  const currentQ = game.questions[game.currentQuestionIndex];
  const correctOptionIndex = currentQ.answerIndex;

  // Answer distribution counts [A, B, C, D]
  const distribution = [0, 0, 0, 0];

  // Calculate scores for each player
  for (const [socketId, player] of game.players) {
    const submission = game.currentAnswers.get(socketId);
    let isCorrect = false;
    let pointsEarned = 0;

    if (submission) {
      distribution[submission.optionIndex] = (distribution[submission.optionIndex] || 0) + 1;
      if (submission.optionIndex === correctOptionIndex) {
        isCorrect = true;
        // Kahoot scoring: faster answers yield higher points (up to 1000)
        // Formula: 1000 * (1 - (timeElapsed / timeLimit) / 2)
        const timeFraction = Math.min(1, Math.max(0, submission.timeElapsed / game.timePerQuestion));
        pointsEarned = Math.round(1000 * (1 - (timeFraction / 2)));
        player.score += pointsEarned;
        player.streak += 1;
      } else {
        player.streak = 0;
      }
    } else {
      player.streak = 0;
    }

    player.lastPointsEarned = pointsEarned;
    player.history.push({
      questionIndex: game.currentQuestionIndex,
      isCorrect,
      pointsEarned,
      selectedOption: submission ? submission.optionIndex : null
    });
  }

  // Calculate current rankings
  const rankedPlayers = Array.from(game.players.values())
    .sort((a, b) => b.score - a.score)
    .map((p, index) => ({
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar,
      score: p.score,
      streak: p.streak,
      rank: index + 1,
      lastPointsEarned: p.lastPointsEarned
    }));

  // Send per-player scorecard
  for (const p of rankedPlayers) {
    const submission = game.currentAnswers.get(p.id);
    const isCorrect = submission ? submission.optionIndex === correctOptionIndex : false;

    io.to(p.id).emit('player:question_result', {
      isCorrect,
      correctOptionIndex,
      pointsEarned: p.lastPointsEarned,
      totalScore: p.score,
      rank: p.rank,
      totalPlayers: rankedPlayers.length,
      streak: p.streak,
      explanation: currentQ.explanation
    });
  }

  // Cache last question result for recovery on refresh
  game.lastQuestionResult = {
    questionIndex: game.currentQuestionIndex,
    totalQuestions: game.questions.length,
    correctOptionIndex,
    explanation: currentQ.explanation,
    distribution,
    leaderboard: rankedPlayers.slice(0, 5), // Top 5
    allPlayers: rankedPlayers,
    isLastQuestion: game.currentQuestionIndex + 1 >= game.questions.length
  };

  // Send host intermediate scoreboard & answer distribution
  io.to(game.hostSocketId).emit('host:question_result', game.lastQuestionResult);
}

// Show Final Podium & Game Scorecard
function showFinalPodium(game) {
  clearInterval(game.timerInterval);
  game.state = 'FINAL';

  const finalRankings = Array.from(game.players.values())
    .sort((a, b) => b.score - a.score)
    .map((p, index) => ({
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar,
      score: p.score,
      rank: index + 1,
      correctAnswers: p.history.filter(h => h.isCorrect).length,
      totalQuestions: game.questions.length
    }));

  game.lastFinalResults = {
    podium: {
      first: finalRankings[0] || null,
      second: finalRankings[1] || null,
      third: finalRankings[2] || null
    },
    fullRankings: finalRankings,
    totalQuestions: game.questions.length
  };

  // Send final podium to host
  io.to(game.hostSocketId).emit('host:final_results', game.lastFinalResults);

  // Send final results to all players
  for (const p of finalRankings) {
    io.to(p.id).emit('player:final_results', {
      rank: p.rank,
      totalScore: p.score,
      correctAnswers: p.correctAnswers,
      totalQuestions: p.totalQuestions,
      totalPlayers: finalRankings.length,
      podium: {
        first: finalRankings[0]?.nickname || null,
        second: finalRankings[1]?.nickname || null,
        third: finalRankings[2]?.nickname || null
      }
    });
  }
}

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalNetworkIp();
  console.log(`====================================================`);
  console.log(`🎮 Kahoot-Style PDF MCQ Quiz Server Running!`);
  console.log(`💻 Host Screen:       http://localhost:${PORT}`);
  console.log(`📱 Phone Join URL:    http://${localIp}:${PORT}/join.html`);
  console.log(`====================================================`);
});

module.exports = app;

