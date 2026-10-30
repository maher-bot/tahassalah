import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { content } from "../content";
import { colors } from "../theme";
import { LogoIcon, Reveal, TwoTone, usePop, useWide } from "../ui";

export const Hook: React.FC<{ text?: { line1: string; line2: string } }> = ({ text = content.hook }) => {
  const frame = useCurrentFrame();
  const wide = useWide();
  const drop = usePop(0, 11);
  const ring = (start: number) => {
    const t = interpolate(frame, [start, start + 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return { transform: `scale(${0.3 + t * 1.4})`, opacity: t === 0 ? 0 : 1 - t };
  };
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: wide ? 110 : 90 }}>
      <div style={{ position: "relative", transform: `translateY(${(1 - drop) * -500}px)` }}>
        {[14, 34].map((s) => (
          <div key={s} style={{
            position: "absolute", left: "50%", top: "50%", width: 260, height: 260, marginLeft: -130, marginTop: -130,
            borderRadius: "50%", border: `5px solid ${colors.orange}`, ...ring(s),
          }} />
        ))}
        <LogoIcon size={wide ? 190 : 260} />
      </div>
      <div style={{ textAlign: "center" }}>
        <Reveal delay={22}><TwoTone parts={[text.line1, ""]} size={wide ? 104 : 150} /></Reveal>
        <Reveal delay={40}>
          <TwoTone parts={["", text.line2]} size={wide ? 104 : 150} style={{ marginTop: -10 }} />
        </Reveal>
      </div>
    </AbsoluteFill>
  );
};
