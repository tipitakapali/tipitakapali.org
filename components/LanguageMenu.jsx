'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Languages,
  X,
  Sparkles,
  ChevronUp,
  ChevronDown,
  Rows3,
  ListOrdered,
  Feather,
  SquareText,
  Columns2,
  ArrowUpToLine,
  ExternalLink,
  AlertTriangle,
  Palette,
  RotateCcw,
  Check,
  Download,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { useThemeSettings, getDefaultTranslationSlotColor } from '../context/ThemeSettingsContext';
import { PALI_SCRIPTS_LIST } from '../services/transliterate';
import { invalidateSearchDatabasesCache } from '../services/api';

export const LANG_ID_TO_DB_CODE = {
  english: 'en',
  vietnamese: 'vi',
  myanmar: 'my',
  my_nissaya: 'my_nissaya',
  sinhala: 'si',
  chinese: 'zh',
  khmer: 'km',
  thai: 'th',
  lao: 'lo',
  tamil: 'ta',
  hindi: 'hi',
  marathi: 'mr',
  indonesian: 'id',
  czech: 'cs',
  german: 'de',
  spanish: 'es',
  french: 'fr',
  japanese: 'ja',
  portuguese: 'pt',
  russian: 'ru',
  korean: 'ko',
  nepali: 'ne',
  bengali: 'be',
};

export function isOfflineLanguageMenuMode() {
  if (process.env.NEXT_PUBLIC_OFFLINE_APP === 'true') return true;
  if (typeof window !== 'undefined' && Boolean(window.flutter_inappwebview?.callHandler)) {
    return true;
  }
  return false;
}

export function formatOfflineBytes(bytes) {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num <= 0) return '';
  if (num < 1024) return `${num} B`;
  const kb = num / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function moveEnabledLanguageOrder(translationOrder, enabledIds, targetId, direction) {
  if (!Array.isArray(translationOrder) || !Array.isArray(enabledIds)) return translationOrder;
  const enabledPos = enabledIds.indexOf(targetId);
  if (enabledPos === -1) return translationOrder;

  const next = [...translationOrder];
  const fromIdx = next.indexOf(targetId);
  if (fromIdx === -1) return translationOrder;

  if (direction === 'top') {
    const firstEnabled = enabledIds[0];
    const keepPaliFirst = firstEnabled === 'pali' && targetId !== 'pali';
    const anchorId = keepPaliFirst ? enabledIds[1] : enabledIds[0];
    if (!anchorId || anchorId === targetId) return translationOrder;
    const anchorIdx = next.indexOf(anchorId);
    if (anchorIdx === -1 || fromIdx <= anchorIdx) return translationOrder;
    const [moved] = next.splice(fromIdx, 1);
    const updatedAnchorIdx = next.indexOf(anchorId);
    next.splice(updatedAnchorIdx, 0, moved);
    return next;
  }

  if (direction === 'up' && enabledPos > 0) {
    const prevEnabledId = enabledIds[enabledPos - 1];
    const prevIdx = next.indexOf(prevEnabledId);
    if (prevIdx === -1) return translationOrder;
    const [moved] = next.splice(fromIdx, 1);
    const updatedPrevIdx = next.indexOf(prevEnabledId);
    next.splice(updatedPrevIdx, 0, moved);
    return next;
  }

  if (direction === 'down' && enabledPos < enabledIds.length - 1) {
    const nextEnabledId = enabledIds[enabledPos + 1];
    const nextIdx = next.indexOf(nextEnabledId);
    if (nextIdx === -1) return translationOrder;
    const [moved] = next.splice(fromIdx, 1);
    const updatedNextIdx = next.indexOf(nextEnabledId);
    next.splice(updatedNextIdx + 1, 0, moved);
    return next;
  }

  return translationOrder;
}

export const TRANSLATIONS = [
  { id: 'pali', label: 'Pāḷi (Root Canon)', flag: '☸️', desc: 'Chaṭṭha Saṅgāyana Tipiṭaka (VRI)', color: '#8b2500' },
  { id: 'english', label: 'English', flag: '🇬🇧', desc: 'English Translation • 1.28M sentences', color: '#2563eb' },
  { id: 'vietnamese', label: 'Tiếng Việt', flag: '🇻🇳', desc: 'Bản dịch Tiếng Việt • 1.28M câu', color: '#dc2626' },
  { id: 'myanmar', label: 'မြန်မာ', flag: '🇲🇲', desc: 'မြန်မာဘာသာပြန် • 1.28M စာကြောင်း', color: '#059669' },
  { id: 'my_nissaya', label: 'မြန်မာ နိဿယ', flag: '🇲🇲', desc: 'Myanmar Nissaya • 570K စာကြောင်း', color: '#4d7c0f' },
  { id: 'sinhala', label: 'සිංහල', flag: '🇱🇰', desc: 'සිංහල පරිවර්තනය • 1.21M වාක්‍ය', color: '#d97706' },
  { id: 'chinese', label: '中文', flag: '🇨🇳', desc: '中文翻译 • 1.27M 句', color: '#9f1239' },
  { id: 'khmer', label: 'ភាសាខ្មែរ', flag: '🇰🇭', desc: 'ការបកប្រែជាភាសាខ្មែរ • 1.18M ប្រយោគ', color: '#0891b2' },
  { id: 'thai', label: 'ไทย', flag: '🇹🇭', desc: 'ฉบับแปลภาษาไทย • 1.27M ประโยค', color: '#7c3aed' },
  { id: 'lao', label: 'ລາວ', flag: '🇱🇦', desc: 'ການແປພາສາລາວ • 328K ປະໂຫຍກ', color: '#115e59' },
  { id: 'tamil', label: 'தமிழ்', flag: '🇮🇳', desc: 'தமிழ் மொழிபெயர்ப்பு • 1.22M வாக்கியங்கள்', color: '#c2410c' },
  { id: 'hindi', label: 'हिन्दी', flag: '🇮🇳', desc: 'हिन्दी अनुवाद • 1.22M वाक्य', color: '#6b21a8' },
  { id: 'marathi', label: 'मराठी', flag: '🇮🇳', desc: 'मराठी अनुवाद • 1.20M वाक्य', color: '#ea580c' },
  { id: 'indonesian', label: 'Bahasa Indonesia', flag: '🇮🇩', desc: 'Terjemahan Bahasa Indonesia • 1.22M kalimat', color: '#c026d3' },
  { id: 'czech', label: 'Čeština', flag: '🇨🇿', desc: 'Český překlad • 1.20M vět', color: '#0284c7' },
  { id: 'german', label: 'Deutsch', flag: '🇩🇪', desc: 'Deutsche Übersetzung • 1.28M Sätze', color: '#475569' },
  { id: 'spanish', label: 'Español', flag: '🇪🇸', desc: 'Traducción en Español • 1.27M oraciones', color: '#b45309' },
  { id: 'french', label: 'Français', flag: '🇫🇷', desc: 'Traduction en Français • 1.27M phrases', color: '#4338ca' },
  { id: 'japanese', label: '日本語', flag: '🇯🇵', desc: '日本語訳 • 1.25M 文', color: '#db2777' },
  { id: 'portuguese', label: 'Português', flag: '🇵🇹', desc: 'Tradução em Português • 1.22M frases', color: '#0c4a6e' },
  { id: 'russian', label: 'Русский', flag: '🇷🇺', desc: 'Русский перевод • 1.22M предложений', color: '#eab308' },
  { id: 'korean', label: '한국어', flag: '🇰🇷', desc: '한국어 번역 • 1.22M 문장', color: '#4f46e5' },
  { id: 'nepali', label: 'नेपाली', flag: '🇳🇵', desc: 'नेपाली अनुवाद • 1.22M वाक्य', color: '#9a3412' },
  { id: 'bengali', label: 'বাংলা', flag: '🇧🇩', desc: 'বাংলা অনুবাদ • 1.27M বাক্য', color: '#047857' },
];

export const AVAILABLE_TRANSLATIONS = TRANSLATIONS.filter(
  (t) => t.id !== 'pali' && !t.disabled
);

export const AVAILABLE_TRANSLATION_COUNT = AVAILABLE_TRANSLATIONS.length;

const BG_PALETTE = [
  { name: 'Default', value: '' },
  { name: 'Pure White', value: '#ffffff' },
  { name: 'Cream', value: '#fdfdfc' },
  { name: 'Classic Warm', value: '#f0eee5' },
  { name: 'Sepia Warm', value: '#fbf0d9' },
  { name: 'Soft Amber', value: '#fef3c7' },
  { name: 'Soft Mint', value: '#dcfce7' },
  { name: 'Soft Cyan', value: '#e0f2fe' },
  { name: 'Soft Indigo', value: '#e0e7ff' },
  { name: 'Soft Purple', value: '#f3e8ff' },
  { name: 'Soft Rose', value: '#fee2e2' },
  { name: 'Dark Slate', value: '#1e293b' },
  { name: 'Dark Neutral', value: '#18191a' },
];

