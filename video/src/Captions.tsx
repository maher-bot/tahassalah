import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "./theme";
import { useWide } from "./ui";

// كلمة بتوقيتها بالثواني — نفس صيغة tools/voice.py (وتنفع لمخرجات whisperX بعد تحويل بسيط)
export type Word = { text: string; start: number; end: number };

const WORDS_PER_LINE = 4;

export const Captions: React.FC<{ words: Word[] }> = ({ words }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const wide = useWide();
  const t = frame / fps;

  const lines: Word[][] = [];
  for (let i = 0; i < words.length; i += WORDS_PER_LINE) lines.push(words.slice(i, i + WORDS_PER_LINE));
  const line = lines.find((l) => t >= l[0].start - 0.1 && t <= l[l.length - 1].end + 0.35);
  if (!line) return null;

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: wide ? 70 : 230, direction: "rtl" }}>
      <div style={{
        background: "rgba(16,94,81,0.92)", borderRadius: 28, padding: "14px 34px", maxWidth: "88%",
        fontFamily: fonts.display, fontWeight: 700, fontSize: wide ? 54 : 62, lineHeight: 1.5, color: "#fff", textAlign: "center",
      }}>
        {line.map((w, i) => (
          <span key={i} style={{ color: t >= w.start && t < w.end + 0.05 ? colors.orange : "#fff" }}>{w.text} </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const loadVoice = async (voice?: string): Promise<Word[]> => {
  if (!voice) return [];
  const { staticFile } = await import("remotion");
  const res = await fetch(staticFile(`voice/${voice}.json`));
  return res.json();
};
