'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  Square,
  Sparkles,
  Settings,
  Plus,
  Trash2,
  Copy,
  Check,
  RotateCcw,
  ShieldCheck,
  BookOpen,
  Quote,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  ExternalLink,
  Loader2,
  History,
  Bot,
  Search,
  FileText,
  Bookmark,
  Compass,
} from 'lucide-react';
import AiMarkdown from './AiMarkdown';
import AiSettingsModal, { getStoredAiSettings, DEFAULT_AI_SETTINGS } from './AiSettingsModal';
import CitationQuickviewModal from './CitationQuickviewModal';
import { useTabs } from '../../context/TabContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { convertPaliScript } from '../../services/transliterate';

const THREADS_STORAGE_KEY = 'tipitaka_ai_threads_v1';
const MESSAGES_STORAGE_KEY = 'tipitaka_ai_messages_v1';

const STARTER_PROMPTS = [
  {
    title: '12 Links of Dependent Origination',
    desc: 'Explain the 12 links of Paṭiccasamuppāda with canonical citations',
    query: 'Explain the twelve links of Paṭiccasamuppāda (Dependent Origination) with their canonical definitions from SN 12.2 and relevant suttas.',
  },
  {
    title: 'Samatha vs. Vipassanā',
    desc: 'Explore the two wings of serenity and insight in the suttas',
    query: 'What is the exact distinction and relationship between Samatha (tranquillity) and Vipassanā (insight) in the Pāli Canon? Quote key passages.',
  },
  {
    title: 'Four Noble Truths (12 Aspects)',
    desc: 'The 3 turns and 12 aspects (tiparivaṭṭaṃ dvādasākāraṃ)',
    query: 'Explain the Dhammacakkappavattana Sutta’s teaching on the Twelve Aspects of the Four Noble Truths (sacca-ñāṇa, kicca-ñāṇa, kata-ñāṇa).',
  },
  {
    title: 'Teachings on Gratitude',
    desc: 'Passages on Kataññū-katavedī (gratitude and reciprocity)',
    query: 'Find canonical discourses where the Buddha explains the virtue of gratitude (kataññū katavedī) towards parents and teachers.',
  },
];

function getToolMeta(toolName) {
  switch (toolName) {
    case 'search_sections':
      return { label: 'Sutta & Section Search', icon: Compass, color: 'text-blue-500 dark:text-blue-400' };
    case 'search_tipitaka':
    case 'search_by_category':
    case 'search_tipitaka_batch':
      return { label: 'Full-Text Canon Search', icon: Search, color: 'text-amber-500 dark:text-amber-400' };
    case 'get_paragraph_content':
    case 'get_paragraph_content_batch':
      return { label: 'Passage Fetch', icon: BookOpen, color: 'text-emerald-500 dark:text-emerald-400' };
    case 'get_commentaries':
      return { label: 'Aṭṭhakathā & Ṭīkā Review', icon: FileText, color: 'text-purple-500 dark:text-purple-400' };
    case 'get_dictionary':
    case 'get_dictionary_batch':
      return { label: 'DPD Pāli Lexicon', icon: Bookmark, color: 'text-cyan-500 dark:text-cyan-400' };
    case 'final_answer':
      return { label: 'Synthesis', icon: Sparkles, color: 'text-violet-500 dark:text-violet-400' };
    default:
      return { label: toolName || 'Tool Execution', icon: Bot, color: 'text-violet-500 dark:text-violet-400' };
  }
}

