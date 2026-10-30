import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";
import files from "./fonts.json";

// نفس خطوط الموقع (app.css)، محفوظة داخل public/fonts عشان الريندر ما يحتاج إنترنت
for (const f of files) {
  loadFont({ family: f.family, url: staticFile(f.file), weight: f.weight, unicodeRange: f.unicodeRange, format: "woff2" });
}

export const fonts = {
  display: "'Readex Pro', 'IBM Plex Sans Arabic', sans-serif",
  body: "'IBM Plex Sans Arabic', sans-serif",
};

export const colors = {
  ink: "#105E51",
  orange: "#FF7B47",
  yellow: "#E9B10C",
  green: "#105E51",
  muted: "#6B7F7A",
  map: "#E3EEEA",
  mapBlock: "#D2E3DD",
  card: "#FFFFFF",
  iconBg: "#E6F0EC",
};

export const FPS = 30;
export const sec = (s: number) => Math.round(s * FPS);
