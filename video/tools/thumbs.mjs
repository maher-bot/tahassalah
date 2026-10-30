// يطلّع صورة غلاف (JPG) لكل فيديو في out/ — الإطار المختار من مشهد الشعار
// الاستخدام: npm run thumbs            (كل الفيديوهات)
//            npm run thumbs -- Promo    (اللي يبدأ اسمه بـ Promo)
import { execFileSync } from "node:child_process";

const filter = process.argv[2] ?? "";
const list = execFileSync("npx", ["remotion", "compositions", "-q"], { encoding: "utf8" }).trim().split(/\s+/);
// رقم الإطار لكل نوع (إطار فيه الشعار واضح)
const frameFor = (id) => (id.startsWith("Promo") ? 200 : id.startsWith("Ad15") ? 30 : 40);

for (const id of list.filter((c) => /^(Promo|Ad15|Merchant)-/.test(c) && c.startsWith(filter))) {
  const out = `out/${id.replace(/^Promo-/, "promo-").toLowerCase()}.jpg`;
  execFileSync("npx", ["remotion", "still", id, out, `--frame=${frameFor(id)}`, "--image-format=jpeg", "--jpeg-quality=85", "--log=error"], { stdio: "inherit" });
  console.log("✓", out);
}
