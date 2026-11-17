'use strict';

const assert = require('node:assert/strict');
const {
  findNearestEvent,
  findNearestFrameIndexByTime,
  findNearestPoseFrameIndex,
  formatTime,
} = require('../utils/analysis');

function testFormatTimeCarriesRoundedSeconds() {
  assert.equal(formatTime(0), '00:00.0');
  assert.equal(formatTime(59.94), '00:59.9');
  assert.equal(formatTime(59.96), '01:00.0');
  assert.equal(formatTime(3599.96), '60:00.0');
  assert.equal(formatTime(-2), '00:00.0');
}

function testEventMatchingUsesTheWholeInterval() {
  const sustainedEvent = {
    type: 'Fall',
    start_ts: 10,
    end_ts: 15,
  };

  assert.equal(findNearestEvent([sustainedEvent], 13), sustainedEvent);
  assert.equal(findNearestEvent([sustainedEvent], 15.5), sustainedEvent);
  assert.equal(findNearestEvent([sustainedEvent], 16), null);

  const timestampEvent = { type: 'EdgeControl', timestamp: 20 };
  assert.equal(findNearestEvent([timestampEvent], 20.6), timestampEvent);
}

function testNearestFrameLookups() {
  const frames = [
    { timestamp_sec: 0 },
    { timestamp_sec: 1.2 },
    { timestamp_sec: 3.7 },
    { timestamp_sec: 8.5 },
  ];
  assert.equal(findNearestFrameIndexByTime(frames, -1), 0);
  assert.equal(findNearestFrameIndexByTime(frames, 3.4), 2);
  assert.equal(findNearestFrameIndexByTime(frames, 20), 3);

  const poseFrames = [{ t: 0 }, { t: 0.4 }, { t: 1.3 }, { t: 5.8 }, { t: 9 }];
  assert.equal(findNearestPoseFrameIndex(poseFrames, -1), 0);
  assert.equal(findNearestPoseFrameIndex(poseFrames, 1.1), 2);
  assert.equal(findNearestPoseFrameIndex(poseFrames, 6), 3);
  assert.equal(findNearestPoseFrameIndex(poseFrames, 20), 4);
}

testFormatTimeCarriesRoundedSeconds();
testEventMatchingUsesTheWholeInterval();
testNearestFrameLookups();

console.log('analysis utils tests passed');
