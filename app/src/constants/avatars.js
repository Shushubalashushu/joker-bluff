/** Cartoon avatars: emoji on a bright blob. 12 entries - must match AVATAR_COUNT on the server. */
export const AVATARS = [
  { id: 0, emoji: '🦊', bg: '#FF9F1C' },
  { id: 1, emoji: '🐼', bg: '#8AE234' },
  { id: 2, emoji: '🐸', bg: '#2EC4B6' },
  { id: 3, emoji: '🐯', bg: '#FFD23F' },
  { id: 4, emoji: '🐵', bg: '#FF4FA3' },
  { id: 5, emoji: '🦄', bg: '#B388FF' },
  { id: 6, emoji: '🐙', bg: '#FF6B6B' },
  { id: 7, emoji: '🐨', bg: '#3A86FF' },
  { id: 8, emoji: '🦁', bg: '#FFB627' },
  { id: 9, emoji: '🐷', bg: '#FF8FAB' },
  { id: 10, emoji: '🐰', bg: '#6FDFDF' },
  { id: 11, emoji: '🐻', bg: '#D4A373' },
];

export const getAvatar = (id) => AVATARS[id] || AVATARS[0];

const ADJECTIVES = ['Sneaky', 'Lucky', 'Wild', 'Sly', 'Jolly', 'Cheeky', 'Bouncy', 'Mighty', 'Silly', 'Zippy'];
const NOUNS = ['Fox', 'Panda', 'Joker', 'Ace', 'Tiger', 'Llama', 'Bluffer', 'Otter', 'Wizard', 'Koala'];

export const randomNickname = () =>
  `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]}${NOUNS[Math.floor(Math.random() * NOUNS.length)]}`;
