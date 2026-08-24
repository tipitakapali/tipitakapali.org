'use client';

import React, { memo, useMemo } from 'react';
import { ChevronRight, Book, FileText, Folder, FolderTree, Library } from 'lucide-react';
import { useTabs } from '../../context/TabContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { convertPaliScript } from '../../services/transliterate';

const TreeNode = memo(function TreeNode({
  node,
  depth = 0,
  filterText = '',
  matchingNodeIds,
  expandedMap,
  setExpandedMap,
}) {
  const { openBook, activeBookCode, activeTab, setIsSidebarOpen } = useTabs();
  const { settings } = useThemeSettings();

  const displayText = useMemo(() => {
    return convertPaliScript(node.text, settings?.paliScript);
  }, [node.text, settings?.paliScript]);

  // If filtering is active and this node is not in matching IDs, skip rendering
  if (matchingNodeIds && !matchingNodeIds.has(node.id)) {
    return null;
  }

  const hasChildren = node.children && node.children.length > 0;
  const href = node.a_attr?.href || node.href || '';

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
    nodeChapterIdx === (activeTab.currentChapterIdx || 0);

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

    // 2. Book clicked
    if (isBookNode && nodeBookCode) {
      if (hasChildren) {
        setExpandedMap((prev) => ({ ...prev, [node.id]: !prev[node.id] }));
      }
      closeIfMobile();
      await openBook(nodeBookCode, { targetChapterIdx: 0 });
      return;
    }

    // 3. Category / Pitaka folder clicked
    if (hasChildren) {
      toggleExpand(e);
    }
  };

  const renderIcon = () => {
    if (depth === 0) return <Library size={16} className="tree-icon-cat" />;
    if (depth === 1) return <FolderTree size={15} className="tree-icon-pitaka" />;
    if (isBookNode) return <Book size={14.5} className="tree-icon-book" />;
    if (isChapterNode) return <FileText size={13.5} className="tree-icon-chapter" />;
    if (hasChildren) return <Folder size={14.5} className="tree-icon-folder" />;
    return <FileText size={14} className="tree-icon-leaf" />;
  };


  return (
    <div
      className={`tree-node level-${Math.min(depth, 3)} ${isBookNode ? 'is-book-node' : ''}`}
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

        <span className="tree-icon">{renderIcon()}</span>
        <span className="tree-label truncate">{displayText}</span>
      </div>

      {hasChildren && isExpanded && (
        <div className="tree-children show">
          {node.children.map((child) => (
            <TreeNode
              key={child.id || child.text}
              node={child}
              depth={depth + 1}
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

