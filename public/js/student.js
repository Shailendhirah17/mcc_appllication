/**
 * Student Mobile Phone Client Controller
 * Pure touch-optimized, rapid option selection, live countdown in seconds,
 * per-question scorecards, and final results.
 */

const socket = io();

// Screens
const screens = {
  join: document.getElementById('screen-join'),
  waiting: document.getElementById('screen-waiting'),
  question: document.getElementById('screen-question'),
  result: document.getElementById('screen-result'),
  final: document.getElementById('screen-final')
};

function showScreen(name) {
  Object.keys(screens).forEach(k => {
    if (screens[k]) screens[k].classList.remove('active');
  });
  if (screens[name]) {
    screens[name].classList.add('active');
  }
}

// Auto-fill PIN from URL query param if scanned via QR Code
const urlParams = new URLSearchParams(window.location.search);
const pinInput = document.getElementById('player-pin-input');
const nameInput = document.getElementById('player-name-input');
const btnJoin = document.getElementById('btn-player-join');
const joinError = document.getElementById('join-error-msg');

if (urlParams.has('pin') && pinInput) {
  pinInput.value = urlParams.get('pin');
}

// Avatar selection
let selectedAvatar = '🚀';
const avatarChips = document.querySelectorAll('.avatar-chip');
avatarChips.forEach(chip => {
  chip.addEventListener('click', () => {
    avatarChips.forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    selectedAvatar = chip.dataset.avatar;
  });
});

// Join Game
if (btnJoin) {
  btnJoin.addEventListener('click', () => {
    const pin = (pinInput ? pinInput.value : '').trim();
    const nickname = (nameInput ? nameInput.value : '').trim();

    if (!pin) {
      showError('Please enter the 6-digit Game PIN.');
      return;
    }
    if (!nickname) {
      showError('Please enter your nickname.');
      return;
    }

    if (joinError) joinError.style.display = 'none';
    btnJoin.disabled = true;
    btnJoin.textContent = 'Joining...';

    // Initialize audio context on touch
    if (window.quizAudio) window.quizAudio.init();

    socket.emit('player:join', {
      pin,
      nickname,
      avatar: selectedAvatar
    });
  });
}

function showError(msg) {
  if (joinError) {
    joinError.textContent = msg;
    joinError.style.display = 'block';
  } else {
    alert(msg);
  }
  if (btnJoin) {
    btnJoin.disabled = false;
    btnJoin.textContent = 'Join Game';
  }
}

socket.on('player:join_error', ({ message }) => {
  showError(message);
});

// Joined Success -> Lobby Waiting Room
socket.on('player:join_success', ({ pin, player }) => {
  showScreen('waiting');
  
  const waitingName = document.getElementById('waiting-player-name');
  const waitingAvatar = document.getElementById('waiting-player-avatar');

  if (waitingName) waitingName.textContent = player.nickname;
  if (waitingAvatar) waitingAvatar.textContent = player.avatar || '🚀';
});

// Host started countdown
socket.on('game:get_ready', () => {
  if (window.quizAudio) window.quizAudio.playTone(440, 'sine', 0.2);
});

// --- LIVE QUESTION SCREEN ---
let hasAnswered = false;

socket.on('player:question_start', (data) => {
  hasAnswered = false;
  showScreen('question');

  const qNum = document.getElementById('mobile-q-num');
  const timerPill = document.getElementById('mobile-timer-pill');
  const qPreview = document.getElementById('mobile-q-preview');
  const banner = document.getElementById('answer-locked-banner');

  if (qNum) qNum.textContent = `Q${data.questionIndex + 1}/${data.totalQuestions}`;
  if (timerPill) {
    timerPill.textContent = `⏳ ${data.currentTimeLeft}s`;
    timerPill.classList.remove('urgent');
  }
  if (qPreview) qPreview.textContent = data.question;
  if (banner) banner.classList.remove('show');

  // Reset touch buttons
  const buttons = document.querySelectorAll('.touch-btn');
  buttons.forEach((btn, index) => {
    btn.classList.remove('selected', 'faded');
    btn.disabled = false;
    const btnText = btn.querySelector('.btn-text');
    if (btnText && data.options[index]) {
      btnText.textContent = data.options[index];
    }
  });

  if (window.quizAudio) window.quizAudio.playTick(false);
});

