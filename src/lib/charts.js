// Pure, framework-free SVG chart-spec builders for the AI Financial Model
// Report (Phase 4). Each builder takes plain numeric data and returns
// { width, height, shapes, legend } - a list of drawable primitives
// (rect/line/circle/text) with no JSX/DOM/Canvas dependency, so the exact
// same function runs in the browser bundle (rendered by ChartSvg.jsx) and
// can be pasted verbatim into the generate-financial-report-pdf Edge
// Function, whose own thin renderer turns the same shapes into an SVG
// string for the PDF's HTML. Keep the two renderers thin and this file as
// the single source of truth for layout math - see ChartSvg.jsx's header.

var PALETTE = {
  revenue: '#2563eb',
  ebitda: '#16a34a',
  pat: '#7c3aed',
  cogs: '#dc2626',
  opex: '#f59e0b',
  axis: '#94a3b8',
  grid: '#e2e8f0',
  text: '#475569',
};

function fmtAxisNum(n) {
  if (Math.abs(n) >= 100) return Math.round(n).toString();
  return (Math.round(n * 10) / 10).toString();
}

// Grouped bar chart: Revenue / EBITDA / PAT across Current + N projected
// years. data.years: rows from lib/financialModel.js's buildYearSeries().
export function buildTrendBarChart(data, opts) {
  var years = (data && data.years) || [];
  var W = (opts && opts.width) || 480;
  var H = (opts && opts.height) || 220;
  var padL = 44, padR = 12, padT = 14, padB = 30;
  var plotW = W - padL - padR, plotH = H - padT - padB;
  var shapes = [];
  if (!years.length) return { width: W, height: H, shapes: shapes, legend: [] };

  var maxVal = 0;
  years.forEach(function (y) { maxVal = Math.max(maxVal, y.rev, y.ebitda, Math.abs(y.pat)); });
  maxVal = maxVal <= 0 ? 1 : maxVal * 1.15;

  var gridLines = 4;
  for (var g = 0; g <= gridLines; g++) {
    var gv = (maxVal / gridLines) * g;
    var gy = padT + plotH - (gv / maxVal) * plotH;
    shapes.push({ type: 'line', x1: padL, y1: gy, x2: padL + plotW, y2: gy, stroke: PALETTE.grid, strokeWidth: 1 });
    shapes.push({ type: 'text', x: padL - 6, y: gy + 3, text: fmtAxisNum(gv), fontSize: 8, fill: PALETTE.text, anchor: 'end' });
  }

  var groupW = plotW / years.length;
  var barW = Math.min(14, groupW / 5);
  var series = ['rev', 'ebitda', 'pat'];
  var colors = [PALETTE.revenue, PALETTE.ebitda, PALETTE.pat];

  years.forEach(function (y, i) {
    var groupX = padL + i * groupW + groupW / 2;
    series.forEach(function (key, si) {
      var val = y[key];
      var barH = (Math.max(val, 0) / maxVal) * plotH;
      var bx = groupX - barW * 1.5 + si * (barW + 3);
      var by = padT + plotH - barH;
      shapes.push({ type: 'rect', x: bx, y: by, width: barW, height: Math.max(barH, 0), fill: colors[si] });
    });
    shapes.push({ type: 'text', x: groupX, y: padT + plotH + 14, text: y.label, fontSize: 9, fill: PALETTE.text, anchor: 'middle' });
  });

  shapes.push({ type: 'line', x1: padL, y1: padT + plotH, x2: padL + plotW, y2: padT + plotH, stroke: PALETTE.axis, strokeWidth: 1 });

  return {
    width: W, height: H, shapes: shapes,
    legend: [
      { label: 'Revenue', color: PALETTE.revenue },
      { label: 'EBITDA', color: PALETTE.ebitda },
      { label: 'PAT', color: PALETTE.pat },
    ],
  };
}

