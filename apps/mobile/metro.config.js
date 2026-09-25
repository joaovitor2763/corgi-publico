const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
const path = require("node:path");
config.watchFolders = [path.resolve(__dirname, "../..")];
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Browsers have TextEncoder/Decoder; CopilotKit's native polyfill would bundle ~0.5 MB of
  // encoding tables into the web app (it only fills the globals when they are missing).
  if (platform === "web" && moduleName === "text-encoding") return { type: "empty" };
  if (moduleName === "jose" || moduleName.startsWith("jose/")) {
    return context.resolveRequest(
      { ...context, unstable_conditionNames: ["browser", "require", "import"] },
      moduleName,
      platform,
    );
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
