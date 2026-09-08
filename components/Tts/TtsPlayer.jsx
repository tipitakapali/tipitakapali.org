'use client';

import React, { useState, useEffect } from 'react';
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  Settings,
  X,
  Languages,
  Loader2,
} from 'lucide-react';
import { useTts } from '../../context/TtsContext';
import { voicesForLang, TTS_LANG_LABEL, TTS_LANG_FLAG } from '../../services/tts';

function LangPrompt() {
  const { enabledLangIds, showLangPrompt, setShowLangPrompt, startWithLangs } = useTts();
  const [checked, setChecked] = useState(enabledLangIds);

  useEffect(() => {
    if (showLangPrompt) setChecked(enabledLangIds);
  }, [showLangPrompt, enabledLangIds]);

  if (!showLangPrompt) return null;

  const toggle = (id) => {
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 animate-fade-in"
      onClick={() => setShowLangPrompt(false)}
    >
      <div
        className="w-full max-w-[360px] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl select-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-color)]/60 px-4 py-3">
          <span className="font-bold text-sm text-[var(--text-primary)] flex items-center gap-2">
            <Languages size={15} className="text-[var(--accent)]" />
            Read Aloud — languages
          </span>
          <button
            onClick={() => setShowLangPrompt(false)}
            className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            aria-label="Close language selection"
          >
            <X size={15} />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-2">
          <p className="text-xs text-[var(--text-secondary)]">
            Multiple translations are enabled. Tick which ones to speak, in display order:
          </p>
          {enabledLangIds.map((id) => (
            <label
              key={id}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--border-color)] cursor-pointer hover:border-[var(--accent)] text-sm text-[var(--text-primary)]"
            >
              <input
                type="checkbox"
                checked={checked.includes(id)}
                onChange={() => toggle(id)}
                className="accent-[var(--accent)] w-4 h-4 cursor-pointer"
              />
              <span>{TTS_LANG_LABEL[id] || id}</span>
            </label>
          ))}
          <button
            onClick={() => startWithLangs(checked)}
            disabled={checked.length === 0}
            className="mt-2 w-full py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-bold hover:bg-[var(--accent-hover)] transition cursor-pointer disabled:opacity-40"
          >
            Start reading aloud
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsPanel() {
  const {
    ttsLangs,
    enabledLangIds,
    toggleTtsLang,
    voices,
    ttsVoices,
    setVoiceForLang,
    rate,
    setRate,
    pitch,
    setPitch,
    volume,
    setVolume,
    follow,
    setFollow,
    setShowSettings,
    resetVoices,
  } = useTts();

  const listed = enabledLangIds.length > 0 ? enabledLangIds : ttsLangs;

  return (
    <div className="border-t border-[var(--border-color)]/60 px-3 py-2.5 flex flex-col gap-2.5 max-h-[40vh] overflow-y-auto">
      <div className="flex gap-2 sticky top-0 bg-[var(--bg-card)] pb-1">
        <button
          onClick={() => {
            setRate(1);
            setPitch(1);
            setVolume(1);
            setFollow(true);
            resetVoices();
          }}
          className="flex-1 py-1.5 rounded-lg border border-[var(--border-color)] text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition cursor-pointer"
          title="Reset voices to Auto and speed, pitch, volume and follow to defaults"
        >
          Reset
        </button>
        <button
          onClick={() => setShowSettings(false)}
          className="flex-1 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-bold hover:bg-[var(--accent-hover)] transition cursor-pointer"
        >
          Done
        </button>
      </div>
      {listed.map((id) => {
        const options = voicesForLang(voices, id);
        const current = ttsVoices[id] || '';
        const checked = ttsLangs.includes(id);
        const isLast = checked && ttsLangs.length <= 1;
        return (
          <div key={id} className="flex flex-col gap-1">
            <label
              className={`flex items-center gap-2 text-[11px] cursor-pointer ${
                isLast ? 'opacity-60' : 'text-[var(--text-secondary)]'
              }`}
              title={isLast ? 'At least one language must stay enabled' : `Enable/disable ${TTS_LANG_LABEL[id] || id} for Read Aloud`}
            >
              <span className="text-[var(--text-muted)]">Read aloud:</span>
              <input
                type="checkbox"
                checked={checked}
                disabled={isLast}
                onChange={() => toggleTtsLang(id)}
                className="accent-[var(--accent)] w-4 h-4 cursor-pointer"
              />
              <span className="text-sm leading-none">{TTS_LANG_FLAG[id] || '🌐'}</span>
              <span className="font-semibold">{TTS_LANG_LABEL[id] || id}</span>
            </label>
            <select
              value={current}
              disabled={!checked}
              onChange={(e) => setVoiceForLang(id, e.target.value)}
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none cursor-pointer disabled:opacity-40"
            >
              <option value="">Auto (best match)</option>
              {options.map((v, i) => (
                <option key={`${v.voiceURI || ''}::${v.name || ''}::${v.lang || ''}::${i}`} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
              {options.length === 0 &&
                voices.map((v, i) => (
                  <option key={`${v.voiceURI || ''}::${v.name || ''}::${v.lang || ''}::${i}`} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
            </select>
            {checked && voices.length > 0 && options.length === 0 && (
              <span className="text-[10px] leading-snug text-amber-600 dark:text-amber-400">
                No {TTS_LANG_LABEL[id] || id} voice on this device — the system will fall back to
                its default voice. Android: install it in Settings → Language → Text-to-speech →
                Google TTS voices.
              </span>
            )}
          </div>
        );
      })}
      <label className="flex flex-col gap-1 text-[11px] text-[var(--text-secondary)]">
        <span className="font-semibold flex justify-between">
          <span>Speed</span>
          <span className="font-mono">{rate.toFixed(2)}×</span>
        </span>
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.05"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          className="w-full accent-[var(--accent)] cursor-pointer"
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-[var(--text-secondary)]">
        <span className="font-semibold flex justify-between">
          <span>Pitch</span>
          <span className="font-mono">{pitch.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={pitch}
          onChange={(e) => setPitch(e.target.value)}
          className="w-full accent-[var(--accent)] cursor-pointer"
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-[var(--text-secondary)]">
        <span className="font-semibold flex justify-between">
          <span>Volume</span>
          <span className="font-mono">{Math.round(volume * 100)}%</span>
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(e) => setVolume(e.target.value)}
          className="w-full accent-[var(--accent)] cursor-pointer"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-[var(--text-primary)] cursor-pointer">
        <input
          type="checkbox"
          checked={follow}
          onChange={(e) => setFollow(e.target.checked)}
          className="accent-[var(--accent)] w-4 h-4 cursor-pointer"
        />
        Highlight & follow along
      </label>
    </div>
  );
}

export default function TtsPlayer() {
  const {
    isSupported,
    isActive,
    isPlaying,
    isPaused,
    isAdvancing,
    current,
    showPlayer,
    setShowPlayer,
    showLangPrompt,
    showSettings,
    setShowSettings,
    noTransNotice,
    setNoTransNotice,
    openLanguageMenu,
    togglePlayPause,
    stop,
    nextPara,
    prevPara,
  } = useTts();

  if (!isSupported) return null;
  if (!showPlayer && !showLangPrompt) return <LangPrompt />;
  if (!showPlayer) return <LangPrompt />;

  // No-translation notice card.
  if (noTransNotice && !isActive) {
    return (
      <>
        <LangPrompt />
        <div className="fixed bottom-[62px] sm:bottom-[64px] left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-1.5rem)] max-w-[380px]">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl px-4 py-3 flex flex-col gap-2 select-none">
            <div className="text-xs text-[var(--text-secondary)]">
              Enable at least one translation language to use Read Aloud (Pāḷi speech is not
              supported).
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setNoTransNotice(false);
                  setShowPlayer(false);
                  openLanguageMenu();
                }}
                className="flex-1 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-bold cursor-pointer"
              >
                Open languages
              </button>
              <button
                onClick={() => {
                  setNoTransNotice(false);
                  setShowPlayer(false);
                }}
                className="px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <LangPrompt />
      <div className="fixed bottom-[62px] sm:bottom-[64px] left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-1rem)] max-w-[440px] px-1">
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl select-none overflow-hidden">
          <div className="flex items-center gap-1 px-2 py-1.5">
            <button
              onClick={prevPara}
              className="p-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
              title="Previous paragraph"
              aria-label="Previous paragraph"
            >
              <SkipBack size={16} />
            </button>
            <button
              onClick={togglePlayPause}
              className="p-2 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition cursor-pointer"
              title={isPaused ? 'Play' : 'Pause'}
              aria-label={isPaused ? 'Play' : 'Pause'}
            >
              {isAdvancing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : isPaused ? (
                <Play size={16} />
              ) : (
                <Pause size={16} />
              )}
            </button>
            <button
              onClick={stop}
              className="p-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
              title="Stop"
              aria-label="Stop"
            >
              <Square size={15} />
            </button>
            <button
              onClick={nextPara}
              className="p-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
              title="Next paragraph"
              aria-label="Next paragraph"
            >
              <SkipForward size={16} />
            </button>
            <div className="flex-1 min-w-0 px-1 text-center">
              {isAdvancing ? (
                <div className="text-[11px] text-[var(--text-muted)]">Loading next chapter…</div>
              ) : current ? (
                <>
                  <div className="text-[11px] font-bold text-[var(--text-primary)] truncate">
                    ¶{current.para} · {current.langLabel}
                  </div>
                  <div className="text-[10px] font-mono text-[var(--text-muted)]">
                    {current.index + 1}/{current.total}
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-[var(--text-muted)]">
                  {isPlaying ? 'Reading…' : 'Read Aloud'}
                </div>
              )}
            </div>
            <button
              onClick={() => setShowSettings((v) => !v)}
              className={`p-2 rounded-lg transition cursor-pointer ${
                showSettings
                  ? 'bg-[var(--accent-light)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
              }`}
              title="TTS settings (voice, speed, pitch)"
              aria-label="TTS settings"
            >
              <Settings size={15} />
            </button>
            <button
              onClick={stop}
              className="p-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition cursor-pointer"
              title="Close player"
              aria-label="Close player"
            >
              <X size={15} />
            </button>
          </div>
          {showSettings && <SettingsPanel />}
        </div>
      </div>
    </>
  );
}
