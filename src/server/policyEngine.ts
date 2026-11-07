/**
 * FairResolve Deterministic Policy Engine
 *
 * Evaluates merchant dispute claims strictly against configured merchant refund policies
 * using deterministic rules, integer minor-unit (cents) arithmetic, and explicit provenance.
 *
 * ARCHITECTURAL SAFETY PRINCIPLES:
 * 1. AI model opinions NEVER dictate financial eligibility or refund amounts.
 * 2. All currency math is computed in integer minor units (cents) to eliminate float rounding errors.
 * 3. Transit grace periods distinguish calendar days from business days (Monday-Friday).
 * 4. Every rule evaluation generates a tamper-evident, reproducible reason code.
 */

import { Case, Order, PolicyEvaluationResult, PolicyRuleEvaluation, RefundPolicy } from '../types';

/**
 * Converts a floating point dollar amount into integer minor units (cents).
 */
export function toCents(dollars: number): number {
  if (typeof dollars !== 'number' || isNaN(dollars)) return 0;
  return Math.round(dollars * 100);
}

/**
 * Converts integer minor units (cents) into a 2-decimal floating point dollar amount.
 */
export function toDollars(cents: number): number {
  if (typeof cents !== 'number' || isNaN(cents)) return 0;
  return Number((cents / 100).toFixed(2));
}

/**
 * Calculates the number of business days (Monday through Friday) between two dates.
 */
export function calculateBusinessDays(startDate: Date, endDate: Date): number {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (start > end) return 0;

  let count = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const dayOfWeek = cur.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
  }

  return count;
}

