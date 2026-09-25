// app.json holds the app; identity and signing come from the environment so the repo never
// hardcodes a person's or company's Apple team:
//   APPLE_TEAM_ID  your team id (Xcode → Settings → Accounts), e.g. a Personal Team
//   APP_BUNDLE_ID  your own reverse-DNS id, e.g. com.seunome.corgi (default below)
module.exports = ({ config }) => {
  const id = process.env.APP_BUNDLE_ID;
  return {
    ...config,
    ios: {
      ...config.ios,
      ...(id ? { bundleIdentifier: id } : {}),
      ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
    },
    android: { ...config.android, ...(id ? { package: id } : {}) },
  };
};
