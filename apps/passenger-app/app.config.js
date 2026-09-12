const appMode = process.env.EXPO_PUBLIC_APP_MODE || 'dev';
const isStaging = appMode === 'pilot';
const isProduction = appMode === 'prod';
const releaseProjectId = isStaging
  ? 'waselneh-staging-ayed'
  : isProduction
    ? 'waselneh-prod-414e2'
    : undefined;
const configuredProjectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;

if (releaseProjectId && configuredProjectId !== releaseProjectId) {
  throw new Error(
    `[PassengerApp] ${appMode} builds must use Firebase project ${releaseProjectId}; received ${configuredProjectId || 'nothing'}.`
  );
}

module.exports = {
  expo: {
    name: 'وصلني',
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
      bundleIdentifier: isStaging
        ? 'com.taxiline.passenger.staging'
        : 'com.taxiline.passenger',
      googleServicesFile:
        process.env.GOOGLE_SERVICE_INFO_PLIST ||
        (isStaging ? './.firebase/staging/GoogleService-Info.plist' : './GoogleService-Info.plist'),
      buildNumber: '1',
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      package: isStaging
        ? 'com.taxiline.passenger.staging'
        : 'com.taxiline.passenger',
      googleServicesFile:
        process.env.GOOGLE_SERVICES_JSON ||
        (isStaging ? './.firebase/staging/google-services.json' : './google-services.json'),
      versionCode: 1,
      permissions: [
        'ACCESS_COARSE_LOCATION',
        'ACCESS_FINE_LOCATION',
        'POST_NOTIFICATIONS',
      ],
    },
    web: {
      bundler: 'metro',
      output: 'static',
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-notifications',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Allow وصلني to use your location to find nearby pickup stations.',
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
      appMode,
      // Firebase configuration
      firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
      firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'demo-taxi-line',
      firebaseStorageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      firebaseMessagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
      firebaseAndroidAppId: process.env.EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID,
      firebaseIosAppId: process.env.EXPO_PUBLIC_FIREBASE_IOS_APP_ID,
      // Mapbox configuration
      mapboxAccessToken: process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN,
      // Emulator configuration (only used in DEV mode)
      useEmulators: process.env.EXPO_PUBLIC_USE_EMULATORS === 'true',
      emulatorHost: process.env.EXPO_PUBLIC_EMULATOR_HOST || '127.0.0.1',
    },
  },
};