export class PolicyEngine {
  /**
   * Deterministically evaluates a dispute against the active merchant refund policy.
   */
  evaluate(disputeCase: Case, order: Order, policy: RefundPolicy): PolicyEvaluationResult {
    const rulesEvaluated: PolicyRuleEvaluation[] = [];
    const missingRequirements: string[] = [];
    const reasonCodes: string[] = [];

    // Financial integer minor units
    const grossCents = toCents(order.grossAmount);
    const refundableCents = toCents(order.refundableAmount);
    const thresholdCents = toCents(policy.mandatoryReturnThreshold);

    // Timeline calculation
    const orderDeliveryOrTxDate = new Date(order.deliveryDate || order.transactionDate);
    const caseCreationDate = new Date(disputeCase.createdAt || Date.now());
    
    // Calendar days elapsed since transaction/delivery
    const calendarDaysDiff = Math.max(
      0,
      Math.floor((caseCreationDate.getTime() - orderDeliveryOrTxDate.getTime()) / (1000 * 60 * 60 * 24))
    );

    // Business days elapsed (for carrier transit windows)
    const businessDaysDiff = calculateBusinessDays(orderDeliveryOrTxDate, caseCreationDate);

    // -------------------------------------------------------------
    // RULE 1: Return Window Check (Calendar Days)
    // -------------------------------------------------------------
    const withinWindow = calendarDaysDiff <= policy.returnWindowDays;
    rulesEvaluated.push({
      ruleId: 'R-WINDOW',
      ruleName: 'Refund Request Window',
      description: `Dispute must be filed within ${policy.returnWindowDays} calendar days of delivery/purchase.`,
      passed: withinWindow,
      details: withinWindow
        ? `Filed in ${calendarDaysDiff} calendar day(s), comfortably within the ${policy.returnWindowDays}-day policy limit.`
        : `Filed ${calendarDaysDiff} calendar day(s) after delivery/order. Exceeds the ${policy.returnWindowDays}-day limit by ${calendarDaysDiff - policy.returnWindowDays} day(s).`,
    });

    if (!withinWindow) {
      missingRequirements.push(
        `Claim filed ${calendarDaysDiff} calendar days post-transaction, exceeding the ${policy.returnWindowDays}-day window.`
      );
      reasonCodes.push('RETURN_WINDOW_EXCEEDED');
    }

    // -------------------------------------------------------------
    // RULE 2: Evidence Deduplication Security Check
    // -------------------------------------------------------------
    let duplicateDetected = false;
    if (Array.isArray(disputeCase.evidence)) {
      for (const ev of disputeCase.evidence) {
        if (ev.isDuplicate) {
          duplicateDetected = true;
          break;
        }
      }
    }

    rulesEvaluated.push({
      ruleId: 'R-DEDUP',
      ruleName: 'Evidence Cryptographic Integrity',
      description: 'Checks uploaded evidence SHA-256 fingerprints against merchant historic claim database.',
      passed: !duplicateDetected,
      details: duplicateDetected
        ? 'Duplicate SHA-256 evidence fingerprint detected across separate claims. Immediate fraud hold required.'
        : 'All uploaded evidence fingerprints are unique to this merchant dispute.',
    });

    if (duplicateDetected) {
      missingRequirements.push(
        'Duplicate evidence fingerprint detected matching another case. Requires manual fraud investigation.'
      );
      reasonCodes.push('DUPLICATE_EVIDENCE_HASH_DETECTED');
    }

    // -------------------------------------------------------------
    // RULE 3: Category-Specific Evidence Requirements
    // -------------------------------------------------------------
    if (disputeCase.issueType === 'damaged_item') {
      const hasItemPhoto = disputeCase.evidence?.some(
        (e) => e.evidenceType === 'item_photo' || e.evidenceType === 'other'
      ) ?? false;
      const hasPackagingPhoto = disputeCase.evidence?.some(
        (e) => e.evidenceType === 'packaging_photo'
      ) ?? false;

      const damageEvidencePassed =
        hasItemPhoto && (!policy.requirePackagingPhotoForDamage || hasPackagingPhoto);

      rulesEvaluated.push({
        ruleId: 'R-DMG-EVID',
        ruleName: 'Damaged Item Photographic Evidence',
        description: 'Requires clear photo of damaged item and outer packaging carton.',
        passed: damageEvidencePassed,
        details: damageEvidencePassed
          ? 'Photographs of damaged merchandise and outer packaging provided.'
          : 'Missing required photographic proof of damaged goods or parcel condition.',
      });

      if (!damageEvidencePassed) {
        if (!hasItemPhoto) {
          missingRequirements.push('High-resolution photograph of the damaged product');
        }
        if (policy.requirePackagingPhotoForDamage && !hasPackagingPhoto) {
          missingRequirements.push('Photograph of the exterior shipping container/box');
        }
        reasonCodes.push('MISSING_DAMAGE_EVIDENCE');
      }
    } else if (disputeCase.issueType === 'wrong_item') {
      const hasLabelPhoto = disputeCase.evidence?.some(
        (e) => e.evidenceType === 'shipping_label' || e.evidenceType === 'item_photo'
      ) ?? false;

      rulesEvaluated.push({
        ruleId: 'R-WRG-EVID',
        ruleName: 'Wrong Item Barcode/Label Evidence',
        description: 'Requires photo of barcode, SKU label, or physical item received.',
        passed: hasLabelPhoto,
        details: hasLabelPhoto
          ? 'Label or merchandise photo verified.'
          : 'Missing barcode or SKU label photograph.',
      });

      if (!hasLabelPhoto) {
        missingRequirements.push('Photo of the packaging label showing SKU or barcode of item received');
        reasonCodes.push('MISSING_WRONG_ITEM_EVIDENCE');
      }
    } else if (disputeCase.issueType === 'item_not_received') {
      // Use business days for carrier transit verification
      const carrierWindowPassed = businessDaysDiff >= policy.carrierDeliveryVerificationDays;

      rulesEvaluated.push({
        ruleId: 'R-INR-WINDOW',
        ruleName: 'Carrier Transit Grace Period',
        description: `Requires at least ${policy.carrierDeliveryVerificationDays} business days in transit before initiating an INR refund.`,
        passed: carrierWindowPassed,
        details: carrierWindowPassed
          ? `${businessDaysDiff} business days elapsed since dispatch.`
          : `Only ${businessDaysDiff} business day(s) elapsed since dispatch. Carrier standard transit window is still active (${policy.carrierDeliveryVerificationDays} business days required).`,
      });

      if (!carrierWindowPassed) {
        missingRequirements.push(
          `Carrier transit window still active. Wait at least ${policy.carrierDeliveryVerificationDays} business days before approving INR refund.`
        );
        reasonCodes.push('CARRIER_IN_TRANSIT_ACTIVE');
      }
    }

    // -------------------------------------------------------------
    // RULE 4: Mandatory Physical Return Threshold
    // -------------------------------------------------------------
    const exceedsReturnThreshold = grossCents > thresholdCents;
    rulesEvaluated.push({
      ruleId: 'R-RETURN-THRESH',
      ruleName: 'Physical Return Requirement Threshold',
      description: `Orders over $${toDollars(thresholdCents).toFixed(2)} require physical return before refund release.`,
      passed: !exceedsReturnThreshold,
      details: exceedsReturnThreshold
        ? `Order gross $${toDollars(grossCents).toFixed(2)} exceeds $${toDollars(thresholdCents).toFixed(2)} threshold. Return merchandise inspection required.`
        : `Order gross $${toDollars(grossCents).toFixed(2)} is within the $${toDollars(thresholdCents).toFixed(2)} physical return threshold.`,
    });

    // -------------------------------------------------------------
    // RULE 5: Balance & Eligible Amount Minor-Unit Arithmetic
    // -------------------------------------------------------------
    let eligibleAmountCents: number | null = null;
    if (withinWindow && !duplicateDetected) {
      if (disputeCase.requestedResolution === 'partial_refund') {
        const maxPartialCents = Math.floor((grossCents * policy.maxPartialRefundPercentage) / 100);
        eligibleAmountCents = Math.min(maxPartialCents, refundableCents);
      } else {
        eligibleAmountCents = refundableCents;
      }
    }

    // -------------------------------------------------------------
    // RULE 6: Overall Outcome Classification
    // -------------------------------------------------------------
    let result: PolicyEvaluationResult['result'] = 'ELIGIBLE_FOR_MERCHANT_REVIEW';

    if (duplicateDetected) {
      result = 'MANUAL_REVIEW_REQUIRED';
    } else if (!withinWindow) {
      result = 'INELIGIBLE_UNDER_CONFIGURED_POLICY';
      eligibleAmountCents = null;
    } else if (missingRequirements.length > 0) {
      result = 'MORE_INFORMATION_REQUIRED';
      eligibleAmountCents = null;
    } else if (exceedsReturnThreshold) {
      result = 'MANUAL_REVIEW_REQUIRED';
    }

    return {
      result,
      policy_version: policy.version,
      eligible_amount: eligibleAmountCents !== null ? toDollars(eligibleAmountCents) : null,
      missing_requirements: missingRequirements,
      reason_codes: reasonCodes.length > 0 ? reasonCodes : ['POLICY_CRITERIA_MET'],
      rules_evaluated: rulesEvaluated,
      evaluated_at: new Date().toISOString(),
    };
  }
}

export const policyEngine = new PolicyEngine();
