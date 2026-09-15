/**
 * Kahoot-Style Sound Synthesizer via Web Audio API
 * Fully client-side, zero external MP3 dependencies!
 */
class QuizAudio {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.lobbyInterval = null;
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.stopLobbyMusic();
    }
    return this.isMuted;
  }

  // Play a simple synthesized beep/tone
  playTone(freq, type = 'sine', duration = 0.15, gainVal = 0.1, decay = true) {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      if (decay) {
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
      }

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      console.warn('Audio playback note error:', e);
    }
  }

  // Timer Tick (Seconds countdown)
  playTick(urgent = false) {
    if (this.isMuted) return;
    this.init();
    const freq = urgent ? 880 : 540;
    this.playTone(freq, 'triangle', 0.08, urgent ? 0.2 : 0.08);
  }

  // Button Tap / Answer recorded
  playTap() {
    if (this.isMuted) return;
    this.init();
    this.playTone(600, 'sine', 0.12, 0.2);
  }

  // Correct answer chime (Bright major chord arpeggio: C5 -> E5 -> G5 -> C6)
  playCorrect() {
    if (this.isMuted) return;
    this.init();
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      setTimeout(() => {
        this.playTone(freq, 'triangle', 0.35, 0.25);
      }, idx * 70);
    });
  }

  // Wrong answer (Playful low buzz)
  playWrong() {
    if (this.isMuted) return;
    this.init();
    const notes = [320, 260, 210];
    notes.forEach((freq, idx) => {
      setTimeout(() => {
        this.playTone(freq, 'sawtooth', 0.22, 0.18);
      }, idx * 100);
    });
  }

  // Podium Victory Fanfare
  playFanfare() {
    if (this.isMuted) return;
    this.init();
    const melody = [
      { f: 523.25, d: 0.15, delay: 0 },
      { f: 523.25, d: 0.15, delay: 150 },
      { f: 523.25, d: 0.15, delay: 300 },
      { f: 659.25, d: 0.35, delay: 450 },
      { f: 783.99, d: 0.2, delay: 750 },
      { f: 659.25, d: 0.2, delay: 950 },
      { f: 783.99, d: 0.2, delay: 1150 },
      { f: 1046.50, d: 0.7, delay: 1350 }
    ];

    melody.forEach(item => {
      setTimeout(() => {
        this.playTone(item.f, 'triangle', item.d, 0.3);
      }, item.delay);
    });
  }

  // Upbeat playful lobby background synthesizer loop
  playLobbyMusic() {
    if (this.isMuted || this.lobbyInterval) return;
    this.init();

    const chords = [
      [261.63, 329.63, 392.00], // C
      [293.66, 349.23, 440.00], // Dm
      [329.63, 392.00, 493.88], // Em
      [349.23, 440.00, 523.25]  // F
    ];
    let step = 0;

    this.lobbyInterval = setInterval(() => {
      if (this.isMuted) return;
      const chord = chords[step % chords.length];
      chord.forEach((freq, i) => {
        setTimeout(() => {
          this.playTone(freq * 1.5, 'sine', 0.25, 0.05);
        }, i * 120);
      });
      step++;
    }, 900);
  }

  stopLobbyMusic() {
    if (this.lobbyInterval) {
      clearInterval(this.lobbyInterval);
      this.lobbyInterval = null;
    }
  }
}

window.quizAudio = new QuizAudio();
