'use strict';

const http = require('http');

function testChatQuery(userQuery, testName) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      messages: [{ role: 'user', content: userQuery }],
      provider: 'gemini',
      apiKey: '', // Test local canonical RAG research loop
    });

    const options = {
      hostname: '127.0.0.1',
      port: 8400,
      path: '/api/ai/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let buffer = '';
      const events = [];
      let currentEvent = 'message';

      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep trailing incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.substring(7).trim();
          } else if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.substring(6));
              events.push({ event: currentEvent, data });
            } catch (e) {
              events.push({ event: currentEvent, raw: trimmed.substring(6) });
            }
          }
        }
      });

      res.on('end', () => {
        const understandingEvt = events.find((e) => e.event === 'understanding');
        const citationsEvt = events.find((e) => e.event === 'citations');
        const doneEvt = events.find((e) => e.event === 'done');
        const tokens = events.filter((e) => e.event === 'token').map((e) => e.data?.text || '').join('');
        const toolCalls = events.filter((e) => e.event === 'tool_call').map((e) => e.data?.tool);

        console.log(`=======================================================`);
        console.log(`TEST: [${testName}]`);
        console.log(`QUERY: "${userQuery}"`);
        console.log(`HTTP STATUS: ${res.statusCode}`);
        console.log(`UNDERSTANDING EVENT:`, understandingEvt ? {
          intent: understandingEvt.data.intent,
          lang: understandingEvt.data.detected_language,
          target_sutta: understandingEvt.data.target_sutta_names?.[0],
          book: understandingEvt.data.recommended_locations?.books?.[0],
          para: understandingEvt.data.default_sutta_para,
          summary: understandingEvt.data.user_facing_summary,
        } : 'MISSING');
        console.log(`TOOL CALLS EXECUTED (${toolCalls.length}):`, toolCalls.join(' -> '));
        console.log(`CITATIONS COUNT:`, citationsEvt?.data?.citations?.length || 0);
        console.log(`SAMPLE REPORT PREVIEW:\n${tokens.slice(0, 300)}...`);
        console.log(`DONE EVENT MODE:`, doneEvt?.data?.mode || 'none');
        console.log(`=======================================================\n`);

        resolve({
          testName,
          query: userQuery,
          status: res.statusCode,
          understanding: understandingEvt?.data,
          citations: citationsEvt?.data?.citations,
          toolCalls,
          done: doneEvt?.data,
        });
      });
    });

    req.on('error', (err) => {
      console.error(`Error in test [${testName}]:`, err.message);
      reject(err);
    });

    req.setTimeout(35000, () => {
      req.destroy();
      reject(new Error(`Test [${testName}] timed out after 35s`));
    });

    req.write(postData);
    req.end();
  });
}

async function runAllTests() {
  console.log('🚀 STARTING MULTILINGUAL CANONICAL AGENT LOOP CLI VERIFICATION...\n');

  const testCases = [
    { name: 'Vietnamese Sutta by MN Citation', query: 'Kinh MN 118 dạy những gì về 16 bước hơi thở?' },
    { name: 'Vietnamese Sutta by Native Nikaya Name', query: 'Kinh Trung Bộ 118 dạy những gì về 16 bước hơi thở?' },
    { name: 'Vietnamese Sutta by Colloquial Simile', query: 'Tìm giúp tôi bài kinh có tên giống như mật hoàn hay bánh mật?' },
    { name: 'Vietnamese Mahāparinibbāna DN 16', query: 'Kinh Đại Bát Niết Bàn DN 16 nói về những lời dạy cuối cùng của Đức Phật' },
    { name: 'Vietnamese Dhammapada verse 1', query: 'Kinh Pháp Cú câu 1 có ý nghĩa gì?' },
    { name: 'English MN 118 Inquiry', query: 'What does MN 118 teach on the sixteen steps of breathing?' },
    { name: 'English SN 56.11 Four Noble Truths', query: 'Explain the Four Noble Truths in Dhammacakkappavattana Sutta (SN 56.11)' },
    { name: 'English AN 3.65 Kalama Sutta', query: 'What are the criteria of free inquiry in the Kalama Sutta (AN 3.65)?' },
    { name: 'Burmese Honey-Ball Discourse', query: 'ပျားလုံး သို့မဟုတ် ပျားမုန့်ကဲ့သို့ အမည်ရှိသော သုတ်ကို ရှာပေးပါ?' },
    { name: 'Burmese Anapanassati Discourse', query: 'အာနာပါနဿတိသုတ် (MN 118) အကြောင်း ရှင်းပြပါ' },
    { name: 'Burmese Sutta by Native Nikaya & Burmese Digits', query: 'မဇ္ဈိမနိကာယ် ၁၁၈ အကြောင်း ရှင်းပြပါ' },
    { name: 'Mahayana Distinction (Kim Cang / Bat Nha)', query: 'Kinh Kim Cang và Bát Nhã' },
  ];

  let passed = 0;
  for (const tc of testCases) {
    try {
      const res = await testChatQuery(tc.query, tc.name);
      if (res.status === 200 && res.understanding && res.done) {
        passed++;
      }
    } catch (err) {
      console.error(`❌ FAILED ${tc.name}:`, err.message);
    }
  }

  console.log(`\n🏁 CLI VERIFICATION RESULTS: ${passed}/${testCases.length} PASSED`);
}

runAllTests().catch(console.error);
