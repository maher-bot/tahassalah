import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "./theme";

export const useWide = () => {
  const { width, height } = useVideoConfig();
  return width > height;
};

// 0 → 1 بحركة نابضة تبدأ بعد delay (بالفريمات)
export const usePop = (delay: number, damping = 14) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, mass: 0.7 } });
};

export const Reveal: React.FC<{ delay: number; y?: number; x?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({
  delay, y = 30, x = 0, style, children,
}) => {
  const p = usePop(delay);
  return (
    <div style={{ opacity: Math.min(1, p * 1.4), transform: `translate(${(1 - p) * x}px, ${(1 - p) * y}px)`, ...style }}>
      {children}
    </div>
  );
};

// غلاف المشهد: يظهر ويختفي بنعومة
export const Scene: React.FC<{ duration: number; children: React.ReactNode }> = ({ duration, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8, duration - 8, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity, direction: "rtl", fontFamily: fonts.body }}>{children}</AbsoluteFill>;
};

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 60) * 40;
  return (
    <AbsoluteFill style={{ background: "#FFFFFF" }}>
      <AbsoluteFill style={{
        background: `radial-gradient(circle at ${85 + drift / 20}% ${4 + drift / 30}%, rgba(242,122,69,0.22), transparent 38%),
                     radial-gradient(circle at ${10 - drift / 20}% ${88}%, rgba(13,92,78,0.13), transparent 40%)`,
      }} />
    </AbsoluteFill>
  );
};

// شعار الدبوس مع العدسة
export const PinLogo: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size * 1.25} viewBox="0 0 100 125">
    <path d="M50 0C22.4 0 0 22.4 0 50c0 34 50 75 50 75s50-41 50-75C100 22.4 77.6 0 50 0z" fill={colors.orange} />
    <circle cx="48" cy="46" r="21" fill="#fff" />
    <circle cx="48" cy="46" r="9" fill={colors.ink} />
    <circle cx="48" cy="46" r="13.5" fill="none" stroke={colors.orange} strokeWidth="3" />
    <line x1="62" y1="60" x2="76" y2="74" stroke="#fff" strokeWidth="9" strokeLinecap="round" />
  </svg>
);

// سطر بجزئين: الثاني ملوّن
export const TwoTone: React.FC<{ parts: readonly string[]; size: number; accent?: string; style?: React.CSSProperties }> = ({
  parts, size, accent = colors.orange, style,
}) => (
  <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: size, color: colors.ink, lineHeight: 1.35, ...style }}>
    {parts[0]} <span style={{ color: accent }}>{parts[1]}</span>
  </div>
);

export const Wordmark: React.FC<{ scale?: number }> = ({ scale = 1 }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
    <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 250 * scale, color: colors.ink, lineHeight: 1.1 }}>
      تحصّله
    </div>
    <div style={{ direction: "ltr", fontFamily: fonts.body, fontWeight: 500, fontSize: 40 * scale, letterSpacing: 16 * scale, color: colors.ink, marginTop: 6 * scale }}>
      TAHASSALAH
    </div>
  </div>
);
