/**
 * Error handling utilities
 * Centralizes error management, logging, and user-friendly messages
 */

/**
 * Error types for the application
 */
export enum ErrorType {
  VALIDATION = 'VALIDATION',
  STORAGE = 'STORAGE',
  CALCULATION = 'CALCULATION',
  NETWORK = 'NETWORK',
  FILE_OPERATION = 'FILE_OPERATION',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Application error class with context
 */
export class AppError extends Error {
  type: ErrorType;
  userMessage: string;
  technicalMessage: string;
  timestamp: Date;
  context?: any;

  constructor(
    type: ErrorType,
    userMessage: string,
    technicalMessage?: string,
    context?: any
  ) {
    super(technicalMessage || userMessage);
    this.type = type;
    this.userMessage = userMessage;
    this.technicalMessage = technicalMessage || userMessage;
    this.timestamp = new Date();
    this.context = context;
    this.name = 'AppError';
  }
}

/**
 * Safe localStorage operations with error handling
 */
export const safeLocalStorage = {
  getItem: <T,>(key: string, defaultValue: T): T => {
    try {
      const item = localStorage.getItem(key);
      if (item === null) return defaultValue;

      return JSON.parse(item) as T;
    } catch (error) {
      console.error(`Error reading from localStorage (key: ${key}):`, error);
      return defaultValue;
    }
  },

  setItem: (key: string, value: any): boolean => {
    try {
      const serialized = JSON.stringify(value);
      localStorage.setItem(key, serialized);
      return true;
    } catch (error) {
      if ((error as DOMException).name === 'QuotaExceededError') {
        console.error('localStorage quota exceeded');
        throw new AppError(
          ErrorType.STORAGE,
          'Storage limit reached. Please clear some saved deals.',
          'localStorage quota exceeded',
          { key, error }
        );
      }

      console.error(`Error writing to localStorage (key: ${key}):`, error);
      throw new AppError(
        ErrorType.STORAGE,
        'Failed to save data. Please try again.',
        `localStorage setItem failed for key: ${key}`,
        { key, error }
      );
    }
  },

  removeItem: (key: string): boolean => {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.error(`Error removing from localStorage (key: ${key}):`, error);
      return false;
    }
  },

  clear: (): boolean => {
    try {
      localStorage.clear();
      return true;
    } catch (error) {
      console.error('Error clearing localStorage:', error);
      return false;
    }
  },
};

/**
 * Validate number input with range checking
 */
export const validateNumber = (
  value: any,
  fieldName: string,
  options?: {
    min?: number;
    max?: number;
    required?: boolean;
  }
): { isValid: boolean; error?: string } => {
  const num = parseFloat(value);

  if (options?.required && (value === '' || value === null || value === undefined)) {
    return {
      isValid: false,
      error: `${fieldName} is required`,
    };
  }

  if (isNaN(num)) {
    return {
      isValid: false,
      error: `${fieldName} must be a valid number`,
    };
  }

  if (options?.min !== undefined && num < options.min) {
    return {
      isValid: false,
      error: `${fieldName} must be at least ${options.min}`,
    };
  }

  if (options?.max !== undefined && num > options.max) {
    return {
      isValid: false,
      error: `${fieldName} must be no more than ${options.max}`,
    };
  }

  return { isValid: true };
};

/**
 * Log error to console (can be extended to send to monitoring service)
 */
export const logError = (error: Error | AppError, context?: any): void => {
  const errorInfo = {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    context,
  };

  // Log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.group('🔴 Error Logged');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    if (context) console.error('Context:', context);
    console.groupEnd();
  }

  // In production, you would send this to an error monitoring service
  // Example: Sentry.captureException(error, { extra: errorInfo });
};

/**
 * Try-catch wrapper for async operations
 */
export const tryCatch = async <T,>(
  operation: () => Promise<T>,
  errorType: ErrorType,
  userMessage: string
): Promise<{ data?: T; error?: AppError }> => {
  try {
    const data = await operation();
    return { data };
  } catch (error) {
    const appError = new AppError(
      errorType,
      userMessage,
      error instanceof Error ? error.message : 'Unknown error',
      { originalError: error }
    );

    logError(appError);
    return { error: appError };
  }
};

/**
 * Retry operation with exponential backoff
 */
export const retryOperation = async <T,>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> => {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');

      if (attempt < maxRetries - 1) {
        // Exponential backoff: 1s, 2s, 4s, etc.
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Operation failed after retries');
};

/**
 * Debounce function for input handlers
 */
export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);

    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
};

/**
 * Get user-friendly error message
 */
export const getUserFriendlyError = (error: unknown): string => {
  if (error instanceof AppError) {
    return error.userMessage;
  }

  if (error instanceof Error) {
    // Map common errors to user-friendly messages
    if (error.message.includes('quota')) {
      return 'Storage limit reached. Please clear some saved data.';
    }

    if (error.message.includes('network') || error.message.includes('fetch')) {
      return 'Network error. Please check your connection and try again.';
    }

    return 'An unexpected error occurred. Please try again.';
  }

  return 'An unexpected error occurred. Please try again.';
};
