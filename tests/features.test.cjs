const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const bundle = fs.readFileSync(path.join(__dirname, '..', 'wind-tile-features.js'), 'utf8');
function load() {
  const registry = new Map();
  class Element {
    attachShadow() { return this.shadowRoot = {}; }
    getBoundingClientRect() { return { width: this.clientWidth || 128, height: 52 }; }
  }
  class Clock extends Date { static now() { return Date.parse('2026-11-13T12:17:30Z'); } }
  const context = vm.createContext({HTMLElement: Element, Date: Clock, console,
    window: {}, customElements: {get: name => registry.get(name), define(name, type) {
      if (registry.has(name)) throw Error('Duplicate element'); registry.set(name, type);
    }}});
  vm.runInContext(bundle, context);
  return {context, registry};
}
function feature(name = 'wind-history-tile-feature', width = 128) {
  const {registry} = load(); const item = new (registry.get(name))();
  item.clientWidth = width; item._context = {entity_id:'sensor.test_speed'}; item._config = {};
  item._hass = {states:{'sensor.test_speed':{state:'12.3',last_updated:'one',attributes:{
    device_class:'wind_speed',unit_of_measurement:'kn',gusts:15.6,direction:225}}}};
  return item;
}
test('one bundle registers two independent features and can be loaded again', () => {
  const {context, registry} = load();
  assert.equal(registry.size, 2); assert.equal(context.window.customCardFeatures.length, 2);
  vm.runInContext(bundle, context);
  assert.equal(context.window.customCardFeatures.length, 2);
});
test('picker only offers the features for supported wind sensor tiles', () => {
  const {context} = load();
  for (const entry of context.window.customCardFeatures) {
    const hass = {states:{'sensor.wind':{attributes:{device_class:'wind_speed'}},
      'sensor.temperature':{attributes:{device_class:'temperature'}},
      'sensor.wind_gusts':{attributes:{device_class:'wind_speed'}}}};
    assert(entry.isSupported(hass, {entity_id:'sensor.wind'}));
    assert(!entry.isSupported(hass, {entity_id:'sensor.temperature'}));
    assert(!entry.isSupported(hass, {entity_id:'sensor.wind_gusts'}));
  }
});
test('bar widths stay fixed while recent history follows available width', () => {
  for (const width of [95,128,151,300,400]) {
    const graph = feature(undefined, width), bars = graph._minuteBars();
    assert.equal(bars.length, Math.floor(width / 5));
    assert.equal(bars.at(-1).wind,12.3);
    const svg = graph._chart(bars);
    assert.equal((svg.match(/data-bar=/g)||[]).length,bars.length*2);
    const rects = [...svg.matchAll(/<rect[^>]*x="([\d.]+)"[^>]*width="([\d.]+)"/g)];
    assert(rects.every(m => Number(m[2]) === 4));
    for(let i=2;i<rects.length;i+=2) assert.equal(Number(rects[i][1])-Number(rects[i-2][1]),5);
    assert.equal(Number(rects.at(-1)[1])+4,width-1);
  }
});
test('vertical guides follow whole ten-minute clock boundaries', () => {
  const graph=feature(), bars=graph._minuteBars(), markup=graph._timeGrid(bars);
  const times=[...markup.matchAll(/data-time="(\d+)"/g)].map(m=>Number(m[1]));
  assert(times.length>0);
  for(let i=0;i<times.length;i++) {
    assert.equal(new Date(times[i]).getUTCMinutes()%10,0);
    if(i) assert.equal(times[i]-times[i-1],600000);
  }
});
test('history fetch requests the width-dependent time span', async () => {
  const graph=feature(undefined,400); graph.isConnected=true;graph._render=()=>{};
  let request;
  graph._hass.callApi=async(method,url)=>{request=url;return []};
  await graph._loadHistory();
  const parsed=new URL('http://test/'+request);
  const start=Date.parse(decodeURIComponent(parsed.pathname.split('/').at(-1)));
  const end=Date.parse(parsed.searchParams.get('end_time'));
  assert(end-start>=80*60000 && end-start<81*60000);
});
test('live readings play fifteen aligned samples and convert units', () => {
  const live=feature('wind-live-tile-feature');
  const state=live._hass.states['sensor.test_speed'];
  state.attributes.unit_of_measurement='m/s';
  state.attributes.data={speed:Array.from({length:15},(_,i)=>i+1),gusts:Array(15).fill(20),direction:Array(15).fill(225)};
  live._syncTimeline();
  assert.equal(live._timeline.length,15);
  live._timelineIndex=14;
  const reading=live._reading();
  assert(Math.abs(reading.speed-15*1.943844)<1e-5);
  assert.equal(reading.cardinal,'SW');
  assert.equal(live._cardinal(360),'N');
  assert.equal(live._cardinal(-90),'W');
});
