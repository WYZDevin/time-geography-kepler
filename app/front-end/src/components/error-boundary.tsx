import { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from './ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * ErrorBoundary - Catches React errors and prevents full app crashes
 *
 * Philosophy: "Never break userspace"
 * - Show clear error message instead of white screen
 * - Allow user to recover without losing work
 * - Log errors for debugging
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to console for debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    this.setState({
      error,
      errorInfo
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-white rounded-lg shadow-xl border border-red-200 p-8">
            <div className="flex items-start mb-6">
              <div className="flex-shrink-0">
                <span className="text-5xl">💥</span>
              </div>
              <div className="ml-4 flex-1">
                <h1 className="text-2xl font-bold text-red-800 mb-2">
                  Something Went Wrong
                </h1>
                <p className="text-red-700 mb-4">
                  The application encountered an unexpected error. Don't worry - your data is safe.
                </p>
              </div>
            </div>

            {/* Error Message */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-red-800 mb-2">Error Details:</h3>
              <code className="text-sm text-red-900 block bg-red-100 p-3 rounded font-mono break-all">
                {this.state.error?.toString()}
              </code>
            </div>

            {/* Stack Trace (collapsed by default) */}
            {this.state.errorInfo && (
              <details className="mb-6">
                <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900 mb-2">
                  🔍 Show Technical Details
                </summary>
                <div className="bg-gray-50 border border-gray-200 rounded p-3 overflow-auto max-h-64">
                  <pre className="text-xs text-gray-800 font-mono whitespace-pre-wrap">
                    {this.state.errorInfo.componentStack}
                  </pre>
                </div>
              </details>
            )}

            {/* Recovery Actions */}
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-800 mb-3">What you can do:</h3>
              <ul className="list-disc list-inside text-gray-700 mb-4 space-y-1 text-sm">
                <li>Try refreshing the page to restart the application</li>
                <li>If the problem persists, try clearing your browser cache</li>
                <li>Check the browser console for more details</li>
              </ul>

              <div className="flex space-x-3">
                <Button
                  onClick={this.handleReset}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Try Again
                </Button>
                <Button
                  onClick={this.handleReload}
                  variant="outline"
                  className="border-gray-300 hover:bg-gray-50"
                >
                  Reload Page
                </Button>
              </div>
            </div>

            {/* Attribution */}
            <div className="mt-8 pt-6 border-t border-gray-200 text-center">
              <p className="text-sm text-gray-600">
                Space-Time Analytics Platform v2.0.0
              </p>
              <p className="text-xs text-gray-500 mt-1">
                If this error continues, please report it with the error details above
              </p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
