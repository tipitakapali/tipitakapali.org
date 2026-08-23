'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Search, X, PlusSquare, MinusSquare } from 'lucide-react';
import TreeNode from './TreeNode';
import { fetchTree } from '../../services/api';
import { useTabs } from '../../context/TabContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { typeVelthuis } from '../../services/transliterate';

export default function NavigationTree() {
  const [treeData, setTreeData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterText, setFilterText] = useState('');
  const [expandedMap, setExpandedMap] = useState({});
  const [isTreeExpandedAll, setIsTreeExpandedAll] = useState(false);

  const { isSidebarOpen, setIsSidebarOpen, treeSelectedNode } = useTabs();
  const { setIsZenMode } = useThemeSettings();
  const treeContainerRef = useRef(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const data = await fetchTree();
        setTreeData(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // When active book changes, expand its ancestors and scroll into view
  useEffect(() => {
    if (!treeSelectedNode?.bookCode || !treeData.length) return;

    const bookCode = treeSelectedNode.bookCode;

    setExpandedMap((prev) => {
      const newExpanded = { ...prev };
      let changed = false;

      function findAndExpandAncestors(nodes, targetCode, path = []) {
        for (const n of nodes) {
          const currentPath = [...path, n.id];
          let isMatch = false;
          const href = n.a_attr?.href || n.href || '';
          if (href.startsWith('cscd/') && href.includes(targetCode)) {
            isMatch = true;
          } else if (n.children) {
            for (const c of n.children) {
              const chHref = c.a_attr?.href || c.href || '';
              if (chHref.startsWith('cscd/') && chHref.includes(targetCode)) {
                isMatch = true;
                break;
              }
            }
          }

          if (isMatch) {
            currentPath.forEach((id) => {
              if (!newExpanded[id]) {
                newExpanded[id] = true;
                changed = true;
              }
            });
            return true;
          }

          if (n.children && n.children.length > 0) {
            if (findAndExpandAncestors(n.children, targetCode, currentPath)) {
              return true;
            }
          }
        }
        return false;
      }

      findAndExpandAncestors(treeData, bookCode);
      return changed ? newExpanded : prev;
    });

    setTimeout(() => {
      if (treeContainerRef.current) {
        const activeRow = treeContainerRef.current.querySelector('.tree-row.active-book');
        if (activeRow) {
          activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }, 100);
  }, [treeSelectedNode?.bookCode, treeData]);

  const handleToggleExpandAll = () => {
    const nextState = !isTreeExpandedAll;
    setIsTreeExpandedAll(nextState);
    const newMap = {};
    function traverse(nodes) {
      for (const n of nodes) {
        newMap[n.id] = nextState;
        if (n.children) traverse(n.children);
      }
    }
    traverse(treeData);
    setExpandedMap(newMap);
  };

  const handleHideAll = () => {
    setIsSidebarOpen(false);
    setIsZenMode(true);
  };

  const matchingNodeIds = React.useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q || !treeData.length) return null;

    const matched = new Set();

    function matchNode(node) {
      const isDirectMatch = node.text?.toLowerCase().includes(q);
      let childMatch = false;

      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          if (matchNode(child)) {
            childMatch = true;
          }
        }
      }

      if (isDirectMatch || childMatch) {
        matched.add(node.id);
        return true;
      }
      return false;
    }

    treeData.forEach(matchNode);
    return matched;
  }, [treeData, filterText]);

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/45 z-40 sm:hidden animate-fade-in"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside className={`app-sidebar ${isSidebarOpen ? '' : 'collapsed'}`}>
        <div className="sidebar-header">
          <div className="sidebar-title-row">
            <div className="sidebar-title">
              <span>Navigation</span>
              <span className="sidebar-stats">217 books</span>
            </div>
            <div className="tree-actions">
              <button
                className="tree-action-btn"
                onClick={handleToggleExpandAll}
                title={isTreeExpandedAll ? 'Collapse All Folders' : 'Expand All Folders'}
              >
                {isTreeExpandedAll ? <MinusSquare size={11} /> : <PlusSquare size={11} />}
                <span>{isTreeExpandedAll ? 'Collapse' : 'Expand'}</span>
              </button>
              <button
                className="tree-action-btn flex items-center gap-1"
                onClick={() => setIsSidebarOpen(false)}
                title="Hide Navigation"
              >
                <span>◖ Hide</span>
              </button>
            </div>
          </div>

          <div className="sidebar-search">
            <Search size={12} className="icon" />
            <input
              type="text"
              id="treeFilterInput"
              placeholder="Filter books & chapters..."
              value={filterText}
              onChange={(e) => setFilterText(typeVelthuis(e.target.value))}
            />
            {filterText && (
              <button
                className="clear-btn"
                onClick={() => setFilterText('')}
                title="Clear filter"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="tree-container" ref={treeContainerRef}>
          {loading && (
            <div className="loading-view">
              <div className="spinner" />
              <div>Loading Tipiṭaka tree...</div>
            </div>
          )}

          {error && (
            <div className="p-4 text-xs text-[var(--accent)] text-center">
              Failed to load navigation tree: {error}
            </div>
          )}

          {!loading && !error && (
            <div className="tree-root">
              {treeData.map((node) => (
                <TreeNode
                  key={node.id || node.text}
                  node={node}
                  depth={0}
                  filterText={filterText}
                  matchingNodeIds={matchingNodeIds}
                  expandedMap={expandedMap}
                  setExpandedMap={setExpandedMap}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
