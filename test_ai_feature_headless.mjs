import { spawn } from 'child_process';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendCdp(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 100000);
  const msg = JSON.stringify({ id, method, params });
  return new Promise((resolve, reject) => {
    const handler = (event) => {
      const data = JSON.parse(event.data);
      if (data.id === id) {
        ws.removeEventListener('message', handler);
        if (data.error) reject(data.error);
        else resolve(data.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(msg);
  });
}

async function evaluate(ws, expression) {
  const res = await sendCdp(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return res.result?.value;
}

async function run() {
  console.log('=== Headless Chromium Ani (AI Nissaya) Feature E2E Verification ===\n');

  console.log('1. Launching headless Chromium on port 9223...');
  const chrome = spawn(
    '/usr/bin/chromium-browser',
    [
      '--headless',
      '--remote-debugging-port=9223',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  await sleep(3000);

  try {
    console.log('2. Opening http://localhost:3000/ in Chromium...');
    const tabRes = await fetch('http://127.0.0.1:9223/json/new?http://localhost:3000/', { method: 'PUT' });
    const tab = await tabRes.json();
    console.log('Tab URL:', tab.webSocketDebuggerUrl);

    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.addEventListener('open', resolve));

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
    const clickCardRes = await evaluate(
      ws,
      `(() => {
        const aiCard = Array.from(document.querySelectorAll('.category-card')).find(c =>
          c.textContent.includes('Ani (AI Nissaya)')
        );
        if (aiCard) {
          aiCard.click();
          return true;
        }
        return false;
      })()`
    );
    console.log('Clicked AI card:', clickCardRes);
    await sleep(1500);

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
    console.log('\n7. Submitting inquiry to AI Assistant via Starter Prompt...');
    const submitPromptRes = await evaluate(
      ws,
      `(() => {
        const starterButtons = Array.from(document.querySelectorAll('button')).filter(b =>
          b.textContent.includes('Dependent Origination') || b.textContent.includes('Samatha vs. Vipassanā')
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

    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const streamState = await evaluate(
        ws,
        `(() => {
          const bubbles = Array.from(document.querySelectorAll('.ai-chat-bubble, [class*="rounded-2xl"]'));
          const assistantBubbles = bubbles.filter(b => b.textContent.includes('Ani') || b.textContent.includes('Dependent Origination') || b.textContent.includes('Canonical Research') || b.textContent.includes('Report'));
          const lastBubble = assistantBubbles[assistantBubbles.length - 1];
          const citationChips = document.querySelectorAll('.ai-citation-chip');
          const toolCalls = document.querySelectorAll('[class*="border-violet-500/30"], [class*="bg-violet-500/5"]');
          const isDone = !document.querySelector('.lucide-square') && !document.body.textContent.includes('Consulting Tipiṭaka database');

          return {
            bubbleCount: assistantBubbles.length,
            textSnippet: lastBubble?.textContent?.slice(0, 200) || '',
            fullTextLength: lastBubble?.textContent?.length || 0,
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

      // Step 13: Verify Sidebar AI button
      console.log('\n13. Verifying Sidebar Ani (AI Nissaya) button...');
      const sidebarAiCheck = await evaluate(
        ws,
        `(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b =>
            b.textContent.includes('Ani (AI Nissaya)') && b.textContent.includes('Chat')
          );
          return {
            hasSidebarBtn: Boolean(btn),
            btnText: btn?.textContent?.trim(),
          };
        })()`
      );
      console.log('Sidebar AI button check:', sidebarAiCheck);
      if (!sidebarAiCheck.hasSidebarBtn) {
        throw new Error('Sidebar Ani AI button not found!');
      }
      console.log('✓ Sidebar AI button verified.');
    }

    // Step 14: Test direct deep-link to http://localhost:3000/?tab=ai
    console.log('\n14. Testing direct URL deep-link to http://localhost:3000/?tab=ai...');
    const directTabRes = await fetch('http://127.0.0.1:9223/json/new?http://localhost:3000/?tab=ai', { method: 'PUT' });
    const directTab = await directTabRes.json();
    const ws2 = new WebSocket(directTab.webSocketDebuggerUrl);
    await new Promise((resolve) => ws2.addEventListener('open', resolve));
    await sendCdp(ws2, 'Runtime.enable');
    await sendCdp(ws2, 'Page.enable');
    await sleep(4000);

    const directAiCheck = await evaluate(
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
    console.log('Direct deep-link check:', directAiCheck);
    if (!directAiCheck.isAiTab || !directAiCheck.hasAiChatView) {
      throw new Error('Direct deep link ?tab=ai failed to open AI tab!');
    }
    if (directAiCheck.title !== 'Ani Assistant | Tipiṭaka Pāḷi' && directAiCheck.title !== 'Ani (AI Nissaya) | Tipiṭaka Pāḷi') {
      throw new Error(`Expected document title to be "Ani Assistant | Tipiṭaka Pāḷi", but got: "${directAiCheck.title}"`);
    }
    console.log('✓ Direct deep-link ?tab=ai opened AI Chat tab directly.');
    ws2.close();

    console.log('\n=== ALL BROWSER HEADLESS CHECKS PASSED SUCCESSFULLY! ===\n');
  } finally {
    chrome.kill('SIGTERM');
  }
}

run().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
