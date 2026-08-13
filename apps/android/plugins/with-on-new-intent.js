const { withMainActivity } = require("@expo/config-plugins");

function withOnNewIntent(config) {
  return withMainActivity(config, (modConfig) => {
    const mainActivity = modConfig.modResults;
    // RN 0.86 declares `onNewIntent(intent: Intent)` (non-null); overriding with
  // a nullable parameter fails Kotlin compilation.
  const method = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
  }
`;

    if (!mainActivity.contents.includes("import android.content.Intent")) {
      mainActivity.contents = mainActivity.contents.replace(
        /^(package [^\n]+\n)/m,
        "$1\nimport android.content.Intent\n",
      );
    }

    if (!mainActivity.contents.includes("onNewIntent")) {
      mainActivity.contents = mainActivity.contents.replace(
        /class MainActivity[\s\S]*?\{/,
        (match) => `${match}${method}`,
      );
    }

    return modConfig;
  });
}

module.exports = withOnNewIntent;
