/* Wind Tile Features v0.1.2 | MIT | github.com/jtonk/ha-wind-tile-features */

(() => {
  if (customElements.get('wind-history-tile-feature')) return;
/* Wind history sized to the available tile width. */
const WIND_HISTORY_COLORS = [
  '#9700ff', '#6400ff', '#3200ff', '#0032ff', '#0064ff', '#0096ff', '#00c7ff',
  '#00e6f0', '#25c192', '#11d411', '#00e600', '#00fa00', '#b8ff61', '#fffe00',
  '#ffe100', '#ffc800', '#ffaf00', '#ff9600', '#e67d00', '#e66400', '#dc4a1d',
  '#c8321d', '#b4191d', '#aa001d', '#b40032', '#c80064', '#fe0096'
];

const supportsWindHistory = (hass, context) => {
  const id = context?.entity_id;
  const state = id && hass?.states?.[id];
  return Boolean(id?.startsWith('sensor.') && !id.endsWith('_gusts') && state &&
    (state.attributes?.device_class === 'wind_speed' ||
      id === 'sensor.ksn_speed' || id === 'sensor.airtime_speed'));
};

class WindHistoryTileFeature extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._history = {};
    this._timeline = [];
    this._timelineIndex = 0;
    this._timelineStamp = null;
    this._lastFetch = 0;
    this._requestId = 0;
    this._width = 0;
    this._loadStart = null;
  }

  static getStubConfig(hass, context) {
    const id = context?.entity_id || '';
    const prefix = id.replace(/_speed$/, '');
    const gust = id + '_gusts';
    const direction = prefix + '_wind_direction';
    return {
      type: 'custom:wind-history-tile-feature',
      ...(hass?.states?.[gust] ? { gust_entity: gust } : {}),
      ...(hass?.states?.[direction] ? { direction_entity: direction } : {})
    };
  }

  static getConfigForm() {
    return {
      schema: [
        { name: 'gust_entity', selector: { entity: { domain: 'sensor' } } },
        { name: 'direction_entity', selector: { entity: { domain: 'sensor' } } }
      ],
      computeLabel: field => ({
        gust_entity: 'Gust sensor',
        direction_entity: 'Wind direction sensor'
      })[field.name]
    };
  }

  setConfig(config) {
    if (!config || config.type !== 'custom:wind-history-tile-feature')
      throw new Error('Invalid wind history tile feature configuration');
    this._config = config;
    this._history = {};
    this._lastFetch = 0;
    this._requestId++;
    this._renderedBars = null;
    this._loadStart = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._syncTimeline();
    this._render();
    this._loadHistory();
  }

  set context(context) {
    if (this._context?.entity_id !== context?.entity_id) {
      this._timelineStamp = null;
      this._history = {};
      this._lastFetch = 0;
      this._requestId++;
      this._renderedBars = null;
      this._loadStart = null;
    }
    this._context = context;
    this._syncTimeline();
    this._render();
    this._loadHistory();
  }

  connectedCallback() {
    this._resizeObserver = new ResizeObserver(() => {
      const { height } = this.getBoundingClientRect();
      const width = this.clientWidth || this.getBoundingClientRect().width;
      const heightChanged = this._syncSize();
      if (Math.abs(width - this._width) >= 1 || height !== this._height || heightChanged) {
        const historyChanged = Math.max(1, Math.floor(width / 5)) !== this._historyCount;
        this._width = width;
        this._height = height;
        this._render();
        if (historyChanged) {
          this._lastFetch = 0;
          this._loadHistory();
        }
      }
    });
    this._syncSize();
    this._resizeObserver.observe(this);
    if (this._tile) this._resizeObserver.observe(this._tile);
    this._timer = setInterval(() => {
      if (this._timelineIndex < this._timeline.length - 1) this._timelineIndex++;
      this._render();
      this._loadHistory();
    }, 1000);
    this._render();
    this._loadHistory();
  }

  disconnectedCallback() {
    this._resizeObserver?.disconnect();
    clearInterval(this._timer);
    if (this._animationFrame) cancelAnimationFrame(this._animationFrame);
    this._animationFrame = null;
    this._requestId++;
    this._loadStart = null;
  }

  _syncSize() {
    let node = this;
    let tile;
    let wrapper;
    while (node) {
      if (node.localName === 'hui-tile-card') tile = node;
      else if (tile && typeof node.getGridOptions === 'function') {
        wrapper = node;
        break;
      }
      node = node.parentElement || node.getRootNode?.().host;
    }
    this._tile = tile;
    const minimum = tile?.getGridOptions?.().min_rows;
    const rows = wrapper?.getGridOptions?.().rows;
    const styles = getComputedStyle(this);
    const rowHeight = parseFloat(styles.getPropertyValue('--row-height')) || 56;
    const rowGap = parseFloat(styles.getPropertyValue('--row-gap')) || 8;
    const extra = Number.isFinite(rows) && Number.isFinite(minimum)
      ? Math.max(0, rows - minimum) * (rowHeight + rowGap) : 0;
    if (extra === this._extraHeight) return false;
    this._extraHeight = extra;
    this.style.setProperty('--wind-history-extra-height', `${extra}px`);
    return true;
  }

  _number(value) {
    if (value === null || value === undefined || value === '' ||
        ['unknown', 'unavailable', 'none'].includes(String(value).toLowerCase())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  _knots(value, unit) {
    const number = this._number(value);
    if (number === null) return null;
    switch (String(unit || 'kn').toLowerCase()) {
      case 'm/s': return number * 1.943844;
      case 'km/h': return number / 1.852;
      case 'mph': return number * 0.868976;
      default: return number;
    }
  }

  _direction(value) {
    const number = this._number(value);
    return number === null ? null : ((number % 360) + 360) % 360;
  }

  _entities() {
    const speed = this._context?.entity_id;
    const prefix = speed?.replace(/_speed$/, '') || '';
    const guessedGust = speed + '_gusts';
    const guessedDirection = prefix + '_wind_direction';
    return {
      speed,
      gust: this._config?.gust_entity ||
        (this._hass?.states?.[guessedGust] ? guessedGust : null),
      direction: this._config?.direction_entity ||
        (this._hass?.states?.[guessedDirection] ? guessedDirection : null)
    };
  }

  _syncTimeline() {
    const entity = this._entities().speed;
    const state = this._hass?.states?.[entity];
    const data = state?.attributes?.data;
    const speeds = data?.speed;
    const gusts = data?.gusts;
    const directions = data?.direction;
    if (!Array.isArray(speeds) || !speeds.length) {
      this._timeline = [];
      this._timelineStamp = null;
      this._timelineIndex = 0;
      return;
    }
    const stamp = state.last_updated || state.last_changed ||
      JSON.stringify([speeds, gusts, directions]);
    if (stamp === this._timelineStamp) return;
    this._timelineStamp = stamp;
    this._timeline = speeds.slice(0, 15).map((speed, index) => ({
      speed: this._number(speed),
      gust: this._number(gusts?.[index]),
      direction: this._direction(directions?.[index])
    }));
    this._timelineIndex = 0;
  }

  _current() {
    const { speed, gust, direction } = this._entities();
    const speedState = this._hass?.states?.[speed];
    const gustState = this._hass?.states?.[gust];
    const directionState = this._hass?.states?.[direction];
    const frame = this._timeline[this._timelineIndex];
    const unit = speedState?.attributes?.unit_of_measurement || 'kn';
    const gustUnit = gustState?.attributes?.unit_of_measurement || unit;
    return {
      wind: this._knots(frame?.speed ?? speedState?.state, unit),
      gust: this._knots(frame?.gust ?? gustState?.state ??
        speedState?.attributes?.gusts ?? speedState?.attributes?.vlagen, gustUnit),
      direction: this._direction(frame?.direction ?? directionState?.state ??
        speedState?.attributes?.direction)
    };
  }

  _chartWidth() {
    return this.clientWidth || this.getBoundingClientRect().width || this._width || 240;
  }

  _barCount() {
    return Math.max(1, Math.floor(this._chartWidth() / 5));
  }

  _minuteBars() {
    const now = Date.now();
    const count = this._barCount();
    const firstMinute = Math.floor(now / 60000) * 60000 - (count - 1) * 60000;
    const bars = Array.from({ length: count }, () => ({ wind: null, gust: null, direction: null }));
    const { speed, gust, direction } = this._entities();
    for (const [entity, key] of [[speed, 'wind'], [gust, 'gust'], [direction, 'direction']]) {
      if (!entity) continue;
      let last = null;
      let lastTime = -Infinity;
      let index = 0;
      const samples = this._history[entity] || [];
      for (let minute = 0; minute < count; minute++) {
        const end = firstMinute + (minute + 1) * 60000;
        while (index < samples.length && samples[index].time < end) {
          last = samples[index].value;
          lastTime = samples[index].time;
          index++;
        }
        if (end - lastTime <= 3 * 60000) bars[minute][key] = last;
      }
    }
    // Live values keep the rightmost bar moving between recorder refreshes.
    const current = this._current();
    bars[count - 1].wind = current.wind ?? bars[count - 1].wind;
    bars[count - 1].gust = current.gust ?? bars[count - 1].gust;
    bars[count - 1].direction = current.direction ?? bars[count - 1].direction;
    return bars;
  }

  _color(knots) {
    return WIND_HISTORY_COLORS[Math.max(0, Math.min(
      WIND_HISTORY_COLORS.length - 1, Math.floor(Math.max(0, knots) / 2)))];
  }

  _scaleMax(bars) {
    const values = bars.flatMap(bar => [bar.wind, bar.gust]).filter(Number.isFinite);
    return Math.max(5, ...values);
  }

  _plotRange() {
    const height = Math.max(1, (this.getBoundingClientRect().height || 52) - 15);
    // Use the full plot height, reserving only one screen pixel for the gust cap.
    return 74 - 74 / height;
  }

  _grid(bars) {
    const max = this._scaleMax(bars);
    const height = Math.max(1, (this.getBoundingClientRect().height || 52) - 15);
    // Keep five-knot guides only when they have at least 14 screen pixels between them.
    const interval = height * this._plotRange() / 74 * 5 / max >= 14 ? 5 : 10;
    const lines = [];
    for (let knots = 0; knots <= max; knots += interval) {
      const y = 74 - knots / max * this._plotRange();
      lines.push(`<path class="grid" data-knots="${knots}" d="M0 ${y.toFixed(1)}H${this._chartWidth()}"><title>${knots} kn</title></path>`);
    }
    return lines.join('');
  }

  _geometry(bars) {
    const max = this._scaleMax(bars);
    const bottom = 74;
    const range = this._plotRange();
    const plotHeight = Math.max(1, (this.getBoundingClientRect().height || 52) - 15);
    // Match Windfinder's one-screen-pixel gust cap, including on taller cards.
    const capHeight = 74 / plotHeight;
    return bars.flatMap(bar => {
      const wind = Math.max(0, bar.wind ?? 0);
      const gust = Math.max(wind, bar.gust ?? wind);
      const windTop = bottom - Math.min(range, wind / max * range);
      const gustTop = bottom - Math.min(range, gust / max * range);
      return [
        { y: windTop, height: bottom - windTop, color: this._color(wind) },
        { y: gustTop - capHeight, height: gust - wind >= 1 ? capHeight : 0, color: this._color(gust) }
      ];
    });
  }

  _timeGrid(bars) {
    const offset = Math.max(0, this._chartWidth() - bars.length * 5);
    const firstMinute = Math.floor(Date.now() / 60000) - bars.length + 1;
    const lines = [];
    for (let index = 0; index < bars.length; index++) {
      const time = new Date((firstMinute + index) * 60000);
      if (time.getMinutes() % 10 !== 0) continue;
      const x = offset + index * 5;
      const label = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      lines.push(`<path class="grid time-grid" data-time="${time.getTime()}" d="M${x} 0V74"><title>${label}</title></path>`);
    }
    return lines.join('');
  }

  _chart(bars, loadElapsed = null) {
    if (!bars.some(bar => bar.wind !== null || bar.gust !== null))
      return '<div class="empty">Wind history loading…</div>';
    const width = this._chartWidth();
    const offset = Math.max(0, width - bars.length * 5);
    const geometry = this._geometry(bars);
    const rects = Array.from({ length: bars.length }, (_, minute) => {
      const pair = [0, 1].map(part => {
        const index = minute * 2 + part;
        const rect = geometry[index];
        return `<rect data-bar="${index}" x="${offset + minute * 5}" y="${rect.y.toFixed(1)}" width="4" height="${rect.height.toFixed(1)}" fill="${rect.color}"/>`;
      }).join('');
      const entrance = loadElapsed === null ? '' :
        ` class="bar-enter" style="animation-delay:${Math.round((bars.length - 1 - minute) * Math.min(8, 472 / Math.max(1, bars.length - 1)) - loadElapsed)}ms"`;
      return `<g data-minute="${minute}"${entrance}>${pair}</g>`;
    }).join('');
    return `<svg viewBox="0 0 ${width} 74" preserveAspectRatio="none" role="img" aria-label="Wind and gust speeds over the last ${bars.length} minutes">${this._grid(bars)}${rects}${this._timeGrid(bars)}</svg>`;
  }

  _arrows(bars) {
    const width = this._chartWidth();
    const maxArrows = Math.max(1, Math.floor(width / 18));
    const interval = Math.max(1, Math.ceil(bars.length / maxArrows));
    const arrows = [];
    for (let start = 0; start < bars.length; start += interval) {
      const end = Math.min(bars.length - 1, start + interval - 1);
      const index = end === bars.length - 1 ? bars.length - 1 : Math.floor((start + end) / 2);
      const degrees = bars[index].direction;
      if (degrees === null) continue;
      const left = (Math.max(0, width - bars.length * 5) + index * 5 + 2) / width * 100;
      // mdi:navigation bounds are x=4.5..19.5, y=2..21. Center its artwork
      // at (12, 11.5), rather than rotating around the original (12, 12) canvas.
      arrows.push(`<span class="direction" data-index="${index}" style="left:clamp(7px,${left.toFixed(2)}%,calc(100% - 7px));--angle:${(degrees + 180) % 360}deg" title="Wind from ${Math.round(degrees)}°"><svg class="direction-icon" viewBox="0 -0.5 24 24" aria-hidden="true"><path d="M12,2L4.5,20.29L5.21,21L12,18L18.79,21L19.5,20.29L12,2Z"/></svg></span>`);
    }
    return arrows.join('');
  }

  _animateChanges(previous, bars) {
    if (!previous || previous.length !== bars.length || typeof requestAnimationFrame !== 'function') return;
    const rects = [...this.shadowRoot.querySelectorAll('rect[data-bar]')];
    const arrows = [...this.shadowRoot.querySelectorAll('.direction')];
    const from = this._geometry(previous);
    const to = this._geometry(bars);
    const rotations = arrows.map(arrow => {
      const index = Number(arrow.getAttribute('data-index'));
      const prior = previous[index]?.direction;
      const current = bars[index]?.direction;
      const start = (prior ?? current) + 180;
      return { icon: arrow.querySelector('.direction-icon'), start,
        delta: ((current + 180 - start + 540) % 360) - 180 };
    });
    if (!rects.some((rect, index) => from[index].y !== to[index].y ||
        from[index].height !== to[index].height || from[index].color !== to[index].color) &&
        !rotations.some(rotation => rotation.delta)) return;
    const rgb = color => [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16));
    const fromColors = from.map(rect => rgb(rect.color));
    const toColors = to.map(rect => rgb(rect.color));
    const start = performance.now();
    const draw = now => {
      const progress = Math.max(0, Math.min(1, (now - start) / 750));
      const eased = progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
      rects.forEach((rect, index) => {
        const old = from[index];
        const next = to[index];
        rect.setAttribute('y', (old.y + (next.y - old.y) * eased).toFixed(1));
        rect.setAttribute('height', (old.height + (next.height - old.height) * eased).toFixed(1));
        const channels = fromColors[index].map((channel, i) =>
          Math.round(channel + (toColors[index][i] - channel) * eased));
        rect.setAttribute('fill', progress === 1 ? next.color : `rgb(${channels.join(',')})`);
      });
      rotations.forEach(({ icon, start: angle, delta }) => {
        if (icon) icon.style.transform = `rotate(${angle + delta * eased}deg)`;
      });
      if (progress < 1) this._animationFrame = requestAnimationFrame(draw);
      else this._animationFrame = null;
    };
    draw(start);
  }

  _render() {
    if (!this.isConnected || !this._config || !this._hass || !this._context?.entity_id) return;
    if (this._animationFrame) cancelAnimationFrame(this._animationFrame);
    const bars = this._minuteBars();
    const previous = this._renderedBars;
    if (this._loadStart === null && bars.filter(bar => bar.wind !== null || bar.gust !== null).length > 1)
      this._loadStart = performance.now();
    const elapsed = this._loadStart === null ? null : performance.now() - this._loadStart;
    const loadElapsed = elapsed !== null && elapsed < 900 ? elapsed : null;
    this.shadowRoot.innerHTML = `
      <style>
        /* Reserve one complete Sections feature row without growing the tile header. */
        :host{display:flex;align-items:center;width:100%;height:calc(var(--row-height,56px) + var(--row-gap,8px) - var(--ha-card-feature-gap,12px) + var(--wind-history-extra-height,0px));box-sizing:border-box;color:var(--secondary-text-color)}
        .wrap{width:100%;height:100%;flex:none;box-sizing:border-box;display:flex;flex-direction:column;gap:1px;overflow:hidden}
        .chart{flex:1;min-height:0}.chart svg{display:block;width:100%;height:100%}
        .bar-enter{transform-box:fill-box;transform-origin:center bottom;animation:wind-bar-enter 420ms cubic-bezier(.65,0,.35,1) both}
        @keyframes wind-bar-enter{from{transform:scaleY(0);opacity:0}to{transform:scaleY(1);opacity:1}}
        @media (prefers-reduced-motion:reduce){.bar-enter{animation:none}}
        .grid{fill:none;stroke:currentColor;stroke-opacity:1;stroke-width:.25;vector-effect:non-scaling-stroke}
        .directions{height:14px;flex:none;position:relative}
        .direction{position:absolute;top:0;width:14px;height:14px;display:grid;place-items:center;transform:translateX(-50%)}
        .direction-icon{display:block;width:9px;height:9px;fill:currentColor;transform:rotate(var(--angle));transform-box:view-box;transform-origin:50% 50%}
        .empty{font-size:10px;padding:8px 4px}
      </style>
      <div class="wrap"><div class="directions" aria-label="Wind direction during the last ${bars.length} minutes">${this._arrows(bars)}</div><div class="chart">${this._chart(bars, loadElapsed)}</div></div>`;
    this._renderedBars = bars;
    this._animateChanges(previous, bars);
  }

  async _loadHistory() {
    if (!this.isConnected || !this._hass?.callApi || !this._context?.entity_id) return;
    if (Date.now() - this._lastFetch < 60000) return;
    this._lastFetch = Date.now();
    const count = this._barCount();
    this._historyCount = count;
    const requestId = ++this._requestId;
    const { speed, gust, direction } = this._entities();
    const entities = [...new Set([speed, gust, direction].filter(Boolean))];
    const end = new Date();
    const start = new Date(Math.floor(end.getTime() / 60000) * 60000 - count * 60000);
    const path = `history/period/${encodeURIComponent(start.toISOString())}?filter_entity_id=${encodeURIComponent(entities.join(','))}&end_time=${encodeURIComponent(end.toISOString())}&minimal_response&no_attributes`;
    try {
      const result = await this._hass.callApi('GET', path);
      if (!this.isConnected || requestId !== this._requestId) return;
      const next = {};
      for (const entity of entities) {
        const group = (Array.isArray(result) ? result : [])
          .find(items => items?.[0]?.entity_id === entity) || [];
        const unit = this._hass.states[entity]?.attributes?.unit_of_measurement || 'kn';
        next[entity] = group.map(item => ({
          time: Date.parse(item.last_changed || item.last_updated),
          value: entity === direction
            ? this._direction(item.state) : this._knots(item.state, unit)
        })).filter(point => Number.isFinite(point.time))
          .sort((a, b) => a.time - b.time);
      }
      this._history = next;
      this._render();
    } catch (error) {
      console.warn('wind-history-tile-feature: history unavailable', error);
      this._lastFetch = Date.now() - 45000;
    }
  }
}

customElements.define('wind-history-tile-feature', WindHistoryTileFeature);
window.customCardFeatures = window.customCardFeatures || [];
window.customCardFeatures.push({
  type: 'wind-history-tile-feature',
  name: 'Wind history',
  isSupported: supportsWindHistory,
  configurable: true
});

})();

