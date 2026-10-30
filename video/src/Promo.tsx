import { AbsoluteFill, Audio, interpolate, Sequence, staticFile } from "remotion";
import { Captions, Word } from "./Captions";
import { Brand } from "./scenes/Brand";
import { End } from "./scenes/End";
import { Hook } from "./scenes/Hook";
import { MapScene } from "./scenes/MapScene";
import { Merchants } from "./scenes/Merchants";
import { Why } from "./scenes/Why";
import { Lines, Offer } from "./scenes/Lines";
import { content } from "./content";
import { sec } from "./theme";
import { Background, Scene } from "./ui";

// ترتيب المشاهد ومدة كل واحد (بالثواني)
export const variants = {
  full: [
    { C: Hook, s: 3.5 },
    { C: Brand, s: 4.5 },
    { C: MapScene, s: 7 },
    { C: Why, s: 6 },
    { C: Merchants, s: 4.5 },
    { C: End, s: 4.5 },
  ],
  // إعلان الأسر المنتجة في الشرائع
  families: [
    { C: () => <Hook text={content.families.hook} />, s: 3 },
    { C: () => <Lines {...content.families.value} />, s: 3.5 },
    { C: () => <MapScene text={content.families.map} />, s: 5.5 },
    { C: () => <Why text={content.families.why} />, s: 5 },
    { C: () => <Offer {...content.families.offer} />, s: 3 },
    { C: () => <End button={content.families.button} />, s: 4 },
  ],
  ad15: [
    { C: Hook, s: 2.5 },
    { C: MapScene, s: 5 },
    { C: Why, s: 4 },
    { C: End, s: 3.5 },
  ],
};

export type PromoProps = {
  variant: keyof typeof variants;
  // اسم ملف من public/voice (بدون امتداد) — يضيف التعليق الصوتي والكابشن
  voice?: string;
  words?: Word[];
};

export const promoFrames = (variant: keyof typeof variants) =>
  variants[variant].reduce((n, { s }) => n + sec(s), 0);

export const Promo: React.FC<PromoProps> = ({ variant, voice, words = [] }) => {
  const scenes = variants[variant];
  const total = promoFrames(variant);
  // الموسيقى تخف تحت الصوت، وتختفي تدريجيًا آخر ثانية
  const music = (f: number) => (voice ? 0.25 : 1) * interpolate(f, [total - 30, total], [1, 0], { extrapolateLeft: "clamp" });
  let from = 0;
  return (
    <AbsoluteFill>
      <Background />
      <Audio src={staticFile("music.m4a")} volume={music} />
      {voice && <Audio src={staticFile(`voice/${voice}.mp3`)} />}
      {scenes.map(({ C, s }, i) => {
        const d = sec(s);
        const el = (
          <Sequence key={i} from={from} durationInFrames={d}>
            <Scene duration={i === scenes.length - 1 ? d + 20 : d}><C /></Scene>
          </Sequence>
        );
        from += d;
        return el;
      })}
      {words.length > 0 && <Captions words={words} />}
    </AbsoluteFill>
  );
};
