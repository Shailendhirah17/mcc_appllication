/**
 * Host Client Controller
 * Manages PDF upload, question splitting, live lobby, timer, question scorecards, and final podium
 */

const socket = io();

// State
let currentSession = null;
let currentGamePin = null;
let networkInfo = { localIp: 'localhost', port: 3000, joinUrl: '' };

// DOM Elements
const views = {
  upload: document.getElementById('view-upload'),
  review: document.getElementById('view-review'),
  lobby: document.getElementById('view-lobby'),
  question: document.getElementById('view-question'),
  results: document.getElementById('view-results'),
  podium: document.getElementById('view-podium')
};

function switchView(viewName) {
  Object.keys(views).forEach(k => {
    if (views[k]) views[k].classList.remove('active');
  });
  if (views[viewName]) {
    views[viewName].classList.add('active');
  }
}

// --- Session Persistence across Browser Refresh ---
const HOST_STORAGE_KEY = 'kahoot_host_session';

function saveHostState(extra = {}) {
  try {
    const existing = getHostState() || {};
    const stateObj = {
      ...existing,
      currentGamePin: currentGamePin || existing.currentGamePin || null,
      currentSession: currentSession || existing.currentSession || null,
      timestamp: Date.now(),
      ...extra
    };
    localStorage.setItem(HOST_STORAGE_KEY, JSON.stringify(stateObj));
  } catch (e) {
    console.warn('Failed to save host state:', e);
  }
}

function getHostState() {
  try {
    const str = localStorage.getItem(HOST_STORAGE_KEY);
    return str ? JSON.parse(str) : null;
  } catch (e) {
    return null;
  }
}

function clearHostState() {
  try {
    localStorage.removeItem(HOST_STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear host state:', e);
  }
}

// Fetch network info on boot
async function initNetworkInfo() {
  try {
    const res = await fetch('/api/network-info');
    networkInfo = await res.json();
    const joinHint = document.getElementById('join-url-text');
    if (joinHint) {
      joinHint.textContent = networkInfo.joinUrl || `http://${window.location.host}/join.html`;
    }
  } catch (e) {
    console.warn('Network info fetch error:', e);
  }
}
initNetworkInfo();

function checkRestoreHostSession() {
  const saved = getHostState();
  if (!saved) return;

  if (saved.currentSession) {
    currentSession = saved.currentSession;
  }

  if (saved.currentGamePin) {
    currentGamePin = saved.currentGamePin;
    console.log('Restoring previous game session PIN:', saved.currentGamePin);
    socket.emit('host:reconnect', {
      pin: saved.currentGamePin,
      sessionId: saved.currentSession?.sessionId
    });
  } else if (saved.currentView === 'review' && saved.currentSession) {
    console.log('Restoring previous review screen');
    renderReviewView(saved.currentSession);
  }
}

// Check session on socket connect or reconnect
socket.on('connect', () => {
  checkRestoreHostSession();
});

// Sound toggle
const muteBtn = document.getElementById('btn-mute');
if (muteBtn) {
  muteBtn.addEventListener('click', () => {
    const isMuted = window.quizAudio.toggleMute();
    muteBtn.textContent = isMuted ? '🔇 Unmute' : '🔊 Sound On';
  });
}

// --- STAGE 1: PDF Upload & MCQ Generation ---
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const fileStatus = document.getElementById('file-status');
const fileNameLabel = document.getElementById('file-name-label');
const btnGenerate = document.getElementById('btn-generate');
const btnSample = document.getElementById('btn-sample');
const apiKeyInput = document.getElementById('api-key-input');
const qCountSelect = document.getElementById('question-count-select');

let selectedFile = null;

if (dropzone && fileInput) {
  dropzone.addEventListener('click', () => fileInput.click());
  
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  });
}

function handleFileSelected(file) {
  if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
    alert('Please select a valid PDF file.');
    return;
  }
  selectedFile = file;
  fileNameLabel.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  fileStatus.classList.add('show');
}