export default function AiChatView({ initialQuery = null }) {
  const { openBook } = useTabs();
  const { settings: themeSettings } = useThemeSettings();

  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputQuery, setInputQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [aiSettings, setAiSettings] = useState(DEFAULT_AI_SETTINGS);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [expandedToolCalls, setExpandedToolCalls] = useState({});
  const [isThreadMenuOpen, setIsThreadMenuOpen] = useState(false);
  const threadMenuRef = useRef(null);

  const abortControllerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // 1. Initialize settings & load threads
  useEffect(() => {
    setAiSettings(getStoredAiSettings());

    try {
      const rawThreads = localStorage.getItem(THREADS_STORAGE_KEY);
      const parsedThreads = rawThreads ? JSON.parse(rawThreads) : [];
      if (Array.isArray(parsedThreads) && parsedThreads.length > 0) {
        let changed = false;
        const migratedThreads = parsedThreads.map((t) => {
          if (t.title && /v[iī]ma[ṃm]s[aā]/i.test(t.title)) {
            changed = true;
            return {
              ...t,
              title: t.title.replace(/v[iī]ma[ṃm]s[aā]\s*(?:ai)?/gi, 'Ani (AI Nissaya)').trim(),
            };
          }
          return t;
        });
        if (changed) {
          localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(migratedThreads));
        }
        setThreads(migratedThreads);
        setActiveThreadId(migratedThreads[0].id);
      } else {
        // Create initial thread
        const newId = `thread_${Date.now()}`;
        const newThread = {
          id: newId,
          title: 'Ask Ani',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setThreads([newThread]);
        setActiveThreadId(newId);
        localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify([newThread]));
      }
    } catch (e) {
      console.warn('Failed to load threads:', e);
    }
  }, []);

  // 2. Load messages for active thread
  useEffect(() => {
    if (!activeThreadId) return;
    try {
      const rawMsgs = localStorage.getItem(MESSAGES_STORAGE_KEY);
      const allMsgs = rawMsgs ? JSON.parse(rawMsgs) : {};
      const threadMsgs = allMsgs[activeThreadId] || [];
      setMessages(threadMsgs);
    } catch (e) {
      setMessages([]);
    }
  }, [activeThreadId]);

  // 3. Auto-scroll to bottom
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior, block: 'end' });
    }
  }, []);

  useEffect(() => {
    scrollToBottom('smooth');
  }, [messages, isGenerating, statusMessage, scrollToBottom]);

  // 4. Save messages to localStorage helper
  const saveThreadMessages = (threadId, newMessages) => {
    try {
      const rawMsgs = localStorage.getItem(MESSAGES_STORAGE_KEY);
      const allMsgs = rawMsgs ? JSON.parse(rawMsgs) : {};
      allMsgs[threadId] = newMessages;
      localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(allMsgs));
    } catch (e) {}
  };

  // 5. Create new thread
  const handleNewThread = () => {
    const newId = `thread_${Date.now()}`;
    const newThread = {
      id: newId,
      title: 'Ask Ani',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const nextThreads = [newThread, ...threads];
    setThreads(nextThreads);
    setActiveThreadId(newId);
    setMessages([]);
    localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(nextThreads));
    if (textareaRef.current) textareaRef.current.focus();
  };

  // 6. Delete thread
  const handleDeleteThread = (threadId, e) => {
    if (e) e.stopPropagation();
    const remaining = threads.filter((t) => t.id !== threadId);
    try {
      const rawMsgs = localStorage.getItem(MESSAGES_STORAGE_KEY);
      const allMsgs = rawMsgs ? JSON.parse(rawMsgs) : {};
      delete allMsgs[threadId];
      localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(allMsgs));
    } catch (e) {}

    if (remaining.length === 0) {
      handleNewThread();
    } else {
      setThreads(remaining);
      setActiveThreadId(remaining[0].id);
      localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(remaining));
    }
  };

  // 6b. Clear all chat history (fresh start)
  const handleClearAllThreads = () => {
    try {
      localStorage.removeItem(MESSAGES_STORAGE_KEY);
    } catch (e) {}
    const newId = `thread_${Date.now()}`;
    const freshThread = {
      id: newId,
      title: 'Ask Ani',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setThreads([freshThread]);
    setActiveThreadId(newId);
    setMessages([]);
    try {
      localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify([freshThread]));
    } catch (e) {}
    setIsThreadMenuOpen(false);
    if (textareaRef.current) textareaRef.current.focus();
  };

  // 6c. Close thread history menu on outside click / Escape
  useEffect(() => {
    if (!isThreadMenuOpen) return;
    const onPointerDown = (e) => {
      if (threadMenuRef.current && !threadMenuRef.current.contains(e.target)) {
        setIsThreadMenuOpen(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setIsThreadMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isThreadMenuOpen]);

  // 7. Auto-title thread from first message
  const updateThreadTitle = (threadId, query) => {
    let clean = query.trim().split('\n')[0].trim();
    if (clean.length > 36) clean = clean.slice(0, 34) + '…';
    clean = clean.replace(/[?.,;!]+$/, '');

    setThreads((prev) => {
      const updated = prev.map((t) => (t.id === threadId ? { ...t, title: clean, updatedAt: new Date().toISOString() } : t));
      try {
        localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  // 8. Execute Question Submission & Streaming Runner
  const handleSendMessage = async (textToSend) => {
    const query = (textToSend || inputQuery).trim();
    if (!query || isGenerating) return;

    setInputQuery('');
    const userMsgId = `usr_${Date.now()}`;
    const assistantMsgId = `ast_${Date.now()}`;

    const userMessage = {
      id: userMsgId,
      role: 'user',
      content: query,
      timestamp: new Date().toISOString(),
    };

    const initialAssistantMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      toolCalls: [],
      citations: [],
      timestamp: new Date().toISOString(),
      isStreaming: true,
    };

    const nextMessages = [...messages, userMessage, initialAssistantMessage];
    setMessages(nextMessages);
    setIsGenerating(true);
    setStatusMessage('Consulting Tipiṭaka database…');

    // Title thread if it was default
    const currentThread = threads.find((t) => t.id === activeThreadId);
    if (currentThread && (currentThread.title === 'Ask Ani' || currentThread.title === 'New Investigation' || messages.length === 0)) {
      updateThreadTitle(activeThreadId, query);
    }

    // Prepare API call
    const currentSettings = getStoredAiSettings();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const payload = {
        messages: nextMessages
          .filter((m) => m.id !== assistantMsgId)
          .map((m) => ({ role: m.role, content: m.content })),
        apiKey: currentSettings.apiKey || '',
        provider: currentSettings.provider || 'gemini',
        toolModel: currentSettings.toolModel || 'gemini-2.0-flash',
        answerModel: currentSettings.answerModel || 'gemini-2.0-flash',
        orthodoxMode: currentSettings.orthodoxMode !== false,
        customSystemPrompt: currentSettings.customSystemPrompt || '',
        baseUrl: currentSettings.baseUrl || '',
      };

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';
      const toolCalls = [];
      let citations = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = 'message';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.substring(7).trim();
            continue;
          }
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.substring(6).trim();
            try {
              const data = JSON.parse(dataStr);
              if (currentEvent === 'status') {
                setStatusMessage(data.message || '');
              } else if (currentEvent === 'tool_call') {
                toolCalls.push(data);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId ? { ...m, toolCalls: [...toolCalls] } : m
                  )
                );
              } else if (currentEvent === 'token') {
                accumulatedContent += data.text || '';
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: accumulatedContent, toolCalls: [...toolCalls] }
                      : m
                  )
                );
              } else if (currentEvent === 'citations') {
                citations = data.citations || [];
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId ? { ...m, citations } : m
                  )
                );
              } else if (currentEvent === 'error') {
                accumulatedContent += `\n\n> ⚠️ **Error:** ${data.message || 'Generation failed'}`;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId ? { ...m, content: accumulatedContent } : m
                  )
                );
              }
            } catch (err) {}
          }
        }
      }

      // Finalize message
      const finalizedMessages = nextMessages.map((m) =>
        m.id === assistantMsgId
          ? {
              ...m,
              content: accumulatedContent,
              toolCalls,
              citations,
              isStreaming: false,
            }
          : m
      );
      setMessages(finalizedMessages);
      saveThreadMessages(activeThreadId, finalizedMessages);
    } catch (err) {
      if (err.name === 'AbortError') {
        // User stopped generation
      } else {
        const errorText = `\n\n> ⚠️ **Investigation Error:** ${err.message || 'Unable to connect to service.'} Please check your settings.`;
        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: (m.content || '') + errorText, isStreaming: false }
              : m
          );
          saveThreadMessages(activeThreadId, updated);
          return updated;
        });
      }
    } finally {
      setIsGenerating(false);
      setStatusMessage('');
      abortControllerRef.current = null;
    }
  };

  const handleStopGenerating = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleCitationClick = (citation) => {
    setSelectedCitation(citation);
  };

  const handleOpenInReader = (bookCode, chapterIndex, paraIndex, paraNum) => {
    openBook(bookCode, {
      targetChapterIdx: chapterIndex,
      targetParaIndex: paraIndex,
      targetParaNum: paraNum,
    });
  };

  const handleCopyMessage = (id, text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRetryLastMessage = () => {
    if (messages.length === 0 || isGenerating) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      handleSendMessage(lastUserMsg.content);
    }
  };

  const activeThread = threads.find((t) => t.id === activeThreadId);

  return (
    <div className="ai-chat-view flex flex-col h-full w-full bg-[var(--bg-primary)] overflow-hidden">
      {/* ── Chat Header Toolbar ────────────────────────────────────────── */}
      <header className="px-3 sm:px-5 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between shrink-0 select-none z-10">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow-xs shrink-0">
            <Bot size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="font-bold text-xs sm:text-sm text-[var(--text-primary)] truncate max-w-[200px] sm:max-w-[340px]">
                {activeThread?.title || 'Ani (AI Nissaya)'}
              </h2>
              <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-600 dark:text-violet-400 shrink-0">
                Beta
              </span>
              {/* RAG Mode indicator badge */}
              <span
                onClick={() => setIsSettingsOpen(true)}
                className={`text-[9.5px] font-semibold px-2 py-0.5 rounded-full border cursor-pointer flex items-center gap-1 transition ${
                  aiSettings.orthodoxMode !== false
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20'
                }`}
                title="Click to toggle between RAG Mode & Knowledge Mode"
              >
                <ShieldCheck size={10} />
                <span>{aiSettings.orthodoxMode !== false ? 'RAG Mode' : 'Knowledge'}</span>
              </span>
            </div>
            <p className="text-[10.5px] text-[var(--text-muted)] truncate hidden sm:block">
              Question / Study Assistant with AI with canonical Tipiṭaka verification
            </p>
          </div>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Chat History Menu (recent conversations — distinct from app Reading History) */}
          <div className="relative" ref={threadMenuRef}>
            <button
              type="button"
              onClick={() => setIsThreadMenuOpen((v) => !v)}
              className={`p-1.5 rounded-lg transition cursor-pointer border ${
                isThreadMenuOpen
                  ? 'border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-400'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-500/10'
              }`}
              title="Recent chats"
              aria-label="Recent chats"
            >
              <History size={16} />
            </button>

            {isThreadMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-64 max-w-[80vw] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl z-50 overflow-hidden animate-fade-in text-left">
                <div className="px-3 py-2 border-b border-[var(--border-color)]/60 flex items-center gap-1.5 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                  <History size={12} className="text-violet-500" />
                  <span>Recent chats</span>
                </div>
                <div className="max-h-64 overflow-y-auto p-1">
                  {threads.length === 0 && (
                    <div className="px-3 py-4 text-xs text-[var(--text-muted)] text-center">
                      No conversations yet
                    </div>
                  )}
                  {threads.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => {
                        setActiveThreadId(t.id);
                        setIsThreadMenuOpen(false);
                      }}
                      className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs cursor-pointer transition ${
                        t.id === activeThreadId
                          ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300 font-semibold'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                      title={t.title}
                    >
                      <MessageSquare size={13} className="shrink-0 opacity-70" />
                      <span className="flex-1 truncate">{t.title}</span>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteThread(t.id, e)}
                        className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-500 transition shrink-0"
                        title="Delete this chat"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="border-t border-[var(--border-color)]/60 p-1">
                  <button
                    type="button"
                    onClick={handleClearAllThreads}
                    className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold text-red-500 hover:bg-red-500/10 transition cursor-pointer"
                    title="Delete all conversations and start fresh"
                  >
                    <Trash2 size={13} />
                    <span>Clear all history</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* New Chat Button */}
          <button
            type="button"
            onClick={handleNewThread}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] hover:border-violet-500 hover:text-violet-600 dark:hover:text-violet-400 text-xs font-semibold text-[var(--text-secondary)] transition cursor-pointer shadow-2xs"
            title="Ask Ani (+)"
          >
            <Plus size={13} className="text-violet-500" />
            <span className="hidden sm:inline">New</span>
          </button>

          {/* Delete Thread */}
          {activeThreadId && (
            <button
              type="button"
              onClick={(e) => handleDeleteThread(activeThreadId, e)}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-500 hover:bg-red-500/10 transition cursor-pointer"
              title="Delete this conversation"
            >
              <Trash2 size={14} />
            </button>
          )}

          {/* Settings Button */}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-500/10 transition cursor-pointer"
            title="AI Configuration & API Keys"
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      {/* ── Messages Scroll Area ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-6">
        {/* Welcome Empty State */}
        {messages.length === 0 && (
          <div className="max-w-2xl mx-auto py-8 sm:py-12 space-y-8 animate-fade-in text-center">
            <div className="flex flex-col items-center gap-3">
              <img src="/ani-tipitakapali-org.svg" alt="Ani mascot" className="w-20 h-20 sm:w-24 sm:h-24 object-contain drop-shadow-md" />
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)] flex items-center gap-2">
                Ask Ani
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-600 dark:text-violet-400">
                  Beta
                </span>
              </h1>
              <p className="text-xs sm:text-sm text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
                Your dedicated AI companion for studying the Tipiṭaka. Direct citations, term deconstruction, and commentary insights.
              </p>
            </div>

            {/* Starter Suggestion Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
              {STARTER_PROMPTS.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSendMessage(p.query)}
                  className="p-3.5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] hover:border-violet-500/60 hover:shadow-md transition text-left group cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    <h3 className="text-xs font-bold text-[var(--text-primary)] group-hover:text-violet-600 dark:group-hover:text-violet-400 transition flex items-center gap-1.5">
                      <Sparkles size={12} className="text-violet-500" />
                      {p.title}
                    </h3>
                    <p className="text-[11px] text-[var(--text-muted)] mt-1 line-clamp-2 leading-relaxed">
                      {p.desc}
                    </p>
                  </div>
                  <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 mt-2 opacity-0 group-hover:opacity-100 transition">
                    Ask Ani →
                  </span>
                </button>
              ))}
            </div>

            {!aiSettings.apiKey && (
              <div className="p-3.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-xs text-violet-900 dark:text-violet-200 flex items-center justify-between gap-3 text-left">
                <div>
                  <span className="font-bold">Tip: </span>
                  Add your free Google Gemini API Key in Settings to enable deep generative synthesis. Local canonical search is active.
                </div>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-violet-600 text-white font-semibold text-[11px] hover:bg-violet-700 transition shrink-0 cursor-pointer"
                >
                  Configure Key
                </button>
              </div>
            )}
          </div>
        )}

        {/* Message Stream */}
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          const isExpanded = expandedToolCalls[msg.id] ?? Boolean(msg.isStreaming);

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-3xl mx-auto w-full`}
            >
              {/* Message Header */}
              <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px] font-semibold text-[var(--text-muted)]">
                {isUser ? (
                  <span>You</span>
                ) : (
                  <span className="flex items-center gap-1.5 text-violet-600 dark:text-violet-400">
                    <Bot size={14} className="shrink-0 inline-block" />
                    <span>Ani</span>
                  </span>
                )}
                <span>•</span>
                <span className="font-normal text-[10px]">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {/* Message Bubble */}
              <div
                className={`w-full rounded-2xl p-4 sm:p-5 shadow-2xs leading-relaxed ${
                  isUser
                    ? 'bg-violet-600/10 text-[var(--text-primary)] border border-violet-500/20 rounded-tr-xs'
                    : 'bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-color)] rounded-tl-xs'
                }`}
              >
                {/* Collapsible Research / Tool Calling card for Assistant */}
                {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mb-4 rounded-xl border border-violet-500/20 bg-violet-500/5 overflow-hidden text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedToolCalls((prev) => ({ ...prev, [msg.id]: !isExpanded }))
                      }
                      className="w-full px-3 py-2 flex items-center justify-between text-violet-700 dark:text-violet-300 font-semibold hover:bg-violet-500/10 transition cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <BookOpen size={13} className="text-violet-500 shrink-0" />
                        <span>
                          Canonical Research ({msg.toolCalls.length} step{msg.toolCalls.length > 1 ? 's' : ''})
                        </span>
                        {msg.isStreaming && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-full bg-violet-500/20 text-violet-600 dark:text-violet-300 animate-pulse font-normal">
                            <Loader2 size={10} className="animate-spin" />
                            Researching...
                          </span>
                        )}
                      </span>
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {isExpanded && (
                      <div className="p-3 pt-1 space-y-1.5 border-t border-violet-500/15 text-[11px] text-[var(--text-secondary)]">
                        {msg.toolCalls.map((tc, idx) => {
                          const meta = getToolMeta(tc.tool);
                          const IconComp = meta.icon;
                          const paramDesc = tc.args?.query
                            ? `"${tc.args.query}"`
                            : tc.args?.book_code
                            ? `${tc.args.book_code}${tc.args.para_start ? ` §${tc.args.para_start}` : tc.args.para_number ? ` §${tc.args.para_number}` : ''}`
                            : tc.args?.terms
                            ? `[${tc.args.terms.join(', ')}]`
                            : '';

                          return (
                            <div key={idx} className="flex items-start gap-2 bg-[var(--bg-card)]/60 p-2 rounded-lg border border-violet-500/10">
                              <IconComp size={13} className={`mt-0.5 shrink-0 ${meta.color}`} />
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                                  <span>{meta.label}</span>
                                  {paramDesc && (
                                    <span className="text-[10px] text-[var(--text-muted)] font-mono truncate max-w-[260px] sm:max-w-[360px]">
                                      {paramDesc}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-[var(--text-secondary)] mt-0.5 break-words">
                                  {tc.summary || (tc.args ? JSON.stringify(tc.args) : tc.tool)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Content Render */}
                {isUser ? (
                  <p className="whitespace-pre-wrap text-sm sm:text-[14.5px] leading-relaxed">
                    {msg.content}
                  </p>
                ) : (
                  <AiMarkdown content={msg.content} onCitationClick={handleCitationClick} />
                )}

                {/* Citations Bar (interactive source chips at message bottom) */}
                {!isUser && msg.citations && msg.citations.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-[var(--border-color)]/70 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wider flex items-center gap-1 mr-1">
                      <Quote size={11} />
                      Sources ({msg.citations.length}):
                    </span>
                    {msg.citations.map((cite, cIdx) => (
                      <button
                        key={cIdx}
                        type="button"
                        onClick={() => handleCitationClick(cite)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-violet-500 hover:text-violet-600 transition cursor-pointer select-none text-[var(--text-secondary)]"
                        title={`Click to preview passage ${cite.ref || `${cite.bookCode} §${cite.paraIndex}`}`}
                      >
                        <span>{cite.ref || `${cite.bookCode} §${cite.paraIndex}`}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Buttons beneath bubble */}
              <div className="flex items-center gap-1.5 mt-1.5 px-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => handleCopyMessage(msg.id, msg.content)}
                  className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition cursor-pointer flex items-center gap-1"
                  title="Copy message"
                >
                  {copiedId === msg.id ? (
                    <Check size={12} className="text-emerald-500" />
                  ) : (
                    <Copy size={12} />
                  )}
                  <span className="text-[10px]">{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                </button>

                {!isUser && (
                  <button
                    type="button"
                    onClick={handleRetryLastMessage}
                    className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition cursor-pointer flex items-center gap-1"
                    title="Regenerate answer"
                  >
                    <RotateCcw size={12} />
                    <span className="text-[10px]">Retry</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Live Generating & Status Indicator */}
        {isGenerating && statusMessage && (
          <div className="max-w-3xl mx-auto w-full flex items-center gap-2 text-xs text-violet-600 dark:text-violet-400 bg-violet-500/10 border border-violet-500/20 px-3.5 py-2 rounded-xl animate-pulse">
            <Loader2 size={14} className="animate-spin shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input Box & Controls Footer ────────────────────────────────── */}
      <footer className="p-3 sm:p-4 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] shrink-0">
        <div className="max-w-3xl mx-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="relative flex items-end gap-2 bg-[var(--bg-card)] border border-[var(--border-color)] focus-within:border-violet-500 rounded-2xl p-1.5 sm:p-2 shadow-sm transition"
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputQuery}
              onChange={(e) => {
                setInputQuery(e.target.value);
                // Auto-expand height
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Ask Ani about suttas, Pāḷi terms, Vinaya, or Abhidhamma…"
              disabled={isGenerating}
              className="flex-1 bg-transparent py-1.5 px-2.5 text-xs sm:text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none resize-none max-h-40 leading-relaxed"
            />

            {/* Send or Stop Button */}
            {isGenerating ? (
              <button
                type="button"
                onClick={handleStopGenerating}
                className="p-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white transition shadow-sm cursor-pointer shrink-0"
                title="Stop generation"
              >
                <Square size={15} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!inputQuery.trim()}
                className="p-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:hover:bg-violet-600 text-white transition shadow-sm cursor-pointer shrink-0"
                title="Send inquiry (Enter)"
              >
                <Send size={15} />
              </button>
            )}
          </form>

          {/* Micro Footer Notice */}
          <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] px-2 mt-1.5">
            <span>
              Citations link directly to CST paragraphs. Shift+Enter for new line.
            </span>
            <span className="font-mono">
              Model: {aiSettings.answerModel}
            </span>
          </div>
        </div>
      </footer>

      {/* ── Settings Modal ─────────────────────────────────────────────── */}
      <AiSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={(newSettings) => setAiSettings(newSettings)}
      />

      {/* ── Citation Quickview Sheet / Modal ───────────────────────────── */}
      <CitationQuickviewModal
        isOpen={!!selectedCitation}
        citation={selectedCitation}
        onClose={() => setSelectedCitation(null)}
        onOpenInReader={handleOpenInReader}
      />
    </div>
  );
}
