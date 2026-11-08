import React, { useState } from 'react';
import {
  ShoppingBag,
  CreditCard,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Loader2,
  Package,
  AlertCircle,
  Truck,
  ExternalLink,
} from 'lucide-react';
import { Order } from '../types';
import { apiFetch } from '../utils/api';
import { SourceBadge } from './Badges';

interface CheckoutSimulatorViewProps {
  onOrderCreated: (newOrder: Order, customerLink: string) => void;
  onNavigateToCase: (caseId: string) => void;
  isSandboxConfigured: boolean;
}

export const CheckoutSimulatorView: React.FC<CheckoutSimulatorViewProps> = ({
  onOrderCreated,
  onNavigateToCase,
  isSandboxConfigured,
}) => {
  const [selectedProduct, setSelectedProduct] = useState<'headphones' | 'shoes' | 'tracker'>(
    'headphones'
  );
  const [buyerName, setBuyerName] = useState('Jonathan Mercer');
  const [buyerEmail, setBuyerEmail] = useState('j.mercer@sandbox.test');
  const [checkoutStep, setCheckoutStep] = useState<'SELECT' | 'APPROVE' | 'SUCCESS'>('SELECT');
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [pendingOrderNumber, setPendingOrderNumber] = useState<string | null>(null);
  const [pendingApproveUrl, setPendingApproveUrl] = useState<string | null>(null);
  const [isSimulatedOrder, setIsSimulatedOrder] = useState<boolean>(false);
  const [result, setResult] = useState<{
    order: any;
    case: any;
    customerAccessLink: string;
    isSimulated: boolean;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const products = {
    headphones: {
      name: 'AuraSound ANC Wireless Studio Headphones',
      sku: 'APX-H900-BLK',
      price: 149.99,
      shipping: 10.0,
      description: 'Active noise-canceling circumaural studio monitor with 40mm beryllium drivers.',
    },
    shoes: {
      name: 'ProTrail Ultralight Running Shoes (Size 10M, Slate)',
      sku: 'APX-TRAIL-10M',
      price: 119.5,
      shipping: 9.5,
      description: 'Breathable ripstop mesh trail footwear with Vibram Megagrip traction lug outsole.',
    },
    tracker: {
      name: 'PulseFit Pro Smart Tracker - Space Gray',
      sku: 'APX-FIT-GRY',
      price: 69.0,
      shipping: 0.0,
      description: 'Continuous biometric sensor array with AMOLED display and 10-day battery life.',
    },
  };

  const product = products[selectedProduct];
  const grossTotal = product.price + product.shipping;

  // Step 1: Create PayPal Order
  const handleInitiateOrder = async () => {
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const res = await apiFetch('/api/v1/paypal/orders', {
        method: 'POST',
        body: JSON.stringify({ productType: selectedProduct }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Order creation failed');

      setPendingOrderId(data.orderId);
      setPendingOrderNumber(data.orderNumber);
      setPendingApproveUrl(data.approveUrl || null);
      setIsSimulatedOrder(Boolean(data.isSimulated));
      setCheckoutStep('APPROVE');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to initialize PayPal order');
    } finally {
      setIsProcessing(false);
    }
  };

  // Step 2: Buyer Authorizes & Captures Order
  const handleCaptureApprovedOrder = async () => {
    if (!pendingOrderId) return;
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const res = await apiFetch(`/api/v1/paypal/orders/${pendingOrderId}/capture`, {
        method: 'POST',
        body: JSON.stringify({
          productType: selectedProduct,
          buyerName,
          buyerEmail,
          orderNumber: pendingOrderNumber,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Order capture failed');

      setResult(data);
      setCheckoutStep('SUCCESS');
      onOrderCreated(data.order, data.customerAccessLink);
    } catch (err: any) {
      setErrorMessage(err.message || 'Payment capture failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setResult(null);
    setPendingOrderId(null);
    setPendingOrderNumber(null);
    setCheckoutStep('SELECT');
    setErrorMessage(null);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          <span className="text-xs font-mono font-semibold uppercase text-[#0070BA] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
            PayPal v6 Checkout Workflow
          </span>
          <span className="text-xs text-slate-400">·</span>
          {isSandboxConfigured ? (
            <SourceBadge source="PAYPAL_VERIFIED" />
          ) : (
            <SourceBadge source="SIMULATION_MODE" />
          )}
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          PayPal Sandbox Checkout & Order Simulator
        </h1>
        <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
          Demonstrates authentic PayPal Orders v2 integration: <strong>Order Creation</strong> →{' '}
          <strong>Buyer Authorization</strong> → <strong>Server Capture</strong>. Produces a verified
          dispute investigation record with authentic carrier tracking provenance and customer dispute link.
        </p>
      </div>

      {errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-rose-800 text-xs">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <strong>Transaction Error:</strong> {errorMessage}
          </div>
        </div>
      )}

      {checkoutStep === 'SUCCESS' && result ? (
        /* Result Confirmation Card */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                PayPal Sandbox Payment Captured Successfully
              </h2>
              <p className="text-xs text-slate-500 font-mono">
                Capture ID: <span className="font-bold text-slate-800">{result.order.paypalCaptureId}</span> · Order: {result.order.orderNumber}
              </p>
            </div>
          </div>

          {/* Captured Payment Summary */}
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
            <div>
              <span className="text-slate-500 block text-[10px] uppercase">Amount Settled</span>
              <span className="text-sm font-bold text-slate-900">
                ${result.order.grossAmount.toFixed(2)} USD
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase">PayPal Order ID</span>
              <span className="text-xs text-slate-800 truncate block">
                {result.order.paypalOrderId}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase">Buyer Email</span>
              <span className="text-xs text-slate-800 truncate block">
                {result.order.buyerEmail}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase">Carrier Provenance</span>
              <div className="flex items-center gap-1 text-slate-800 text-xs">
                <Truck className="w-3.5 h-3.5 text-blue-600" />
                <span className="truncate">{result.order.shippingCarrier}</span>
              </div>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="p-4 bg-blue-50/70 rounded-xl border border-blue-200 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold text-blue-900">
                  Customer Dispute Investigation Generated
                </h3>
                <p className="text-[11px] text-blue-700 mt-0.5">
                  Dispute Case <span className="font-mono font-bold">{result.case.caseNumber}</span> is ready for investigation.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onNavigateToCase(result.case.id)}
                  className="px-4 py-2 bg-[#0070BA] hover:bg-[#003087] text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  Inspect in Case Cockpit
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={handleReset}
            className="text-xs text-slate-500 hover:text-slate-800 underline font-mono"
          >
            ← Simulate Another Checkout
          </button>
        </div>
      ) : checkoutStep === 'APPROVE' ? (
        /* Step 2: Buyer Approval Modal View */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-[#0070BA] flex items-center justify-center font-bold text-lg">
              P
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                PayPal Sandbox Buyer Authorization
              </h2>
              <p className="text-xs font-mono text-slate-500">
                Order ID: <span className="font-bold text-slate-800">{pendingOrderId}</span>
              </p>
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-600">Merchant:</span>
              <strong className="text-slate-900">Apex Audio & Gear (Sandbox)</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Item:</span>
              <strong className="text-slate-900">{product.name}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Buyer:</span>
              <span className="font-mono text-slate-900">{buyerName} ({buyerEmail})</span>
            </div>
            <div className="flex justify-between text-sm font-bold pt-2 border-t border-slate-200">
              <span className="text-slate-900">Total Authorization:</span>
              <span className="font-mono text-[#0070BA]">${grossTotal.toFixed(2)} USD</span>
            </div>
          </div>

          {pendingApproveUrl && (
            <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-lg text-xs space-y-2">
              <div className="flex items-center justify-between font-semibold text-slate-900">
                <span className="flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-[#0070BA]" />
                  <span>PayPal Buyer Approval Flow</span>
                </span>
                {pendingApproveUrl.startsWith('http') ? (
                  <a
                    href={pendingApproveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[#0070BA] hover:underline font-bold"
                  >
                    <span>Authorize on PayPal Sandbox</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <span className="text-amber-800 font-mono text-[11px] bg-amber-100 px-2 py-0.5 rounded">
                    Simulated Approval Mode
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 font-mono truncate">
                Redirect URL: {pendingApproveUrl}
              </p>
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={handleCaptureApprovedOrder}
              disabled={isProcessing}
              className="w-full py-3.5 bg-[#FFC439] hover:bg-[#F4B41A] text-slate-900 font-bold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Capturing Authorized Payment via PayPal API...</span>
                </>
              ) : (
                <>
                  <CreditCard className="w-4 h-4" />
                  <span>Approve & Authorize Payment (${grossTotal.toFixed(2)})</span>
                </>
              )}
            </button>

            <button
              onClick={handleReset}
              disabled={isProcessing}
              className="w-full py-2 text-xs text-slate-500 hover:text-slate-700"
            >
              Cancel Transaction
            </button>
          </div>
        </div>
      ) : (
        /* Step 1: Merchandise Selection */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left 7 Cols: Product Selection */}
          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
            <h2 className="text-sm font-bold text-slate-900 uppercase font-mono tracking-wider">
              1. Select Test Merchandise
            </h2>

            {pendingApproveUrl && (
            <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-lg text-xs space-y-2">
              <div className="flex items-center justify-between font-semibold text-slate-900">
                <span className="flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-[#0070BA]" />
                  <span>PayPal Buyer Approval Flow</span>
                </span>
                {pendingApproveUrl.startsWith('http') ? (
                  <a
                    href={pendingApproveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[#0070BA] hover:underline font-bold"
                  >
                    <span>Authorize on PayPal Sandbox</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <span className="text-amber-800 font-mono text-[11px] bg-amber-100 px-2 py-0.5 rounded">
                    Simulated Approval Mode
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 font-mono truncate">
                Redirect URL: {pendingApproveUrl}
              </p>
            </div>
          )}

          <div className="space-y-3">
              {(Object.keys(products) as Array<keyof typeof products>).map((key) => {
                const p = products[key];
                const isSelected = selectedProduct === key;
                return (
                  <div
                    key={key}
                    onClick={() => setSelectedProduct(key)}
                    className={`p-4 rounded-xl border cursor-pointer transition-all flex items-start justify-between gap-4 ${
                      isSelected
                        ? 'border-[#0070BA] bg-blue-50/40 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                          isSelected ? 'bg-[#0070BA] text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <Package className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900 text-xs sm:text-sm">
                          {p.name}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                          {p.description}
                        </p>
                        <span className="font-mono text-[10px] text-slate-400 mt-1 block">
                          SKU: {p.sku}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-mono font-bold text-slate-900 text-sm">
                        ${p.price.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-slate-400 block font-mono">
                        {p.shipping === 0 ? 'Free Shipping' : `+$${p.shipping.toFixed(2)} S&H`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Buyer Details */}
            <div className="pt-4 border-t border-slate-100 space-y-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase font-mono">
                2. Test Buyer Profile
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-slate-600 block mb-1">Customer Full Name</label>
                  <input
                    type="text"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0070BA]"
                  />
                </div>
                <div>
                  <label className="text-slate-600 block mb-1">Customer Email</label>
                  <input
                    type="email"
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0070BA] font-mono"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right 5 Cols: Payment Summary */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4 text-xs">
              <h3 className="text-sm font-bold text-slate-900">Order Summary</h3>

              <div className="space-y-2 py-3 border-y border-slate-100">
                <div className="flex justify-between">
                  <span className="text-slate-600">Item Subtotal</span>
                  <span className="font-mono font-medium text-slate-900">
                    ${product.price.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Standard Shipping</span>
                  <span className="font-mono font-medium text-slate-900">
                    ${product.shipping.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-bold text-slate-900 pt-2 border-t border-slate-100">
                  <span>Gross Total</span>
                  <span className="font-mono text-[#0070BA]">${grossTotal.toFixed(2)} USD</span>
                </div>
              </div>

              {/* PayPal Sandbox Execution Button */}
              <button
                onClick={handleInitiateOrder}
                disabled={isProcessing}
                className="w-full py-3 bg-[#0070BA] hover:bg-[#003087] text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Initializing PayPal Order...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4" />
                    Pay with PayPal Sandbox (${grossTotal.toFixed(2)})
                  </>
                )}
              </button>

              <div className="text-[11px] text-slate-500 text-center flex items-center justify-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Requires Buyer Approval Step Before Capture</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
