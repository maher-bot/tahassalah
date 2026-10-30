import { AbsoluteFill, useCurrentFrame } from "remotion";
import { content } from "../content";
import { colors, fonts } from "../theme";
import { LogoIcon, Reveal, TwoTone, usePop, useWide, Wordmark } from "../ui";

export const End: React.FC = () => {
  const wide = useWide();
  const frame = useCurrentFrame();
  const logo = usePop(0, 12);
  const btn = usePop(30, 9);
  const breathe = 1 + Math.sin((frame - 30) / 7) * 0.025 * (frame > 45 ? 1 : 0);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, opacity: logo, transform: `scale(${0.85 + logo * 0.15})` }}>
        <LogoIcon size={wide ? 150 : 210} />
        <Wordmark scale={wide ? 0.75 : 1} />
      </div>
      <Reveal delay={12} style={{ marginTop: 30 }}>
        <TwoTone parts={content.brand.tagline} size={wide ? 60 : 72} />
      </Reveal>
      <div style={{
        marginTop: wide ? 40 : 70, transform: `scale(${btn * breathe})`, background: colors.orange, color: "#fff",
        borderRadius: 80, padding: wide ? "18px 90px" : "26px 120px", fontFamily: fonts.display, fontWeight: 700,
        fontSize: wide ? 64 : 80, boxShadow: "0 16px 40px rgba(242,122,69,0.4)",
      }}>{content.end.button}</div>
      <Reveal delay={48} style={{ marginTop: wide ? 30 : 50 }}>
        <div style={{
          direction: "ltr", background: colors.ink, color: "#fff", borderRadius: 60, padding: wide ? "12px 50px" : "16px 60px",
          fontFamily: fonts.display, fontWeight: 700, fontSize: wide ? 46 : 56,
        }}>{content.end.url}</div>
      </Reveal>
    </AbsoluteFill>
  );
};
