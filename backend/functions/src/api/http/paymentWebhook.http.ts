import { onRequest } from 'firebase-functions/v2/https';

import { REGION } from '../../core/env';
import { logger } from '../../core/logger';
import { advancePaymentFromEvent, getPaymentProvider } from '../../modules/payments';
import { advanceSubscriptionInvoicePayment, isSubscriptionInvoicePaymentSubject } from '../../modules/billing/subscription-online-payment';

/**
 * ============================================================================
 * PAYMENT PROVIDER WEBHOOK
 * ============================================================================
 *
 * The ONLY way an online payment reaches `paid`. Deliberately not a callable: the
 * caller is a payment processor, not a signed-in user, so there is no Firebase auth
 * context to lean on. The signature IS the authentication.
 *
 * ORDER OF CHECKS MATTERS AND IS NOT ARBITRARY
 *   1. flag off            -> 404, as if the endpoint does not exist
 *   2. wrong method        -> 405
 *   3. signature invalid   -> 401, and NOTHING is parsed as meaningful
 *   4. only then           -> apply the event
 * Verifying before interpreting is the whole point; an endpoint that parsed first
 * would be an unauthenticated "mark this trip paid" API.
 *
 * WHY A DUPLICATE RETURNS 200
 * A processor retries until it gets a 2xx. Answering a replay with an error would
 * make it retry forever. "Already applied" is a success from the sender's point of
 * view, and the response says `duplicate: true` so our own logs stay honest.
 *
 * WHY AN ILLEGAL TRANSITION RETURNS 200 TOO
 * Same reason: it is not the processor's fault and a retry cannot fix it. It is
 * logged as a warning for us, not bounced back as a failure to them.
 * ============================================================================
 */
export const paymentWebhook = onRequest(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (req, res) => {
    // Selection THROWS on a misconfiguration - flag on but no Lahza key, or the stub
    // requested outside the emulator. That is deliberate (it must never quietly fall
    // back to the stub), so it has to be caught here rather than escaping as an
    // unhandled rejection. A 500 is right: the fault is ours, and Lahza should retry
    // once we have fixed the configuration.
    let provider;
    try {
      provider = getPaymentProvider();
    } catch (error) {
      logger.error('❌ [PaymentWebhook] Payment provider is misconfigured', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'Payment provider misconfigured' });
      return;
    }

    // Flag OFF: the module is inert. A 404 leaks nothing about whether the feature
    // exists, which is the right answer for an endpoint that is not in service.
    if (!provider) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // The signature covers the RAW bytes. Re-serialising a parsed body would change
    // key order or spacing and break verification against a real processor, so read
    // rawBody when the runtime gives it to us.
    const rawBody =
      typeof (req as { rawBody?: Buffer }).rawBody !== 'undefined'
        ? (req as { rawBody: Buffer }).rawBody.toString('utf8')
        : typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body ?? {});

    const headers = req.headers as Record<string, string | undefined>;

    const event = provider.parseAndVerifyWebhook(rawBody, headers);
    if (!event) {
      logger.warn('⚠️ [PaymentWebhook] Rejected unverified payload');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    try {
      const result = isSubscriptionInvoicePaymentSubject(event.tripId)
        ? await advanceSubscriptionInvoicePayment(event, provider.name)
        : await advancePaymentFromEvent(event, provider.name);

      if (!result.ok) {
        // Logged inside the service. Acknowledged so the processor stops retrying
        // something a retry will never fix.
        res.status(200).json({ received: true, applied: false, reason: 'reason' in result ? result.reason : undefined });
        return;
      }

      res.status(200).json({
        received: true,
        applied: !result.duplicate,
        duplicate: result.duplicate,
        status: result.status,
      });
    } catch (error) {
      // A genuine failure on OUR side. This one SHOULD be retried, so it is a 500.
      logger.error('❌ [PaymentWebhook] Failed to apply event', {
        eventId: event.eventId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'Internal error' });
    }
  }
);
