/**
 * MOCK ADAPTER - SAP integration boundary.
 *
 * Implements the application-side handoff/status contract only (architecture
 * §17). SAP-side posting logic is out of scope; this mock simulates the
 * agreed interface: handoff acknowledgement, parked/posted progression and
 * payment clearing, including transient technical failures that must surface
 * as retryable integration exceptions - never business rejections.
 */
import { getDb } from '../core/store';

export interface SapAckResponse {
  accepted: boolean;
  transient?: boolean;
  sapDocumentNo?: string;
  fiscalYear?: string;
  message: string;
  errorCode?: string;
}

let docCounter = 5100004210;

export const SapMock = {
  /** Simulate outbound handoff acknowledgement from the SAP interface. */
  sendHandoff(invoiceNumber: string, forceOutcome?: 'OK' | 'TRANSIENT' | 'PARK'): SapAckResponse {
    const health = getDb().integrationHealth;
    if (health.sapState === 'UNAVAILABLE') {
      return { accepted: false, transient: true, message: 'SAP interface unreachable (connection timeout)', errorCode: 'SAP_TIMEOUT' };
    }
    if (forceOutcome === 'TRANSIENT' || (health.sapState === 'DEGRADED' && Math.random() < 0.5)) {
      return { accepted: false, transient: true, message: 'SAP interface responded with a transient RFC error', errorCode: 'SAP_RFC_BUSY' };
    }
    docCounter += 1;
    return {
      accepted: true,
      sapDocumentNo: String(docCounter),
      fiscalYear: '2026',
      message: forceOutcome === 'PARK' ? 'Document parked pending period assignment' : 'Handoff accepted for processing',
    };
  },
};
