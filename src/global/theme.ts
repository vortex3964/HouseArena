export const Colors = {
  crust: "#06060C", // deepest
  mantle: "#0D0A18", // drawer / header
  base: "#141122", // main app bg
  surface0: "#1C1832", // cards
  surface1: "#261F45", // pressed / hover
  surface2: "#352A5E", // elevated / modal

  // Semantic aliases
  bgDeep: "#06060C",
  bgSoft: "#0D0A18",
  bg: "#141122",
  card: "#1C1832",
  cardHover: "#261F45",
  elevated: "#352A5E",

  borderSoft: "rgba(180,190,254,0.12)",
  border: "rgba(180,190,254,0.20)",
  borderStrong: "rgba(203,166,247,0.38)",

  text: "#E9E5FB",
  subtext1: "#BAC2DE",
  subtext0: "#9EA2C4",
  muted: "#76709A",
  disabled: "#4C4670",

  // Catppuccin Mocha accents
  rosewater: "#F5E0DC",
  flamingo: "#F2CDCD",
  pink: "#F5C2E7",
  mauve: "#CBA6F7",
  red: "#F38BA8",
  maroon: "#EBA0AC",
  peach: "#FAB387",
  yellow: "#F9E2AF",
  green: "#A6E3A1",
  teal: "#94E2D5",
  sky: "#89DCEB",
  sapphire: "#74C7EC",
  blue: "#89B4FA",
  lavender: "#B4BEFE",

  // Actions
  primary: "#CBA6F7",
  primarySoft: "rgba(203,166,247,0.14)",
  primaryStrong: "#D9BCFF",
  onPrimary: "#1A1030",
  secondary: "#B4BEFE",
  accent: "#F5C2E7",
  success: "#A6E3A1",
  warning: "#F9E2AF",
  danger: "#F38BA8",
  info: "#89B4FA",
} as const;

export type AppColors = typeof Colors;
