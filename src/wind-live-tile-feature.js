/* Live speed and gust bar for Home Assistant wind-speed tiles. */
const WIND_LIVE_COLORS = [
  '#9700ff', '#6400ff', '#3200ff', '#0032ff', '#0064ff', '#0096ff', '#00c7ff',
  '#00e6f0', '#25c192', '#11d411', '#00e600', '#00fa00', '#b8ff61', '#fffe00',
  '#ffe100', '#ffc800', '#ffaf00', '#ff9600', '#e67d00', '#e66400', '#dc4a1d',
  '#c8321d', '#b4191d', '#aa001d', '#b40032', '#c80064', '#fe0096'
];
const WIND_LIVE_GRADIENT = `linear-gradient(90deg, ${WIND_LIVE_COLORS.map((color, index) =>
  `${color} ${Math.min(100, index * 2 / 56 * 100).toFixed(2)}%`).join(', ')}, ${WIND_LIVE_COLORS.at(-1)} 100%)`;

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
    this._config = config;
    this._render();
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
        .force{flex:none;box-sizing:border-box;container-type:inline-size;border:1px solid var(--divider-color,rgba(127,127,127,.25));border-right:0;border-radius:0;text-align:center;font-size:9px;line-height:9px;overflow:hidden}
        .force:last-child{border-right:1px solid var(--divider-color,rgba(127,127,127,.25))}
        .force{border-top:0;line-height:10px;transition:background-color 750ms ease-in-out,color 750ms ease-in-out}
        .force.active{background-color:color-mix(in srgb,var(--force-color) 35%,transparent);color:var(--primary-text-color);font-weight:700}
        .knots{position:relative;box-sizing:border-box;font-size:9px;line-height:11px;border-bottom:1px solid var(--divider-color,rgba(127,127,127,.25))}
        .knot-value{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
        .knot-value:first-child{transform:translateX(1px)}
        @container (max-width:12px){.force span{visibility:hidden}}
        .track{height:9px;flex:none;position:relative;margin:4px 0;overflow:visible;background:${WIND_LIVE_GRADIENT};border-radius:3px}
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
        cell.style.setProperty('--force-color', WIND_LIVE_COLORS[Math.max(0, Math.min(
          WIND_LIVE_COLORS.length - 1, Math.floor(next.speed / 2)))]);
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
