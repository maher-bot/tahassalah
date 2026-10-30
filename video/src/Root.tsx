import { CalculateMetadataFunction, Composition, Folder } from "remotion";
import { loadVoice } from "./Captions";
import { merchants } from "./merchants";
import { Promo, promoFrames, PromoProps } from "./Promo";
import { Merchant, merchantFrames, MerchantProps } from "./templates/Merchant";
import { Teaser } from "./templates/Teaser";
import { content } from "./content";
import { Still } from "remotion";
import { FPS } from "./theme";

const sizes = [
  { tag: "9x16", width: 1080, height: 1920 },
  { tag: "16x9", width: 1920, height: 1080 },
];

// يحسب المدة ويحمّل توقيت الكلمات إذا فيه تعليق صوتي
const promoMeta: CalculateMetadataFunction<PromoProps> = async ({ props }) => ({
  durationInFrames: promoFrames(props.variant),
  props: { ...props, words: props.voice ? await loadVoice(props.voice) : props.words ?? [] },
});
const merchantMeta: CalculateMetadataFunction<MerchantProps> = async ({ props }) => ({
  durationInFrames: merchantFrames(props),
  props: { ...props, words: props.voice ? await loadVoice(props.voice) : props.words ?? [] },
});

export const RemotionRoot: React.FC = () => (
  <>
    <Folder name="Teasers">
      {Object.entries(content.teasers).flatMap(([id, t]) => [
        <Still key={`${id}-story`} id={`Teaser-${id}-story`} component={Teaser} defaultProps={t} width={1080} height={1920} />,
        <Still key={`${id}-post`} id={`Teaser-${id}-post`} component={Teaser} defaultProps={t} width={1080} height={1350} />,
      ])}
    </Folder>
    {sizes.map(({ tag, width, height }) => (
      <Folder key={tag} name={`s${tag}`}>
        <Composition id={`Promo-${tag}`} component={Promo} defaultProps={{ variant: "full" } as PromoProps}
          calculateMetadata={promoMeta} durationInFrames={1} fps={FPS} width={width} height={height} />
        <Composition id={`Ad15-${tag}`} component={Promo} defaultProps={{ variant: "ad15" } as PromoProps}
          calculateMetadata={promoMeta} durationInFrames={1} fps={FPS} width={width} height={height} />
        <Composition id={`Families-${tag}`} component={Promo} defaultProps={{ variant: "families" } as PromoProps}
          calculateMetadata={promoMeta} durationInFrames={1} fps={FPS} width={width} height={height} />
        {Object.entries(merchants).map(([id, m]) => (
          <Composition key={id} id={`Merchant-${id}-${tag}`} component={Merchant} defaultProps={m}
            calculateMetadata={merchantMeta} durationInFrames={1} fps={FPS} width={width} height={height} />
        ))}
      </Folder>
    ))}
  </>
);
