import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Get the correct emulator host based on platform
 * 
 * - Android emulator: 10.0.2.2 (special address to reach host machine)
 * - iOS simulator: 127.0.0.1 (localhost)
 * - Physical device: Use EXPO_PUBLIC_EMULATOR_HOST env var (LAN IP)
 * - Web: 127.0.0.1 (localhost)
 */
export function getEmulatorHost(): string {
  const expoConfig = Constants.expoConfig?.extra ?? {};
  const envHost = (expoConfig.emulatorHost as string | undefined)?.trim();

  // Honor explicit env host on all platforms (emulator/simulator/physical device)
  if (envHost) {
    return envHost;
  }
  
  // Auto-detect based on platform
  if (Platform.OS === 'android') {
    // Android emulator uses 10.0.2.2 to reach host
    return '10.0.2.2';
  }
  
  if (Platform.OS === 'ios') {
    // iOS simulator can use localhost
    return '127.0.0.1';
  }
  
  // Web or fallback
  return '127.0.0.1';
}

/**
 * Check if running on emulator/simulator vs physical device
 */
export function isRunningOnEmulator(): boolean {
  return !Constants.isDevice;
}
