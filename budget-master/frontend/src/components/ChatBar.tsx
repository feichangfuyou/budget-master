import { useState } from 'react';

interface ChatBarProps {
  onSubmit: (query: string) => Promise<void>;
  onFileUpload: (file: File) => Promise<void>;
}

export function ChatBar({ onSubmit, onFileUpload }: ChatBarProps) {
  const [query, setQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      await onSubmit(query);
      setQuery('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white px-4 py-3 shadow-lg sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <form onSubmit={handleSubmit} className="flex items-center gap-3">
          <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onFileUpload(file);
                  e.target.value = '';
                }
              }}
            />
            <svg
              className="size-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
              />
            </svg>
            <span className="hidden sm:inline">Upload Receipt</span>
          </label>
          
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask about your budget..."
              disabled={isSubmitting}
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 pr-12 text-sm text-gray-900 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              aria-label="Ask about your budget"
            />
            <button
              type="submit"
              disabled={!query.trim() || isSubmitting}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex size-8 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              aria-label="Send message"
            >
              {isSubmitting ? (
                <svg className="size-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
                <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