// Timer tick in seconds
socket.on('game:timer_tick', ({ currentTimeLeft }) => {
  const timerPill = document.getElementById('mobile-timer-pill');
  if (timerPill) {
    timerPill.textContent = `⏳ ${currentTimeLeft}s`;
    if (currentTimeLeft <= 5) {
      timerPill.classList.add('urgent');
      if (window.quizAudio && !hasAnswered) window.quizAudio.playTick(true);
    }
  }
});

// Handle Student Option Selection (Kahoot style)
const optionButtons = document.querySelectorAll('.touch-btn');
optionButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (hasAnswered) return;
    hasAnswered = true;

    const optIndex = parseInt(btn.dataset.index, 10);

    // Audio & tactile feedback
    if (window.quizAudio) window.quizAudio.playTap();

    // Lock UI
    optionButtons.forEach(b => {
      if (b === btn) {
        b.classList.add('selected');
      } else {
        b.classList.add('faded');
      }
      b.disabled = true;
    });

    const banner = document.getElementById('answer-locked-banner');
    if (banner) banner.classList.add('show');

    // Submit answer to server
    socket.emit('player:submit_answer', {
      optionIndex: optIndex
    });
  });
});

// --- QUESTION SCORECARD / RESULT ---
socket.on('player:question_result', (data) => {
  showScreen('result');

  const screenResult = document.getElementById('screen-result');
  const heroIcon = document.getElementById('result-hero-icon');
  const heroTitle = document.getElementById('result-hero-title');
  const pointsBadge = document.getElementById('result-points-badge');
  const rankCard = document.getElementById('result-rank-card');
  const streakBox = document.getElementById('result-streak-box');

  if (data.isCorrect) {
    if (screenResult) {
      screenResult.className = 'mobile-screen active student-result-screen correct-bg';
    }
    if (heroIcon) heroIcon.textContent = '🎉';
    if (heroTitle) heroTitle.textContent = 'CORRECT!';
    if (pointsBadge) pointsBadge.textContent = `+${data.pointsEarned.toLocaleString()} pts`;
    if (window.quizAudio) window.quizAudio.playCorrect();
  } else {
    if (screenResult) {
      screenResult.className = 'mobile-screen active student-result-screen wrong-bg';
    }
    if (heroIcon) heroIcon.textContent = '😢';
    if (heroTitle) heroTitle.textContent = 'INCORRECT';
    if (pointsBadge) pointsBadge.textContent = `+0 pts`;
    if (window.quizAudio) window.quizAudio.playWrong();
  }

  if (rankCard) {
    rankCard.innerHTML = `
      <div>Rank <strong>#${data.rank}</strong> of ${data.totalPlayers}</div>
      <div>|</div>
      <div>Score: <strong>${data.totalScore.toLocaleString()} pts</strong></div>
    `;
  }

  if (streakBox) {
    streakBox.textContent = data.streak > 1 ? `🔥 Answer Streak: ${data.streak} in a row!` : '';
  }
});

// --- FINAL SCORECARD ---
socket.on('player:final_results', (data) => {
  showScreen('final');
  if (window.quizAudio) window.quizAudio.playFanfare();

  const rankBadge = document.getElementById('final-rank-badge');
  const scoreVal = document.getElementById('final-score-val');
  const accuracyVal = document.getElementById('final-accuracy-val');
  const podiumHint = document.getElementById('final-podium-hint');

  const medals = ['🥇 1st Place!', '🥈 2nd Place!', '🥉 3rd Place!'];
  const rankText = medals[data.rank - 1] || `Rank #${data.rank}`;

  if (rankBadge) rankBadge.textContent = rankText;
  if (scoreVal) scoreVal.textContent = `${data.totalScore.toLocaleString()} pts`;
  
  const pct = Math.round((data.correctAnswers / data.totalQuestions) * 100) || 0;
  if (accuracyVal) accuracyVal.textContent = `${data.correctAnswers}/${data.totalQuestions} (${pct}%)`;

  if (podiumHint) {
    if (data.rank <= 3) {
      podiumHint.textContent = '🌟 Look at the big screen! You are on the podium!';
    } else {
      podiumHint.textContent = `Winner: 🏆 ${data.podium.first || 'Champion'}`;
    }
  }
});

// Host disconnected / game cancelled
socket.on('game:cancelled', ({ message }) => {
  alert(message || 'The host has ended the session.');
  window.location.reload();
});
