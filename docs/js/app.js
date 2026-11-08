// ============ colour palettes ============
const PAL = {
  inferno: ['#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#fcffa4'],
  green:   ['#f7fcb9', '#addd8e', '#41ab5d', '#006837'],
  heat:    ['#fff7ec', '#fdbb84', '#e34a33', '#7f0000'],
  div:     ['#2166ac', '#67a9cf', '#f7f7f7', '#ef8a62', '#b2182b'],
};

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

function colorAt(pal, t) {
  t = Math.max(0, Math.min(1, t));
  const s = pal.map(hexToRgb);
  const x = t * (s.length - 1);
  const i = Math.min(Math.floor(x), s.length - 2);
  const f = x - i;
  const c = s[i].map((v, k) => Math.round(v + (s[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const fmt = (v, d = 2) => (v === null || v === undefined || isNaN(v)) ? '–' : Number(v).toFixed(d);

// ============ map layer settings ============
const LAYERS = {
  lst:   { label: 'Observed LST (°C)',         pal: PAL.inferno, min: 38,    max: 56,  d: 0, get: (c, y) => c.lst[y] },
  ndvi:  { label: 'NDVI (avg 2020–25)',        pal: PAL.green,   min: 0,     max: 0.6, d: 1, get: c => c.ndvi },
  ndbi:  { label: 'NDBI (avg 2020–25)',        pal: PAL.heat,    min: -0.15, max: 0.1, d: 2, get: c => c.ndbi },
  built: { label: 'Built-up fraction',         pal: PAL.heat,    min: 0,     max: 1,   d: 1, get: c => c.built },
  resid: { label: 'RF error, actual − predicted (°C)', pal: PAL.div, min: -3, max: 3,  d: 0, get: c => c.resid_rf },
};

let DATA = {}, YEARS = [], HOT = [], rects = [], map, modelChart, scatterChart;
const $ = id => document.getElementById(id);

// ============ load data ============
Promise.all(['data/cells.json', 'data/metrics.json', 'data/scatter.json']
  .map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); })))
  .then(([cells, metrics, scatter]) => {
    DATA = { cells: cells.cells, metrics, scatter };
    YEARS = cells.years;
    computeHotThresholds();
    renderDataStats();
    renderModelChart();
    renderTestTable();
    renderDiffText();
    initMap();
    renderScatter();
    renderImportance();
    renderCoefs();
    renderHotspotText();
    renderErrorTables();
  })
  .catch(err => {
    document.querySelector('main').insertAdjacentHTML('afterbegin',
      `<p class="lead">Could not load data (${err.message}). If you opened this file directly, run a local server instead (see README).</p>`);
  });

// ============ data section ============
function renderDataStats() {
  const d = DATA.metrics.data;
  const imgs = Object.entries(d.images_per_year).map(([y, n]) => `${y}: ${n}`).join(' · ');
  const items = [
    ['Grid cells', d.cells.toLocaleString(), '300 m × 300 m each'],
    ['Rows after cleaning', d.rows_clean.toLocaleString(), `from ${d.rows_raw.toLocaleString()} raw rows`],
    ['Years', `${d.years[0]}–${d.years[d.years.length - 1]}`, 'April–June composites'],
    ['Clear Landsat scenes', Object.values(d.images_per_year).reduce((a, b) => a + b, 0), imgs],
  ];
  $('dataStats').innerHTML = items.map(([t, v, s]) =>
    `<div class="card"><b>${t}</b><span class="big">${v}</span><span class="note">${s}</span></div>`).join('');
}

// ============ tables ============
function makeTable(rows, cols, bestIndex = -1) {
  const head = cols.map(c => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('');
  const body = rows.map((r, i) => `<tr class="${i === bestIndex ? 'best' : ''}">` +
    cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.f ? c.f(r[c.key], r, i) : r[c.key]}</td>`).join('') +
    '</tr>').join('');
  return `<table><tr>${head}</tr>${body}</table>`;
}

function bestByMAE(rows) {
  let b = 0; rows.forEach((r, i) => { if (r.MAE < rows[b].MAE) b = i; }); return b;
}

function renderTestTable() {
  const rows = DATA.metrics.test;
  const ci = DATA.metrics.test_mae_ci95;
  const ciArr = [ci.baseline, ci.lr, ci.rf];
  $('testTable').innerHTML = '<p class="note">Final scores on the held-out test blocks (evaluated once):</p>' +
    makeTable(rows, [
      { label: 'Model', key: 'model' },
      { label: 'MAE (°C)', key: 'MAE', num: true, f: v => fmt(v, 3) },
      { label: 'MAE 95% interval', key: 'MAE', num: true, f: (v, r, i) => `${fmt(ciArr[i][0])} – ${fmt(ciArr[i][1])}` },
      { label: 'RMSE (°C)', key: 'RMSE', num: true, f: v => fmt(v, 3) },
      { label: 'R²', key: 'R2', num: true, f: v => fmt(v, 3) },
    ], bestByMAE(rows));
}

function renderDiffText() {
  const d = DATA.metrics.lr_minus_rf_mae;
  $('diffText').textContent =
    `Random Forest's test MAE is lower than Linear Regression's by ${fmt(d.mean, 3)} °C ` +
    `(95% block-bootstrap interval ${fmt(d.ci95[0], 3)} to ${fmt(d.ci95[1], 3)} °C). ` +
    `The interval excludes zero, so the advantage is consistent, but it is small in practical terms.`;
}

// ============ model comparison chart ============
function renderModelChart() {
  const set = $('evalSelect').value, metric = $('metricSelect').value;
  const rows = DATA.metrics[set];
  const unit = metric === 'R2' ? '' : ' (°C)';
  if (modelChart) modelChart.destroy();
  modelChart = new Chart($('modelChart'), {
    type: 'bar',
    data: {
      labels: rows.map(r => r.model),
      datasets: [{ data: rows.map(r => r[metric]), backgroundColor: ['#a8a29e', '#60a5fa', '#c2410c'] }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: `${metric}${unit}: ${set === 'test' ? 'held-out test blocks' : '5-fold grouped CV on training blocks'}` + (metric === 'R2' ? ' (higher is better)' : ' (lower is better)') },
        tooltip: { callbacks: { label: ctx => {
          const r = rows[ctx.dataIndex];
          const sd = r[`${metric}_sd`];
          return `${metric}: ${fmt(r[metric], 3)}` + (sd !== undefined ? ` ± ${fmt(sd, 3)} across folds` : '');
        } } },
      },
      scales: { y: { beginAtZero: true, title: { display: true, text: metric + unit } } },
    },
  });
}
$('evalSelect').addEventListener('change', renderModelChart);
$('metricSelect').addEventListener('change', renderModelChart);

// ============ map ============
function computeHotThresholds() {
  HOT = YEARS.map((_, y) => {
    const v = DATA.cells.map(c => c.lst[y]).filter(x => x !== null).sort((a, b) => a - b);
    return v[Math.floor(0.9 * (v.length - 1))];
  });
}

function initMap() {
  map = L.map('map', { preferCanvas: true }).setView([23.025, 72.6], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors', maxZoom: 18,
    }).addTo(map);

  const renderer = L.canvas({ padding: 0.5 });
  DATA.cells.forEach(c => {
    const dLat = 160 / 111320;
    const dLon = 160 / (111320 * Math.cos(c.lat * Math.PI / 180));
    const r = L.rectangle([[c.lat - dLat, c.lon - dLon], [c.lat + dLat, c.lon + dLon]],
      { renderer, weight: 0, fillOpacity: 0.8 }).addTo(map);
    r.cell = c;
    r.on('click', () => L.popup().setLatLng([c.lat, c.lon]).setContent(popupHtml(c)).openOn(map));
    rects.push(r);
  });

  $('layerSelect').addEventListener('change', styleCells);
  $('yearSlider').addEventListener('input', styleCells);
  styleCells();
}

function styleCells() {
  const layer = $('layerSelect').value, y = +$('yearSlider').value;
  $('yearWrap').style.display = (layer === 'lst' || layer === 'hot') ? '' : 'none';
  $('yearLabel').textContent = YEARS[y];

  rects.forEach(r => {
    const c = r.cell;
    let color = '#000', op = 0.8;
    if (layer === 'hot') {
      const v = c.lst[y];
      if (v === null) op = 0;
      else if (v >= HOT[y]) { color = '#b91c1c'; op = 0.9; }
      else { color = '#d6d3d1'; op = 0.45; }
    } else if (layer === 'split') {
      color = c.split === 'test' ? '#f97316' : '#60a5fa'; op = 0.6;
    } else {
      const L_ = LAYERS[layer], v = L_.get(c, y);
      if (v === null) {
        if (layer === 'resid') { color = '#a8a29e'; op = 0.15; } else op = 0;
      } else color = colorAt(L_.pal, (v - L_.min) / (L_.max - L_.min));
    }
    r.setStyle({ fillColor: color, fillOpacity: op, weight: 0 });
  });
  renderLegend(layer, y);
}

function renderLegend(layer, y) {
  let h;
  if (layer === 'hot') {
    h = `<span><i class="swatch" style="background:#b91c1c"></i>Hottest 10% in ${YEARS[y]} (≥ ${fmt(HOT[y], 1)} °C)</span>
         <span><i class="swatch" style="background:#d6d3d1"></i>Other cells</span>`;
  } else if (layer === 'split') {
    h = `<span><i class="swatch" style="background:#60a5fa"></i>Training blocks</span>
         <span><i class="swatch" style="background:#f97316"></i>Held-out test blocks</span>`;
  } else {
    const L_ = LAYERS[layer];
    h = `<span>${L_.label}${L_.get.length > 1 ? ', ' + YEARS[y] : ''}</span>
         <span>${fmt(L_.min, L_.d)}</span>
         <div class="bar" style="background:linear-gradient(to right, ${L_.pal.join(',')})"></div>
         <span>${fmt(L_.max, L_.d)}</span>` +
      (layer === 'resid' ? '<span>Red = hotter than predicted · Blue = cooler · Grey = training area</span>' : '');
  }
  $('legend').innerHTML = h;
}

function popupHtml(c) {
  const y = +$('yearSlider').value;
  const vals = c.lst.filter(v => v !== null);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  let h = `<b>Cell ${c.id}</b> (${c.split} set)<br>
    LST ${YEARS[y]}: <b>${fmt(c.lst[y], 1)} °C</b> · 2020–25 avg: ${fmt(avg, 1)} °C<br>
    NDVI ${fmt(c.ndvi, 3)} · NDBI ${fmt(c.ndbi, 3)} · NDWI ${fmt(c.ndwi, 3)}<br>
    Built ${fmt(c.built * 100, 0)}% · Tree ${fmt(c.tree * 100, 0)}% · Water ${fmt(c.water * 100, 0)}%`;
  if (c.split === 'test') {
    h += `<br><b>Random Forest (avg over years)</b><br>
      Predicted ${fmt(c.pred_rf, 1)} °C · Error ${c.resid_rf > 0 ? '+' : ''}${fmt(c.resid_rf, 2)} °C`;
  }
  return h;
}

// ============ relationship explorer ============
function pearson(pts) {
  const n = pts.length, mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  pts.forEach(p => { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; });
  const slope = sxy / sxx;
  return { r: sxy / Math.sqrt(sxx * syy), slope, intercept: my - slope * mx };
}

function renderScatter() {
  const feat = $('featureSelect').value;
  const pts = DATA.scatter.map(d => ({ x: d[feat], y: d.LST }));
  const s = pearson(pts);
  const xs = pts.map(p => p.x), xmin = Math.min(...xs), xmax = Math.max(...xs);
  const line = [{ x: xmin, y: s.intercept + s.slope * xmin }, { x: xmax, y: s.intercept + s.slope * xmax }];
  $('corrText').textContent = `Correlation with LST: r = ${fmt(s.r)} (straight-line fit shown)`;

  if (scatterChart) scatterChart.destroy();
  scatterChart = new Chart($('scatterChart'), {
    type: 'scatter',
    data: { datasets: [
      { data: pts, pointRadius: 2, backgroundColor: 'rgba(194,65,12,0.3)' },
      { type: 'line', data: line, borderColor: '#1c1917', borderWidth: 2, pointRadius: 0 },
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false } },
      scales: { x: { title: { display: true, text: feat } }, y: { title: { display: true, text: 'LST (°C)' } } },
    },
  });
}
$('featureSelect').addEventListener('change', renderScatter);

// ============ feature importance and coefficients ============
function horizontalBar(canvasId, labels, values, colors, title, xTitle) {
  new Chart($(canvasId), {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, title: { display: true, text: title } },
      scales: { x: { title: { display: true, text: xTitle } } },
    },
  });
}

function renderImportance() {
  const imp = [...DATA.metrics.rf_importance].sort((a, b) => b.MAE_increase - a.MAE_increase);
  horizontalBar('importanceChart', imp.map(r => r.feature), imp.map(r => r.MAE_increase),
    '#c2410c', 'Random Forest: permutation importance', 'Increase in test MAE (°C)');
}

function renderCoefs() {
  const co = [...DATA.metrics.lr_coefficients].sort((a, b) => b.coef_per_SD - a.coef_per_SD);
  horizontalBar('coefChart', co.map(r => r.feature), co.map(r => r.coef_per_SD),
    co.map(r => r.coef_per_SD > 0 ? '#dc2626' : '#2563eb'),
    'Linear Regression: standardised coefficients', '°C per 1 SD increase');
}

// ============ hotspots and errors ============
function renderHotspotText() {
  const h = DATA.metrics.hotspot_recall;
  const get = name => h.find(r => r.model === name);
  const rf = get('Random Forest'), lr = get('Linear Regression');
  $('hotspotText').innerHTML =
    `For each year, we checked how many of the truly hottest 10% of test cells the model also ranks in its own top 10%. ` +
    `Random Forest finds <b>${fmt(rf.mean * 100, 0)}%</b> of them (range ${fmt(rf.min * 100, 0)}–${fmt(rf.max * 100, 0)}% across years), ` +
    `and Linear Regression finds <b>${fmt(lr.mean * 100, 0)}%</b>. Random guessing would find about 10%. ` +
    `The model is a useful first filter for candidate hotspots, but it misses nearly half of them.`;
}

function renderErrorTables() {
  const cols = first => [
    { label: first[0], key: first[1] },
    { label: 'Cells', key: 'n', num: true },
    { label: 'MAE (°C)', key: 'MAE', num: true, f: v => fmt(v) },
    { label: 'Mean error (°C)', key: 'mean_resid', num: true, f: v => (v > 0 ? '+' : '') + fmt(v) },
  ];
  $('errLstTable').innerHTML = makeTable(DATA.metrics.error_by_lst_range, cols(['Actual LST (°C)', 'LST_bin'])) +
    '<p class="note">Mean error = actual − predicted. Positive means the model predicted too cool.</p>';
  const lc = [...DATA.metrics.error_by_landcover].sort((a, b) => b.n - a.n);
  $('errLcTable').innerHTML = makeTable(lc, cols(['Dominant cover', 'dominant']));
}