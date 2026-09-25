// Web (the app served by the API, or a home-screen web app): the browser's storage for this origin.
// Storage can be blocked (private mode); then the key is simply asked again.
const KEY = "corgi.accessKey";
const SERVER = "corgi.server";

async function load(name: string) {
  try {
    return localStorage.getItem(name) ?? undefined;
  } catch {
    return undefined;
  }
}
async function save(name: string, value: string) {
  try {
    localStorage.setItem(name, value);
  } catch {}
}
async function clear(name: string) {
  try {
    localStorage.removeItem(name);
  } catch {}
}

export const loadKey = () => load(KEY);
export const saveKey = (value: string) => save(KEY, value);
export const clearKey = () => clear(KEY);
export const loadServer = () => load(SERVER);
export const saveServer = (value: string) => save(SERVER, value);
