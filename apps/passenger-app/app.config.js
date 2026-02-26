module.exports = {
  expo: {
    name: 'Waselneh',
    slug: 'waselneh',
    version: '1.0.0-pilot',
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: 'waselneh',
    userInterfaceStyle: 'automatic',
    newArchEnabled: false,
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.taxiline.passenger',
      buildNumber: '1',
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      package: 'com.taxiline.passenger',
      versionCode: 1,
      permissions: [
        'ACCESS_COARSE_LOCATION',
        'ACCESS_FINE_LOCATION',
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
          locationWhenInUsePermission:
            'Allow Waselneh to use your location to find nearby pickup stations.',
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
      // App Mode (Step 33: Go-Live Mode)
      appMode: process.env.EXPO_PUBLIC_APP_MODE || 'dev',
      // Firebase configuration
      firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
      firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'demo-taxi-line',
      firebaseStorageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      firebaseMessagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
      // Mapbox configuration
      mapboxAccessToken: process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN,
      // Emulator configuration (only used in DEV mode)
      useEmulators: process.env.EXPO_PUBLIC_USE_EMULATORS === 'true',
      emulatorHost: process.env.EXPO_PUBLIC_EMULATOR_HOST || '127.0.0.1',
    },
  },
};
