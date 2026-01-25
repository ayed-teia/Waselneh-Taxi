import { z } from 'zod';

export const UserRole = {
  PASSENGER: 'passenger',
  DRIVER: 'driver',
  MANAGER: 'manager',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserRoleSchema = z.enum(['passenger', 'driver', 'manager']);
