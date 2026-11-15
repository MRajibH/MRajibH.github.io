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
