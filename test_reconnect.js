const io = require('socket.io-client');
const http = require('http');

async function runTest() {
  console.log('--- Starting Reconnect & Fresh Start Automated Test ---');

  // 1. Load sample 100 questions from API
  const sampleRes = await new Promise((resolve, reject) => {
    http.get('http://localhost:3000/api/sample-100', res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  console.log(`✓ Sample loaded: ${sampleRes.totalGenerated} total, ${sampleRes.liveCount} live, ${sampleRes.remainingCount} remaining`);
  if (sampleRes.totalGenerated !== 100 || sampleRes.liveCount !== 10) {
    throw new Error('Expected 100 total and 10 live questions');
  }

  // 2. Host socket connects and creates game
  let hostSocket = io('http://localhost:3000');
  let gamePin = null;

  await new Promise((resolve) => {
    hostSocket.on('connect', () => {
      hostSocket.emit('host:create_game', {
        questions: sampleRes.liveQuestions,
        timePerQuestion: 15
      });
    });

    hostSocket.on('host:game_created', (data) => {
      gamePin = data.pin;
      console.log(`✓ Game created with PIN: ${gamePin}`);
      resolve();
    });
  });

  // 3. Student socket connects and joins
  let studentSocket = io('http://localhost:3000');
  await new Promise((resolve) => {
    studentSocket.emit('player:join', {
      pin: gamePin,
      nickname: 'AlphaStudent',
      avatar: '🚀'
    });

    studentSocket.on('player:join_success', (data) => {
      console.log(`✓ Student joined: ${data.player.nickname}`);
      resolve();
    });
  });

  // 4. Test Host Reconnect in LOBBY
  console.log('Testing Host refresh in Lobby...');
  hostSocket.disconnect();
  hostSocket = io('http://localhost:3000');
  await new Promise((resolve) => {
    hostSocket.on('connect', () => {
      hostSocket.emit('host:reconnect', { pin: gamePin, sessionId: sampleRes.sessionId });
    });
    hostSocket.on('host:restore_state', (data) => {
      console.log(`✓ Host restored in state: ${data.state}, players: ${data.totalPlayers}`);
      if (data.state !== 'LOBBY' || data.totalPlayers !== 1) {
        throw new Error('Host lobby restore failed');
      }
      resolve();
    });
  });

  // 5. Start the game
  hostSocket.emit('host:start_game');
  console.log('Host started game, waiting for countdown and question 1...');

  await new Promise((resolve) => {
    studentSocket.on('player:question_start', (data) => {
      console.log(`✓ Student received Question 1: "${data.question.slice(0, 40)}..."`);
      resolve();
    });
  });

  // 6. Student answers Option 1
  studentSocket.emit('player:submit_answer', { optionIndex: 1 });
  console.log('Student submitted answer for Option 1');

  // 7. Test Student Reconnect during active question
  console.log('Testing Student refresh during active question...');
  studentSocket.disconnect();
  studentSocket = io('http://localhost:3000');
  await new Promise((resolve) => {
    studentSocket.on('connect', () => {
      studentSocket.emit('player:reconnect', { pin: gamePin, nickname: 'AlphaStudent' });
    });
    studentSocket.on('player:restore_state', (data) => {
      console.log(`✓ Student restored: state=${data.state}, hasAnswered=${data.hasAnswered}, selectedOption=${data.selectedOption}`);
      if (data.state !== 'QUESTION' || !data.hasAnswered || data.selectedOption !== 1) {
        throw new Error('Student question restore failed: expected hasAnswered=true and selectedOption=1');
      }
      resolve();
    });
  });

  // 8. Test Host Reconnect during active question
  console.log('Testing Host refresh during active question...');
  hostSocket.disconnect();
  hostSocket = io('http://localhost:3000');
  await new Promise((resolve) => {
    hostSocket.on('connect', () => {
      hostSocket.emit('host:reconnect', { pin: gamePin, sessionId: sampleRes.sessionId });
    });
    hostSocket.on('host:restore_state', (data) => {
      console.log(`✓ Host restored: state=${data.state}, answered=${data.totalAnswered}/${data.totalPlayers}`);
      if (data.state !== 'QUESTION' || data.totalAnswered !== 1) {
        throw new Error('Host question restore failed: expected state=QUESTION and totalAnswered=1');
      }
      resolve();
    });
  });

  // 9. Host skips timer to reveal scorecard
  console.log('Host skipping timer to reveal question scorecard...');
  hostSocket.emit('host:next');

  await Promise.all([
    new Promise(resolve => {
      hostSocket.on('host:question_result', data => {
        console.log(`✓ Host received scorecard: correctOption=${data.correctOptionIndex}`);
        resolve();
      });
    }),
    new Promise(resolve => {
      studentSocket.on('player:question_result', data => {
        console.log(`✓ Student received scorecard: isCorrect=${data.isCorrect}, pts=${data.pointsEarned}, rank=${data.rank}`);
        resolve();
      });
    })
  ]);

  // 10. Test Refresh on Leaderboard / Results screen
  console.log('Testing Host & Student refresh on Leaderboard screen...');
  hostSocket.disconnect();
  hostSocket = io('http://localhost:3000');
  await new Promise((resolve) => {
    hostSocket.on('connect', () => {
      hostSocket.emit('host:reconnect', { pin: gamePin });
    });
    hostSocket.on('host:restore_state', (data) => {
      console.log(`✓ Host restored on Leaderboard: has lastResult? ${!!data.lastResult}`);
      if (data.state !== 'LEADERBOARD' || !data.lastResult) {
        throw new Error('Host leaderboard restore failed');
      }
      resolve();
    });
  });

  studentSocket.disconnect();
  studentSocket = io('http://localhost:3000');
  await new Promise((resolve) => {
    studentSocket.on('connect', () => {
      studentSocket.emit('player:reconnect', { pin: gamePin, nickname: 'AlphaStudent' });
    });
    studentSocket.on('player:restore_state', (data) => {
      console.log(`✓ Student restored on Leaderboard: has lastResult? ${!!data.lastResult}`);
      if (data.state !== 'LEADERBOARD' || !data.lastResult) {
        throw new Error('Student leaderboard restore failed');
      }
      resolve();
    });
  });

  // 11. Test Fresh Start Reset
  console.log('Testing Fresh Start reset...');
  const resetPromises = Promise.all([
    new Promise(resolve => {
      studentSocket.on('game:cancelled', data => {
        console.log(`✓ Student notified of reset: "${data.message}"`);
        resolve();
      });
    }),
    new Promise(resolve => {
      hostSocket.on('host:fresh_start_confirmed', () => {
        console.log(`✓ Host received fresh_start_confirmed!`);
        resolve();
      });
    })
  ]);

  hostSocket.emit('host:fresh_start', { pin: gamePin });
  await resetPromises;

  // 12. Confirm room no longer exists
  const checkSocket = io('http://localhost:3000');
  await new Promise((resolve) => {
    checkSocket.emit('player:join', { pin: gamePin, nickname: 'LatePlayer' });
    checkSocket.on('player:join_error', data => {
      console.log(`✓ Verified old room is deleted: "${data.message}"`);
      resolve();
    });
  });

  hostSocket.disconnect();
  studentSocket.disconnect();
  checkSocket.disconnect();

  console.log('\n=========================================');
  console.log('🎉 ALL RECONNECT & FRESH START TESTS PASSED!');
  console.log('=========================================\n');
  process.exit(0);
}

runTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
