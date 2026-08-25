'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search,
  X,
  PlusSquare,
  MinusSquare,
  PanelLeft,
  PanelRight,
  Move,
  GripHorizontal,
} from 'lucide-react';
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

  // True if at least one folder/node in the tree is expanded
  const hasAnyExpanded = React.useMemo(() => {
    return Object.values(expandedMap).some(Boolean);
  }, [expandedMap]);

  // Docking & Resizing State
  const [dockPosition, setDockPosition] = useState('left'); // 'left' | 'right' | 'float'
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [floatPos, setFloatPos] = useState({ x: 80, y: 100, width: 380, height: 600 });
  const [isResizing, setIsResizing] = useState(false);

  const { isSidebarOpen, setIsSidebarOpen, setIsHeaderVisible, treeSelectedNode } = useTabs();
  const { setIsZenMode } = useThemeSettings();
  const treeContainerRef = useRef(null);

  // Load saved preferences
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const savedDock = localStorage.getItem('tipitaka_tree_dock');
      if (savedDock === 'left' || savedDock === 'right' || savedDock === 'float') {
        setDockPosition(savedDock);
      }
      const savedWidth = localStorage.getItem('tipitaka_sidebar_width');
      if (savedWidth) {
        const parsedW = parseInt(savedWidth, 10);
        if (!isNaN(parsedW) && parsedW >= 220 && parsedW <= 900) {
          setSidebarWidth(parsedW);
        }
      }
      const savedFloatPos = localStorage.getItem('tipitaka_tree_float_pos');
      if (savedFloatPos) {
        const parsedPos = JSON.parse(savedFloatPos);
        if (parsedPos && parsedPos.width && parsedPos.height) {
          setFloatPos(parsedPos);
        }
      }
    } catch (e) {}
  }, []);

  // Update CSS variable --sidebar-width on root
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
    }
  }, [sidebarWidth]);

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
    if (hasAnyExpanded) {
      // If any folder is currently open/expanded, collapse all
      setExpandedMap({});
    } else {
      // If all folders are closed, expand all
      const newMap = {};
      function traverse(nodes) {
        for (const n of nodes) {
          newMap[n.id] = true;
          if (n.children) traverse(n.children);
        }
      }
      traverse(treeData);
      setExpandedMap(newMap);
    }
  };

  const handleSetDock = (newPos) => {
    setDockPosition(newPos);
    try {
      localStorage.setItem('tipitaka_tree_dock', newPos);
    } catch (e) {}
  };

  // Resize handler for docked sidebar (left or right)
  const startResizing = useCallback(
    (mouseDownEvent) => {
      mouseDownEvent.preventDefault();
      setIsResizing(true);
      const startX = mouseDownEvent.clientX;
      const startWidth = sidebarWidth;

      const onMouseMove = (mouseMoveEvent) => {
        let newWidth;
        if (dockPosition === 'right') {
          newWidth = startWidth - (mouseMoveEvent.clientX - startX);
        } else {
          newWidth = startWidth + (mouseMoveEvent.clientX - startX);
        }
        const maxW = Math.min(850, typeof window !== 'undefined' ? window.innerWidth * 0.7 : 800);
        const clampedWidth = Math.max(220, Math.min(newWidth, maxW));
        setSidebarWidth(clampedWidth);
        try {
          localStorage.setItem('tipitaka_sidebar_width', String(clampedWidth));
        } catch (e) {}
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      };

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [sidebarWidth, dockPosition]
  );

  // Drag handler for floating mode
  const startDragging = useCallback(
    (mouseDownEvent) => {
      if (dockPosition !== 'float') return;
      if (mouseDownEvent.target.closest('button') || mouseDownEvent.target.closest('input')) return;
      mouseDownEvent.preventDefault();

      const startX = mouseDownEvent.clientX;
      const startY = mouseDownEvent.clientY;
      const startPosX = floatPos.x;
      const startPosY = floatPos.y;

      const onMouseMove = (mouseMoveEvent) => {
        const newX = Math.max(10, Math.min(window.innerWidth - floatPos.width - 10, startPosX + (mouseMoveEvent.clientX - startX)));
        const newY = Math.max(50, Math.min(window.innerHeight - 100, startPosY + (mouseMoveEvent.clientY - startY)));
        setFloatPos((prev) => {
          const next = { ...prev, x: newX, y: newY };
          try {
            localStorage.setItem('tipitaka_tree_float_pos', JSON.stringify(next));
          } catch (e) {}
          return next;
        });
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.userSelect = '';
      };

      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [dockPosition, floatPos]
  );

  // Corner resize handler for floating mode
  const startFloatingResize = useCallback(
    (mouseDownEvent) => {
      mouseDownEvent.preventDefault();
      mouseDownEvent.stopPropagation();
      const startX = mouseDownEvent.clientX;
      const startY = mouseDownEvent.clientY;
      const startW = floatPos.width;
      const startH = floatPos.height;

      const onMouseMove = (mouseMoveEvent) => {
        const newW = Math.max(260, Math.min(window.innerWidth - floatPos.x - 10, startW + (mouseMoveEvent.clientX - startX)));
        const newH = Math.max(280, Math.min(window.innerHeight - floatPos.y - 10, startH + (mouseMoveEvent.clientY - startY)));
        setFloatPos((prev) => {
          const next = { ...prev, width: newW, height: newH };
          try {
            localStorage.setItem('tipitaka_tree_float_pos', JSON.stringify(next));
          } catch (e) {}
          return next;
        });
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      };

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'se-resize';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [floatPos]
  );

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

  // Floating Window inline style
  const floatStyle =
    dockPosition === 'float'
      ? {
          left: `${floatPos.x}px`,
          top: `${floatPos.y}px`,
          width: `${floatPos.width}px`,
          height: `${floatPos.height}px`,
        }
      : {
          width: `${sidebarWidth}px`,
        };

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isSidebarOpen && dockPosition !== 'float' && (
        <div
          className="fixed inset-0 bg-black/45 z-40 sm:hidden animate-fade-in"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside
        style={floatStyle}
        className={`app-sidebar dock-${dockPosition} ${isSidebarOpen ? '' : 'collapsed'} ${
          isResizing ? 'select-none' : ''
        }`}
      >
        {/* Docked Resizer Handle on Left Edge (when docked right) */}
        {dockPosition === 'right' && (
          <div
            className={`tree-resizer-handle tree-resizer-handle-left ${isResizing ? 'resizing' : ''}`}
            onMouseDown={startResizing}
            title="Drag to resize sidebar width"
          />
        )}

        {/* Sidebar Header / Drag Handle */}
        <div
          className={`sidebar-header ${dockPosition === 'float' ? 'cursor-move select-none' : ''}`}
          onMouseDown={dockPosition === 'float' ? startDragging : undefined}
        >
          <div className="sidebar-title-row">
            <div className="sidebar-title flex items-center gap-1.5">
              {dockPosition === 'float' && (
                <GripHorizontal size={14} className="text-[var(--text-muted)] cursor-move" />
              )}
              <span>Navigation</span>
            </div>

            {/* Tree & Dock Actions */}
            <div className="tree-actions flex items-center gap-1">
              {/* Expand / Collapse All */}
              <button
                className="tree-action-btn p-1"
                onClick={handleToggleExpandAll}
                title={hasAnyExpanded ? 'Collapse All Folders' : 'Expand All Folders'}
                aria-label={hasAnyExpanded ? 'Collapse All Folders' : 'Expand All Folders'}
              >
                {hasAnyExpanded ? <MinusSquare size={12} /> : <PlusSquare size={12} />}
              </button>

              {/* Dock Left */}
              <button
                className={`tree-action-btn tree-action-dock p-1 hidden md:inline-flex ${
                  dockPosition === 'left' ? 'text-[var(--accent)] border-[var(--accent)] bg-[var(--accent-light)]' : ''
                }`}
                onClick={() => handleSetDock('left')}
                title="Dock to Left"
              >
                <PanelLeft size={12} />
              </button>

              {/* Float Window */}
              <button
                className={`tree-action-btn tree-action-dock p-1 hidden md:inline-flex ${
                  dockPosition === 'float' ? 'text-[var(--accent)] border-[var(--accent)] bg-[var(--accent-light)]' : ''
                }`}
                onClick={() => handleSetDock('float')}
                title="Float / Moveable Window"
              >
                <Move size={12} />
              </button>

              {/* Dock Right */}
              <button
                className={`tree-action-btn tree-action-dock p-1 hidden md:inline-flex ${
                  dockPosition === 'right' ? 'text-[var(--accent)] border-[var(--accent)] bg-[var(--accent-light)]' : ''
                }`}
                onClick={() => handleSetDock('right')}
                title="Dock to Right"
              >
                <PanelRight size={12} />
              </button>

              {/* Hide / Close Button */}
              <button
                className="tree-action-btn p-1 hover:text-red-500 transition"
                onClick={() => {
                  setIsSidebarOpen(false);
                  setIsHeaderVisible(false);
                }}
                title="Close Navigation Tree"
              >
                <X size={12} />
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

        {/* Tree Container */}
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

        {/* Docked Resizer Handle on Right Edge (when docked left) */}
        {dockPosition === 'left' && (
          <div
            className={`tree-resizer-handle tree-resizer-handle-right ${isResizing ? 'resizing' : ''}`}
            onMouseDown={startResizing}
            title="Drag to resize sidebar width"
          />
        )}

        {/* Floating Corner Resizer (when in float mode) */}
        {dockPosition === 'float' && (
          <div
            className="tree-float-resizer"
            onMouseDown={startFloatingResize}
            title="Drag corner to resize window"
          />
        )}
      </aside>
    </>
  );
}
