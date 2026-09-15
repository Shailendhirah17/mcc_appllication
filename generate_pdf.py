from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import os

pdf_path = os.path.join(os.path.dirname(__file__), 'sample_data', 'sample_100_quiz.pdf')

c = canvas.Canvas(pdf_path, pagesize=letter)
width, height = letter

# List of 100 Computer Science, Networking, Web & AI Questions
topics = [
    ("Socket.IO duplex protocol", ["HTTP Polling", "WebSocket", "SMTP Relay", "FTP Stream"], 1, "WebSocket provides full-duplex communication over single TCP connection."),
    ("CSS glassmorphism blur property", ["filter: blur()", "backdrop-filter: blur()", "box-shadow: inset", "opacity: 0.5"], 1, "backdrop-filter applies graphical blur to area behind an element."),
    ("Kahoot speed scoring factor", ["Player rank", "Speed of submission", "Screen resolution", "Device battery"], 1, "Quicker response yields up to 1000 points."),
    ("HTTP resource created status code", ["200 OK", "201 Created", "204 No Content", "304 Not Modified"], 1, "HTTP 201 indicates resource creation."),
    ("JavaScript Event Loop role", ["Compiles C++ code", "Dispatches callback queue tasks", "Encrypts sockets", "Allocates GPU buffers"], 1, "Event loop handles asynchronous non-blocking callbacks."),
    ("Standard web data interchange format", ["XML-RPC", "JSON", "YAML-Binary", "INI Config"], 1, "JSON is standard, lightweight, and language-independent."),
    ("DOM acronym expansion", ["Dynamic Object Map", "Document Object Model", "Digital Optimization Module", "Direct Operation Method"], 1, "DOM models HTML as a node tree."),
    ("HTTPS encryption protocol", ["TLS", "SSH", "PGP", "IPsec"], 0, "Transport Layer Security secures HTTP."),
    ("SQL acronym expansion", ["Sequential Query Logic", "Structured Query Language", "Standard Quality Link", "System Quick Lookup"], 1, "SQL manages relational databases."),
    ("Browser audio synthesis API", ["Web Audio API", "Flash Audio Player", "QuickTime Plugin", "DirectSound ActiveX"], 0, "Web Audio API allows modular client-side audio synthesis."),
    ("Balanced BST search complexity", ["O(1)", "O(log n)", "O(n)", "O(n^2)"], 1, "Balanced binary search trees halve elements each step."),
    ("FIFO data structure", ["Stack", "Queue", "Heap", "Priority Set"], 1, "Queues operate on First-In, First-Out order."),
    ("Standard HTTP port", ["21", "80", "443", "8080"], 1, "Port 80 is designated for unencrypted HTTP."),
    ("CPU acronym expansion", ["Central Processing Unit", "Central Program Utility", "Core Performance User", "Computer Power Unit"], 0, "CPU executes arithmetic and logic instructions."),
    ("2D grid CSS layout module", ["Flexbox", "CSS Grid", "Float Layout", "Inline Block"], 1, "CSS Grid handles rows and columns simultaneously."),
    ("LIFO data structure", ["Queue", "Stack", "Ring Buffer", "Array List"], 1, "Stacks push and pop from the top element."),
    ("DNS primary service", ["Resolves names to IPs", "Encrypts disk", "Compresses images", "Routes power"], 0, "DNS translates domain names into IP addresses."),
    ("TCP handshake phases", ["1-way", "2-way", "3-way", "4-way"], 2, "TCP utilizes SYN, SYN-ACK, ACK 3-way handshake."),
    ("Default HTTPS port", ["80", "8080", "443", "22"], 2, "Port 443 is standard for encrypted HTTPS."),
    ("Git command to record repository changes", ["git push", "git commit", "git pull", "git fetch"], 1, "git commit records staged snapshots locally.")
]

# Duplicate and expand into 100 diverse questions
all_questions = []
letters = ['A', 'B', 'C', 'D']

for i in range(100):
    base = topics[i % len(topics)]
    q_num = i + 1
    q_text = f"Question {q_num}: What is the primary characteristic or function regarding {base[0]}?"
    options = [opt for opt in base[1]]
    ans_idx = base[2]
    exp = base[3]
    all_questions.append((q_num, q_text, options, ans_idx, exp))

y = height - 50
c.setFont("Helvetica-Bold", 14)
c.drawString(50, y, "Comprehensive 100-Question Engineering Exam Bank")
y -= 20
c.setFont("Helvetica", 9)
c.drawString(50, y, "Total Questions: 100 | Includes Inline Questions and Answer Key")
y -= 30

for q in all_questions:
    if y < 80:
        c.showPage()
        y = height - 50

    q_num, q_text, options, ans_idx, exp = q
    c.setFont("Helvetica-Bold", 9)
    c.drawString(50, y, f"{q_num}. {q_text}")
    y -= 14

    c.setFont("Helvetica", 8.5)
    opt_str = f"(A) {options[0]}   (B) {options[1]}   (C) {options[2]}   (D) {options[3]}"
    c.drawString(65, y, opt_str)
    y -= 13

    c.setFont("Helvetica-Oblique", 8)
    ans_letter = letters[ans_idx]
    c.drawString(65, y, f"Answer: {ans_letter} | Note: {exp}")
    y -= 18

c.save()
print(f"Generated 100-question PDF at: {pdf_path}")
