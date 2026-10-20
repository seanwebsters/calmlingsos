"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Environment, Html, Lightformer, OrbitControls, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { DEFAULT_OFFICE_THEME, OFFICE_THEMES, type OfficeSkinView, type OfficeTheme } from "./themes";

export interface OfficeAgent {
  key: string;
  name: string;
  role: string;
  department: string;
  status: "idle" | "working" | "queued" | "waiting" | "blocked";
  activity: string | null;
  title: string | null;
  href: string | null;
}
export interface Handoff {
  id: string;
  from: string;
  to: string;
  at: string;
  text: string;
}

export const DEPT_COLORS: Record<string, string> = {
  executive: "#e8b33f",
  social: "#5f8cf5",
  animation: "#9a7cf0",
  game: "#3fbf8c",
  product: "#ec6b6d",
  story: "#ea9450",
  music: "#3fbad3",
  commercial: "#d870bf",
};
export const DEPT_NAMES: Record<string, string> = {
  executive: "Executive Suite",
  social: "Social Studio",
  animation: "Animation Studio",
  game: "Game Studio",
  product: "Product Lab",
  story: "Story & World",
  music: "Music & Audio",
  commercial: "Commercial",
};
const STATUS_COLORS: Record<string, string> = { working: "#2fc48d", queued: "#5f8cf5", waiting: "#f0b429", blocked: "#ef5d60", idle: "#9aa3b5" };
const ORDER = ["executive", "social", "animation", "game", "product", "story", "music", "commercial"];

const POD_W = 9;
const POD_D = 7;
const GAP = 3;
const WALL_Z = -15;
const WINDOW_H = 4.6;
const FLOOR: [number, number] = [70, 46];
/** Middle of the content (window wall to the front pods), where the camera aims. */
const FOCUS_Z = -2.5;

/** Desk position for every agent: pods in a 4×2 grid, desks in two facing rows. */
function useLayout(agents: OfficeAgent[]) {
  return useMemo(() => {
    const desks: Record<string, { x: number; z: number; facing: number; dept: string }> = {};
    const pods: { dept: string; x: number; z: number }[] = [];
    ORDER.forEach((dept, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const cx = (col - 1.5) * (POD_W + GAP);
      const cz = (row - 0.5) * (POD_D + GAP + 1);
      pods.push({ dept, x: cx, z: cz });
      const members = agents.filter((a) => a.department === dept);
      members.forEach((a, j) => {
        const side = j % 2 === 0 ? -1 : 1;
        const slot = Math.floor(j / 2);
        const perRow = Math.max(1, Math.ceil(members.length / 2));
        const x = cx + (slot - (perRow - 1) / 2) * 2.1;
        desks[a.key] = { x, z: cz + side * 1.35, facing: side > 0 ? Math.PI : 0, dept };
      });
    });
    return { desks, pods };
  }, [agents]);
}

/** Loads a generated texture without suspending; a missing or expired URL falls back to plain materials. */
function useSkinTexture(url: string | null, repeat: [number, number], offsetY = 0, mirror = false) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const [rx, ry] = repeat;
  useEffect(() => {
    if (!url) {
      setTex(null);
      return;
    }
    let live = true;
    new THREE.TextureLoader().load(
      url,
      (t) => {
        if (!live) return t.dispose();
        t.wrapS = t.wrapT = mirror ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
        t.repeat.set(rx, ry);
        t.offset.set(0, offsetY);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        setTex(t);
      },
      undefined,
      () => live && setTex(null),
    );
    return () => {
      live = false;
    };
  }, [url, rx, ry, offsetY, mirror]);
  return tex;
}

/** Default window view: a soft sky gradient with a hazy skyline, drawn per theme. */
function useSkyTexture(theme: OfficeTheme) {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 256;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, theme.sky[0]);
    grad.addColorStop(0.65, theme.sky[1]);
    grad.addColorStop(1, theme.sky[2]);
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 256);
    let seed = 7;
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (const [alpha, base] of [[0.18, 150], [0.3, 185]] as const) {
      g.fillStyle = theme.dark ? `rgba(120,140,255,${alpha})` : `rgba(60,72,96,${alpha})`;
      for (let x = 0; x < 1024; ) {
        const w = 18 + rand() * 46;
        const h = 20 + rand() * (base - 60);
        g.fillRect(x, 256 - h, w - 4, h);
        x += w;
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [theme]);
}

