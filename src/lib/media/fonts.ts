import path from "node:path";
import fs from "node:fs";

/**
 * Hosts without system fonts render burned-in captions and SVG text with the
 * DejaVu fonts in assets/fonts. FONTCONFIG_FILE is inherited by FFmpeg child
 * processes. Adapted from the WEBSTER engine (seanwebsters/ipgenerator).
 */
export function ensureFonts() {
  if (process.env.FONTCONFIG_FILE) return;
  const conf = path.join(process.cwd(), "assets", "fonts", "fonts.conf");
  if (process.env.CALMLINGS_BUNDLED_FONTS !== "0" && fs.existsSync(conf)) process.env.FONTCONFIG_FILE = conf;
}
