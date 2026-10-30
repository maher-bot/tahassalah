import { Config } from "@remotion/cli/config";
import { existsSync, readdirSync } from "fs";

Config.setVideoImageFormat("jpeg");
Config.setCodec("h264");
Config.setCrf(20);

// في جلسات Claude السحابية ما يقدر Remotion ينزّل متصفحه، فنستخدم المتصفح المثبّت مسبقًا
const pw = "/opt/pw-browsers";
if (existsSync(pw)) {
  const shell = readdirSync(pw).find((d) => d.startsWith("chromium_headless_shell-"));
  if (shell) {
    const dir = readdirSync(`${pw}/${shell}`).find((d) => d.startsWith("chrome-headless-shell"));
    if (dir) Config.setBrowserExecutable(`${pw}/${shell}/${dir}/chrome-headless-shell`);
  }
}
