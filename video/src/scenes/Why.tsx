import { AbsoluteFill } from "remotion";
import { content } from "../content";
import { colors, fonts } from "../theme";
import { Reveal, TwoTone, useWide } from "../ui";

const Card: React.FC<{ icon: string; title: string; sub: string; wide: boolean }> = ({ icon, title, sub, wide }) => {
  const percent = icon === "0%";
  const iconBox = (
    <div style={{
      width: 130, height: 130, borderRadius: 30, flexShrink: 0, display: "grid", placeItems: "center",
      background: percent ? colors.orange : colors.iconBg, color: "#fff",
      fontFamily: fonts.display, fontWeight: 700, fontSize: percent ? 56 : 64,
    }}>{icon}</div>
  );
  return (
    <div style={{
      background: colors.card, borderRadius: 40, boxShadow: "0 16px 44px rgba(13,92,78,0.10)",
      display: "flex", flexDirection: wide ? "column" : "row", alignItems: "center", gap: 36,
      padding: wide ? "50px 40px" : "40px 50px", width: wide ? 540 : 900, textAlign: wide ? "center" : "right",
    }}>
      {iconBox}
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: wide ? 48 : 54, color: colors.ink, whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ fontSize: 36, color: colors.muted, marginTop: 6 }}>{sub}</div>
      </div>
    </div>
  );
};

type WhyText = { title: readonly string[]; cards: readonly { icon: string; title: string; sub: string }[] };

export const Why: React.FC<{ text?: WhyText }> = ({ text = content.why }) => {
  const wide = useWide();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: wide ? "center" : "flex-start", paddingTop: wide ? 0 : 330, gap: wide ? 70 : 90 }}>
      <Reveal delay={0}><TwoTone parts={text.title} size={wide ? 96 : 100} /></Reveal>
      <div style={{ display: "flex", flexDirection: wide ? "row" : "column", gap: 44 }}>
        {text.cards.map((c, i) => (
          <Reveal key={i} delay={15 + i * 30} x={wide ? 0 : -300} y={wide ? 80 : 0}>
            <Card {...c} wide={wide} />
          </Reveal>
        ))}
      </div>
    </AbsoluteFill>
  );
};
