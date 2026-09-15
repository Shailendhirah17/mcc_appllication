# ⚡ KahootMCQ: PDF-to-MCQ Live Multiplayer Quiz Generator

A full-stack Kahoot-style real-time multiplayer quiz game that automatically turns uploaded PDF documents into engaging multiple-choice questions. Students can join the live session from their phones using a 6-digit Game PIN or QR code, select options on their screens with real-time countdown timers, and view instant scorecards after each question and at the final podium.

---

## 🌟 Key Features

1. **PDF to MCQ Generator**:
   - Drag & drop any PDF document (lecture slides, notes, textbook chapters, or exam banks).
   - **Smart Dual Engine**:
     - **Intelligent Built-in Extractor**: Detects existing MCQs or analyzes text structure to synthesize high-quality questions with 4 options and explanations right out of the box—no API key required!
     - **Google Gemini AI (Optional)**: Enter your Google AI Studio API key in the UI or `.env` (`GEMINI_API_KEY`) for AI-generated question stems.
2. **First 10 Questions Live, Download the Rest**:
   - The live multiplayer game automatically isolates the **first 10 MCQs** for high-energy gameplay.
   - All **remaining questions** (or the complete bank) can be downloaded instantly in:
     - **CSV format** (spreadsheet ready)
     - **JSON format** (developer ready)
     - **Printable Study Sheet (TXT)**
3. **Student Phone Joining (`/join.html`)**:
   - Fast phone access: enter the 6-digit Game PIN or scan the on-screen **QR Code**.
   - Students enter their nickname and choose a fun avatar (🚀, 🦁, ⚡, 🦊, 🌟, 🍕, 🎯, 🦄).
   - Real-time lobby avatar tags pop into the host screen.
4. **Kahoot-Style Option Selection**:
   - Students select options alone on their phone using the 4 iconic geometric buttons:
     - **▲ Red** (Option A)
     - **◆ Blue** (Option B)
     - **● Yellow** (Option C)
     - **■ Green** (Option D)
   - Fast touch response, tactile lock-in feedback, and prevent-double-tap locking.
5. **Real-Time Countdown Timer in Seconds**:
   - Synchronized second-by-second countdown (e.g. 20s, 15s, 30s) across both host and player screens.
   - Dynamic Kahoot speed scoring: faster correct answers earn more points (up to 1,000 pts per question).
6. **Instant Scorecards**:
   - **After Each Question**:
     - Host: Reveals correct answer, displays live answer distribution bar chart, and shows the Top 5 leaderboard with streak flames (🔥).
     - Student: Receives instant personal scorecard ("CORRECT! 🎉 +950 pts", current rank, and total score).
   - **At the End of the Quiz**:
     - Celebratory 1st, 2nd, and 3rd place animated podium.
     - Full standings table with player accuracy percentages.
     - Synthesized victory fanfare and confetti celebration!
7. **Built-in Web Audio API Synthesizer**:
   - Zero external audio files required! Synthesizes timer tick-tock, answer pops, correct chimes, wrong boings, and podium fanfare with a mute/unmute toggle.

---

## 🚀 Quick Start

### 1. Start the Server
```bash
node server.js
```
*The server will start on port 3000.*

### 2. Access the Application
- **Host / Big Screen**: Open [http://localhost:3000](http://localhost:3000) in your browser (connect your laptop to a projector or screen share).
- **Student Mobile Join**: On phones (connected to the same Wi-Fi) or in a separate browser window, open `http://<your-network-ip>:3000/join.html` or scan the QR code displayed on the host screen.

---

## 🧪 Testing with Ready-to-Play Sample Quiz
Click the **"🚀 Or Load Ready-to-Play Sample Quiz (15 MCQs)"** button on the host screen to immediately test the full gameplay without needing to upload a file!
