import { CalculateMetadataFunction, Composition, Folder } from "remotion";
import { loadVoice } from "./Captions";
import { merchants } from "./merchants";
import { Promo, promoFrames, PromoProps } from "./Promo";
import { Merchant, merchantFrames, MerchantProps } from "./templates/Merchant";
import { Teaser } from "./templates/Teaser";
import { content } from "./content";
import { Still } from "remotion";
import { FPS, sec } from "./theme";

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

// تعليقات صوتية مسجّلة على الإعلانات الثابتة (public/voice) — المدة = طول الصوت + ثانية تقريبًا
const teaserVoices: Record<string, { voice: string; seconds: number }> = {
  families: { voice: "families-vo", seconds: 19.5 },
  vendors: { voice: "vendors-vo", seconds: 16.5 },
  shops: { voice: "shops-vo", seconds: 16.5 },
};

export const RemotionRoot: React.FC = () => (
  <>
    <Folder name="Teasers">
      {Object.entries(content.teasers).flatMap(([id, t]) => [
        <Still key={`${id}-story`} id={`Teaser-${id}-story`} component={Teaser} defaultProps={t} width={1080} height={1920} />,
        // نسخة الفيديو: الحي ينبض، والأسر معها التعليق الصوتي
        <Composition key={`${id}-video`} id={`TeaserVideo-${id}`} component={Teaser}
          defaultProps={{ ...t, pulse: true, voice: teaserVoices[id]?.voice }}
          durationInFrames={sec(teaserVoices[id]?.seconds ?? 6)} fps={FPS} width={1080} height={1920} />,
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