// Generate MCQs
if (btnGenerate) {
  btnGenerate.addEventListener('click', async () => {
    if (!selectedFile) {
      alert('Please upload a PDF document first or click "Load Sample Quiz".');
      return;
    }

    btnGenerate.disabled = true;
    btnGenerate.innerHTML = `<span class="spinner">⏳</span> Extracting & Generating MCQs...`;

    try {
      const formData = new FormData();
      formData.append('pdf', selectedFile);
      formData.append('count', qCountSelect ? qCountSelect.value : '15');
      if (apiKeyInput && apiKeyInput.value.trim()) {
        formData.append('apiKey', apiKeyInput.value.trim());
      }

      const res = await fetch('/api/upload-pdf', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse PDF.');

      renderReviewView(data);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      btnGenerate.disabled = false;
      btnGenerate.innerHTML = `⚡ Generate MCQs`;
    }
  });
}

// Instant Sample Quiz Loader
if (btnSample) {
  btnSample.addEventListener('click', async () => {
    btnSample.disabled = true;
    btnSample.textContent = 'Loading Sample Quiz...';

    const sampleContent = `
    Computer Science & Web Technology Fundamentals.
    1. What is the primary communication protocol used by Socket.IO for low-latency real-time duplex data transfer?
    A) HTTP Polling
    B) WebSocket
    C) SMTP Relay
    D) FTP Stream
    Answer: B
    Note: WebSocket provides full-duplex communication channels over a single TCP connection.

    2. Which CSS property creates glassmorphism blur effects on background layers?
    A) filter: blur()
    B) backdrop-filter: blur()
    C) box-shadow: inset
    D) opacity: 0.5
    Answer: B
    Note: backdrop-filter applies graphical effects like blurring to the area behind an element.

    3. In a Kahoot-style scoring algorithm, what factor increases point awards for correct answers?
    A) Player level
    B) Speed of answer submission
    C) Device screen resolution
    D) Number of previous attempts
    Answer: B
    Note: Quicker response times yield maximum points up to 1000 per question.

    4. Which HTTP status code indicates a successful resource creation?
    A) 200 OK
    B) 201 Created
    C) 204 No Content
    D) 304 Not Modified
    Answer: B
    Note: HTTP 201 indicates that the request has succeeded and led to the creation of a resource.

    5. What is the function of the Event Loop in JavaScript runtimes?
    A) To compile C++ code into machine bytecode
    B) To monitor the call stack and dispatch tasks from callback queues
    C) To encrypt network sockets
    D) To allocate heap memory directly to GPU buffers
    Answer: B
    Note: The event loop enables non-blocking asynchronous execution in single-threaded JavaScript.

    6. Which data format is standard for transmitting structured data in web applications?
    A) XML-RPC
    B) JSON
    C) YAML-Binary
    D) INI Configuration
    Answer: B
    Note: JSON (JavaScript Object Notation) is universally supported and lightweight.

    7. What does the DOM stand for in web browsers?
    A) Dynamic Object Map
    B) Document Object Model
    C) Digital Optimization Module
    D) Direct Operation Method
    Answer: B
    Note: The DOM represents HTML documents as a node tree.

    8. Which cryptographic protocol secures HTTPS connections?
    A) TLS
    B) SSH
    C) PGP
    D) IPsec
    Answer: A
    Note: Transport Layer Security (TLS) encrypts web communications.

    9. In relational databases, what does SQL stand for?
    A) Sequential Query Logic
    B) Structured Query Language
    C) Standard Quality Link
    D) System Quick Lookup
    Answer: B
    Note: SQL is the standard language for relational database management.

    10. Which audio technology allows real-time sound synthesis in modern web browsers?
    A) Web Audio API
    B) Flash Audio Player
    C) QuickTime Plugin
    D) DirectSound ActiveX
    Answer: A
    Note: Web Audio API provides high-level modular audio synthesis and processing.

    11. What is the time complexity of searching an element in a balanced Binary Search Tree?
    A) O(1)
    B) O(log n)
    C) O(n)
    D) O(n^2)
    Answer: B
    Note: Balanced BST halves search space at each comparison.

    12. Which data structure operates on a First-In, First-Out (FIFO) basis?
    A) Stack
    B) Queue
    C) Heap
    D) Graph
    Answer: B
    Note: Queues process elements in the order they arrive.

    13. Which port number is standard for unencrypted HTTP traffic?
    A) 21
    B) 80
    C) 443
    D) 8080
    Answer: B
    Note: Port 80 is the designated port for HTTP.

    14. What does CPU stand for?
    A) Central Processing Unit
    B) Central Program Utility
    C) Core Performance User
    D) Computer Power Unit
    Answer: A
    Note: The CPU executes program instructions.

    15. Which CSS layout mode provides two-dimensional grid-based layout capabilities?
    A) Flexbox
    B) CSS Grid
    C) Float Layout
    D) Absolute Positioning
    Answer: B
    Note: CSS Grid handles rows and columns simultaneously.
    `;

    try {
      const res = await fetch('/api/upload-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sampleContent, count: 15 })
      });
      const data = await res.json();
      renderReviewView(data);
    } catch (e) {
      alert('Failed to load sample quiz: ' + e.message);
    } finally {
      btnSample.disabled = false;
      btnSample.textContent = '🚀 Or Load Ready-to-Play Sample Quiz (15 MCQs)';
    }
  });
}

