import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface ParticleAmoebaProps {
  className?: string;
}

export const ParticleAmoeba: React.FC<ParticleAmoebaProps> = ({ className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let animationFrameId: number;
    const isDarkTheme = () => document.documentElement.classList.contains('dark');

    // Dimensions
    const width = container.clientWidth || 460;
    const height = container.clientHeight || 460;

    // Scene & Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 0, 8);

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const blob = new THREE.Group();
    scene.add(blob);

    // Pointer Interaction
    const pointer = new THREE.Vector2(0, 0);
    const pointerTarget = new THREE.Vector2(0, 0);
    let pointerActive = false;

    const updatePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerTarget.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerTarget.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      pointerActive = true;
    };

    const handlePointerLeave = () => {
      pointerActive = false;
    };

    const domElement = renderer.domElement;
    domElement.addEventListener('pointermove', updatePointer);
    domElement.addEventListener('pointerenter', updatePointer);
    domElement.addEventListener('pointerleave', handlePointerLeave);
    domElement.addEventListener('pointercancel', handlePointerLeave);

    // Also track pointer on container/window when hovering near top-left
    const handleWindowPointerMove = (e: MouseEvent) => {
      const rect = domElement.getBoundingClientRect();
      // Expand interactive zone around top-left
      const zoneMargin = 100;
      if (
        e.clientX >= rect.left - zoneMargin &&
        e.clientX <= rect.right + zoneMargin &&
        e.clientY >= rect.top - zoneMargin &&
        e.clientY <= rect.bottom + zoneMargin
      ) {
        pointerTarget.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerTarget.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        pointerActive = true;
      }
    };
    window.addEventListener('mousemove', handleWindowPointerMove);

    // Particle distribution setup
    const isMobile = window.innerWidth < 768;
    const particleCount = isMobile ? 24000 : 38000;
    const innerCount = isMobile ? 14000 : 22000;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    // Outer Layer Particles
    const basePositions: number[] = [];
    const colorFactors: number[] = [];
    const colors: number[] = [];

    const isDark = isDarkTheme();

    for (let i = 0; i < particleCount; i++) {
      const yUnit = 1 - (i / (particleCount - 1)) * 2;
      const ringRadius = Math.sqrt(Math.max(0, 1 - yUnit * yUnit));
      const theta = goldenAngle * i;

      const nx = Math.cos(theta) * ringRadius;
      const ny = yUnit;
      const nz = Math.sin(theta) * ringRadius;

      const lobe1 = 0.22 * Math.sin(2.1 * theta + ny * 2.7);
      const lobe2 = 0.13 * Math.cos(3.2 * theta - ny * 3.5);
      const lobe3 = 0.10 * Math.sin(4.4 * ny + theta * 1.7);
      const broadWarp = 0.12 * Math.sin(nx * 3.0 + nz * 2.0) * Math.cos(ny * 2.2);
      const r = 1.68 + lobe1 + lobe2 + lobe3 + broadWarp;

      const x = nx * r * 1.13 + 0.13 * Math.sin(ny * 2.8);
      const y = ny * r * 0.94 + 0.10 * Math.sin(nx * 2.4 + nz);
      const z = nz * r * 0.86 + 0.10 * Math.cos(nx * 2.1 - ny);

      basePositions.push(x, y, z);

      // Raw normalized luminance variation factor
      const factor = 0.5 + 0.5 * Math.sin(theta * 1.8 + ny * 4.1 + nz * 2.0);
      colorFactors.push(factor);

      // Contrast adjustment based on theme - slightly darker tone
      const brightness = isDark
        ? THREE.MathUtils.clamp(0.22 + 0.54 * factor, 0.18, 0.82)
        : THREE.MathUtils.clamp(0.08 + 0.40 * (1 - factor * 0.7), 0.06, 0.50);

      colors.push(brightness, brightness, brightness);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(basePositions), 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(colors), 3));

    const material = new THREE.PointsMaterial({
      size: 0.022,
      vertexColors: true,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      sizeAttenuation: true
    });
    blob.add(new THREE.Points(geometry, material));

    // Inner Layer Particles
    const innerBasePositions: number[] = [];
    const innerColorFactors: number[] = [];
    const innerColors: number[] = [];

    for (let i = 0; i < innerCount; i++) {
      const yUnit = 1 - (i / (innerCount - 1)) * 2;
      const ringRadius = Math.sqrt(Math.max(0, 1 - yUnit * yUnit));
      const theta = goldenAngle * i + 0.19;

      const nx = Math.cos(theta) * ringRadius;
      const ny = yUnit;
      const nz = Math.sin(theta) * ringRadius;
      const r = 1.43
        + 0.16 * Math.sin(2.0 * theta + ny * 2.6)
        + 0.10 * Math.cos(3.0 * theta - ny * 3.0)
        + 0.06 * Math.sin(nx * 3.0 + nz * 2.0);

      innerBasePositions.push(
        nx * r * 1.10 + 0.11 * Math.sin(ny * 2.8),
        ny * r * 0.94 + 0.08 * Math.sin(nx * 2.4 + nz),
        nz * r * 0.86 + 0.08 * Math.cos(nx * 2.1 - ny)
      );

      const factor = 0.5 + 0.5 * Math.sin(theta * 2.2 + ny * 4.0);
      innerColorFactors.push(factor);

      const c = isDark
        ? 0.10 + 0.36 * factor
        : 0.08 + 0.28 * (1 - factor * 0.6);

      innerColors.push(c, c, c);
    }

    const innerGeometry = new THREE.BufferGeometry();
    innerGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(innerBasePositions), 3));
    innerGeometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(innerColors), 3));

    const innerMaterial = new THREE.PointsMaterial({
      size: 0.015,
      vertexColors: true,
      transparent: true,
      opacity: 0.50,
      depthWrite: false,
      sizeAttenuation: true
    });
    blob.add(new THREE.Points(innerGeometry, innerMaterial));

    // Theme Change Observer
    const updateThemeColors = () => {
      const dark = isDarkTheme();
      const colorAttr = geometry.attributes.color as THREE.BufferAttribute;
      const colorArray = colorAttr.array as Float32Array;

      for (let i = 0; i < colorFactors.length; i++) {
        const factor = colorFactors[i];
        const brightness = dark
          ? THREE.MathUtils.clamp(0.22 + 0.54 * factor, 0.18, 0.82)
          : THREE.MathUtils.clamp(0.08 + 0.40 * (1 - factor * 0.7), 0.06, 0.50);
        colorArray[i * 3] = brightness;
        colorArray[i * 3 + 1] = brightness;
        colorArray[i * 3 + 2] = brightness;
      }
      colorAttr.needsUpdate = true;

      const innerColorAttr = innerGeometry.attributes.color as THREE.BufferAttribute;
      const innerColorArray = innerColorAttr.array as Float32Array;

      for (let i = 0; i < innerColorFactors.length; i++) {
        const factor = innerColorFactors[i];
        const c = dark
          ? 0.10 + 0.36 * factor
          : 0.08 + 0.28 * (1 - factor * 0.6);
        innerColorArray[i * 3] = c;
        innerColorArray[i * 3 + 1] = c;
        innerColorArray[i * 3 + 2] = c;
      }
      innerColorAttr.needsUpdate = true;
    };

    const themeObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          updateThemeColors();
        }
      }
    });
    themeObserver.observe(document.documentElement, { attributes: true });

    // Clock & Animation Loop
    const clock = new THREE.Clock();
    const mainAttr = geometry.attributes.position as THREE.BufferAttribute;
    const innerAttr = innerGeometry.attributes.position as THREE.BufferAttribute;
    const mainPosArr = mainAttr.array as Float32Array;
    const innerPosArr = innerAttr.array as Float32Array;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      pointer.lerp(pointerTarget, 0.085);

      const viewHeight = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const viewWidth = viewHeight * camera.aspect;
      const cursorX = pointer.x * viewWidth * 0.5;
      const cursorY = pointer.y * viewHeight * 0.5;
      const active = pointerActive ? 1 : 0;

      // Fluid morphing tilt and subtle floating motion
      const targetRotY = Math.sin(t * 0.24) * 0.10 + pointer.x * 0.10 * active;
      const targetRotX = Math.sin(t * 0.20) * 0.065 - pointer.y * 0.075 * active;
      const targetRotZ = Math.sin(t * 0.17) * 0.035;
      blob.rotation.y += (targetRotY - blob.rotation.y) * 0.025;
      blob.rotation.x += (targetRotX - blob.rotation.x) * 0.025;
      blob.rotation.z += (targetRotZ - blob.rotation.z) * 0.025;

      // Outer layer organic drift + cursor repulsion
      for (let i = 0; i < basePositions.length; i += 3) {
        const x = basePositions[i], y = basePositions[i + 1], z = basePositions[i + 2];

        const drift = Math.sin(t * 0.70 + x * 1.35 + y * 1.10 + z * 0.85) * 0.045
                    + Math.cos(t * 0.42 + y * 1.5 - z * 1.1) * 0.025;

        const dx = x - cursorX;
        const dy = y - cursorY;
        const distance = Math.sqrt(dx * dx + dy * dy) + 0.0001;
        const falloff = Math.exp(-(distance * distance) / (2 * 0.72 * 0.72));
        const frontWeight = THREE.MathUtils.smoothstep(z, -0.30, 1.05);
        const push = falloff * 0.66 * frontWeight * active;

        mainPosArr[i] = x + (x / 2.1) * drift + (dx / distance) * push;
        mainPosArr[i + 1] = y + (y / 2.1) * drift + (dy / distance) * push;
        mainPosArr[i + 2] = z + (z / 2.1) * drift + push * 0.22;
      }
      mainAttr.needsUpdate = true;

      // Inner layer organic drift + cursor repulsion
      for (let i = 0; i < innerBasePositions.length; i += 3) {
        const x = innerBasePositions[i], y = innerBasePositions[i + 1], z = innerBasePositions[i + 2];

        const drift = Math.sin(t * 0.62 + x * 1.2 - z * 1.05) * 0.028;
        const dx = x - cursorX;
        const dy = y - cursorY;
        const distance = Math.sqrt(dx * dx + dy * dy) + 0.0001;
        const falloff = Math.exp(-(distance * distance) / (2 * 0.60 * 0.60));
        const frontWeight = THREE.MathUtils.smoothstep(z, -0.25, 0.95);
        const push = falloff * 0.38 * frontWeight * active;

        innerPosArr[i] = x + (x / 1.9) * drift + (dx / distance) * push;
        innerPosArr[i + 1] = y + (y / 1.9) * drift + (dy / distance) * push;
        innerPosArr[i + 2] = z + (z / 1.9) * drift + push * 0.15;
      }
      innerAttr.needsUpdate = true;

      blob.scale.setScalar(1 + Math.sin(t * 0.58) * 0.012);
      renderer.render(scene, camera);
    };

    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 460;
      const h = container.clientHeight || 460;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      themeObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('mousemove', handleWindowPointerMove);
      domElement.removeEventListener('pointermove', updatePointer);
      domElement.removeEventListener('pointerenter', updatePointer);
      domElement.removeEventListener('pointerleave', handlePointerLeave);
      domElement.removeEventListener('pointercancel', handlePointerLeave);

      geometry.dispose();
      material.dispose();
      innerGeometry.dispose();
      innerMaterial.dispose();
      renderer.dispose();

      if (container.contains(domElement)) {
        container.removeChild(domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`particle-amoeba-canvas ${className}`}
      aria-hidden="true"
    />
  );
};
