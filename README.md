# Waselneh Platform



Smart taxi service for West Bank cities (Nablus, Ramallah, Jenin).



\## Monorepo Structure

/apps

&nbsp; /passenger-app

&nbsp; /driver-app

&nbsp; /manager-web

/backend

&nbsp; /functions

/packages

&nbsp; /shared

&nbsp; /config

/docs



\## Stack

\- React Native (Expo)

\- React + Vite

\- Firebase (Auth, Firestore, Functions, FCM)

\- Mapbox



Layer	Tech
Mobile Apps	React Native (Expo) + TypeScript
Web Dashboard	React + Vite + TypeScript
Backend	Firebase Cloud Functions (Node.js) + TypeScript
Validation	Zod
Realtime	Firestore + FCM
Maps	Mapbox
Monorepo	pnpm workspaces