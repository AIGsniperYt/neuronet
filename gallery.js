/* Generated into /showcase/gallery.js by scripts/build-showcase.mjs. */

/* ============================================================
   HEADER SCROLL EFFECT
   ============================================================ */
const header = document.getElementById('header');
const progressBar = document.getElementById('scrollProgress');

window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? (scrollY / docHeight) * 100 : 0;
    progressBar.style.width = progress + '%';
    header.classList.toggle('scrolled', scrollY > 60);

    document.querySelectorAll('.parallax-slow, .parallax-medium').forEach(el => {
        const speed = parseFloat(el.dataset.speed) || -0.05;
        const rect = el.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const viewCenter = window.innerHeight / 2;
        const offset = (center - viewCenter) * speed;
        el.style.transform = `translateY(${offset}px)`;
    });
});

let themeRgb = '76,255,154';
function refreshThemeRgb() {
    themeRgb = getComputedStyle(document.documentElement).getPropertyValue('--emerald-rgb').trim() || '76,255,154';
}
refreshThemeRgb();

/* ============================================================
   STARFIELD
   ============================================================ */
(function initStarfield() {
    const s = document.getElementById('neuralCanvas');
    const sctx = s.getContext('2d');
    if (!sctx) return;

    let stars = [];
    let connections = [];
    let time = 0;
    let lastStreak = Date.now();
    let activeStreak = null;
    let lastMicroFlare = Date.now();
    let initialized = false;
    let heroRevealTime = -1;
    let cursorX = -1, cursorY = -1;
    let trailParticles = [];
    let lastTrailSpawn = 0;

    const LAYERS = [
        { label:'far',  parallax:[0.0,0.12],  size:[0.8,1.5],    baseA:[0.30,0.45],   weight:0.30, edgeBoost:1.4, twinkle:[0.1,0.6] },
        { label:'mid',  parallax:[0.18,0.38], size:[1.2,2.0],    baseA:[0.45,0.60],   weight:0.30, edgeBoost:1.3, twinkle:[0.3,1.0] },
        { label:'near', parallax:[0.45,0.70], size:[1.8,3.2],    baseA:[0.60,0.80],   weight:0.25, edgeBoost:1.2, twinkle:[0.5,1.3] },
        { label:'fore', parallax:[0.80,1.25], size:[3.0,5.5],    baseA:[0.80,1.00],   weight:0.15, edgeBoost:1.1, twinkle:[0.6,1.5] },
    ];

    function rand(a, b) { return a + Math.random() * (b - a); }

    function getDocHeight() {
        return Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight,
            document.documentElement.offsetHeight,
            document.body.offsetHeight
        );
    }

    function generate() {
        stars = [];
        connections = [];
        const w = window.innerWidth;
        const h = getDocHeight();
        s.width = w;
        s.height = window.innerHeight;
        s.style.width = w + 'px';
        s.style.height = window.innerHeight + 'px';

        const cellW = 98, cellH = 98;
        const cols = Math.ceil(w / cellW);
        const rows = Math.ceil(h / cellH);

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                let roll = Math.random(), layer;
                for (let l of LAYERS) {
                    roll -= l.weight;
                    if (roll <= 0) { layer = l; break; }
                }
                if (!layer) layer = LAYERS[LAYERS.length - 1];

                const x = (c + 0.5) * cellW + (Math.random() - 0.5) * cellW * 0.7;
                const y = (r + 0.5) * cellH + (Math.random() - 0.5) * cellH * 0.7;
                const isEdge = x < w * 0.08 || x > w * 0.92;

                const baseA = isEdge ? layer.baseA[1] * rand(1, layer.edgeBoost) : rand(...layer.baseA);
                stars.push({
                    x, y,
                    parallax: rand(...layer.parallax),
                    r: isEdge ? layer.size[1] * rand(1, layer.edgeBoost) : rand(...layer.size),
                    baseA,
                    currentA: baseA * 0.4,
                    isLit: false,
                    revealed: false,
                    glow: 0,
                    glowTarget: 0,
                    flash: 0,
                    litTime: -1,
                    inBand: false,
                    scrollPhase: (Math.random() - 0.5) * 180,
                    twinkleSpeed: rand(...layer.twinkle),
                    twinklePhase: Math.random() * Math.PI * 2,
                });
            }
        }

        for (let i = 0; i < stars.length; i++) {
            for (let j = i + 1; j < stars.length; j++) {
                const a = stars[i], b = stars[j];
                if (Math.abs(a.parallax - b.parallax) > 0.35) continue;
                const aEdge = a.x < w * 0.1 || a.x > w * 0.9;
                const bEdge = b.x < w * 0.1 || b.x > w * 0.9;
                if (aEdge !== bEdge) continue;
                const dy = a.y - b.y;
                if (Math.abs(dy) > 240) continue;
                const dx = a.x - b.x;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const maxD = aEdge ? 170 : 130;
                if (dist < maxD && dist > 8) {
                    connections.push({ a, b, dist, maxDist: maxD });
                }
            }
        }
        initialized = true;
    }

    function startInitSpread() {
        const vh = window.innerHeight;
        const viewCenter = vh / 2;
        const sorted = stars.map(st => ({
            st,
            dist: Math.abs(st.y - viewCenter) + (Math.random() - 0.5) * vh * 0.35
        })).sort((a, b) => a.dist - b.dist);
        let idx = 0;
        const totalFrames = 80;
        const batchSize = Math.max(1, Math.floor(stars.length / totalFrames));
        function tick() {
            for (let i = 0; i < batchSize && idx < sorted.length; i++, idx++) {
                const s = sorted[idx].st;
                s.isLit = true;
                s.litTime = time;
                s.glowTarget = 0.7;
                s.flash = 0.3;
            }
            if (idx < sorted.length) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    function startHeroReveal() {
        heroRevealTime = time;
        const vh = window.innerHeight;
        const viewCenter = window.innerHeight / 2;
        const sorted = stars
            .map(st => ({ st, dist: Math.abs(st.y - viewCenter) + (Math.random() - 0.5) * vh * 0.35 }))
            .sort((a, b) => a.dist - b.dist);
        let idx = 0;
        const totalFrames = 300;
        const batchSize = Math.max(1, Math.floor(stars.length / totalFrames));
        function tick() {
            for (let i = 0; i < batchSize && idx < sorted.length; i++, idx++) {
                const s = sorted[idx].st;
                s.revealed = true;
                s.glowTarget = 1.0;
            }
            if (idx < sorted.length) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    function tryGenerate() {
        if (initialized) return;
        if (getDocHeight() < 100) { setTimeout(tryGenerate, 200); return; }
        generate();
    }
    if (document.readyState === 'complete') {
        tryGenerate();
    } else {
        window.addEventListener('load', tryGenerate);
        if (document.readyState !== 'loading') tryGenerate();
    }

    function fitCanvas() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        s.width = w;
        s.height = h;
        s.style.width = w + 'px';
        s.style.height = h + 'px';
    }
    fitCanvas();
    window.addEventListener('resize', fitCanvas);
    document.addEventListener('mousemove', e => {
        cursorX = e.clientX;
        cursorY = e.clientY;
    });

    function draw() {
        time += 0.016;
        const w = s.width, vh = s.height;
        const scrollY = window.scrollY;
        const viewMidY = scrollY + vh / 2;

        sctx.clearRect(0, 0, w, vh);

        const cursorDx = cursorX >= 0 ? (cursorX - w / 2) / (w / 2) * 4 : 0;
        const cursorDy = cursorY >= 0 ? (cursorY - vh / 2) / (vh / 2) * 4 : 0;

        const bandH = 200;
        const bandA = 0.04;
        const grad = sctx.createRadialGradient(w / 2, vh / 2, 0, w / 2, vh / 2, bandH);
        grad.addColorStop(0, `rgba(${themeRgb},${bandA * 1.8})`);
        grad.addColorStop(0.35, `rgba(${themeRgb},${bandA})`);
        grad.addColorStop(1, `rgba(${themeRgb},0)`);
        sctx.fillStyle = grad;
        sctx.fillRect(0, vh / 2 - bandH, w, bandH * 2);

        connections.forEach(c => {
            const a = c.a, b = c.b;
            const ax = a.x + cursorDx * a.parallax, bx = b.x + cursorDx * b.parallax;
            const ay = a.y + (cursorDy - scrollY) * a.parallax, by = b.y + (cursorDy - scrollY) * b.parallax;
            if ((ay < -40 && by < -40) || (ay > vh + 40 && by > vh + 40)) return;
            const dx = ax - bx;
            const dy = ay - by;
            const screenDist = Math.sqrt(dx * dx + dy * dy);
            if (screenDist > 160) return;
            const fade = Math.max(0, 1 - screenDist / c.maxDist);
            const avgGlow = (c.a.glow + c.b.glow) / 2;
            const avgFlash = Math.max(c.a.flash, c.b.flash);
            const scrollFade = Math.max(0, 1 - Math.abs((a.y + b.y) / 2 - viewMidY) / (vh * 1.2));
            const litBoost = avgGlow * 0.5 + avgFlash * 0.4;
            const alpha = fade * scrollFade * (0.08 + litBoost);
            if (alpha > 0.01) {
                sctx.beginPath();
                sctx.moveTo(ax, ay);
                sctx.lineTo(bx, by);
                sctx.strokeStyle = `rgba(${themeRgb},${alpha})`;
                sctx.lineWidth = 0.3 + avgGlow * 0.7 + avgFlash * 0.6;
                sctx.stroke();
            }
        });

        stars.forEach(st => {
            const cx = st.x + cursorDx * st.parallax;
            const screenY = st.y + (cursorDy - scrollY) * st.parallax;
            if (screenY < -50 || screenY > vh + 50) return;

            if (!st.isLit) {
                const threshold = vh * 0.14 + (st.twinklePhase / (Math.PI * 2)) * vh * 0.12;
                const offsetY = viewMidY + st.scrollPhase;
                if (Math.abs(st.y - offsetY) < threshold) {
                    st.isLit = true;
                    st.litTime = time;
                    st.glowTarget = 1.0;
                    st.flash = 1.0;
                }
            }

            if (st.litTime >= 0) {
                const elapsed = time - st.litTime;
                const duration = st.glowTarget > 0.5 ? 2.0 : 1.2;
                const progress = Math.min(elapsed / duration, 1);
                st.glow = st.glowTarget * (0.6 + 0.4 * progress * progress);
            }

            if (st.flash > 0.001) {
                st.flash *= 0.92;
            } else {
                st.flash = 0;
            }

            const dx = cursorX - cx;
            const dy = cursorY - screenY;
            const cursorDist = Math.sqrt(dx * dx + dy * dy);
            const cursorFalloff = Math.max(0, 1 - cursorDist / 220);
            const cursorBoost = cursorFalloff * cursorFalloff * 0.7;

            const brightness = st.glow + st.flash + cursorBoost;
            const targetA = st.baseA * (0.35 + 0.65 * Math.min(brightness, 1));
            st.currentA += (targetA - st.currentA) * 0.2;

            const twinkle = Math.sin(time * st.twinkleSpeed + st.twinklePhase) * 0.12 + 0.88;
            const breath = 1 + Math.sin(time * 0.2 + st.twinklePhase) * 0.1;
            const alpha = st.currentA * twinkle * breath;
            const size = st.r * (0.45 + 0.55 * st.glow) * (1 + st.flash * 0.3);

            if (st.glow > 0.01) {
                const glowR = size * (2 + st.glow * 4 + st.flash * 3);
                const grad = sctx.createRadialGradient(cx, screenY, size * 0.2, cx, screenY, glowR);
                const haloA = Math.min(st.glow * 0.2 + st.flash * 0.25, 0.45);
                grad.addColorStop(0, `rgba(${themeRgb},${haloA})`);
                grad.addColorStop(0.4, `rgba(${themeRgb},${haloA * 0.5})`);
                grad.addColorStop(1, `rgba(${themeRgb},0)`);
                sctx.beginPath();
                sctx.arc(cx, screenY, glowR, 0, Math.PI * 2);
                sctx.fillStyle = grad;
                sctx.fill();
            }

            sctx.beginPath();
            sctx.arc(cx, screenY, size, 0, Math.PI * 2);
            sctx.fillStyle = `rgba(${themeRgb},${Math.min(alpha, 0.95)})`;
            sctx.fill();
        });

        if (cursorX >= 0 && cursorY >= 0) {
            const cursorScrollY = window.scrollY;
            let nearest = -1, nearDist = 80;
            for (let i = 0; i < stars.length; i++) {
                const st = stars[i];
                const scx = st.x + cursorDx * st.parallax;
                const sy = st.y + (cursorDy - cursorScrollY) * st.parallax;
                if (sy < -60 || sy > vh + 60) continue;
                const d = Math.hypot(scx - cursorX, sy - cursorY);
                if (d < nearDist) { nearDist = d; nearest = i; }
            }
            if (nearest >= 0) {
                const a = stars[nearest];
                const acx = a.x + cursorDx * a.parallax;
                const ay = a.y + (cursorDy - cursorScrollY) * a.parallax;
                const searchR = 180;
                let connections = [];
                for (let i = 0; i < stars.length; i++) {
                    if (i === nearest) continue;
                    const b = stars[i];
                    const bcx = b.x + cursorDx * b.parallax;
                    const by = b.y + (cursorDy - cursorScrollY) * b.parallax;
                    if (by < -60 || by > vh + 60) continue;
                    if (Math.abs(b.parallax - a.parallax) > 0.35) continue;
                    const d = Math.hypot(acx - bcx, ay - by);
                    if (d < searchR) connections.push({ b, bcx, by, d });
                }
                connections.sort((x, y) => x.d - y.d);
                connections.slice(0, 5).forEach(c => {
                    const fade = 1 - c.d / searchR;
                    const alpha = fade * fade * 0.5;
                    sctx.beginPath();
                    sctx.moveTo(acx, ay);
                    sctx.lineTo(c.bcx, c.by);
                    sctx.strokeStyle = `rgba(${themeRgb},${alpha})`;
                    sctx.lineWidth = 0.6 + fade * 1.2;
                    sctx.stroke();
                });
            }

            const lanternR = 150;
            const lg = sctx.createRadialGradient(cursorX, cursorY, 0, cursorX, cursorY, lanternR);
            lg.addColorStop(0, `rgba(${themeRgb},0.06)`);
            lg.addColorStop(0.5, `rgba(${themeRgb},0.025)`);
            lg.addColorStop(1, `rgba(${themeRgb},0)`);
            sctx.fillStyle = lg;
            sctx.fillRect(cursorX - lanternR, cursorY - lanternR, lanternR * 2, lanternR * 2);
        }

        if (cursorX >= 0 && cursorY >= 0 && Date.now() - lastTrailSpawn > 40) {
            lastTrailSpawn = Date.now();
            for (let i = 0; i < 2; i++) {
                trailParticles.push({
                    x: cursorX + (Math.random() - 0.5) * 8,
                    y: cursorY + (Math.random() - 0.5) * 8,
                    vx: (Math.random() - 0.5) * 0.6,
                    vy: -0.3 - Math.random() * 0.4,
                    life: 1,
                    decay: 0.012 + Math.random() * 0.012,
                    size: 1.2 + Math.random() * 2,
                });
            }
        }
        for (let i = trailParticles.length - 1; i >= 0; i--) {
            const p = trailParticles[i];
            p.x += p.vx + Math.sin(p.life * 8 + p.y * 0.01) * 0.15;
            p.y += p.vy;
            p.vy *= 0.98;
            p.life -= p.decay;
            if (p.life <= 0) { trailParticles.splice(i, 1); continue; }
            sctx.beginPath();
            sctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            sctx.fillStyle = `rgba(${themeRgb},${p.life * 0.35})`;
            sctx.fill();
        }
        if (trailParticles.length > 300) trailParticles.splice(0, trailParticles.length - 300);

        if (!activeStreak && Date.now() - lastStreak > 5000 + Math.random() * 3000) {
            lastStreak = Date.now();
            const src = stars[Math.floor(Math.random() * stars.length)];
            const sScreenY = src.y - scrollY * src.parallax;
            if (sScreenY >= -100 && sScreenY <= vh + 100) {
                const angle = (Math.random() - 0.5) * 0.5;
                const len = 100 + Math.random() * 200;
                activeStreak = {
                    x1: src.x, y1: sScreenY,
                    x2: src.x + Math.cos(angle) * len,
                    y2: sScreenY + Math.sin(angle) * len,
                    life: 1,
                    maxLife: 0.4 + Math.random() * 0.3
                };
            }
        }
        if (activeStreak) {
            activeStreak.life -= 0.0166 / activeStreak.maxLife;
            if (activeStreak.life <= 0) { activeStreak = null; }
            else {
                const l = activeStreak.life;
                sctx.beginPath();
                sctx.moveTo(activeStreak.x1, activeStreak.y1);
                sctx.lineTo(activeStreak.x2, activeStreak.y2);
                sctx.strokeStyle = `rgba(${themeRgb},${l * 0.6})`;
                sctx.lineWidth = 1.8 * l;
                sctx.stroke();
                sctx.beginPath();
                sctx.arc(activeStreak.x2, activeStreak.y2, 3 * l, 0, Math.PI * 2);
                sctx.fillStyle = `rgba(${themeRgb},${l * 0.5})`;
                sctx.fill();
            }
        }

        if (Date.now() - lastMicroFlare > 1200 + Math.random() * 2800) {
            lastMicroFlare = Date.now();
            for (let attempt = 0; attempt < 15; attempt++) {
                const st = stars[Math.floor(Math.random() * stars.length)];
                if (st.revealed && st.glow > 0.4) {
                    const sy = st.y - scrollY * st.parallax;
                    if (sy >= -50 && sy <= vh + 50) {
                        st.flash = 0.18 + Math.random() * 0.15;
                        break;
                    }
                }
            }
        }

        if (time < 2) {
            const veilA = Math.max(0, 1 - time / 2) * 0.65;
            sctx.fillStyle = `rgba(4,20,13,${veilA})`;
            sctx.fillRect(0, 0, w, vh);
        }

        if (heroRevealTime >= 0) {
            const elapsed = time - heroRevealTime;
            const duration = 5.0;
            const progress = Math.min(elapsed / duration, 1);
            if (progress < 1) {
                const radius = vh * (0.06 + progress * 0.5);
                const alpha = (1 - progress) * 0.08;
                const gx = w / 2;
                const gy = scrollY + vh / 2;
                const g = sctx.createRadialGradient(gx, gy, 0, gx, gy, radius);
                g.addColorStop(0, `rgba(${themeRgb},${alpha})`);
                g.addColorStop(0.5, `rgba(${themeRgb},${alpha * 0.4})`);
                g.addColorStop(1, `rgba(${themeRgb},0)`);
                sctx.fillStyle = g;
                sctx.fillRect(0, 0, w, vh);
            }
        }

        requestAnimationFrame(draw);
    }
    draw();

    window.__heroReveal = startHeroReveal;
    window.__startSpread = startInitSpread;
})();

/* ============================================================
   THEME TOGGLE
   ============================================================ */
const root = document.documentElement;
const toggle = document.getElementById('themeToggle');
const THEMES = ['', 'alpine', 'purple'];
toggle.addEventListener('click', () => {
    const current = root.getAttribute('data-theme') || '';
    const idx = THEMES.indexOf(current);
    const next = THEMES[(idx + 1) % THEMES.length];
    if (next) root.setAttribute('data-theme', next);
    else root.removeAttribute('data-theme');
    refreshThemeRgb();
});

/* ============================================================
   SMOOTH SCROLL
   ============================================================ */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const targetId = this.getAttribute('href');
        if (targetId === '#') return;
        const target = document.querySelector(targetId);
        if (target) {
            window.scrollTo({
                top: target.offsetTop - 80,
                behavior: 'smooth'
            });
        }
    });
});

/* ============================================================
   SCROLL REVEALS
   ============================================================ */
function initReveals() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
            }
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach(el => {
        observer.observe(el);
    });
}
initReveals();

/* ============================================================
   LANDING ANIMATION
   ============================================================ */
window.addEventListener('load', () => {
    requestAnimationFrame(() => {
        document.querySelector('.hero-content')?.classList.add('animate');
        if (window.__startSpread) window.__startSpread();
    });
    setTimeout(() => {
        if (window.__heroReveal) window.__heroReveal();
    }, 1800);
});
