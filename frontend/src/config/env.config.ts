class EnvironmentConfig {
  /** Trình duyệt luôn gọi API qua /api: Next rewrite chuyển tiếp sang backend (xem next.config.ts), nhờ đó cookie là cookie cùng site. */
  public readonly apiUrl: string = "/api";
  public readonly appUrl: string;
  public readonly isProduction: boolean;
  public readonly isDevelopment: boolean;

  constructor() {
    this.appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "http://localhost:3002";
    this.isProduction = process.env.NODE_ENV === "production";
    this.isDevelopment = process.env.NODE_ENV === "development";
  }
}

export const ENV = new EnvironmentConfig();