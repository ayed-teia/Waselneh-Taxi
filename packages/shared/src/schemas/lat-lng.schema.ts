import { z } from 'zod';

export const LatLngSchema = z.object({
  /** Latitude (-90 to 90) */
  lat: z.number().min(-90).max(90),
  /** Longitude (-180 to 180) */
  lng: z.number().min(-180).max(180),
});

export type LatLng = z.infer<typeof LatLngSchema>;

export const LatLngLiteralSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export type LatLngLiteral = z.infer<typeof LatLngLiteralSchema>;

/** Convert between LatLng formats */
export function toLatLng(literal: LatLngLiteral): LatLng {
  return { lat: literal.latitude, lng: literal.longitude };
}

export function toLatLngLiteral(latLng: LatLng): LatLngLiteral {
  return { latitude: latLng.lat, longitude: latLng.lng };
}
