// Removes the placeholder pages that exist only to satisfy Next.js when a
// dynamic route has no real entries yet (see EMPTY_PLACEHOLDER in
// src/lib/posts.ts), so they are never deployed.
import fs from "node:fs";
import path from "node:path";

const out = path.join(process.cwd(), "out");
for (const dir of ["blog", "topics"]) {
  for (const name of ["__empty", "__empty.html", "__empty.txt"]) {
    fs.rmSync(path.join(out, dir, name), { recursive: true, force: true });
  }
  // A topics/ folder with nothing left in it is removed too.
  const full = path.join(out, dir);
  if (fs.existsSync(full) && fs.readdirSync(full).length === 0) fs.rmdirSync(full);
}

// Next.js exports generated social preview images without a file extension
// (out/opengraph-image). Static hosts then serve them with the wrong content
// type and social networks ignore them. Give them a .png name and point the
// pages at it.
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });

if (fs.existsSync(out)) {
  let renamed = 0;
  for (const file of walk(out)) {
    if (path.basename(file) === "opengraph-image") {
      fs.renameSync(file, file + ".png");
      renamed++;
    }
  }
  if (renamed > 0) {
    for (const file of walk(out)) {
      if (!/\.(html|txt)$/.test(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      const fixed = text.replace(/\/opengraph-image(?=[?"\\])/g, "/opengraph-image.png");
      if (fixed !== text) fs.writeFileSync(file, fixed);
    }
  }
  console.log(`Export cleaned: ${renamed} social preview image(s).`);
}
