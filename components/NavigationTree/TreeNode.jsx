'use client';

import React, { memo, useMemo } from 'react';
import {
  ChevronRight,
  Book,
  FileText,
  Folder,
  FolderTree,
  Library,
  Scale,
  BookOpen,
  Layers,
} from 'lucide-react';
import { useTabs } from '../../context/TabContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { convertPaliScript } from '../../services/transliterate';

const TreeNode = memo(function TreeNode({
  node,
  depth = 0,
  pitakaType = null,
  textType = null, // Inherited text type (mula | attha | tika) from ancestor group node
  filterText = '',
  matchingNodeIds,
  expandedMap,
  setExpandedMap,
}) {
  const { openBook, activeBookCode, activeTab, setIsSidebarOpen } = useTabs();
  const { settings } = useThemeSettings();

  const hasChildren = node?.children && node.children.length > 0;
  const href = node?.a_attr?.href || node?.href || '';

  let nodeBookCode = null;
  let nodeChapterIdx = null;
  let isChapterNode = false;
  let isBookNode = false;

  if (href && href.startsWith('cscd/')) {
    const m = href.match(/^cscd\/([a-z0-9_]+\.[a-z0-9_]+?)(\d+)?\.xml$/i);
    if (m) {
      nodeBookCode = m[1];
      if (m[2] !== undefined) {
        nodeChapterIdx = parseInt(m[2], 10);
        isChapterNode = true;
      } else {
        isBookNode = true;
      }
    }
  } else if (hasChildren) {
    for (const c of node.children) {
      const chHref = c.a_attr?.href || c.href || '';
      if (chHref.startsWith('cscd/')) {
        const m = chHref.match(/^cscd\/([a-z0-9_]+\.[a-z0-9_]+?)(\d+)?\.xml$/i);
        if (m) {
          nodeBookCode = m[1];
          isBookNode = true;
          break;
        }
      }
    }
  }

  const labelParts = useMemo(() => {
    if (!node?.text) return { main: '', suffix: null, suffixType: null, typeWord: null, effectiveType: null };

    // Match parenthetical suffix, e.g. "Vinayapiṭaka (Mūla)" -> "Vinayapiṭaka" + "(Mūla)"
    const match = node.text.match(/^(.*?)\s*(\([^\)]+\))$/);
    let core = (match ? match[1] : node.text).trim();
    const suffix = match ? match[2].trim() : null;

    // Type of the parenthetical suffix, if any
    let suffixType = null;
    if (suffix) {
      const lowerRaw = suffix.toLowerCase();
      if (lowerRaw.includes('mūla') || lowerRaw.includes('mula')) suffixType = 'mula';
      else if (lowerRaw.includes('aṭṭhakathā') || lowerRaw.includes('atthakatha')) suffixType = 'attha';
      else if (lowerRaw.includes('ṭīkā') || lowerRaw.includes('tika')) suffixType = 'tika';
      else suffixType = 'generic';
    }

    // For grouping/folder nodes, lift a trailing text-type word out of the name,
    // e.g. "Dīghanikāya Aṭṭhakathā (Sumaṅgalavilāsinī)" -> main "Dīghanikāya" + type word "Aṭṭhakathā"
    let typeWord = null;
    if (!isBookNode && !isChapterNode) {
      const tw = core.match(/^(.*?)\s+(Mūla|Aṭṭhakathā|Ṭīkā)$/);
      if (tw) {
        core = tw[1].trim();
        const word = tw[2];
        typeWord = {
          label: convertPaliScript(word, settings?.paliScript),
          type: { Mūla: 'mula', Aṭṭhakathā: 'attha', Ṭīkā: 'tika' }[word],
        };
      }
    }

    // Effective text type: own suffix type (if a real text type), else lifted type word, else null
    let effectiveType = null;
    if (suffixType === 'mula' || suffixType === 'attha' || suffixType === 'tika') {
      effectiveType = suffixType;
    } else if (typeWord) {
      effectiveType = typeWord.type;
    }

    return {
      main: convertPaliScript(core, settings?.paliScript),
      suffix: suffix ? convertPaliScript(suffix, settings?.paliScript) : null,
      suffixType,
      typeWord,
      effectiveType,
    };
  }, [node?.text, settings?.paliScript, isBookNode, isChapterNode]);

  // Effective text type: own (Mūla/Aṭṭhakathā/Ṭīkā) type, otherwise inherited from ancestor group
  const effectiveTextType = useMemo(() => {
    if (labelParts.effectiveType) return labelParts.effectiveType;
    return textType;
  }, [labelParts.effectiveType, textType]);

  // Text-type tag(s): shown only on grouping/folder nodes (expandable, not a book/chapter).
  // Books and chapter leaves never show a tag.
  const tagDisplay = useMemo(() => {
    if (isBookNode || isChapterNode) return [];
    const tags = [];
    if (labelParts.typeWord) {
      tags.push({ label: `(${labelParts.typeWord.label})`, type: labelParts.typeWord.type });
    }
    if (labelParts.suffix) {
      tags.push({ label: labelParts.suffix, type: labelParts.suffixType });
    }
    if (tags.length === 0 && hasChildren && effectiveTextType) {
      const labels = { mula: 'Mūla', attha: 'Aṭṭhakathā', tika: 'Ṭīkā' };
      tags.push({
        label: `(${convertPaliScript(labels[effectiveTextType], settings?.paliScript)})`,
        type: effectiveTextType,
      });
    }
    return tags;
  }, [isBookNode, isChapterNode, labelParts.typeWord, labelParts.suffix, labelParts.suffixType, hasChildren, effectiveTextType, settings?.paliScript]);

  // Determine Piṭaka category (Vinaya, Sutta, Abhidhamma, Añña)
  const currentPitaka = useMemo(() => {
    if (pitakaType) return pitakaType;
    const txt = (node?.text || '').toLowerCase();
    if (txt.includes('vinaya')) return 'vinaya';
    if (txt.includes('sutta')) return 'sutta';
    if (txt.includes('abhidhamma')) return 'abhidhamma';
    if (txt.includes('añña') || txt.includes('anna')) return 'anna';
    if (nodeBookCode) {
      if (nodeBookCode.startsWith('vin')) return 'vinaya';
      if (nodeBookCode.startsWith('s0')) return 'sutta';
      if (
        nodeBookCode.startsWith('abh') ||
        nodeBookCode.startsWith('e0') ||
        nodeBookCode.startsWith('y0') ||
        nodeBookCode.startsWith('p0')
      ) {
        return 'abhidhamma';
      }
      return 'anna';
    }
    return null;
  }, [pitakaType, node?.text, nodeBookCode]);

  // If filtering is active and this node is not in matching IDs, skip rendering (ALL hooks executed above)
  if (matchingNodeIds && !matchingNodeIds.has(node.id)) {
    return null;
  }

  const isFiltered = Boolean(filterText && filterText.trim().length > 0);
  const isExpanded = Boolean(expandedMap[node.id] || isFiltered);

  const toggleExpand = (e) => {
    e.stopPropagation();
    setExpandedMap((prev) => ({
      ...prev,
      [node.id]: !prev[node.id],
    }));
  };

  const isActiveBook = isBookNode && nodeBookCode === activeBookCode;
  const isActiveChapter =
    isChapterNode &&
    nodeBookCode === activeBookCode &&
    activeTab &&
    activeTab.viewMode !== 'toc' &&
    !activeTab.isTocView &&
    activeTab.currentChapterIdx !== null &&
    activeTab.currentChapterIdx !== undefined &&
    nodeChapterIdx === activeTab.currentChapterIdx;

  const handleRowClick = async (e) => {
    e.stopPropagation();

    const closeIfMobile = () => {
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        setIsSidebarOpen(false);
      }
    };

    // 1. Chapter clicked
    if (isChapterNode && nodeBookCode) {
      closeIfMobile();
      await openBook(nodeBookCode, { targetChapterIdx: nodeChapterIdx !== null ? nodeChapterIdx : 0 });
      return;
    }

    // 2. Book clicked — show TOC (no auto chapter 1)
    if (isBookNode && nodeBookCode) {
      if (hasChildren) {
        setExpandedMap((prev) => ({ ...prev, [node.id]: !prev[node.id] }));
      }
      closeIfMobile();
      await openBook(nodeBookCode, {});
      return;
    }

    // 3. Category / Pitaka folder clicked
    if (hasChildren) {
      toggleExpand(e);
    }
  };

  const renderIcon = () => {
    if (isActiveChapter) {
      const pitakaPingCls = currentPitaka ? `tree-ping-${currentPitaka}` : 'tree-ping-default';
      return (
        <span className={`tree-ping-wrapper relative flex h-2.5 w-2.5 mx-0.5 ${pitakaPingCls}`} title="Currently Reading Chapter">
          <span className="tree-ping-dot-radar animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" />
          <span className="tree-ping-dot-core relative inline-flex rounded-full h-2.5 w-2.5" />
        </span>
      );
    }

    // Depth 0: Main Piṭaka Roots
    if (depth === 0) {
      if (currentPitaka === 'vinaya') return <Scale size={16} className="tree-icon-vinaya" />;
      if (currentPitaka === 'sutta') return <BookOpen size={16} className="tree-icon-sutta" />;
      if (currentPitaka === 'abhidhamma') return <Layers size={16} className="tree-icon-abhidhamma" />;
      if (currentPitaka === 'anna') return <Library size={16} className="tree-icon-anna" />;
      return <Library size={16} className="tree-icon-cat" />;
    }

    // Depth 1: Sub-layer Folders (Mūla, Aṭṭhakathā, Ṭīkā)
    if (depth === 1) {
      const pitakaCls = currentPitaka ? `tree-icon-${currentPitaka}` : 'tree-icon-pitaka';
      return <FolderTree size={15} className={`${pitakaCls} opacity-90`} />;
    }

    // Books
    if (isBookNode) {
      const bookCls = currentPitaka ? `tree-icon-${currentPitaka}` : 'tree-icon-book';
      return <Book size={14.5} className={bookCls} />;
    }

    // Chapters
    if (isChapterNode) {
      return <FileText size={13.5} className="tree-icon-chapter" />;
    }

    // Other Folders
    if (hasChildren) {
      const folderCls = currentPitaka ? `tree-icon-${currentPitaka}` : 'tree-icon-folder';
      return <Folder size={14.5} className={`${folderCls} opacity-80`} />;
    }

    return <FileText size={14} className="tree-icon-leaf" />;
  };

  return (
    <div
      className={`tree-node level-${Math.min(depth, 3)} ${currentPitaka ? `pitaka-${currentPitaka}` : ''} ${
        isBookNode ? 'is-book-node' : ''
      }`}
      data-node-id={node.id}
      data-book-code={nodeBookCode || ''}
    >
      <div
        className={`tree-row ${isActiveBook ? 'active-book' : ''} ${isActiveChapter ? 'active-chapter' : ''}`}
        onClick={handleRowClick}
        title={node.text}
      >
        {hasChildren ? (
          <button
            className={`tree-expander ${isExpanded ? 'expanded' : ''}`}
            onClick={toggleExpand}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            <ChevronRight size={14} />
          </button>
        ) : (
          <span className="tree-expander-spacer" />
        )}

        <span className="tree-icon flex items-center justify-center w-4 shrink-0">{renderIcon()}</span>
        <span className="tree-label truncate flex-1 font-medium">
          {labelParts.main}
          {tagDisplay.map((tag, i) => (
            <span key={i} className={`tree-type-tag tree-tag-${tag.type}`}>
              {tag.label}
            </span>
          ))}
        </span>
      </div>

      {hasChildren && isExpanded && (
        <div className="tree-children show">
          {node.children.map((child) => (
            <TreeNode
              key={child.id || child.text}
              node={child}
              depth={depth + 1}
              pitakaType={currentPitaka}
              textType={effectiveTextType}
              filterText={filterText}
              matchingNodeIds={matchingNodeIds}
              expandedMap={expandedMap}
              setExpandedMap={setExpandedMap}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default TreeNode;

