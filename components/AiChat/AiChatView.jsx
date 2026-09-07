'use client';

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
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
  Brain,
} from 'lucide-react';
import AiMarkdown from './AiMarkdown';
import AiSettingsModal, { getStoredAiSettings, DEFAULT_AI_SETTINGS } from './AiSettingsModal';
import CitationQuickviewModal from './CitationQuickviewModal';
import { runClientAiAgent } from '../../services/aiClientAgent';
import { useTabs } from '../../context/TabContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { convertPaliScript } from '../../services/transliterate';
import { getApiBase } from '../../services/api';

const THREADS_STORAGE_KEY = 'tipitaka_ai_threads_v1';
const MESSAGES_STORAGE_KEY = 'tipitaka_ai_messages_v1';

const STARTER_PROMPTS = [
  {
    title: 'What are the Four Noble Truths?',
    query: 'Explain the Four Noble Truths (cattāri ariyasaccāni) as taught in the Dhammacakkappavattana Sutta (SN 56.11), with canonical definitions of each truth.',
  },
  {
    title: 'What is Mahāsatipaṭṭhāna?',
    query: 'Explain the four foundations of mindfulness (satipaṭṭhāna) — body, feelings, mind and dhammas — as taught in the Mahāsatipaṭṭhāna Sutta (DN 22).',
  },
  {
    title: 'What is Sīla?',
    query: 'What is sīla (virtue, moral conduct) in the Pāli Canon? Explain its role as the foundation of the gradual training (anupubbasikkhā) with key canonical passages.',
  },
  {
    title: 'Tìm giúp tôi bài kinh có tên giống như mật hoàn hay bánh mật?',
    query: 'Tìm giúp tôi bài kinh có tên giống như mật hoàn hay bánh mật? Cho biết tên Pāḷi, số hiệu bài kinh và tóm tắt nội dung chính với trích dẫn canonical.',
  },
  {
    title: 'ပျားလုံး သို့မဟုတ် ပျားမုန့်ကဲ့သို့ အမည်ရှိသော သုတ်ကို ရှာပေးပါ?',
    query: 'ပျားလုံး သို့မဟုတ် ပျားမုန့်ကဲ့သို့ အမည်ရှိသော သုတ်ကို ရှာပေးပါ။ ပါဠိအမည်၊ သုတ်အမှတ်နှင့် အဓိကအကြောင်းအရာ အကျဉ်းကို canonical ကိုးကားချက်များနှင့်အတူ ဖော်ပြပေးပါ။',
  },
];

