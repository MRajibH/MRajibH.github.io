// Writes public/ads.txt from the AdSense client id, so the file can never
// disagree with the id the site is built with. Without the id, no file.
import fs from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), "public", "ads.txt");
const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? "";
const match = client.match(/^ca-(pub-\d+)$/);

if (match) {
  fs.writeFileSync(file, `google.com, ${match[1]}, DIRECT, f08c47fec0942fa0\n`);
  console.log(`ads.txt written for ${match[1]}.`);
} else {
  if (client) console.warn(`NEXT_PUBLIC_ADSENSE_CLIENT "${client}" is not in the form ca-pub-<digits>; ads.txt not written.`);
  fs.rmSync(file, { force: true });
}
