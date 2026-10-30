import { Composition } from "remotion";
import { Promo } from "./Promo";
import { FPS, sec } from "./theme";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Promo-9x16" component={Promo} durationInFrames={sec(30)} fps={FPS} width={1080} height={1920} />
    <Composition id="Promo-16x9" component={Promo} durationInFrames={sec(30)} fps={FPS} width={1920} height={1080} />
  </>
);
