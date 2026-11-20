/**
 * Motion-Optimized Smart Smooth Scroller
 *
 * Provides ultra-fast, smooth, motion-sickness-free scrolling.
 * - Short distances (<= 600px): gentle, rapid ease-out (120ms - 150ms)
 * - Medium distances (600px - 2500px): crisp ease-out (160ms - 200ms)
 * - Long distances (> 2500px): instant pre-jump to within 500px, followed by a buttery 120ms ease-out landing (eliminates nauseating multi-second fast blur!)
 * - Reduced Motion / Instant mode: direct 0ms jump
 */

const activeAnimationByContainer = new WeakMap();
const activeSmoothCleanupByContainer = new WeakMap();

function shouldUseWindow(container) {
  if (typeof window === 'undefined' || !container) return false;
  if (container === window) return true;
  return Boolean(
    document.body?.classList?.contains('window-scroll') &&
      typeof container.matches === 'function' &&
      container.matches('main.content-area')
  );
}

function getContainerScrollTop(container, useWin) {
  if (useWin) return window.scrollY || document.documentElement.scrollTop || 0;
  return container.scrollTop;
}

function setContainerScrollTop(container, useWin, top) {
  if (useWin) window.scrollTo(0, top);
  else container.scrollTop = top;
}

export function cancelSmartScroll(container) {
  if (typeof window === 'undefined' && !container) return;
  const keys = [];
  if (container) keys.push(container);
  if (typeof window !== 'undefined' && (!container || shouldUseWindow(container))) {
    keys.push(window);
  }
  for (const key of keys) {
    const prevAnimId = activeAnimationByContainer.get(key);
    if (prevAnimId) {
      cancelAnimationFrame(prevAnimId);
      activeAnimationByContainer.delete(key);
    }
    const prevSmoothCleanup = activeSmoothCleanupByContainer.get(key);
    if (prevSmoothCleanup) {
      prevSmoothCleanup();
      activeSmoothCleanupByContainer.delete(key);
    }
  }
}

export function smartScrollTo(container, targetTop, options = {}) {
  if (!container) return;

  const {
    scrollMotion = 'fast', // 'fast' | 'instant' | 'smooth'
    offset = 0,
    onComplete = null,
  } = options;

  const useWin = shouldUseWindow(container);
  const animKey = useWin ? window : container;
  const destination = Math.max(0, targetTop - offset);
  const currentTop = getContainerScrollTop(container, useWin);
  const distance = Math.abs(destination - currentTop);

  // Cancel any ongoing scroll animation or pending smooth completion for this container
  const prevAnimId = activeAnimationByContainer.get(animKey);
  if (prevAnimId) {
    cancelAnimationFrame(prevAnimId);
    activeAnimationByContainer.delete(animKey);
  }
  const prevSmoothCleanup = activeSmoothCleanupByContainer.get(animKey);
  if (prevSmoothCleanup) {
    prevSmoothCleanup();
    activeSmoothCleanupByContainer.delete(animKey);
  }

  // 1. Instant / Zero Motion preference
  const isReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (scrollMotion === 'instant' || isReducedMotion || distance < 3) {
    setContainerScrollTop(container, useWin, destination);
    if (onComplete) onComplete();
    return;
  }

  // 2. Standard native smooth (if explicitly requested)
  if (scrollMotion === 'smooth') {
    let finished = false;
    const scrollTarget = useWin ? window : container;
    const fallbackMs = Math.min(900, Math.max(220, Math.round(distance / 3)));
    let timerId = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (timerId !== null) clearTimeout(timerId);
      scrollTarget.removeEventListener('scrollend', finish);
      activeSmoothCleanupByContainer.delete(animKey);
      if (onComplete) onComplete();
    };

    activeSmoothCleanupByContainer.set(animKey, () => {
      finished = true;
      if (timerId !== null) clearTimeout(timerId);
      scrollTarget.removeEventListener('scrollend', finish);
    });

    scrollTarget.addEventListener('scrollend', finish, { once: true });
    timerId = setTimeout(finish, fallbackMs);

    if (useWin) {
      window.scrollTo({ top: destination, behavior: 'smooth' });
    } else {
      container.scrollTo({ top: destination, behavior: 'smooth' });
    }
    return;
  }

  // 3. 'fast' mode (Motion-reducing smart scroll)
  // If jumping a very large distance (e.g. across 10-100 pages),
  // instantly teleport near the destination (450px away) so the user doesn't get dizzy,
  // then do a buttery smooth micro-landing into view.
  let startTop = currentTop;
  if (distance > 2500) {
    startTop = destination > currentTop ? destination - 450 : destination + 450;
    setContainerScrollTop(container, useWin, startTop);
  }

  const animDistance = Math.abs(destination - startTop);
  const duration = Math.min(220, Math.max(100, Math.round(Math.sqrt(animDistance) * 7.5)));
  const startTime = performance.now();
  const initialScroll = getContainerScrollTop(container, useWin);
  const diff = destination - initialScroll;

  function easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
  }

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(1, elapsed / duration);
    const ease = easeOutQuad(progress);

    setContainerScrollTop(container, useWin, initialScroll + diff * ease);

    if (progress < 1) {
      const nextId = requestAnimationFrame(step);
      activeAnimationByContainer.set(animKey, nextId);
    } else {
      activeAnimationByContainer.delete(animKey);
      if (onComplete) onComplete();
    }
  }

  const firstId = requestAnimationFrame(step);
  activeAnimationByContainer.set(animKey, firstId);
}

