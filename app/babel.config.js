module.exports = function (api) {
  api.cache(true);
  return {
    // SDK 54+: babel-preset-expo automatically adds the Reanimated/Worklets
    // plugin when react-native-reanimated is installed.
    // (On SDK <= 53 add: plugins: ['react-native-reanimated/plugin'])
    presets: ['babel-preset-expo'],
  };
};
