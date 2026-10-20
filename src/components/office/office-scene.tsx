"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls, RoundedBox } from "@react-three/drei";
import * as THREE from "three";

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
  executive: "#f2c45f",
  social: "#7ea5ff",
  animation: "#b39cff",
  game: "#5fd3a5",
  product: "#f2797a",
  story: "#f0a868",
  music: "#6fd6e8",
  commercial: "#e58fd1",
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
const STATUS_COLORS: Record<string, string> = { working: "#5fd3a5", queued: "#7ea5ff", waiting: "#f2c45f", blocked: "#f2797a", idle: "#3a4672" };
const ORDER = ["executive", "social", "animation", "game", "product", "story", "music", "commercial"];

const POD_W = 9;
const POD_D = 7;
const GAP = 3;

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

/** Frames the whole floor for the current canvas size: pulls the camera back until every pod fits. */
function CameraRig() {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const vfov = (cam.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (size.width / size.height));
    const halfW = (4 * POD_W + 3 * GAP) / 2 + 2;
    const halfD = POD_D + GAP + 2;
    const dist = Math.max(halfW / Math.tan(hfov / 2), (halfD * 1.6) / Math.tan(vfov / 2));
    cam.position.set(0, dist * 0.78, dist * 0.62);
    cam.lookAt(0, 0, 0);
  }, [camera, size.width, size.height]);
  return null;
}

function Desk({ x, z, facing, color, active }: { x: number; z: number; facing: number; color: string; active: boolean }) {
  const screen = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (screen.current) screen.current.emissiveIntensity = active ? 1.1 + Math.sin(clock.elapsedTime * 6 + x) * 0.25 : 0.12;
  });
  return (
    <group position={[x, 0, z]} rotation={[0, facing, 0]}>
      <RoundedBox args={[1.7, 0.07, 0.85]} radius={0.03} position={[0, 0.74, 0.45]} castShadow receiveShadow>
        <meshStandardMaterial color="#d9cdb4" roughness={0.6} />
      </RoundedBox>
      {[-0.75, 0.75].map((lx) => (
        <mesh key={lx} position={[lx, 0.37, 0.45]} castShadow>
          <boxGeometry args={[0.06, 0.74, 0.7]} />
          <meshStandardMaterial color="#26315b" />
        </mesh>
      ))}
      <mesh position={[0, 1.08, 0.72]} castShadow>
        <boxGeometry args={[0.78, 0.48, 0.04]} />
        <meshStandardMaterial color="#141d3d" />
      </mesh>
      <mesh position={[0, 1.08, 0.695]}>
        <planeGeometry args={[0.7, 0.4]} />
        <meshStandardMaterial ref={screen} color="#0b1229" emissive={color} emissiveIntensity={0.12} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.8, 0.72]}>
        <boxGeometry args={[0.06, 0.12, 0.06]} />
        <meshStandardMaterial color="#26315b" />
      </mesh>
      <RoundedBox args={[0.6, 0.08, 0.6]} radius={0.03} position={[0, 0.48, -0.2]} castShadow>
        <meshStandardMaterial color="#3a4672" />
      </RoundedBox>
      <RoundedBox args={[0.6, 0.6, 0.08]} radius={0.03} position={[0, 0.8, -0.48]} castShadow>
        <meshStandardMaterial color="#3a4672" />
      </RoundedBox>
    </group>
  );
}

function Avatar({ agent, desk, target, selected, onSelect, showBubble }: { agent: OfficeAgent; desk: { x: number; z: number; facing: number }; target: { x: number; z: number } | null; selected: boolean; onSelect: (k: string) => void; showBubble: boolean }) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const walk = useRef<{ start: number; to: { x: number; z: number } } | null>(null);
  const [hover, setHover] = useState(false);
  const color = DEPT_COLORS[agent.department] ?? "#7ea5ff";
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
    let y = 0.48;
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
      m.opacity = agent.status === "idle" ? 0.15 : agent.status === "queued" ? 0.4 + Math.sin(t * 4) * 0.3 : 0.85;
    }
  });
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
      <mesh position={[0, 0.42, 0]} castShadow>
        <capsuleGeometry args={[0.22, 0.42, 6, 16]} />
        <meshStandardMaterial color={color} roughness={0.45} emissive={color} emissiveIntensity={selected || hover ? 0.35 : agent.status === "idle" ? 0 : 0.08} />
      </mesh>
      <mesh position={[0, 0.98, 0]} castShadow>
        <sphereGeometry args={[0.2, 24, 24]} />
        <meshStandardMaterial color="#f6f1e7" roughness={0.5} />
      </mesh>
      <mesh position={[0.07, 1.0, 0.17]}>
        <sphereGeometry args={[0.028, 8, 8]} />
        <meshBasicMaterial color="#141d3d" />
      </mesh>
      <mesh position={[-0.07, 1.0, 0.17]}>
        <sphereGeometry args={[0.028, 8, 8]} />
        <meshBasicMaterial color="#141d3d" />
      </mesh>
      <mesh ref={ring} position={[0, -0.46, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.44, 32]} />
        <meshBasicMaterial color={STATUS_COLORS[agent.status]} transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      {(hover || selected) && (
        <Html position={[0, 1.45, 0]} center distanceFactor={30} zIndexRange={[20, 0]}>
          <div className="pointer-events-none whitespace-nowrap rounded-md bg-ink-950/90 px-2 py-0.5 text-[11px] text-white shadow">{agent.name}</div>
        </Html>
      )}
      {showBubble && agent.activity && agent.status !== "idle" && !hover && !selected && (
        <Html position={[0, 1.55, 0]} center distanceFactor={30} zIndexRange={[10, 0]}>
          <div className="pointer-events-none max-w-[180px] rounded-xl border border-white/10 bg-ink-850/95 px-2.5 py-1.5 text-[10px] leading-snug text-mist-100 shadow-lg" style={{ borderColor: STATUS_COLORS[agent.status] }}>
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
      <meshStandardMaterial color="#fbf8f2" emissive="#f2c45f" emissiveIntensity={1.4} transparent />
    </mesh>
  );
}

