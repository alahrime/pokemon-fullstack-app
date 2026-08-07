import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { HeatCell } from '../lib/engine';
import { resolveCssColor } from '../lib/cssColor';
import { useTheme } from '../state/ThemeContext';

/**
 * The 4096-space as terrain.
 *
 * The 2D heatmap can encode exactly one variable — colour. Here the plane is
 * attack × defense (as before), colour still follows the selected `colorBy`
 * metric, and *height* is always normalised stat product. That's the payoff:
 * you can see a breakpoint band and the rank ridge it sits on at the same
 * time, which is the actual decision a player is making.
 *
 * One InstancedMesh, 256 instances per HP slice — cheap enough to re-scale
 * every frame if we wanted, though we only rebuild on data change.
 */

const GRID = 16;
const SPACING = 1;
const MAX_HEIGHT = 6;
const MIN_HEIGHT = 0.12;

interface TerrainProps {
  cells: HeatCell[];
  onPick: (a: number, d: number) => void;
  themeKey: string;
  reduced: boolean;
}

function Terrain({ cells, onPick, themeKey, reduced }: TerrainProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const youRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  // Normalise stat product across the visible slice so the relief always uses
  // the full height range, whatever species/league is loaded.
  const { spMin, spSpan } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of cells) {
      if (c.entry.sp < lo) lo = c.entry.sp;
      if (c.entry.sp > hi) hi = c.entry.sp;
    }
    return { spMin: lo, spSpan: Math.max(1e-9, hi - lo) };
  }, [cells]);

  const heightOf = useCallback(
    (c: HeatCell) => MIN_HEIGHT + Math.pow((c.entry.sp - spMin) / spSpan, 1.7) * MAX_HEIGHT,
    [spMin, spSpan],
  );

  // Rebuild instance transforms + colours. themeKey in the deps re-resolves
  // every colour expression after a theme swap.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    cells.forEach((c, i) => {
      const h = heightOf(c);
      dummy.position.set(
        (c.a - (GRID - 1) / 2) * SPACING,
        h / 2,
        -(c.d - (GRID - 1) / 2) * SPACING,
      );
      dummy.scale.set(0.88, h, 0.88);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const [r, g, b] = resolveCssColor(c.bg);
      color.setRGB(r, g, b, THREE.SRGBColorSpace);
      mesh.setColorAt(i, color);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    // Park the marker on the user's own spread.
    const you = cells.find((c) => c.isYou);
    if (you && youRef.current) {
      youRef.current.position.set(
        (you.a - (GRID - 1) / 2) * SPACING,
        heightOf(you) + 0.85,
        -(you.d - (GRID - 1) / 2) * SPACING,
      );
    }
  }, [cells, heightOf, themeKey]);

  // Gentle bob on the "you are here" marker.
  useFrame(({ clock }) => {
    if (reduced || !youRef.current) return;
    youRef.current.rotation.y = clock.elapsedTime * 1.2;
    youRef.current.position.y += Math.sin(clock.elapsedTime * 2) * 0.0035;
  });

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(e.instanceId ?? null);
  };
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const c = e.instanceId != null ? cells[e.instanceId] : null;
    if (c) onPick(c.a, c.d);
  };

  const hoverCell = hovered != null ? cells[hovered] : null;

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, cells.length]}
        onPointerMove={handleMove}
        onPointerOut={() => setHovered(null)}
        onClick={handleClick}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[SPACING, 1, SPACING]} />
        <meshStandardMaterial roughness={0.42} metalness={0.12} envMapIntensity={0.6} />
      </instancedMesh>

      {/* your current spread */}
      <mesh ref={youRef}>
        <octahedronGeometry args={[0.42, 0]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={1.6}
          roughness={0.2}
        />
      </mesh>

      {hoverCell ? (
        <Html
          position={[
            (hoverCell.a - (GRID - 1) / 2) * SPACING,
            heightOf(hoverCell) + 0.5,
            -(hoverCell.d - (GRID - 1) / 2) * SPACING,
          ]}
          center
          distanceFactor={18}
          style={{ pointerEvents: 'none' }}
        >
          <div
            className="panel panel-filled numeric h3d-tip"
          >
            {hoverCell.tip}
          </div>
        </Html>
      ) : null}
    </group>
  );
}

function Rig({ reduced }: { reduced: boolean }) {
  // Slow idle orbit until the user grabs the camera; disabled under
  // reduced motion so the scene is completely static.
  return (
    <OrbitControls
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      autoRotate={!reduced}
      autoRotateSpeed={0.45}
      minDistance={12}
      maxDistance={44}
      maxPolarAngle={Math.PI / 2.15}
    />
  );
}

export function Heatmap3D({
  cells,
  onPick,
  height = 460,
}: {
  cells: HeatCell[];
  onPick: (a: number, d: number) => void;
  height?: number;
}) {
  const { theme, reduced } = useTheme();
  const [ready, setReady] = useState(false);

  // Colour resolution reads computed styles, so it must run after the theme
  // attribute has been committed to <html>.
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const isDark = theme === 'hud';

  return (
    <div
      className="hud-frame"
      style={{
        height,
        width: '100%',
        border: 'var(--border-hairline) solid var(--rule-strong)',
        background: 'var(--surface-2)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {ready ? (
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [14, 15, 20], fov: 42 }}
          gl={{ antialias: true, alpha: true }}
        >
          <Suspense fallback={null}>
            <ambientLight intensity={isDark ? 0.5 : 1.1} />
            <directionalLight
              position={[10, 18, 8]}
              intensity={isDark ? 2.2 : 1.8}
              castShadow
              shadow-mapSize={[1024, 1024]}
            />
            <directionalLight position={[-12, 6, -10]} intensity={isDark ? 0.9 : 0.4} color={isDark ? '#35d7f5' : '#ffffff'} />

            <Terrain cells={cells} onPick={onPick} themeKey={theme} reduced={reduced} />

            <gridHelper
              args={[GRID * SPACING, GRID, isDark ? '#2c3d4f' : '#bab6b6', isDark ? '#16202b' : '#d7d3d3']}
              position={[0, -0.01, 0]}
            />
            <Rig reduced={reduced} />
          </Suspense>
        </Canvas>
      ) : null}

      {/* axis legend, DOM rather than 3D text — stays crisp and themed */}
      <div
        className="hud-label h3d-caption"
      >
        <span>height = stat product · colour = selected metric · drag to orbit</span>
      </div>
    </div>
  );
}
