const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {} } = options;

  const config: RequestInit = {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };

  if (body && method !== "GET") {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_URL}${endpoint}`, config);

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(
      data?.message || `Request failed with status ${response.status}`,
      response.status,
      data
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// ---------- Reports ----------

export interface CustomFieldValue {
  label: string;
  value: string;
}

export interface ReportVersion {
  version: number;
  pdfUrl: string;
  texUrl?: string;
  createdAt: string;
  label?: string;
}

export interface Report {
  id: string;
  title?: string;
  company?: string;
  role?: string;
  dates?: string;
  techStack: string[];
  description?: string;
  language: string;
  style: string;
  font?: string;
  customFields?: Record<string, CustomFieldValue>;
  chatMessages?: unknown[];
  status: "pending" | "queued" | "reviewing" | "processing" | "writing" | "compiling" | "completed" | "failed";
  pdfUrl?: string;
  texUrl?: string;
  versions?: ReportVersion[];
  screenshotCount?: number;
  screenshots?: Screenshot[];
  createdAt: string;
  updatedAt: string;
}

export interface Screenshot {
  id: string;
  url: string;
  index: number;
  feature?: string;
  description?: string;
  section?: string;
  excluded: boolean;
  blurScore?: number;
  createdAt: string;
}

export interface ReportStatus {
  id: string;
  status: Report["status"];
  currentStage: string;
  frameCount: number | null;
  sectionCount: number | null;
  errorMessage: string | null;
  pdfUrl?: string | null;
  texUrl?: string | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export const api = {
  // Reports
  createReport: async (data: Partial<Omit<Report, "id" | "status" | "createdAt" | "updatedAt">> = {}) => {
    const res = await request<{ success: boolean; data: { report: Report } }>("/api/reports", { method: "POST", body: data });
    return res.data.report;
  },

  listReports: async (page = 1, limit = 20) => {
    const res = await request<{ success: boolean; data: { reports: Report[]; pagination: Pagination } }>(`/api/reports?page=${page}&limit=${limit}`);
    return res.data;
  },

  getReport: async (id: string) => {
    const res = await request<{ success: boolean; data: { report: Report } }>(`/api/reports/${id}`);
    return res.data.report;
  },

  updateReport: async (id: string, data: Partial<Report>) => {
    const res = await request<{ success: boolean; data: { report: Report } }>(`/api/reports/${id}`, { method: "PATCH", body: data });
    return res.data.report;
  },

  deleteReport: (id: string) =>
    request<void>(`/api/reports/${id}`, { method: "DELETE" }),

  generateReport: (id: string) =>
    request<{ success: boolean; message: string }>(`/api/reports/${id}/generate`, { method: "POST" }),

  getReportStatus: async (id: string) => {
    const res = await request<{ success: boolean; data: ReportStatus }>(`/api/reports/${id}/status`);
    return res.data;
  },

  /**
   * Open an SSE connection for real-time pipeline status updates.
   * Returns a cleanup function that closes the connection.
   * Auto-reconnects with exponential backoff on transient errors.
   */
  subscribeToReport: (
    id: string,
    onUpdate: (data: ReportStatus) => void,
    onError?: () => void,
  ): (() => void) => {
    let es: EventSource | null = null;
    let closed = false;
    let retries = 0;
    const MAX_RETRIES = 6;

    const connect = () => {
      if (closed) return;
      es = new EventSource(`${API_URL}/api/reports/${id}/stream`, { withCredentials: true });

      es.onmessage = (e) => {
        retries = 0; // reset backoff on successful message
        try {
          const data = JSON.parse(e.data) as ReportStatus;
          onUpdate(data);
          if (data.status === "completed" || data.status === "failed") {
            closed = true;
            es?.close();
          }
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (closed) return;
        if (retries < MAX_RETRIES) {
          const delay = Math.min(1000 * 2 ** retries, 30_000);
          retries++;
          setTimeout(connect, delay);
        } else {
          onError?.();
        }
      };
    };

    connect();
    return () => { closed = true; es?.close(); };
  },

  // Screenshots
  uploadScreenshots: async (reportId: string, files: File[]) => {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append("screenshots", file);
    });

    const response = await fetch(`${API_URL}/api/upload/${reportId}`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new ApiError(
        data?.message || "Upload failed",
        response.status,
        data
      );
    }

    return response.json() as Promise<{ screenshots: Screenshot[] }>;
  },

  deleteScreenshot: (reportId: string, screenshotId: string) =>
    request<void>(`/api/upload/${reportId}/${screenshotId}`, { method: "DELETE" }),

  deleteVersion: (reportId: string, version: number) =>
    request<void>(`/api/reports/${reportId}/versions/${version}`, { method: "DELETE" }),

  /**
   * Upload a single image for use in document editing (reuses the existing upload route).
   * Returns the R2 URL of the uploaded image.
   */
  uploadEditImage: async (reportId: string, file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("screenshots", file);

    const response = await fetch(`${API_URL}/api/upload/${reportId}`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new ApiError(data?.message || "Upload failed", response.status, data);
    }

    const result = await response.json() as { screenshots: { url: string }[] };
    const url = result.screenshots?.[0]?.url;
    if (!url) throw new ApiError("Upload returned no URL", 500);
    return url;
  },
};
