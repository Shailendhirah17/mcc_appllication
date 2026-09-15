const fs = require('fs');
const path = require('path');

// Simple valid raw PDF builder
function createSimplePdf(outputPath) {
  const content = `BT
/F1 14 Tf
50 750 Td
(Computer Science & Networking MCQ Exam Bank) Tj
0 -25 Td
/F1 10 Tf
(1. What protocol does the web browser use for secure encrypted communication?) Tj
0 -15 Td
(A) HTTP   (B) HTTPS   (C) FTP   (D) Telnet) Tj
0 -15 Td
(Answer: B. Note: HTTPS uses TLS encryption.) Tj
0 -25 Td
(2. Which data structure operates on a Last-In, First-Out principle?) Tj
0 -15 Td
(A) Queue   (B) Stack   (C) Linked List   (D) Binary Heap) Tj
0 -15 Td
(Answer: B. Note: Stack push and pop from top.) Tj
0 -25 Td
(3. What is the standard port for Secure Shell SSH connections?) Tj
0 -15 Td
(A) 21   (B) 22   (C) 80   (D) 443) Tj
0 -15 Td
(Answer: B. Note: Port 22 is reserved for SSH.) Tj
0 -25 Td
(4. Which algorithmic notation represents the upper bound of execution time?) Tj
0 -15 Td
(A) Big-O   (B) Big-Omega   (C) Big-Theta   (D) Little-o) Tj
0 -15 Td
(Answer: A. Note: Big-O denotes worst-case upper bound.) Tj
0 -25 Td
(5. What does API stand for in software engineering?) Tj
0 -15 Td
(A) Application Programming Interface   (B) Automated Protocol Integrator   (C) Advanced Program Instruction   (D) Array Pointer Index) Tj
0 -15 Td
(Answer: A. Note: APIs define interactions between software systems.) Tj
0 -25 Td
(6. Which protocol provides reliable ordered stream transport over IP?) Tj
0 -15 Td
(A) UDP   (B) TCP   (C) ICMP   (D) ARP) Tj
0 -15 Td
(Answer: B. Note: TCP guarantees delivery and packet order.) Tj
0 -25 Td
(7. What is the hexadecimal representation of the decimal number 255?) Tj
0 -15 Td
(A) FF   (B) FE   (C) 100   (D) EE) Tj
0 -15 Td
(Answer: A. Note: 15*16 + 15 = 255 = 0xFF.) Tj
0 -25 Td
(8. Which component coordinates CPU operations and instruction cycles?) Tj
0 -15 Td
(A) ALU   (B) Control Unit   (C) RAM   (D) BIOS) Tj
0 -15 Td
(Answer: B. Note: The Control Unit directs memory and arithmetic logic.) Tj
0 -25 Td
(9. In CSS, which property controls flexbox item alignment along the cross axis?) Tj
0 -15 Td
(A) justify-content   (B) align-items   (C) flex-wrap   (D) align-content) Tj
0 -15 Td
(Answer: B. Note: align-items aligns items perpendicular to main axis.) Tj
0 -25 Td
(10. Which SQL clause is used to filter aggregated group results?) Tj
0 -15 Td
(A) WHERE   (B) HAVING   (C) ORDER BY   (D) LIMIT) Tj
0 -15 Td
(Answer: B. Note: HAVING filters after GROUP BY aggregation.) Tj
0 -25 Td
(11. Which data structure provides constant O(1) average lookup time?) Tj
0 -15 Td
(A) Array   (B) Hash Map   (C) Binary Tree   (D) Doubly Linked List) Tj
0 -15 Td
(Answer: B. Note: Hash tables offer average O(1) key access.) Tj
0 -25 Td
(12. What does DNS stand for?) Tj
0 -15 Td
(A) Domain Name System   (B) Dynamic Network Service   (C) Direct Node Server   (D) Digital Name Syntax) Tj
0 -15 Td
(Answer: A. Note: DNS resolves human domain names to IP addresses.) Tj
ET`;

  const streamLength = Buffer.byteLength(content);

  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 850] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${streamLength} >>
stream
${content}
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000234 00000 n 
0000000300 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
${370 + streamLength}
%%EOF`;

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, pdf, 'utf-8');
  console.log('Sample PDF created at:', outputPath);
}

createSimplePdf(path.join(__dirname, 'sample_data', 'sample_quiz.pdf'));
