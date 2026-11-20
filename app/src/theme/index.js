export const colors = {
  purple: '#7B2FF7',
  deepPurple: '#4B1FA8',
  night: '#2B1B4A', // outlines & text ("ink")
  pink: '#FF4FA3',
  hotPink: '#E0287D',
  orange: '#FF9F1C',
  darkOrange: '#D9790A',
  yellow: '#FFD23F',
  gold: '#F5B700',
  green: '#22C55E',
  darkGreen: '#15803D',
  teal: '#2EC4B6',
  blue: '#3A86FF',
  darkBlue: '#1F5FCC',
  red: '#FF3B5C',
  darkRed: '#C81E3D',
  white: '#FFFFFF',
  cream: '#FFF8E7',
  felt: '#20B486',
  feltDark: '#11795A',
  muted: '#9A8FB5',
  overlay: 'rgba(20, 8, 48, 0.62)',
};

export const gradients = {
  lobby: ['#7B2FF7', '#C13CE0', '#FF4FA3', '#FF9F1C'],
  waiting: ['#3A86FF', '#7B2FF7', '#FF4FA3'],
  game: ['#2A1265', '#4B1FA8', '#7B2FF7'],
  primary: ['#FF4FA3', '#FF7A59', '#FF9F1C'],
  success: ['#4ADE80', '#22C55E'],
  danger: ['#FF6B81', '#FF3B5C'],
  blue: ['#60A5FA', '#3A86FF'],
  gold: ['#FFE066', '#FFC300'],
  joker: ['#FF4FA3', '#FFD23F', '#2EC4B6'],
  cardBack: ['#7B2FF7', '#3A86FF'],
  felt: ['#2ED3A0', '#20B486', '#11795A'],
};

export const fonts = {
  regular: 'Fredoka_500Medium',
  semibold: 'Fredoka_600SemiBold',
  bold: 'Fredoka_700Bold',
};

export const radius = { sm: 10, md: 16, lg: 24, xl: 32 };

/** Chunky "cartoon" drop shadow (hard offset, no blur). */
export const cartoonShadow = {
  shadowColor: colors.night,
  shadowOffset: { width: 0, height: 5 },
  shadowOpacity: 0.35,
  shadowRadius: 0,
  elevation: 6,
};

export const outline = { borderWidth: 3, borderColor: colors.night };