const TEXT_PALETTE = [
  { name: 'Default', value: '' },
  { name: 'Near Black', value: '#111827' },
  { name: 'Slate Dark', value: '#1e293b' },
  { name: 'Charcoal', value: '#374151' },
  { name: 'Navy Blue', value: '#1e3a8a' },
  { name: 'Forest Green', value: '#064e3b' },
  { name: 'Earth Brown', value: '#78350f' },
  { name: 'Wine Red', value: '#881337' },
  { name: 'Deep Purple', value: '#581c87' },
  { name: 'Pure White', value: '#ffffff' },
  { name: 'Soft White', value: '#f8fafc' },
  { name: 'Pale Gold', value: '#fef08a' },
  { name: 'Pale Mint', value: '#a7f3d0' },
];

const BORDER_PALETTE = [
  { name: 'Burgundy', value: '#8b2500' },
  { name: 'Royal Blue', value: '#2563eb' },
  { name: 'Crimson Red', value: '#dc2626' },
  { name: 'Jade Green', value: '#059669' },
  { name: 'Saffron Amber', value: '#d97706' },
  { name: 'Rose Crimson', value: '#e11d48' },
  { name: 'Deep Cyan', value: '#0891b2' },
  { name: 'Violet', value: '#7c3aed' },
  { name: 'Vivid Orange', value: '#ea580c' },
  { name: 'Marigold Gold', value: '#ca8a04' },
  { name: 'Cherry Pink', value: '#db2777' },
  { name: 'Dark Teal', value: '#0d9488' },
  { name: 'Indigo', value: '#4f46e5' },
  { name: 'Emerald', value: '#16a34a' },
  { name: 'Sky Blue', value: '#0284c7' },
  { name: 'Slate', value: '#475569' },
];