/** Frames the whole floor for the current canvas size: pulls the camera back until every pod fits. */
function CameraRig() {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const vfov = (cam.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (size.width / size.height));
    // Extra margin: the front pods sit nearer the camera, so they read wider than the floor plan.
    const halfW = (4 * POD_W + 3 * GAP) / 2 + 4;
    const halfD = (POD_D + GAP + 1 - WALL_Z) / 2 + 1;
    const dist = Math.max(halfW / Math.tan(hfov / 2), (halfD * 1.15) / Math.tan(vfov / 2));
    cam.position.set(0, dist * 0.8, FOCUS_Z + dist * 0.6);
    cam.lookAt(0, 0, FOCUS_Z);
  }, [camera, size.width, size.height]);
  return null;
}

function Desk({ x, z, facing, color, active, theme }: { x: number; z: number; facing: number; color: string; active: boolean; theme: OfficeTheme }) {
  const screen = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (screen.current) screen.current.emissiveIntensity = active ? 1.2 + Math.sin(clock.elapsedTime * 6 + x) * 0.25 : 0.18;
  });
  return (
    <group position={[x, 0, z]} rotation={[0, facing, 0]}>
      {/* Bench desk */}
      <RoundedBox args={[1.8, 0.05, 0.9]} radius={0.02} position={[0, 0.74, 0.45]}>
        <meshStandardMaterial color={theme.deskTop} roughness={0.3} />
      </RoundedBox>
      {[-0.82, 0.82].map((lx) =>
        [0.1, 0.8].map((lz) => (
          <mesh key={`${lx}${lz}`} position={[lx, 0.36, lz]}>
            <cylinderGeometry args={[0.022, 0.022, 0.72, 8]} />
            <meshStandardMaterial color={theme.deskLeg} metalness={0.6} roughness={0.35} />
          </mesh>
        )),
      )}
      {/* Monitor */}
      <RoundedBox args={[0.92, 0.54, 0.035]} radius={0.015} position={[0, 1.13, 0.74]}>
        <meshStandardMaterial color={theme.deskLeg} roughness={0.4} />
      </RoundedBox>
      <mesh position={[0, 1.13, 0.72]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.86, 0.48]} />
        <meshStandardMaterial ref={screen} color={theme.screen} emissive={color} emissiveIntensity={0.18} />
      </mesh>
      <mesh position={[0, 0.86, 0.76]}>
        <cylinderGeometry args={[0.02, 0.02, 0.22, 8]} />
        <meshStandardMaterial color={theme.deskLeg} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.775, 0.74]}>
        <cylinderGeometry args={[0.12, 0.12, 0.015, 20]} />
        <meshStandardMaterial color={theme.deskLeg} metalness={0.6} roughness={0.35} />
      </mesh>
      <RoundedBox args={[0.55, 0.02, 0.17]} radius={0.008} position={[0, 0.775, 0.38]}>
        <meshStandardMaterial color={theme.dark ? "#3a4672" : "#e3e1dc"} roughness={0.5} />
      </RoundedBox>
      {/* Chair */}
      <RoundedBox args={[0.58, 0.08, 0.56]} radius={0.035} position={[0, 0.5, -0.2]}>
        <meshStandardMaterial color={theme.chair} roughness={0.7} />
      </RoundedBox>
      <RoundedBox args={[0.56, 0.62, 0.07]} radius={0.035} position={[0, 0.86, -0.47]} rotation={[-0.08, 0, 0]}>
        <meshStandardMaterial color={theme.chair} roughness={0.7} />
      </RoundedBox>
      <mesh position={[0, 0.25, -0.2]}>
        <cylinderGeometry args={[0.03, 0.03, 0.45, 8]} />
        <meshStandardMaterial color={theme.deskLeg} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.04, -0.2]}>
        <cylinderGeometry args={[0.26, 0.26, 0.04, 5]} />
        <meshStandardMaterial color={theme.deskLeg} metalness={0.5} roughness={0.4} />
      </mesh>
    </group>
  );
}

