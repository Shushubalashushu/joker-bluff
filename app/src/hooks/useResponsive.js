import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Layout tiers based on the height that's ACTUALLY usable (inside the safe area).
 *
 *   device              window     insets (t/b)   availH   tier
 *   iPhone SE (3rd)     375x667    20 / 0         647      compact
 *   iPhone 14 / 15      390x844    47 / 34        763      regular
 *   iPhone 14 Pro       393x852    59 / 34        759      regular
 *   iPhone 14 Plus      428x926    47 / 34        845      tall
 *   iPhone 14 Pro Max   430x932    59 / 34        839      tall
 *
 * Everything on the game board (card sizes, avatar sizes, paddings) keys off this,
 * so nothing has to scroll and nothing slides under the Dynamic Island or the
 * home indicator.
 */
export default function useResponsive() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  return useMemo(() => {
    const availH = height - insets.top - insets.bottom;
    const availW = width - insets.left - insets.right;
    const tier = availH >= 800 ? 'tall' : availH >= 700 ? 'regular' : 'compact';
    const compact = tier === 'compact';
    const desktopHandCard = availW >= 1200 && availH >= 760 ? 'desktopLg'
      : availW >= 900 && availH >= 670 ? 'desktop'
      : availW >= 900 && availH >= 590 ? 'desktopSm' : null;
    return {
      width,
      height,
      availW,
      availH,
      insets,
      tier,
      compact,
      tall: tier === 'tall',
      scale: clamp(availW / 390, 0.82, 1.12),
      handCard: availW >= 375 && !compact ? 'lg' : 'md',
      desktopHandCard,
      tableCard: tier === 'tall' ? 'md' : 'sm',
      seatAvatar: tier === 'tall' ? 54 : tier === 'regular' ? 46 : 40,
      gap: compact ? 4 : tier === 'regular' ? 6 : 10,
    };
  }, [width, height, insets]);
}
