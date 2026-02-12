/** Standard API response envelope */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  message?: string;
}

/** Pagination params */
export interface PaginationParams {
  page: number;
  limit: number;
}

/** Paginated response wrapper */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Report status union */
export type ReportStatus =
  | 'pending'
  | 'processing'
  | 'reviewing'
  | 'writing'
  | 'compiling'
  | 'completed'
  | 'failed';

/** User plan union */
export type UserPlan = 'free' | 'one_time' | 'unlimited';

/** Report style union */
export type ReportStyle = 'academic' | 'professional' | 'technical';

/** Supported languages */
export type SupportedLanguage = 'en' | 'pt' | 'es' | 'fr' | 'de';
