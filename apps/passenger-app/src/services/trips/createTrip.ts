/**
 * Trip Creation Service
 * 
 * Creates a trip document directly in Firestore.
 * Drivers will receive this trip via realtime listener.
 */
import { firebaseDB, firebaseAuth } from '../firebase';
import firestore from '@react-native-firebase/firestore';

/**
 * Location coordinates for trip pickup/destination
 */
export interface TripLocation {
  lat: number;
  lng: number;
}

/**
 * Input data for creating a new trip
 */
export interface CreateTripInput {
  pickup: TripLocation;
  destination: TripLocation;
}

/**
 * Result from creating a trip
 */
export interface CreateTripResult {
  tripId: string;
  success: boolean;
}

/**
 * Creates a new trip in Firestore with status 'pending'
 * 
 * This will trigger realtime listeners on driver apps.
 * 
 * @param input - Pickup and destination locations
 * @returns Trip ID and success status
 * @throws Error if user is not authenticated
 */
export async function createTrip(input: CreateTripInput): Promise<CreateTripResult> {
  const currentUser = firebaseAuth.currentUser;
  
  if (!currentUser) {
    throw new Error('User must be authenticated to create a trip');
  }

  const passengerId = currentUser.uid;

  console.log('🚖 [CreateTrip] Creating trip for passenger:', passengerId);
  console.log('   📍 Pickup:', input.pickup);
  console.log('   🎯 Destination:', input.destination);

  // Create trip document
  const tripData = {
    passengerId,
    status: 'pending',
    pickup: {
      lat: input.pickup.lat,
      lng: input.pickup.lng,
    },
    destination: {
      lat: input.destination.lat,
      lng: input.destination.lng,
    },
    createdAt: firestore.FieldValue.serverTimestamp(),
    assignedDriverId: null,
  };

  const docRef = await firebaseDB.collection('trips').add(tripData);

  console.log('✅ [CreateTrip] Trip created with ID:', docRef.id);

  return {
    tripId: docRef.id,
    success: true,
  };
}
