#!/usr/bin/env node
// Command-line access to the encrypted data, for scripts and Claude sessions (weekly sync, planners).
//   HUNT_PLAN_PASSWORD=... node tools/vault.mjs show            > print decrypted JSON
//   HUNT_PLAN_PASSWORD=... node tools/vault.mjs write data.json  < encrypt a JSON file into data/vault.json
//   HUNT_PLAN_PASSWORD=... node tools/vault.mjs merge new.json   < merge records from a JSON file (newest wins)
//   HUNT_PLAN_PASSWORD=... node tools/vault.mjs init seed.json   < start a new vault with a fresh salt
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveKey, openVault, sealVault, newKdf } from '../js/crypto.js';
import { merge } from '../js/model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vaultPath = join(root, 'data', 'vault.json');
const pw = process.env.HUNT_PLAN_PASSWORD;
if (!pw) { console.error('Set HUNT_PLAN_PASSWORD'); process.exit(1); }
const [cmd, file] = process.argv.slice(2);

if (cmd === 'init') {
  const kdf = newKdf();
  const key = await deriveKey(pw, kdf.salt, kdf.iterations);
  writeFileSync(vaultPath, await sealVault(key, kdf, JSON.parse(readFileSync(file, 'utf8'))));
  console.error('Wrote', vaultPath);
} else {
  const text = readFileSync(vaultPath, 'utf8');
  const { kdf } = JSON.parse(text);
  const key = await deriveKey(pw, kdf.salt, kdf.iterations);
  const data = await openVault(key, text);
  if (cmd === 'show') process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  else if (cmd === 'write') writeFileSync(vaultPath, await sealVault(key, kdf, JSON.parse(readFileSync(file, 'utf8'))));
  else if (cmd === 'merge') writeFileSync(vaultPath, await sealVault(key, kdf, merge(data, JSON.parse(readFileSync(file, 'utf8')))));
  else { console.error('Commands: show | write <file> | merge <file> | init <file>'); process.exit(1); }
}
