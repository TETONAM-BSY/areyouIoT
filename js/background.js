/* 배경 캔버스: 그리드 + 파티클 (장식용) */
(function () {
  'use strict';
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const N = 40;
  let W = 0, H = 0, particles = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function mkParticle() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      r: Math.random() * 1.5 + 0.5,
      a: Math.random() * 0.6 + 0.2,
    };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(0,255,136,0.04)';
    ctx.lineWidth = 1;
    const g = 60;
    for (let x = 0; x < W; x += g) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += g) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    particles.forEach((p, i) => {
      if (!reduceMotion) { p.x += p.vx; p.y += p.vy; }
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,255,136,${p.a})`;
      ctx.fill();

      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < 140) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = `rgba(0,255,136,${0.12 * (1 - d / 140)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    });

    if (!reduceMotion) requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { resize(); if (reduceMotion) draw(); });
  resize();
  particles = Array.from({ length: N }, mkParticle);
  draw();
})();
