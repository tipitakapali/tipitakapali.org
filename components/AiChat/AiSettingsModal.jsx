'use client';

import React, { useState, useEffect } from 'react';
import { X, Key, Cpu, ShieldCheck, ExternalLink, Check, AlertCircle, Bot } from 'lucide-react';

export const DEFAULT_AI_SETTINGS = {
  provider: 'gemini',
  apiKey: '',
  toolModel: 'gemini-2.0-flash',
  answerModel: 'gemini-2.0-flash',
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
      return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(raw) };
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

export default function AiSettingsModal({ isOpen, onClose, onSave }) {
  const [config, setConfig] = useState(DEFAULT_AI_SETTINGS);
  const [testStatus, setTestStatus] = useState(null); // null | 'testing' | 'success' | 'error'
  const [testMessage, setTestMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      setConfig(getStoredAiSettings());
      setTestStatus(null);
      setTestMessage('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

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
        const res = await fetch('/api/ai/tools');
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
          {/* Provider Selection */}
          <div className="space-y-1.5">
            <label className="font-bold uppercase tracking-wider text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
              <Cpu size={13} />
              AI Provider
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'gemini', label: 'Google Gemini', desc: 'Free key • Recommended' },
                { id: 'openai', label: 'OpenAI', desc: 'GPT-4o • GPT-4o-mini' },
                { id: 'openrouter', label: 'OpenRouter', desc: 'Claude • Llama • Gemini' },
                { id: 'custom', label: 'Custom / Local', desc: 'Ollama • vLLM • LiteLLM' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    const defaultModel =
                      p.id === 'gemini'
                        ? 'gemini-2.0-flash'
                        : p.id === 'openai'
                        ? 'gpt-4o-mini'
                        : p.id === 'openrouter'
                        ? 'google/gemini-2.0-flash-001'
                        : 'local-model';
                    setConfig({
                      ...config,
                      provider: p.id,
                      toolModel: defaultModel,
                      answerModel: defaultModel,
                    });
                  }}
                  className={`p-2.5 text-left rounded-xl border transition cursor-pointer flex flex-col justify-between ${
                    config.provider === p.id
                      ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-300 font-bold'
                      : 'border-[var(--border-color)] bg-[var(--bg-card)] hover:border-violet-500/40 text-[var(--text-secondary)]'
                  }`}
                >
                  <span className="text-xs">{p.label}</span>
                  <span className="text-[10px] opacity-75 font-normal">{p.desc}</span>
                </button>
              ))}
            </div>
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
              Your API key is stored securely in your browser's localStorage and never shared.
            </p>
          </div>

          {/* Base URL (if custom or openrouter) */}
          {(config.provider === 'custom' || config.provider === 'openrouter') && (
            <div className="space-y-1.5">
              <label className="font-bold uppercase tracking-wider text-[11px] text-[var(--text-muted)]">
                Base URL
              </label>
              <input
                type="text"
                value={config.baseUrl}
                onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                placeholder={config.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'http://localhost:11434/v1'}
                className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-xs outline-none focus:border-violet-500 text-[var(--text-primary)]"
              />
            </div>
          )}

          {/* Model Selection */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-bold uppercase tracking-wider text-[11px] text-[var(--text-muted)]">
                Tool Model
              </label>
              <input
                type="text"
                value={config.toolModel}
                onChange={(e) => setConfig({ ...config, toolModel: e.target.value })}
                placeholder="e.g. gemini-2.0-flash"
                className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-xs outline-none focus:border-violet-500 text-[var(--text-primary)] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-bold uppercase tracking-wider text-[11px] text-[var(--text-muted)]">
                Answer Model
              </label>
              <input
                type="text"
                value={config.answerModel}
                onChange={(e) => setConfig({ ...config, answerModel: e.target.value })}
                placeholder="e.g. gemini-2.0-flash"
                className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-2 px-3 text-xs outline-none focus:border-violet-500 text-[var(--text-primary)] font-mono"
              />
            </div>
          </div>

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
