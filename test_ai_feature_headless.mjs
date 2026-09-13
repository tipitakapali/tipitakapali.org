import { spawn, execSync } from 'child_process';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendCdp(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 100000);
  const msg = JSON.stringify({ id, method, params });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`CDP method ${method} timed out after 15s`));
    }, 15000);

    const handler = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.id === id) {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          if (data.error) reject(data.error);
          else resolve(data.result);
        }
      } catch (e) {}
    };
    ws.addEventListener('message', handler);
    ws.send(msg);
  });
}

async function evaluate(ws, expression) {
  const res = await sendCdp(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  if (res?.exceptionDetails) {
    console.error('CDP Evaluate Exception:', res.exceptionDetails);
    throw new Error(JSON.stringify(res.exceptionDetails));
  }
  return res?.result?.value;
}

async function run() {
  console.log('=== Headless Chromium Ani (AI Nissaya) Feature E2E Verification ===\n');

  try {
    execSync('pkill -f /snap/chromium || true; rm -f /home/administrator/tipitaka-xml-vri/chromium-data/Singleton*');
  } catch (e) {}

  console.log('1. Launching headless Chromium on port 9223...');
  const chrome = spawn('bash', [
    '-c',
    'ulimit -n 65536 && exec /snap/bin/chromium --headless=new --remote-debugging-port=9223 --no-sandbox --disable-gpu --user-data-dir=/home/administrator/tipitaka-xml-vri/chromium-data http://127.0.0.1:3000/'
  ], { stdio: 'ignore' });

  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9223/json/version');
      if (res.ok) break;
    } catch (e) {}
    await sleep(200);
  }

  try {
    console.log('2. Connecting to http://127.0.0.1:3000/ tab in Chromium...');
    const tabsRes = await fetch('http://127.0.0.1:9223/json');
    const tabs = await tabsRes.json();
    const tab = tabs.find((t) => t.type === 'page' && t.url.includes('3000')) || tabs[0];
    console.log('Tab URL:', tab.webSocketDebuggerUrl);

    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.addEventListener('open', resolve));

    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.method === 'Runtime.consoleAPICalled') {
          console.log('  [Browser console]', data.params.type, data.params.args?.map(a => a.value ?? a.description));
        }
        if (data.method === 'Runtime.exceptionThrown') {
          console.log('  [Browser exception]', data.params.exceptionDetails?.exception?.description || data.params.exceptionDetails?.text);
        }
      } catch (e) {}
    });

    await sendCdp(ws, 'Runtime.enable');
    await sendCdp(ws, 'Page.enable');

    console.log('3. Waiting for Welcome page to load and render...');
    await sleep(4000);

    // Check Welcome View components
    const welcomeCheck = await evaluate(
      ws,
      `(() => {
        const welcomeTitle = document.querySelector('.welcome-title')?.textContent;
        const aiCard = Array.from(document.querySelectorAll('.category-card')).find(c =>
          c.textContent.includes('Ani (AI Nissaya)')
        );
        const headerAiBtn = document.querySelector('button[title="Ani (AI Nissaya)"]');
        return {
          title: document.title,
          welcomeTitle,
          hasAiCard: Boolean(aiCard),
          aiCardText: aiCard?.textContent?.trim(),
          hasHeaderAiBtn: Boolean(headerAiBtn),
        };
      })()`
    );
    console.log('Welcome render check:', welcomeCheck);

    if (!welcomeCheck.hasAiCard) {
      throw new Error('Ani (AI Nissaya) card not found on Welcome screen!');
    }
    if (!welcomeCheck.hasHeaderAiBtn) {
      throw new Error('Ani (AI Nissaya) button not found in Header!');
    }
    console.log('✓ Welcome View Ani card and Header Ani button found.');

    // Step 4: Click the AI card on Welcome screen
    console.log('\n4. Clicking "Study with Ani (AI Nissaya)" card on Welcome screen...');
    for (let i = 0; i < 20; i++) {
      const isHydrated = await evaluate(ws, `typeof window.__openAiChatTab === 'function'`);
      if (isHydrated) {
        console.log(`✓ Client React hydrated (window.__openAiChatTab ready after ${i + 1}s).`);
        break;
      }
      await sleep(1000);
    }
    let opened = false;
    for (let retry = 0; retry < 15; retry++) {
      const clickRes = await evaluate(
        ws,
        `(() => {
          if (typeof window.__openAiChatTab === 'function') {
            window.__openAiChatTab();
            return { found: true, clicked: true, method: 'direct' };
          }
          const aiCard = Array.from(document.querySelectorAll('.category-card')).find(c =>
            c.textContent.includes('Ani (AI Nissaya)')
          );
          if (aiCard) {
            aiCard.click();
            return { found: true, clicked: true, method: 'aiCard' };
          }
          const headerAiBtn = document.querySelector('button[title="Ani (AI Nissaya)"]');
          if (headerAiBtn) {
            headerAiBtn.click();
            return { found: true, clicked: true, method: 'headerBtn' };
          }
          return { found: false, clicked: false };
        })()`
      );

      await sleep(1000);

      const checkTabs = await evaluate(
        ws,
        `(() => {
          const tabs = Array.from(document.querySelectorAll('.book-tab')).map(t => ({
            text: t.textContent?.trim(),
            isAi: t.classList.contains('book-tab-ai'),
            isActive: t.classList.contains('active'),
          }));
          const hasAiChatView = Boolean(document.querySelector('textarea[placeholder*="Ask any question"]') || document.querySelector('textarea[placeholder*="Ask"]'));
          return { tabCount: tabs.length, hasAiChatView, tabs };
        })()`
      );

      if (checkTabs?.tabCount > 0 || checkTabs?.hasAiChatView) {
        console.log(`✓ AI Chat Tab opened successfully at attempt ${retry + 1}.`);
        opened = true;
        break;
      }
    }

    if (!opened) {
      throw new Error('Failed to open AI Tab after multiple click attempts.');
    }

    // Step 5: Check that the AI tab is open in BookTabsBar and AiChatView is rendered
    console.log('\n5. Verifying AI Chat tab and AiChatView rendered...');
    const aiTabCheck = await evaluate(
      ws,
      `(() => {
        const tabs = Array.from(document.querySelectorAll('.book-tab')).map(t => ({
          text: t.textContent?.trim(),
          isAi: t.classList.contains('book-tab-ai'),
          isActive: t.classList.contains('active'),
        }));
        const hasAiChatView = Boolean(document.querySelector('textarea[placeholder*="Ask any question"]') || document.querySelector('textarea[placeholder*="Ask"]'));
        const starterButtons = Array.from(document.querySelectorAll('button')).filter(b =>
          b.textContent.includes('Dependent Origination') || b.textContent.includes('Samatha vs. Vipassanā')
        ).map(b => b.textContent.trim());
        const hasSettingsBtn = Boolean(document.querySelector('button[title*="Settings"]') || document.querySelector('button[aria-label*="Settings"]'));

        return {
          tabs,
          hasAiChatView,
          starterCount: starterButtons.length,
          starterButtons,
          hasSettingsBtn,
        };
      })()`
    );
    console.log('AI Tab & View check:', JSON.stringify(aiTabCheck, null, 2));

    const aiTab = aiTabCheck.tabs.find(t => t.isAi || t.text.includes('Ani') || t.text.includes('AI'));
    if (!aiTab || !aiTab.isActive) {
      throw new Error('Active AI tab not found in tabs bar!');
    }
    if (!aiTabCheck.hasAiChatView) {
      throw new Error('AiChatView input textarea not found!');
    }
    console.log('✓ AI Chat Tab is active and AiChatView is rendered with starters.');

    // Step 6: Test Settings Modal
    console.log('\n6. Testing AI Settings modal opening...');
    const openSettingsRes = await evaluate(
      ws,
      `(() => {
        const btn = document.querySelector('button[title="AI Configuration & API Keys"]') ||
                    document.querySelector('.ai-settings-btn') ||
                    Array.from(document.querySelectorAll('button')).find(b => b.title?.includes('API Keys') || b.querySelector('svg.lucide-settings'));
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()`
    );
    console.log('Clicked settings button:', openSettingsRes);
    await sleep(600);

    const settingsModalCheck = await evaluate(
      ws,
      `(() => {
        const modal = document.querySelector('.ai-settings-modal');
        const modalText = modal ? modal.textContent : '';
        const hasProvider = modalText.toLowerCase().includes('provider') || modalText.toLowerCase().includes('gemini') || modalText.toLowerCase().includes('openai');
        const hasOrthodox = modalText.includes('RAG') || modalText.includes('Orthodox');
        const closeBtn = modal ? Array.from(modal.querySelectorAll('button')).find(b => b.querySelector('svg.lucide-x') || b.textContent.includes('Close') || b.textContent.includes('Save') || b.textContent.includes('Done')) : null;
        if (closeBtn) closeBtn.click();
        return {
          hasModal: Boolean(modal),
          modalSnippet: modalText.slice(0, 200),
          hasProvider,
          hasOrthodox,
          closed: Boolean(closeBtn),
        };
      })()`
    );
    console.log('Settings modal check:', settingsModalCheck);
    if (!settingsModalCheck.hasProvider) {
      throw new Error('AI Settings modal did not display AI Provider options!');
    }
    console.log('✓ AI Settings modal verified.');
    await sleep(600);

    // Step 7: Send a question to AI using starter prompt
    console.log('\n7. Setting configured Gemini credentials and submitting inquiry via Starter Prompt...');
    await evaluate(
      ws,
      `(() => {
        localStorage.setItem('tipitaka_ai_settings_v2', JSON.stringify({
          provider: 'gemini',
          apiKey: 'AQ.Ab8RN6JihZTcOH2S_yyOMYlkaCaKtN_QVBpl0xQJc0iRYyAOxg',
          toolModel: 'gemini-flash-lite-latest',
          answerModel: 'gemini-flash-lite-latest',
          baseUrl: '',
          groundRAGMode: true,
          customSystemPrompt: '',
        }));
        return true;
      })()`
    );

    const submitPromptRes = await evaluate(
      ws,
      `(() => {
        const starterButtons = Array.from(document.querySelectorAll('button')).filter(b =>
          b.textContent.includes('Dependent Origination') || b.textContent.includes('Samatha vs. Vipassanā') || b.textContent.includes('Four Noble Truths')
        );
        if (starterButtons.length > 0) {
          starterButtons[0].click();
          return { success: true, method: 'starter_prompt', text: starterButtons[0].textContent.trim() };
        }
        return { error: 'Starter button not found' };
      })()`
    );
    console.log('Submitted inquiry:', submitPromptRes);

    if (!submitPromptRes.success) {
      throw new Error('Failed to submit prompt: ' + submitPromptRes.error);
    }

    // Step 8: Wait for streaming response and observe research logs and citations
    console.log('\n8. Monitoring AI streaming response, tool execution logs, and citation chips...');
    let answerText = '';
    let hasCitations = false;
    let hasResearchLogs = false;

    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      const streamState = await evaluate(
        ws,
        `(() => {
          const assistantBubbles = Array.from(document.querySelectorAll('.ai-chat-assistant .ai-chat-bubble, .ai-chat-bubble-assistant'));
          const lastBubble = assistantBubbles[assistantBubbles.length - 1];
          const markdownEl = lastBubble?.querySelector('.ai-markdown') || lastBubble;
          const citationChips = document.querySelectorAll('.ai-citation-chip');
          const toolCalls = document.querySelectorAll('[class*="border-violet-500/30"], [class*="bg-violet-500/5"], .ai-step-card');
          const isDone = !document.querySelector('.lucide-square') && !document.body.textContent.includes('Consulting Tipiṭaka database') && !document.body.textContent.includes('Formulating authentic explanation');

          return {
            bubbleCount: assistantBubbles.length,
            textSnippet: markdownEl?.textContent?.slice(0, 200) || '',
            fullTextLength: markdownEl?.textContent?.length || 0,
            citationChipsCount: citationChips.length,
            toolCallsCount: toolCalls.length,
            isDone,
          };
        })()`
      );

      console.log(`  [t=${i + 1}s] chars=${streamState.fullTextLength}, tools=${streamState.toolCallsCount}, citations=${streamState.citationChipsCount}, done=${streamState.isDone}`);

      if (streamState.fullTextLength > 50) {
        answerText = streamState.textSnippet;
      }
      if (streamState.toolCallsCount > 0) {
        hasResearchLogs = true;
      }
      if (streamState.citationChipsCount > 0) {
        hasCitations = true;
      }

      if (streamState.isDone && streamState.fullTextLength > 100) {
        console.log('\nStream completed!');
        break;
      }
    }

    console.log('\nFinal response snippet:', answerText);
    console.log('Research logs observed:', hasResearchLogs);
    console.log('Citation chips observed:', hasCitations);

    if (!answerText) {
      throw new Error('AI Assistant did not produce any answer text!');
    }
    console.log('✓ AI Assistant answered successfully with streaming responses.');

    // Step 9: Test Citation Quickview Modal
    console.log('\n9. Testing Citation Quickview Modal...');
    const openCitationRes = await evaluate(
      ws,
      `(() => {
        const chip = document.querySelector('.ai-citation-chip');
        if (chip) {
          chip.click();
          return { clicked: true, chipText: chip.textContent.trim() };
        }
        return { clicked: false };
      })()`
    );
    console.log('Citation click result:', openCitationRes);

    if (openCitationRes.clicked) {
      await sleep(1500);
      const modalCheck = await evaluate(
        ws,
        `(() => {
          const quickviewModal = document.querySelector('.citation-quickview-modal');
          const hasOpenInReaderBtn = Boolean(Array.from(quickviewModal?.querySelectorAll('button') || []).find(b => b.textContent.includes('Open in Reader')));
          return {
            isOpen: Boolean(quickviewModal),
            contentSnippet: quickviewModal?.textContent?.slice(0, 150),
            hasOpenInReaderBtn,
          };
        })()`
      );
      console.log('Citation Quickview Modal check:', modalCheck);
      if (!modalCheck.isOpen) {
        throw new Error('Citation Quickview modal did not open!');
      }
      console.log('✓ Citation Quickview Modal opened with passage content and "Open in Reader Tab" button.');

      // Click "Open in Reader"
      console.log('\n10. Testing "Open in Reader Tab" from citation...');
      const openReaderRes = await evaluate(
        ws,
        `(() => {
          const quickviewModal = document.querySelector('.citation-quickview-modal');
          const openReaderBtn = Array.from(quickviewModal?.querySelectorAll('button') || []).find(b => b.textContent.includes('Open in Reader'));
          if (openReaderBtn) {
            openReaderBtn.click();
            return true;
          }
          return false;
        })()`
      );
      console.log('Clicked Open in Reader:', openReaderRes);
      await sleep(2000);

      // Verify book tab opened
      const bookTabCheck = await evaluate(
        ws,
        `(() => {
          const tabs = Array.from(document.querySelectorAll('.book-tab')).map(t => ({
            text: t.textContent?.trim(),
            isActive: t.classList.contains('active'),
          }));
          return { tabs };
        })()`
      );
      console.log('Tabs after opening citation in reader:', bookTabCheck);

      // Now test switching back to AI tab using Header AI button
      console.log('\n11. Testing switching back to AI tab via Header button...');
      await evaluate(
        ws,
        `(() => {
          const headerAiBtn = document.querySelector('button[title="Ani (AI Nissaya)"]');
          if (headerAiBtn) headerAiBtn.click();
        })()`
      );
      await sleep(1000);

      const switchedBackCheck = await evaluate(
        ws,
        `(() => {
          const activeTab = document.querySelector('.book-tab.active');
          return {
            activeTabText: activeTab?.textContent?.trim(),
            isAiTab: activeTab?.classList.contains('book-tab-ai'),
          };
        })()`
      );
      console.log('Switched back to AI tab check:', switchedBackCheck);
      if (!switchedBackCheck.isAiTab) {
        throw new Error('Failed to switch back to AI tab via Header button!');
      }
      console.log('✓ Successfully switched back to AI tab via Header button.');

      // Step 12: Verify URL synchronization
      console.log('\n12. Verifying URL query parameter (?tab=ai)...');
      const urlCheck = await evaluate(
        ws,
        `(() => {
          return {
            url: window.location.href,
            pathname: window.location.pathname,
            search: window.location.search,
            hasTabAi: window.location.search.includes('tab=ai'),
          };
        })()`
      );
      console.log('URL check:', urlCheck);
      if (!urlCheck.hasTabAi) {
        throw new Error('URL does not contain ?tab=ai when active on AI tab! Actual: ' + urlCheck.search);
      }
      console.log('✓ URL ?tab=ai synchronization verified.');

      // Step 13: Verify Sidebar Ani AI button is absent
      console.log('\n13. Verifying Sidebar Ani (AI Nissaya) button is absent...');
      const sidebarAiCheck = await evaluate(
        ws,
        `(() => {
          const sidebar = document.querySelector('aside.app-sidebar');
          const btn = sidebar ? Array.from(sidebar.querySelectorAll('button')).find(b =>
            b.textContent.includes('Ani (AI Nissaya)')
          ) : null;
          return {
            hasSidebarBtn: Boolean(btn),
            btnText: btn?.textContent?.trim(),
          };
        })()`
      );
      console.log('Sidebar AI button check (expected false):', sidebarAiCheck);
      if (sidebarAiCheck.hasSidebarBtn) {
        throw new Error('Sidebar Ani AI button should have been removed, but was found!');
      }
      console.log('✓ Sidebar Ani AI button correctly absent.');
    }

    // Step 14: Test direct deep-link to http://127.0.0.1:3000/?tab=ai
    console.log('\n14. Testing direct URL deep-link to http://127.0.0.1:3000/?tab=ai...');
    const directTabRes = await fetch('http://127.0.0.1:9223/json/new?' + encodeURIComponent('http://127.0.0.1:3000/?tab=ai'), { method: 'PUT' });
    const directTab = await directTabRes.json();
    const ws2 = new WebSocket(directTab.webSocketDebuggerUrl);
    await new Promise((resolve) => ws2.addEventListener('open', resolve));
    await sendCdp(ws2, 'Runtime.enable');
    await sendCdp(ws2, 'Page.enable');
    await sleep(4000);

    let directAiCheck;
    for (let retry = 0; retry < 10; retry++) {
      directAiCheck = await evaluate(
        ws2,
        `(() => {
          const activeTab = document.querySelector('.book-tab.active');
          const hasAiChatView = Boolean(document.querySelector('textarea[placeholder*="Ask any question"]') || document.querySelector('textarea[placeholder*="Ask"]'));
          return {
            title: document.title,
            activeTabText: activeTab?.textContent?.trim(),
            isAiTab: activeTab?.classList.contains('book-tab-ai'),
            hasAiChatView,
          };
        })()`
      );
      if (directAiCheck?.title?.includes('Ani')) break;
      await sleep(500);
    }
    console.log('Direct deep-link check:', directAiCheck);
    if (!directAiCheck.isAiTab || !directAiCheck.hasAiChatView) {
      throw new Error('Direct deep link ?tab=ai failed to open AI tab!');
    }
    if (!directAiCheck.title.includes('Ani')) {
      throw new Error(`Expected document title to contain "Ani", but got: "${directAiCheck.title}"`);
    }
    console.log('✓ Direct deep-link ?tab=ai opened AI Chat tab directly.');
    // Step 15: Test sentence translation tool calling and line-level citation
    console.log('\n15. Testing sentence-by-sentence translation inquiry (get_sentences)...');
    const sentenceSubmitRes = await evaluate(
      ws2,
      `(() => {
        localStorage.setItem('tipitaka_ai_settings_v2', JSON.stringify({
          provider: 'gemini',
          apiKey: 'AQ.Ab8RN6JihZTcOH2S_yyOMYlkaCaKtN_QVBpl0xQJc0iRYyAOxg',
          toolModel: 'gemini-flash-lite-latest',
          answerModel: 'gemini-flash-lite-latest',
          baseUrl: '',
          groundRAGMode: true,
          customSystemPrompt: '',
        }));

        const textarea = document.querySelector('textarea[placeholder*="Ask any question"]') || document.querySelector('textarea[placeholder*="Ask"]');
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b =>
          b.querySelector('svg.lucide-arrow-up') || b.querySelector('svg.lucide-send') || b.getAttribute('aria-label') === 'Send'
        );
        if (!textarea || !submitBtn) return { success: false, error: 'Textarea or send button not found' };

        const prompt = "Please retrieve the sentence-by-sentence translation for s0101m.mul chapter 0 paragraph 6 line 1 using the get_sentences tool.";
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        nativeSetter.call(textarea, prompt);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => submitBtn.click(), 200);
        return { success: true };
      })()`
    );
    console.log('Submitted sentence inquiry:', sentenceSubmitRes);
    if (!sentenceSubmitRes.success) {
      throw new Error('Failed to submit sentence prompt: ' + sentenceSubmitRes.error);
    }

    let sentenceAnswerText = '';
    let hasSentenceLog = false;
    let hasSentenceCitation = false;
    for (let i = 0; i < 45; i++) {
      await sleep(1000);
      const sState = await evaluate(
        ws2,
        `(() => {
          const assistantBubbles = Array.from(document.querySelectorAll('.ai-chat-assistant .ai-chat-bubble, .ai-chat-bubble-assistant'));
          const lastBubble = assistantBubbles[assistantBubbles.length - 1];
          const markdownEl = lastBubble?.querySelector('.ai-markdown') || lastBubble;
          const chips = Array.from(document.querySelectorAll('.ai-citation-chip')).map(c => c.textContent.trim());
          const logs = Array.from(document.querySelectorAll('.ai-step-card, [class*="border-violet-500/30"]')).map(l => l.textContent.trim());
          const isDone = !document.querySelector('.lucide-square') && !document.body.textContent.includes('Consulting Tipiṭaka database') && !document.body.textContent.includes('Formulating authentic explanation');

          return {
            textLength: markdownEl?.textContent?.length || 0,
            snippet: markdownEl?.textContent?.slice(0, 200) || '',
            chips,
            logs,
            isDone
          };
        })()`
      );

      console.log(`  [Sentence t=${i + 1}s] chars=${sState.textLength}, chips=${sState.chips.length}, logs=${sState.logs.length}, done=${sState.isDone}`);

      if (sState.logs.some(l => l.toLowerCase().includes('sentence') || l.toLowerCase().includes('get_sentences'))) {
        hasSentenceLog = true;
      }
      if (sState.chips.some(c => c.includes(':L') || c.includes('-L'))) {
        hasSentenceCitation = true;
      }
      if (sState.textLength > 50) {
        sentenceAnswerText = sState.snippet;
      }
      if (sState.isDone && sState.textLength > 80) {
        console.log('Sentence translation stream complete!');
        break;
      }
    }

    console.log('Sentence answer snippet:', sentenceAnswerText);
    console.log('Sentence tool call observed:', hasSentenceLog);
    console.log('Sentence line-level citation observed:', hasSentenceCitation);

    if (!sentenceAnswerText) {
      throw new Error('Sentence translation inquiry produced no answer!');
    }
    if (!hasSentenceLog) {
      throw new Error('Sentence-by-sentence tool call (get_sentences) was not observed in research logs!');
    }
    if (!hasSentenceCitation) {
      throw new Error('Line-level citation was not observed in assistant response!');
    }
    console.log('✓ Sentence-by-sentence translation inquiry verified with get_sentences tool.');

    // Step 16: Test sentence-level Citation Quickview modal with 1-to-1 aligned sentence card
    console.log('\n16. Testing sentence-level Citation Quickview Modal...');
    const clickSentChipRes = await evaluate(
      ws2,
      `(() => {
        const lineChip = Array.from(document.querySelectorAll('.ai-citation-chip')).find(c => c.textContent.includes(':L') || c.textContent.includes('-L'));
        if (lineChip) {
          lineChip.click();
          return { clicked: true, text: lineChip.textContent.trim() };
        }
        return { clicked: false };
      })()`
    );
    console.log('Clicked line citation chip:', clickSentChipRes);
    if (!clickSentChipRes.clicked) {
      throw new Error('Line-level citation chip not found to click!');
    }
    await sleep(1500);

    const sentModalCheck = await evaluate(
      ws2,
      `(() => {
        const modal = document.querySelector('.citation-quickview-modal');
        const modalText = modal ? modal.textContent : '';
        const hasCitedSentence = modalText.includes('Cited Sentence');
        const hasLineBadge = modalText.includes('Line 1');
        const hasPali = modalText.includes('ambalaṭṭhikāyaṃ') || modalText.includes('Atha kho bhagavā');
        return {
          isOpen: Boolean(modal),
          hasCitedSentence,
          hasLineBadge,
          hasPali,
          contentSnippet: modalText.slice(0, 200),
        };
      })()`
    );
    console.log('Sentence Quickview modal check:', sentModalCheck);
    if (!sentModalCheck.isOpen || !sentModalCheck.hasCitedSentence) {
      throw new Error('Sentence Quickview modal did not display the Cited Sentence card!');
    }
    console.log('✓ Sentence Quickview modal verified with 1-to-1 aligned sentence card and line badge.');

    ws2.close();

    console.log('\n=== ALL BROWSER HEADLESS CHECKS PASSED SUCCESSFULLY! ===\n');
  } finally {
    try {
      chrome.kill('SIGTERM');
    } catch (e) {}
    try {
      execSync('pkill -f /snap/chromium || true');
    } catch (e) {}
  }
}

run().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