// 100-Question Exam Bank Sample Loader
const btnSample100 = document.getElementById('btn-sample-100');
if (btnSample100) {
  btnSample100.addEventListener('click', async () => {
    btnSample100.disabled = true;
    btnSample100.textContent = 'Loading 100-Question Exam Bank...';

    try {
      const res = await fetch('/api/sample-100');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load 100-question sample.');
      renderReviewView(data);
    } catch (e) {
      alert('Failed to load 100-question sample: ' + e.message);
    } finally {
      btnSample100.disabled = false;
      btnSample100.textContent = '📚 Load Sample 100-Question Exam Bank (10 Live + 90 Downloadable)';
    }
  });
}

// --- STAGE 2: Render Review & Download Remaining ---
function renderReviewView(data) {
  currentSession = data;
  saveHostState({ currentView: 'review', currentSession: data });
  switchView('review');

  const liveBadge = document.getElementById('stat-live-count');
  const remBadge = document.getElementById('stat-rem-count');
  const dlRemCsv = document.getElementById('btn-dl-rem-csv');
  const dlRemJson = document.getElementById('btn-dl-rem-json');
  const dlRemTxt = document.getElementById('btn-dl-rem-txt');
  const dlAllCsv = document.getElementById('btn-dl-all-csv');

  if (liveBadge) liveBadge.textContent = `${data.liveCount} Questions`;
  if (remBadge) remBadge.textContent = `${data.remainingCount} Questions`;

  // Update download links
  const baseUrl = `/api/download-questions?sessionId=${data.sessionId}`;
  if (dlRemCsv) dlRemCsv.href = `${baseUrl}&type=remaining&format=csv`;
  if (dlRemJson) dlRemJson.href = `${baseUrl}&type=remaining&format=json`;
  if (dlRemTxt) dlRemTxt.href = `${baseUrl}&type=remaining&format=txt`;
  if (dlAllCsv) dlAllCsv.href = `${baseUrl}&type=all&format=csv`;

  // Render question list preview
  const listContainer = document.getElementById('review-list-container');
  if (listContainer) {
    listContainer.innerHTML = '';

    // Header title for live questions
    const liveHeader = document.createElement('div');
    liveHeader.style.cssText = 'font-weight: 700; color: #ff6b6b; margin-bottom: 8px; font-size: 1.1rem;';
    liveHeader.textContent = `🎯 Live Quiz Questions (Q1 to Q${data.liveCount}) - These will be played with students:`;
    listContainer.appendChild(liveHeader);

    data.liveQuestions.forEach((q, idx) => {
      const item = document.createElement('div');
      item.className = 'review-item';
      item.innerHTML = `
        <div class="review-item-q">
          <span class="q-badge">Q${idx + 1}</span>
          <span>${q.question}</span>
        </div>
        <div class="review-options-grid">
          ${q.options.map((opt, i) => `
            <div class="review-opt ${i === q.answerIndex ? 'correct' : ''}">
              <strong>${['▲', '◆', '●', '■'][i]} ${['A', 'B', 'C', 'D'][i]}:</strong> ${opt} ${i === q.answerIndex ? '✓' : ''}
            </div>
          `).join('')}
        </div>
      `;
      listContainer.appendChild(item);
    });

    // If remaining questions exist, render an expandable section
    if (data.remainingQuestions && data.remainingQuestions.length > 0) {
      const remHeader = document.createElement('div');
      remHeader.style.cssText = 'font-weight: 700; color: #00d2ff; margin-top: 24px; margin-bottom: 8px; font-size: 1.1rem; display: flex; justify-content: space-between; align-items: center;';
      remHeader.innerHTML = `
        <span>📦 Remaining Questions (Q11 to Q${data.totalGenerated}) - Ready for Download:</span>
        <button id="toggle-remaining-preview" class="icon-btn" style="font-size: 0.85rem; padding: 4px 12px;">👁️ View ${data.remainingCount} Remaining Questions</button>
      `;
      listContainer.appendChild(remHeader);

      const remContainer = document.createElement('div');
      remContainer.id = 'remaining-questions-list';
      remContainer.style.display = 'none';
      remContainer.style.flexDirection = 'column';
      remContainer.style.gap = '14px';

      data.remainingQuestions.forEach((q, idx) => {
        const item = document.createElement('div');
        item.className = 'review-item';
        item.style.borderColor = 'rgba(0, 210, 255, 0.3)';
        item.innerHTML = `
          <div class="review-item-q">
            <span class="q-badge" style="background: #00d2ff; color: #000;">Q${idx + 11}</span>
            <span>${q.question}</span>
          </div>
          <div class="review-options-grid">
            ${q.options.map((opt, i) => `
              <div class="review-opt ${i === q.answerIndex ? 'correct' : ''}">
                <strong>${['▲', '◆', '●', '■'][i]} ${['A', 'B', 'C', 'D'][i]}:</strong> ${opt} ${i === q.answerIndex ? '✓' : ''}
              </div>
            `).join('')}
          </div>
        `;
        remContainer.appendChild(item);
      });

      listContainer.appendChild(remContainer);

      const toggleBtn = document.getElementById('toggle-remaining-preview');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
          const isHidden = remContainer.style.display === 'none';
          remContainer.style.display = isHidden ? 'flex' : 'none';
          toggleBtn.textContent = isHidden ? `Hide ${data.remainingCount} Remaining Questions` : `👁️ View ${data.remainingCount} Remaining Questions`;
        });
      }
    }
  }
}

