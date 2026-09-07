'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Key, Cpu, ShieldCheck, ExternalLink, Check, AlertCircle, AlertTriangle, Bot, RefreshCw, Sparkles } from 'lucide-react';
import { getApiBase } from '../../services/api';

export const DEFAULT_AI_SETTINGS = {
  provider: 'gemini',
  apiKey: '',
  toolModel: 'gemini-flash-lite-latest',
  answerModel: 'gemini-flash-lite-latest',
  baseUrl: '',
  orthodoxMode: true,
  customSystemPrompt: '',
};

export const AI_STORAGE_KEY = 'tipitaka_ai_settings_v1';

export function getStoredAiSettings() {
  if (typeof window === 'undefined') return DEFAULT_AI_SETTINGS;
  try {
    const raw = localStorage.getItem(AI_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate legacy gemini-flash-latest default to gemini-flash-lite-latest
      if (parsed.answerModel === 'gemini-flash-latest') {
        parsed.answerModel = 'gemini-flash-lite-latest';
      }
      // Migrate particular gemini tool model to alias gemini-flash-lite-latest
      if (
        parsed.provider === 'gemini' &&
        parsed.toolModel &&
        parsed.toolModel !== 'gemini-flash-lite-latest' &&
        (/flash-lite/i.test(parsed.toolModel) || parsed.toolModel.startsWith('gemini-2.'))
      ) {
        parsed.toolModel = 'gemini-flash-lite-latest';
      }
      return { ...DEFAULT_AI_SETTINGS, ...parsed };
    }
  } catch (e) {}
  return DEFAULT_AI_SETTINGS;
}

export function saveStoredAiSettings(settings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {}
}

// ── Gemini model auto-discovery helpers ──────────────────────────────────────
// Compare two Gemini model ids by embedded version (e.g. gemini-2.5-flash-lite),
// preferring higher versions and stable (non-preview/experimental) builds.
function geminiModelScore(id) {
  const m = String(id || '').match(/(\d+)(?:\.(\d+))?/);
  const major = m ? parseInt(m[1], 10) : 0;
  const minor = m && m[2] !== undefined ? parseInt(m[2], 10) : 0;
  const stable = /preview|exp|beta|rc|thinking/i.test(id) ? 0 : 1;
  return [major, minor, stable];
}

function compareGeminiModels(a, b) {
  const sa = geminiModelScore(a.id);
  const sb = geminiModelScore(b.id);
  for (let i = 0; i < sa.length; i++) {
    if (sb[i] !== sa[i]) return sb[i] - sa[i];
  }
  return a.id.localeCompare(b.id);
}

// From a fetched Gemini model list, pick the latest flash-lite (for both tool calls and answers),
// falling back to the newest available model.
export function pickLatestGeminiModels(models) {
  const capable = (models || []).filter((m) => m && m.id);
  const sorted = [...capable].sort(compareGeminiModels);
  const lite = sorted.filter((m) => /flash/i.test(m.id) && /lite/i.test(m.id));
  const flash = sorted.filter((m) => /flash/i.test(m.id) && !/lite/i.test(m.id));
  const nonLite = sorted.filter((m) => !/lite/i.test(m.id));
  const latestLite = lite[0] || null;
  const latestFlash = flash[0] || null;
  const latestModel = nonLite[0] || sorted[0] || null;
  return {
    toolPick: { id: 'gemini-flash-lite-latest', displayName: 'Gemini Flash Lite (Latest Alias)' },
    answerPick: latestLite || latestFlash || sorted[0] || null,
    latestLite,
    latestFlash,
    latestModel,
  };
}

