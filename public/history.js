(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.PinboardHistory = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function clampVisibleCount(totalPins, nextCount) {
    return Math.max(0, Math.min(totalPins, nextCount));
  }

  function timelineStatusLabel(visibleCount, totalPins) {
    return visibleCount === totalPins ? 'Latest' : `${visibleCount}/${totalPins} pinned`;
  }

  function backgroundTransform(x, y, scale, gridSize) {
    const scaledGrid = Math.max(4, gridSize * scale);
    return {
      position: `${x}px ${y}px`,
      size: `${scaledGrid}px ${scaledGrid}px`
    };
  }

  function timelineStepOffset(visibleCount, totalPins, laneWidth, inset = 10) {
    const clampedTotal = Math.max(0, totalPins);
    const clampedVisible = clampVisibleCount(clampedTotal, visibleCount);
    const safeInset = Math.max(0, inset);
    const usableWidth = Math.max(0, laneWidth - safeInset * 2);

    if (clampedTotal <= 0 || usableWidth <= 0) return safeInset;

    const ratio = clampedVisible / clampedTotal;
    return safeInset + usableWidth * ratio;
  }

  function timelineVisibleCountFromOffset(offset, totalPins, laneWidth, inset = 10) {
    const clampedTotal = Math.max(0, totalPins);
    const safeInset = Math.max(0, inset);
    const usableWidth = Math.max(1, laneWidth - safeInset * 2);
    const clampedOffset = Math.max(safeInset, Math.min(laneWidth - safeInset, offset));
    const ratio = (clampedOffset - safeInset) / usableWidth;
    return clampVisibleCount(clampedTotal, Math.round(ratio * clampedTotal));
  }

  function latestPinAtOrBeforeCutoff(items, visibleCount) {
    const clamped = clampVisibleCount(items.length, visibleCount);
    if (clamped === 0) return null;
    return items[clamped - 1] || null;
  }

  return {
    clampVisibleCount,
    timelineStatusLabel,
    backgroundTransform,
    timelineStepOffset,
    timelineVisibleCountFromOffset,
    latestPinAtOrBeforeCutoff
  };
}));