// Launch Live Quiz Lobby
const btnLaunchLobby = document.getElementById('btn-launch-lobby');
const timePerQSelect = document.getElementById('time-per-q-select');

if (btnLaunchLobby) {
  btnLaunchLobby.addEventListener('click', () => {
    if (!currentSession || !currentSession.liveQuestions) return;
    const timeLimit = parseInt(timePerQSelect ? timePerQSelect.value : '20', 10);
    
    // Request server to create room
    socket.emit('host:create_game', {
      questions: currentSession.liveQuestions,
      timePerQuestion: timeLimit
    });
  });
}

// --- STAGE 3: Live Lobby ---
function renderLobbyQR(pin) {
  const qrContainer = document.getElementById('lobby-qrcode');
  if (qrContainer && window.QRCode) {
    qrContainer.innerHTML = '';
    const joinUrl = `${networkInfo.joinUrl || `http://${window.location.host}/join.html`}?pin=${pin}`;
    new window.QRCode(qrContainer, {
      text: joinUrl,
      width: 170,
      height: 170
    });
  }
}

socket.on('host:game_created', ({ pin, totalQuestions, timePerQuestion }) => {
  currentGamePin = pin;
  saveHostState({ currentView: 'lobby', currentGamePin: pin });
  switchView('lobby');

  const pinDisplay = document.getElementById('pin-display');
  if (pinDisplay) pinDisplay.textContent = pin;

  renderLobbyQR(pin);

  const joinHint = document.getElementById('join-url-text');
  if (joinHint) {
    joinHint.textContent = `${window.location.host}/join.html`;
  }

  // Play background groove
  window.quizAudio.playLobbyMusic();
});

// Real-time Player Join Handling
socket.on('host:player_joined', ({ players, totalPlayers }) => {
  updatePlayerRoster(players, totalPlayers);
  window.quizAudio.playTone(600, 'triangle', 0.15, 0.15); // gentle pop
});

socket.on('host:player_left', ({ players, totalPlayers }) => {
  updatePlayerRoster(players, totalPlayers);
});

function updatePlayerRoster(players, totalPlayers) {
  const countEl = document.getElementById('roster-count');
  const rosterGrid = document.getElementById('players-grid');
  const btnStart = document.getElementById('btn-start-game');

  if (countEl) countEl.textContent = totalPlayers;
  if (btnStart) btnStart.disabled = totalPlayers === 0;

  if (rosterGrid) {
    rosterGrid.innerHTML = '';
    players.forEach(p => {
      const tag = document.createElement('div');
      tag.className = 'player-tag';
      tag.innerHTML = `<span>${p.avatar || '🚀'}</span> <span>${p.nickname}</span>`;
      rosterGrid.appendChild(tag);
    });
  }
}

