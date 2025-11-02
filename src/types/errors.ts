import type { ServiceName } from './syncfm';

export type ErrorType = 'not_found' | 'network' | 'rate_limit' | 'invalid_data' | 'unknown';

export interface ConversionError {
    service: ServiceName;
    timestamp: Date;
    errorType: ErrorType;
    message: string;
    retryable: boolean;
    originalError?: unknown;
}

export interface ConversionResult<T> {
    service: ServiceName;
    success: boolean;
    data?: T;
    error?: ConversionError;
}

export interface ServiceConversionHistory {
    lastAttempt: Date;
    attempts: number;
    lastError?: string;
    errorType?: ErrorType;
    retryable: boolean;
}

export interface ConversionErrorMap {
    [service: string]: ServiceConversionHistory;
}

/**
 * Categorizes an error into a specific type for better handling
 */
export function categorizeError(error: unknown): { errorType: ErrorType; retryable: boolean } {
    const errorMessage = String((error as Error)?.message || error || '').toLowerCase();

    // Not found errors - don't retry
    if (errorMessage.includes('not found') ||
        errorMessage.includes('no result') ||
        errorMessage.includes('no song found') ||
        errorMessage.includes('no artist found') ||
        errorMessage.includes('no album found')) {
        return { errorType: 'not_found', retryable: false };
    }

    // Rate limit errors - retry with backoff
    if (errorMessage.includes('rate limit') ||
        errorMessage.includes('too many requests') ||
        errorMessage.includes('429')) {
        return { errorType: 'rate_limit', retryable: true };
    }

    // Network errors - retry
    if (errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('econnrefused') ||
        errorMessage.includes('fetch failed')) {
        return { errorType: 'network', retryable: true };
    }

    // Invalid data errors - don't retry
    if (errorMessage.includes('invalid') ||
        errorMessage.includes('missing') ||
        errorMessage.includes('required')) {
        return { errorType: 'invalid_data', retryable: false };
    }

    // Unknown errors - retry once to be safe
    return { errorType: 'unknown', retryable: true };
}

/**
 * Determines if we should retry a failed service based on its history
 */
export function shouldRetryService(history?: ServiceConversionHistory): boolean {
    if (!history) return true; // Never tried before

    // Don't retry non-retryable errors
    if (!history.retryable) return false;

    // Don't retry if we've tried too many times
    const MAX_ATTEMPTS = 3;
    if (history.attempts >= MAX_ATTEMPTS) return false;

    // Don't retry if we tried very recently (within 5 minutes)
    const MIN_RETRY_INTERVAL_MS = 5 * 60 * 1000;
    const timeSinceLastAttempt = Date.now() - new Date(history.lastAttempt).getTime();
    if (timeSinceLastAttempt < MIN_RETRY_INTERVAL_MS) return false;

    return true;
}

/**
 * Determines if an error should be retried immediately (within the same request)
 */
export function shouldRetryImmediately(errorType: ErrorType, attemptNumber: number): boolean {
    // Never retry not_found or invalid_data errors
    if (errorType === 'not_found' || errorType === 'invalid_data') {
        return false;
    }

    // For rate limits, don't retry immediately (needs backoff time)
    if (errorType === 'rate_limit') {
        return false;
    }

    // For network errors and unknown errors, retry once
    if ((errorType === 'network' || errorType === 'unknown') && attemptNumber < 2) {
        return true;
    }

    return false;
}

/**
 * Sleep utility for retry delays
 */
export async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