function AniIcon({ size = 14, className = '' }) {
  return (
    <img
      src="/ani-tipitakapali-org.svg"
      alt="Ani"
      width={size}
      height={size}
      className={`shrink-0 inline-block object-contain ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

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
      return { label: 'Synthesis', icon: Sparkles, color: 'text-[var(--accent)]' };
    default:
      return { label: toolName || 'Tool Execution', icon: Bot, color: 'text-[var(--accent)]' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  CANONICAL CITATION PRIORITY & SORTING (FRONTEND)
//  Priority: Mūla > Aṭṭhakathā > Ṭīkā > Añña
//  In each group: Sutta > Vinaya > Abhidhamma > Others
// ═══════════════════════════════════════════════════════════════════════════

function getCitationGroupPriority(citation) {
  const code = (citation.bookCode || citation.rawBook || '').toLowerCase();
  const category = (citation.category || '').toLowerCase();

  // 0: Mūla
  if (category.includes('mūla') || category.includes('mula') || code.endsWith('.mul') || code.includes('m.mul')) return 0;
  // 1: Aṭṭhakathā
  if (category.includes('aṭṭha') || category.includes('attha') || code.endsWith('.att') || code.includes('a.att')) return 1;
  // 2: Ṭīkā
  if (category.includes('ṭīkā') || category.includes('tika') || code.endsWith('.tik') || code.includes('t.tik')) return 2;
  // 3: Añña
  return 3;
}

function getCitationPitakaPriority(citation) {
  const code = (citation.bookCode || citation.rawBook || '').toLowerCase();
  const nikaya = (citation.nikaya || '').toLowerCase();

  // 0: Suttantapiṭaka
  if (code.startsWith('s') || nikaya.includes('nikāy') || nikaya.includes('nikay') || nikaya.includes('sutt')) return 0;
  // 1: Vinayapiṭaka
  if (code.startsWith('vin') || nikaya.includes('vinay')) return 1;
  // 2: Abhidhammapiṭaka
  if (code.startsWith('abh') || nikaya.includes('abhidhamm')) return 2;
  // 3: Others
  return 3;
}

function getSuttaNikayaOrder(citation) {
  const code = (citation.bookCode || citation.rawBook || '').toLowerCase();
  const nikaya = (citation.nikaya || '').toLowerCase();

  if (code.startsWith('s01') || nikaya.includes('dīgha') || nikaya.includes('digha')) return 0;
  if (code.startsWith('s02') || nikaya.includes('majjhima')) return 1;
  if (code.startsWith('s03') || nikaya.includes('saṃyutta') || nikaya.includes('samyutta')) return 2;
  if (code.startsWith('s04') || nikaya.includes('aṅguttara') || nikaya.includes('anguttara')) return 3;
  if (code.startsWith('s05') || nikaya.includes('khuddaka')) return 4;
  return 5;
}

function compareCitations(a, b) {
  const gA = getCitationGroupPriority(a);
  const gB = getCitationGroupPriority(b);
  if (gA !== gB) return gA - gB;

  const pA = getCitationPitakaPriority(a);
  const pB = getCitationPitakaPriority(b);
  if (pA !== pB) return pA - pB;

  if (pA === 0 && pB === 0) {
    const sA = getSuttaNikayaOrder(a);
    const sB = getSuttaNikayaOrder(b);
    if (sA !== sB) return sA - sB;
  }

  const codeA = (a.bookCode || '').toLowerCase();
  const codeB = (b.bookCode || '').toLowerCase();
  if (codeA !== codeB) {
    const codeCmp = codeA.localeCompare(codeB, undefined, { numeric: true });
    if (codeCmp !== 0) return codeCmp;
  }

  const chapA = a.chapterIndex ?? 0;
  const chapB = b.chapterIndex ?? 0;
  if (chapA !== chapB) return chapA - chapB;

  const paraA = a.paraIndex ?? 0;
  const paraB = b.paraIndex ?? 0;
  return paraA - paraB;
}

function sortCitations(citations) {
  if (!citations || !Array.isArray(citations)) return [];
  return [...citations].sort(compareCitations);
}

function formatIntentLabel(intent) {
  switch (intent) {
    case 'sutta_search':
      return 'Sutta Search';
    case 'canonical_search':
      return 'Canonical Search';
    case 'dictionary_definition':
      return 'Pāḷi Lexicon';
    case 'translation_lookup':
      return 'Translation Lookup';
    case 'doctrinal_explanation':
      return 'Dhamma Exposition';
    case 'cross_reference':
      return 'Cross-Reference';
    default:
      return 'Canonical Research';
  }
}

function QueryUnderstandingCard({ understanding, isStreaming }) {
  const [isExpanded, setIsExpanded] = useState(false);
  if (!understanding) return null;

  const targetSuttas = understanding.target_sutta_names || [];
  const primaryTarget = targetSuttas[0];
  const terms = understanding.canonical_pali_terms || [];
  const stems = (understanding.pali_stems || []).filter((s) => !terms.includes(s));
  const nikayas = understanding.recommended_locations?.nikayas || [];
  const strategy = understanding.initial_search_strategy || [];

  return (
    <div className="ai-step-card ai-step-indigo mb-3 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-light)] overflow-hidden text-xs transition">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center justify-between text-[var(--accent)] font-semibold hover:bg-[var(--accent-light)] transition cursor-pointer text-left"
      >
        <span className="flex items-center gap-1.5 flex-wrap min-w-0">
          <Brain size={14} className="text-[var(--accent)] shrink-0" />
          <span className="font-bold">Step 1: Query Understanding</span>
          {understanding.intent && (
            <span className="px-1.5 py-0.5 rounded-full bg-[var(--accent-light)] text-[10px] text-[var(--accent)] border border-[var(--accent-border)] font-medium">
              {formatIntentLabel(understanding.intent)}
            </span>
          )}
          {understanding.detected_language && (
            <span className="px-1.5 py-0.5 rounded-full bg-slate-500/10 text-[10px] text-[var(--text-secondary)] font-mono uppercase">
              {understanding.detected_language}
            </span>
          )}
          {primaryTarget && (
            <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 truncate max-w-[200px] sm:max-w-[300px]">
              🎯 {primaryTarget}
            </span>
          )}
          {isStreaming && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-full bg-[var(--accent-light)] text-[var(--accent)] animate-pulse font-normal">
              <Loader2 size={10} className="animate-spin" />
              Analyzing
            </span>
          )}
        </span>
        <span className="shrink-0 ml-1 text-[var(--accent)]">
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {/* Summary preview always visible if collapsed */}
      {!isExpanded && understanding.user_facing_summary && (
        <div className="px-3 pb-2 pt-0 text-[11px] text-[var(--text-secondary)] truncate">
          {understanding.user_facing_summary}
        </div>
      )}

      {/* Expanded detailed breakdown */}
      {isExpanded && (
        <div className="p-3 pt-1 space-y-2 border-t border-[var(--accent-border)] text-[11px] text-[var(--text-secondary)]">
          {understanding.user_facing_summary && (
            <div className="text-[11.5px] text-[var(--text-primary)] font-medium leading-relaxed bg-[var(--bg-card)]/60 p-2 rounded-lg border border-[var(--accent-border)]">
              {understanding.user_facing_summary}
            </div>
          )}

          {/* Canonical Terms & Stems */}
          {(terms.length > 0 || stems.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="font-bold text-[10.5px] uppercase tracking-wider text-[var(--text-muted)] mr-1">
                Pāḷi Concepts:
              </span>
              {terms.map((t, i) => (
                <span
                  key={`term-${i}`}
                  className="px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-200 font-mono text-[10.5px]"
                >
                  {t}
                </span>
              ))}
              {stems.map((s, i) => (
                <span
                  key={`stem-${i}`}
                  className="px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-800 dark:text-cyan-200 font-mono text-[10.5px]"
                  title="Stem / Root"
                >
                  ~{s}
                </span>
              ))}
            </div>
          )}

          {/* Canonical Target & Locations */}
          {(targetSuttas.length > 0 || nikayas.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="font-bold text-[10.5px] uppercase tracking-wider text-[var(--text-muted)] mr-1">
                Canonical Scope:
              </span>
              {targetSuttas.map((s, i) => (
                <span
                  key={`sutta-${i}`}
                  className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-200 text-[10.5px] font-semibold"
                >
                  {s}
                </span>
              ))}
              {nikayas.map((n, i) => (
                <span
                  key={`nikaya-${i}`}
                  className="px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-800 dark:text-violet-200 text-[10.5px] uppercase font-mono"
                >
                  {n.toUpperCase()}
                </span>
              ))}
            </div>
          )}

          {/* Initial Search Strategy steps */}
          {strategy.length > 0 && (
            <div className="space-y-1 pt-1">
              <span className="font-bold text-[10.5px] uppercase tracking-wider text-[var(--text-muted)]">
                Formulated Research Strategy:
              </span>
              <div className="space-y-0.5 bg-[var(--bg-card)]/40 p-2 rounded-lg border border-[var(--accent-border)]">
                {strategy.map((st, sIdx) => (
                  <div key={sIdx} className="flex items-start gap-1.5 text-[10.5px]">
                    <span className="text-[var(--accent)] font-bold shrink-0">{sIdx + 1}.</span>
                    <span>{st}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
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
  const messagesContainerRef = useRef(null);
  const textareaRef = useRef(null);
  const isNearBottomRef = useRef(true);
  const threadScrollMapRef = useRef({});
  const isAutoScrollingRef = useRef(false);
  const pendingQueryRef = useRef(null);

  // Prefill initialQuery if provided
  useEffect(() => {
    if (initialQuery && !inputQuery) {
      setInputQuery(initialQuery);
    }
  }, [initialQuery]);

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

  // 3. Container-scoped scroll handling (NEVER call scrollIntoView which scrolls the entire window/page!)
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    const el = messagesContainerRef.current;
    if (!el) return;
    isAutoScrollingRef.current = true;
    if (behavior === 'smooth') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    setTimeout(() => {
      isAutoScrollingRef.current = false;
    }, behavior === 'smooth' ? 300 : 50);
  }, []);

  const handleMessagesScroll = useCallback((e) => {
    const el = e.target;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceToBottom <= 120;
    if (activeThreadId && !isAutoScrollingRef.current) {
      threadScrollMapRef.current[activeThreadId] = el.scrollTop;
    }
  }, [activeThreadId]);

  // Restore thread scroll position synchronously before paint without page scrolling
  useLayoutEffect(() => {
    const el = messagesContainerRef.current;
    if (!el || !activeThreadId) return;
    const savedPos = threadScrollMapRef.current[activeThreadId];
    if (savedPos !== undefined) {
      el.scrollTop = savedPos;
    } else if (messages.length > 0) {
      el.scrollTop = el.scrollHeight;
    }
  }, [activeThreadId, messages]);

  // Auto-scroll only during live generation if user was already near the bottom
  useEffect(() => {
    if (isGenerating && isNearBottomRef.current) {
      scrollToBottom('smooth');
    }
  }, [isGenerating, statusMessage, scrollToBottom]);

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

    const currentSettings = getStoredAiSettings();
    const hasKey = Boolean(
      (currentSettings?.apiKey && currentSettings.apiKey.trim().length >= 5) ||
      (currentSettings?.provider === 'custom' && currentSettings?.baseUrl?.trim())
    );

    if (!hasKey) {
      // Do not give answer! Preserve query and show configure key screen
      pendingQueryRef.current = query;
      setInputQuery(query);
      setIsSettingsOpen(true);
      return;
    }

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
      understanding: null,
      toolCalls: [],
      citations: [],
      timestamp: new Date().toISOString(),
      isStreaming: true,
    };

    const nextMessages = [...messages, userMessage, initialAssistantMessage];
    setMessages(nextMessages);
    setIsGenerating(true);
    setStatusMessage('Consulting Tipiṭaka database…');
    isNearBottomRef.current = true;
    requestAnimationFrame(() => {
      scrollToBottom('smooth');
    });

    // Title thread if it was default
    const currentThread = threads.find((t) => t.id === activeThreadId);
    if (currentThread && (currentThread.title === 'Ask Ani' || currentThread.title === 'New Investigation' || messages.length === 0)) {
      updateThreadTitle(activeThreadId, query);
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const history = nextMessages
      .filter((m) => m.id !== assistantMsgId)
      .map((m) => ({ role: m.role, content: m.content }));

    let accumulatedContent = '';
    let receivedUnderstanding = null;
    const toolCalls = [];
    let citations = [];

    try {
      await runClientAiAgent({
        userQuery: query,
        conversationHistory: history,
        aiSettings: currentSettings,
        signal: abortController.signal,
        onStatus: (msg) => {
          setStatusMessage(msg);
        },
        onUnderstanding: (und) => {
          receivedUnderstanding = und;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, understanding: und } : m
            )
          );
        },
        onToolCall: (tc) => {
          toolCalls.push(tc);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, toolCalls: [...toolCalls] } : m
            )
          );
        },
        onToken: (tok) => {
          accumulatedContent += tok;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: accumulatedContent, toolCalls: [...toolCalls] }
                : m
            )
          );
          if (isNearBottomRef.current) {
            scrollToBottom('smooth');
          }
        },
        onCitations: (cites) => {
          citations = cites;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, citations: cites } : m
            )
          );
        },
        onDone: () => {},
        onError: (err) => {
          const errorText = `\n\n> ⚠️ **Investigation Error:** ${err.message || 'Unable to connect to AI provider.'} Please check your settings.`;
          accumulatedContent += errorText;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: accumulatedContent, isStreaming: false, isError: true }
                : m
            )
          );
        },
      });

      // Finalize message
      const finalizedMessages = nextMessages.map((m) =>
        m.id === assistantMsgId
          ? {
              ...m,
              content: accumulatedContent,
              understanding: receivedUnderstanding,
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
          <div className="w-8 h-8 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center shrink-0 overflow-hidden">
            <img src="/ani-tipitakapali-org.svg" alt="Ani" className="w-7 h-7 object-contain" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="font-bold text-xs sm:text-sm text-[var(--text-primary)] truncate max-w-[200px] sm:max-w-[340px]">
                {activeThread?.title || 'Ani (AI Nissaya)'}
              </h2>
              <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-[var(--accent-light)] border border-[var(--accent-border)] text-[var(--accent)] shrink-0">
                Beta
              </span>
              {/* RAG Mode indicator badge */}
              <span
                onClick={() => setIsSettingsOpen(true)}
                data-ai-mode-badge
                className={`text-[9.5px] font-semibold px-2 py-0.5 rounded-full border cursor-pointer flex items-center gap-1 transition ${
                  aiSettings.groundRAGMode !== false
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20'
                }`}
                title="Click to toggle between RAG Mode & Knowledge Mode"
              >
                <ShieldCheck size={10} />
                <span>{aiSettings.groundRAGMode !== false ? 'RAG Mode' : 'Knowledge'}</span>
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
                  ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)]'
              }`}
              title="Recent chats"
              aria-label="Recent chats"
            >
              <History size={16} />
            </button>

            {isThreadMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-64 max-w-[80vw] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl z-50 overflow-hidden animate-fade-in text-left">
                <div className="px-3 py-2 border-b border-[var(--border-color)]/60 flex items-center gap-1.5 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                  <History size={12} className="text-[var(--accent)]" />
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
                          ? 'bg-[var(--accent-light)] text-[var(--accent)] font-semibold'
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
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-xs font-semibold text-[var(--text-secondary)] transition cursor-pointer shadow-2xs"
            title="Ask Ani (+)"
          >
            <Plus size={13} className="text-[var(--accent)]" />
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
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)] transition cursor-pointer"
            title="AI Configuration & API Keys"
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      {/* ── Messages Scroll Area ───────────────────────────────────────── */}
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-6"
      >
        {/* Welcome Empty State */}
        {messages.length === 0 && (
          <div className="max-w-2xl mx-auto pt-1 sm:pt-2 pb-4 sm:pb-6 space-y-4 animate-fade-in text-center">
            <div className="flex flex-col items-center gap-1.5">
              <img src="/ani-tipitakapali-org.svg" alt="Ani mascot" className="w-14 h-14 sm:w-16 sm:h-16 object-contain drop-shadow-md" />
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)] flex items-center gap-2">
                Ask{' '}
                <span className="text-[var(--accent)]">Ani</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--accent-light)] border border-[var(--accent-border)] text-[var(--accent)]">
                  Beta
                </span>
              </h1>
              <p className="text-xs sm:text-sm text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
                Your dedicated AI companion for studying the Tipiṭaka. Ani Assistant is inspired by and built on the summaries.db database of{' '}
                <a
                  href="https://epitaka.org/about"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-semibold text-[var(--accent)] hover:underline transition cursor-pointer"
                  title="About the E-Piṭaka project"
                >
                  Vīmaṃsa
                  <ExternalLink size={10} className="shrink-0" />
                </a>
              </p>
            </div>

            {/* API Key Notice */}
            {!aiSettings.apiKey && (
              <div className="p-3.5 rounded-xl bg-[var(--accent-light)] border border-[var(--accent-border)] text-xs text-[var(--text-primary)] flex items-center justify-between gap-3 text-left">
                <div>
                  <span className="font-bold text-[var(--accent)]">Privacy Note: </span>
                  Ani runs directly in your browser with Zero-Key-Escape privacy. Add your free Google Gemini API key in Settings to ask questions.
                </div>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)] font-semibold text-[11px] hover:brightness-95 transition shrink-0 cursor-pointer"
                >
                  Configure Key
                </button>
              </div>
            )}

            {/* Starter Suggestions — 4 simple lines */}
            <div className="flex flex-col gap-1.5 text-left">
              {STARTER_PROMPTS.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSendMessage(p.query)}
                  className="px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] hover:border-[var(--accent-border)] transition text-left group cursor-pointer flex items-center gap-2 text-xs font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)]"
                >
                  <Sparkles size={12} className="text-[var(--accent)] shrink-0" />
                  <span className="flex-1 truncate">{p.title}</span>
                  <span className="text-[var(--accent)] opacity-0 group-hover:opacity-100 transition shrink-0">→</span>
                </button>
              ))}
            </div>

            {/* Accuracy disclaimer — bottom of welcome screen */}
            <div className="flex flex-col items-center gap-1.5 text-[11px] text-[var(--text-muted)] leading-relaxed">
              <span className="inline-flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5">
                <span className="text-[var(--accent)] font-semibold">Ani</span> can make mistakes. Please verify important info.
              </span>
            </div>

          </div>
        )}

        {/* Message Stream */}
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          const isExpanded = expandedToolCalls[msg.id] ?? false;

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
                  <span className="flex items-center gap-1.5 text-[var(--accent)]">
                    <AniIcon size={14} />
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
                    ? 'bg-[var(--accent-light)] text-[var(--text-primary)] border border-[var(--accent-border)] rounded-tr-xs'
                    : 'bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-color)] rounded-tl-xs'
                }`}
              >
                {/* Step 1: Scholarly Query Understanding Card */}
                {!isUser && msg.understanding && (
                  <QueryUnderstandingCard
                    understanding={msg.understanding}
                    isStreaming={msg.isStreaming}
                  />
                )}

                {/* Step 2: Collapsible Research / Tool Calling card for Assistant */}
                {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="ai-step-card ai-step-violet mb-4 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-light)] overflow-hidden text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedToolCalls((prev) => ({ ...prev, [msg.id]: !isExpanded }))
                      }
                      className="w-full px-3 py-2 flex items-center justify-between text-[var(--accent)] font-semibold hover:bg-[var(--accent-light)] transition cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <BookOpen size={13} className="text-[var(--accent)] shrink-0" />
                        <span>
                          Step 2: Canonical Research ({msg.toolCalls.length} step{msg.toolCalls.length > 1 ? 's' : ''})
                        </span>
                        {msg.isStreaming && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-full bg-[var(--accent-light)] text-[var(--accent)] animate-pulse font-normal">
                            <Loader2 size={10} className="animate-spin" />
                            Researching...
                          </span>
                        )}
                      </span>
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {isExpanded && (
                      <div className="p-3 pt-1 space-y-1.5 border-t border-[var(--accent-border)] text-[11px] text-[var(--text-secondary)]">
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
                            <div key={idx} className="flex items-start gap-2 bg-[var(--bg-card)]/60 p-2 rounded-lg border border-[var(--accent-border)]">
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
                    <span className="text-[11px] font-bold text-[var(--accent)] uppercase tracking-wider flex items-center gap-1 mr-1">
                      <Quote size={11} />
                      Sources ({msg.citations.length}):
                    </span>
                    {sortCitations(msg.citations).map((cite, cIdx) => {
                      const isMula = cite.category === 'mūla' || cite.bookCode?.endsWith('.mul');
                      const isAttha = cite.category === 'aṭṭhakathā' || cite.bookCode?.endsWith('.att');
                      const isTika = cite.category === 'ṭīkā' || cite.bookCode?.endsWith('.tik');
                      const tierLabel = isMula ? 'Mūla' : isAttha ? 'Aṭṭhakathā' : isTika ? 'Ṭīkā' : 'Añña';

                      return (
                        <button
                          key={cIdx}
                          type="button"
                          onClick={() => handleCitationClick(cite)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition cursor-pointer select-none text-[var(--text-secondary)]"
                          title={`[${tierLabel}] Click to preview passage ${cite.ref || `${cite.bookCode} §${cite.paraIndex}`}`}
                        >
                          <span>{cite.ref || `${cite.bookCode} §${cite.paraIndex}`}</span>
                        </button>
                      );
                    })}
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
          <div className="max-w-3xl mx-auto w-full flex items-center gap-2 text-xs text-[var(--accent)] bg-[var(--accent-light)] border border-[var(--accent-border)] px-3.5 py-2 rounded-xl animate-pulse">
            <Loader2 size={14} className="animate-spin shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input Box & Controls Footer ────────────────────────────────── */}
      <footer className="p-3 sm:p-4 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] shrink-0">
        <div className="max-w-3xl mx-auto">
          {/* No-API-key notice at bottom of answer screen */}
          {!aiSettings.apiKey && messages.length > 0 && (
            <div className="mb-2 p-2.5 rounded-xl bg-[var(--accent-light)] border border-[var(--accent-border)] text-[11px] text-[var(--text-primary)] flex items-center justify-between gap-3 text-left">
              <div>
                <span className="font-bold text-[var(--accent)]">Privacy Note: </span>
                Zero-Key-Escape active. Please configure your API key in Settings to continue asking Ani.
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)] font-semibold text-[11px] hover:brightness-95 transition shrink-0 cursor-pointer"
              >
                Configure Key
              </button>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="relative flex items-end gap-2 bg-[var(--bg-card)] border border-[var(--border-color)] focus-within:border-[var(--accent)] rounded-2xl p-1.5 sm:p-2 shadow-sm transition"
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

          {/* Micro Footer Notice — accuracy disclaimer at bottom of answer screen */}
          <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] px-2 mt-1.5">
            <span>
              <span className="text-[var(--accent)] font-semibold">Ani</span> can make mistakes. Please verify important info.
            </span>
            <span
              className="font-mono cursor-pointer hover:text-[var(--accent)] hover:underline transition"
              onClick={() => setIsSettingsOpen(true)}
              title="Open Ani AI settings"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsSettingsOpen(true);
                }
              }}
            >
              Model: {aiSettings.answerModel}
            </span>
          </div>
        </div>
      </footer>

      {/* ── Settings Modal ─────────────────────────────────────────────── */}
      <AiSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={(newSettings) => {
          setAiSettings(newSettings);
          const hasNewKey = Boolean(
            (newSettings?.apiKey && newSettings.apiKey.trim().length >= 5) ||
            (newSettings?.provider === 'custom' && newSettings?.baseUrl?.trim())
          );
          if (hasNewKey && pendingQueryRef.current) {
            const q = pendingQueryRef.current;
            pendingQueryRef.current = null;
            setTimeout(() => {
              handleSendMessage(q);
            }, 120);
          }
        }}
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
