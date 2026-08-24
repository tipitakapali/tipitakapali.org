/**
 * Motion-Optimized Smart Smooth Scroller
 *
 * Provides ultra-fast, smooth, motion-sickness-free scrolling.
 * - Short distances (<= 600px): gentle, rapid ease-out (120ms - 150ms)
 * - Medium distances (600px - 2500px): crisp ease-out (160ms - 200ms)
 * - Long distances (> 2500px): instant pre-jump to within 500px, followed by a buttery 120ms ease-out landing (eliminates nauseating multi-second fast blur!)
 * - Reduced Motion / Instant mode: direct 0ms jump
 */

let activeAnimationId = null;

export function smartScrollTo(container, targetTop, options = {}) {
  if (!container) return;

  const {
    scrollMotion = 'fast', // 'fast' | 'instant' | 'smooth'
    offset = 0,
    onComplete = null,
  } = options;

  const destination = Math.max(0, targetTop - offset);
  const currentTop = container.scrollTop;
  const distance = Math.abs(destination - currentTop);

  // Cancel any ongoing scroll animation
  if (activeAnimationId) {
    cancelAnimationFrame(activeAnimationId);
    activeAnimationId = null;
  }

  // 1. Instant / Zero Motion preference
  const isReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (scrollMotion === 'instant' || isReducedMotion || distance < 3) {
    container.scrollTop = destination;
    if (onComplete) onComplete();
    return;
  }

  // 2. Standard native smooth (if explicitly requested)
  if (scrollMotion === 'smooth') {
    container.scrollTo({ top: destination, behavior: 'smooth' });
    if (onComplete) {
      setTimeout(onComplete, Math.min(450, Math.max(150, Math.round(distance / 6))));
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
    container.scrollTop = startTop;
  }

  const animDistance = Math.abs(destination - startTop);
  const duration = Math.min(220, Math.max(100, Math.round(Math.sqrt(animDistance) * 7.5)));
  const startTime = performance.now();
  const initialScroll = container.scrollTop;
  const diff = destination - initialScroll;

  function easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
  }

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(1, elapsed / duration);
    const ease = easeOutQuad(progress);

    container.scrollTop = initialScroll + diff * ease;

    if (progress < 1) {
      activeAnimationId = requestAnimationFrame(step);
    } else {
      activeAnimationId = null;
      if (onComplete) onComplete();
    }
  }

  activeAnimationId = requestAnimationFrame(step);
}

export function smartScrollIntoView(targetEl, container, options = {}) {
  if (!targetEl || !container) return;
  const containerRect = container.getBoundingClientRect();
  const rect = targetEl.getBoundingClientRect();
  const currentScroll = container.scrollTop;
  const topPadding = options.topPadding !== undefined ? options.topPadding : 60;
  const targetTop = rect.top - containerRect.top + currentScroll - topPadding;
  smartScrollTo(container, targetTop, options);
}
