import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useFonts, Fredoka_500Medium, Fredoka_600SemiBold, Fredoka_700Bold } from '@expo-google-fonts/fredoka';

import { LanguageProvider } from './src/i18n'; // also disables RN's automatic RTL layout mirroring
import { ProfileProvider } from './src/context/ProfileContext';
import { AudioProvider } from './src/context/AudioContext';
import { GameProvider, useGame } from './src/context/GameContext';
import LobbyScreen from './src/screens/LobbyScreen';
import WaitingRoomScreen from './src/screens/WaitingRoomScreen';
import GameScreen from './src/screens/GameScreen';
import AudioToggle from './src/components/AudioToggle';
import ConnectionBanner from './src/components/ConnectionBanner';
import { colors } from './src/theme';
import { viewport } from './src/theme/layout';

/**
 * Navigation is driven by SERVER state, not by taps:
 *   no room            -> Lobby
 *   room "waiting"     -> Waiting room
 *   room playing/over  -> Game board
 * This makes reconnects trivial: the server pushes room_state and the app
 * lands on the right screen automatically.
 */
function Router() {
  const { room } = useGame();
  const screen = !room ? 'lobby' : room.status === 'waiting' ? 'waiting' : 'game';

  return (
    <Animated.View key={screen} entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)} style={styles.fill}>
      {screen === 'lobby' && <LobbyScreen />}
      {screen === 'waiting' && <WaitingRoomScreen key={room.lifecycleId} />}
      {screen === 'game' && <GameScreen />}
    </Animated.View>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ Fredoka_500Medium, Fredoka_600SemiBold, Fredoka_700Bold });

  if (!fontsLoaded && !fontError) {
    return (
      <View style={[styles.fill, styles.splash]}>
        <ActivityIndicator color={colors.yellow} size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={[styles.fill, styles.layout]}>
      <SafeAreaProvider style={viewport}>
        <LanguageProvider>
          <ProfileProvider>
            <AudioProvider>
              <GameProvider>
                <StatusBar style="light" />
                <Router />
                {/* Persistent overlays, visible on every screen */}
                <ConnectionBanner />
                <AudioToggle />
              </GameProvider>
            </AudioProvider>
          </ProfileProvider>
        </LanguageProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: viewport,
  layout: { direction: 'ltr' },
  splash: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.purple },
});
