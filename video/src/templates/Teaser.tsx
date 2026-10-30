import { AbsoluteFill, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";
import { Background, LogoIcon } from "../ui";

// إعلان ثابت (بدون حركة ولا صوت) يثير الفضول ويودّي للموقع
export type TeaserProps = {
  emoji: string; // الدبوس المميّز على الخريطة
  line1: string;
  line2: string; // يطلع بالبرتقالي
  sub: string;
  offer: string; // شارة العرض
};

const blocks = [
  [20, 20, 165, 195], [215, 20, 170, 95], [215, 130, 170, 85], [415, 20, 165, 195],
  [20, 245, 165, 220], [215, 245, 170, 220], [415, 245, 165, 220],
  [20, 495, 165, 185], [215, 495, 170, 185], [415, 495, 165, 110], [415, 620, 165, 60],
];

// خريطة باهتة فيها دبابيس غامضة ودبوس واحد واضح
const MysteryMap: React.FC<{ emoji: string; scale: number }> = ({ emoji, scale }) => (
  <div style={{ position: "relative", width: 600 * scale, height: 700 * scale }}>
    <svg viewBox="0 0 600 700" width={600 * scale} height={700 * scale} style={{ position: "absolute", inset: 0, borderRadius: 40 * scale, boxShadow: "0 20px 50px rgba(16,94,81,0.15)" }}>
      <rect width="600" height="700" rx="40" fill="#F4F8F6" />
      {blocks.map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} rx={18} fill={colors.mapBlock} />)}
      {[[110, 130], [480, 380], [300, 600], [110, 560]].map(([x, y], i) => (
        <g key={i} opacity={0.35}>
          <circle cx={x} cy={y} r={26} fill={colors.ink} />
          <text x={x} y={y + 11} textAnchor="middle" fontSize="30" fontFamily={fonts.display} fontWeight={700} fill="#fff">?</text>
        </g>
      ))}
      <circle cx={300} cy={330} r={70} fill={colors.orange} opacity={0.12} />
      <circle cx={300} cy={330} r={44} fill={colors.orange} opacity={0.2} />
    </svg>
    <div style={{ position: "absolute", left: 300 * scale, top: 330 * scale, transform: "translate(-50%, -88%)" }}>
      <svg width={120 * scale} height={155 * scale} viewBox="0 0 24 31">
        <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 19 12 19s12-10 12-19C24 5.4 18.6 0 12 0z" fill={colors.orange} />
        <circle cx="12" cy="11.5" r="7.5" fill="#fff" />
      </svg>
      <div style={{ position: "absolute", top: 18 * scale, left: 0, width: 120 * scale, textAlign: "center", fontSize: 56 * scale }}>{emoji}</div>
    </div>
  </div>
);

export const Teaser: React.FC<TeaserProps> = ({ emoji, line1, line2, sub, offer }) => {
  const story = useVideoConfig().height > 1500;
  return (
  <AbsoluteFill style={{ direction: "rtl", fontFamily: fonts.body }}>
    <Background />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "space-between", padding: story ? "90px 70px 400px" : "60px 60px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, alignSelf: "flex-start" }}>
        <LogoIcon size={72} />
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 38, color: colors.ink }}>الشرائع</div>
      </div>
      <MysteryMap emoji={emoji} scale={story ? 1.0 : 0.6} />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 84, color: colors.ink, lineHeight: 1.3 }}>{line1}</div>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 84, color: colors.orange, lineHeight: 1.3 }}>{line2}</div>
        <div style={{ fontSize: 42, color: colors.muted, marginTop: 24 }}>{sub}</div>
      </div>
      <div style={{
        background: colors.orange, color: "#fff", borderRadius: 60, padding: "18px 48px",
        fontFamily: fonts.display, fontWeight: 700, fontSize: 52, boxShadow: "0 14px 34px rgba(255,123,71,0.35)",
      }}>{offer}</div>
      <div style={{ direction: "ltr", background: colors.ink, color: "#fff", borderRadius: 70, padding: "16px 56px", fontFamily: fonts.display, fontWeight: 700, fontSize: 54 }}>
        tahassalah.com
      </div>
    </AbsoluteFill>
  </AbsoluteFill>
);
};
