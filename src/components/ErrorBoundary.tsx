import React from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'An unexpected application error occurred.',
    };
  }

  override render() {
    if (this.state.hasError) {
      let friendly = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message);
        if (parsed?.error) {
          friendly = `Database access error (${parsed.operationType || 'operation'}): ${parsed.error}`;
        }
      } catch {
        // Keep raw message
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA] dark:bg-[#0B1120] p-6">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
            <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-6 w-6 shrink-0" />
              <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Something went wrong
              </h1>
            </div>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed break-words">
              {friendly}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex items-center justify-center gap-2 w-full rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-700 transition-colors"
            >
              <RotateCw className="h-4 w-4" />
              Reload MoneyLedger
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
