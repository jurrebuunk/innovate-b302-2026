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

  function latestPinAtOrBeforeCutoff(items, visibleCount) {
    const clamped = clampVisibleCount(items.length, visibleCount);
    if (clamped === 0) return null;
    return items[clamped - 1] || null;
  }

  return {
    clampVisibleCount,
    timelineStatusLabel,
    backgroundTransform,
    latestPinAtOrBeforeCutoff
  };
}));
