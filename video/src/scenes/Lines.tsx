import { AbsoluteFill } from "remotion";
import { colors } from "../theme";
import { Reveal, TwoTone, usePop, useWide } from "../ui";
import { fonts } from "../theme";

// أسطر كبيرة تظهر وحدة وحدة، مع سطر صغير تحتها (اختياري)
export const Lines: React.FC<{ lines: readonly (readonly [string, string, string])[]; sub?: string }> = ({ lines, sub }) => {
  const wide = useWide();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      {lines.map(([a, b, c], i) => (
        <Reveal key={i} delay={4 + i * 14}>
          <TwoTone parts={[a, b]} accent={c === "yellow" ? colors.yellow : colors.orange} size={wide ? 100 : 110} />
        </Reveal>
      ))}
      {sub && (
        <Reveal delay={8 + lines.length * 14} style={{ marginTop: 40 }}>
          <div style={{ fontFamily: fonts.display, fontWeight: 500, fontSize: wide ? 50 : 56, color: colors.muted }}>{sub}</div>
        </Reveal>
      )}
    </AbsoluteFill>
  );
};

// شارة العرض
export const Offer: React.FC<{ badge: string; sub: string }> = ({ badge, sub }) => {
  const wide = useWide();
  const p = usePop(4, 8);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40 }}>
      <div style={{
        transform: `scale(${p}) rotate(${(1 - p) * -8}deg)`, background: colors.orange, color: "#fff", borderRadius: 80,
        padding: wide ? "30px 80px" : "30px 56px", fontFamily: fonts.display, fontWeight: 700, fontSize: wide ? 100 : 84, whiteSpace: "nowrap",
        boxShadow: "0 20px 50px rgba(255,123,71,0.4)",
      }}>{badge}</div>
      <Reveal delay={18}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: wide ? 60 : 64, color: colors.ink }}>{sub}</div>
      </Reveal>
    </AbsoluteFill>
  );
};