function Plant({ x, z, theme, scale = 1 }: { x: number; z: number; theme: OfficeTheme; scale?: number }) {
  return (
    <group position={[x, 0, z]} scale={scale}>
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.28, 0.22, 0.6, 20]} />
        <meshStandardMaterial color={theme.pot} roughness={0.6} />
      </mesh>
      {[
        [0, 0.95, 0, 0.42],
        [0.2, 1.3, 0.08, 0.32],
        [-0.16, 1.22, -0.12, 0.3],
        [0.05, 1.6, -0.02, 0.24],
      ].map(([px, py, pz, r], i) => (
        <mesh key={i} position={[px, py, pz]}>
          <icosahedronGeometry args={[r, 1]} />
          <meshStandardMaterial color={theme.plant} roughness={0.8} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function Avatar({ agent, desk, target, selected, onSelect, showBubble, theme }: { agent: OfficeAgent; desk: { x: number; z: number; facing: number }; target: { x: number; z: number } | null; selected: boolean; onSelect: (k: string) => void; showBubble: boolean; theme: OfficeTheme }) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const walk = useRef<{ start: number; to: { x: number; z: number } } | null>(null);
  const [hover, setHover] = useState(false);
  const color = DEPT_COLORS[agent.department] ?? "#5f8cf5";
  const seat = useMemo(() => {
    // Sit just behind the desk, facing the monitor.
    const off = new THREE.Vector3(0, 0, -0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), desk.facing);
    return { x: desk.x + off.x, z: desk.z + off.z };
  }, [desk]);
  const lastTarget = useRef<string | null>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    const key = target ? `${target.x},${target.z}` : null;
    if (key && key !== lastTarget.current) walk.current = { start: t, to: target! };
    lastTarget.current = key;
    let x = seat.x;
    let z = seat.z;
    let y = 0.5;
    let rot = desk.facing;
    if (walk.current) {
      // Walk to the teammate's desk, pause, and come back (6 seconds).
      const p = (t - walk.current.start) / 6;
      if (p >= 1) walk.current = null;
      else {
        const leg = p < 0.4 ? p / 0.4 : p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
        const ease = leg * leg * (3 - 2 * leg);
        x = THREE.MathUtils.lerp(seat.x, walk.current.to.x, ease);
        z = THREE.MathUtils.lerp(seat.z, walk.current.to.z - 0.9, ease);
        y = 0.62 + Math.abs(Math.sin(t * 9)) * 0.08;
        rot = Math.atan2(walk.current.to.x - seat.x, walk.current.to.z - seat.z) + (p >= 0.6 ? Math.PI : 0);
      }
    }
    if (!walk.current) {
      if (agent.status === "working") y += Math.sin(t * 5 + seat.x) * 0.025;
      else y += Math.sin(t * 1.2 + seat.x) * 0.01;
    }
    g.position.set(x, y, z);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, rot, 0.2);
    if (ring.current) {
      const m = ring.current.material as THREE.MeshBasicMaterial;
      m.opacity = agent.status === "idle" ? 0.25 : agent.status === "queued" ? 0.45 + Math.sin(t * 4) * 0.3 : 0.9;
    }
  });
  const card = theme.dark ? "bg-ink-850/95 text-mist-100 border-white/10" : "bg-white/95 text-slate-700 border-slate-200";
  return (
    <group
      ref={group}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect(agent.key);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = "";
      }}
    >
      <mesh position={[0, 0.42, 0]}>
        <capsuleGeometry args={[0.23, 0.4, 8, 20]} />
        <meshStandardMaterial color={color} roughness={0.35} emissive={color} emissiveIntensity={selected || hover ? 0.4 : 0.04} />
      </mesh>
      <mesh position={[0, 0.98, 0]}>
        <sphereGeometry args={[0.2, 32, 32]} />
        <meshStandardMaterial color="#f7f2ea" roughness={0.35} />
      </mesh>
      {[0.07, -0.07].map((ex) => (
        <mesh key={ex} position={[ex, 1.0, 0.175]}>
          <sphereGeometry args={[0.026, 10, 10]} />
          <meshBasicMaterial color="#1b2030" />
        </mesh>
      ))}
      <mesh ref={ring} position={[0, -0.48, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.36, 0.46, 40]} />
        <meshBasicMaterial color={STATUS_COLORS[agent.status]} transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      {selected && (
        <mesh position={[0, -0.47, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.7, 40]} />
          <meshBasicMaterial color={color} transparent opacity={0.25} />
        </mesh>
      )}
      {(hover || selected) && (
        <Html position={[0, 1.45, 0]} center distanceFactor={30} zIndexRange={[20, 0]}>
          <div className={`pointer-events-none whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium shadow ${card}`}>{agent.name}</div>
        </Html>
      )}
      {showBubble && agent.activity && agent.status !== "idle" && !hover && !selected && (
        <Html position={[0, 1.55, 0]} center distanceFactor={30} zIndexRange={[10, 0]}>
          <div className={`pointer-events-none max-w-[180px] rounded-xl border px-2.5 py-1.5 text-[10px] leading-snug shadow-lg ${card}`} style={{ borderColor: STATUS_COLORS[agent.status] }}>
            <div className="font-semibold" style={{ color: STATUS_COLORS[agent.status] }}>{agent.name}</div>
            <div className="line-clamp-3">{agent.activity}</div>
          </div>
        </Html>
      )}
    </group>
  );
}

