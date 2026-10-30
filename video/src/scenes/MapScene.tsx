import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { content } from "../content";
import { colors, fonts } from "../theme";
import { Reveal, TwoTone, usePop, useWide } from "../ui";

const W = 600, H = 700;
const pinColor = { orange: colors.orange, green: colors.green, yellow: colors.yellow } as const;
// مواقع الدبابيس على الخريطة (نفس ترتيب content.map.pins)
const spots = [
  { x: 480, y: 170, labelDx: -10, labelDy: -80 },
  { x: 120, y: 420, labelDx: 50, labelDy: -80 },
  { x: 470, y: 580, labelDx: -10, labelDy: -80 },
];
const blocks = [
  [20, 20, 165, 195], [215, 20, 170, 95], [215, 130, 170, 85], [415, 20, 165, 195],
  [20, 245, 165, 220], [215, 245, 170, 220], [415, 245, 165, 220],
  [20, 495, 165, 185], [215, 495, 170, 185], [415, 495, 165, 110], [415, 620, 165, 60],
];
const route = "M300 360 V230 H480 V200";

const Pin: React.FC<{ color: string }> = ({ color }) => (
  <svg width="56" height="72" viewBox="0 0 24 31">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 19 12 19s12-10 12-19C24 5.4 18.6 0 12 0z" fill={color} />
    <circle cx="12" cy="11.5" r="4.2" fill="#fff" />
  </svg>
);

type MapText = { title: readonly string[]; pins: readonly { label: string; color: string }[]; caption: string };

const PinOnMap: React.FC<{ i: number; pins: MapText["pins"] }> = ({ i, pins }) => {
  const s = spots[i];
  const pin = pins[i];
  const p = usePop(18 + i * 14, 10);
  return (
    <div style={{ position: "absolute", left: s.x, top: s.y, transform: `translate(-50%, -100%) scale(${p})`, transformOrigin: "50% 100%" }}>
      <div style={{
        position: "absolute", bottom: 84, left: "50%", transform: `translateX(-50%)`, whiteSpace: "nowrap",
        background: "#fff", borderRadius: 18, padding: "6px 16px", fontFamily: fonts.body, fontWeight: 600, fontSize: 26,
        color: colors.ink, boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
      }}>{pin.label}</div>
      <Pin color={pinColor[pin.color as keyof typeof pinColor]} />
    </div>
  );
};

const MapCard: React.FC<{ pins: MapText["pins"] }> = ({ pins }) => {
  const frame = useCurrentFrame();
  const routeP = interpolate(frame, [75, 110], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pulse = (frame % 45) / 45;
  return (
    <div style={{ position: "relative", width: W, height: H, borderRadius: 40, background: colors.map, overflow: "hidden", boxShadow: "0 20px 50px rgba(13,92,78,0.15)" }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <rect width={W} height={H} fill="#F4F8F6" />
        {blocks.map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} rx={18} fill={colors.mapBlock} />)}
        <defs>
          <mask id="routeMask">
            <path d={route} stroke="#fff" strokeWidth="12" fill="none" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - routeP} />
          </mask>
        </defs>
        <path d={route} stroke={colors.orange} strokeWidth="5" fill="none" strokeDasharray="2 10" strokeLinecap="round" mask="url(#routeMask)" />
        <circle cx={300} cy={360} r={22 + pulse * 30} fill={colors.green} opacity={0.25 * (1 - pulse)} />
        <circle cx={300} cy={360} r={20} fill="#fff" />
        <circle cx={300} cy={360} r={11} fill={colors.ink} />
      </svg>
      {pins.map((_, i) => <PinOnMap key={i} i={i} pins={pins} />)}
    </div>
  );
};

export const MapScene: React.FC<{ text?: MapText }> = ({ text = content.map }) => {
  const wide = useWide();
  const card = usePop(4, 16);
  const k = wide ? 1.25 : 1.55;
  const map = (
    <div style={{ width: W * k, height: H * k, display: "flex", alignItems: "center", justifyContent: "center", opacity: card }}>
      <div style={{ transform: `scale(${k * (0.9 + card * 0.1)})`, flexShrink: 0 }}>
        <MapCard pins={text.pins} />
      </div>
    </div>
  );
  const title = <Reveal delay={0} style={{ textAlign: wide ? "right" : "center", maxWidth: wide ? 760 : 960 }}><TwoTone parts={text.title} size={wide ? 96 : 80} /></Reveal>;
  const caption = (
    <Reveal delay={95}>
      <div style={{ fontSize: wide ? 44 : 48, color: colors.muted }}>{text.caption}</div>
    </Reveal>
  );
  if (wide) {
    return (
      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 160 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>{title}{caption}</div>
        {map}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 170 }}>
      {title}
      <div style={{ marginTop: 90 }}>{map}</div>
      <div style={{ marginTop: 70 }}>{caption}</div>
    </AbsoluteFill>
  );
};
