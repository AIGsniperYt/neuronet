let canvas, ctx;
let nodes = [];

const nodeCount = 100;
const maxDist = 150;
const separationStrength = 0.02;
const edgeRepulsionStrength = 0.01;
const edgeBuffer = 50;
const cellSize = maxDist;

let grid = {};
let waves = [];

const mouse = { x: undefined, y: undefined };

class Node {
  constructor() {
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * canvas.height;
    this.vx = (Math.random() - 0.5) * 1.2;
    this.vy = (Math.random() - 0.5) * 1.2;
    this.maxConnections = Math.floor(Math.random() * 3) + 3;
    this.radius = 2 + Math.random() * 2;
    this.energy = 0;
    this.neighbors = [];
  }

  update() {
    let moveX = 0,
      moveY = 0;
    const cellX = Math.floor(this.x / cellSize),
      cellY = Math.floor(this.y / cellSize);
    let nearbyNodes = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cellX + dx},${cellY + dy}`;
        if (grid[key]) nearbyNodes.push(...grid[key]);
      }
    }

    for (let other of nearbyNodes) {
      if (other === this) continue;
      let dx = other.x - this.x,
        dy = other.y - this.y,
        dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.01 && dist < maxDist) {
        let force = separationStrength * (1 / dist) * (1 - dist / maxDist);
        moveX -= dx * force;
        moveY -= dy * force;
      }
    }

    if (this.x < edgeBuffer)
      moveX += edgeRepulsionStrength * (1 - this.x / edgeBuffer);
    if (this.x > canvas.width - edgeBuffer)
      moveX -= edgeRepulsionStrength * ((this.x - (canvas.width - edgeBuffer)) / edgeBuffer);
    if (this.y < edgeBuffer)
      moveY += edgeRepulsionStrength * (1 - this.y / edgeBuffer);
    if (this.y > canvas.height - edgeBuffer)
      moveY -= edgeRepulsionStrength * ((this.y - (canvas.height - edgeBuffer)) / edgeBuffer);

    const randomDrift = 0.02;
    this.vx += moveX + (Math.random() - 0.5) * randomDrift;
    this.vy += moveY + (Math.random() - 0.5) * randomDrift;

    const maxSpeed = 2.2;
    let speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (speed > maxSpeed) {
      this.vx = (this.vx / speed) * maxSpeed;
      this.vy = (this.vy / speed) * maxSpeed;
    }

    // Apply damping so ripples dissipate
    this.vx *= 0.94;
    this.vy *= 0.94;

    this.x += this.vx;
    this.y += this.vy;

    if (this.x < 0) { this.x = 0; this.vx *= -1; }
    if (this.x > canvas.width) { this.x = canvas.width; this.vx *= -1; }
    if (this.y < 0) { this.y = 0; this.vy *= -1; }
    if (this.y > canvas.height) { this.y = canvas.height; this.vy *= -1; }

    this.energy *= 0.92;
  }

  draw() {
    const e = this.energy;

    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * (1 + e * 1.8), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(160, 255, 220, ${0.3 + e * 0.35})`;
    ctx.fill();
  }
}

function resetGrid() {
  grid = {};
}

function cell(x, y) {
  return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
}

function buildGrid() {
  resetGrid();
  nodes.forEach((n) => {
    const k = cell(n.x, n.y);
    if (!grid[k]) grid[k] = [];
    grid[k].push(n);
    n.neighbors = [];
  });
}

