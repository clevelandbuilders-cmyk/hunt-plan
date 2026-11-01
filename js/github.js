// Reads and writes the encrypted vault file in the GitHub repo.
import { REPO, VAULT_PATH } from './config.js';

const API = 'https://api.github.com';
const contentsUrl = () => `${API}/repos/${REPO.owner}/${REPO.name}/contents/${VAULT_PATH}`;

function headers(token) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// Returns { text, sha } or throws. Falls back to the copy GitHub Pages serves.
export async function fetchVault(token) {
  try {
    const r = await fetch(`${contentsUrl()}?ref=${REPO.branch}&t=${Date.now()}`, { headers: headers(token), cache: 'no-store' });
    if (r.status === 404) return { text: null, sha: null };
    if (!r.ok) throw new Error('GitHub ' + r.status);
    const j = await r.json();
    let b64 = j.content;
    if (!b64 || j.encoding === 'none') {
      const br = await fetch(`${API}/repos/${REPO.owner}/${REPO.name}/git/blobs/${j.sha}`, { headers: headers(token) });
      b64 = (await br.json()).content;
    }
    return { text: atob(b64.replace(/\s/g, '')), sha: j.sha, source: 'github' };
  } catch (e) {
    const r = await fetch(`${VAULT_PATH}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('Could not load data (' + e.message + ')');
    return { text: await r.text(), sha: null, source: 'pages' };
  }
}

export async function pushVault(token, text, sha, message) {
  const body = { message, content: btoa(text), branch: REPO.branch };
  if (sha) body.sha = sha;
  const r = await fetch(contentsUrl(), { method: 'PUT', headers: { ...headers(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) { const e = new Error('conflict'); e.conflict = true; throw e; }
  if (r.status === 401 || r.status === 403) { const e = new Error('The editor key was refused by GitHub (expired or wrong repo).'); e.auth = true; throw e; }
  if (!r.ok) throw new Error('GitHub save failed: ' + r.status);
  const j = await r.json();
  return j.content.sha;
}

export async function checkToken(token) {
  const r = await fetch(`${API}/repos/${REPO.owner}/${REPO.name}`, { headers: headers(token) });
  if (!r.ok) return { ok: false, reason: r.status === 401 ? 'GitHub did not accept that key.' : `GitHub answered ${r.status}. Make sure the key covers the ${REPO.name} repo.` };
  const j = await r.json();
  if (!j.permissions || !j.permissions.push) return { ok: false, reason: 'That key can read the repo but not write. Give it Contents: Read and write.' };
  return { ok: true };
}
