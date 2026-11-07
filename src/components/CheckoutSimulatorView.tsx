import React, { useState } from 'react';
import {
  ShoppingBag,
  CreditCard,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  ExternalLink,
  Loader2,
  Package,
} from 'lucide-react';
import { Order } from '../types';

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
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{
    order: any;
    case: any;
    customerAccessLink: string;
    isSimulated: boolean;
  } | null>(null);

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

  const handleExecuteCheckout = async () => {
    setIsProcessing(true);
    setResult(null);

    try {
      const res = await fetch('/api/v1/orders/checkout-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productType: selectedProduct,
          buyerName,
          buyerEmail,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setResult(data);
        onOrderCreated(data.order, data.customerAccessLink);
      } else {
        alert(data.error || 'Checkout simulation failed');
      }
    } catch (err) {
      console.error('Checkout error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-mono font-semibold uppercase text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
            Stage B — PayPal Transaction Flow
          </span>
          <span className="text-xs text-slate-400">·</span>
          <span className="text-xs font-mono text-slate-500">
            {isSandboxConfigured ? 'Live Sandbox Connected' : 'Sandbox Verification Mode'}
          </span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          PayPal Sandbox Checkout & Transaction Generator
        </h1>
        <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
          Simulate a real e-commerce checkout. FairResolve creates a sandbox order, captures payment,
          stores the transaction record, and produces an active dispute investigation with a secure customer portal link.
        </p>
      </div>

      {result ? (
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
              <span className="text-slate-500 block text-[10px] uppercase">Customer Email</span>
              <span className="text-xs text-slate-800 truncate block">
                {result.order.buyerEmail}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase">Carrier Tracking</span>
              <span className="text-xs text-slate-800 truncate block">
                {result.order.trackingNumber}
              </span>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="p-4 bg-blue-50/50 rounded-lg border border-blue-200 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-blue-900">
                  Customer Dispute Investigation Generated
                </h3>
                <p className="text-[11px] text-blue-700 mt-0.5">
                  Case <span className="font-mono font-bold">{result.case.caseNumber}</span> is ready for investigation.
                </p>
              </div>
              <button
                onClick={() => onNavigateToCase(result.case.id)}
                className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5 shadow-sm shadow-blue-500/20"
              >
                Inspect Dispute in Merchant Cockpit
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <button
            onClick={() => setResult(null)}
            className="text-xs text-slate-500 hover:text-slate-700 underline"
          >
            ← Simulate Another Checkout
          </button>
        </div>
      ) : (
        /* Checkout Setup Form */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left 7 Cols: Product Selection */}
          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
            <h2 className="text-sm font-bold text-slate-900 uppercase font-mono tracking-wider">
              1. Select Test Merchandise
            </h2>

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
                        ? 'border-blue-600 bg-blue-50/40 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                          isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
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
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-slate-600 block mb-1">Customer Email</label>
                  <input
                    type="email"
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right 5 Cols: Payment Summary & Checkout Action */}
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
                  <span className="font-mono text-blue-700">${grossTotal.toFixed(2)} USD</span>
                </div>
              </div>

              {/* PayPal Sandbox Execution Button */}
              <button
                onClick={handleExecuteCheckout}
                disabled={isProcessing}
                className="w-full py-3 bg-[#0070ba] hover:bg-[#003087] text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Capturing PayPal Sandbox Order...
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
                <span>Simulates Order Creation & Server-side Capture</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
