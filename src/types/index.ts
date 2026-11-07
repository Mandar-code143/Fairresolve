/**
 * FairResolve Core Domain Types
 * Defines the complete data model for dispute investigations, evidence,
 * deterministic policies, PayPal payments, and audit ledgers.
 */

export type UserRole = 'OWNER' | 'ADMIN' | 'REVIEWER' | 'ANALYST' | 'VIEWER';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string;
  avatarUrl?: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  currency: string;
  createdAt: string;
}

export type CaseStatus =
  | 'NEW'
  | 'AWAITING_EVIDENCE'
  | 'ANALYZING'
  | 'READY_FOR_REVIEW'
  | 'NEEDS_MORE_INFORMATION'
  | 'ESCALATED'
  | 'APPROVED_PENDING_REFUND'
  | 'REFUND_SUBMITTED'
  | 'REFUND_PENDING'
  | 'REFUND_UNKNOWN'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'
  | 'REFUND_FAILED'
  | 'REJECTED'
  | 'CLOSED';

export type IssueType = 'damaged_item' | 'wrong_item' | 'item_not_received';

export type ResolutionRequested = 'full_refund' | 'partial_refund' | 'replacement' | 'store_credit';

export interface OrderItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  imageUrl?: string;
}

export interface Order {
  id: string;
  tenantId: string;
  paypalOrderId: string;
  paypalCaptureId: string;
  orderNumber: string;
  buyerName: string;
  buyerEmail: string;
  transactionDate: string;
  currency: string;
  grossAmount: number;
  shippingAmount: number;
  refundedAmount: number;
  refundableAmount: number;
  items: OrderItem[];
  shippingCarrier?: string;
  trackingNumber?: string;
  deliveryDate?: string;
  status: 'COMPLETED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
}

export interface EvidenceObject {
  id: string;
  caseId: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  sha256Hash: string;
  isDuplicate: boolean;
  duplicateCaseIds?: string[];
  uploadedAt: string;
  scanStatus: 'clean' | 'unscanned' | 'suspicious';
  evidenceType: 'item_photo' | 'packaging_photo' | 'shipping_label' | 'other';
  caption?: string;
  downloadUrl: string;
  thumbnailBase64?: string;
}

export interface AIInvestigationResult {
  issue_type: IssueType;
  customer_claim: string;
  reported_facts: string[];
  evidence_observations: string[];
  missing_information: string[];
  inconsistencies: string[];
  policy_references: string[];
  limitations: string[];
  recommended_next_step:
    | 'request_more_information'
    | 'eligible_for_merchant_review'
    | 'manual_inspection_required'
    | 'ineligible_under_policy';
  explanation: string;
  analyzed_at: string;
  model_used: string;
  is_fallback?: boolean;
}

export interface PolicyRuleEvaluation {
  ruleId: string;
  ruleName: string;
  description: string;
  passed: boolean;
  details: string;
}

export interface PolicyEvaluationResult {
  result:
    | 'ELIGIBLE_FOR_MERCHANT_REVIEW'
    | 'MORE_INFORMATION_REQUIRED'
    | 'INELIGIBLE_UNDER_CONFIGURED_POLICY'
    | 'MANUAL_REVIEW_REQUIRED';
  policy_version: string;
  eligible_amount: number | null;
  missing_requirements: string[];
  reason_codes: string[];
  rules_evaluated: PolicyRuleEvaluation[];
  evaluated_at: string;
}

export interface RefundPolicy {
  version: string;
  publishedAt: string;
  returnWindowDays: number;
  requirePackagingPhotoForDamage: boolean;
  requireLabelPhotoForWrongItem: boolean;
  carrierDeliveryVerificationDays: number;
  maxInstantRefundAmount: number;
  mandatoryReturnThreshold: number;
  allowPartialRefundsWithoutReturn: boolean;
  maxPartialRefundPercentage: number;
  flagDuplicateEvidenceHash: boolean;
  description: string;
}

export interface RefundAttempt {
  id: string;
  caseId: string;
  captureId: string;
  idempotencyKey: string;
  amount: number;
  currency: string;
  reason: string;
  status: 'PENDING' | 'SUBMITTED' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  paypalRefundId?: string;
  paypalResponse?: any;
  errorCode?: string;
  errorMessage?: string;
  authorizedBy: {
    userId: string;
    userName: string;
    userRole: string;
  };
  createdAt: string;
  completedAt?: string;
  isSimulated?: boolean;
}

export interface CaseEvent {
  id: string;
  caseId: string;
  eventType:
    | 'CASE_CREATED'
    | 'EVIDENCE_UPLOADED'
    | 'AI_INVESTIGATION_COMPLETED'
    | 'POLICY_EVALUATED'
    | 'MERCHANT_REVIEWED'
    | 'REFUND_AUTHORIZED'
    | 'REFUND_EXECUTED'
    | 'REFUND_FAILED'
    | 'STATUS_CHANGED'
    | 'NOTE_ADDED'
    | 'CUSTOMER_CONTACTED';
  actor: {
    type: 'MERCHANT' | 'CUSTOMER' | 'SYSTEM' | 'AI_ENGINE' | 'PAYPAL_GATEWAY';
    id?: string;
    name: string;
    role?: string;
  };
  summary: string;
  details?: Record<string, any>;
  timestamp: string;
  previousHash?: string;
  currentHash?: string;
}

export interface Case {
  id: string;
  tenantId: string;
  caseNumber: string;
  orderId: string;
  orderNumber: string;
  paypalOrderId: string;
  paypalCaptureId: string;
  customerName: string;
  customerEmail: string;
  status: CaseStatus;
  issueType: IssueType;
  requestedResolution: ResolutionRequested;
  customerDescription: string;
  customerAccessToken: string;
  tokenExpiresAt: string;
  evidence: EvidenceObject[];
  aiInvestigation?: AIInvestigationResult;
  policyEvaluation?: PolicyEvaluationResult;
  refundAttempts: RefundAttempt[];
  timeline: CaseEvent[];
  merchantNotes?: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayPalGatewayStatus {
  environment: 'sandbox';
  isConfigured: boolean;
  clientIdMasked: string;
  liveEnabled: boolean;
  lastVerifiedAt?: string;
  activeOrderCount: number;
  refundCount: number;
  totalRefundedGross: number;
}

export interface MerchantInvitation {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  tokenHash: string;
  invitedByUserId: string;
  invitedByName: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
  acceptedAt?: string;
}

