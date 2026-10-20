/** Look-and-feel presets for the 3D office. Generated Nano Banana textures layer on top of these. */
export interface OfficeTheme {
  key: string;
  label: string;
  dark: boolean;
  background: string;
  floor: string;
  wall: string;
  frame: string;
  sky: [string, string, string];
  deskTop: string;
  deskLeg: string;
  chair: string;
  screen: string;
  rugTint: number;
  plant: string;
  pot: string;
  hemi: [string, string, number];
  sun: [string, number];
  shadowOpacity: number;
}

export const OFFICE_THEMES: Record<string, OfficeTheme> = {
  daylight: {
    key: "daylight",
    label: "Daylight studio",
    dark: false,
    background: "#dfe5ec",
    floor: "#dcd5ca",
    wall: "#f3f0ea",
    frame: "#2b2f38",
    sky: ["#a9c8ec", "#d6e6f5", "#f4efe6"],
    deskTop: "#fbfaf7",
    deskLeg: "#3b3f47",
    chair: "#4a505c",
    screen: "#1b2030",
    rugTint: 0.42,
    plant: "#5f9b6b",
    pot: "#efe9df",
    hemi: ["#ffffff", "#b7ab98", 1.05],
    sun: ["#fff4e2", 2.1],
    shadowOpacity: 0.38,
  },
  pastel: {
    key: "pastel",
    label: "Calm pastel",
    dark: false,
    background: "#ece6f3",
    floor: "#f1ece6",
    wall: "#f8f3f6",
    frame: "#8d86a8",
    sky: ["#c9b8ec", "#f3d3e4", "#fdf1e6"],
    deskTop: "#fffdfb",
    deskLeg: "#a49cbc",
    chair: "#b9b0d2",
    screen: "#2a2540",
    rugTint: 0.5,
    plant: "#7fb38e",
    pot: "#f6dfe4",
    hemi: ["#ffffff", "#d8c8e0", 1.1],
    sun: ["#fff0f4", 1.8],
    shadowOpacity: 0.28,
  },
  dusk: {
    key: "dusk",
    label: "Golden hour loft",
    dark: false,
    background: "#e7d6c4",
    floor: "#b98c62",
    wall: "#efe2d2",
    frame: "#2a211b",
    sky: ["#5d6aa8", "#f0a36b", "#ffd8a1"],
    deskTop: "#f7efe4",
    deskLeg: "#2a211b",
    chair: "#5a4335",
    screen: "#1d1a22",
    rugTint: 0.38,
    plant: "#55804f",
    pot: "#d9c3a8",
    hemi: ["#ffe7c9", "#6b4a33", 0.95],
    sun: ["#ffc98c", 2.3],
    shadowOpacity: 0.42,
  },
  midnight: {
    key: "midnight",
    label: "Midnight neon",
    dark: true,
    background: "#070b1a",
    floor: "#121a36",
    wall: "#141d3d",
    frame: "#05070f",
    sky: ["#04060f", "#16205a", "#3a2a6e"],
    deskTop: "#d9dcea",
    deskLeg: "#26315b",
    chair: "#3a4672",
    screen: "#0b1229",
    rugTint: 0.22,
    plant: "#3f7f66",
    pot: "#26315b",
    hemi: ["#bcd2ff", "#0b1229", 0.75],
    sun: ["#9fb8ff", 1.2],
    shadowOpacity: 0.55,
  },
};

export const DEFAULT_OFFICE_THEME = "daylight";

export interface OfficeSkinView {
  theme: string;
  prompt: string | null;
  floorUrl: string | null;
  wallUrl: string | null;
  rugUrl: string | null;
  model: string | null;
  generatedAt: string | null;
}

export const SKIN_PARTS = ["floor", "wall", "rug"] as const;
export type SkinPart = (typeof SKIN_PARTS)[number];
export const SKIN_PART_LABELS: Record<SkinPart, string> = { floor: "Floor", wall: "Window view", rug: "Team rugs" };