export default function OfficeScene({ agents, handoffs, selected, onSelect }: { agents: OfficeAgent[]; handoffs: Handoff[]; selected: string | null; onSelect: (k: string | null) => void }) {
  const { desks, pods } = useLayout(agents);
  const walking = useMemo(() => {
    const m: Record<string, { x: number; z: number }> = {};
    for (const h of handoffs) if (desks[h.to] && Date.now() - new Date(h.at).getTime() < 20_000) m[h.from] = desks[h.to];
    return m;
  }, [handoffs, desks]);
  const busy = agents.filter((a) => a.status !== "idle").length;
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 30, 26], fov: 40 }} onPointerMissed={() => onSelect(null)} gl={{ antialias: true }}>
      <CameraRig />
      <color attach="background" args={["#070b1a"]} />
      <fog attach="fog" args={["#070b1a", 60, 120]} />
      <hemisphereLight args={["#bcd2ff", "#0b1229", 0.65]} />
      <directionalLight position={[14, 26, 12]} intensity={1.4} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={20} shadow-camera-bottom={-20} />
      <pointLight position={[0, 8, 0]} intensity={busy ? 30 : 12} color="#7ea5ff" distance={40} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[70, 46]} />
        <meshStandardMaterial color="#0f1733" roughness={0.9} />
      </mesh>
      {/* Back wall with windows */}
      <mesh position={[0, 1.5, -21]} receiveShadow>
        <boxGeometry args={[70, 3, 0.4]} />
        <meshStandardMaterial color="#141d3d" />
      </mesh>
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[(i - 4) * 7.4, 1.7, -20.75]}>
          <planeGeometry args={[5.4, 1.8]} />
          <meshStandardMaterial color="#1b2549" emissive="#5f8bf5" emissiveIntensity={0.35} />
        </mesh>
      ))}
      {pods.map((p) => (
        <group key={p.dept}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.005, p.z]} receiveShadow>
            <planeGeometry args={[POD_W, POD_D]} />
            <meshStandardMaterial color={DEPT_COLORS[p.dept]} transparent opacity={0.09} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.01, p.z]}>
            <ringGeometry args={[POD_W / 2 - 0.06, POD_W / 2, 4, 1, Math.PI / 4]} />
            <meshBasicMaterial color={DEPT_COLORS[p.dept]} transparent opacity={0.25} />
          </mesh>
        </group>
      ))}
      {/* drei's first <Html> under React 19 can miss its initial mount; this inert sentinel absorbs it. */}
      <Html position={[0, -50, 0]}>
        <span />
      </Html>
      {pods.map((p) => (
        <Html key={`label-${p.dept}`} position={[p.x, 0.05, p.z + POD_D / 2 + 0.2]} center zIndexRange={[5, 0]}>
          <div className="pointer-events-none whitespace-nowrap rounded-full border bg-ink-950/80 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: DEPT_COLORS[p.dept], borderColor: `${DEPT_COLORS[p.dept]}55` }}>{DEPT_NAMES[p.dept]}</div>
        </Html>
      ))}
      {agents.map((a) => desks[a.key] && <Desk key={`d-${a.key}`} {...desks[a.key]} color={DEPT_COLORS[a.department]} active={a.status === "working"} />)}
      {agents.map((a) => desks[a.key] && <Avatar key={a.key} agent={a} desk={desks[a.key]} target={walking[a.key] ?? null} selected={selected === a.key} onSelect={onSelect} showBubble={agents.filter((x) => x.status !== "idle").length <= 14} />)}
      {handoffs.filter((h) => desks[h.from] && desks[h.to]).map((h) => <Parcel key={h.id} from={desks[h.from]} to={desks[h.to]} />)}
      <OrbitControls makeDefault target={[0, 0, 0]} maxPolarAngle={Math.PI / 2.25} minDistance={10} maxDistance={60} enableDamping />
    </Canvas>
  );
}
