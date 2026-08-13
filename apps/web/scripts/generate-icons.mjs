import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import sharp from "sharp";

const output = fileURLToPath(new URL("../public/icons/", import.meta.url));
const source = fileURLToPath(new URL("../../android/assets/icon.png", import.meta.url));

await mkdir(output, { recursive: true });

await sharp(source).resize(192, 192).png().toFile(join(output, "plan-192.png"));
await sharp(source).resize(512, 512).png().toFile(join(output, "plan-512.png"));
const foreground = await sharp(source).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#ffffff" } })
  .composite([{ input: foreground, left: 51, top: 51 }])
  .png()
  .toFile(join(output, "plan-maskable-512.png"));
