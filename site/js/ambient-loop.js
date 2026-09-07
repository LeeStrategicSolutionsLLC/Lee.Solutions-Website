/* The ambient loop — the brand's grid / node / connector language, moving slowly
   enough that you notice it only if you look for it. Five motions share one 13s
   period so the composition is seamless. Ported 1:1 from the design system's
   AmbientLoop.jsx (React) to vanilla DOM/SVG for the production build. */
(function (global) {
  'use strict';

  var W = 1440, H = 900, PITCH = 24, DURATION = 13;

  var PATHS = [
    'M -24 672 C 336 672, 408 312, 744 312 S 1152 600, 1464 600',
    'M -24 216 C 240 216, 312 528, 672 528 S 1104 240, 1464 240',
    'M 240 924 C 240 696, 528 624, 744 624 S 960 408, 960 -24',
    'M 1464 792 C 1128 792, 1032 456, 744 456 S 336 168, 96 -24'
  ];

  var NODES = [
    { x: 744, y: 312, kind: 'open', r: 4.5 },
    { x: 672, y: 528, kind: 'open', r: 4.5 },
    { x: 744, y: 624, kind: 'open', r: 4 },
    { x: 336, y: 672, kind: 'open', r: 4 },
    { x: 1104, y: 240, kind: 'open', r: 4.5 },
    { x: 744, y: 456, kind: 'open', r: 4 },
    { x: 1032, y: 456, kind: 'dot', r: 2 },
    { x: 456, y: 744, kind: 'dot', r: 2 },
    { x: 960, y: 168, kind: 'term', r: 5 },
    { x: 1152, y: 600, kind: 'term', r: 5 }
  ];

  var SVGNS = 'http://www.w3.org/2000/svg';
  function el(name, attrs) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function renderAmbientLoop(container, opts) {
    opts = opts || {};
    var intensity = opts.intensity != null ? opts.intensity : 1;
    var paused = !!opts.paused;
    var lineColor = opts.lineColor || 'var(--sage-500)';
    var nodeColor = opts.nodeColor || 'var(--champagne-500)';
    var gridColor = opts.gridColor || 'rgba(216,198,165,0.09)';
    var k = Math.max(0, Math.min(1.6, intensity));

    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: '100%',
      preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true', class: 'lee-amb' + (paused ? ' paused' : '')
    });

    var gridGroup = el('g', { class: 'lee-amb-weight' });
    var grid = el('g', { class: 'lee-amb-grid', stroke: gridColor, 'stroke-width': '1', opacity: String(k) });
    for (var x = -PITCH; x <= W + PITCH; x += PITCH) grid.appendChild(el('line', { x1: x, y1: 0, x2: x, y2: H }));
    for (var y = 0; y <= H; y += PITCH) grid.appendChild(el('line', { x1: -PITCH, y1: y, x2: W + PITCH, y2: y }));
    gridGroup.appendChild(grid);
    svg.appendChild(gridGroup);

    var lines = el('g', { fill: 'none', stroke: lineColor, 'stroke-linecap': 'round' });
    PATHS.forEach(function (p, i) {
      lines.appendChild(el('path', { d: p, 'stroke-width': '1', opacity: String(0.19 * k) }));
    });
    var travellers = [];
    PATHS.forEach(function (p, i) {
      travellers.push({ p: p, dash: '110 560', color: i % 2 === 1 ? nodeColor : lineColor, op: 0.44, delay: -(i * DURATION) / PATHS.length });
      travellers.push({ p: p, dash: '54 616', color: nodeColor, op: 0.3, delay: -((i + 0.5) * DURATION) / PATHS.length });
    });
    travellers.forEach(function (t) {
      var path = el('path', {
        class: 'lee-amb-travel', d: t.p, 'stroke-width': '1.5', stroke: t.color,
        'stroke-dasharray': t.dash, opacity: String(t.op * k)
      });
      path.style.animationDelay = t.delay + 's';
      lines.appendChild(path);
    });
    svg.appendChild(lines);

    var nodesGroup = el('g', {});
    NODES.forEach(function (n, i) {
      var floatG = el('g', { class: i % 2 ? 'lee-amb-float-b' : 'lee-amb-float-a' });
      floatG.style.animationDelay = (-(i * DURATION) / NODES.length) + 's';
      var depthG = el('g', { class: 'lee-amb-node' });
      depthG.style.transformBox = 'view-box';
      depthG.style.transformOrigin = n.x + 'px ' + n.y + 'px';
      depthG.style.animationDelay = (-((i * 1.7) % NODES.length * DURATION) / NODES.length) + 's';
      var shape;
      if (n.kind === 'term') {
        shape = el('rect', { x: n.x - n.r, y: n.y - n.r, width: n.r * 2, height: n.r * 2, fill: nodeColor, opacity: String(0.78 * k) });
      } else if (n.kind === 'dot') {
        shape = el('circle', { cx: n.x, cy: n.y, r: n.r, fill: nodeColor, opacity: String(0.7 * k) });
      } else {
        shape = el('circle', { cx: n.x, cy: n.y, r: n.r, fill: 'none', stroke: nodeColor, 'stroke-width': '1.25', opacity: String(0.66 * k) });
      }
      depthG.appendChild(shape);
      floatG.appendChild(depthG);
      nodesGroup.appendChild(floatG);
    });
    svg.appendChild(nodesGroup);

    container.appendChild(svg);
    return svg;
  }

  global.renderAmbientLoop = renderAmbientLoop;
})(window);
