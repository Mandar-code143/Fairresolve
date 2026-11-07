/**
 * FairResolve Relational Database Domain Entities
 * Strictly typed relational models with minor unit (cents) arithmetic.
 */

export type UserRole = 'OWNER' | 'ADMIN' | 'REVIEWER' | 'ANALYST' | 'VIEWER';

export interface TenantEntity {
  id: string;
  name: string;
  slug: string;
  currency: string;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserEntity {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  role: UserRole;
  password_hash: string;
  password_salt: string;
  avatar_url?: string;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface TenantMembershipEntity {
  id: string;
  tenant_id: string;
  user_id: string;
  role: UserRole;
  created_at: string;
}

export interface SessionEntity {
  id: string;
  user_id: string;
  tenant_id: string;
  token_hash: string;
  user_agent?: string;
  ip_address?: string;
  is_revoked: boolean;
  expires_at: string;
  created_at: string;
}

export interface InvitationEntity {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  role: UserRole;
  token_hash: string;
  invited_by: string;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  expires_at: string;
  created_at: string;
  accepted_at?: string;
}

export interface PayPalConnectionEntity {
  id: string;
  tenant_id: string;
  environment: 'sandbox';
  client_id_masked: string;
  client_secret_hash?: string;
  webhook_id?: string;
  last_verified_at?: string;
  oauth_status: 'NOT_CONFIGURED' | 'VERIFIED' | 'FAILED';
  last_error?: string;
  created_at: string;
  updated_at: string;
}

export interface OrderEntity {
  id: string;
  tenant_id: string;
  paypal_order_id: string;
  paypal_capture_id: string;
  order_number: string;
  buyer_name: string;
  buyer_email: string;
  currency: string;
  gross_amount_cents: number;
  shipping_amount_cents: number;
  refunded_amount_cents: number;
  refundable_amount_cents: number;
  shipping_carrier?: string;
  tracking_number?: string;
  tracking_synthetic: boolean;
  delivery_date?: string;
  status: 'COMPLETED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
  is_simulated: boolean;
  transaction_date: string;
  created_at: string;
  updated_at: string;
}

export interface OrderItemEntity {
  id: string;
  order_id: string;
  sku: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
  total_price_cents: number;
  image_url?: string;
  created_at: string;
}

export interface PolicyEntity {
  id: string;
  tenant_id: string;
  version: string;
  return_window_days: number;
  require_packaging_photo_for_damage: boolean;
  require_label_photo_for_wrong_item: boolean;
  carrier_delivery_verification_days: number;
  max_instant_refund_cents: number;
  mandatory_return_threshold_cents: number;
  allow_partial_refunds_without_return: boolean;
  max_partial_refund_percentage: number;
  flag_duplicate_evidence_hash: boolean;
  description: string;
  published_by?: string;
  published_at: string;
  created_at: string;
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

export interface CaseEntity {
  id: string;
  tenant_id: string;
  case_number: string;
  order_id: string;
  order_number: string;
  paypal_order_id: string;
  paypal_capture_id: string;
  customer_name: string;
  customer_email: string;
  status: CaseStatus;
  issue_type: IssueType;
  requested_resolution: ResolutionRequested;
  customer_description: string;
  merchant_notes?: string;
  assigned_to?: string;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerAccessTokenEntity {
  id: string;
  case_id: string;
  token_hash: string;
  is_revoked: boolean;
  expires_at: string;
  created_at: string;
  last_accessed_at?: string;
}

export interface EvidenceObjectEntity {
  id: string;
  case_id: string;
  tenant_id: string;
  original_filename: string;
  storage_path: string;
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
  byte_size: number;
  width?: number;
  height?: number;
  sha256_hash: string;
  is_duplicate: boolean;
  scan_status: 'clean' | 'unscanned' | 'suspicious' | 'quarantined';
  evidence_type: 'item_photo' | 'packaging_photo' | 'shipping_label' | 'other';
  caption?: string;
  thumbnail_path?: string;
  uploaded_by?: string;
  uploaded_at: string;
}

export interface PolicyEvaluationEntity {
  id: string;
  case_id: string;
  policy_version: string;
  result:
    | 'ELIGIBLE_FOR_MERCHANT_REVIEW'
    | 'MORE_INFORMATION_REQUIRED'
    | 'INELIGIBLE_UNDER_CONFIGURED_POLICY'
    | 'MANUAL_REVIEW_REQUIRED';
  eligible_amount_cents: number | null;
  missing_requirements: string[];
  reason_codes: string[];
  rules_evaluated: any[];
  evaluated_at: string;
}

export interface AIRunEntity {
  id: string;
  case_id: string;
  model_used: string;
  analysis_status: string;
  customer_claim: string;
  reported_facts: string[];
  evidence_observations: string[];
  missing_information: string[];
  inconsistencies: string[];
  policy_references: string[];
  limitations: string[];
  recommended_next_step: string;
  explanation: string;
  is_fallback: boolean;
  analyzed_at: string;
}

export interface RefundApprovalEntity {
  id: string;
  case_id: string;
  tenant_id: string;
  authorized_by: string;
  approved_amount_cents: number;
  currency: string;
  capture_id: string;
  case_version: string;
  policy_version: string;
  notes?: string;
  status: 'ACTIVE' | 'CONSUMED' | 'REVOKED' | 'SUPERSEDED';
  created_at: string;
}

export type RefundAttemptStatus =
  | 'CREATED'
  | 'RESERVED'
  | 'SUBMITTED'
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'UNKNOWN'
  | 'RECONCILIATION_REQUIRED';

export interface RefundAttemptEntity {
  id: string;
  case_id: string;
  tenant_id: string;
  approval_id?: string;
  capture_id: string;
  idempotency_key: string;
  amount_cents: number;
  currency: string;
  reason: string;
  status: RefundAttemptStatus;
  paypal_refund_id?: string;
  paypal_response?: any;
  error_code?: string;
  error_message?: string;
  authorized_by_user_id: string;
  is_simulated: boolean;
  created_at: string;
  completed_at?: string;
  updated_at: string;
}

export interface AuditEventEntity {
  id: string;
  tenant_id: string;
  case_id?: string;
  event_type: string;
  actor_type: 'MERCHANT' | 'CUSTOMER' | 'SYSTEM' | 'AI_ENGINE' | 'PAYPAL_GATEWAY';
  actor_id?: string;
  actor_name: string;
  actor_role?: string;
  summary: string;
  details?: Record<string, any>;
  previous_hash: string;
  current_hash: string;
  timestamp: string;
}

export interface OutboxEventEntity {
  id: string;
  tenant_id: string;
  event_type: string;
  payload: any;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'DEAD_LETTER';
  retry_count: number;
  max_retries: number;
  next_attempt_at: string;
  idempotency_key?: string;
  correlation_id?: string;
  last_error?: string;
  created_at: string;
  processed_at?: string;
}

export interface PayPalWebhookEventEntity {
  id: string;
  event_id: string;
  event_type: string;
  resource_type?: string;
  resource_id?: string;
  summary?: string;
  verification_status: 'VERIFIED' | 'FAILED' | 'UNVERIFIED';
  raw_payload: any;
  processed: boolean;
  created_at: string;
}
