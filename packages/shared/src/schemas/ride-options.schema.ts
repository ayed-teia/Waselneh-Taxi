import { z } from 'zod';
import { VehicleType, VEHICLE_MAX_CAPACITY, VEHICLE_TYPE_VALUES } from '../config/vehicle.config';

const VehicleTypeEnum = z.enum(VEHICLE_TYPE_VALUES as [VehicleType, ...VehicleType[]]);

export const RideOptionsSchema = z.object({
  requiredSeats: z.number().int().min(1).max(VEHICLE_MAX_CAPACITY).optional(),
  vehicleType: VehicleTypeEnum.optional(),
  officeId: z.string().trim().min(1).optional(),
  lineId: z.string().trim().min(1).optional(),
});

export type RideOptions = z.infer<typeof RideOptionsSchema>;
