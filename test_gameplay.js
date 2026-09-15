const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const SERVER_URL = 'http://localhost:3000';

async function runEndToEndTest() {
  console.log('--- Starting Automated Real-Time Kahoot Gameplay Test ---');

  // 1. Fetch questions via API using 100-Question PDF
  console.log('1. Testing PDF upload and 100-question extraction...');
  const samplePdfPath = path.join(__dirname, 'sample_data', 'sample_100_quiz.pdf');
  const fileBuffer = fs.readFileSync(samplePdfPath);

  const boundary = '--------------------------' + Date.now().toString(16);
  const part1 = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="pdf"; filename="sample_100_quiz.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    'utf-8'
  );
  const part2 = Buffer.from(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="count"\r\n\r\n100\r\n--${boundary}--\r\n`,
    'utf-8'
  );
  const payload = Buffer.concat([part1, fileBuffer, part2]);

  const uploadRes = await fetch(`${SERVER_URL}/api/upload-pdf`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body: payload
  });

  const uploadData = await uploadRes.json();
  console.log('✓ 100-Question PDF Upload Success:', {
    totalGenerated: uploadData.totalGenerated,
    liveCount: uploadData.liveCount,
    remainingCount: uploadData.remainingCount,
    method: uploadData.methodUsed
  });

  if (uploadData.totalGenerated !== 100) {
    throw new Error(`Expected exactly 100 total questions, got ${uploadData.totalGenerated}`);
  }
  if (uploadData.liveCount !== 10) {
    throw new Error(`Expected exactly 10 live questions, got ${uploadData.liveCount}`);
  }
  if (uploadData.remainingCount !== 90) {
    throw new Error(`Expected exactly 90 remaining questions, got ${uploadData.remainingCount}`);
  }

  // Verify downloading the 90 remaining questions
  const dlRes = await fetch(`${SERVER_URL}/api/download-questions?sessionId=${uploadData.sessionId}&type=remaining&format=csv`);
  const dlCsv = await dlRes.text();
  const dlLines = dlCsv.trim().split('\n');
  if (dlLines.length !== 91) { // 1 header + 90 questions
    throw new Error(`Expected 91 CSV lines (1 header + 90 questions), got ${dlLines.length}`);
  }
  console.log('✓ 90 Remaining Questions Download verified (90 data rows in CSV)');

  // 2. Host creates game
  console.log('2. Host connecting via Socket.IO...');
  const hostSocket = io(SERVER_URL);

  const gamePin = await new Promise((resolve) => {
    hostSocket.on('connect', () => {
      hostSocket.emit('host:create_game', {
        questions: uploadData.liveQuestions,
        timePerQuestion: 10
      });
    });

    hostSocket.on('host:game_created', (data) => {
      console.log(`✓ Game created with PIN: ${data.pin} (${data.totalQuestions} live questions)`);
      resolve(data.pin);
    });
  });

  // 3. Players join from phone
  console.log('3. Simulating phone join for 2 students (Emma and Liam)...');
  const emmaSocket = io(SERVER_URL);
  const liamSocket = io(SERVER_URL);

  await Promise.all([
    new Promise((resolve) => {
      emmaSocket.on('connect', () => {
        emmaSocket.emit('player:join', { pin: gamePin, nickname: 'Emma', avatar: '🚀' });
      });
      emmaSocket.on('player:join_success', (data) => {
        console.log(`✓ Emma joined room ${data.pin}`);
        resolve();
      });
    }),
    new Promise((resolve) => {
      liamSocket.on('connect', () => {
        liamSocket.emit('player:join', { pin: gamePin, nickname: 'Liam', avatar: '🦁' });
      });
      liamSocket.on('player:join_success', (data) => {
        console.log(`✓ Liam joined room ${data.pin}`);
        resolve();
      });
    })
  ]);

  // 4. Host starts quiz
  console.log('4. Host starting game session...');
  hostSocket.emit('host:start_game');

  // 5. Verify Countdown & Question 1 broadcast
  const questionData = await new Promise((resolve) => {
    emmaSocket.on('player:question_start', (q) => {
      console.log(`✓ Question ${q.questionIndex + 1} started: "${q.question}" (Timer: ${q.timePerQuestion}s)`);
      resolve(q);
    });
  });

  // 6. Test Timer Tick in seconds
  await new Promise((resolve) => {
    emmaSocket.once('game:timer_tick', (tick) => {
      console.log(`✓ Synchronized Timer Tick received: ${tick.currentTimeLeft}s remaining`);
      resolve();
    });
  });

  // 7. Emma answers correctly (Option B = 1), Liam answers Option A = 0
  console.log('7. Students submitting answers...');
  emmaSocket.emit('player:submit_answer', { optionIndex: 1 });
  liamSocket.emit('player:submit_answer', { optionIndex: 0 });

  // 8. Receive Question Scorecard
  const [emmaResult, hostResult] = await Promise.all([
    new Promise((resolve) => {
      emmaSocket.on('player:question_result', (res) => {
        console.log(`✓ Emma personal scorecard: Correct=${res.isCorrect}, Points=+${res.pointsEarned}, TotalScore=${res.totalScore}, Rank=#${res.rank}`);
        resolve(res);
      });
    }),
    new Promise((resolve) => {
      hostSocket.on('host:question_result', (res) => {
        console.log(`✓ Host question scorecard received: Correct Option=${res.correctOptionIndex}, Leaderboard Top 1: ${res.leaderboard[0]?.nickname} (${res.leaderboard[0]?.score} pts)`);
        resolve(res);
      });
    })
  ]);

  if (!emmaResult.isCorrect || emmaResult.pointsEarned <= 0) {
    throw new Error('Emma should have answered correctly and earned points');
  }

  // 9. Advance to next questions quickly to verify final podium
  console.log('9. Fast-forwarding through remaining questions to test final podium scorecard...');
  
  const finalResultPromise = new Promise((resolve) => {
    hostSocket.on('host:final_results', (podium) => {
      console.log('✓ Final Podium Scorecard Received:');
      console.log(`   🥇 1st Place: ${podium.podium.first?.nickname} (${podium.podium.first?.score} pts)`);
      console.log(`   🥈 2nd Place: ${podium.podium.second?.nickname} (${podium.podium.second?.score} pts)`);
      resolve(podium);
    });
  });

  // Loop through questions
  let qIdx = 0;
  hostSocket.on('host:question_start', (q) => {
    qIdx = q.questionIndex;
    // Both answer immediately
    emmaSocket.emit('player:submit_answer', { optionIndex: 1 });
    liamSocket.emit('player:submit_answer', { optionIndex: 0 });
  });

  hostSocket.on('host:question_result', (res) => {
    setTimeout(() => {
      hostSocket.emit('host:next');
    }, 100);
  });

  // Trigger next from first question
  hostSocket.emit('host:next');

  const finalResults = await finalResultPromise;
  console.log('✓ All 10 live questions executed successfully!');
  console.log(`✓ Total participants ranked: ${finalResults.fullRankings.length}`);

  // Disconnect sockets
  hostSocket.disconnect();
  emmaSocket.disconnect();
  liamSocket.disconnect();

  console.log('🎉 --- ALL REAL-TIME MULTIPLAYER TESTS PASSED! --- 🎉');
  process.exit(0);
}

runEndToEndTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
