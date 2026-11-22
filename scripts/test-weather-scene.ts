/**
 * 天气场景映射：中英文案 + icon code
 * 运行：npx --yes tsx scripts/test-weather-scene.ts
 */
import assert from 'node:assert/strict';

import {
  isWeatherSceneKey,
  resolveWeatherDayPart,
  resolveWeatherSceneKey,
} from '../lib/weather-scene';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(e);
  }
}

check('中文：晴 / 热 → clear', () => {
  assert.equal(resolveWeatherSceneKey({ text: '晴' }), 'clear');
  assert.equal(resolveWeatherSceneKey({ text: '晴朗' }), 'clear');
  assert.equal(resolveWeatherSceneKey({ text: '热' }), 'clear');
});

check('中文：多云 / 少云 / 晴间多云 → cloudy', () => {
  assert.equal(resolveWeatherSceneKey({ text: '多云' }), 'cloudy');
  assert.equal(resolveWeatherSceneKey({ text: '少云' }), 'cloudy');
  assert.equal(resolveWeatherSceneKey({ text: '晴间多云' }), 'cloudy');
});

check('中文：阴 → overcast', () => {
  assert.equal(resolveWeatherSceneKey({ text: '阴' }), 'overcast');
});

check('中文：雨 / 阵雨 / 雷阵雨 / 冻雨 → rain', () => {
  assert.equal(resolveWeatherSceneKey({ text: '小雨' }), 'rain');
  assert.equal(resolveWeatherSceneKey({ text: '阵雨' }), 'rain');
  assert.equal(resolveWeatherSceneKey({ text: '雷阵雨' }), 'rain');
  assert.equal(resolveWeatherSceneKey({ text: '冻雨' }), 'rain');
});

check('中文：雪 / 雨夹雪 / 冰雹 → snow', () => {
  assert.equal(resolveWeatherSceneKey({ text: '小雪' }), 'snow');
  assert.equal(resolveWeatherSceneKey({ text: '雨夹雪' }), 'snow');
  assert.equal(resolveWeatherSceneKey({ text: '冰雹' }), 'snow');
});

check('中文：雾 / 霾 / 沙 / 尘 → fog', () => {
  assert.equal(resolveWeatherSceneKey({ text: '雾' }), 'fog');
  assert.equal(resolveWeatherSceneKey({ text: '霾' }), 'fog');
  assert.equal(resolveWeatherSceneKey({ text: '沙尘' }), 'fog');
  assert.equal(resolveWeatherSceneKey({ text: '浮尘' }), 'fog');
});

check('英文：clear / cloudy / overcast / rain / snow / fog', () => {
  assert.equal(resolveWeatherSceneKey({ text: 'Sunny' }), 'clear');
  assert.equal(resolveWeatherSceneKey({ text: 'Clear' }), 'clear');
  assert.equal(resolveWeatherSceneKey({ text: 'Partly cloudy' }), 'cloudy');
  assert.equal(resolveWeatherSceneKey({ text: 'Cloudy' }), 'cloudy');
  assert.equal(resolveWeatherSceneKey({ text: 'Overcast' }), 'overcast');
  assert.equal(resolveWeatherSceneKey({ text: 'Light rain' }), 'rain');
  assert.equal(resolveWeatherSceneKey({ text: 'Thunderstorm' }), 'rain');
  assert.equal(resolveWeatherSceneKey({ text: 'Heavy snow' }), 'snow');
  assert.equal(resolveWeatherSceneKey({ text: 'Sleet' }), 'snow');
  assert.equal(resolveWeatherSceneKey({ text: 'Mist' }), 'fog');
  assert.equal(resolveWeatherSceneKey({ text: 'Fog' }), 'fog');
  assert.equal(resolveWeatherSceneKey({ text: 'Haze' }), 'fog');
});

check('icon：和风码优先于空文案', () => {
  assert.equal(resolveWeatherSceneKey({ text: null, icon: '100' }), 'clear');
  assert.equal(resolveWeatherSceneKey({ text: '', icon: '101' }), 'cloudy');
  assert.equal(resolveWeatherSceneKey({ text: '', icon: '104' }), 'overcast');
  assert.equal(resolveWeatherSceneKey({ text: '', icon: '305' }), 'rain');
  assert.equal(resolveWeatherSceneKey({ text: '', icon: '400' }), 'snow');
  assert.equal(resolveWeatherSceneKey({ text: '', icon: '501' }), 'fog');
});

check('icon：WeatherAPI code', () => {
  assert.equal(resolveWeatherSceneKey({ icon: '1000' }), 'clear');
  assert.equal(resolveWeatherSceneKey({ icon: '1006' }), 'cloudy');
  assert.equal(resolveWeatherSceneKey({ icon: '1009' }), 'overcast');
  assert.equal(resolveWeatherSceneKey({ icon: '1183' }), 'rain');
  assert.equal(resolveWeatherSceneKey({ icon: '1213' }), 'snow');
  assert.equal(resolveWeatherSceneKey({ icon: '1135' }), 'fog');
});

check('文案优先于 icon；未识别 → cloudy', () => {
  assert.equal(resolveWeatherSceneKey({ text: '晴', icon: '305' }), 'clear');
  assert.equal(resolveWeatherSceneKey({ text: '', icon: '' }), 'cloudy');
  assert.equal(resolveWeatherSceneKey({ text: '未知天气现象', icon: '9999' }), 'cloudy');
  assert.equal(resolveWeatherSceneKey({}), 'cloudy');
});

check('日夜跟随主题 scheme', () => {
  assert.equal(resolveWeatherDayPart('light'), 'day');
  assert.equal(resolveWeatherDayPart('dark'), 'night');
});

check('isWeatherSceneKey', () => {
  assert.equal(isWeatherSceneKey('clear'), true);
  assert.equal(isWeatherSceneKey('rain'), true);
  assert.equal(isWeatherSceneKey('windy'), false);
  assert.equal(isWeatherSceneKey(null), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
