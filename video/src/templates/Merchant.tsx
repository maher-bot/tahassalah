import { AbsoluteFill, Audio, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Captions, Word } from "../Captions";
import { colors, fonts, sec } from "../theme";
import { Background, PinLogo, Reveal, Scene, TwoTone, usePop, useWide } from "../ui";

// قالب فيديو يعرّف بتاجر — غيّر البيانات وطلّع فيديو جديد
export type MerchantProps = {
  name: string;
  category: string; // مثل: "🍲 أسرة منتجة" أو "🏪 متجر" أو "🛒 بسطة"
  area: string; // الحي
  // صور من public/ (مثل "merchants/umfahad/1.jpg") أو روابط — مع وصف قصير لكل صورة
  photos: { src: string; caption: string }[];
  offer?: string;
  voice?: string;
  words?: Word[];
};

const INTRO = 3, PHOTO = 2.5, PLACE = 3, CTA = 3.5;
export const merchantFrames = (p: MerchantProps) => sec(INTRO + Math.max(1, p.photos.length) * PHOTO + PLACE + CTA);

const src = (s: string) => (/^https?:/.test(s) ? s : staticFile(s));

const Intro: React.FC<MerchantProps> = ({ name, category }) => {
  const wide = useWide();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
      <Reveal delay={0}><div style={{ fontSize: wide ? 50 : 56, color: colors.muted }}>تعرّف على</div></Reveal>
      <Reveal delay={8}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: wide ? 150 : 140, color: colors.ink, textAlign: "center", lineHeight: 1.2 }}>{name}</div>
      </Reveal>
      <Reveal delay={20}>
        <div style={{ background: colors.iconBg, color: colors.ink, borderRadius: 50, padding: "12px 40px", fontFamily: fonts.display, fontWeight: 700, fontSize: wide ? 46 : 52 }}>
          {category}
        </div>
      </Reveal>
    </AbsoluteFill>
  );
};

const Photo: React.FC<{ photo?: { src: string; caption: string }; category: string }> = ({ photo, category }) => {
  const frame = useCurrentFrame();
  const wide = useWide();
  const zoom = interpolate(frame, [0, sec(PHOTO)], [1.04, 1.14]);
  const box = wide ? { width: 1300, height: 820 } : { width: 940, height: 1250 };
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40 }}>
      <Reveal delay={0} y={60}>
        <div style={{ ...box, borderRadius: 48, overflow: "hidden", boxShadow: "0 24px 60px rgba(16,94,81,0.18)", background: colors.iconBg, display: "grid", placeItems: "center" }}>
          {photo
            ? <Img src={src(photo.src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom})` }} />
            : <div style={{ fontSize: 300, transform: `scale(${zoom})` }}>{[...category][0]}</div>}
        </div>
      </Reveal>
      {photo?.caption && (
        <Reveal delay={10}>
          <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: wide ? 56 : 64, color: colors.ink }}>{photo.caption}</div>
        </Reveal>
      )}
    </AbsoluteFill>
  );
};

const Place: React.FC<MerchantProps> = ({ area }) => {
  const wide = useWide();
  const pin = usePop(4, 9);
  const frame = useCurrentFrame();
  const pulse = (frame % 40) / 40;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 50 }}>
      <div style={{ position: "relative", display: "grid", placeItems: "center", width: 360, height: 360 }}>
        <div style={{ position: "absolute", width: 360, height: 360, borderRadius: "50%", background: colors.orange, opacity: 0.18 * (1 - pulse), transform: `scale(${0.5 + pulse * 0.6})` }} />
        <div style={{ transform: `translateY(${(1 - pin) * -300}px)` }}><PinLogo size={170} /></div>
      </div>
      <Reveal delay={14} style={{ textAlign: "center" }}>
        <TwoTone parts={["قريب منك في", ""]} size={wide ? 84 : 90} />
        <TwoTone parts={["", area]} size={wide ? 96 : 110} />
      </Reveal>
      <Reveal delay={26}><div style={{ fontSize: wide ? 46 : 50, color: colors.muted }}>شوف موقعه مباشر على الخريطة</div></Reveal>
    </AbsoluteFill>
  );
};

const Cta: React.FC<MerchantProps> = ({ name, offer }) => {
  const wide = useWide();
  const btn = usePop(20, 9);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40 }}>
      <Reveal delay={0}><TwoTone parts={[`اطلب من ${name}`, "على تحصّله"]} size={wide ? 84 : 86} style={{ textAlign: "center", maxWidth: 950 }} /></Reveal>
      {offer && (
        <Reveal delay={10}>
          <div style={{ background: colors.orange, color: "#fff", borderRadius: 60, padding: "16px 46px", fontFamily: fonts.display, fontWeight: 700, fontSize: wide ? 46 : 52 }}>{offer}</div>
        </Reveal>
      )}
      <div style={{ transform: `scale(${btn})`, direction: "ltr", background: colors.ink, color: "#fff", borderRadius: 60, padding: "16px 60px", fontFamily: fonts.display, fontWeight: 700, fontSize: wide ? 50 : 58 }}>
        tahassalah.com
      </div>
    </AbsoluteFill>
  );
};

export const Merchant: React.FC<MerchantProps> = (props) => {
  const photos = props.photos.length ? props.photos : [undefined];
  const parts: { d: number; el: React.ReactNode }[] = [
    { d: sec(INTRO), el: <Intro {...props} /> },
    ...photos.map((p) => ({ d: sec(PHOTO), el: <Photo photo={p} category={props.category} /> })),
    { d: sec(PLACE), el: <Place {...props} /> },
    { d: sec(CTA), el: <Cta {...props} /> },
  ];
  const total = parts.reduce((n, p) => n + p.d, 0);
  let from = 0;
  return (
    <AbsoluteFill>
      <Background />
      <Audio src={staticFile("music.m4a")} volume={(f) => (props.voice ? 0.25 : 1) * interpolate(f, [total - 30, total], [1, 0], { extrapolateLeft: "clamp" })} />
      {props.voice && <Audio src={staticFile(`voice/${props.voice}.mp3`)} />}
      {parts.map((p, i) => {
        const s = (
          <Sequence key={i} from={from} durationInFrames={p.d}>
            <Scene duration={i === parts.length - 1 ? p.d + 20 : p.d}>{p.el}</Scene>
          </Sequence>
        );
        from += p.d;
        return s;
      })}
      {props.words && props.words.length > 0 && <Captions words={props.words} />}
    </AbsoluteFill>
  );
};
