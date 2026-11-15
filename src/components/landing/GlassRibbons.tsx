import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

interface GlassRibbonsProps {
  className?: string;
}

/**
 * Three iridescent glass hoops rising out of the bottom of the hero.
 * Pure decoration: renders nothing if WebGL is unavailable, pauses when off-screen or the tab is hidden,
 * and draws a single still frame when the viewer prefers reduced motion.
 */
export const GlassRibbons: React.FC<GlassRibbonsProps> = ({ className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    } catch {
      return;
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let width = container.clientWidth || 800;
    let height = container.clientHeight || 400;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;

    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
    camera.position.set(0, 0.6, 11);
    camera.lookAt(0, -0.4, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.3);
    key.position.set(-4, 6, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xb9c4ff, 0.9);
    rim.position.set(5, -2, 3);
    scene.add(rim);

    // Lime → mint → cyan → periwinkle, painted along each hoop by angle.
    const stops = [new THREE.Color('#D4F55A'), new THREE.Color('#5EE6B0'), new THREE.Color('#2EC4EE'), new THREE.Color('#7B83FF')];
    const paint = (geometry: THREE.BufferGeometry, offset: number) => {
      const pos = geometry.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const angle = Math.atan2(pos.getY(i), pos.getX(i));
        // Ping-pong around the ring so the gradient has no seam where the angle wraps.
        const t = ((Math.sin(angle + offset) + 1) / 2) * (stops.length - 1);
        const idx = Math.floor(t);
        c.copy(stops[idx]).lerp(stops[Math.min(idx + 1, stops.length - 1)], t - idx);
        colors.set([c.r, c.g, c.b], i * 3);
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    };

    const material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.18,
      metalness: 0.1,
      clearcoat: 0.8,
      clearcoatRoughness: 0.08,
      iridescence: 0.9,
      iridescenceIOR: 1.35,
      iridescenceThicknessRange: [200, 600],
      envMapIntensity: 0.55,
      transparent: true,
      opacity: 0.94,
    });

    const group = new THREE.Group();
    const hoops = [
      { r: 2.9, tube: 0.3, x: -2.6, y: -2.2, rz: 0.5, ry: 0.9 },
      { r: 2.6, tube: 0.28, x: 0.4, y: -2.6, rz: 0.32, ry: 1.0 },
      { r: 2.1, tube: 0.24, x: 3.1, y: -2.9, rz: 0.18, ry: 1.08 },
    ];
    const meshes = hoops.map((h, i) => {
      const geometry = new THREE.TorusGeometry(h.r, h.tube, 64, 260);
      paint(geometry, 0.6 + i * 0.9);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(h.x, h.y, -i * 0.4);
      mesh.rotation.set(0.15, h.ry, h.rz);
      mesh.scale.set(1, 1, 0.3);
      group.add(mesh);
      return { mesh, base: mesh.rotation.clone(), baseY: h.y, phase: i * 1.3 };
    });
    scene.add(group);

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onPointer = (e: PointerEvent) => {
      pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener('pointermove', onPointer, { passive: true });

    const clock = new THREE.Clock();
    let frame = 0;
    let visible = true;

    const draw = () => {
      const t = clock.getElapsedTime();
      pointer.x += (pointer.tx - pointer.x) * 0.04;
      pointer.y += (pointer.ty - pointer.y) * 0.04;
      meshes.forEach(({ mesh, base, baseY, phase }) => {
        mesh.rotation.x = base.x + Math.sin(t * 0.5 + phase) * 0.08 + pointer.y * 0.06;
        mesh.rotation.y = base.y + Math.cos(t * 0.4 + phase) * 0.1 + pointer.x * 0.12;
        mesh.position.y = baseY + Math.sin(t * 0.7 + phase) * 0.08;
      });
      group.rotation.y = pointer.x * 0.05;
      renderer.render(scene, camera);
    };

    const loop = () => {
      draw();
      if (visible && !document.hidden) frame = requestAnimationFrame(loop);
      else frame = 0;
    };
    const start = () => {
      if (reduceMotion) return draw();
      if (!frame) frame = requestAnimationFrame(loop);
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
    });
    io.observe(container);
    const onVisibility = () => {
      if (!document.hidden) start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const resize = () => {
      width = container.clientWidth || width;
      height = container.clientHeight || height;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      // Keep all three hoops in frame on narrow screens.
      camera.position.z = width < 640 ? 15 : 11;
      camera.updateProjectionMatrix();
      if (reduceMotion) draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();
    start();

    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
      meshes.forEach(({ mesh }) => mesh.geometry.dispose());
      material.dispose();
      envTexture.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={containerRef} className={className} aria-hidden="true" />;
};
