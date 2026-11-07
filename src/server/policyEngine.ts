/**
 * FairResolve Deterministic Policy Engine
 * Evaluates disputes strictly against configured merchant policies using deterministic rules.
 * Never allows AI opinions or free-text predictions to dictate financial eligibility.
 */

import { Case, Order, PolicyEvaluationResult, PolicyRuleEvaluation, RefundPolicy } from '../types';

export class PolicyEngine {
  evaluate(disputeCase: Case, order: Order, policy: RefundPolicy): PolicyEvaluationResult {
    const rulesEvaluated: PolicyRuleEvaluation[] = [];
    const missingRequirements: string[] = [];
    const reasonCodes: string[] = [];

    // Rule 1: Refund Window Check
    const orderDate = new Date(order.deliveryDate || order.transactionDate);
    const caseDate = new Date(disputeCase.createdAt);
    const diffDays = Math.max(
      0,
      Math.floor((caseDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24))
    );

    const withinWindow = diffDays <= policy.returnWindowDays;
    rulesEvaluated.push({
      ruleId: 'R-WINDOW',
      ruleName: 'Refund Request Window',
      description: `Dispute must be filed within ${policy.returnWindowDays} calendar days of delivery/purchase.`,
      passed: withinWindow,
      details: withinWindow
        ? `Filed in ${diffDays} day(s), comfortably within the ${policy.returnWindowDays}-day policy limit.`
        : `Filed ${diffDays} day(s) after transaction/delivery. Exceeds the ${policy.returnWindowDays}-day limit by ${diffDays - policy.returnWindowDays} day(s).`,
    });

    if (!withinWindow) {
      missingRequirements.push(
        `Claim filed ${diffDays} days post-transaction, exceeding the ${policy.returnWindowDays}-day window.`
      );
      reasonCodes.push('RETURN_WINDOW_EXCEEDED');
    }

    // Rule 2: Evidence Deduplication Security Check
    let duplicateDetected = false;
    for (const ev of disputeCase.evidence) {
      if (ev.isDuplicate) {
        duplicateDetected = true;
        break;
      }
    }

    rulesEvaluated.push({
      ruleId: 'R-DEDUP',
      ruleName: 'Evidence Cryptographic Integrity',
      description: 'Checks uploaded evidence SHA-256 hashes against merchant historic cases.',
      passed: !duplicateDetected,
      details: duplicateDetected
        ? 'Duplicate SHA-256 evidence fingerprint detected across separate claims. Immediate security hold.'
        : 'All uploaded evidence hashes are unique to this case.',
    });

    if (duplicateDetected) {
      missingRequirements.push(
        'Duplicate evidence fingerprint detected matching another case. Requires manual fraud review.'
      );
      reasonCodes.push('DUPLICATE_EVIDENCE_HASH_DETECTED');
    }

    // Rule 3: Category Evidence Requirements
    if (disputeCase.issueType === 'damaged_item') {
      const hasItemPhoto = disputeCase.evidence.some(
        (e) => e.evidenceType === 'item_photo' || e.evidenceType === 'other'
      );
      const hasPackagingPhoto = disputeCase.evidence.some(
        (e) => e.evidenceType === 'packaging_photo'
      );

      const damageEvidencePassed = hasItemPhoto && (!policy.requirePackagingPhotoForDamage || hasPackagingPhoto);
      rulesEvaluated.push({
        ruleId: 'R-DMG-EVID',
        ruleName: 'Damaged Item Photographic Evidence',
        description: 'Requires clear photo of damaged item and outer packaging carton.',
        passed: damageEvidencePassed,
        details: damageEvidencePassed
          ? 'Photos of damaged merchandise and outer packaging provided.'
          : 'Missing required photographic proof of damaged goods or parcel condition.',
      });

      if (!damageEvidencePassed) {
        if (!hasItemPhoto) missingRequirements.push('High-resolution photograph of the damaged product');
        if (policy.requirePackagingPhotoForDamage && !hasPackagingPhoto) {
          missingRequirements.push('Photograph of the exterior shipping container/box');
        }
        reasonCodes.push('MISSING_DAMAGE_EVIDENCE');
      }
    } else if (disputeCase.issueType === 'wrong_item') {
      const hasLabelPhoto = disputeCase.evidence.some(
        (e) => e.evidenceType === 'shipping_label' || e.evidenceType === 'item_photo'
      );

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
      const orderAgeDays = diffDays;
      const carrierWindowPassed = orderAgeDays >= policy.carrierDeliveryVerificationDays;

      rulesEvaluated.push({
        ruleId: 'R-INR-WINDOW',
        ruleName: 'Carrier Transit Grace Period',
        description: `Requires at least ${policy.carrierDeliveryVerificationDays} business days for transit before initiating INR refund.`,
        passed: carrierWindowPassed,
        details: carrierWindowPassed
          ? `${orderAgeDays} days elapsed since dispatch.`
          : `Only ${orderAgeDays} days elapsed since dispatch. Carrier standard transit window is still active.`,
      });

      if (!carrierWindowPassed) {
        missingRequirements.push(
          `Carrier transit window still active. Wait at least ${policy.carrierDeliveryVerificationDays} days before approving INR refund.`
        );
        reasonCodes.push('CARRIER_IN_TRANSIT_ACTIVE');
      }
    }

    // Rule 4: Mandatory Physical Return Threshold
    const exceedsReturnThreshold = order.grossAmount > policy.mandatoryReturnThreshold;
    rulesEvaluated.push({
      ruleId: 'R-RETURN-THRESH',
      ruleName: 'Physical Return Requirement Threshold',
      description: `Orders over $${policy.mandatoryReturnThreshold.toFixed(2)} require physical return before refund release.`,
      passed: !exceedsReturnThreshold,
      details: exceedsReturnThreshold
        ? `Order gross $${order.grossAmount.toFixed(2)} exceeds $${policy.mandatoryReturnThreshold.toFixed(2)} threshold. Return merchandise inspection required.`
        : `Order gross $${order.grossAmount.toFixed(2)} is below the $${policy.mandatoryReturnThreshold.toFixed(2)} physical return threshold.`,
    });

    // Rule 5: Balance & Eligible Amount Calculation
    let eligibleAmount: number | null = null;
    if (withinWindow && !duplicateDetected) {
      if (disputeCase.requestedResolution === 'partial_refund') {
        const maxPartial = Math.round(order.grossAmount * (policy.maxPartialRefundPercentage / 100) * 100) / 100;
        eligibleAmount = Math.min(maxPartial, order.refundableAmount);
      } else {
        eligibleAmount = order.refundableAmount;
      }
    }

    // Overall Outcome Classification
    let result: PolicyEvaluationResult['result'] = 'ELIGIBLE_FOR_MERCHANT_REVIEW';

    if (duplicateDetected) {
      result = 'MANUAL_REVIEW_REQUIRED';
    } else if (!withinWindow) {
      result = 'INELIGIBLE_UNDER_CONFIGURED_POLICY';
      eligibleAmount = null;
    } else if (missingRequirements.length > 0) {
      result = 'MORE_INFORMATION_REQUIRED';
      eligibleAmount = null;
    } else if (exceedsReturnThreshold) {
      result = 'MANUAL_REVIEW_REQUIRED';
    }

    return {
      result,
      policy_version: policy.version,
      eligible_amount: eligibleAmount,
      missing_requirements: missingRequirements,
      reason_codes: reasonCodes.length > 0 ? reasonCodes : ['POLICY_CRITERIA_MET'],
      rules_evaluated: rulesEvaluated,
      evaluated_at: new Date().toISOString(),
    };
  }
}

export const policyEngine = new PolicyEngine();