// Margin trend line chart: EBITDA% and PAT% across the same year rows.
export function buildMarginLineChart(data, opts) {
  var years = (data && data.years) || [];
  var W = (opts && opts.width) || 480;
  var H = (opts && opts.height) || 200;
  var padL = 36, padR = 12, padT = 14, padB = 28;
  var plotW = W - padL - padR, plotH = H - padT - padB;
  var shapes = [];
  if (!years.length) return { width: W, height: H, shapes: shapes, legend: [] };

  var allVals = [];
  years.forEach(function (y) { allVals.push(y.ebitdaPct, y.patPct); });
  var minV = Math.min(0, Math.min.apply(null, allVals));
  var maxV = Math.max.apply(null, allVals);
  maxV = maxV <= minV ? minV + 1 : maxV * 1.15;
  var range = maxV - minV || 1;

  var gridLines = 4;
  for (var g = 0; g <= gridLines; g++) {
    var gv = minV + (range / gridLines) * g;
    var gy = padT + plotH - ((gv - minV) / range) * plotH;
    shapes.push({ type: 'line', x1: padL, y1: gy, x2: padL + plotW, y2: gy, stroke: PALETTE.grid, strokeWidth: 1 });
    shapes.push({ type: 'text', x: padL - 6, y: gy + 3, text: fmtAxisNum(gv) + '%', fontSize: 8, fill: PALETTE.text, anchor: 'end' });
  }

  function pointsFor(key) {
    return years.map(function (y, i) {
      var x = padL + (years.length === 1 ? plotW / 2 : (plotW * i) / (years.length - 1));
      var yv = padT + plotH - ((y[key] - minV) / range) * plotH;
      return [x, yv];
    });
  }

  [['ebitdaPct', PALETTE.ebitda], ['patPct', PALETTE.pat]].forEach(function (pair) {
    var pts = pointsFor(pair[0]);
    for (var i = 0; i < pts.length - 1; i++) {
      shapes.push({ type: 'line', x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1], stroke: pair[1], strokeWidth: 2 });
    }
    pts.forEach(function (p) { shapes.push({ type: 'circle', cx: p[0], cy: p[1], r: 3, fill: pair[1] }); });
  });

  years.forEach(function (y, i) {
    var x = padL + (years.length === 1 ? plotW / 2 : (plotW * i) / (years.length - 1));
    shapes.push({ type: 'text', x: x, y: padT + plotH + 14, text: y.label, fontSize: 9, fill: PALETTE.text, anchor: 'middle' });
  });

  shapes.push({ type: 'line', x1: padL, y1: padT + plotH, x2: padL + plotW, y2: padT + plotH, stroke: PALETTE.axis, strokeWidth: 1 });

  return {
    width: W, height: H, shapes: shapes,
    legend: [{ label: 'EBITDA margin', color: PALETTE.ebitda }, { label: 'PAT margin', color: PALETTE.pat }],
  };
}

// Horizontal stacked bar: current-year cost structure as % of revenue
// (COGS / Opex / EBITDA). Deliberately a stacked bar rather than a donut -
// no arc-path trig to keep in sync across the React and Deno renderers.
export function buildCostStructureBar(data, opts) {
  var cogsPct = (data && data.cogsPct) || 0;
  var opexPct = (data && data.opexPct) || 0;
  var ebitdaPct = (data && data.ebitdaPct) || 0;
  var W = (opts && opts.width) || 480;
  var H = (opts && opts.height) || 46;
  var total = cogsPct + opexPct + ebitdaPct;
  if (total <= 0) total = 1;
  var barY = 6, barH = 24;
  var segs = [
    { key: 'COGS', val: cogsPct, color: PALETTE.cogs },
    { key: 'Opex', val: opexPct, color: PALETTE.opex },
    { key: 'EBITDA', val: ebitdaPct, color: PALETTE.ebitda },
  ];
  var shapes = [];
  var x = 0;
  segs.forEach(function (s) {
    var w = (Math.max(s.val, 0) / total) * W;
    shapes.push({ type: 'rect', x: x, y: barY, width: w, height: barH, fill: s.color });
    if (w > 26) {
      shapes.push({ type: 'text', x: x + w / 2, y: barY + barH / 2 + 4, text: Math.round(s.val) + '%', fontSize: 9, fill: '#ffffff', anchor: 'middle' });
    }
    x += w;
  });
  return {
    width: W, height: H, shapes: shapes,
    legend: segs.map(function (s) { return { label: s.key + ' (' + Math.round(s.val) + '%)', color: s.color }; }),
  };
}