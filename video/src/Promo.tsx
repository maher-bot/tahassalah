import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { Brand } from "./scenes/Brand";
import { End } from "./scenes/End";
import { Hook } from "./scenes/Hook";
import { MapScene } from "./scenes/MapScene";
import { Merchants } from "./scenes/Merchants";
import { Why } from "./scenes/Why";
import { sec } from "./theme";
import { Background, Scene } from "./ui";

// ترتيب المشاهد ومدة كل واحد (بالثواني) — المجموع 30
const scenes = [
  { C: Hook, s: 3.5 },
  { C: Brand, s: 4.5 },
  { C: MapScene, s: 7 },
  { C: Why, s: 6 },
  { C: Merchants, s: 4.5 },
  { C: End, s: 4.5 },
];

export const Promo: React.FC = () => {
  let from = 0;
  return (
    <AbsoluteFill>
      <Background />
      <Audio src={staticFile("music.m4a")} />
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
    </AbsoluteFill>
  );
};
