import { Platform } from 'react-native';

// React Native Web filters DOM props. Mark sensitive text on the forwarded node.
export const noTranslateProps = Platform.OS === 'web' ? {
  ref(node) {
    if (!node) return;
    node.setAttribute('translate', 'no');
    node.classList.add('notranslate');
  },
} : {};
