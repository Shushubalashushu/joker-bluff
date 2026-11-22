import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import OfferDecisionButtons from './OfferDecisionButtons';
import TimerBar from './TimerBar';
import TouchHeatmap, { ScreenMap, analyzeTouches, heatColor } from './TouchHeatmap';
import LanguageToggle from '../LanguageToggle';
import { useI18n } from '../../i18n';
import { AUDIO_TOGGLE_SIZE } from '../AudioToggle';
import { colors, fonts } from '../../theme';
import { viewport, verticalScrollProps } from '../../theme/layout';

const secs = (t, ms, digits = 1) => t('var.seconds', { seconds: (ms / 1000).toFixed(digits) });

function StatTile({ label, value, sub, tone = colors.yellow }) {
  const { textStyle } = useI18n();
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, { color: tone }, textStyle]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[styles.tileLabel, textStyle]} numberOfLines={2}>
        {label}
      </Text>
      {!!sub && (
        <Text style={[styles.tileSub, textStyle]} numberOfLines={2}>
          {sub}
        </Text>
      )}
    </View>
  );
}

/** A playful (non-binding!) read of the giver's behaviour. */
function verdictFor(d, stats, t) {
  if (d.auto) return t('var.auto');
  if (d.touches.length === 0) return t('var.noTouches');
  if (stats.switches >= 3) return t('var.switchCount', { count: stats.switches });
  if (d.decisionMs < 2500) return t('var.quick');
  if (d.phaseLimitMs && d.decisionMs > d.phaseLimitMs * 0.7) return t('var.slow');
  if (stats.cardsTouched === 1 && stats.perSlot[d.offeredSlot] > 0) return t('var.direct');
  if (d.shuffles > 0) return t('var.shuffleCount', { count: d.shuffles });
  return t('var.unknown');
}

/** Time axis: every touch as a tick (coloured by slot heat), and the moment they offered. */
function Timeline({ touches, decisionMs, limitMs }) {
  const { t, textStyle } = useI18n();
  const maxT = Math.max(1, limitMs || decisionMs, decisionMs);
  return (
    <View style={styles.timeline}>
      <View style={styles.timelineTrack}>
        <View style={[styles.timelineUsed, { width: `${(decisionMs / maxT) * 100}%` }]} />
        {touches.map((t, i) => (
          <View
            key={i}
            style={[styles.tick, { left: `${Math.min(100, (t.t / maxT) * 100)}%`, backgroundColor: heatColor(t.t / Math.max(1, decisionMs)) }]}
          />
        ))}
        <View style={[styles.pickMarker, { left: `${Math.min(100, (decisionMs / maxT) * 100)}%` }]} />
      </View>
      <View style={styles.timelineLabels}>
        <Text style={[styles.timelineText, textStyle]}>{secs(t, 0, 0)}</Text>
        <Text style={[styles.timelineText, textStyle]}>{t('var.offeredAt', { time: secs(t, decisionMs) })}</Text>
        <Text style={[styles.timelineText, textStyle]}>{secs(t, maxT)}</Text>
      </View>
    </View>
  );
}

/**
 * 👁️ LIE DEYE · VAR REVIEW
 * Full-screen analysis of how the giver chose the card that's on the table.
 * Rendered inside GameScreen (not a Modal) so the root Audio toggle stays on top;
 * the header reserves room for it. The receiver can decide right from here.
 */
