'use client';

import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { useTabs } from './TabContext';
import { useThemeSettings } from './ThemeSettingsContext';
import {
  isTtsSupported,
  isAndroidChrome,
  ensureTtsVoices,
  getEnabledTtsLangIds,
  detectViewportTopPara,
  buildTtsQueueFromDom,
  getTtsVoices,
  pickVoiceForLang,
  TTS_LANG_ID_TO_CODE,
  TTS_LANG_ID_TO_BCP47,
  TTS_LANG_LABEL,
} from '../services/tts';

const TtsContext = createContext(null);

const LS_KEYS = {
  LANGS: 'tipitaka_tts_langs',
  LANGS_FOR: 'tipitaka_tts_langs_for',
  VOICES: 'tipitaka_tts_voices',
  RATE: 'tipitaka_tts_rate',
  PITCH: 'tipitaka_tts_pitch',
  VOLUME: 'tipitaka_tts_volume',
  FOLLOW: 'tipitaka_tts_follow',
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function TtsProvider({ children }) {
  const { activeTab, activeBookCode, openBook, loadChapter } = useTabs();
  const { settings, openLanguageMenu } = useThemeSettings();

  const [isActive, setIsActive] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [current, setCurrent] = useState(null); // { para, langId, langLabel, index, total }
  const [ttsLangs, setTtsLangs] = useState([]);
  const [showLangPrompt, setShowLangPrompt] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [noTransNotice, setNoTransNotice] = useState(false);
  const [voices, setVoices] = useState([]);
  const [ttsVoices, setTtsVoices] = useState({});
  const [rate, setRateState] = useState(1);
  const [pitch, setPitchState] = useState(1);
  const [volume, setVolumeState] = useState(1);
  const [follow, setFollowState] = useState(true);
  const [isAdvancing, setIsAdvancing] = useState(false);

  const itemsRef = useRef([]);
  const indexRef = useRef(0);
  const stateRef = useRef({ active: false, playing: false, paused: false });
  const prefsRef = useRef({ voices: {}, rate: 1, pitch: 1, volume: 1, follow: true, langs: [] });
  const tokenRef = useRef(0);
  const activeTabRef = useRef(null);
  const startingRef = useRef(false);

  activeTabRef.current = activeTab;

  const enabledLangIds = getEnabledTtsLangIds(settings);
  const enabledKey = enabledLangIds.slice().sort().join(',');

  const syncState = useCallback((patch) => {
    Object.assign(stateRef.current, patch);
    if (patch.active !== undefined) setIsActive(patch.active);
    if (patch.playing !== undefined) setIsPlaying(patch.playing);
    if (patch.paused !== undefined) setIsPaused(patch.paused);
  }, []);

  // Load persisted prefs once.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const v = readJson(LS_KEYS.VOICES, {});
      const r = parseFloat(localStorage.getItem(LS_KEYS.RATE) ?? '1');
      const p = parseFloat(localStorage.getItem(LS_KEYS.PITCH) ?? '1');
      const vol = parseFloat(localStorage.getItem(LS_KEYS.VOLUME) ?? '1');
      const f = localStorage.getItem(LS_KEYS.FOLLOW);
      const saved = readJson(LS_KEYS.LANGS, []);
      prefsRef.current = {
        voices: v && typeof v === 'object' ? v : {},
        rate: !isNaN(r) && r >= 0.5 && r <= 2 ? r : 1,
        pitch: !isNaN(p) && p >= 0 && p <= 2 ? p : 1,
        volume: !isNaN(vol) && vol >= 0 && vol <= 1 ? vol : 1,
        follow: f === null ? true : f === 'true',
        langs: Array.isArray(saved) ? saved : [],
      };
      setTtsVoices(prefsRef.current.voices);
      setRateState(prefsRef.current.rate);
      setPitchState(prefsRef.current.pitch);
      setVolumeState(prefsRef.current.volume);
      setFollowState(prefsRef.current.follow);
      setTtsLangs(prefsRef.current.langs);
    } catch {}
  }, []);

  // Track async voice loading (empty on first call in Safari/iOS).
  useEffect(() => {
    if (!isTtsSupported()) return;
    const update = () => setVoices(getTtsVoices());
    update();
    try {
      window.speechSynthesis.onvoiceschanged = update;
    } catch {}
    return () => {
      try {
        if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
      } catch {}
    };
  }, []);

  const clearHighlight = useCallback(() => {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.tts-speaking').forEach((el) => el.classList.remove('tts-speaking'));
  }, []);

  const highlightItem = useCallback(
    (item) => {
      clearHighlight();
      if (!item || typeof document === 'undefined') return;
      const row = document.querySelector(`.reader-para-row[data-para="${CSS.escape(item.para)}"]`);
      const block =
        row?.querySelector(`.reader-trans-block[data-trans-lang="${CSS.escape(item.langCode)}"]`) || null;
      if (block) {
        block.classList.add('tts-speaking');
        if (prefsRef.current.follow) {
          try {
            block.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch {
            try {
              block.scrollIntoView();
            } catch {}
          }
        }
      }
    },
    [clearHighlight]
  );

  const resolveVoice = useCallback(
    (langId) => {
      const savedUri = prefsRef.current.voices?.[langId];
      const list = getTtsVoices();
      if (savedUri) {
        const found = list.find((v) => v.voiceURI === savedUri);
        if (found) return found;
      }
      return pickVoiceForLang(list, langId);
    },
    []
  );

  // Index of the item last retried with a default voice (silent-voice watchdog).
  const retryRef = useRef({ idx: -1 });

  const speakAt = useCallback(
    (idx) => {
      if (!isTtsSupported()) return;
      const items = itemsRef.current;
      if (idx < 0 || idx >= items.length) return;
      const item = items[idx];
      indexRef.current = idx;
      const token = ++tokenRef.current;
      // Cancel-then-speak back-to-back drops utterances on Chrome Android,
      // so always cancel first and speak after a short delay.
      try {
        window.speechSynthesis.cancel();
      } catch {}
      setCurrent({
        para: item.para,
        langId: item.langId,
        langLabel: TTS_LANG_LABEL[item.langId] || item.langId,
        index: idx,
        total: items.length,
      });
      highlightItem(item);
      const delay = isAndroidChrome() ? 250 : 60;
      const startedAt = Date.now();
      setTimeout(() => {
        if (token !== tokenRef.current) return;
        if (!stateRef.current.playing || stateRef.current.paused) return;
        const bcp47 = TTS_LANG_ID_TO_BCP47[item.langId] || 'en-US';
        const useDefault = retryRef.current.idx === idx;
        const utter = new SpeechSynthesisUtterance(item.text);
        const voice = useDefault ? null : resolveVoice(item.langId);
        if (voice) {
          utter.voice = voice;
          utter.lang = voice.lang || bcp47;
        } else {
          // No matching voice on this device (e.g. Myanmar voice not
          // installed): let the engine fall back instead of forcing a locale
          // it cannot serve, which ends instantly and silently.
          utter.lang = useDefault ? bcp47.split('-')[0] : bcp47;
        }
        utter.rate = prefsRef.current.rate;
        utter.pitch = prefsRef.current.pitch;
        utter.volume = prefsRef.current.volume;
        const handleEnd = () => {
          if (token !== tokenRef.current) return;
          if (!stateRef.current.playing || stateRef.current.paused) return;
          const elapsed = Date.now() - startedAt;
          // Silent-voice watchdog: a real utterance cannot finish in <400ms.
          // Instant onend means the engine had no usable voice — retry once
          // with the system default voice before skipping the chunk.
          if (elapsed < 400 && item.text.length > 15 && !useDefault) {
            retryRef.current = { idx };
            speakAt(idx);
            return;
          }
          advanceRef.current(1);
        };
        utter.onend = handleEnd;
        utter.onerror = (e) => {
          if (token !== tokenRef.current) return;
          if (e?.error === 'canceled' || e?.error === 'interrupted') return;
          handleEnd();
        };
        try {
          window.speechSynthesis.speak(utter);
        } catch {}
      }, delay);
    },
    [highlightItem, resolveVoice]
  );

  const stopInternal = useCallback(
    (keepPlayer = false) => {
      tokenRef.current++;
      try {
        if (isTtsSupported()) window.speechSynthesis.cancel();
      } catch {}
      itemsRef.current = [];
      indexRef.current = 0;
      clearHighlight();
      syncState({ active: false, playing: false, paused: false });
      setCurrent(null);
      setIsAdvancing(false);
      if (!keepPlayer) {
        setShowPlayer(false);
        setShowSettings(false);
      }
    },
    [clearHighlight, syncState]
  );

  const advanceRef = useRef((dir) => {});
  advanceRef.current = (dir) => {
    const items = itemsRef.current;
    if (items.length === 0) return;
    if (dir > 0) {
      if (indexRef.current + 1 < items.length) {
        speakAt(indexRef.current + 1);
      } else {
        advanceToNextChapter();
      }
    } else {
      // Previous paragraph: jump to first item of the previous distinct para.
      const curPara = items[indexRef.current]?.para;
      let idx = indexRef.current - 1;
      while (idx > 0 && items[idx]?.para === curPara) idx--;
      const targetPara = items[idx]?.para;
      while (idx > 0 && items[idx - 1]?.para === targetPara) idx--;
      if (stateRef.current.paused) {
        indexRef.current = Math.max(0, idx);
        const item = items[indexRef.current];
        setCurrent({
          para: item.para,
          langId: item.langId,
          langLabel: TTS_LANG_LABEL[item.langId] || item.langId,
          index: indexRef.current,
          total: items.length,
        });
        highlightItem(item);
      } else {
        speakAt(Math.max(0, idx));
      }
    }
  };

  const jumpPara = useCallback(
    (dir) => {
      if (!stateRef.current.active || itemsRef.current.length === 0) return;
      if (dir > 0) {
        // Next paragraph: first item of the next distinct para.
        const items = itemsRef.current;
        const curPara = items[indexRef.current]?.para;
        let idx = indexRef.current + 1;
        while (idx < items.length && items[idx]?.para === curPara) idx++;
        if (idx >= items.length) {
          advanceToNextChapter();
          return;
        }
        if (stateRef.current.paused) {
          indexRef.current = idx;
          const item = items[idx];
          setCurrent({
            para: item.para,
            langId: item.langId,
            langLabel: TTS_LANG_LABEL[item.langId] || item.langId,
            index: idx,
            total: items.length,
          });
          highlightItem(item);
        } else {
          speakAt(idx);
        }
      } else {
        advanceRef.current(-1);
      }
    },
    [highlightItem, speakAt]
  );

  const advanceToNextChapter = useCallback(() => {
    const tab = activeTabRef.current;
    const bookCode = tab?.bookCode;
    const curIdx = tab?.currentChapterIdx;
    const total = tab?.chapters?.length ?? tab?.chapter_count ?? 0;
    if (!bookCode || curIdx === undefined || curIdx === null || !total || curIdx + 1 >= total) {
      stopInternal(true);
      return;
    }
    const nextIdx = curIdx + 1;
    setIsAdvancing(true);
    try {
      if (typeof loadChapter === 'function') loadChapter(bookCode, nextIdx);
    } catch {}
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      setIsAdvancing(false);
      if (!ok || !stateRef.current.active) {
        if (stateRef.current.active) stopInternal(true);
        return;
      }
      const items = buildTtsQueueFromDom(prefsRef.current.langs, null);
      if (items.length === 0) {
        stopInternal(true);
        return;
      }
      itemsRef.current = items;
      speakAt(0);
    };
    try {
      openBook(bookCode, { targetChapterIdx: nextIdx }).then?.(() => {}).catch?.(() => {});
    } catch {}
    // Poll for the next chapter's rendered translation rows (lazy translations).
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (!stateRef.current.active) {
        clearInterval(timer);
        setIsAdvancing(false);
        return;
      }
      const items = buildTtsQueueFromDom(prefsRef.current.langs, null);
      if (items.length > 0 || attempts >= 20) {
        clearInterval(timer);
        finish(items.length > 0);
      }
    }, 500);
  }, [loadChapter, openBook, speakAt, stopInternal]);

  const beginQueue = useCallback(
    (langIds, startPara) => {
      if (!isTtsSupported()) return;
      // Reserve this start so a concurrent stop() aborts the voice wait below.
      const myToken = ++tokenRef.current;
      retryRef.current = { idx: -1 };
      syncState({ active: true, playing: true, paused: false });
      setShowPlayer(true);
      setShowSettings(false);
      setNoTransNotice(false);
      setCurrent(null);
      // Wait for real voices first: starting with an empty voice list makes
      // Chrome Android end every utterance instantly (rapid silent skipping).
      ensureTtsVoices(2500).then(() => {
        if (myToken !== tokenRef.current) return;
        if (!stateRef.current.active) return;
        const items = buildTtsQueueFromDom(langIds, startPara);
        if (items.length === 0) {
          stopInternal(true);
          return;
        }
        prefsRef.current.langs = langIds;
        setTtsLangs(langIds);
        try {
          localStorage.setItem(LS_KEYS.LANGS, JSON.stringify(langIds));
          localStorage.setItem(LS_KEYS.LANGS_FOR, enabledKey);
        } catch {}
        itemsRef.current = items;
        speakAt(0);
      });
    },
    [enabledKey, speakAt, stopInternal, syncState]
  );

  const startWithLangs = useCallback(
    (langIds) => {
      if (!isTtsSupported()) return;
      const ids = (langIds || []).filter((id) => TTS_LANG_ID_TO_CODE[id]);
      if (ids.length === 0) return;
      setShowLangPrompt(false);
      const startPara = detectViewportTopPara();
      beginQueue(ids, startPara);
    },
    [beginQueue]
  );

  const startReadAloud = useCallback(() => {
    if (!isTtsSupported() || startingRef.current) return;
    if (stateRef.current.active) {
      // Already reading: toggle player visibility.
      setShowPlayer((v) => !v);
      return;
    }
    const enabled = getEnabledTtsLangIds(settings);
    if (enabled.length === 0) {
      setNoTransNotice(true);
      setShowPlayer(true);
      return;
    }
    startingRef.current = true;
    setTimeout(() => {
      startingRef.current = false;
    }, 500);
    if (enabled.length === 1) {
      startWithLangs(enabled);
      return;
    }
    const savedFor = (() => {
      try {
        return localStorage.getItem(LS_KEYS.LANGS_FOR) || '';
      } catch {
        return '';
      }
    })();
    const saved = prefsRef.current.langs || [];
    const valid =
      savedFor === enabledKey &&
      saved.length > 0 &&
      saved.every((id) => enabled.includes(id));
    if (valid) {
      startWithLangs(saved);
    } else {
      setShowLangPrompt(true);
      setShowPlayer(false);
    }
  }, [enabledKey, settings, startWithLangs]);

  const togglePlayPause = useCallback(() => {
    if (!stateRef.current.active || itemsRef.current.length === 0) return;
    if (stateRef.current.paused) {
      syncState({ playing: true, paused: false });
      speakAt(indexRef.current);
    } else {
      // Pause = cancel + hold position (avoids iOS resume quirks).
      tokenRef.current++;
      try {
        window.speechSynthesis.cancel();
      } catch {}
      syncState({ playing: true, paused: true });
    }
  }, [speakAt, syncState]);

  const stop = useCallback(() => {
    stopInternal(false);
  }, [stopInternal]);

  // Stop on book/tab switch (chapter advance keeps the same book code).
  const prevBookRef = useRef(activeBookCode);
  useEffect(() => {
    if (prevBookRef.current !== activeBookCode) {
      prevBookRef.current = activeBookCode;
      if (stateRef.current.active) stopInternal(false);
    }
  }, [activeBookCode, stopInternal]);

  // Stop when the enabled translation set changes mid-speech (re-prompt next time).
  const prevEnabledKeyRef = useRef(enabledKey);
  useEffect(() => {
    if (prevEnabledKeyRef.current !== enabledKey) {
      prevEnabledKeyRef.current = enabledKey;
      if (stateRef.current.active) stopInternal(false);
    }
  }, [enabledKey, stopInternal]);

  // Chrome (desktop + Android) auto-pauses long speech chains and never
  // resumes on its own. Nudge it while we are actively playing.
  useEffect(() => {
    if (!isPlaying || isPaused) return;
    const t = setInterval(() => {
      try {
        const s = window.speechSynthesis;
        if (s && s.speaking) s.resume();
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [isPlaying, isPaused]);

  // Stop on unmount.
  useEffect(() => {
    return () => {
      try {
        if (isTtsSupported()) window.speechSynthesis.cancel();
      } catch {}
    };
  }, []);

  // Re-speak the current chunk so voice/rate/pitch/volume changes apply immediately.
  const reSpeakCurrent = useCallback(() => {
    if (!stateRef.current.active || !stateRef.current.playing || stateRef.current.paused) return;
    if (itemsRef.current.length === 0) return;
    speakAt(indexRef.current);
  }, [speakAt]);

  // Enable/disable a language for the TTS queue (Task 1). Rebuilds the queue
  // from the current paragraph when already reading.
  const toggleTtsLang = useCallback(
    (langId) => {
      const enabled = getEnabledTtsLangIds(settings);
      if (!enabled.includes(langId)) return;
      const current = prefsRef.current.langs.filter((id) => enabled.includes(id));
      const base = current.length > 0 ? current : enabled.slice(0, 1);
      let next;
      if (base.includes(langId)) {
        if (base.length <= 1) return; // Keep at least one language.
        next = base.filter((id) => id !== langId);
      } else {
        const set = new Set([...base, langId]);
        next = enabled.filter((id) => set.has(id));
      }
      prefsRef.current.langs = next;
      setTtsLangs(next);
      try {
        localStorage.setItem(LS_KEYS.LANGS, JSON.stringify(next));
        localStorage.setItem(LS_KEYS.LANGS_FOR, enabled.slice().sort().join(','));
      } catch {}
      if (stateRef.current.active && itemsRef.current.length > 0) {
        const para = itemsRef.current[indexRef.current]?.para || null;
        const items = buildTtsQueueFromDom(next, para);
        if (items.length === 0) {
          stopInternal(true);
          return;
        }
        itemsRef.current = items;
        if (stateRef.current.paused) {
          indexRef.current = 0;
          const item = items[0];
          setCurrent({
            para: item.para,
            langId: item.langId,
            langLabel: TTS_LANG_LABEL[item.langId] || item.langId,
            index: 0,
            total: items.length,
          });
          highlightItem(item);
        } else {
          speakAt(0);
        }
      }
    },
    [highlightItem, settings, speakAt, stopInternal]
  );

  const setVoiceForLang = useCallback((langId, voiceURI) => {
    setTtsVoices((prev) => {
      const next = { ...prev, [langId]: voiceURI };
      prefsRef.current.voices = next;
      try {
        localStorage.setItem(LS_KEYS.VOICES, JSON.stringify(next));
      } catch {}
      return next;
    });
    reSpeakCurrent();
  }, [reSpeakCurrent]);

  const setRate = useCallback((v) => {
    const n = Math.min(2, Math.max(0.5, Number(v) || 1));
    prefsRef.current.rate = n;
    setRateState(n);
    try {
      localStorage.setItem(LS_KEYS.RATE, String(n));
    } catch {}
    reSpeakCurrent();
  }, [reSpeakCurrent]);

  const setPitch = useCallback((v) => {
    const n = Math.min(2, Math.max(0, Number(v) || 1));
    prefsRef.current.pitch = n;
    setPitchState(n);
    try {
      localStorage.setItem(LS_KEYS.PITCH, String(n));
    } catch {}
    reSpeakCurrent();
  }, [reSpeakCurrent]);

  const setVolume = useCallback((v) => {
    const n = Math.min(1, Math.max(0, Number(v)));
    prefsRef.current.volume = isNaN(n) ? 1 : n;
    setVolumeState(prefsRef.current.volume);
    try {
      localStorage.setItem(LS_KEYS.VOLUME, String(prefsRef.current.volume));
    } catch {}
    reSpeakCurrent();
  }, [reSpeakCurrent]);

  const setFollow = useCallback((v) => {
    prefsRef.current.follow = !!v;
    setFollowState(!!v);
    try {
      localStorage.setItem(LS_KEYS.FOLLOW, String(!!v));
    } catch {}
  }, []);

  const value = {
    isSupported: isTtsSupported(),
    isActive,
    isPlaying,
    isPaused,
    isAdvancing,
    current,
    ttsLangs,
    enabledLangIds,
    showLangPrompt,
    setShowLangPrompt,
    showPlayer,
    setShowPlayer,
    showSettings,
    setShowSettings,
    noTransNotice,
    setNoTransNotice,
    voices,
    ttsVoices,
    rate,
    pitch,
    volume,
    follow,
    openLanguageMenu,
    startReadAloud,
    startWithLangs,
    togglePlayPause,
    stop,
    nextPara: () => jumpPara(1),
    prevPara: () => jumpPara(-1),
    toggleTtsLang,
    setVoiceForLang,
    setRate,
    setPitch,
    setVolume,
    setFollow,
  };

  return <TtsContext.Provider value={value}>{children}</TtsContext.Provider>;
}

export function useTts() {
  const ctx = useContext(TtsContext);
  if (!ctx) throw new Error('useTts must be used within a TtsProvider');
  return ctx;
}
