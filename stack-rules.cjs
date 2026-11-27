'use strict';

const stackRules = (() => {
  const roundCount = 3;
  const roundMs = 90_000;
  const floorHeight = 44;
  const baseWidth = 348;
  const dropMs = 210;
  const visibleStories = 18;
  const foundation = { x: -baseWidth / 2, width: baseWidth, artLeft: 0 };

  function nextFloor(tower, round) {
    const top = tower.at(-1);
    const center = top.x + top.width / 2;
    const range = Math.min(320 - Math.abs(center) - top.width / 2, 145 + (baseWidth - top.width) * 0.24);
    const duration = 2300 - Math.min(tower.length - 1, 20) * 48 - (round - 1) * 75;
    const side = tower.length % 2 ? -1 : 1;
    return { ...top, center: top.x, range, duration, side, y: tower.length * floorHeight };
  }

  function positionAt(floor, elapsed) {
    const cycle = (Math.max(0, elapsed) / floor.duration) % 2;
    return floor.center + floor.side * floor.range * (2 * Math.abs(1 - cycle) - 1);
  }

  function land(top, x) {
    const left = Math.max(top.x, x);
    const right = Math.min(top.x + top.width, x + top.width);
    const perfect = Math.abs(x - top.x) <= 8;
    const story = perfect ? { ...top } : right - left >= 1
      ? { x: left, width: right - left, artLeft: top.artLeft + left - x } : null;
    return { story, left, right, perfect };
  }

  function encodeStory(story) {
    return [
      Math.round((story.x + baseWidth / 2) / baseWidth * 1000),
      Math.round((story.x + story.width + baseWidth / 2) / baseWidth * 1000),
      Math.round(story.artLeft / baseWidth * 1000),
    ];
  }

  function advanceCombo({ streak, bonus }, perfect) {
    const nextStreak = perfect ? streak + 1 : 0;
    return { streak: nextStreak, bonus: bonus + (nextStreak >= 2 ? 1 : 0) };
  }

  function isFullWidth(previous, shape) {
    return shape[0] === previous[0] && shape[1] === previous[1];
  }

  return { roundCount, roundMs, floorHeight, baseWidth, dropMs, visibleStories, foundation, nextFloor, positionAt, land,
    encodeStory, advanceCombo, isFullWidth };
})();

if (typeof module !== 'undefined') module.exports = stackRules;
