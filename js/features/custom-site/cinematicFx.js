/**
 * DFCMS Cinematic FX — Ultra-light Three.js stardust canvas for Cinematic custom sites.
 *
 * Guard rails:
 * - Disabled in iframe editor (window !== window.top) to keep Studio 60fps responsive.
 * - Disabled if prefers-reduced-motion is active.
 * - Pauses on document.hidden (visibilitychange) and when scrolled out of view (IntersectionObserver).
 * - Capped at 450 particles with low-power WebGL settings and pixelRatio <= 1.5.
 * - Three.js loaded dynamically ONLY when needed (quick_card downloads 0kb Three.js).
 */

(function () {
  'use strict';

  let threeLoadPromise = null;

  function loadThreeJs() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (threeLoadPromise) return threeLoadPromise;

    threeLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      script.async = true;
      script.onload = () => {
        if (window.THREE) {
          resolve(window.THREE);
        } else {
          reject(new Error('THREE undefined after script load'));
        }
      };
      script.onerror = (err) => {
        threeLoadPromise = null;
        reject(err);
      };
      document.head.appendChild(script);
    });

    return threeLoadPromise;
  }

  function createParticleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.3, 'rgba(212, 175, 55, 0.8)');
    grad.addColorStop(0.7, 'rgba(212, 175, 55, 0.15)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new window.THREE.CanvasTexture(canvas);
    return texture;
  }

  async function initCinematicFx(containerEl, options = {}) {
    if (typeof window === 'undefined' || !containerEl) return null;

    // 1. Guard rails
    // Disabled in iframe (Studio editor / preview)
    if (window !== window.top) {
      console.debug('[CinematicFx] Skipping: inside iframe');
      return null;
    }

    // Disabled for prefers-reduced-motion
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      console.debug('[CinematicFx] Skipping: prefers-reduced-motion');
      return null;
    }

    // 2. Dynamically load Three.js
    let THREE;
    try {
      THREE = await loadThreeJs();
    } catch (e) {
      console.warn('[CinematicFx] Three.js unavailable:', e);
      return null;
    }

    if (!THREE) return null;

    // 3. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    const width = containerEl.clientWidth || window.innerWidth;
    const height = containerEl.clientHeight || window.innerHeight;
    const camera = new THREE.PerspectiveCamera(60, width / height, 1, 1000);
    camera.position.z = 400;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: 'low-power',
      });
    } catch {
      return null;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height);
    renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:12;';
    containerEl.appendChild(renderer.domElement);

    // 4. Particles (max 450)
    const particleCount = options.particleCount || 450;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    const spreadX = 800;
    const spreadY = 600;
    const spreadZ = 500;

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * spreadX;
      positions[i * 3 + 1] = (Math.random() - 0.5) * spreadY;
      positions[i * 3 + 2] = (Math.random() - 0.5) * spreadZ;

      velocities[i * 3] = (Math.random() - 0.5) * 0.12;
      velocities[i * 3 + 1] = 0.08 + Math.random() * 0.16; // gentle upward drift
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const pTexture = createParticleTexture();
    const material = new THREE.PointsMaterial({
      color: options.color || 0xd4af37,
      size: 4.5,
      map: pTexture || undefined,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    // 5. Interaction (subtle parallax on mouse)
    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;
    const windowHalfX = window.innerWidth / 2;
    const windowHalfY = window.innerHeight / 2;

    function onMouseMove(event) {
      mouseX = (event.clientX - windowHalfX) * 0.08;
      mouseY = (event.clientY - windowHalfY) * 0.08;
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    // 6. Animation Loop with Visibility & Intersection Pausing
    let animId = null;
    let isRunning = false;
    let isVisible = true;
    let isIntersecting = true;

    function animate() {
      if (!isRunning) return;

      targetX += (mouseX - targetX) * 0.05;
      targetY += (mouseY - targetY) * 0.05;

      camera.position.x = targetX;
      camera.position.y = -targetY;
      camera.lookAt(scene.position);

      const pos = geometry.attributes.position.array;
      for (let i = 0; i < particleCount; i++) {
        pos[i * 3] += velocities[i * 3];
        pos[i * 3 + 1] += velocities[i * 3 + 1];
        pos[i * 3 + 2] += velocities[i * 3 + 2];

        // wrap around vertically
        if (pos[i * 3 + 1] > spreadY / 2) {
          pos[i * 3 + 1] = -spreadY / 2;
        }
        if (pos[i * 3] > spreadX / 2) pos[i * 3] = -spreadX / 2;
        if (pos[i * 3] < -spreadX / 2) pos[i * 3] = spreadX / 2;
      }
      geometry.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
      animId = requestAnimationFrame(animate);
    }

    function start() {
      if (isRunning || !isVisible || !isIntersecting) return;
      isRunning = true;
      animId = requestAnimationFrame(animate);
    }

    function stop() {
      if (!isRunning) return;
      isRunning = false;
      if (animId) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    }

    // Visibility change handler (tab active / inactive)
    function onVisibilityChange() {
      isVisible = !document.hidden;
      if (isVisible) {
        start();
      } else {
        stop();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    // IntersectionObserver (hero scrolled out of view)
    let observer = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            isIntersecting = entry.isIntersecting;
            if (isIntersecting) {
              start();
            } else {
              stop();
            }
          }
        },
        { threshold: 0.05 }
      );
      observer.observe(containerEl);
    }

    // Resize handler
    function onResize() {
      if (!containerEl) return;
      const w = containerEl.clientWidth || window.innerWidth;
      const h = containerEl.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', onResize, { passive: true });

    // Start rendering
    start();

    // Cleanup API
    return function destroy() {
      stop();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (observer) {
        observer.disconnect();
      }
      geometry.dispose();
      material.dispose();
      if (pTexture) pTexture.dispose();
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }

  window.DFOPS_cinematicFx = {
    init: initCinematicFx,
  };
})();
