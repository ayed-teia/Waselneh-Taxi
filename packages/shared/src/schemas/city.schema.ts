import { z } from 'zod';

import { LatLngSchema } from './lat-lng.schema';

export const CITY_STATUS_VALUES = ['active', 'inactive'] as const;
export type CityStatus = (typeof CITY_STATUS_VALUES)[number];

/** Canonical city document stored in `cities/{cityId}`. */
export const CitySchema = z.object({
  cityId: z.string().trim().min(1),
  code: z.string().trim().min(2).max(24),
  nameAr: z.string().trim().min(2).max(80),
  nameEn: z.string().trim().min(2).max(80).nullable().optional(),
  governorateAr: z.string().trim().min(2).max(80).nullable().optional(),
  governorateEn: z.string().trim().min(2).max(80).nullable().optional(),
  center: LatLngSchema.nullable().optional(),
  serviceRadiusKm: z.number().positive().max(200).nullable().optional(),
  status: z.enum(CITY_STATUS_VALUES),
  createdAt: z.unknown().optional(),
  createdBy: z.string().trim().min(1).optional(),
  updatedAt: z.unknown().optional(),
  updatedBy: z.string().trim().min(1).optional(),
});

export type City = z.infer<typeof CitySchema>;

export const ManagerUpsertCityInputSchema = CitySchema.omit({
  createdAt: true,
  createdBy: true,
  updatedAt: true,
  updatedBy: true,
}).extend({
  cityId: z.string().trim().min(1).optional(),
  status: z.enum(CITY_STATUS_VALUES).default('active'),
});

export type ManagerUpsertCityInput = z.infer<typeof ManagerUpsertCityInputSchema>;
