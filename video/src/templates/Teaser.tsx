import { AbsoluteFill, Audio, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";
import { Background, LogoIcon } from "../ui";

// إعلان ثابت (بدون حركة ولا صوت) يثير الفضول ويودّي للموقع
export type TeaserProps = {
  callout: string; // النداء أعلى الصفحة
  photo?: string; // صورة من public/ — بدونها تطلع الخريطة الغامضة
  emoji: string; // دبوس الخريطة (لو ما فيه صورة)
  line1: string;
  line2: string; // يطلع بالبرتقالي
  sub: string;
  cta: string; // شارة الدعوة
  pulse?: boolean; // كلمة الحي تنبض مثل التنبيه (لنسخة الفيديو)
  voice?: string; // تعليق صوتي من public/voice (بدون امتداد)
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

const Photo: React.FC<{ src: string; width: number; height: number }> = ({ src, width, height }) => (
  <div style={{ position: "relative", width, height, borderRadius: 44, overflow: "hidden", boxShadow: "0 24px 60px rgba(16,94,81,0.22)" }}>
    <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    <div style={{ position: "absolute", top: 24, left: 24, background: "#fff", borderRadius: "50%", padding: 10, boxShadow: "0 8px 20px rgba(0,0,0,0.15)" }}>
      <LogoIcon size={64} />
    </div>
  </div>
);

// شارة الحي: تكبر وتصغر مع حلقة تتوسع، مثل التنبيه
const Area: React.FC<{ pulse?: boolean }> = ({ pulse }) => {
  const frame = useCurrentFrame();
  const t = pulse ? (frame % 36) / 36 : 0; // نبضة كل 1.2 ثانية
  const beat = pulse ? 1 + 0.14 * Math.max(0, Math.sin(t * Math.PI * 2)) : 1;
  return (
    <div style={{ position: "relative", display: "grid", placeItems: "center", marginInlineStart: 26 }}>
      {pulse && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: 60, border: `5px solid ${colors.orange}`,
          transform: `scale(${1 + t * 0.45})`, opacity: 1 - t,
        }} />
      )}
      <div style={{
        transform: `scale(${beat})`, background: colors.orange, color: "#fff", borderRadius: 60,
        padding: "8px 30px", fontFamily: fonts.display, fontWeight: 700, fontSize: 44,
        boxShadow: "0 10px 26px rgba(255,123,71,0.4)",
      }}>📍 الشرائع</div>
    </div>
  );
};

export const Teaser: React.FC<TeaserProps> = ({ callout, photo, emoji, line1, line2, sub, cta, pulse, voice }) => {
  const story = useVideoConfig().height > 1500;
  return (
    <AbsoluteFill style={{ direction: "rtl", fontFamily: fonts.body }}>
      <Background />
      {voice && <Audio src={staticFile(`voice/${voice}.mp3`)} />}
      {/* آخر 20% من الشاشة فاضي لزر سناب/تيك توك */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "space-between", padding: story ? "80px 64px 400px" : "56px 56px 56px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
            <LogoIcon size={58} />
            <div style={{ fontFamily: fonts.logo, fontWeight: 700, fontSize: 46, color: colors.ink }}>تحصّله</div>
            <Area pulse={pulse} />
          </div>
          <div style={{ background: colors.ink, color: "#fff", borderRadius: 60, padding: "14px 44px", fontFamily: fonts.display, fontWeight: 700, fontSize: 50 }}>
            {callout}
          </div>
        </div>
        {photo ? <Photo src={photo} width={950} height={story ? 720 : 520} /> : <MysteryMap emoji={emoji} scale={story ? 0.95 : 0.6} />}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 76, color: colors.ink, lineHeight: 1.3 }}>{line1}</div>
          <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 76, color: colors.orange, lineHeight: 1.3 }}>{line2}</div>
          <div style={{ fontSize: 44, color: colors.muted, marginTop: 16 }}>{sub}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
          <div style={{
            background: colors.orange, color: "#fff", borderRadius: 60, padding: "16px 48px",
            fontFamily: fonts.display, fontWeight: 700, fontSize: 46, whiteSpace: "nowrap", boxShadow: "0 14px 34px rgba(255,123,71,0.35)",
          }}>{cta}</div>
          <div style={{ direction: "ltr", background: colors.ink, color: "#fff", borderRadius: 70, padding: "12px 52px", fontFamily: fonts.display, fontWeight: 700, fontSize: 48 }}>
            tahassalah.com
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
