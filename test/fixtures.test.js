import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { registerFixtures } from './fixture-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = resolve(__dirname, 'fixtures');

await registerFixtures(`${fixturesRoot}/valid`, 'valid');
await registerFixtures(`${fixturesRoot}/invalid`, 'invalid');