export default function LieDeyeOverlay({ visible, data, giverName, game, clockOffset, busy, width, onDecide, onClose }) {
  const { t, textStyle, alignStart } = useI18n();
  const [replayKey, setReplayKey] = useState(0);
  const stats = useMemo(() => (data ? analyzeTouches(data.touches, data.handSize) : null), [data]);
  if (!visible || !data) return null;

  const forcedNext = data.offerNumber === (game.maxOffers || 3) - 1;
  const contentW = Math.min(width, 520) - 32;
  const hold = data.pressDurationMs;
  const holdLabel = hold == null ? 'var.holdMissing' : hold < 250 ? 'var.holdQuick' : hold < 700 ? 'var.holdSteady' : 'var.holdLong';
  const holdValue = hold == null ? '—' : hold < 1000 ? t('var.milliseconds', { ms: hold }) : secs(t, hold);

  return (
    <View style={styles.backdrop} accessibilityViewIsModal>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.iconBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('var.hide')}>
            <Ionicons name="chevron-down" size={22} color={colors.night} />
          </Pressable>
          <View style={styles.headerTitle}>
            <Text style={styles.title}>👁️ LIE DEYE</Text>
            <Text style={[styles.subtitle, textStyle]} numberOfLines={1}>
              {t('var.subtitle', { offer: data.offerNumber, name: giverName })}
            </Text>
          </View>
          <LanguageToggle compact />
          <View style={{ width: AUDIO_TOGGLE_SIZE }} />
        </View>

        <View style={styles.timer}>
          <TimerBar deadline={game.deadline} duration={game.phaseDuration} clockOffset={clockOffset} frozen label={t('var.decide')} compact />
        </View>

        <ScrollView {...verticalScrollProps} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Animated.View entering={SlideInDown.springify().damping(16)} style={[styles.card, { width: contentW + 16 }]}>
            <View style={styles.tiles}>
              <StatTile
                label={t('var.time')}
                value={secs(t, data.decisionMs)}
                sub={data.phaseLimitMs ? t('var.of', { time: secs(t, data.phaseLimitMs, 0) }) : null}
                tone={data.decisionMs < 2500 ? colors.teal : data.decisionMs > (data.phaseLimitMs || 15000) * 0.7 ? colors.red : colors.yellow}
              />
              <StatTile label={t('var.touches')} value={String(data.touches.length)} sub={t('var.onCards', { count: stats.onCards })} />
              <StatTile label={t('var.cardsTouched')} value={`${stats.cardsTouched}/${data.handSize}`} />
              <StatTile label={t('var.switches')} value={String(stats.switches)} tone={stats.switches >= 3 ? colors.red : colors.yellow} />
              <StatTile label={t('var.shuffles')} value={String(data.shuffles)} tone={data.shuffles ? colors.pink : colors.yellow} />
              <StatTile label={t('var.pickedSlot')} value={`#${data.offeredSlot + 1}`} sub={t('var.fromLeft')} />
              <StatTile label={t('var.holdDuration')} value={holdValue} sub={t(holdLabel)} tone={colors.teal} />
              {data.lieCount != null && <StatTile label={t('var.lieCount')} value={String(data.lieCount)} />}
            </View>

            <Text style={[styles.section, alignStart]}>{t('var.heatmap')}</Text>
            <TouchHeatmap
              touches={data.touches}
              handSize={data.handSize}
              offeredSlot={data.offeredSlot}
              decisionMs={data.decisionMs}
              width={contentW}
              replayKey={replayKey}
            />

            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={[styles.section, alignStart]}>{t('var.timeline')}</Text>
                <Timeline touches={data.touches} decisionMs={data.decisionMs} limitMs={data.phaseLimitMs} />
                <View style={styles.legend}>
                  <View style={[styles.legendDot, { backgroundColor: heatColor(0) }]} />
                  <Text style={[styles.legendText, textStyle]}>{t('var.early')}</Text>
                  <View style={[styles.legendDot, { backgroundColor: heatColor(0.5) }]} />
                  <View style={[styles.legendDot, { backgroundColor: heatColor(1) }]} />
                  <Text style={[styles.legendText, textStyle]}>{t('var.late')}</Text>
                </View>
                <Pressable onPress={() => setReplayKey((k) => k + 1)} style={styles.replay} accessibilityRole="button" accessibilityLabel={t('var.replayTouches')}>
                  <Ionicons name="play" size={14} color={colors.night} />
                  <Text style={[styles.replayText, textStyle]}>{t('var.replay')}</Text>
                </Pressable>
              </View>
              <View style={styles.mapCol}>
                <Text style={[styles.section, alignStart]}>{t('var.screen')}</Text>
                <ScreenMap touches={data.touches} decisionMs={data.decisionMs} replayKey={replayKey} />
              </View>
            </View>

            <View style={styles.verdict}>
              <Text style={[styles.verdictText, alignStart]}>{verdictFor(data, stats, t)}</Text>
            </View>
          </Animated.View>
        </ScrollView>

        <View style={styles.footer}>
          {game.offers[data.offerNumber - 1]?.claimedNoCard && (
            <Text style={[styles.warn, textStyle]}>{t('nocard.claim')}</Text>
          )}
          {forcedNext && <Text style={[styles.warn, textStyle]}>{t('action.rejectWarn')}</Text>}
          <OfferDecisionButtons offerCount={data.offerNumber} onDecide={onDecide} busy={busy} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Keep the board's real cards from showing through the face-down heatmap.
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#100628', zIndex: 80, elevation: 80 },
  safe: viewport,
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 8 },
  iconBtn: {
    width: AUDIO_TOGGLE_SIZE,
    height: AUDIO_TOGGLE_SIZE,
    borderRadius: AUDIO_TOGGLE_SIZE / 2,
    borderWidth: 3,
    borderColor: colors.night,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  title: { fontFamily: fonts.bold, fontSize: 22, color: colors.yellow, letterSpacing: 2 },
  subtitle: { fontFamily: fonts.semibold, fontSize: 12, color: colors.cream, opacity: 0.85 },
  timer: { paddingHorizontal: 14, marginTop: 10 },
  scroll: { alignItems: 'center', paddingVertical: 12 },
  card: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: 'rgba(255,210,63,0.5)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 8,
    gap: 8,
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between' },
  tile: {
    width: '31.5%',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  tileValue: { fontFamily: fonts.bold, fontSize: 20 },
  tileLabel: { fontFamily: fonts.semibold, fontSize: 10, color: colors.cream, opacity: 0.85 },
  tileSub: { fontFamily: fonts.regular, fontSize: 9, color: colors.muted },
  section: { fontFamily: fonts.bold, fontSize: 12, color: colors.cream, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  flex: { flex: 1 },
  mapCol: { alignItems: 'center', gap: 4 },
  timeline: { marginTop: 6 },
  timelineTrack: { height: 16, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'visible' },
  timelineUsed: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.12)' },
  tick: { position: 'absolute', top: 2, width: 3, height: 12, marginLeft: -1, borderRadius: 2 },
  pickMarker: { position: 'absolute', top: -4, width: 4, height: 24, marginLeft: -2, borderRadius: 2, backgroundColor: colors.yellow },
  timelineLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  timelineText: { fontFamily: fonts.regular, fontSize: 10, color: colors.muted },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { fontFamily: fonts.regular, fontSize: 10, color: colors.muted, marginRight: 4 },
  replay: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 8,
    backgroundColor: colors.yellow,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.night,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  replayText: { fontFamily: fonts.bold, fontSize: 12, color: colors.night },
  verdict: { backgroundColor: colors.yellow, borderRadius: 14, borderWidth: 3, borderColor: colors.night, padding: 10 },
  verdictText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.night, textAlign: 'center' },
  footer: { paddingHorizontal: 14, paddingBottom: 8, gap: 6 },
  warn: { fontFamily: fonts.bold, fontSize: 13, color: colors.pink, textAlign: 'center' },
});
