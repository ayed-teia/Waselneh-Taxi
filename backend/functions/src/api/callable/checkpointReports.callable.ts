import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { assertManagerPermission } from '../../modules/auth';
import { calculateCheckpointConfidence, CheckpointReportPoint } from '../../modules/routes/checkpoint-report-confidence';

const ReportSchema = z.object({
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  status: z.enum(['closed', 'congested', 'open']),
  note: z.string().trim().max(300).optional(),
});
const ReviewSchema = z.object({
  reportId: z.string().trim().min(1),
  decision: z.enum(['approved', 'rejected']),
  name: z.string().trim().min(2).max(120).optional(),
  area: z.string().trim().max(120).optional(),
  radiusMeters: z.number().int().min(50).max(10_000).default(500),
  delayMin: z.number().min(0).max(240).default(0),
  surchargeIls: z.number().min(0).max(200).default(0),
});

function reportPoint(data: Record<string, unknown>): CheckpointReportPoint | null {
  if (typeof data.driverId !== 'string' || typeof data.lat !== 'number' || typeof data.lng !== 'number') return null;
  if (data.status !== 'closed' && data.status !== 'congested' && data.status !== 'open') return null;
  return { driverId: data.driverId, lat: data.lat, lng: data.lng, status: data.status };
}

export const reportCheckpoint = onCall({ region: REGION }, async (request) => {
  try {
    const driverId = getAuthenticatedUserId(request);
    if (!driverId) throw new UnauthorizedError('Authentication required');
    const parsed = ReportSchema.safeParse(request.data);
    if (!parsed.success) throw new ValidationError('Invalid checkpoint report', parsed.error.flatten());
    const db = getFirestore();
    const driverDoc = await db.collection('drivers').doc(driverId).get();
    if (!driverDoc.exists || driverDoc.data()?.verificationStatus !== 'approved') {
      throw new ForbiddenError('Only approved drivers can report checkpoints');
    }
    const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
    const fingerprint = createHash('sha256')
      .update(`${driverId}:${parsed.data.location.lat.toFixed(3)}:${parsed.data.location.lng.toFixed(3)}:${bucket}`)
      .digest('hex').slice(0, 24);
    const ref = db.collection('checkpointReports').doc(fingerprint);
    if ((await ref.get()).exists) throw new ForbiddenError('A recent report already exists for this location');
    const recent = await db.collection('checkpointReports')
      .where('createdAt', '>=', Timestamp.fromMillis(Date.now() - 30 * 60 * 1000))
      .limit(100).get();
    const current: CheckpointReportPoint = { driverId, lat: parsed.data.location.lat, lng: parsed.data.location.lng, status: parsed.data.status };
    const candidates = recent.docs
      .map((doc) => reportPoint(doc.data() as Record<string, unknown>))
      .filter((item): item is CheckpointReportPoint => item !== null);
    const confidence = calculateCheckpointConfidence(current, candidates);
    await ref.create({
      reportId: ref.id,
      driverId,
      lat: current.lat,
      lng: current.lng,
      status: current.status,
      note: parsed.data.note ?? null,
      moderationStatus: 'pending',
      ...confidence,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { reportId: ref.id, moderationStatus: 'pending' as const, ...confidence };
  } catch (error) { throw handleError(error); }
});

export const managerReviewCheckpointReport = onCall({ region: REGION }, async (request) => {
  try {
    const managerId = getAuthenticatedUserId(request);
    if (!managerId) throw new UnauthorizedError('Authentication required');
    await assertManagerPermission(managerId, 'manage_alerts');
    const parsed = ReviewSchema.safeParse(request.data);
    if (!parsed.success) throw new ValidationError('Invalid checkpoint review', parsed.error.flatten());
    const db = getFirestore();
    const reportRef = db.collection('checkpointReports').doc(parsed.data.reportId);
    const roadblockRef = parsed.data.decision === 'approved' ? db.collection('roadblocks').doc() : null;
    const roadblockId = roadblockRef?.id ?? null;
    await db.runTransaction(async (transaction) => {
      const reportDoc = await transaction.get(reportRef);
      if (!reportDoc.exists) throw new NotFoundError('Checkpoint report not found');
      const report = reportDoc.data() as Record<string, unknown>;
      if (report.moderationStatus !== 'pending') throw new ForbiddenError('Checkpoint report was already reviewed');
      if (roadblockRef) {
        const point = reportPoint(report);
        if (!point) throw new ValidationError('Checkpoint report coordinates are invalid');
        transaction.create(roadblockRef, {
          name: parsed.data.name ?? 'Driver-reported checkpoint',
          area: parsed.data.area ?? '',
          lat: point.lat,
          lng: point.lng,
          radiusMeters: parsed.data.radiusMeters,
          status: point.status,
          note: typeof report.note === 'string' ? report.note : '',
          delayMin: parsed.data.delayMin,
          surchargeIls: parsed.data.surchargeIls,
          source: 'driver_report',
          confidence: typeof report.confidence === 'number' ? report.confidence : 0.45,
          sourceReportId: reportRef.id,
          createdBy: managerId,
          updatedBy: managerId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      transaction.update(reportRef, { moderationStatus: parsed.data.decision, reviewedBy: managerId, reviewedAt: FieldValue.serverTimestamp(), roadblockId });
    });
    return { success: true as const, roadblockId };
  } catch (error) { throw handleError(error); }
});