function connect() {
  buildGrid();

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const cellX = Math.floor(a.x / cellSize),
      cellY = Math.floor(a.y / cellSize);
    let candidates = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cellX + dx},${cellY + dy}`;
        if (grid[key]) candidates.push(...grid[key]);
      }
    }

    candidates = candidates
      .filter((n) => n !== a)
      .map((b) => {
        const dx = b.x - a.x,
          dy = b.y - a.y,
          dist = Math.sqrt(dx * dx + dy * dy);
        return { node: b, dist };
      });

    let neighbors = candidates.filter((c) => c.dist < maxDist);
    let farNeighbors = candidates.filter(
      (c) => c.dist >= maxDist && c.dist < maxDist * 2
    );

    neighbors.sort((n1, n2) => n1.dist - n2.dist);
    farNeighbors.sort((n1, n2) => n1.dist - n2.dist);

    neighbors = neighbors.slice(0, a.maxConnections);
    if (farNeighbors.length > 0) neighbors.push(farNeighbors[0]);

    for (let { node: b, dist } of neighbors) {
      a.neighbors.push(b);
      const energy = (a.energy + b.energy) / 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `rgba(140, 230, 200, ${0.1 + energy * 0.4})`;
      ctx.lineWidth = 0.8 + energy * 1.5;
      ctx.stroke();
    }
  }
}

function spawnWave(node) {
  waves.push({
    x: node.x,
    y: node.y,
    age: 0,
    strength: 1,
  });
}

function projectWaveOntoEdge(ax, ay, bx, by, cx, cy, r, type) {
  const vx = bx - ax;
  const vy = by - ay;

  let wx, wy;
  if (type === "sweep") {
    wx = cx - ax;
    wy = 0;
  } else if (type === "vertical") {
    wx = 0;
    wy = cy - ay;
  } else {
    wx = cx - ax;
    wy = cy - ay;
  }

  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return null;

  const t = (wx * vx + wy * vy) / len2;

  if (t < 0 || t > 1) return null;

  const px = ax + vx * t;
  const py = ay + vy * t;

  let dist;
  if (type === "sweep") {
    dist = Math.abs(px - cx);
  } else if (type === "vertical") {
    dist = Math.abs(py - cy);
  } else {
    dist = Math.hypot(px - cx, py - cy);
  }

  return dist < 2 ? t : null;
}

function drawField() {
  for (const w of waves) {
    w.age += 1;

    let radius;
    if (w.type === "sweep") {
      radius = w.age * 18.0;
    } else if (w.type === "vertical") {
      radius = w.age * 18.0;
    } else {
      radius = w.age * 3.8;
    }

    nodes.forEach((n) => {
      let dist;
      if (w.type === "sweep") {
        dist = Math.abs(n.x - w.x);
      } else if (w.type === "vertical") {
        dist = Math.abs(n.y - w.y);
      } else {
        const dx = n.x - w.x;
        const dy = n.y - w.y;
        dist = Math.hypot(dx, dy);
      }

      const band = Math.abs(dist - radius);
      const isLinear = w.type === "sweep" || w.type === "vertical";
      const bandLimit = isLinear ? 8 : 12;

      if (band < bandLimit) {
        // Linear waves are softer and less distracting
        const decayRate = isLinear ? 0.003 : 0.01;
        let intensity = (1 - band / bandLimit) * w.strength * Math.exp(-w.age * decayRate);
        
        if (isLinear) intensity *= 0.45; // Soften the global passes

        n.energy = Math.max(n.energy, intensity);

        const neuralRippleForce = intensity * 1.1;
        if (w.type === "sweep") {
          n.vx += (n.x > w.x ? 1 : -1) * neuralRippleForce;
        } else if (w.type === "vertical") {
          n.vy += (n.y > w.y ? 1 : -1) * neuralRippleForce;
        } else {
          // Use existing dx/dy if possible, or recalculate
          const rdx = n.x - w.x;
          const rdy = n.y - w.y;
          const rdist = Math.hypot(rdx, rdy) || 1;
          n.vx += (rdx / rdist) * neuralRippleForce;
          n.vy += (rdy / rdist) * neuralRippleForce;
        }

        n.neighbors.forEach((m) => {
          const ax = n.x;
          const ay = n.y;
          const bx = m.x;
          const by = m.y;

          const t = projectWaveOntoEdge(ax, ay, bx, by, w.x, w.y, radius, w.type);

          if (t !== null) {
            const x = ax + (bx - ax) * t;
            const y = ay + (by - ay) * t;

            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);

            ctx.strokeStyle = `rgba(180, 255, 230, ${intensity * 0.35})`;
            ctx.lineWidth = 1.8;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(x, y, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(160, 255, 220, ${Math.min(0.8, intensity * 0.8)})`;
            ctx.fill();
          }
        });
      }
    });
  }

  waves = waves.filter((w) => {
    const maxAge = (w.type === "sweep" || w.type === "vertical") ? 500 : 220;
    return w.age < maxAge;
  });
}

// ========== PATTERNS ==========

function triggerRadialPulse(originX, originY, strength = 1) {
  console.log(`[Canvas] Radial Pulse at (${originX}, ${originY}) strength: ${strength}`);
  waves.push({
    x: originX,
    y: originY,
    age: 0,
    strength: strength,
  });
}

function triggerSweep(strength = 1) {
  console.log(`[Canvas] Horizontal Sweep strength: ${strength}`);
  waves.push({
    x: 0,
    y: 0,
    age: 0,
    strength: strength,
    type: "sweep",
  });
}

function triggerVerticalWave(strength = 1) {
  waves.push({
    x: canvas.width / 2,
    y: -50,
    age: 0,
    strength: strength,
    type: "vertical",
  });
}

function triggerRandomNodes(count = 5, strength = 1) {
  for (let i = 0; i < count; i++) {
    const node = nodes[Math.floor(Math.random() * nodes.length)];
    if (node) {
      waves.push({
        x: node.x,
        y: node.y,
        age: 0,
        strength: strength,
      });
    }
  }
}

// ========== ANIMATION ==========

let buzzFactor = 0.004;

function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  nodes.forEach((n) => {
    n.update();
    n.draw();
  });

  connect();
  drawField();

  // Spontaneous activity increases with buzzFactor
  if (Math.random() < buzzFactor) {
    spawnWave(nodes[Math.random() * nodes.length | 0]);
  }

  requestAnimationFrame(animate);
}

function initCanvas() {
  canvas = document.getElementById("neuronet");
  if (!canvas) {
    setTimeout(initCanvas, 100);
    return;
  }
  ctx = canvas.getContext("2d");

  function resize() {
    canvas.width = innerWidth;
    canvas.height = innerHeight;

    nodes = [];
    for (let i = 0; i < nodeCount; i++) nodes.push(new Node());
    waves = [];
  }

  window.addEventListener("resize", resize);
  resize();

  setTimeout(() => {
    if (window.__neuronetCanvas) {
      window.__neuronetCanvas.triggerRadialPulse(canvas.width / 2, canvas.height / 2, 2.5);
      window.__neuronetCanvas.triggerRandomNodes(10, 0.6);
    }
  }, 500);

  animate();
}

// ========== PUBLIC API ==========

window.__neuronetCanvas = {
  triggerRadialPulse,
  triggerSweep,
  triggerVerticalWave,
  triggerRandomNodes,
  setBuzz: (factor) => { buzzFactor = factor; },
  getCanvas: () => canvas,
  getCtx: () => ctx,
  getNodes: () => nodes,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCanvas);
} else {
  initCanvas();
}