// Thin React renderer for the chart specs produced by lib/charts.js's
// builders (Phase 4 of the AI Financial Model Report). All layout math
// lives in lib/charts.js - this component only maps the returned
// {type, ...} shape list onto SVG elements, so it stays in lockstep with
// the equally-thin SVG-string renderer inside the PDF-generation Edge
// Function (same shape format, different output target).
function Shape({ s }) {
  if (s.type === 'rect') return <rect x={s.x} y={s.y} width={s.width} height={s.height} fill={s.fill} rx={1} />;
  if (s.type === 'line') return <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.stroke} strokeWidth={s.strokeWidth} />;
  if (s.type === 'circle') return <circle cx={s.cx} cy={s.cy} r={s.r} fill={s.fill} />;
  if (s.type === 'text') {
    var anchor = s.anchor === 'middle' ? 'middle' : s.anchor === 'end' ? 'end' : 'start';
    return <text x={s.x} y={s.y} fontSize={s.fontSize} fill={s.fill} textAnchor={anchor}>{s.text}</text>;
  }
  return null;
}

export default function ChartSvg({ chart, title }) {
  if (!chart || !chart.shapes || !chart.shapes.length) return null;
  return (
    <div style={{ marginBottom: '14px' }}>
      {title && <p style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', margin: '0 0 6px' }}>{title}</p>}
      <svg width="100%" viewBox={'0 0 ' + chart.width + ' ' + chart.height} style={{ display: 'block', maxWidth: chart.width + 'px' }}>
        {chart.shapes.map(function (s, i) { return <Shape key={i} s={s} />; })}
      </svg>
      {!!(chart.legend && chart.legend.length) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '6px' }}>
          {chart.legend.map(function (l, i) {
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: l.color, display: 'inline-block' }} />
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{l.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}