(() => {
  if (customElements.get('wind-live-tile-feature')) return;
/* Live speed and gust bar for Home Assistant wind-speed tiles. */
const WIND_LIVE_COLORS = [
  '#9700ff', '#6400ff', '#3200ff', '#0032ff', '#0064ff', '#0096ff', '#00c7ff',
  '#00e6f0', '#25c192', '#11d411', '#00e600', '#00fa00', '#b8ff61', '#fffe00',
  '#ffe100', '#ffc800', '#ffaf00', '#ff9600', '#e67d00', '#e66400', '#dc4a1d',
  '#c8321d', '#b4191d', '#aa001d', '#b40032', '#c80064', '#fe0096'
];

const supportsWindLive = (hass, context) => {
  const id = context?.entity_id;
  const state = id && hass?.states?.[id];
  return Boolean(id?.startsWith('sensor.') && !id.endsWith('_gusts') && state &&
    (state.attributes?.device_class === 'wind_speed' ||
      id === 'sensor.ksn_speed' || id === 'sensor.airtime_speed'));
};

class WindLiveTileFeature extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._timeline = [];
    this._timelineIndex = 0;
    this._timelineStamp = null;
  }

  static getStubConfig(hass, context) {
    const gust = (context?.entity_id || '') + '_gusts';
    return {
      type: 'custom:wind-live-tile-feature',
      ...(hass?.states?.[gust] ? { gust_entity: gust } : {})
    };
  }

  static getConfigForm() {
    return {
      schema: [{ name: 'gust_entity', selector: { entity: { domain: 'sensor' } } }],
      computeLabel: () => 'Gust sensor'
    };
  }

  setConfig(config) {
    if (!config || config.type !== 'custom:wind-live-tile-feature')
      throw new Error('Invalid live wind tile feature configuration');
    const stops = this._parseColors(config.colors);
    this._config = config;
    this._colorStops = stops;
    this._render();
    const track = this.shadowRoot.querySelector('.track');
    if (track) track.style.background = this._gradient();
    this._update();
  }

  _parseColors(colors) {
    if (colors === undefined) return [
      ...WIND_LIVE_COLORS.map((color, index) => ({ speed: index * 2, color })),
      { speed: 56, color: WIND_LIVE_COLORS.at(-1) }
    ];
    if (!Array.isArray(colors) || colors.length < 2)
      throw new Error('colors must contain at least two colors or {speed, color} stops');
    const simple = colors.every(color => typeof color === 'string');
    const stops = colors.map((item, index) => {
      const speed = simple ? index * 56 / (colors.length - 1) : item?.speed;
      const color = simple ? item : item?.color;
      if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0 || speed > 56 ||
          typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))
        throw new Error('Each colors entry needs a six-digit hex color and a speed between 0 and 56 kn');
      return { speed, color };
    });
    if (stops.some((stop, index) => index > 0 && stop.speed <= stops[index - 1].speed))
      throw new Error('colors speeds must be strictly increasing');
    return stops;
  }

  _gradient() {
    const stops = this._colorStops || this._parseColors();
    return `linear-gradient(90deg, ${stops.map(stop =>
      `${stop.color} ${(stop.speed / 56 * 100).toFixed(2)}%`).join(', ')})`;
  }

  _highlightColor(speed) {
    const stops = this._colorStops || this._parseColors();
    return [...stops].reverse().find(stop => stop.speed <= speed)?.color || stops[0].color;
  }

  set hass(hass) {
    this._hass = hass;
    this._syncTimeline();
    this._update();
  }

  set context(context) {
    if (this._context?.entity_id !== context?.entity_id) {
      this._timelineStamp = null;
    }
    this._context = context;
    this._syncTimeline();
    this._update();
  }

  connectedCallback() {
    this._render();
    this._syncTimeline();
    this._update();
    this._timer = setInterval(() => {
      if (this._timelineIndex < this._timeline.length - 1) this._timelineIndex++;
      this._update();
    }, 1000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  _number(value) {
    if (value === null || value === undefined || value === '' ||
        ['unknown', 'unavailable', 'none'].includes(String(value).toLowerCase())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  _knots(value, unit) {
    const number = this._number(value);
    if (number === null) return null;
    switch (String(unit || 'kn').toLowerCase()) {
      case 'm/s': return number * 1.943844;
      case 'km/h': return number / 1.852;
      case 'mph': return number * 0.868976;
      default: return number;
    }
  }

  _gustEntity() {
    const guessed = (this._context?.entity_id || '') + '_gusts';
    return this._config?.gust_entity ||
      (this._hass?.states?.[guessed] ? guessed : null);
  }

  _syncTimeline() {
    const state = this._hass?.states?.[this._context?.entity_id];
    const data = state?.attributes?.data;
    if (!Array.isArray(data?.speed) || !data.speed.length) {
      this._timeline = [];
      this._timelineIndex = 0;
      this._timelineStamp = null;
      return;
    }
    const stamp = state.last_updated || state.last_changed ||
      JSON.stringify([data.speed, data.gusts, data.direction]);
    if (stamp === this._timelineStamp) return;
    this._timelineStamp = stamp;
    this._timeline = data.speed.slice(0, 15).map((speed, index) => ({
      speed: this._number(speed),
      gust: this._number(data.gusts?.[index]),
      direction: data.direction?.[index]
    }));
    this._timelineIndex = 0;
  }

  _reading() {
    const state = this._hass?.states?.[this._context?.entity_id];
    const gustState = this._hass?.states?.[this._gustEntity()];
    const frame = this._timeline[this._timelineIndex];
    const unit = state?.attributes?.unit_of_measurement || 'kn';
    const gustUnit = gustState?.attributes?.unit_of_measurement || unit;
    const raw = frame?.speed ?? this._number(state?.state);
    const gustRaw = frame?.gust ?? this._number(gustState?.state) ??
      this._number(state?.attributes?.gusts ?? state?.attributes?.vlagen);
    const directionEntity = this._config?.direction_entity ||
      (this._context?.entity_id || '').replace(/_speed$/, '') + '_wind_direction';
    const cardinal = [frame?.direction, this._hass?.states?.[directionEntity]?.state,
      state?.attributes?.direction, state?.attributes?.cardinal]
      .map(value => this._cardinal(value)).find(Boolean) || '—';
    return {
      raw, gustRaw, unit, gustUnit, cardinal,
      speed: this._knots(raw, unit), gust: this._knots(gustRaw, gustUnit)
    };
  }

  _cardinal(value) {
    const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const degrees = this._number(value);
    if (degrees !== null) return points[Math.round(((degrees % 360 + 360) % 360) / 22.5) % 16];
    const text = String(value ?? '').trim().toUpperCase();
    return points.includes(text) ? text : null;
  }

  _render() {
    if (this.shadowRoot.querySelector('.track')) return;
    // Standard Beaufort knot boundaries, positioned on the same 0–56 kn axis as the markers.
    const boundaries = [0, 1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56];
    const scale = boundaries.slice(0, -1).map((start, force) =>
      `<div class="force" style="width:${(boundaries[force + 1] - start) / 56 * 100}%" title="${force} Bft: ${start}–${boundaries[force + 1]} kn"><span>${force}</span></div>`
    ).join('');
    const knotScale = [0, 10, 20, 30, 40, 50].map(knots =>
      `<span class="knot-value" data-knots="${knots}" style="left:${knots / 56 * 100}%">${knots}</span>`
    ).join('');
    this.shadowRoot.innerHTML = `
      <style>
        /* A Sections row includes the grid gap; HA supplies the feature gap separately. */
        :host{display:flex;align-items:center;width:100%;height:calc(var(--row-height,56px) + var(--row-gap,8px) - var(--ha-card-feature-gap,12px));box-sizing:border-box;color:var(--primary-text-color)}
        .wrap{width:100%;height:100%;flex:none;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;padding:0 2px}
        .labels{flex:none;display:flex;align-items:center;font-size:11px;line-height:12px;white-space:nowrap}
        .scales{flex:none;color:var(--secondary-text-color)}
        .beaufort,.knots{display:flex;height:11px}
        .force{flex:none;box-sizing:border-box;container-type:inline-size;border:1px solid currentColor;border-right:0;border-radius:0;text-align:center;font-size:9px;line-height:9px;overflow:hidden}
        .force:last-child{border-right:1px solid currentColor}
        .force{border-top:0;line-height:10px;transition:background-color 750ms ease-in-out,color 750ms ease-in-out}
        .force.active{background-color:color-mix(in srgb,var(--force-color) 35%,transparent);color:var(--primary-text-color);font-weight:700}
        .knots{position:relative;box-sizing:border-box;font-size:9px;line-height:11px;border-bottom:1px solid currentColor}
        .knot-value{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
        .knot-value:first-child{transform:translateX(1px)}
        @container (max-width:12px){.force span{visibility:hidden}}
        .track{height:9px;flex:none;position:relative;margin:4px 0;overflow:visible;background:${this._gradient()};border-radius:3px}
        .speed-marker,.gust-marker{position:absolute;width:0;height:0;transform:translateX(-50%);border-left:4px solid transparent;border-right:4px solid transparent;transition:left 750ms cubic-bezier(.65,0,.35,1)}
        .speed-marker{top:-4px;border-top:4px solid var(--primary-text-color)}
        .gust-marker{bottom:-4px;border-bottom:4px solid var(--primary-text-color)}
      </style>
      <div class="wrap"><div class="labels"><span class="speed-label">— - — | —</span></div>
      <div class="track" role="img" aria-label="Live wind speed and gust"><span class="speed-marker"></span><span class="gust-marker"></span></div>
      <div class="scales"><div class="knots" role="img" aria-label="Wind speed in knots, marked every 10 knots">${knotScale}</div>
      <div class="beaufort" role="img" aria-label="Beaufort forces 0 through 10 on the 0 to 56 knot scale; force 11 starts at 56 knots">${scale}</div></div></div>`;
  }

  _update() {
    if (!this.isConnected || !this._hass || !this._context?.entity_id) return;
    this._render();
    const next = this._reading();
    const speedLabel = this.shadowRoot.querySelector('.speed-label');
    const speedMarker = this.shadowRoot.querySelector('.speed-marker');
    const gustMarker = this.shadowRoot.querySelector('.gust-marker');
    const track = this.shadowRoot.querySelector('.track');
    if (!speedMarker || !gustMarker || !track) return;
    const speedPercent = next.speed === null ? 0 : Math.max(0, Math.min(100, next.speed / 56 * 100));
    const gustPercent = next.gust === null ? 0 : Math.max(0, Math.min(100, next.gust / 56 * 100));
    speedMarker.style.left = `${speedPercent}%`;
    speedMarker.style.display = next.speed === null ? 'none' : '';
    gustMarker.style.left = `${gustPercent}%`;
    gustMarker.style.display = next.gust === null ? 'none' : '';
    const boundaries = [0, 1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56];
    const force = next.speed === null || next.speed < 0 || next.speed >= 56
      ? -1 : boundaries.findIndex((start, index) => next.speed < boundaries[index + 1]);
    this.shadowRoot.querySelectorAll('.force').forEach((cell, index) => {
      const active = index === force;
      cell.classList.toggle('active', active);
      if (active) {
        cell.style.setProperty('--force-color', this._highlightColor(next.speed));
        cell.setAttribute('aria-current', 'true');
      } else {
        cell.style.removeProperty('--force-color');
        cell.removeAttribute('aria-current');
      }
    });
    track.setAttribute('aria-label',
      `Wind ${next.raw ?? 'unavailable'} ${next.unit}, gust ${next.gustRaw ?? 'unavailable'} ${next.gustUnit}`);

    const format = value => Number.isFinite(value) ? value.toFixed(1) : '—';
    speedLabel.textContent = `${format(next.speed)} - ${format(next.gust)} | ${next.cardinal || '—'}`;
  }
}

customElements.define('wind-live-tile-feature', WindLiveTileFeature);
window.customCardFeatures = window.customCardFeatures || [];
window.customCardFeatures.push({
  type: 'wind-live-tile-feature',
  name: 'Live wind and gusts',
  isSupported: supportsWindLive,
  configurable: true
});

})();
