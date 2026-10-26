import { rmSync } from 'node:fs';
// Fixed project-relative build artefacts; independent of shell syntax.
for (const name of ['dist', 'server.js']) rmSync(new URL(`../${name}`, import.meta.url), { recursive: true, force: true });
