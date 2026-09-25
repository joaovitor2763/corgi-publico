import * as SecureStore from "expo-secure-store";

// The server address and its access key, kept in the iOS Keychain / Android Keystore so the app
// reconnects by itself after a restart or an expired session. Never in plain app storage.
const KEY = "corgi.accessKey";
const SERVER = "corgi.server";

const load = async (name: string) =>
  (await SecureStore.getItemAsync(name).catch(() => null)) ?? undefined;
const save = (name: string, value: string) => SecureStore.setItemAsync(name, value).catch(() => {});
const clear = (name: string) => SecureStore.deleteItemAsync(name).catch(() => {});

export const loadKey = () => load(KEY);
export const saveKey = (value: string) => save(KEY, value);
export const clearKey = () => clear(KEY);
export const loadServer = () => load(SERVER);
export const saveServer = (value: string) => save(SERVER, value);