/** A glowing parcel arcing from one desk to another for each recent handoff. */
function Parcel({ from, to }: { from: { x: number; z: number }; to: { x: number; z: number } }) {
  const ref = useRef<THREE.Mesh>(null);
  const t0 = useRef<number | null>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    t0.current ??= clock.elapsedTime;
    const p = ((clock.elapsedTime - t0.current) % 3) / 3;
    const x = THREE.MathUtils.lerp(from.x, to.x, p);
    const z = THREE.MathUtils.lerp(from.z, to.z, p);
    ref.current.position.set(x, 1.4 + Math.sin(p * Math.PI) * 2.2, z);
    (ref.current.material as THREE.MeshStandardMaterial).opacity = Math.sin(p * Math.PI);
  });
  return (
    <mesh ref={ref}>
      <boxGeometry args={[0.32, 0.22, 0.04]} />
      <meshStandardMaterial color="#fbf8f2" emissive="#f0b429" emissiveIntensity={1.4} transparent />
    </mesh>
  );
}

/** Floor-to-ceiling window wall; the view behind the glass is the generated panorama or a themed sky. */
function WindowWall({ theme, view }: { theme: OfficeTheme; view: THREE.Texture }) {
  const width = FLOOR[0];
  const h = WINDOW_H;
  return (
    <group position={[0, 0, WALL_Z]}>
      <mesh position={[0, h / 2, -0.6]}>
        <planeGeometry args={[width, h]} />
        <meshBasicMaterial key={view.uuid} map={view} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[width, 0.3, 0.3]} />
        <meshStandardMaterial color={theme.wall} roughness={0.8} />
      </mesh>
      <mesh position={[0, h, 0]}>
        <boxGeometry args={[width, 0.25, 0.3]} />
        <meshStandardMaterial color={theme.frame} roughness={0.5} />
      </mesh>
      {Array.from({ length: 15 }, (_, i) => (
        <mesh key={i} position={[(i - 7) * (width / 14), h / 2, 0]}>
          <boxGeometry args={[0.12, h, 0.12]} />
          <meshStandardMaterial color={theme.frame} metalness={0.4} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

export default function OfficeScene({ agents, handoffs, selected, onSelect, skin }: { agents: OfficeAgent[]; handoffs: Handoff[]; selected: string | null; onSelect: (k: string | null) => void; skin: OfficeSkinView }) {
  const theme = OFFICE_THEMES[skin.theme] ?? OFFICE_THEMES[DEFAULT_OFFICE_THEME];
  const { desks, pods } = useLayout(agents);
  const floorTex = useSkinTexture(skin.floorUrl, [FLOOR[0] / 5, FLOOR[1] / 5]);
  const rugTex = useSkinTexture(skin.rugUrl, [POD_W / 3, POD_D / 3]);
  // A 16:9 view across a ~15:1 window: mirror it three times and keep the horizon band.
  const wallTex = useSkinTexture(skin.wallUrl, [3, (16 / 9) / (FLOOR[0] / 3 / WINDOW_H)], 0.25, true);
  const sky = useSkyTexture(theme);
  const walking = useMemo(() => {
    const m: Record<string, { x: number; z: number }> = {};
    for (const h of handoffs) if (desks[h.to] && Date.now() - new Date(h.at).getTime() < 20_000) m[h.from] = desks[h.to];
    return m;
  }, [handoffs, desks]);
  const busy = agents.filter((a) => a.status !== "idle").length;
  const tint = (dept: string, base: string) => new THREE.Color(base).lerp(new THREE.Color(DEPT_COLORS[dept]), theme.rugTint);
  return (
    <Canvas dpr={[1, 1.75]} camera={{ position: [0, 30, 26], fov: 40 }} onPointerMissed={() => onSelect(null)} gl={{ antialias: true }}>
      <CameraRig />
      <color attach="background" args={[theme.background]} />
      <fog attach="fog" args={[theme.background, 70, 130]} />
      <hemisphereLight args={theme.hemi} />
      <directionalLight position={[14, 26, 12]} color={theme.sun[0]} intensity={theme.sun[1]} />
      <directionalLight position={[-18, 14, -10]} color={theme.sky[1]} intensity={0.4} />
      {theme.dark && <pointLight position={[0, 8, 0]} intensity={busy ? 30 : 12} color="#7ea5ff" distance={40} />}
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={1.4} position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[40, 30, 1]} />
        <Lightformer form="rect" intensity={0.8} color={theme.sky[1]} position={[0, 4, -20]} scale={[60, 6, 1]} />
      </Environment>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={FLOOR} />
        <meshStandardMaterial key={floorTex?.uuid ?? "plain"} color={floorTex ? "#ffffff" : theme.floor} map={floorTex} roughness={0.75} />
      </mesh>
      <ContactShadows position={[0, 0.002, 0]} scale={FLOOR} resolution={1024} far={3} blur={2.4} opacity={theme.shadowOpacity} color={theme.dark ? "#000000" : "#3a3226"} />
      <WindowWall theme={theme} view={wallTex ?? sky} />

      {pods.map((p) => (
        <group key={p.dept}>
          <RoundedBox args={[POD_W + 0.24, 0.03, POD_D + 0.24]} radius={0.015} position={[p.x, 0.015, p.z]}>
            <meshStandardMaterial color={DEPT_COLORS[p.dept]} roughness={0.8} />
          </RoundedBox>
          <RoundedBox args={[POD_W, 0.05, POD_D]} radius={0.02} position={[p.x, 0.025, p.z]}>
            <meshStandardMaterial key={rugTex?.uuid ?? "plain"} color={tint(p.dept, rugTex ? "#ffffff" : theme.floor)} map={rugTex} roughness={0.95} />
          </RoundedBox>
          <Plant x={p.x - POD_W / 2 + 0.2} z={p.z - POD_D / 2 + 0.2} theme={theme} />
          <Plant x={p.x + POD_W / 2 - 0.2} z={p.z + POD_D / 2 - 0.2} theme={theme} scale={0.8} />
        </group>
      ))}
      {[-30, -20, 20, 30].map((x) => (
        <Plant key={x} x={x} z={WALL_Z + 1.2} theme={theme} scale={1.4} />
      ))}
      {/* drei's first <Html> under React 19 can miss its initial mount; this inert sentinel absorbs it. */}
      <Html position={[0, -50, 0]}>
        <span />
      </Html>
      {pods.map((p) => (
        <Html key={`label-${p.dept}`} position={[p.x, 0.05, p.z + POD_D / 2 + 0.25]} center zIndexRange={[5, 0]}>
          <div className={`pointer-events-none flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] shadow-sm ${theme.dark ? "border-white/10 bg-ink-950/80 text-mist-100" : "border-black/5 bg-white/90 text-slate-700"}`}>
            <span className="size-1.5 rounded-full" style={{ background: DEPT_COLORS[p.dept] }} />
            {DEPT_NAMES[p.dept]}
          </div>
        </Html>
      ))}
      {agents.map((a) => desks[a.key] && <Desk key={`d-${a.key}`} {...desks[a.key]} color={DEPT_COLORS[a.department]} active={a.status === "working"} theme={theme} />)}
      {agents.map((a) => desks[a.key] && <Avatar key={a.key} agent={a} desk={desks[a.key]} target={walking[a.key] ?? null} selected={selected === a.key} onSelect={onSelect} showBubble={busy <= 14} theme={theme} />)}
      {handoffs.filter((h) => desks[h.from] && desks[h.to]).map((h) => <Parcel key={h.id} from={desks[h.from]} to={desks[h.to]} />)}
      <OrbitControls makeDefault target={[0, 0, FOCUS_Z]} maxPolarAngle={Math.PI / 2.25} minDistance={10} maxDistance={60} enableDamping />
    </Canvas>
  );
}
