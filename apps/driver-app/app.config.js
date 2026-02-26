module.exports = {
  expo: {
    name: 'Waselneh Driver',
    slug: 'waselneh-driver',
    version: '1.0.0-pilot',
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: 'waselneh-driver',
    userInterfaceStyle: 'automatic',
    newArchEnabled: false,
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#1a1a2e',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.taxiline.driver',
      buildNumber: '1',
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'We need your location to show your position to passengers and match you with nearby trip requests.',
        NSLocationAlwaysAndWhenInUseUsageDescription:
          'We need your location to track trips even when the app is in the background.',
        UIBackgroundModes: ['location'],
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#1a1a2e',
      },
      package: 'com.taxiline.driver',
      versionCode: 1,
      permissions: [
        'ACCESS_COARSE_LOCATION',
        'ACCESS_FINE_LOCATION',
        'ACCESS_BACKGROUND_LOCATION',
      ],
    },
    web: {
      bundler: 'metro',
      output: 'static',
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'Allow Waselneh Driver to use your location to match you with passengers.',
        },
      ],
      [
        '@rnmapbox/maps',
        {
          RNMAPBOX_MAPS_DOWNLOAD_TOKEN:
            process.env.RNMAPBOX_MAPS_DOWNLOAD_TOKEN ||
            process.env.MAPBOX_DOWNLOADS_TOKEN ||
            process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ||
            '',
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      // EAS Project ID
      eas: {
        projectId: '41ef9372-b842-47c9-889c-a400f3b72f1f',
      },
      // App Mode (Step 33: Go-Live Mode)
      appMode: process.env.EXPO_PUBLIC_APP_MODE || 'dev',
      // Firebase configuration
      firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
      firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'demo-taxi-line',
      firebaseStorageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      firebaseMessagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
      // Emulator configuration (only used in DEV mode)
      useEmulators: process.env.EXPO_PUBLIC_USE_EMULATORS === 'true',
      emulatorHost: process.env.EXPO_PUBLIC_EMULATOR_HOST || '127.0.0.1',
    },
  },
};
