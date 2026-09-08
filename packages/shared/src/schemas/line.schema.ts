import { z } from 'zod';

export const LINE_SERVICE_TYPE_VALUES = ['intra_city', 'inter_city'] as const;
export type LineServiceType = (typeof LINE_SERVICE_TYPE_VALUES)[number];

export const LINE_OPERATOR_TYPE_VALUES = ['office', 'independent'] as const;
export type LineOperatorType = (typeof LINE_OPERATOR_TYPE_VALUES)[number];

export const LINE_PRICING_STRATEGY_VALUES = ['distance', 'fixed', 'hybrid'] as const;
export type LinePricingStrategy = (typeof LINE_PRICING_STRATEGY_VALUES)[number];

/**
 * Route metadata added to a line. Every field is optional at the schema boundary so
 * legacy line documents remain readable during migration. Once any route field is
 * supplied, the refinement requires a complete and internally consistent route.
 */
export const LineRouteInputSchema = z
  .object({
    serviceType: z.enum(LINE_SERVICE_TYPE_VALUES).optional(),
    operatorType: z.enum(LINE_OPERATOR_TYPE_VALUES).optional(),
    officeId: z.string().trim().min(1).nullable().optional(),
    originCityId: z.string().trim().min(1).optional(),
    destinationCityId: z.string().trim().min(1).optional(),
    originLabel: z.string().trim().min(2).max(120).optional(),
    destinationLabel: z.string().trim().min(2).max(120).optional(),
    distanceKm: z.number().positive().max(1000).optional(),
    estimatedDurationMin: z.number().positive().max(1440).optional(),
    pricingStrategy: z.enum(LINE_PRICING_STRATEGY_VALUES).optional(),
    fixedPriceIls: z.number().positive().max(5000).nullable().optional(),
    bidirectional: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    const hasRouteMetadata =
      value.serviceType !== undefined ||
      value.operatorType !== undefined ||
      value.originCityId !== undefined ||
      value.destinationCityId !== undefined ||
      value.distanceKm !== undefined ||
      value.estimatedDurationMin !== undefined ||
      value.pricingStrategy !== undefined ||
      value.fixedPriceIls !== undefined;

    if (!hasRouteMetadata) return;

    const requiredFields: Array<keyof typeof value> = [
      'serviceType',
      'operatorType',
      'originCityId',
      'destinationCityId',
      'distanceKm',
      'estimatedDurationMin',
      'pricingStrategy',
    ];
    for (const field of requiredFields) {
      if (value[field] === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required for a routed line`,
        });
      }
    }

    if (value.operatorType === 'office' && !value.officeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['officeId'],
        message: 'officeId is required for an office-operated line',
      });
    }
    if (value.operatorType === 'independent' && value.officeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['officeId'],
        message: 'officeId must be empty for an independent line',
      });
    }
    if (
      value.serviceType === 'inter_city' &&
      value.originCityId &&
      value.destinationCityId &&
      value.originCityId === value.destinationCityId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destinationCityId'],
        message: 'An inter-city line must connect two different cities',
      });
    }
    if (
      value.serviceType === 'intra_city' &&
      value.originCityId &&
      value.destinationCityId &&
      value.originCityId !== value.destinationCityId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destinationCityId'],
        message: 'An intra-city line must remain inside one city',
      });
    }
    if (
      (value.pricingStrategy === 'fixed' || value.pricingStrategy === 'hybrid') &&
      !(typeof value.fixedPriceIls === 'number' && value.fixedPriceIls > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fixedPriceIls'],
        message: 'fixedPriceIls is required for fixed or hybrid pricing',
      });
    }
  });

export type LineRouteInput = z.infer<typeof LineRouteInputSchema>;
