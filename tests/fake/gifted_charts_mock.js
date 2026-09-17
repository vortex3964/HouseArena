// Jest stand-in for react-native-gifted-charts. Unit tests cover the
// pure stats helpers, never chart rendering, and the real package ships
// untranspiled ESM that the jest transform skips (node_modules).
module.exports = {
  BarChart: () => null,
};