// Start Game button
const btnStartGame = document.getElementById('btn-start-game');
if (btnStartGame) {
  btnStartGame.addEventListener('click', () => {
    window.quizAudio.stopLobbyMusic();
    socket.emit('host:start_game');
  });
}

// Countdown overlay
socket.on('game:get_ready', ({ count }) => {
  window.quizAudio.playTone(440, 'sine', 0.2);
  // Show brief ready banner if needed
});

// --- STAGE 4: Live Question Screen ---
socket.on('host:question_start', (data) => {
  switchView('question');
  saveHostState({ currentView: 'question', lastQuestionData: data });
  
  const qNum = document.getElementById('live-q-progress');
  const qText = document.getElementById('live-question-text');
  const timerSec = document.getElementById('timer-seconds-display');
  const answerCount = document.getElementById('live-answered-count');

  if (qNum) qNum.textContent = `Question ${data.questionIndex + 1} of ${data.totalQuestions}`;
  if (qText) qText.textContent = data.question;
  if (timerSec) {
    timerSec.textContent = data.currentTimeLeft;
    timerSec.classList.remove('urgent');
  }
  if (answerCount) answerCount.textContent = `0 / -`;

  // Render 4 answer cards
  const optA = document.getElementById('opt-text-0');
  const optB = document.getElementById('opt-text-1');
  const optC = document.getElementById('opt-text-2');
  const optD = document.getElementById('opt-text-3');

  if (optA) optA.textContent = data.options[0] || '';
  if (optB) optB.textContent = data.options[1] || '';
  if (optC) optC.textContent = data.options[2] || '';
  if (optD) optD.textContent = data.options[3] || '';

  window.quizAudio.playTick(false);
});

// Real-time Timer Tick (Seconds)
socket.on('game:timer_tick', ({ currentTimeLeft }) => {
  const timerSec = document.getElementById('timer-seconds-display');
  if (timerSec) {
    timerSec.textContent = currentTimeLeft;
    if (currentTimeLeft <= 5) {
      timerSec.classList.add('urgent');
      window.quizAudio.playTick(true);
    } else {
      window.quizAudio.playTick(false);
    }
  }
});

// Real-time answers count update
socket.on('host:answer_count_update', ({ totalAnswered, totalPlayers, allAnswered }) => {
  const answerCount = document.getElementById('live-answered-count');
  if (answerCount) {
    if (allAnswered) {
      answerCount.innerHTML = `<strong>${totalAnswered} / ${totalPlayers} (All in! ⏳)</strong>`;
    } else {
      answerCount.textContent = `${totalAnswered} / ${totalPlayers} Answered`;
    }
  }
});

// Host Skip/End Question early
const btnSkipQuestion = document.getElementById('btn-skip-question');
if (btnSkipQuestion) {
  btnSkipQuestion.addEventListener('click', () => {
    socket.emit('host:next');
  });
}

// --- STAGE 5: Question Scorecard / Leaderboard ---
function renderQuestionResult(data) {
  if (!data) return;
  switchView('results');
  saveHostState({ currentView: 'results', lastResultData: data });
  window.quizAudio.playTone(523.25, 'triangle', 0.25);

  const banner = document.getElementById('correct-answer-banner');
  const symbols = ['▲', '◆', '●', '■'];
  
  if (banner) {
    banner.innerHTML = `<span>Correct Answer:</span> <strong style="color:#68d391">${symbols[data.correctOptionIndex]} Option ${['A', 'B', 'C', 'D'][data.correctOptionIndex]}</strong>`;
  }

  // Animate Distribution Chart
  const totalAnswers = data.distribution ? data.distribution.reduce((a, b) => a + b, 0) || 1 : 1;
  for (let i = 0; i < 4; i++) {
    const count = data.distribution ? data.distribution[i] : 0;
    const bar = document.getElementById(`dist-bar-${i}`);
    const countLabel = document.getElementById(`dist-count-${i}`);
    const pct = Math.round((count / totalAnswers) * 100);
    
    if (bar) bar.style.height = `${Math.max(8, pct * 1.4)}px`;
    if (countLabel) countLabel.textContent = `${count}`;
  }

  // Render Top 5 Leaderboard
  const lbList = document.getElementById('leaderboard-rows');
  if (lbList && data.leaderboard) {
    lbList.innerHTML = '';
    data.leaderboard.forEach(player => {
      const row = document.createElement('div');
      row.className = 'lb-row';
      row.innerHTML = `
        <div class="lb-rank">#${player.rank}</div>
        <div class="lb-player">
          <span style="font-size: 1.4rem;">${player.avatar || '🚀'}</span>
          <span>${player.nickname}</span>
          ${player.streak > 1 ? `<span title="Streak">🔥 ${player.streak}</span>` : ''}
        </div>
        <div class="lb-score">
          ${player.score.toLocaleString()} pts
          ${player.lastPointsEarned > 0 ? `<span class="lb-points-gain">+${player.lastPointsEarned}</span>` : ''}
        </div>
      `;
      lbList.appendChild(row);
    });
  }

  // Button text: "Next Question" or "Show Final Podium"
  const btnNext = document.getElementById('btn-next-step');
  if (btnNext) {
    btnNext.textContent = data.isLastQuestion ? '🏆 Reveal Final Podium!' : 'Next Question ➔';
  }
}

