const { AndroidConfig, withAndroidStyles } = require("@expo/config-plugins");

function withLightSystemBars(config) {
  return withAndroidStyles(config, (modConfig) => {
    const styles = modConfig.modResults;
    const appTheme = AndroidConfig.Styles.getStyleParent(
      styles,
      AndroidConfig.Styles.getAppThemeGroup(),
    );
    if (appTheme !== null) {
      appTheme.$.parent = "Theme.AppCompat.Light.NoActionBar";
    }
    for (const [name, value] of [
      ["android:windowLightStatusBar", "true"],
      ["android:windowLightNavigationBar", "true"],
    ]) {
      modConfig.modResults = AndroidConfig.Styles.assignStylesValue(
        modConfig.modResults,
        {
          add: true,
          parent: AndroidConfig.Styles.getAppThemeGroup(),
          name,
          value,
        },
      );
    }
    return modConfig;
  });
}

module.exports = withLightSystemBars;