function hslToHex(h, s, l) {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function getThemeMode(theme) {
  if (theme === 'oled') return 'oled';
  if (theme === 'dark') return 'dark';
  if (theme === 'dusk') return 'dusk';
  if (theme === 'sepia' || theme === 'warm') return 'warm';
  return 'light'; // classic, white, default, etc.
}

export function generateThemeAwareLanguageColors(theme = 'classic', baseHue = null) {
  const mode = getThemeMode(theme);
  const h = baseHue !== null ? baseHue : Math.floor(Math.random() * 360);
  const borderHue = (h + Math.floor(Math.random() * 40) - 20 + 360) % 360;

  let bg, text, border;

  if (mode === 'oled') {
    bg = hslToHex(h, 20 + Math.floor(Math.random() * 20), 6 + Math.floor(Math.random() * 5));
    text = hslToHex(h, 15 + Math.floor(Math.random() * 20), 92 + Math.floor(Math.random() * 7));
    border = hslToHex(borderHue, 80 + Math.floor(Math.random() * 20), 55 + Math.floor(Math.random() * 12));
  } else if (mode === 'dusk') {
    // Dusk / Dracula theme with calm dark-slate undertones
    bg = hslToHex(h, 20 + Math.floor(Math.random() * 20), 16 + Math.floor(Math.random() * 6));
    text = hslToHex(h, 12 + Math.floor(Math.random() * 15), 93 + Math.floor(Math.random() * 6));
    border = hslToHex(borderHue, 85 + Math.floor(Math.random() * 15), 60 + Math.floor(Math.random() * 10));
  } else if (mode === 'dark') {
    bg = hslToHex(h, 20 + Math.floor(Math.random() * 25), 14 + Math.floor(Math.random() * 8));
    text = hslToHex(h, 15 + Math.floor(Math.random() * 20), 88 + Math.floor(Math.random() * 10));
    border = hslToHex(borderHue, 75 + Math.floor(Math.random() * 25), 52 + Math.floor(Math.random() * 12));
  } else if (mode === 'warm') {
    // Warm / Sepia theme with soft parchment tints and warm earthy text
    bg = hslToHex(h, 28 + Math.floor(Math.random() * 22), 91 + Math.floor(Math.random() * 5));
    text = hslToHex(h, 30 + Math.floor(Math.random() * 20), 14 + Math.floor(Math.random() * 8));
    border = hslToHex(borderHue, 80 + Math.floor(Math.random() * 20), 40 + Math.floor(Math.random() * 12));
  } else {
    // Light / Classic
    bg = hslToHex(h, 35 + Math.floor(Math.random() * 30), 92 + Math.floor(Math.random() * 5));
    text = hslToHex(h, 30 + Math.floor(Math.random() * 25), 12 + Math.floor(Math.random() * 12));
    border = hslToHex(borderHue, 80 + Math.floor(Math.random() * 20), 42 + Math.floor(Math.random() * 10));
  }

  return { bg, text, border };
}

export function generateRandomLanguageColors(theme = 'classic') {
  return generateThemeAwareLanguageColors(theme);
}

export function formatCssColor(val, fallback = '') {
  if (!val) return fallback;
  const trimmed = val.trim();
  if (!trimmed) return fallback;
  // If user typed 3, 6, or 8 hex characters without '#', prepend '#'
  if (/^[0-9a-fA-F]{3}$/.test(trimmed) || /^[0-9a-fA-F]{6}$/.test(trimmed) || /^[0-9a-fA-F]{8}$/.test(trimmed)) {
    return `#${trimmed}`;
  }
  return trimmed;
}

export function toValidHex(colorStr, fallback = '#8b2500') {
  if (!colorStr) return fallback;
  const formatted = formatCssColor(colorStr);
  if (/^#[0-9a-fA-F]{6}$/.test(formatted)) return formatted.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(formatted)) {
    const r = formatted[1];
    const g = formatted[2];
    const b = formatted[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

export default function LanguageMenu({ forceOfflineMode, initialOfflineState = null } = {}) {
  const { settings, updateSetting, isLanguageMenuOpen, setIsLanguageMenuOpen } = useThemeSettings();
  const [localIsOpen, setLocalIsOpen] = useState(false);
  const isOpen = isLanguageMenuOpen !== undefined ? isLanguageMenuOpen : localIsOpen;
  const setIsOpen = setIsLanguageMenuOpen || setLocalIsOpen;

  const isOffline =
    typeof forceOfflineMode === 'boolean' ? forceOfflineMode : isOfflineLanguageMenuMode();

  // AI translation disclaimer popup state
  const [disclaimerModalOpen, setDisclaimerModalOpen] = useState(false);
  const [pendingLangId, setPendingLangId] = useState(null);

  // Color customization modal state
  const [colorPickerTarget, setColorPickerTarget] = useState(null);

  // Accessibility live announcement on language reorder
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');

  // Offline management state (downloaded DBs, FTS, available updates, active operation)
  const [offlineState, setOfflineState] = useState(() => ({
    installedCodes: initialOfflineState?.installedCodes || [],
    ftsCodes: initialOfflineState?.ftsCodes || [],
    updates: initialOfflineState?.updates || {},
    catalog: initialOfflineState?.catalog || {},
    hasPaliSentences: Boolean(initialOfflineState?.hasPaliSentences),
    paliSentencesAsset: initialOfflineState?.paliSentencesAsset || null,
    fetchedLiveRelease: Boolean(initialOfflineState?.fetchedLiveRelease),
    isFetchingManifest: Boolean(initialOfflineState?.isFetchingManifest),
    hasCheckedUpdates: Boolean(initialOfflineState?.hasCheckedUpdates),
    releaseWarning: initialOfflineState?.releaseWarning || null,
    loaded: Boolean(initialOfflineState),
  }));
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [updateCheckSummary, setUpdateCheckSummary] = useState('');
  const [offlineBusyCode, setOfflineBusyCode] = useState(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState(null);

  const applyOfflinePayload = useCallback((payload) => {
    if (!payload || typeof payload !== 'object') return;
    setOfflineState({
      installedCodes: Array.isArray(payload.installedCodes) ? payload.installedCodes : [],
      ftsCodes: Array.isArray(payload.ftsCodes) ? payload.ftsCodes : [],
      updates: payload.updates && typeof payload.updates === 'object' ? payload.updates : {},
      catalog: payload.catalog && typeof payload.catalog === 'object' ? payload.catalog : {},
      hasPaliSentences: Boolean(payload.hasPaliSentences),
      paliSentencesAsset: payload.paliSentencesAsset || null,
      fetchedLiveRelease: Boolean(payload.fetchedLiveRelease),
      isFetchingManifest: Boolean(payload.isFetchingManifest),
      hasCheckedUpdates: Boolean(payload.hasCheckedUpdates),
      releaseWarning: payload.releaseWarning || null,
      loaded: true,
    });
  }, []);

  const refreshOfflineState = useCallback(async () => {
    if (!isOffline || typeof window === 'undefined') return null;
    const bridge = window.flutter_inappwebview?.callHandler;
    if (bridge) {
      try {
        const res = await bridge('getOfflineTranslationsState');
        if (res && typeof res === 'object') {
          applyOfflinePayload(res);
          return res;
        }
      } catch (_) {}
    }
    try {
      const resp = await fetch('/api/translations');
      if (resp.ok) {
        const data = await resp.json();
        const codes = Array.isArray(data?.available)
          ? data.available.map((t) => String(t.code || '').trim().toLowerCase()).filter(Boolean)
          : [];
        setOfflineState((prev) => ({
          ...prev,
          installedCodes: codes,
          hasPaliSentences: Boolean(data?.has_pali_sentences),
          loaded: true,
        }));
        return { installedCodes: codes };
      }
    } catch (_) {}
    return null;
  }, [isOffline, applyOfflinePayload]);

  const notifyOfflineFtsChanged = useCallback(() => {
    if (typeof invalidateSearchDatabasesCache === 'function') {
      invalidateSearchDatabasesCache();
    }
    if (typeof window !== 'undefined') {
      try {
        window.__tpoOnFtsUpdated?.();
      } catch (_) {}
      try {
        window.dispatchEvent(new CustomEvent('tipitaka:fts-databases-changed'));
      } catch (_) {}
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !isOffline) return;
    refreshOfflineState();
    if (typeof window === 'undefined') return;
    const onPlatformReady = () => refreshOfflineState();
    window.addEventListener('flutterInAppWebViewPlatformReady', onPlatformReady);
    return () => window.removeEventListener('flutterInAppWebViewPlatformReady', onPlatformReady);
  }, [isOpen, isOffline, refreshOfflineState]);

  useEffect(() => {
    if (!isOffline || typeof window === 'undefined') return;
    const prevChanged = window.__tpoOnOfflineLangStateChanged;
    const handler = () => {
      refreshOfflineState();
      if (typeof prevChanged === 'function') prevChanged();
    };
    window.__tpoOnOfflineLangStateChanged = handler;
    return () => {
      if (window.__tpoOnOfflineLangStateChanged === handler) {
        window.__tpoOnOfflineLangStateChanged = prevChanged;
      }
    };
  }, [isOffline, refreshOfflineState]);



  const updateLangColors = (langId, partial) => {
    const current = settings.translationColors || {};
    const updated = {
      ...current,
      [langId]: {
        ...(current[langId] || {}),
        ...partial,
      },
    };
    updateSetting('translationColors', updated);
  };

  const resetLangColors = (langId) => {
    const current = { ...(settings.translationColors || {}) };
    delete current[langId];
    updateSetting('translationColors', current);
  };

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (deleteConfirmTarget) {
          setDeleteConfirmTarget(null);
        } else if (colorPickerTarget) {
          setColorPickerTarget(null);
        } else if (disclaimerModalOpen) {
          setDisclaimerModalOpen(false);
          setPendingLangId(null);
        } else if (isOpen) {
          setIsOpen(false);
        }
      }
    };
    if (isOpen || disclaimerModalOpen || colorPickerTarget || deleteConfirmTarget) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, disclaimerModalOpen, colorPickerTarget, deleteConfirmTarget]);

  const activeCount = useMemo(() => {
    const current = settings.translations || {};
    return TRANSLATIONS.filter((t) => !t.disabled && (t.id === 'pali' ? current.pali !== false : Boolean(current[t.id]))).length;
  }, [settings.translations]);

  const translationOrder = useMemo(() => {
    const order = settings.translationOrder;
    if (Array.isArray(order) && order.length > 0) {
      const knownIds = TRANSLATIONS.map((t) => t.id);
      const filtered = order.filter((id) => knownIds.includes(id));
      for (const id of knownIds) if (!filtered.includes(id)) filtered.push(id);

      // Migrate my_nissaya right under myanmar if it was at the old default position (end of list)
      const myIdx = filtered.indexOf('myanmar');
      const nissayaIdx = filtered.indexOf('my_nissaya');
      if (myIdx !== -1 && nissayaIdx !== -1 && nissayaIdx > myIdx + 1 && nissayaIdx >= filtered.length - 2) {
        filtered.splice(nissayaIdx, 1);
        filtered.splice(myIdx + 1, 0, 'my_nissaya');
      }

      return filtered;
    }
    return TRANSLATIONS.map((t) => t.id);
  }, [settings.translationOrder]);

  const enabledLangIds = useMemo(() => {
    const current = settings.translations || {};
    return translationOrder.filter((id) =>
      id === 'pali' ? current.pali !== false : Boolean(current[id])
    );
  }, [translationOrder, settings.translations]);

  const enabledTransSlotMap = useMemo(() => {
    const map = new Map();
    let slot = 0;
    for (const id of enabledLangIds) {
      if (id !== 'pali') {
        map.set(id, slot++);
      }
    }
    return map;
  }, [enabledLangIds]);

  const getDefaultSlotColor = (trans) => {
    if (!trans) return '#772e03';
    if (trans.id !== 'pali' && enabledTransSlotMap.has(trans.id)) {
      return getDefaultTranslationSlotColor(
        settings.theme || 'classic',
        enabledTransSlotMap.get(trans.id)
      );
    }
    return trans.color || '#8b2500';
  };

  const handleApplyThemeAwareColors = (mode = 'all') => {
    const currentColors = { ...(settings.translationColors || {}) };
    const theme = settings.theme || 'classic';
    const startHue = Math.floor(Math.random() * 360);

    enabledLangIds.forEach((langId, idx) => {
      const baseHue = Math.floor((startHue + (idx * 360) / Math.max(1, enabledLangIds.length)) % 360);
      const randomSet = generateThemeAwareLanguageColors(theme, baseHue);

      const existing = currentColors[langId] || {};
      if (mode === 'all') {
        currentColors[langId] = { ...existing, bg: randomSet.bg, text: randomSet.text, border: randomSet.border };
      } else if (mode === 'bg') {
        currentColors[langId] = { ...existing, bg: randomSet.bg };
      } else if (mode === 'text') {
        currentColors[langId] = { ...existing, text: randomSet.text };
      } else if (mode === 'border') {
        currentColors[langId] = { ...existing, border: randomSet.border };
      }
    });

    updateSetting('translationColors', currentColors);
  };

  const handleResetEnabledColors = () => {
    const currentColors = { ...(settings.translationColors || {}) };
    enabledLangIds.forEach((langId) => {
      delete currentColors[langId];
    });
    updateSetting('translationColors', currentColors);
  };

  const orderedTranslations = useMemo(() => {
    const map = new Map(TRANSLATIONS.map((t) => [t.id, t]));
    return translationOrder.map((id) => map.get(id)).filter(Boolean);
  }, [translationOrder]);

  const { enabledTranslations, availableTranslationsList } = useMemo(() => {
    const current = settings.translations || {};
    const enabled = [];
    const available = [];
    for (const t of orderedTranslations) {
      const isEnabled =
        !t.disabled && (t.id === 'pali' ? current.pali !== false : Boolean(current[t.id]));
      if (isEnabled) {
        enabled.push(t);
      } else {
        available.push(t);
      }
    }
    return { enabledTranslations: enabled, availableTranslationsList: available };
  }, [orderedTranslations, settings.translations]);

  const installedCodeSet = useMemo(() => new Set(offlineState.installedCodes || []), [offlineState.installedCodes]);
  const ftsCodeSet = useMemo(() => new Set(offlineState.ftsCodes || []), [offlineState.ftsCodes]);
  const availableUpdateCount = useMemo(
    () => Object.keys(offlineState.updates || {}).length,
    [offlineState.updates]
  );

  const translationDisplayMode = settings.translationDisplayMode || 'stack';
  const translationGranularity = settings.translationGranularity || 'sentence';

  const applyToggleTranslation = (tId, forceValue = null) => {
    const item = TRANSLATIONS.find((t) => t.id === tId);
    if (item?.disabled) return;

    const current = settings.translations || {};
    const isPali = tId === 'pali';
    const isCurrentlyChecked = isPali ? current.pali !== false : Boolean(current[tId]);
    const targetChecked = typeof forceValue === 'boolean' ? forceValue : !isCurrentlyChecked;
    const updated = {
      ...current,
      [tId]: targetChecked,
    };
    const anyLeft = TRANSLATIONS.some(
      (t) => !t.disabled && (t.id === 'pali' ? updated.pali !== false : Boolean(updated[t.id]))
    );
    if (!anyLeft) {
      updated.pali = true;
    }
    updateSetting('translations', updated);
  };

  const handleOfflineDownload = async (trans, { enableOnComplete = false } = {}) => {
    const dbCode = LANG_ID_TO_DB_CODE[trans.id];
    const bridge = typeof window !== 'undefined' ? window.flutter_inappwebview?.callHandler : null;
    if (!dbCode || !bridge || offlineBusyCode) return;

    setOfflineBusyCode(dbCode);
    try {
      const res = await bridge('downloadLanguage', {
        code: dbCode,
        label: trans.label,
        enableOnComplete,
      });
      if (res?.state) {
        applyOfflinePayload(res.state);
      } else {
        await refreshOfflineState();
      }
      if (res?.success) {
        notifyOfflineFtsChanged();
        if (enableOnComplete) {
          applyToggleTranslation(trans.id, true);
        }
      }
    } catch (_) {
    } finally {
      setOfflineBusyCode(null);
    }
  };

  const handleOfflineUpdate = async (trans) => {
    const dbCode = LANG_ID_TO_DB_CODE[trans.id];
    const bridge = typeof window !== 'undefined' ? window.flutter_inappwebview?.callHandler : null;
    if (!dbCode || !bridge || offlineBusyCode) return;

    setOfflineBusyCode(dbCode);
    try {
      const res = await bridge('updateTranslationLanguage', {
        code: dbCode,
        label: trans.label,
      });
      if (res?.state) {
        applyOfflinePayload(res.state);
      } else {
        await refreshOfflineState();
      }
      if (res?.success) {
        notifyOfflineFtsChanged();
        const remainingUpdates = Object.keys(res?.state?.updates || {}).length;
        setUpdateCheckSummary(
          remainingUpdates > 0
            ? `${trans.label} updated (${remainingUpdates} update${remainingUpdates === 1 ? '' : 's'} remaining)`
            : `${trans.label} updated successfully`
        );
      }
    } catch (_) {
    } finally {
      setOfflineBusyCode(null);
    }
  };

  const handleConfirmDeleteOffline = async () => {
    const trans = deleteConfirmTarget;
    if (!trans) return;
    const dbCode = LANG_ID_TO_DB_CODE[trans.id];
    const bridge = typeof window !== 'undefined' ? window.flutter_inappwebview?.callHandler : null;
    if (!dbCode) {
      setDeleteConfirmTarget(null);
      return;
    }

    setOfflineBusyCode(dbCode);
    try {
      if (bridge) {
        const res = await bridge('deleteTranslationLanguage', { code: dbCode });
        if (res?.state) {
          applyOfflinePayload(res.state);
        } else {
          await refreshOfflineState();
        }
        if (res?.success) {
          notifyOfflineFtsChanged();
          applyToggleTranslation(trans.id, false);
          setUpdateCheckSummary('');
          setReorderAnnouncement(`Deleted offline data for ${trans.label}`);
        }
      }
    } catch (_) {
    } finally {
      setOfflineBusyCode(null);
      setDeleteConfirmTarget(null);
    }
  };

  const handleCheckForUpdates = async () => {
    const bridge = typeof window !== 'undefined' ? window.flutter_inappwebview?.callHandler : null;
    if (!bridge || isCheckingUpdates) return;
    setIsCheckingUpdates(true);
    setUpdateCheckSummary('');
    try {
      const payload = await bridge('checkTranslationUpdates');
      if (payload && typeof payload === 'object') {
        applyOfflinePayload(payload);
        const count = Object.keys(payload.updates || {}).length;
        if (count > 0) {
          setUpdateCheckSummary(`${count} translation update${count === 1 ? '' : 's'} available`);
        } else if (payload.fetchedLiveRelease) {
          setUpdateCheckSummary('All downloaded translations are up to date.');
        } else if (payload.releaseWarning) {
          setUpdateCheckSummary(String(payload.releaseWarning));
        } else {
          setUpdateCheckSummary('Checked local catalog (connect online to check GitHub releases).');
        }
      }
    } catch (_) {
      setUpdateCheckSummary('Could not reach update manifest.');
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  const handleToggleTranslation = async (tId) => {
    const item = TRANSLATIONS.find((t) => t.id === tId);
    if (item?.disabled) return;

    const current = settings.translations || {};
    const isPali = tId === 'pali';
    const isCurrentlyChecked = isPali ? current.pali !== false : Boolean(current[tId]);
    const willBeChecked = !isCurrentlyChecked;

    if (!willBeChecked) {
      // Prevent disabling if this is the only active language
      if (activeCount <= 1) {
        return;
      }
      applyToggleTranslation(tId, false);
      return;
    }

    if (isPali) {
      applyToggleTranslation(tId, true);
      return;
    }

    // In the offline app, if this language pack isn't downloaded yet, prompt Flutter download + AI notice dialog
    const dbCode = LANG_ID_TO_DB_CODE[tId];
    if (
      isOffline &&
      dbCode &&
      typeof window !== 'undefined' &&
      window.flutter_inappwebview?.callHandler
    ) {
      let isInstalledNow = installedCodeSet.has(dbCode);
      if (!offlineState.loaded) {
        const latest = await refreshOfflineState();
        if (Array.isArray(latest?.installedCodes)) {
          isInstalledNow = latest.installedCodes.includes(dbCode);
        }
      }
      if (!isInstalledNow) {
        handleOfflineDownload(item, { enableOnComplete: true });
        return;
      }
    }

    // Always show the AI notice modal when enabling any translation language (not Pali)
    setPendingLangId(tId);
    setDisclaimerModalOpen(true);
  };

  const handleConfirmDisclaimer = () => {
    if (pendingLangId) {
      applyToggleTranslation(pendingLangId, true);
      setPendingLangId(null);
    }
    setDisclaimerModalOpen(false);
  };

  const handleCancelDisclaimer = () => {
    setPendingLangId(null);
    setDisclaimerModalOpen(false);
  };

  const handleMoveTranslation = (dictId, direction) => {
    const next = moveEnabledLanguageOrder(translationOrder, enabledLangIds, dictId, direction);
    if (next === translationOrder) return;
    const item = TRANSLATIONS.find((t) => t.id === dictId);
    const label = item?.label || dictId;
    setReorderAnnouncement(
      direction === 'top'
        ? `Moved ${label} to top`
        : direction === 'up'
        ? `Moved ${label} up`
        : `Moved ${label} down`
    );
    updateSetting('translationOrder', next);
  };

  const handleDisplayModeChange = (mode) => {
    if (!['stack', 'side', 'side_rev'].includes(mode)) return;
    updateSetting('translationDisplayMode', mode);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-1.5 p-2 sm:px-2.5 sm:py-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition cursor-pointer ${
          isOpen ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-light)]' : ''
        }`}
        title="Pāḷi script and translation Language"
        aria-label="Pāḷi script and translation Language"
      >
        <Languages size={14} className="text-[var(--accent)]" />
        <span className="hidden min-[560px]:inline">Language</span>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4 animate-fade-in"
          onClick={() => setIsOpen(false)}
        >
          <div
            data-tpo-native-lang-menu="1"
            role="dialog"
            aria-modal="true"
            aria-label="Language & Display Settings"
            className="w-full max-w-lg bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] sm:max-h-[85vh] text-[var(--text-primary)] animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Body */}
            <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0 overscroll-contain">
              {/* Section 1: Pali Script Selection */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="paliScriptSelect"
                    className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]"
                  >
                    <Feather size={12} className="shrink-0" />
                    Pāḷi Script ({PALI_SCRIPTS_LIST.length} scripts)
                  </label>
                  <a
                    href="/pali-script-converter.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-[var(--accent)] font-semibold hover:underline inline-flex items-center gap-1"
                    title="Open standalone script converter"
                  >
                    <span>Script Converter</span>
                    <ExternalLink size={10} />
                  </a>
                </div>
                <select
                  id="paliScriptSelect"
                  value={settings.paliScript || 'roman'}
                  onChange={(e) => {
                    updateSetting('paliScript', e.target.value);
                  }}
                  className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-xl p-2.5 text-xs font-semibold outline-none cursor-pointer focus:border-[var(--accent)] transition shadow-sm"
                >
                  {PALI_SCRIPTS_LIST.map((script) => (
                    <option key={script.id} value={script.id}>
                      {script.id === 'roman' ? `🌐 ${script.native}` : script.native} — {script.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Section 3: Multi-Translation Layers (including Pāḷi) */}
              <div className="pt-3 border-t border-[var(--border-color)]">
                <div className="mb-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        <Languages size={12} className="shrink-0" />
                        Translation Display Settings
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {isOffline && (
                          <button
                            type="button"
                            onClick={handleCheckForUpdates}
                            disabled={isCheckingUpdates || offlineState.isFetchingManifest}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--bg-card)] text-[var(--accent)] border border-[var(--accent-border)] hover:bg-[var(--accent-light)] transition cursor-pointer disabled:opacity-50"
                            title="Load online release manifest and check if newer translation databases are available"
                          >
                            <RefreshCw
                              size={10}
                              className={isCheckingUpdates || offlineState.isFetchingManifest ? 'animate-spin' : ''}
                            />
                            <span>{isCheckingUpdates ? 'Checking...' : 'Check for Update'}</span>
                          </button>
                        )}
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          {isOffline
                            ? `${installedCodeSet.size} downloaded / ${AVAILABLE_TRANSLATION_COUNT}`
                            : `${AVAILABLE_TRANSLATION_COUNT} available`}
                        </span>
                      </div>
                    </div>
                    {isOffline && (updateCheckSummary || availableUpdateCount > 0) && (
                      <div
                        className={`mt-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center justify-between gap-2 border ${
                          availableUpdateCount > 0
                            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25'
                            : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
                        }`}
                      >
                        <span>
                          {updateCheckSummary ||
                            `${availableUpdateCount} translation update${availableUpdateCount === 1 ? '' : 's'} available`}
                        </span>
                      </div>
                    )}
                  <p className="text-[10.5px] text-[var(--text-muted)] mt-1 normal-case tracking-normal">
                    Pāḷi vs Translation layout
                  </p>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => handleDisplayModeChange('side')}
                      aria-label="Pāḷi on the left, Translation on the right"
                      title="Pāḷi on the left, Translation on the right"
                      className={`p-2 rounded-xl border transition flex items-center justify-center cursor-pointer ${
                        translationDisplayMode === 'side'
                          ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm'
                          : 'bg-[var(--bg-card)] border-[var(--border-color)] hover:border-gray-400 text-[var(--text-primary)]'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1 text-[11px] font-bold leading-tight text-center">
                        Pāḷi
                        <Columns2 size={14} className="shrink-0" />
                        Translation
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDisplayModeChange('stack')}
                      aria-label="Translation below Pāḷi (vertical)"
                      title="Translation below Pāḷi (vertical)"
                      className={`p-2 rounded-xl border transition flex items-center justify-center cursor-pointer ${
                        translationDisplayMode === 'stack'
                          ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm'
                          : 'bg-[var(--bg-card)] border-[var(--border-color)] hover:border-gray-400 text-[var(--text-primary)]'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1 text-[11px] font-bold leading-tight text-center">
                        <SquareText size={14} className="shrink-0" />
                        Stacked
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDisplayModeChange('side_rev')}
                      aria-label="Translation on the left, Pāḷi on the right"
                      title="Translation on the left, Pāḷi on the right"
                      className={`p-2 rounded-xl border transition flex items-center justify-center cursor-pointer ${
                        translationDisplayMode === 'side_rev'
                          ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm'
                          : 'bg-[var(--bg-card)] border-[var(--border-color)] hover:border-gray-400 text-[var(--text-primary)]'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1 text-[11px] font-bold leading-tight text-center">
                        Translation
                        <Columns2 size={14} className="shrink-0 scale-x-[-1]" />
                        Pāḷi
                      </span>
                    </button>
                  </div>
                  <p className="text-[10.5px] text-[var(--text-muted)] mt-1 normal-case tracking-normal">
                    Show translation unit
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => updateSetting('translationGranularity', 'para')}
                      aria-label="Show translations paragraph by paragraph"
                      title="Show translations paragraph by paragraph"
                      className={`p-2 rounded-xl border transition flex items-center justify-center cursor-pointer ${
                        translationGranularity === 'para'
                          ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm'
                          : 'bg-[var(--bg-card)] border-[var(--border-color)] hover:border-gray-400 text-[var(--text-primary)]'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1 text-[11px] font-bold leading-tight text-center">
                        <Rows3 size={14} className="shrink-0" />
                        As Paragraph
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={handleGranularitySentenceClick}
                      disabled={downloadingPaliSentences}
                      aria-label="Show Pāḷi and translations sentence by sentence"
                      title="Show Pāḷi and translations sentence by sentence"
                      className={`p-2 rounded-xl border transition flex items-center justify-center cursor-pointer disabled:opacity-60 ${
                        translationGranularity === 'sentence'
                          ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm'
                          : 'bg-[var(--bg-card)] border-[var(--border-color)] hover:border-gray-400 text-[var(--text-primary)]'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1 text-[11px] font-bold leading-tight text-center">
                        <ListOrdered size={14} className="shrink-0" />
                        <span>As Sentence</span>
                        {isOffline && offlineState.loaded && !offlineState.hasPaliSentences && (
                          <Download size={11} className="shrink-0 text-amber-500" />
                        )}
                      </span>
                    </button>
                  </div>
                  <label className="flex items-center gap-2.5 px-3 py-2 mt-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.showTranslationBorders !== false}
                      onChange={(e) => updateSetting('showTranslationBorders', e.target.checked)}
                      className="accent-[var(--accent)] w-4 h-4 rounded cursor-pointer shrink-0"
                      aria-label="Show translation left border colors"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-[var(--text-primary)]">Show left border colors for translations</span>
                    </span>
                  </label>
                  <label className="flex items-center gap-2.5 px-3 py-2 mt-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.showBookLinks !== false}
                      onChange={(e) => updateSetting('showBookLinks', e.target.checked)}
                      className="accent-[var(--accent)] w-4 h-4 rounded cursor-pointer shrink-0"
                      aria-label="Show Linked Definitions (M ↔ A ↔ Ṭ)"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-[var(--text-primary)]">Show Linked Definitions (M ↔ A ↔ Ṭ)</span>
                      <span className="block text-[10px] text-[var(--text-muted)]">Inline commentary &amp; root links below lines</span>
                    </span>
                  </label>
                </div>

                {/* Live region for keyboard / screen reader announcements when reordering */}
                <span role="status" aria-live="polite" className="sr-only">
                  {reorderAnnouncement}
                </span>

                {/* Zone 1: Enabled Languages (includes Pāḷi, order controls, customize colors, and offline Update) */}
                <section
                  data-zone="enabled"
                  aria-label="Enabled Translation Languages"
                  className="mt-3 pt-3 border-t border-[var(--border-color)] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-1.5">
                        <span>Enabled Languages</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)]">
                          {enabledTranslations.length}
                        </span>
                      </h3>
                      <p className="text-[10px] text-[var(--text-muted)]">
                        Change display order (⤒ ▲ ▼), customize colors, or toggle off
                      </p>
                    </div>
                  </div>

                  {/* Quick color controls for enabled languages */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleApplyThemeAwareColors('all')}
                      className="px-2.5 py-1 rounded-lg text-[10.5px] font-bold flex items-center gap-1 bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)] hover:bg-[var(--accent)] hover:text-white transition cursor-pointer shadow-2xs"
                      title="Randomize harmonious background, text, and border colors for all enabled languages matching current theme"
                      aria-label="Randomize all translation colors"
                    >
                      <Sparkles size={11} />
                      <span>Random Colors</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyThemeAwareColors('bg')}
                      className="px-2.5 py-1 rounded-lg text-[10.5px] font-bold text-[var(--accent)] hover:bg-[var(--accent-light)] border border-[var(--accent-border)] transition cursor-pointer"
                      title="Randomize harmonious background colors for enabled languages matching current theme"
                      aria-label="Randomize background colors"
                    >
                      BG
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyThemeAwareColors('text')}
                      className="px-2.5 py-1 rounded-lg text-[10.5px] font-bold text-[var(--accent)] hover:bg-[var(--accent-light)] border border-[var(--accent-border)] transition cursor-pointer"
                      title="Randomize readable text colors for enabled languages matching current theme"
                      aria-label="Randomize text colors"
                    >
                      Text
                    </button>
                    {settings.showTranslationBorders !== false && (
                      <button
                        type="button"
                        onClick={() => handleApplyThemeAwareColors('border')}
                        className="px-2.5 py-1 rounded-lg text-[10.5px] font-bold text-[var(--accent)] hover:bg-[var(--accent-light)] border border-[var(--accent-border)] transition cursor-pointer"
                        title="Randomize distinct left border colors for enabled languages"
                        aria-label="Randomize border colors"
                      >
                        Border
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleResetEnabledColors}
                      className="px-2.5 py-1 rounded-lg text-[10.5px] font-bold flex items-center gap-1 text-[var(--accent)] hover:text-rose-600 hover:bg-rose-500/10 border border-[var(--accent-border)] transition cursor-pointer"
                      title="Reset colors for all enabled languages to default"
                      aria-label="Reset translation colors to default"
                    >
                      <RotateCcw size={11} />
                      <span>Reset</span>
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {enabledTranslations.map((trans, idx) => {
                      const isFirst = idx === 0;
                      const isLast = idx === enabledTranslations.length - 1;
                      const isOnlyActive = activeCount <= 1;
                      const dbCode = LANG_ID_TO_DB_CODE[trans.id] || null;
                      const updateInfo = dbCode ? offlineState.updates?.[dbCode] : null;
                      const isBusy = Boolean(dbCode && offlineBusyCode === dbCode);
                      const hasCustomColors = Boolean(
                        settings.translationColors?.[trans.id]?.bg ||
                        settings.translationColors?.[trans.id]?.text ||
                        settings.translationColors?.[trans.id]?.border
                      );
                      const switchId = `tpo-lang-switch-enabled-${trans.id}`;

                      return (
                        <div
                          key={trans.id}
                          data-lang-id={trans.id}
                          className="tpo-lang-row px-3 py-2 rounded-xl border bg-[var(--bg-card)] border-[var(--border-color)] shadow-xs flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 transition select-none"
                        >
                          <div className="flex items-center gap-2.5 min-w-[150px] flex-1">
                            {settings.showTranslationBorders !== false && (
                              <span
                                className="w-1 self-stretch rounded-full shrink-0"
                                style={{
                                  backgroundColor:
                                    formatCssColor(settings.translationColors?.[trans.id]?.border) ||
                                    getDefaultSlotColor(trans),
                                }}
                                title={`Color: ${trans.label}`}
                              />
                            )}

                            <label htmlFor={switchId} className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer">
                              <span className="text-base shrink-0">{trans.flag}</span>
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-semibold truncate text-[var(--text-primary)] flex items-center gap-1.5">
                                  <span>{trans.label}</span>
                                  {isOffline && updateInfo && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 shrink-0">
                                      v{updateInfo.version} available
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-[var(--text-muted)] truncate">{trans.desc}</div>
                              </div>
                            </label>
                          </div>

                          <div className="flex items-center gap-1 shrink-0 ml-auto">
                            {isOffline && dbCode && updateInfo && (
                              <button
                                type="button"
                                onClick={() => handleOfflineUpdate(trans)}
                                disabled={isBusy}
                                className="px-2 py-1 rounded-md text-[10.5px] font-bold inline-flex items-center gap-1 bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition cursor-pointer shadow-2xs"
                                title={`Update ${trans.label} database & full-text search index`}
                                aria-label={`Update ${trans.label}`}
                              >
                                <RefreshCw size={11} className={isBusy ? 'animate-spin' : ''} />
                                <span>{isBusy ? 'Updating' : 'Update'}</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => setColorPickerTarget(trans)}
                              className={`p-1 rounded-md transition cursor-pointer border font-bold ${
                                hasCustomColors
                                  ? 'text-[var(--accent)] bg-[var(--accent-light)] border-[var(--accent-border)] shadow-2xs'
                                  : 'text-[var(--accent)] hover:bg-[var(--accent-light)] border-[var(--accent-border)]'
                              }`}
                              title={`Customize colors for ${trans.label}`}
                              aria-label={`Customize colors for ${trans.label}`}
                            >
                              <Palette size={13} />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleMoveTranslation(trans.id, 'top')}
                              disabled={isFirst}
                              className="p-1 rounded-md font-bold text-[var(--accent)] hover:bg-[var(--accent-light)] disabled:opacity-20 disabled:pointer-events-none transition cursor-pointer border border-[var(--accent-border)]"
                              title="Move to top"
                              aria-label={`Move ${trans.label} to top`}
                            >
                              <ArrowUpToLine size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveTranslation(trans.id, 'up')}
                              disabled={isFirst}
                              className="p-1 rounded-md font-bold text-[var(--accent)] hover:bg-[var(--accent-light)] disabled:opacity-20 disabled:pointer-events-none transition cursor-pointer border border-[var(--accent-border)]"
                              title="Move up"
                              aria-label={`Move ${trans.label} up`}
                            >
                              <ChevronUp size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveTranslation(trans.id, 'down')}
                              disabled={isLast}
                              className="p-1 rounded-md font-bold text-[var(--accent)] hover:bg-[var(--accent-light)] disabled:opacity-20 disabled:pointer-events-none transition cursor-pointer border border-[var(--accent-border)]"
                              title="Move down"
                              aria-label={`Move ${trans.label} down`}
                            >
                              <ChevronDown size={13} />
                            </button>

                            <input
                              id={switchId}
                              type="checkbox"
                              switch=""
                              checked={true}
                              disabled={isOnlyActive}
                              onChange={() => handleToggleTranslation(trans.id)}
                              className="tpo-lang-switch ml-0.5"
                              aria-label={`Disable ${trans.label}`}
                              title={
                                isOnlyActive
                                  ? 'At least one language layer must remain active'
                                  : `Turn off ${trans.label}`
                              }
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Zone 2: Available Translation Languages (toggle switch, offline Download / Delete / Update) */}
                <section
                  data-zone="available"
                  aria-label="Available Translation Languages"
                  className="mt-4 pt-3 border-t border-[var(--border-color)] space-y-2"
                >
                  <div>
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-1.5">
                      <span>Available Translation Languages</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded-full bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-color)]">
                        {availableTranslationsList.length}
                      </span>
                    </h3>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {isOffline
                        ? 'Toggle to enable, or download / update / delete offline data & full-text search'
                        : 'Toggle switch to enable a translation layer'}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    {availableTranslationsList.map((trans) => {
                      const isDisabled = Boolean(trans.disabled);
                      const dbCode = LANG_ID_TO_DB_CODE[trans.id] || null;
                      const isDownloaded = Boolean(dbCode && installedCodeSet.has(dbCode));
                      const hasFts = Boolean(dbCode && ftsCodeSet.has(dbCode));
                      const catalogInfo = dbCode ? offlineState.catalog?.[dbCode] : null;
                      const updateInfo = dbCode ? offlineState.updates?.[dbCode] : null;
                      const sizeLabel = formatOfflineBytes(catalogInfo?.zipSize);
                      const isBusy = Boolean(dbCode && offlineBusyCode === dbCode);
                      const switchId = `tpo-lang-switch-avail-${trans.id}`;

                      return (
                        <div
                          key={trans.id}
                          data-lang-id={trans.id}
                          className={`tpo-lang-row px-3 py-2 rounded-xl border flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 transition select-none ${
                            isDisabled
                              ? 'bg-[var(--bg-secondary)]/30 border-[var(--border-color)]/40 opacity-55 cursor-not-allowed'
                              : 'bg-[var(--bg-secondary)]/55 border-[var(--border-color)]/75 hover:border-[var(--border-color)]'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-[150px] flex-1">
                            {settings.showTranslationBorders !== false && (
                              <span
                                className="w-1 self-stretch rounded-full shrink-0"
                                style={{
                                  backgroundColor: isDisabled
                                    ? '#9ca3af'
                                    : formatCssColor(settings.translationColors?.[trans.id]?.border) ||
                                      getDefaultSlotColor(trans),
                                }}
                                title={`Color: ${trans.label}`}
                              />
                            )}

                            <label
                              htmlFor={switchId}
                              className={`flex items-center gap-2.5 min-w-0 flex-1 ${
                                isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'
                              }`}
                            >
                              <span className="text-base shrink-0">{trans.flag}</span>
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-semibold truncate text-[var(--text-primary)] flex items-center gap-1.5 flex-wrap">
                                  <span>{trans.label}</span>
                                  {isDisabled && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
                                      Coming Soon
                                    </span>
                                  )}
                                  {isOffline && dbCode && isDownloaded && (
                                    <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 shrink-0">
                                      Downloaded{hasFts ? ' + Search' : ''}
                                    </span>
                                  )}
                                  {isOffline && dbCode && updateInfo && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 shrink-0">
                                      Update v{updateInfo.version}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-[var(--text-muted)] truncate">{trans.desc}</div>
                              </div>
                            </label>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                            {isOffline && dbCode && !isDownloaded && (
                              <button
                                type="button"
                                onClick={() => handleOfflineDownload(trans, { enableOnComplete: false })}
                                disabled={isDisabled || Boolean(offlineBusyCode)}
                                className="px-2 py-1 rounded-md text-[10.5px] font-semibold inline-flex items-center gap-1 bg-[var(--bg-card)] text-[var(--accent)] border border-[var(--accent-border)] hover:bg-[var(--accent-light)] disabled:opacity-45 transition cursor-pointer"
                                title={
                                  sizeLabel
                                    ? `Download ${trans.label} offline database (${sizeLabel}) & search index`
                                    : `Download ${trans.label} offline database & search index`
                                }
                                aria-label={`Download ${trans.label}`}
                              >
                                <Download size={11} className={isBusy ? 'animate-bounce' : ''} />
                                <span>{isBusy ? 'Downloading' : sizeLabel ? `Download (${sizeLabel})` : 'Download'}</span>
                              </button>
                            )}

                            {isOffline && dbCode && isDownloaded && updateInfo && (
                              <button
                                type="button"
                                onClick={() => handleOfflineUpdate(trans)}
                                disabled={Boolean(offlineBusyCode)}
                                className="px-2 py-1 rounded-md text-[10.5px] font-bold inline-flex items-center gap-1 bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-45 transition cursor-pointer"
                                title={`Update ${trans.label} database & full-text search index`}
                                aria-label={`Update ${trans.label}`}
                              >
                                <RefreshCw size={11} className={isBusy ? 'animate-spin' : ''} />
                                <span>Update</span>
                              </button>
                            )}

                            {isOffline && dbCode && isDownloaded && (
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmTarget(trans)}
                                disabled={Boolean(offlineBusyCode)}
                                className="px-2 py-1 rounded-md text-[10.5px] font-semibold inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 bg-[var(--bg-card)] border border-rose-500/25 hover:bg-rose-500/10 disabled:opacity-45 transition cursor-pointer"
                                title={`Delete ${trans.label} offline data and full-text search index`}
                                aria-label={`Delete ${trans.label}`}
                              >
                                <Trash2 size={11} />
                                <span>Delete</span>
                              </button>
                            )}

                            <input
                              id={switchId}
                              type="checkbox"
                              switch=""
                              checked={false}
                              disabled={isDisabled || isBusy}
                              onChange={() => !isDisabled && handleToggleTranslation(trans.id)}
                              className="tpo-lang-switch"
                              aria-label={`Enable ${trans.label}`}
                              title={
                                isDisabled
                                  ? 'Not available yet — Coming soon'
                                  : isOffline && dbCode && !isDownloaded
                                  ? `Download & enable ${trans.label}`
                                  : `Enable ${trans.label}`
                              }
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-2.5 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex items-center justify-between gap-2 shrink-0 flex-wrap">
              <div className="flex items-center gap-2">
                {isOffline && (
                  <button
                    type="button"
                    onClick={() => {
                      const bridge =
                        typeof window !== 'undefined' ? window.flutter_inappwebview?.callHandler : null;
                      if (bridge) bridge('openDatabaseManager');
                    }}
                    className="px-3 py-1.5 border border-[var(--border-color)] bg-[var(--bg-card)] text-xs font-semibold rounded-lg shadow-sm text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition cursor-pointer flex items-center gap-1.5"
                    title="Open offline Database Manager"
                  >
                    <Database size={12} />
                    <span>Databases</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    updateSetting('translationDisplayMode', 'stack');
                    updateSetting('translationGranularity', 'sentence');
                    updateSetting('showTranslationBorders', false);
                    updateSetting('showBookLinks', true);
                    handleResetEnabledColors();
                  }}
                  className="px-3 py-1.5 border border-[var(--border-color)] bg-[var(--bg-card)] text-xs font-bold rounded-lg shadow-sm text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition cursor-pointer flex items-center gap-1.5"
                  title="Reset to defaults: Stacked layout, sentence unit, borders off, default colors"
                >
                  <RotateCcw size={12} />
                  <span>Restore default</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-1.5 bg-[var(--accent)] text-white text-xs font-bold rounded-lg shadow-sm hover:opacity-90 transition cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task 3: AI-Assisted Translation Disclaimer Popup */}
      {disclaimerModalOpen && (
        <div
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 animate-fade-in text-[var(--text-primary)]"
          onClick={handleCancelDisclaimer}
        >
          <div
            className="w-full max-w-md bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 font-bold text-sm text-amber-600 dark:text-amber-400">
                <AlertTriangle size={17} />
                <span>AI-Assisted Translation Notice</span>
              </div>
              <button
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition cursor-pointer"
                onClick={handleCancelDisclaimer}
                title="Close (Esc)"
                aria-label="Close disclaimer modal"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-5 space-y-3 text-xs text-[var(--text-secondary)] leading-relaxed">
              <p>
                The translations provided here are part of an{' '}
                <strong className="text-[var(--text-primary)]">AI-Assisted Translation Project</strong> adapted from{' '}
                <a
                  href="https://epitaka.org/about"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent)] underline font-semibold inline-flex items-center gap-0.5"
                >
                  Epitaka <ExternalLink size={10} />
                </a>.
              </p>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-1.5 text-[11.5px] text-[var(--text-primary)]">
                <div className="font-bold flex items-center gap-1.5 text-amber-600">
                  <span>Please Read with Discernment & Wisdom</span>
                </div>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-[var(--text-secondary)]">
                  <li>
                    These translations are generated using artificial intelligence and <strong>may contain inaccuracies or mistakes</strong>.
                  </li>
                  <li>
                    They are <strong>not authoritative</strong> and should be treated as study aids rather than definitive renderings.
                  </li>
                  <li>
                    Please <strong>check against the original Pāḷi canonical text</strong> and consult venerable teacher commentaries when clarifying doctrinal nuance.
                  </li>
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 py-3 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCancelDisclaimer}
                className="px-3.5 py-1.5 rounded-lg border border-[var(--border-color)] text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-card)] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDisclaimer}
                className="px-4 py-1.5 bg-[var(--accent)] text-white text-xs font-bold rounded-lg shadow-sm hover:opacity-90 transition cursor-pointer"
              >
                I Understand & Enable
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task 3: Color Palette Customization Modal */}
      {colorPickerTarget && (
        <div
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 animate-fade-in text-[var(--text-primary)]"
          onClick={() => setColorPickerTarget(null)}
        >
          <div
            className="w-full max-w-md bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 font-bold text-sm sm:text-base text-[var(--accent)]">
                <Palette size={18} />
                <span>Colors: {colorPickerTarget.flag} {colorPickerTarget.label}</span>
              </div>
              <button
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition cursor-pointer"
                onClick={() => setColorPickerTarget(null)}
                title="Close (Esc)"
                aria-label="Close color picker modal"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0 overscroll-contain">
              {/* Live Preview Card */}
              {(() => {
                const langColors = settings.translationColors?.[colorPickerTarget.id] || {};
                const slotDefault = getDefaultSlotColor(colorPickerTarget);
                const activeBorder = langColors.border || slotDefault || '#8b2500';
                const activeBg = langColors.bg || '';
                const activeText = langColors.text || (colorPickerTarget.id !== 'pali' ? slotDefault : '');

                return (
                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                      Live Preview
                    </span>
                    <div
                      className="p-3.5 rounded-lg border-l-[1.5px] transition-all shadow-xs"
                      style={{
                        borderLeftColor: formatCssColor(activeBorder),
                        backgroundColor: formatCssColor(activeBg) || 'transparent',
                        color: formatCssColor(activeText) || 'var(--text-primary)',
                      }}
                    >
                      <div className="flex items-center justify-between text-[11px] font-bold opacity-75 mb-1.5">
                        <span>{colorPickerTarget.flag} {colorPickerTarget.label}</span>
                        <span className="text-[10px] font-mono opacity-70">
                          border: {formatCssColor(activeBorder)}
                        </span>
                      </div>
                      <p
                        className="text-xs leading-relaxed"
                        style={{
                          color: formatCssColor(activeText) || 'inherit',
                        }}
                      >
                        Namo tassa bhagavato arahato sammāsambuddhassa
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* 1. Background Color */}
              {(() => {
                const langColors = settings.translationColors?.[colorPickerTarget.id] || {};
                const activeBg = langColors.bg || '';
                return (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-black/20 inline-block shrink-0"
                          style={{ backgroundColor: formatCssColor(activeBg) || '#f0eee5' }}
                        />
                        Background Color
                      </span>
                      {activeBg && (
                        <button
                          type="button"
                          onClick={() => updateLangColors(colorPickerTarget.id, { bg: '' })}
                          className="text-[10px] text-[var(--accent)] hover:underline cursor-pointer"
                        >
                          Clear (Default)
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="color"
                        value={toValidHex(activeBg, '#f0eee5')}
                        onChange={(e) => updateLangColors(colorPickerTarget.id, { bg: e.target.value })}
                        className="w-8 h-8 rounded-lg cursor-pointer border border-[var(--border-color)] bg-transparent p-0.5 shrink-0"
                        title="Pick background color"
                      />
                      <input
                        type="text"
                        value={activeBg}
                        placeholder="Default or #hex (e.g. #fbf0d9)"
                        onChange={(e) => updateLangColors(colorPickerTarget.id, { bg: e.target.value })}
                        className="flex-1 px-2.5 py-1.5 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg text-xs font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                      {BG_PALETTE.map((swatch) => (
                        <button
                          key={swatch.name}
                          type="button"
                          onClick={() => updateLangColors(colorPickerTarget.id, { bg: swatch.value })}
                          className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 transition cursor-pointer ${
                            activeBg === swatch.value
                              ? 'ring-2 ring-[var(--accent)] border-white scale-110'
                              : 'border-black/20 hover:scale-105'
                          }`}
                          style={{ backgroundColor: swatch.value || 'transparent' }}
                          title={swatch.name}
                        >
                          {!swatch.value && <span className="text-[9px] text-[var(--text-muted)]">∅</span>}
                          {activeBg === swatch.value && swatch.value && (
                            <Check size={11} className={swatch.value === '#ffffff' || swatch.value.startsWith('#f') ? 'text-black' : 'text-white'} />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* 2. Text Color */}
              {(() => {
                const langColors = settings.translationColors?.[colorPickerTarget.id] || {};
                const activeText = langColors.text || '';
                const isPali = colorPickerTarget.id === 'pali';
                const slotDefault = isPali ? '#1e293b' : getDefaultSlotColor(colorPickerTarget);
                const textLabel = isPali ? 'Pāḷi Text Color' : 'Translation Text Color';
                return (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-black/20 inline-block shrink-0"
                          style={{ backgroundColor: formatCssColor(activeText) || slotDefault }}
                        />
                        {textLabel}
                      </span>
                      {activeText && (
                        <button
                          type="button"
                          onClick={() => updateLangColors(colorPickerTarget.id, { text: '' })}
                          className="text-[10px] text-[var(--accent)] hover:underline cursor-pointer"
                        >
                          Clear (Default)
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="color"
                        value={toValidHex(activeText, slotDefault)}
                        onChange={(e) => updateLangColors(colorPickerTarget.id, { text: e.target.value })}
                        className="w-8 h-8 rounded-lg cursor-pointer border border-[var(--border-color)] bg-transparent p-0.5 shrink-0"
                        title="Pick text color"
                      />
                      <input
                        type="text"
                        value={activeText}
                        placeholder={isPali ? 'Default or #hex (e.g. #1e293b)' : `Default (${slotDefault}) or #hex`}
                        onChange={(e) => updateLangColors(colorPickerTarget.id, { text: e.target.value })}
                        className="flex-1 px-2.5 py-1.5 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg text-xs font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                      {TEXT_PALETTE.map((swatch) => (
                        <button
                          key={swatch.name}
                          type="button"
                          onClick={() => updateLangColors(colorPickerTarget.id, { text: swatch.value })}
                          className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 transition cursor-pointer ${
                            activeText === swatch.value
                              ? 'ring-2 ring-[var(--accent)] border-white scale-110'
                              : 'border-black/20 hover:scale-105'
                          }`}
                          style={{ backgroundColor: swatch.value || 'transparent' }}
                          title={swatch.name}
                        >
                          {!swatch.value && <span className="text-[9px] text-[var(--text-muted)]">∅</span>}
                          {activeText === swatch.value && swatch.value && (
                            <Check size={11} className={swatch.value === '#ffffff' || swatch.value.startsWith('#f') ? 'text-black' : 'text-white'} />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* 3. Border-Left Color (hidden when borders are disabled) */}
              {settings.showTranslationBorders !== false && (() => {
                const langColors = settings.translationColors?.[colorPickerTarget.id] || {};
                const slotDefault = getDefaultSlotColor(colorPickerTarget);
                const activeBorder = langColors.border || slotDefault || '#8b2500';
                return (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-black/20 inline-block shrink-0"
                          style={{ backgroundColor: formatCssColor(activeBorder) }}
                        />
                        Border-Left Color
                      </span>
                      {langColors.border && (
                        <button
                          type="button"
                          onClick={() => updateLangColors(colorPickerTarget.id, { border: '' })}
                          className="text-[10px] text-[var(--accent)] hover:underline cursor-pointer"
                        >
                          Clear (Default)
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="color"
                        value={toValidHex(activeBorder, slotDefault || '#8b2500')}
                        onChange={(e) => updateLangColors(colorPickerTarget.id, { border: e.target.value })}
                        className="w-8 h-8 rounded-lg cursor-pointer border border-[var(--border-color)] bg-transparent p-0.5 shrink-0"
                        title="Pick border-left color"
                      />
                      <input
                        type="text"
                        value={activeBorder}
                        placeholder={`Default or #hex (${slotDefault || '#8b2500'})`}
                        onChange={(e) => updateLangColors(colorPickerTarget.id, { border: e.target.value })}
                        className="flex-1 px-2.5 py-1.5 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg text-xs font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                      {BORDER_PALETTE.map((swatch) => (
                        <button
                          key={swatch.name}
                          type="button"
                          onClick={() => updateLangColors(colorPickerTarget.id, { border: swatch.value })}
                          className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 transition cursor-pointer ${
                            activeBorder === swatch.value
                              ? 'ring-2 ring-[var(--accent)] border-white scale-110'
                              : 'border-black/20 hover:scale-105'
                          }`}
                          style={{ backgroundColor: swatch.value }}
                          title={swatch.name}
                        >
                          {activeBorder === swatch.value && (
                            <Check size={11} className={swatch.value === '#ffffff' || swatch.value.startsWith('#f') ? 'text-black' : 'text-white'} />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const randoms = generateThemeAwareLanguageColors(settings.theme);
                    updateLangColors(colorPickerTarget.id, randoms);
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
                  title="Generate random colors for background, text, and border"
                >
                  <Sparkles size={13} className="text-amber-500" />
                  <span>Random Color</span>
                </button>
                <button
                  type="button"
                  onClick={() => resetLangColors(colorPickerTarget.id)}
                  className="px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-xs font-semibold text-rose-600 hover:bg-rose-500/10 hover:border-rose-300 flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
                  title="Reset colors for this language to default"
                >
                  <RotateCcw size={12} />
                  <span>Reset</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setColorPickerTarget(null)}
                className="px-4 py-1.5 bg-[var(--accent)] text-white text-xs font-bold rounded-lg shadow-sm hover:opacity-90 transition cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Offline Translation Delete Confirmation Modal (removes DB + full-text search index) */}
      {deleteConfirmTarget && (
        <div
          className="fixed inset-0 z-[1150] flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 animate-fade-in text-[var(--text-primary)]"
          onClick={() => setDeleteConfirmTarget(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Delete ${deleteConfirmTarget.label} offline data`}
            className="w-full max-w-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-sm text-rose-600 dark:text-rose-400">
                <Trash2 size={16} />
                <span>Delete Offline Translation</span>
              </div>
              <button
                type="button"
                onClick={() => setDeleteConfirmTarget(null)}
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-card)] transition cursor-pointer"
                aria-label="Cancel delete"
              >
                <X size={15} />
              </button>
            </div>
            <div className="p-4 space-y-2 text-xs text-[var(--text-secondary)] leading-relaxed">
              <p>
                Delete offline data for{' '}
                <strong className="text-[var(--text-primary)]">
                  {deleteConfirmTarget.flag} {deleteConfirmTarget.label}
                </strong>
                ?
              </p>
              <p className="text-[11px] text-[var(--text-muted)]">
                This removes both the translation database and its full-text search index (
                <code className="font-mono">
                  fts_translation_{LANG_ID_TO_DB_CODE[deleteConfirmTarget.id]}.db
                </code>
                ). You can download it again anytime.
              </p>
            </div>
            <div className="px-4 py-3 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmTarget(null)}
                className="px-3.5 py-1.5 rounded-lg border border-[var(--border-color)] text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-card)] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteOffline}
                disabled={Boolean(offlineBusyCode)}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg shadow-sm disabled:opacity-50 transition cursor-pointer"
              >
                {offlineBusyCode ? 'Deleting...' : 'Delete Data & Index'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
