function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatInlineTranslationTags(str) {
  if (!str) return '';
  let safe = escapeHtml(str);
  safe = safe
    .replace(/&lt;i&gt;/gi, '<i>')
    .replace(/&lt;\/i&gt;/gi, '</i>')
    .replace(/&lt;b&gt;/gi, '<b>')
    .replace(/&lt;\/b&gt;/gi, '</b>')
    .replace(/&lt;em&gt;/gi, '<em>')
    .replace(/&lt;\/em&gt;/gi, '</em>')
    .replace(/&lt;strong&gt;/gi, '<strong>')
    .replace(/&lt;\/strong&gt;/gi, '</strong>')
    .replace(/&lt;br\s*\/?&gt;/gi, '<br/>');

  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  safe = safe.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<i>$1</i>');
  return safe;
}

export function formatSafeTranslationHtml(text, langCode = '') {
  if (!text) return '';
  const str = String(text);
  if (langCode === 'my_nissaya' && str.includes(' | ') && str.includes(': ')) {
    const pairs = str.split(' | ');
    return pairs
      .map((part) => {
        const trimmed = part.trim();
        if (!trimmed) return '';
        const colonIdx = trimmed.indexOf(': ');
        if (colonIdx > 0) {
          const pali = trimmed.substring(0, colonIdx).trim();
          const meaning = trimmed.substring(colonIdx + 2).trim();
          return `<span class="reader-nissaya-pair"><strong class="reader-nissaya-pali">${formatInlineTranslationTags(pali)}</strong><span class="reader-nissaya-sep">:</span> <span class="reader-nissaya-meaning">${formatInlineTranslationTags(meaning)}</span></span>`;
        }
        return `<span class="reader-nissaya-meaning">${formatInlineTranslationTags(trimmed)}</span>`;
      })
      .filter(Boolean)
      .join('<span class="reader-nissaya-divider"> | </span>');
  }
  return formatInlineTranslationTags(str);
}