export function smartScrollIntoView(targetEl, container, options = {}) {
  if (!targetEl || !container) return;
  const useWin = shouldUseWindow(container);
  const containerTop = useWin ? 0 : container.getBoundingClientRect().top;
  const rect = targetEl.getBoundingClientRect();
  const currentScroll = getContainerScrollTop(container, useWin);
  const topPadding = options.topPadding !== undefined ? options.topPadding : 60;
  const targetTop = rect.top - containerTop + currentScroll - topPadding;
  smartScrollTo(container, targetTop, options);
}

export function computeNextHeaderVisibility({
  top = 0,
  isHeaderVisible = true,
  upPeakY = 0,
  downPeakY = 0,
  viewportHeight = 0,
  scrollHeight = 0,
  isJumping = false,
}) {
  const safeTop = Number.isFinite(top) ? top : 0;
  const hasRange = scrollHeight > viewportHeight && viewportHeight > 0;
  const maxScroll = hasRange ? Math.max(0, scrollHeight - viewportHeight) : Math.max(0, safeTop);
  const clampedTop = Math.max(0, Math.min(safeTop, maxScroll));
  const isBottomOverscroll = hasRange && safeTop > maxScroll + 1;

  if (isJumping) {
    const nextVisible = clampedTop <= 24 ? true : isHeaderVisible;
    return { nextVisible, upPeakY: clampedTop, downPeakY: clampedTop };
  }

  if (clampedTop <= 24) {
    return { nextVisible: true, upPeakY: clampedTop, downPeakY: clampedTop };
  }

  if (isHeaderVisible) {
    const baseUp = Number.isFinite(upPeakY) ? Math.min(upPeakY, clampedTop) : clampedTop;
    if (clampedTop > 64 && clampedTop - baseUp >= 36) {
      return { nextVisible: false, upPeakY: clampedTop, downPeakY: clampedTop };
    }
    return { nextVisible: true, upPeakY: baseUp, downPeakY: clampedTop };
  }

  if (isBottomOverscroll) {
    const baseDown = Number.isFinite(downPeakY) ? Math.max(downPeakY, maxScroll) : maxScroll;
    return { nextVisible: false, upPeakY: clampedTop, downPeakY: baseDown };
  }

  const baseDown = Number.isFinite(downPeakY) ? Math.max(downPeakY, clampedTop) : clampedTop;
  if (baseDown - clampedTop >= 24) {
    return { nextVisible: true, upPeakY: clampedTop, downPeakY: clampedTop };
  }
  return { nextVisible: false, upPeakY: clampedTop, downPeakY: baseDown };
}