// Combobox model picker: free-text input with auto-suggest dropdown fed by the
// fetched model list. Typing filters the list; anything typed is usable as-is.
function ModelSelect({ value, onChange, models, placeholder }) {
  const hasList = Array.isArray(models) && models.length > 0;
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);

  const query = (value || '').trim().toLowerCase();
  const filtered = hasList
    ? models.filter((m) =>
        !query ||
        m.id.toLowerCase().includes(query) ||
        (m.displayName || '').toLowerCase().includes(query)
      ).slice(0, 60)
    : [];

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open ]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open ]);

  const choose = (id) => {
    onChange(id);
    setOpen(false);
  };

  const handleInputKey = (e) => {
    if (!open || filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter') {
      if (open && filtered[highlight]) {
        e.preventDefault();
        choose(filtered[highlight].id);
      }
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (hasList) setOpen(true);
        }}
        onFocus={() => {
          if (hasList) setOpen(true);
        }}
        onKeyDown={handleInputKey}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-xs outline-none focus:border-violet-500 text-[var(--text-primary)] font-mono"
      />
      {hasList && open && (
        <div className="absolute left-0 right-0 top-full mt-1 max-h-48 overflow-y-auto bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl z-30 py-1">
          {filtered.length === 0 && (
            <div className="px-3 py-2.5 text-[11px] text-[var(--text-muted)]">
              No matches — “{value.trim()}” will be used as a custom model.
            </div>
          )}
          {filtered.map((m, idx) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(m.id)}
              onMouseEnter={() => setHighlight(idx)}
              className={`w-full text-left px-3 py-1.5 font-mono text-xs truncate transition cursor-pointer flex items-center justify-between gap-2 ${
                idx === highlight
                  ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300'
                  : 'text-[var(--text-secondary)]'
              }`}
              title={m.displayName && m.displayName !== m.id ? `${m.displayName} (${m.id})` : m.id}
            >
              <span className="truncate">
                {m.displayName && m.displayName !== m.id ? `${m.displayName} (${m.id})` : m.id}
              </span>
              {value === m.id && <Check size={12} className="shrink-0 text-violet-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AiSettingsModal({ isOpen, onClose, onSave }) {
  const [config, setConfig] = useState(DEFAULT_AI_SETTINGS);
  const [testStatus, setTestStatus] = useState(null); // null | 'testing' | 'success' | 'error'
  const [testMessage, setTestMessage] = useState('');
  const [geminiModels, setGeminiModels] = useState([]); // [{ id, displayName }]
  const [modelsStatus, setModelsStatus] = useState(null); // null | 'loading' | 'success' | 'error'
  const [modelsMessage, setModelsMessage] = useState('');
  const [modelsAutoNote, setModelsAutoNote] = useState('');
  const fetchedKeyRef = useRef(null); // Gemini key already resolved to a model list

  useEffect(() => {
    if (isOpen) {
      setConfig(getStoredAiSettings());
      setTestStatus(null);
      setTestMessage('');
      setModelsAutoNote('');
    }
  }, [isOpen]);

  const fetchGeminiModels = async (apiKey, { autoApply = false } = {}) => {
    const key = (apiKey || '').trim();
    if (!key) return;
    setModelsStatus('loading');
    setModelsMessage('Fetching available Gemini models…');
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const seen = new Set();
      const list = (data.models || [])
        .filter(
          (m) =>
            !m.supportedGenerationMethods ||
            m.supportedGenerationMethods.includes('generateContent')
        )
        .map((m) => ({
          id: String(m.name || '').replace(/^models\//, ''),
          displayName: m.displayName || '',
        }))
        .filter((m) => m.id && !seen.has(m.id) && (seen.add(m.id), true));
      const aliases = [
        { id: 'gemini-flash-lite-latest', displayName: 'gemini-flash-lite-latest (Latest Flash Lite Alias • Recommended)' },
        { id: 'gemini-flash-latest', displayName: 'gemini-flash-latest (Latest Flash Alias)' },
      ];
      const fullList = [...aliases.filter((a) => !seen.has(a.id)), ...list];
      setGeminiModels(fullList);
      fetchedKeyRef.current = key;
      const { toolPick, answerPick } = pickLatestGeminiModels(list);
      if (autoApply) {
        setConfig((prev) => ({
          ...prev,
          toolModel: 'gemini-flash-lite-latest',
          answerModel: answerPick ? answerPick.id : prev.answerModel,
        }));
        setModelsAutoNote(
          `Auto-selected • tool → gemini-flash-lite-latest (alias)${
            answerPick ? ` • answer → ${answerPick.id}` : ''
          }`
        );
      }
      setModelsStatus('success');
      setModelsMessage(
        list.length
          ? `${list.length} models loaded — tool uses alias gemini-flash-lite-latest, answer uses ${answerPick?.id || 'latest flash-lite'}.`
          : 'No generateContent-capable models returned for this key.'
      );
    } catch (err) {
      setModelsStatus('error');
      setModelsMessage(`Could not load models: ${err.message}`);
    }
  };

  // Auto-fetch all Gemini models shortly after the user enters a key, and
  // default the tool model to the latest flash-lite + answer model to the
  // 2nd-latest flash. Runs once per key so manual edits afterwards are respected.
  useEffect(() => {
    if (!isOpen || config.provider !== 'gemini') return;
    const key = (config.apiKey || '').trim();
    if (key.length < 20 || key === fetchedKeyRef.current) return;
    const t = setTimeout(() => {
      fetchGeminiModels(key, { autoApply: true });
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, config.provider, config.apiKey]);

  if (!isOpen) return null;

  // Latest models currently available (from the fetched Gemini list) for display
  // under each model field.
  const { latestLite, latestFlash, latestModel } = pickLatestGeminiModels(
    config.provider === 'gemini' ? geminiModels : []
  );

  const handleSave = () => {
    saveStoredAiSettings(config);
    if (onSave) onSave(config);
    if (onClose) onClose();
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestMessage('Testing connection to AI service…');

    try {
      if (!config.apiKey && config.provider === 'gemini') {
        // Test local database tools instead
        const res = await fetch(`${getApiBase()}/api/ai/tools`);
        if (res.ok) {
          setTestStatus('success');
          setTestMessage('Local Tipitaka tools active. Add your Gemini API key to enable full AI generative synthesis.');
        } else {
          throw new Error('Local API not responding');
        }
        return;
      }

      if (config.provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${config.apiKey.trim()}`;
        const res = await fetch(url);
        if (res.ok) {
          setTestStatus('success');
          setTestMessage('Successfully connected to Google Gemini API!');
        } else {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `HTTP ${res.status}`);
        }
      } else {
        const base = config.baseUrl?.trim() || 'https://api.openai.com/v1';
        const url = `${base.replace(/\/+$/, '')}/models`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${config.apiKey.trim()}` },
        });
        if (res.ok) {
          setTestStatus('success');
          setTestMessage('Successfully connected to API provider!');
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      }
    } catch (err) {
      setTestStatus('error');
      setTestMessage(`Connection failed: ${err.message}`);
    }
  };

  return (
    <div
      className="ai-settings-modal fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-violet-600 via-indigo-600 to-violet-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Bot size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm">Ani (AI Nissaya) Settings</h3>
              <p className="text-xs text-white/80">Configure AI Providers, Models & Research Mode</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs text-[var(--text-primary)]">
          {/* Usage & cost warning */}
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <AlertTriangle size={15} className="shrink-0 mt-px text-amber-600 dark:text-amber-400" />
            <p className="text-[11px] leading-relaxed">
              <span className="font-bold">Warning: </span>
              Ani calls your AI repeatedly for every answer, so credits/tokens can burn quickly —
              especially with translation layers enabled or in long conversations. If you are on a
              paid plan, please monitor your usage.
            </p>
          </div>

          {/* Free key notice */}
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-900 dark:text-emerald-200 flex items-start gap-2">
            <Key size={15} className="shrink-0 mt-px text-emerald-600 dark:text-emerald-400" />
            <p className="text-[11px] leading-relaxed">
              <span className="font-bold">Free key: </span>
              You can obtain a free key at{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline hover:opacity-80 inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-300"
              >
                Google AI Studio
                <ExternalLink size={10} />
              </a>
              , then paste it below.
            </p>
          </div>


          {/* Provider Selection */}
          <div className="space-y-1.5">
            <label className="font-bold uppercase tracking-wider text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
              <Cpu size={13} />
              AI Provider
            </label>
            <select
              value={config.provider}
              onChange={(e) => {
                const pid = e.target.value;
                const defaultToolModel =
                  pid === 'gemini'
                    ? 'gemini-flash-lite-latest'
                    : pid === 'openai'
                    ? 'gpt-4o-mini'
                    : pid === 'openrouter'
                    ? 'google/gemini-2.0-flash-001'
                    : 'local-model';
                const defaultAnswerModel =
                  pid === 'gemini' ? 'gemini-flash-lite-latest' : defaultToolModel;
                setConfig({
                  ...config,
                  provider: pid,
                  toolModel: defaultToolModel,
                  answerModel: defaultAnswerModel,
                });
              }}
              className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-xs outline-none focus:border-violet-500 text-[var(--text-primary)] cursor-pointer"
            >
              <option value="gemini">Google Gemini — Free key • Recommended</option>
              <option value="openai">OpenAI compatible provider — custom endpoint • any model</option>
              <option value="openrouter">OpenRouter — Claude • Llama • Gemini</option>
              <option value="custom">Custom / Local — Ollama • vLLM • LiteLLM</option>
            </select>
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-bold uppercase tracking-wider text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                <Key size={13} />
                API Key
              </label>
              {config.provider === 'gemini' && (
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1 text-[11px]"
                >
                  <span>Get Free Key at Google AI Studio</span>
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder={config.provider === 'gemini' ? 'Paste AIzaSy… key here' : 'Paste API key here'}
              className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-xs outline-none focus:border-violet-500 text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
            <p className="text-[10.5px] text-[var(--text-muted)]">
              🔒 <strong>Zero-Key-Escape:</strong> Your API key is stored strictly in your browser's localStorage and never leaves your browser.
            </p>
          </div>

          {/* Base URL (custom endpoint — for OpenAI-compatible, OpenRouter & local providers) */}
          {(config.provider === 'custom' || config.provider === 'openrouter' || config.provider === 'openai') && (
            <div className="space-y-1.5">
              <label className="font-bold uppercase tracking-wider text-[11px] text-[var(--text-muted)]">
                API Base URL
              </label>
              <input
                type="text"
                value={config.baseUrl}
                onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                placeholder={
                  config.provider === 'openrouter'
                    ? 'https://openrouter.ai/api/v1'
                    : config.provider === 'openai'
                    ? 'https://api.openai.com/v1 (or any OpenAI-compatible endpoint)'
                    : 'http://localhost:11434/v1'
                }
                className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-xs outline-none focus:border-violet-500 text-[var(--text-primary)] font-mono"
              />
              {config.provider === 'openai' && (
                <p className="text-[10.5px] text-[var(--text-muted)]">
                  Defaults to OpenAI when blank — or enter any OpenAI-compatible endpoint (LiteLLM, vLLM, Ollama, local server) with its API key above.
                </p>
              )}
            </div>
          )}

          {/* Model Selection */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-bold uppercase tracking-wider text-[11px] text-[var(--text-muted)]">
                Tool Model
              </label>
              <ModelSelect
                value={config.toolModel}
                onChange={(v) => setConfig({ ...config, toolModel: v })}
                models={config.provider === 'gemini' ? geminiModels : []}
                placeholder="e.g. gemini-flash-lite-latest"
              />
              <p className="text-[10px] text-[var(--text-muted)]">
                <span>Alias: </span>
                <button
                  type="button"
                  onClick={() => setConfig((prev) => ({ ...prev, toolModel: 'gemini-flash-lite-latest' }))}
                  className="font-mono text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
                  title="Click to set Tool Model to alias gemini-flash-lite-latest"
                >
                  gemini-flash-lite-latest
                </button>
                {latestLite && <span className="text-[var(--text-muted)]"> (resolves to {latestLite.id})</span>}
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="font-bold uppercase tracking-wider text-[11px] text-[var(--text-muted)]">
                Answer Model
              </label>
              <ModelSelect
                value={config.answerModel}
                onChange={(v) => setConfig({ ...config, answerModel: v })}
                models={config.provider === 'gemini' ? geminiModels : []}
                placeholder="e.g. gemini-flash-lite-latest"
              />
              <p className="text-[10px] text-[var(--text-muted)]">
                {latestModel ? (
                  <>
                    <span>Latest available: </span>
                    <button
                      type="button"
                      onClick={() => setConfig((prev) => ({ ...prev, answerModel: latestModel.id }))}
                      className="font-mono text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
                      title={`Click to set Answer Model to ${latestModel.id}`}
                    >
                      {latestModel.id}
                    </button>
                  </>
                ) : (
                  'Suggested: latest flash-lite'
                )}
              </p>
            </div>
          </div>

          {/* Gemini model auto-discovery status */}
          {config.provider === 'gemini' && (
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => fetchGeminiModels(config.apiKey, { autoApply: true })}
                disabled={modelsStatus === 'loading' || (config.apiKey || '').trim().length < 20}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 border border-violet-500/20 transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={12} className={modelsStatus === 'loading' ? 'animate-spin' : ''} />
                <span>{modelsStatus === 'loading' ? 'Loading models…' : 'Reload models & auto-select latest'}</span>
              </button>
              {modelsAutoNote && (
                <p className="text-[11px] text-violet-700 dark:text-violet-300 flex items-start gap-1.5 bg-violet-500/10 border border-violet-500/20 rounded-xl px-3 py-2">
                  <Sparkles size={12} className="shrink-0 mt-px" />
                  <span>{modelsAutoNote}</span>
                </p>
              )}
              {modelsMessage && (
                <p
                  className={`text-[11px] ${
                    modelsStatus === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-[var(--text-muted)]'
                  }`}
                >
                  {modelsMessage}
                </p>
              )}
            </div>
          )}

          {/* RAG Mode Toggle */}
          <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <div className="font-bold flex items-center gap-1.5 text-xs text-[var(--text-primary)]">
                <ShieldCheck size={14} className={config.orthodoxMode ? 'text-emerald-500' : 'text-[var(--text-muted)]'} />
                <span>RAG Mode (Strict Canonical Grounding)</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                {config.orthodoxMode
                  ? 'Active: Answers strictly use ONLY retrieved passages and commentaries found in the Chaṭṭha Saṅgāyana Tipiṭaka. Every claim must have a citation.'
                  : 'Disabled: Knowledge mode active. The AI may supplement canonical quotes with broader Buddhist philosophical knowledge.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfig({ ...config, orthodoxMode: !config.orthodoxMode })}
              className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 mt-0.5 ${
                config.orthodoxMode ? 'bg-emerald-600' : 'bg-gray-300 dark:bg-gray-700'
              }`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  config.orthodoxMode ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Custom System Prompt Override */}
          <div className="space-y-1.5">
            <label className="font-bold uppercase tracking-wider text-[11px] text-[var(--text-muted)]">
              Custom System Prompt Override (Optional)
            </label>
            <textarea
              rows={3}
              value={config.customSystemPrompt}
              onChange={(e) => setConfig({ ...config, customSystemPrompt: e.target.value })}
              placeholder="Leave blank to use default Ani scholarly prompts…"
              className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-xs outline-none focus:border-violet-500 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none"
            />
          </div>

          {/* Test Status Feedback */}
          {testStatus && (
            <div
              className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
                testStatus === 'success'
                  ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20'
                  : testStatus === 'error'
                  ? 'bg-red-500/10 text-red-800 dark:text-red-300 border border-red-500/20'
                  : 'bg-blue-500/10 text-blue-800 dark:text-blue-300 border border-blue-500/20'
              }`}
            >
              {testStatus === 'success' ? (
                <Check size={14} className="shrink-0 mt-0.5" />
              ) : (
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
              )}
              <span>{testMessage}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-3.5 bg-[var(--bg-primary)] border-t border-[var(--border-color)] flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testStatus === 'testing'}
            className="px-3 py-2 rounded-xl text-xs font-semibold text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 transition cursor-pointer disabled:opacity-50"
          >
            {testStatus === 'testing' ? 'Testing…' : 'Test Connection'}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold text-xs shadow-sm hover:shadow-md transition cursor-pointer"
            >
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