socket.on('host:question_result', (data) => {
  renderQuestionResult(data);
});

// Next question trigger
const btnNextStep = document.getElementById('btn-next-step');
if (btnNextStep) {
  btnNextStep.addEventListener('click', () => {
    socket.emit('host:next');
  });
}

// --- STAGE 6: Final Podium & Scorecard ---
function renderFinalResults(data) {
  if (!data) return;
  switchView('podium');
  saveHostState({ currentView: 'podium', lastFinalData: data });
  window.quizAudio.playFanfare();
  launchConfetti();

  // Populate Podium 1st, 2nd, 3rd
  const p1 = data.podium ? data.podium.first : null;
  const p2 = data.podium ? data.podium.second : null;
  const p3 = data.podium ? data.podium.third : null;

  setPodiumData('1st', p1);
  setPodiumData('2nd', p2);
  setPodiumData('3rd', p3);

  // Populate Full Rankings Table
  const tableBody = document.getElementById('final-rankings-body');
  if (tableBody && data.fullRankings) {
    tableBody.innerHTML = '';
    data.fullRankings.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>#${p.rank}</strong></td>
        <td>${p.avatar || '🚀'} ${p.nickname}</td>
        <td><strong>${p.score.toLocaleString()} pts</strong></td>
        <td>${p.correctAnswers} / ${data.totalQuestions} (${Math.round((p.correctAnswers / data.totalQuestions) * 100)}%)</td>
      `;
      tableBody.appendChild(tr);
    });
  }
}

socket.on('host:final_results', (data) => {
  renderFinalResults(data);
});

function setPodiumData(pos, player) {
  const nameEl = document.getElementById(`podium-${pos}-name`);
  const scoreEl = document.getElementById(`podium-${pos}-score`);
  const avatarEl = document.getElementById(`podium-${pos}-avatar`);

  if (player) {
    if (nameEl) nameEl.textContent = player.nickname;
    if (scoreEl) scoreEl.textContent = `${player.score.toLocaleString()} pts`;
    if (avatarEl) avatarEl.textContent = player.avatar || '🚀';
  } else {
    if (nameEl) nameEl.textContent = '-';
    if (scoreEl) scoreEl.textContent = '0 pts';
  }
}

// Confetti Animation for the final podium celebration
function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const pieces = [];
  const colors = ['#e21b3c', '#1368ce', '#ffa602', '#26890c', '#00d2ff', '#ffffff', '#e0c3fc'];

  for (let i = 0; i < 150; i++) {
    pieces.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      size: Math.random() * 10 + 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      speedY: Math.random() * 3 + 2,
      speedX: Math.random() * 2 - 1,
      angle: Math.random() * 360,
      spin: Math.random() * 6 - 3
    });
  }

  let animationFrame;
  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      p.y += p.speedY;
      p.x += p.speedX;
      p.angle += p.spin;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.angle * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();

      if (p.y > canvas.height) {
        p.y = -20;
        p.x = Math.random() * canvas.width;
      }
    });
    animationFrame = requestAnimationFrame(loop);
  }

  loop();
  setTimeout(() => cancelAnimationFrame(animationFrame), 12000);
}

// --- RESTORATION ACROSS BROWSER REFRESH ---
socket.on('host:restore_state', (data) => {
  console.log('Restoring host state from server:', data.state);
  currentGamePin = data.pin;
  saveHostState({ currentGamePin: data.pin });

  const pinDisplay = document.getElementById('pin-display');
  if (pinDisplay) pinDisplay.textContent = data.pin;

  if (data.state === 'LOBBY') {
    switchView('lobby');
    saveHostState({ currentView: 'lobby' });
    updatePlayerRoster(data.players || [], data.totalPlayers || 0);
    renderLobbyQR(data.pin);
  } else if (data.state === 'QUESTION' || data.state === 'COUNTDOWN') {
    switchView('question');
    saveHostState({ currentView: 'question' });

    const qNum = document.getElementById('live-q-progress');
    const qText = document.getElementById('live-question-text');
    const timerSec = document.getElementById('timer-seconds-display');
    const answerCount = document.getElementById('live-answered-count');

    if (qNum) qNum.textContent = `Question ${data.currentQuestionIndex + 1} of ${data.totalQuestions}`;
    if (qText) qText.textContent = data.question;
    if (timerSec) {
      timerSec.textContent = data.currentTimeLeft;
      if (data.currentTimeLeft <= 5) timerSec.classList.add('urgent');
      else timerSec.classList.remove('urgent');
    }
    if (answerCount) {
      if (data.allAnswered) {
        answerCount.innerHTML = `<strong>${data.totalAnswered} / ${data.totalPlayers} (All in! ⏳)</strong>`;
      } else {
        answerCount.textContent = `${data.totalAnswered} / ${data.totalPlayers} Answered`;
      }
    }

    const optA = document.getElementById('opt-text-0');
    const optB = document.getElementById('opt-text-1');
    const optC = document.getElementById('opt-text-2');
    const optD = document.getElementById('opt-text-3');

    if (optA) optA.textContent = data.options[0] || '';
    if (optB) optB.textContent = data.options[1] || '';
    if (optC) optC.textContent = data.options[2] || '';
    if (optD) optD.textContent = data.options[3] || '';
  } else if (data.state === 'LEADERBOARD') {
    if (data.lastResult) {
      renderQuestionResult(data.lastResult);
    } else {
      switchView('results');
    }
    saveHostState({ currentView: 'results' });
  } else if (data.state === 'FINAL') {
    if (data.finalResults) {
      renderFinalResults(data.finalResults);
    } else {
      switchView('podium');
    }
    saveHostState({ currentView: 'podium' });
  }
});

socket.on('host:restore_review', (data) => {
  renderReviewView(data);
});

socket.on('host:session_expired', () => {
  console.log('Host session expired on server');
  executeFreshStartReset();
});

// --- FRESH START SESSION RESET ---
function executeFreshStartReset() {
  clearHostState();
  currentGamePin = null;
  currentSession = null;
  selectedFile = null;

  if (fileStatus) fileStatus.classList.remove('show');
  if (fileInput) fileInput.value = '';
  if (fileNameLabel) fileNameLabel.textContent = 'Document loaded';

  const rosterGrid = document.getElementById('players-grid');
  if (rosterGrid) rosterGrid.innerHTML = '';
  const rosterCount = document.getElementById('roster-count');
  if (rosterCount) rosterCount.textContent = '0';

  if (window.quizAudio) {
    window.quizAudio.stopLobbyMusic();
  }

  switchView('upload');
}

const btnFreshStart = document.getElementById('btn-fresh-start');
if (btnFreshStart) {
  btnFreshStart.addEventListener('click', () => {
    const isOngoing = currentGamePin || currentSession;
    if (isOngoing) {
      const ok = confirm("Start Fresh?\n\nThis will reset the quiz session, disconnect any connected student phones, and return to the document upload screen.");
      if (!ok) return;
    }
    if (currentGamePin) {
      socket.emit('host:fresh_start', { pin: currentGamePin });
    }
    executeFreshStartReset();
  });
}

socket.on('host:fresh_start_confirmed', () => {
  executeFreshStartReset();
});

// Play Again Button
const btnPlayAgain = document.getElementById('btn-play-again');
if (btnPlayAgain) {
  btnPlayAgain.addEventListener('click', () => {
    if (currentGamePin) {
      socket.emit('host:fresh_start', { pin: currentGamePin });
    }
    if (currentSession) {
      currentGamePin = null;
      saveHostState({ currentView: 'review', currentGamePin: null });
      renderReviewView(currentSession);
    } else {
      executeFreshStartReset();
    }
  });
}
