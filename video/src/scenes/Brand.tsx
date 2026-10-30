import { AbsoluteFill } from "remotion";
import { content } from "../content";
import { colors } from "../theme";
import { PinLogo, Reveal, TwoTone, usePop, useWide, Wordmark } from "../ui";

export const Brand: React.FC = () => {
  const wide = useWide();
  const p = usePop(0, 12);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, transform: `scale(${0.85 + p * 0.15})`, opacity: p }}>
        <PinLogo size={wide ? 120 : 170} />
        <Wordmark scale={wide ? 0.8 : 1} />
      </div>
      <Reveal delay={14} style={{ marginTop: 40 }}>
        <TwoTone parts={content.brand.tagline} size={wide ? 66 : 76} />
      </Reveal>
      <Reveal delay={34} style={{ marginTop: 18 }}>
        <div style={{ fontSize: wide ? 40 : 46, color: colors.muted }}>{content.brand.sub}</div>
      </Reveal>
    </AbsoluteFill>
  );
};
