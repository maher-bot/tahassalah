import { AbsoluteFill } from "remotion";
import { content } from "../content";
import { colors, fonts } from "../theme";
import { Reveal, TwoTone, usePop, useWide } from "../ui";

export const Merchants: React.FC = () => {
  const wide = useWide();
  const badge = usePop(72, 9);
  const m = content.merchants;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        {m.lines.map(([a, b, c], i) => (
          <Reveal key={i} delay={6 + i * 14}>
            <TwoTone parts={[a, b]} accent={c === "yellow" ? colors.yellow : colors.orange} size={wide ? 92 : 110} />
          </Reveal>
        ))}
      </div>
      <Reveal delay={55} style={{ marginTop: wide ? 40 : 80 }}>
        <TwoTone parts={m.cta} size={wide ? 84 : 100} />
      </Reveal>
      <div style={{
        marginTop: 50, transform: `scale(${badge})`, background: colors.orange, color: "#fff", borderRadius: 60,
        padding: "20px 50px", fontFamily: fonts.display, fontWeight: 700, fontSize: wide ? 48 : 52,
        boxShadow: "0 12px 30px rgba(242,122,69,0.35)",
      }}>{m.offer}</div>
      <Reveal delay={86} style={{ marginTop: 30 }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: wide ? 46 : 50, color: colors.ink }}>
          {m.founders.before}<span style={{ color: colors.orange }}>{m.founders.highlight}</span>
        </div>
      </Reveal>
    </AbsoluteFill>
  );
};
